import assert from 'node:assert/strict';
import {
  CAPABILITIES,
  CognitiveRuntimeHost,
  EVENT_TYPES,
  EXECUTION_STATUS,
  LIFECYCLE_STATUS,
  MemoryPersistenceAdapter,
  WorkerDirector,
} from '../src/runtime/index.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const units = (count, prefix = 'u') => Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, payload: i }));

function worker(workerId, capabilities, options = {}) {
  return {
    workerId,
    capabilities,
    capabilityDescriptors: options.capabilityDescriptors,
    supportedLayers: options.layers ?? ['L0', 'L1', 'L2', 'L3', 'L4'],
    resourceProfile: options.resources ?? { CPU: 1 },
    concurrencyCapacity: options.capacity ?? 1,
    latencyScore: options.latency ?? 10,
    qualityScore: options.quality ?? 0,
    provider: options.provider ?? workerId,
    implementationId: options.implementationId ?? workerId,
    foregroundEligible: options.foregroundEligible ?? true,
    backgroundEligible: options.backgroundEligible ?? true,
  };
}

function executor(commits = new Map(), { gate = null } = {}) {
  return {
    async execute({ units: sliceUnits }) {
      if (gate) await gate.wait();
      return sliceUnits.map((unit) => unit.payload);
    },
    validate({ output }) { return Array.isArray(output); },
    commit({ units: sliceUnits, idempotencyKey }) {
      if (!commits.has(idempotencyKey)) commits.set(idempotencyKey, sliceUnits.map((unit) => unit.id));
      return { committed: sliceUnits.length };
    },
  };
}

function oneShotGate() {
  let release;
  let first = true;
  return {
    wait() {
      if (!first) return Promise.resolve();
      first = false;
      return new Promise((resolve) => { release = resolve; });
    },
    release() { release?.(); },
  };
}

test('Deep Cognition admits a generic L3 work profile without specialist semantics', async () => {
  const d = new WorkerDirector({ persistence: null });
  const host = new CognitiveRuntimeHost({ director: d });
  host.registerWorker(worker('deep-cpu', [CAPABILITIES.CPU_ANALYSIS]));
  host.registerDeepProfile({
    profileId: 'generic-study', taskType: 'EXTERNAL_DEEP_TASK', owner: 'external-owner',
    requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], preferredLayer: 'L3', minimumLayer: 'L3', batchHint: { maxSliceUnits: 2 },
  });
  const r = host.deep.submit('generic-study', { dedupeKey: 'deep:1', units: units(3) }, executor());
  assert.equal(r.accepted, true);
  assert.equal(r.task.layer, 'L3');
  assert.equal(r.task.runtimeClass, 'DEEP');
  await d.drain();
  assert.equal(d.ledger.get(r.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
});

test('Deep Cognition borrows capacity, yields at checkpoint, parks and resumes', async () => {
  const gate = oneShotGate();
  const d = new WorkerDirector({ persistence: null, capacity: { CPU: 1 }, foregroundReserve: { CPU: 1 }, batch: { base: 1, max: 1 } });
  const host = new CognitiveRuntimeHost({ director: d });
  host.registerWorker(worker('deep', [CAPABILITIES.CPU_ANALYSIS]));
  host.registerDeepProfile({ profileId: 'deep', taskType: 'DEEP_GENERIC', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS] });
  const r = host.deep.submit('deep', { dedupeKey: 'deep:yield', units: units(3) }, executor(new Map(), { gate }));
  const cycle = d.runCycle();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(d.governor.snapshot().activeLeases, 1);
  d.beginGeneration({ correlationId: 'turn:deep-yield' });
  gate.release();
  await cycle;
  const parked = d.ledger.get(r.task.taskId);
  assert.equal(parked.executionStatus, EXECUTION_STATUS.PARKED);
  assert.equal(parked.lifecycleStatus, LIFECYCLE_STATUS.ELIGIBLE);
  assert.equal(parked.batch.completedUnitIds.length, 1);
  d.completeGeneration({ correlationId: 'turn:deep-yield' });
  await d.drain();
  assert.equal(d.ledger.get(r.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
});

test('persistent L0/L1/L2 arrivals do not permanently starve L3 when spare non-reserved capacity exists', async () => {
  const d = new WorkerDirector({ persistence: null, capacity: { CPU: 4 }, foregroundReserve: { CPU: 2 }, batch: { base: 1, max: 1 } });
  for (let i = 1; i <= 4; i += 1) d.registerWorker(worker(`w${i}`, [CAPABILITIES.CPU_ANALYSIS]));
  const deep = d.submit({ taskType: 'DEEP', owner: 'x', layer: 'L3', runtimeClass: 'DEEP', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dedupeKey: 'persistent-deep' }, { units: units(8, 'd'), ...executor() });
  for (let i = 0; i < 8; i += 1) {
    for (const layer of ['L0', 'L1', 'L2']) {
      d.submit({ taskType: `ARRIVAL_${layer}`, owner: 'x', layer, requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dedupeKey: `${layer}:${i}`, foreground: layer !== 'L2' }, { units: units(1, `${layer}${i}`), ...executor() });
    }
    await d.runCycle();
  }
  assert.ok(d.ledger.get(deep.task.taskId).batch.completedUnitIds.length > 0);
  await d.drain();
  assert.equal(d.ledger.get(deep.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
});

test('Sleep eligibility requires idle/due conditions and bounded backlog', async () => {
  const d = new WorkerDirector({ persistence: null });
  const host = new CognitiveRuntimeHost({ director: d, sleep: { idleCyclesRequired: 3, maxL2Backlog: 0, maxL3Backlog: 0 } });
  assert.equal(host.sleep.evaluate({ idleCycles: 1, maintenanceDue: true }).eligible, false);
  assert.equal(host.sleep.evaluate({ idleCycles: 3, maintenanceDue: false }).eligible, false);
  assert.equal(host.sleep.evaluate({ idleCycles: 3, maintenanceDue: true }).eligible, true);
  d.beginGeneration();
  assert.equal(host.sleep.evaluate({ idleCycles: 10, maintenanceDue: true }).eligible, false);
});

test('Sleep budget constrains worker resources and slice size', async () => {
  const d = new WorkerDirector({ persistence: null, capacity: { CPU: 1, GPU: 1 }, foregroundReserve: { CPU: 0, GPU: 1 }, batch: { base: 8, max: 8 } });
  const host = new CognitiveRuntimeHost({ director: d, sleep: { resourceBudget: { CPU: 1, GPU: 0 }, maxSliceUnits: 1, idleCyclesRequired: 0 } });
  host.registerWorker(worker('gpu-maint', ['MAINTAIN'], { resources: { GPU: 1 }, latency: 1 }));
  host.registerWorker(worker('cpu-maint', ['MAINTAIN'], { resources: { CPU: 1 }, latency: 20 }));
  host.registerSleepProfile({ profileId: 'maint', taskType: 'MAINT', requiredCapabilities: ['MAINTAIN'] });
  const r = host.sleep.submit('maint', { dedupeKey: 'maint:budget', units: units(3) }, executor(), { idleCycles: 0, maintenanceDue: true });
  await d.runCycle();
  const rec = d.ledger.get(r.task.taskId);
  assert.equal(rec.negotiation.workerId, 'cpu-maint');
  assert.equal(rec.batch.completedUnitIds.length, 1);
});

test('repeated maintenance due trigger dedupes instead of multiplying work', async () => {
  const d = new WorkerDirector({ persistence: null });
  const host = new CognitiveRuntimeHost({ director: d, sleep: { idleCyclesRequired: 0, maxOutstanding: 4 } });
  host.registerWorker(worker('w', ['MAINTAIN']));
  host.registerSleepProfile({ profileId: 'maint', taskType: 'MAINT', requiredCapabilities: ['MAINTAIN'] });
  const a = host.sleep.submit('maint', { dedupeKey: 'maint:same', units: units(2) }, executor(), { idleCycles: 0, maintenanceDue: true });
  const b = host.sleep.submit('maint', { dedupeKey: 'maint:same', units: units(2) }, executor(), { idleCycles: 0, maintenanceDue: true });
  assert.equal(a.accepted, true);
  assert.equal(b.deduped, true);
  assert.equal(a.task.taskId, b.task.taskId);
  assert.equal(d.ledger.list().length, 1);
});

test('Sleep work safely yields to generation and resumes without foreground delay', async () => {
  const d = new WorkerDirector({ persistence: null, capacity: { CPU: 2 }, foregroundReserve: { CPU: 1 }, batch: { base: 1, max: 1 } });
  const host = new CognitiveRuntimeHost({ director: d, sleep: { idleCyclesRequired: 0, maxSliceUnits: 1 } });
  host.registerWorker(worker('maint', ['MAINTAIN']));
  host.registerWorker(worker('fg', [CAPABILITIES.CPU_ANALYSIS]));
  host.registerSleepProfile({ profileId: 'maint', taskType: 'MAINT', requiredCapabilities: ['MAINTAIN'] });
  const sleep = host.sleep.submit('maint', { dedupeKey: 'sleep:preempt', units: units(4) }, executor(), { idleCycles: 0, maintenanceDue: true });
  await d.runCycle();
  d.beginGeneration({ turnId: 'turn:sleep' });
  const fg = d.submit({ taskType: 'FG', owner: 'x', layer: 'L1', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dedupeKey: 'sleep-fg', foreground: true }, { units: units(1, 'fg'), ...executor() });
  await d.runCycle();
  assert.equal(d.ledger.get(sleep.task.taskId).executionStatus, EXECUTION_STATUS.PARKED);
  await d.runCycle();
  assert.equal(d.ledger.get(fg.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
  d.completeGeneration({ turnId: 'turn:sleep' });
  await d.drain();
  assert.equal(d.ledger.get(sleep.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
});

test('external producer can host L2 post-turn work from GENERATION_COMPLETED', async () => {
  const d = new WorkerDirector({ persistence: null });
  const host = new CognitiveRuntimeHost({ director: d });
  host.registerWorker(worker('nearline', [CAPABILITIES.CPU_ANALYSIS]));
  host.registerProducer({ producerId: 'MEMORY', obligationType: 'POST_TURN_GENERIC', requestedLayer: 'L2', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS] });
  let created = null;
  host.producers.bindEvent({
    eventType: EVENT_TYPES.GENERATION_COMPLETED,
    producerId: 'MEMORY',
    mapEvent: (event) => ({ dedupeKey: `post:${event.correlationId}`, payload: { correlationId: event.correlationId }, units: units(1, 'post') }),
    executorFactory: () => executor(),
  });
  d.events.subscribe(EVENT_TYPES.WORK_ELIGIBLE, (event) => { if (event.taskId) created = event.taskId; });
  d.completeGeneration({ correlationId: 'turn:producer' });
  assert.ok(created);
  assert.equal(d.ledger.get(created).obligation.layer, 'L2');
  await d.drain();
  assert.equal(d.ledger.get(created).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
});

test('external producers can host L3 Lore-like and Reflection-like obligations without Runtime semantics', async () => {
  const d = new WorkerDirector({ persistence: null });
  const host = new CognitiveRuntimeHost({ director: d });
  host.registerWorker(worker('structured', [CAPABILITIES.STRUCTURED_LLM]));
  host.registerProducer({ producerId: 'LORE_OWNER', obligationType: 'OPAQUE_A', requestedLayer: 'L3', requiredCapabilities: [CAPABILITIES.STRUCTURED_LLM] });
  host.registerProducer({ producerId: 'MEMORY_OWNER', obligationType: 'OPAQUE_B', requestedLayer: 'L3', requiredCapabilities: [CAPABILITIES.STRUCTURED_LLM] });
  const a = host.producers.produce('LORE_OWNER', { dedupeKey: 'opaque:a', units: units(2, 'a') }, executor());
  const b = host.producers.produce('MEMORY_OWNER', { dedupeKey: 'opaque:b', units: units(2, 'b') }, executor());
  await d.drain();
  assert.equal(d.ledger.get(a.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
  assert.equal(d.ledger.get(b.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
});

test('capability negotiation prefers compatible higher version deterministically', async () => {
  const d = new WorkerDirector({ persistence: null, capacity: { CPU: 2 }, foregroundReserve: { CPU: 0 } });
  d.registerWorker(worker('v1', [], { capabilityDescriptors: [{ id: 'RERANK', version: 1 }], latency: 1 }));
  d.registerWorker(worker('v2', [], { capabilityDescriptors: [{ id: 'RERANK', version: 2 }], latency: 20 }));
  const r = d.submit({ taskType: 'rank', owner: 'x', layer: 'L1', capabilityRequests: [{ id: 'RERANK', minVersion: 1, preferredVersion: 2 }], dedupeKey: 'rank:v' }, { units: units(1), ...executor() });
  assert.equal(d.registry.discover({ capabilityId: 'RERANK', minVersion: 2 }).map((item) => item.workerId).includes('v2'), true);
  await d.runCycle();
  assert.equal(d.ledger.get(r.task.taskId).negotiation.workerId, 'v2');
});

test('dynamic provider disappearance selects same-capability alternate and recovery restores preferred provider', async () => {
  const d = new WorkerDirector({ persistence: null, capacity: { CPU: 1, GPU: 1 }, foregroundReserve: { CPU: 0, GPU: 0 } });
  d.registerWorker(worker('gpu', [], { capabilityDescriptors: [{ id: 'RERANK', version: 2 }], resources: { GPU: 1 }, latency: 1 }));
  d.registerWorker(worker('cpu', [], { capabilityDescriptors: [{ id: 'RERANK', version: 2 }], resources: { CPU: 1 }, latency: 10 }));
  d.setWorkerAvailability('gpu', false);
  const a = d.submit({ taskType: 'rank', owner: 'x', layer: 'L2', capabilityRequests: [{ id: 'RERANK', minVersion: 1, preferredVersion: 2 }], dedupeKey: 'rank:cpu' }, { units: units(1), ...executor() });
  await d.drain();
  assert.equal(d.ledger.get(a.task.taskId).negotiation.workerId, 'cpu');
  d.setWorkerAvailability('gpu', true);
  const b = d.submit({ taskType: 'rank', owner: 'x', layer: 'L2', capabilityRequests: [{ id: 'RERANK', minVersion: 1, preferredVersion: 2 }], dedupeKey: 'rank:gpu' }, { units: units(1), ...executor() });
  await d.drain();
  assert.equal(d.ledger.get(b.task.taskId).negotiation.workerId, 'gpu');
});

test('declared fallback capability executes degraded when primary capability is unavailable', async () => {
  const d = new WorkerDirector({ persistence: null });
  d.registerWorker(worker('det', ['DETERMINISTIC_RANK']));
  const r = d.submit({
    taskType: 'rank', owner: 'x', layer: 'L2', capabilityRequests: [{ id: 'RERANK', minVersion: 2 }],
    fallbackCapabilitySets: [[{ id: 'DETERMINISTIC_RANK', minVersion: 1 }]], dedupeKey: 'rank:fallback',
  }, { units: units(1), ...executor() });
  await d.drain();
  const rec = d.ledger.get(r.task.taskId);
  assert.equal(rec.degradation.degraded, true);
  assert.equal(rec.degradation.fallbackUsed, true);
  assert.equal(rec.negotiation.workerId, 'det');
  assert.ok(d.telemetry.list({ type: 'CAPABILITY_FALLBACK' }).length > 0);
});

test('required service dependency blocks without cancelling and resumes when service appears', async () => {
  const d = new WorkerDirector({ persistence: null });
  d.registerWorker(worker('w', [CAPABILITIES.CPU_ANALYSIS]));
  const r = d.submit({ taskType: 'dep', owner: 'x', layer: 'L2', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], serviceDependencies: [{ id: 'GRAPH_SERVICE', required: true }], dedupeKey: 'dep:req' }, { units: units(1), ...executor() });
  await d.runCycle();
  assert.equal(d.ledger.get(r.task.taskId).executionStatus, EXECUTION_STATUS.BLOCKED);
  assert.equal(d.ledger.get(r.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.ELIGIBLE);
  d.registerService({ serviceId: 'GRAPH_SERVICE', available: true });
  await d.drain();
  assert.equal(d.ledger.get(r.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
});

test('optional dependency absence marks degraded but remains executable, later work uses richer path', async () => {
  const d = new WorkerDirector({ persistence: null });
  d.registerWorker(worker('w', [CAPABILITIES.CPU_ANALYSIS]));
  const spec = { taskType: 'optional', owner: 'x', layer: 'L3', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], serviceDependencies: [{ id: 'ENRICHMENT', required: false }] };
  const a = d.submit({ ...spec, dedupeKey: 'opt:a' }, { units: units(1), ...executor() });
  await d.drain();
  assert.equal(d.ledger.get(a.task.taskId).degradation.degraded, true);
  d.registerService({ serviceId: 'ENRICHMENT', available: true });
  const b = d.submit({ ...spec, dedupeKey: 'opt:b' }, { units: units(1), ...executor() });
  await d.drain();
  assert.equal(d.ledger.get(b.task.taskId).degradation.degraded, false);
});


test('service dependency startup validation distinguishes required and optional missing services', async () => {
  const d = new WorkerDirector({ persistence: null });
  d.registerService({ serviceId: 'HOST', dependencies: [{ id: 'REQ', required: true }, { id: 'OPT', required: false }] });
  let validation = d.dependencies.validateRuntime();
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.missingRequired, [{ serviceId: 'HOST', dependencyId: 'REQ' }]);
  assert.deepEqual(validation.missingOptional, [{ serviceId: 'HOST', dependencyId: 'OPT' }]);
  d.registerService({ serviceId: 'REQ', available: true });
  validation = d.dependencies.validateRuntime();
  assert.equal(validation.ok, true);
  assert.equal(validation.missingRequired.length, 0);
  assert.equal(validation.missingOptional.length, 1);
});

test('circular service dependency declarations are rejected with explicit diagnostics', async () => {
  const d = new WorkerDirector({ persistence: null });
  d.registerService({ serviceId: 'A', dependencies: [{ id: 'B', required: true }] });
  assert.throws(() => d.registerService({ serviceId: 'B', dependencies: [{ id: 'A', required: true }] }), /Circular dependency rejected/);
  assert.ok(d.telemetry.list({ type: 'DEPENDENCY_CYCLE_REJECTED' }).length > 0);
});

test('extensible event registry accepts a future type without Event Spine kernel changes', async () => {
  const d = new WorkerDirector({ persistence: null });
  d.registerEventType({ eventType: 'FUTURE_UNKNOWN_EVENT', schemaVersion: '1.0', producer: 'FUTURE_SUBSYSTEM', payloadSchema: { required: ['entityId'], properties: { entityId: 'string' }, allowUnknown: true } });
  const event = d.events.emit('FUTURE_UNKNOWN_EVENT', { entityId: 'x', unknownOptional: 7 }, { schemaVersion: '1.0', producer: 'FUTURE_SUBSYSTEM', correlationId: 'c', causationId: 'root', dedupeKey: 'e1' });
  assert.equal(event.eventType, 'FUTURE_UNKNOWN_EVENT');
  assert.equal(event.schemaVersion, '1.0');
  assert.equal(event.producer, 'FUTURE_SUBSYSTEM');
});

test('event registry rejects unsupported major versions, duplicate registration, and malformed payloads', async () => {
  const d = new WorkerDirector({ persistence: null });
  d.registerEventType({ eventType: 'VERSIONED', schemaVersion: '1.0', producer: 'X', payloadSchema: { required: ['id'], properties: { id: 'string' }, allowUnknown: true } });
  assert.throws(() => d.registerEventType({ eventType: 'VERSIONED', schemaVersion: '1.0', producer: 'X' }), /already registered/);
  assert.throws(() => d.events.emit('UNREGISTERED_FUTURE_EVENT', {}, { schemaVersion: '1.0' }), /Event rejected/);
  assert.throws(() => d.events.emit('VERSIONED', { id: 'x' }, { schemaVersion: '2.0' }), /Event rejected/);
  assert.throws(() => d.events.emit('VERSIONED', { id: 3 }, { schemaVersion: '1.0' }), /Event rejected/);
  assert.ok(d.telemetry.list({ type: 'EVENT_REGISTRATION_FAILED' }).length >= 2);
});

test('versioned Event Spine keeps correlation/causation and dedupe identity stable', async () => {
  const d = new WorkerDirector({ persistence: null });
  d.registerEventType({ eventType: 'CUSTOM', schemaVersion: '1.0', producer: 'X' });
  const a = d.events.emit('CUSTOM', {}, { schemaVersion: '1.0', correlationId: 'corr', causationId: 'cause', dedupeKey: 'same' });
  const b = d.events.emit('CUSTOM', { ignored: true }, { schemaVersion: '1.0', correlationId: 'corr', causationId: 'cause', dedupeKey: 'same' });
  assert.equal(a.eventId, b.eventId);
  assert.equal(a.correlationId, 'corr');
  assert.equal(a.causationId, 'cause');
});

test('synthetic future subsystem registers event, producer, optional dependency and completes L3 work generically', async () => {
  const d = new WorkerDirector({ persistence: null, capacity: { CPU: 1 }, foregroundReserve: { CPU: 1 }, batch: { base: 1, max: 1 } });
  const host = new CognitiveRuntimeHost({ director: d });
  host.registerWorker(worker('economy-worker', [CAPABILITIES.CPU_ANALYSIS]));
  host.registerEventType({ eventType: 'WORLD_ECONOMY_TICK', schemaVersion: '1.0', producer: 'WORLD_ECONOMY', payloadSchema: { required: ['revision'], properties: { revision: 'number' }, allowUnknown: true } });
  host.registerProducer({ producerId: 'WORLD_ECONOMY', obligationType: 'ECONOMY_RECONCILE', requestedLayer: 'L3', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], serviceDependencies: [{ id: 'MARKET_ENRICHMENT', required: false }], resultContract: { requestedDestination: 'BACKGROUND', resultClass: 'DEFERRED', payloadClass: 'DERIVED_DATA', resultType: 'WORLD_ECONOMY_RESULT' } });
  let taskId = null;
  host.producers.bindEvent({
    eventType: 'WORLD_ECONOMY_TICK', producerId: 'WORLD_ECONOMY',
    mapEvent: (event) => ({ dedupeKey: `economy:${event.payload.revision}`, revision: event.payload.revision, units: units(3, 'econ'), payload: { correlationId: event.correlationId } }),
    executorFactory: () => executor(),
  });
  d.events.subscribe(EVENT_TYPES.WORK_ELIGIBLE, (event) => { if (d.ledger.get(event.taskId)?.obligation.producerId === 'WORLD_ECONOMY') taskId = event.taskId; });
  d.events.emit('WORLD_ECONOMY_TICK', { revision: 1 }, { schemaVersion: '1.0', correlationId: 'world:1', dedupeKey: 'tick:1' });
  await d.runCycle();
  assert.ok(taskId);
  assert.equal(d.ledger.get(taskId).degradation.degraded, true);
  assert.equal(d.ledger.get(taskId).obligation.resultContract.requestedDestination, 'BACKGROUND');
  d.beginGeneration({ correlationId: 'world:gen' });
  await d.runCycle();
  assert.equal(d.ledger.get(taskId).executionStatus, EXECUTION_STATUS.PARKED);
  d.completeGeneration({ correlationId: 'world:gen' });
  await d.drain();
  assert.equal(d.ledger.get(taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
});

test('completion seam marks late result truthfully without mutating sealed context', async () => {
  const results = [];
  const d = new WorkerDirector({ persistence: null, isTurnSealed: (turnId) => turnId === 'sealed-turn', resultSink: (result) => results.push(result) });
  d.registerWorker(worker('w', [CAPABILITIES.CPU_ANALYSIS]));
  const declaredResult = { requestedDestination: 'FOREGROUND', resultClass: 'OPPORTUNISTIC', payloadClass: 'DERIVED_DATA', resultType: 'FUTURE_RESULT' };
  const r = d.submit({ taskType: 'late', owner: 'x', layer: 'L2', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dedupeKey: 'late', resultContract: declaredResult, payload: { turnId: 'sealed-turn', correlationId: 'corr' }, worldRevision: 4, sceneRevision: 9 }, { units: units(1), ...executor() });
  await d.drain();
  assert.equal(results.length, 1);
  assert.equal(results[0].taskId, r.task.taskId);
  assert.equal(results[0].late, true);
  assert.equal(results[0].worldRevision, 4);
  assert.equal(results[0].sceneRevision, 9);
  assert.deepEqual(results[0].resultContract, declaredResult);
});

test('required dependency state recovers across reload without duplicate obligation', async () => {
  const persistence = new MemoryPersistenceAdapter();
  const first = new WorkerDirector({ persistence });
  first.registerWorker(worker('w', [CAPABILITIES.CPU_ANALYSIS]));
  const r = first.submit({ taskType: 'dep-reload', owner: 'x', layer: 'L3', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], serviceDependencies: [{ id: 'SERVICE', required: true }], dedupeKey: 'dep:reload' }, { units: units(1), ...executor() });
  await first.runCycle();
  assert.equal(first.ledger.get(r.task.taskId).executionStatus, EXECUTION_STATUS.BLOCKED);
  const second = new WorkerDirector({ persistence });
  second.registerWorker(worker('w2', [CAPABILITIES.CPU_ANALYSIS]));
  second.attachExecutor(r.task.taskId, executor());
  await second.runCycle();
  assert.equal(second.ledger.get(r.task.taskId).executionStatus, EXECUTION_STATUS.BLOCKED);
  second.registerService({ serviceId: 'SERVICE', available: true });
  await second.drain();
  assert.equal(second.ledger.get(r.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
  assert.equal(second.ledger.list().length, 1);
});

test('L3 and L4 committed progress survives reload without replay', async () => {
  for (const layer of ['L3', 'L4']) {
    const persistence = new MemoryPersistenceAdapter();
    const commits = new Map();
    const first = new WorkerDirector({ persistence, capacity: { CPU: 1 }, foregroundReserve: { CPU: 0 }, batch: { base: 1, max: 1 } });
    first.registerWorker(worker(`w-${layer}`, [CAPABILITIES.CPU_ANALYSIS]));
    const r = first.submit({ taskType: `reload-${layer}`, owner: 'x', layer, runtimeClass: layer === 'L4' ? 'SLEEP' : 'DEEP', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dedupeKey: `reload:${layer}` }, { units: units(3, layer), ...executor(commits) });
    await first.runCycle();
    const firstSlice = first.ledger.get(r.task.taskId).batch.completedSliceIds[0];
    const second = new WorkerDirector({ persistence, capacity: { CPU: 1 }, foregroundReserve: { CPU: 0 }, batch: { base: 1, max: 1 } });
    second.registerWorker(worker(`w2-${layer}`, [CAPABILITIES.CPU_ANALYSIS]));
    second.attachExecutor(r.task.taskId, executor(commits));
    second.recoverTask(r.task.taskId);
    await second.drain();
    const rec = second.ledger.get(r.task.taskId);
    assert.equal(rec.lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
    assert.equal(rec.batch.completedSliceIds.filter((id) => id === firstSlice).length, 1);
  }
});

test('integrated Wave 2 hosting scenario', async () => {
  const persistence = new MemoryPersistenceAdapter();
  const commits = new Map();
  const d = new WorkerDirector({ persistence, capacity: { CPU: 3, STRUCTURED_LLM: 1 }, foregroundReserve: { CPU: 1, STRUCTURED_LLM: 1 }, batch: { base: 1, max: 2 } });
  const host = new CognitiveRuntimeHost({ director: d, sleep: { idleCyclesRequired: 2, maxL2Backlog: 0, maxL3Backlog: 0, resourceBudget: { CPU: 1 }, maxSliceUnits: 1 } });
  host.registerWorker(worker('deep-llm', [], { capabilityDescriptors: [{ id: 'STRUCTURED_LLM', version: 3 }], resources: { CPU: 1, STRUCTURED_LLM: 1 }, latency: 20 }));
  host.registerWorker(worker('cpu', [CAPABILITIES.CPU_ANALYSIS], { capacity: 2 }));
  host.registerWorker(worker('fallback', ['ECONOMY_BASIC']));
  host.registerDeepProfile({ profileId: 'external-study', taskType: 'EXTERNAL_STUDY', capabilityRequests: [{ id: 'STRUCTURED_LLM', minVersion: 2, preferredVersion: 3 }], preferredLayer: 'L3', minimumLayer: 'L3' });
  const study = host.deep.submit('external-study', { dedupeKey: 'study:wave2', units: units(4, 'study'), sourceRevisions: { book: 1 }, worldRevision: 10, sceneRevision: 2 }, executor(commits));
  await d.runCycle();

  host.registerEventType({ eventType: 'WORLD_ECONOMY_TICK', schemaVersion: '1.0', producer: 'WORLD_ECONOMY', payloadSchema: { required: ['revision'], properties: { revision: 'number' }, allowUnknown: true } });
  host.registerProducer({ producerId: 'WORLD_ECONOMY', obligationType: 'ECONOMY_JOB', requestedLayer: 'L3', capabilityRequests: [{ id: 'ECONOMY_RICH', minVersion: 1 }], fallbackCapabilitySets: [[{ id: 'ECONOMY_BASIC', minVersion: 1 }]], serviceDependencies: [{ id: 'MARKET_ENRICHMENT', required: false }] });
  let economyTask = null;
  host.producers.bindEvent({
    eventType: 'WORLD_ECONOMY_TICK', producerId: 'WORLD_ECONOMY',
    mapEvent: (event) => ({ dedupeKey: `economy:${event.payload.revision}`, revision: event.payload.revision, units: units(3, 'econ'), payload: { correlationId: event.correlationId } }),
    executorFactory: () => executor(commits),
  });
  d.events.subscribe(EVENT_TYPES.WORK_ELIGIBLE, (event) => { if (d.ledger.get(event.taskId)?.obligation.producerId === 'WORLD_ECONOMY') economyTask = event.taskId; });
  d.events.emit('WORLD_ECONOMY_TICK', { revision: 1 }, { schemaVersion: '1.0', correlationId: 'economy:1', dedupeKey: 'economy-event:1' });
  await d.runCycle();
  assert.ok(economyTask);
  assert.equal(d.ledger.get(economyTask).degradation.degraded, true);

  d.beginGeneration({ correlationId: 'turn:wave2' });
  await d.runCycle();
  assert.equal(d.ledger.get(study.task.taskId).executionStatus, EXECUTION_STATUS.PARKED);
  assert.equal(d.ledger.get(economyTask).executionStatus, EXECUTION_STATUS.PARKED);

  const fg = d.submit({ taskType: 'FOREGROUND', owner: 'truth', layer: 'L1', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dedupeKey: 'wave2:fg', foreground: true }, { units: units(1, 'fg'), ...executor(commits) });
  await d.runCycle();
  assert.equal(d.ledger.get(fg.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);

  host.registerProducer({ producerId: 'MEMORY', obligationType: 'POST_TURN', requestedLayer: 'L2', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS] });
  let nearlineTask = null;
  host.producers.bindEvent({
    eventType: EVENT_TYPES.GENERATION_COMPLETED, producerId: 'MEMORY',
    mapEvent: (event) => ({ dedupeKey: `near:${event.correlationId}`, units: units(1, 'near'), payload: { correlationId: event.correlationId } }),
    executorFactory: () => executor(commits),
  });
  d.completeGeneration({ correlationId: 'turn:wave2' });
  nearlineTask = d.ledger.list().find((record) => record.obligation.producerId === 'MEMORY')?.taskId;
  assert.ok(nearlineTask);
  await d.runCycle();
  assert.equal(d.ledger.get(nearlineTask).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);

  d.registerService({ serviceId: 'MARKET_ENRICHMENT', available: true });
  d.registerWorker(worker('economy-rich', [], { capabilityDescriptors: [{ id: 'ECONOMY_RICH', version: 1 }], latency: 2 }));
  await d.drain();
  assert.equal(d.ledger.get(study.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
  assert.equal(d.ledger.get(economyTask).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);

  host.registerSleepProfile({ profileId: 'maintenance', taskType: 'GENERIC_MAINTENANCE', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS] });
  const sleep = host.sleep.submit('maintenance', { dedupeKey: 'sleep:wave2', units: units(3, 'sleep') }, executor(commits), { idleCycles: 3, maintenanceDue: true });
  await d.runCycle();
  d.beginGeneration({ correlationId: 'turn:wave2:2' });
  await d.runCycle();
  assert.equal(d.ledger.get(sleep.task.taskId).executionStatus, EXECUTION_STATUS.PARKED);

  const committedBeforeReload = [...d.ledger.get(sleep.task.taskId).batch.completedSliceIds];
  const restored = new WorkerDirector({ persistence, capacity: { CPU: 3, STRUCTURED_LLM: 1 }, foregroundReserve: { CPU: 1, STRUCTURED_LLM: 1 }, batch: { base: 1, max: 2 } });
  restored.registerWorker(worker('cpu-restored', [CAPABILITIES.CPU_ANALYSIS], { capacity: 2 }));
  restored.attachExecutor(sleep.task.taskId, executor(commits));
  restored.resumeParked();
  await restored.drain();
  const restoredSleep = restored.ledger.get(sleep.task.taskId);
  assert.equal(restoredSleep.lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
  assert.ok(committedBeforeReload.every((id) => restoredSleep.batch.completedSliceIds.filter((x) => x === id).length === 1));
});


test('Sleep outstanding-work budget defers new maintenance but still dedupes an existing obligation', async () => {
  const d = new WorkerDirector({ persistence: null });
  const host = new CognitiveRuntimeHost({ director: d, sleep: { idleCyclesRequired: 0, maxOutstanding: 1 } });
  host.registerWorker(worker('w', ['MAINTAIN']));
  host.registerSleepProfile({ profileId: 'maint-budget', taskType: 'MAINT', requiredCapabilities: ['MAINTAIN'] });
  const first = host.sleep.submit('maint-budget', { dedupeKey: 'budget:first', units: units(2) }, executor(), { idleCycles: 0, maintenanceDue: true });
  const second = host.sleep.submit('maint-budget', { dedupeKey: 'budget:second', units: units(1) }, executor(), { idleCycles: 0, maintenanceDue: true });
  const duplicate = host.sleep.submit('maint-budget', { dedupeKey: 'budget:first', units: units(2) }, executor(), { idleCycles: 0, maintenanceDue: true });
  assert.equal(first.accepted, true);
  assert.equal(second.deferred, true);
  assert.match(second.reason, /maintenance-budget/);
  assert.equal(duplicate.deduped, true);
  assert.equal(duplicate.task.taskId, first.task.taskId);
});

test('task dependency cycles are rejected rather than silently deadlocking', async () => {
  const d = new WorkerDirector({ persistence: null });
  d.registerWorker(worker('w', [CAPABILITIES.CPU_ANALYSIS]));
  const a = d.submit({ taskId: 'task-A', taskType: 'A', owner: 'x', layer: 'L2', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dependencies: ['task-B'], dedupeKey: 'cycle:A' }, { units: units(1, 'a'), ...executor() });
  assert.equal(a.accepted, true);
  const b = d.submit({ taskId: 'task-B', taskType: 'B', owner: 'x', layer: 'L2', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dependencies: ['task-A'], dedupeKey: 'cycle:B' }, { units: units(1, 'b'), ...executor() });
  assert.equal(b.accepted, false);
  assert.equal(b.reason, 'dependency-cycle');
  assert.ok(d.telemetry.list({ type: 'DEPENDENCY_CYCLE_REJECTED' }).length > 0);
});

test('Wave 2 telemetry covers Deep, Sleep, dependency block, degradation, fallback, event failure and starvation', async () => {
  const d = new WorkerDirector({ persistence: null, capacity: { CPU: 1 }, foregroundReserve: { CPU: 0 }, batch: { base: 1, max: 1 } });
  const host = new CognitiveRuntimeHost({ director: d, sleep: { idleCyclesRequired: 0, maxL3Backlog: 10 } });
  host.registerWorker(worker('cpu', [CAPABILITIES.CPU_ANALYSIS, 'FALLBACK']));
  host.registerDeepProfile({ profileId: 'telemetry-deep', taskType: 'DEEP', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS] });
  const deep = host.deep.submit('telemetry-deep', { dedupeKey: 'telemetry:deep', units: units(1) }, executor());
  await d.drain();
  assert.equal(d.ledger.get(deep.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);

  host.registerSleepProfile({ profileId: 'telemetry-sleep', taskType: 'SLEEP', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS] });
  const sleep = host.sleep.submit('telemetry-sleep', { dedupeKey: 'telemetry:sleep', units: units(1) }, executor(), { idleCycles: 0, maintenanceDue: true });
  await d.drain();
  assert.equal(d.ledger.get(sleep.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);

  d.submit({ taskType: 'BLOCKED', owner: 'x', layer: 'L3', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], serviceDependencies: [{ id: 'MISSING', required: true }], dedupeKey: 'telemetry:blocked' }, { units: units(1), ...executor() });
  await d.runCycle();

  const fallback = d.submit({ taskType: 'FALLBACK', owner: 'x', layer: 'L2', capabilityRequests: [{ id: 'PRIMARY', minVersion: 1 }], fallbackCapabilitySets: [[{ id: 'FALLBACK', minVersion: 1 }]], dedupeKey: 'telemetry:fallback' }, { units: units(1), ...executor() });
  await d.drain();
  assert.equal(d.ledger.get(fallback.task.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);

  d.registerEventType({ eventType: 'TELEMETRY_EVENT', schemaVersion: '1.0', producer: 'TEST' });
  assert.throws(() => d.registerEventType({ eventType: 'TELEMETRY_EVENT', schemaVersion: '1.0', producer: 'TEST' }));

  const starving = d.submit({ taskType: 'STARVE', owner: 'x', layer: 'L4', priority: 50, requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dedupeKey: 'telemetry:starve' }, { units: units(1), ...executor() });
  for (let i = 0; i < 24 && d.ledger.get(starving.task.taskId).lifecycleStatus !== LIFECYCLE_STATUS.SATISFIED; i += 1) {
    d.submit({ taskType: 'L2', owner: 'x', layer: 'L2', priority: 50, requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dedupeKey: `telemetry:l2:${i}` }, { units: units(1, `n${i}`), ...executor() });
    await d.runCycle();
  }
  const types = new Set(d.telemetry.list().map((signal) => signal.type));
  for (const expected of ['DEEP_ACTIVE', 'SLEEP_ACTIVE', 'DEPENDENCY_BLOCKED', 'DEGRADED_EXECUTION', 'CAPABILITY_FALLBACK', 'EVENT_REGISTRATION_FAILED', 'STARVATION_PROTECTION']) {
    assert.ok(types.has(expected), `missing telemetry signal ${expected}`);
  }
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
console.log(`\nRuntime Fabric Wave 2 deterministic suite: ${passed}/${tests.length} PASS`);
