import assert from 'node:assert/strict';
import {
  CAPABILITIES,
  CognitiveRuntimeHost,
  LIFECYCLE_STATUS,
  MemoryPersistenceAdapter,
  WorkerDirector,
} from '../src/runtime/index.js';

const TOTAL = 5200;
const BOUND = 1000;
const committed = new Set();
let duplicateCommitAttempts = 0;
let commitAttempts = 0;
const signalCounts = new Map();
const countSignal = (signal) => signalCounts.set(signal.type, (signalCounts.get(signal.type) ?? 0) + 1);

function exec() {
  return {
    async execute({ units }) { return units.map((u) => u.payload); },
    validate() { return true; },
    commit({ idempotencyKey }) {
      commitAttempts += 1;
      if (committed.has(idempotencyKey)) duplicateCommitAttempts += 1;
      committed.add(idempotencyKey);
      return { ok: true };
    },
  };
}

function worker(workerId, capabilities, options = {}) {
  return {
    workerId,
    capabilities,
    capabilityDescriptors: options.capabilityDescriptors,
    supportedLayers: ['L0', 'L1', 'L2', 'L3', 'L4'],
    resourceProfile: options.resources ?? { CPU: 1 },
    concurrencyCapacity: options.capacity ?? 1,
    latencyScore: options.latency ?? 10,
    qualityScore: options.quality ?? 0,
    provider: options.provider ?? workerId,
  };
}

const d = new WorkerDirector({
  persistence: null,
  maxOutstanding: BOUND,
  capacity: { CPU: 6, GPU: 1, IO: 2, GRAPH: 2, STRUCTURED_LLM: 1 },
  foregroundReserve: { CPU: 2, GPU: 1, IO: 0, GRAPH: 0, STRUCTURED_LLM: 1 },
  batch: { base: 2, max: 4 },
  telemetrySink: countSignal,
});
const host = new CognitiveRuntimeHost({ director: d, sleep: { idleCyclesRequired: 0, maxL3Backlog: 100, maxOutstanding: 50, maxSliceUnits: 1, resourceBudget: { CPU: 1, IO: 1 } } });

host.registerWorker(worker('cpu-a', [CAPABILITIES.CPU_ANALYSIS], { capacity: 2, latency: 8 }));
host.registerWorker(worker('cpu-b', [CAPABILITIES.CPU_ANALYSIS], { capacity: 2, latency: 12 }));
host.registerWorker(worker('rerank-gpu', [], { capabilityDescriptors: [{ id: 'RERANK', version: 2, qualityScore: 2 }], resources: { GPU: 1 }, latency: 1 }));
host.registerWorker(worker('rerank-cpu', [], { capabilityDescriptors: [{ id: 'RERANK', version: 1 }], resources: { CPU: 1 }, latency: 15 }));
host.registerWorker(worker('graph', [CAPABILITIES.GRAPH], { resources: { GRAPH: 1 }, capacity: 2 }));
host.registerWorker(worker('io', [CAPABILITIES.IO], { resources: { IO: 1 }, capacity: 2 }));
host.registerWorker(worker('llm-v3', [], { capabilityDescriptors: [{ id: 'STRUCTURED_LLM', version: 3 }], resources: { CPU: 1, STRUCTURED_LLM: 1 }, latency: 25 }));
host.registerWorker(worker('fallback', ['DETERMINISTIC_FALLBACK'], { resources: { CPU: 1 }, latency: 5 }));

host.registerService({ serviceId: 'REQUIRED_GRAPH_SERVICE', available: false });
host.registerService({ serviceId: 'OPTIONAL_ENRICHMENT', available: false });

host.registerEventType({
  eventType: 'WORLD_ECONOMY_STRESS', schemaVersion: '1.0', producer: 'WORLD_ECONOMY',
  payloadSchema: { required: ['revision'], properties: { revision: 'number' }, allowUnknown: true },
});
host.registerProducer({
  producerId: 'WORLD_ECONOMY', obligationType: 'WORLD_ECONOMY_JOB', requestedLayer: 'L3',
  requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS],
  serviceDependencies: [{ id: 'OPTIONAL_ENRICHMENT', required: false }],
});
host.producers.bindEvent({
  eventType: 'WORLD_ECONOMY_STRESS', producerId: 'WORLD_ECONOMY',
  mapEvent: (event) => ({
    dedupeKey: `economy:${event.payload.revision}`,
    conflictKey: `economy-region:${event.payload.revision % 37}`,
    revision: event.payload.revision,
    units: [{ id: `economy:${event.payload.revision}:u`, payload: event.payload.revision }],
    payload: { correlationId: event.correlationId },
  }),
  executorFactory: () => exec(),
});

let accepted = 0;
let rejected = 0;
let deduped = 0;
let eventCount = 0;
let maxOpen = 0;

for (let i = 0; i < TOTAL; i += 1) {
  if (i === 1500) d.setWorkerAvailability('rerank-gpu', false);
  if (i === 2300) d.setWorkerAvailability('rerank-gpu', true);
  if (i === 2000) d.setServiceAvailability('REQUIRED_GRAPH_SERVICE', true);
  if (i === 3000) d.setServiceAvailability('OPTIONAL_ENRICHMENT', true);

  const mod = i % 5;
  const layer = mod === 0 ? 'L0' : mod === 1 ? 'L1' : mod === 2 ? 'L2' : mod === 3 ? 'L3' : 'L4';
  let capabilityFields;
  if (i % 19 === 0) {
    capabilityFields = {
      capabilityRequests: [{ id: 'RERANK', minVersion: i % 38 === 0 ? 2 : 1, preferredVersion: 2 }],
      fallbackCapabilitySets: [[{ id: 'DETERMINISTIC_FALLBACK', minVersion: 1 }]],
    };
  } else if (i % 17 === 0) {
    capabilityFields = { requiredCapabilities: [CAPABILITIES.GRAPH] };
  } else if (i % 13 === 0) {
    capabilityFields = { capabilityRequests: [{ id: 'STRUCTURED_LLM', minVersion: 3, preferredVersion: 3 }] };
  } else if (i % 11 === 0) {
    capabilityFields = { requiredCapabilities: [CAPABILITIES.IO] };
  } else {
    capabilityFields = { requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS] };
  }

  const serviceDependencies = [];
  if (i % 29 === 0) serviceDependencies.push({ id: 'REQUIRED_GRAPH_SERVICE', required: true });
  if (i % 7 === 0) serviceDependencies.push({ id: 'OPTIONAL_ENRICHMENT', required: false });

  const duplicateBase = i > 0 && i % 101 === 0 ? i - 1 : i;
  const result = d.submit({
    taskType: `STRESS_${i % 23}`,
    owner: 'stress',
    layer,
    runtimeClass: layer === 'L3' ? 'DEEP' : layer === 'L4' ? 'SLEEP' : null,
    ...capabilityFields,
    serviceDependencies,
    dedupeKey: `stress:${duplicateBase}`,
    conflictKey: i % 31 === 0 ? `conflict:${i % 97}` : null,
    revision: i,
    foreground: layer === 'L0' || layer === 'L1',
    speculative: layer === 'L4' && i % 3 === 0,
    batchHint: layer === 'L4' ? { maxSliceUnits: 1 } : { maxSliceUnits: 2 },
    priority: layer === 'L0' ? 0 : layer === 'L1' ? 10 : 50,
  }, {
    units: Array.from({ length: layer === 'L3' || layer === 'L4' ? 2 : 1 }, (_, j) => ({ id: `${i}:u${j}`, payload: i })),
    ...exec(),
  });
  if (result.accepted) accepted += 1;
  else rejected += 1;
  if (result.deduped) deduped += 1;

  if (i % 9 === 0) {
    try {
      d.events.emit('WORLD_ECONOMY_STRESS', { revision: i, extra: 'storm' }, { schemaVersion: '1.0', correlationId: `event:${i}`, dedupeKey: `event:${i}` });
      eventCount += 1;
    } catch {
      // Backpressure from producer submission is handled by Runtime, event delivery itself remains valid.
    }
  }

  if (i % 73 === 0) {
    d.beginGeneration({ correlationId: `gen:${i}` });
    await d.runCycle();
    d.completeGeneration({ correlationId: `gen:${i}` });
  }
  if (i % 37 === 0) await d.runCycle();

  const open = d.lifecycle.listOpen().length;
  maxOpen = Math.max(maxOpen, open);
  assert.ok(open <= BOUND, `outstanding bound exceeded: ${open}`);
}

// Restore all temporarily missing runtime dependencies/providers and drain.
d.setWorkerAvailability('rerank-gpu', true);
d.setServiceAvailability('REQUIRED_GRAPH_SERVICE', true);
d.setServiceAvailability('OPTIONAL_ENRICHMENT', true);
await d.drain({ maxCycles: 20000 });

const records = d.ledger.list();
const satisfied = records.filter((r) => r.lifecycleStatus === LIFECYCLE_STATUS.SATISFIED);
const superseded = records.filter((r) => r.lifecycleStatus === LIFECYCLE_STATUS.SUPERSEDED);
const cancelled = records.filter((r) => r.lifecycleStatus === LIFECYCLE_STATUS.CANCELLED);
const completedByLayer = Object.fromEntries(['L0', 'L1', 'L2', 'L3', 'L4'].map((layer) => [layer, satisfied.filter((r) => r.obligation.layer === layer).length]));

assert.ok(maxOpen <= BOUND);
assert.equal(d.lifecycle.listOpen().length, 0, 'stress must drain without deadlock');
assert.equal(duplicateCommitAttempts, 0, 'irreversible commit idempotency key replayed');
assert.ok(completedByLayer.L0 > 0 && completedByLayer.L1 > 0, 'foreground work must complete');
assert.ok(completedByLayer.L3 > 0 && completedByLayer.L4 > 0, 'Deep/Sleep work must make progress');
assert.ok((signalCounts.get('CAPABILITY_FALLBACK') ?? 0) > 0, 'capability fallback was not exercised');
assert.ok((signalCounts.get('DEGRADED_EXECUTION') ?? 0) > 0, 'degraded execution was not exercised');
assert.ok((signalCounts.get('WORK_YIELD_REQUESTED') ?? 0) > 0, 'generation preemption was not exercised');
assert.ok(eventCount >= 500, 'event storm target was not exercised');

// Separate durable reload probe so persistence-copy cost does not distort scheduler stress.
const persistence = new MemoryPersistenceAdapter();
const reloadCommits = new Set();
const reloadExec = {
  async execute({ units }) { return units.map((u) => u.payload); },
  validate() { return true; },
  commit({ idempotencyKey }) {
    assert.equal(reloadCommits.has(idempotencyKey), false, `reload replayed ${idempotencyKey}`);
    reloadCommits.add(idempotencyKey);
  },
};
const before = new WorkerDirector({ persistence, capacity: { CPU: 1 }, foregroundReserve: { CPU: 0 }, batch: { base: 1, max: 1 } });
before.registerWorker(worker('reload-worker', [CAPABILITIES.CPU_ANALYSIS]));
const reloadDeep = before.submit({ taskType: 'RELOAD_DEEP', owner: 'stress', layer: 'L3', runtimeClass: 'DEEP', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dedupeKey: 'reload:deep' }, { units: [{ id: 'rd0', payload: 0 }, { id: 'rd1', payload: 1 }], ...reloadExec });
const reloadSleep = before.submit({ taskType: 'RELOAD_SLEEP', owner: 'stress', layer: 'L4', runtimeClass: 'SLEEP', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dedupeKey: 'reload:sleep' }, { units: [{ id: 'rs0', payload: 0 }, { id: 'rs1', payload: 1 }], ...reloadExec });
await before.runCycle();
await before.runCycle();
const deepSlices = [...before.ledger.get(reloadDeep.task.taskId).batch.completedSliceIds];
const sleepSlices = [...before.ledger.get(reloadSleep.task.taskId).batch.completedSliceIds];
const after = new WorkerDirector({ persistence, capacity: { CPU: 1 }, foregroundReserve: { CPU: 0 }, batch: { base: 1, max: 1 } });
after.registerWorker(worker('reload-worker-2', [CAPABILITIES.CPU_ANALYSIS]));
after.attachExecutor(reloadDeep.task.taskId, reloadExec);
after.attachExecutor(reloadSleep.task.taskId, reloadExec);
for (const task of [reloadDeep.task.taskId, reloadSleep.task.taskId]) {
  const rec = after.ledger.get(task);
  if (rec.executionStatus === 'RECOVERING') after.recoverTask(task);
  else if (rec.executionStatus === 'PARKED') after.resumeParked();
}
await after.drain();
for (const [taskId, priorSlices] of [[reloadDeep.task.taskId, deepSlices], [reloadSleep.task.taskId, sleepSlices]]) {
  const rec = after.ledger.get(taskId);
  assert.equal(rec.lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
  for (const id of priorSlices) assert.equal(rec.batch.completedSliceIds.filter((x) => x === id).length, 1);
}

console.log(`Runtime Fabric Wave 2 stress: submitted=${TOTAL}; eventStorm=${eventCount}; accepted=${accepted}; rejected=${rejected}; deduped=${deduped}; records=${records.length}; completed=${satisfied.length}; superseded=${superseded.length}; cancelled=${cancelled.length}; maxOpen=${maxOpen}; open=${d.lifecycle.listOpen().length}`);
console.log(`Completed by layer: ${JSON.stringify(completedByLayer)}`);
console.log(`Commit attempts=${commitAttempts}; uniqueCommits=${committed.size}; duplicateCommitAttempts=${duplicateCommitAttempts}`);
console.log('Runtime Fabric Wave 2 stress suite: PASS');
