import assert from 'node:assert/strict';
import {
  CAPABILITIES,
  CognitiveRuntimeHost,
  EXECUTION_STATUS,
  LIFECYCLE_STATUS,
  MemoryPersistenceAdapter,
  RuntimeResultClass,
  WorkerDirector,
} from '../src/runtime/index.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function resource(workerId, capabilities, { latency = 10, resources = { CPU: 1 }, provider = workerId, model = `model:${workerId}`, available = true } = {}) {
  return {
    workerId,
    capabilities,
    supportedLayers: ['L0', 'L1', 'L2', 'L3', 'L4'],
    resourceProfile: resources,
    concurrencyCapacity: 1,
    latencyScore: latency,
    provider,
    implementationId: `impl:${workerId}`,
    model,
    foregroundEligible: true,
    backgroundEligible: true,
    available,
  };
}

function adapter({ delay = 0, value = null, validate = null } = {}) {
  return {
    async invoke({ task, signal }) {
      if (delay) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener?.('abort', () => {
          clearTimeout(timer);
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
      return value ?? { value: task.taskId, role: task.taskType };
    },
    ...(validate ? { validate } : {}),
  };
}

function gateAdapter() {
  let release;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  return {
    started: startedPromise,
    release() { release?.(); },
    adapter: {
      invoke({ task, signal }) {
        started();
        return new Promise((resolve, reject) => {
          release = () => resolve({ value: task.taskId, role: task.taskType });
          signal?.addEventListener?.('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      },
    },
  };
}

function turn(id, { revision = 1, deadline = 0 } = {}) {
  return {
    schemaVersion: '1.0.0',
    kind: 'TurnCorrelationEnvelope',
    turnId: `turn:${id}`,
    eventId: `event:${id}`,
    eventType: 'TURN_EVENT',
    eventVersion: '1.0.0',
    correlationId: `corr:${id}`,
    causationId: `cause:${id}`,
    sourceRevisionSet: [`source:${revision}`],
    worldRevision: revision,
    sceneRevision: revision,
    characterStateRevision: revision,
    createdAt: Date.now(),
    deadline,
    cognitiveLayer: 'L1',
    deliveryAttempt: 1,
    dedupeKey: `turn:${id}`,
  };
}

function job(id, capability, {
  resultClass = RuntimeResultClass.REQUIRED,
  layer = 'L1',
  turnId = null,
  correlationId = null,
  softDeadline = null,
  hardDeadline = null,
  fallback = null,
  metadata = {},
  taskType = null,
} = {}) {
  const now = Date.now();
  return {
    schemaVersion: '1.0.0',
    kind: 'CognitiveTask',
    taskId: `task:${id}`,
    taskType: taskType ?? `JOB_${id}`,
    turnId,
    correlationId,
    requiredCapabilities: [capability],
    capabilityRequests: [{ id: capability, minVersion: 1, preferredVersion: 1 }],
    fallbackCapabilitySets: [],
    cognitiveLayer: layer,
    resultClass,
    sourceRevisionSet: ['source:1'],
    worldRevision: 1,
    sceneRevision: 1,
    characterStateRevision: 1,
    softDeadline: softDeadline ?? now + 2000,
    hardDeadline: hardDeadline ?? now + 5000,
    dedupeKey: `task:${id}`,
    fallbackPolicy: fallback == null ? { type: 'DETERMINISTIC', maxRetries: 1 } : { type: 'DETERMINISTIC', maxRetries: 1, result: fallback },
    outputSchema: { type: 'object', required: ['value'] },
    contextSealPolicy: 'BEFORE_SEAL_ONLY',
    compilerLane: 'externalGrounding',
    intentFingerprint: `intent:${id}`,
    metadata: { freshnessToken: `fresh:${id}`, requestedDestination: 'FOREGROUND', ...metadata },
  };
}

function makeHost({ cpu = 2, sealed = () => false, maxRetries = 3 } = {}) {
  const results = [];
  const director = new WorkerDirector({
    persistence: null,
    capacity: { CPU: cpu },
    foregroundReserve: { CPU: Math.min(1, cpu) },
    batch: { base: 1, max: 1 },
    maxRetries,
    isTurnSealed: sealed,
    resultSink: (envelope) => results.push(envelope),
  });
  const host = new CognitiveRuntimeHost({ director });
  return { director, host, results };
}

test('canonical TURN_EVENT delivery is immutable/idempotent and creates one Runtime obligation', async () => {
  const { director, host, results } = makeHost({ cpu: 1 });
  host.registerExecutionResource({ worker: resource('r1', [CAPABILITIES.CPU_ANALYSIS]), adapter: adapter() });
  const t = turn('idempotent');
  const j = job('idempotent', CAPABILITIES.CPU_ANALYSIS, { turnId: t.turnId, correlationId: t.correlationId });
  const first = host.publishTurn(t, [j]);
  const second = host.publishTurn(t, [j]);
  assert.equal(first.event.eventId, second.event.eventId);
  assert.equal(director.ledger.list().filter((r) => r.obligation.runtimeClass === 'NATIVE_COGNITIVE').length, 1);
  await host.native.awaitForeground(t.turnId);
  assert.equal(results.filter((r) => r.taskId === j.taskId && r.executionOutcome === 'COMPLETED').length, 1);
});

test('one physical resource sequentially services heterogeneous jobs including Jev capability', async () => {
  const { director, host, results } = makeHost({ cpu: 1 });
  host.registerExecutionResource({
    worker: resource('only-resource', [CAPABILITIES.CPU_ANALYSIS, CAPABILITIES.GRAPH, CAPABILITIES.SEMANTIC_JUDGMENT]),
    adapter: adapter(),
  });
  const t = turn('single');
  const jobs = [
    job('historian', CAPABILITIES.CPU_ANALYSIS, { turnId: t.turnId, correlationId: t.correlationId, taskType: 'HISTORIAN', resultClass: 'REQUIRED' }),
    job('graph', CAPABILITIES.GRAPH, { turnId: t.turnId, correlationId: t.correlationId, taskType: 'GRAPH_LOOKUP', resultClass: 'REQUIRED' }),
    job('jev', CAPABILITIES.SEMANTIC_JUDGMENT, { turnId: t.turnId, correlationId: t.correlationId, taskType: 'JEV_DECISION', resultClass: 'OPPORTUNISTIC' }),
    job('background', CAPABILITIES.CPU_ANALYSIS, { turnId: t.turnId, correlationId: t.correlationId, layer: 'L3', resultClass: 'DEFERRED' }),
  ];
  host.publishTurn(t, jobs);
  const quorum = await host.native.awaitForeground(t.turnId);
  assert.deepEqual(new Set(quorum.requiredSatisfied), new Set(['task:historian', 'task:graph']));
  await director.drain();
  for (const j of jobs) assert.equal(director.ledger.get(j.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
  assert.ok(results.filter((r) => jobs.some((j) => j.taskId === r.taskId)).every((r) => r.providerProvenance?.workerId === 'only-resource'));
  const jev = results.find((r) => r.taskId === 'task:jev');
  assert.equal(jev.authorityGranted, false);
  assert.equal(jev.canonicalMutation, false);
  assert.equal(jev.settlementPerformed, false);
});

async function executeEquivalent(resourceCount) {
  const { director, host, results } = makeHost({ cpu: resourceCount });
  for (let i = 0; i < resourceCount; i += 1) {
    host.registerExecutionResource({
      worker: resource(`eq-${i}`, [CAPABILITIES.CPU_ANALYSIS, CAPABILITIES.GRAPH], { latency: i + 1, provider: `provider-${i}` }),
      adapter: adapter(),
    });
  }
  const t = turn(`equiv-${resourceCount}`);
  const jobs = [
    job('eq-a', CAPABILITIES.CPU_ANALYSIS, { turnId: t.turnId, correlationId: t.correlationId, resultClass: 'REQUIRED' }),
    job('eq-b', CAPABILITIES.GRAPH, { turnId: t.turnId, correlationId: t.correlationId, resultClass: 'REQUIRED' }),
    job('eq-c', CAPABILITIES.CPU_ANALYSIS, { turnId: t.turnId, correlationId: t.correlationId, resultClass: 'OPPORTUNISTIC' }),
  ];
  host.publishTurn(t, jobs);
  await host.native.awaitForeground(t.turnId);
  await director.drain();
  return results.filter((r) => r.executionOutcome === 'COMPLETED').map((r) => ({
    taskId: r.taskId,
    taskType: r.taskType,
    resultClass: r.resultClass,
    opaqueResult: r.opaqueResult,
    authorityGranted: r.authorityGranted,
  })).sort((a, b) => a.taskId.localeCompare(b.taskId));
}

test('one/two/several execution resources preserve the same cognitive object contracts', async () => {
  const one = await executeEquivalent(1);
  const two = await executeEquivalent(2);
  const several = await executeEquivalent(4);
  assert.deepEqual(two, one);
  assert.deepEqual(several, one);
});

test('slow OPPORTUNISTIC work does not hold foreground quorum and is late-contained after external Seal', async () => {
  let sealed = false;
  const { director, host, results } = makeHost({ cpu: 2, sealed: () => sealed });
  const slow = gateAdapter();
  host.registerExecutionResource({ worker: resource('fast', [CAPABILITIES.CPU_ANALYSIS], { latency: 1 }), adapter: adapter() });
  host.registerExecutionResource({ worker: resource('slow', [CAPABILITIES.CPU_ANALYSIS], { latency: 10 }), adapter: slow.adapter });
  const t = turn('late');
  const required = job('late-required', CAPABILITIES.CPU_ANALYSIS, { turnId: t.turnId, correlationId: t.correlationId });
  const optional = job('late-optional', CAPABILITIES.CPU_ANALYSIS, { turnId: t.turnId, correlationId: t.correlationId, resultClass: 'OPPORTUNISTIC' });
  host.publishTurn(t, [required, optional]);
  const quorum = await host.native.awaitForeground(t.turnId);
  assert.ok(quorum.requiredSatisfied.includes(required.taskId));
  assert.ok(quorum.opportunisticPending.includes(optional.taskId));
  assert.equal(director.inflight.has(optional.taskId), true);
  sealed = true;
  slow.release();
  await director.drain();
  const late = results.find((r) => r.taskId === optional.taskId && r.executionOutcome === 'COMPLETED');
  assert.equal(late.late, true);
  assert.equal(late.lateState, 'AFTER_SEAL');
  assert.equal(late.canonicalMutation, false);
});

test('REQUIRED work with zero eligible resources terminates through deterministic fallback', async () => {
  const { host, results } = makeHost({ cpu: 1 });
  const t = turn('fallback');
  const required = job('fallback', 'MISSING_CAPABILITY', {
    turnId: t.turnId, correlationId: t.correlationId, fallback: { value: 'safe-default' },
  });
  host.publishTurn(t, [required]);
  const quorum = await host.native.awaitForeground(t.turnId);
  assert.ok(quorum.requiredFallback.includes(required.taskId));
  const fallback = results.find((r) => r.taskId === required.taskId && r.executionOutcome === 'FALLBACK');
  assert.deepEqual(fallback.opaqueResult, { value: 'safe-default' });
  assert.equal(fallback.providerProvenance, null);
  assert.equal(fallback.authorityGranted, false);
});

test('provider timeout degrades the selected resource and retries the same logical job on fallback resource', async () => {
  const { director, host, results } = makeHost({ cpu: 2, maxRetries: 2 });
  host.registerExecutionResource({ worker: resource('timeout-a', [CAPABILITIES.CPU_ANALYSIS], { latency: 1, provider: 'A' }), adapter: adapter({ delay: 80 }) });
  host.registerExecutionResource({ worker: resource('timeout-b', [CAPABILITIES.CPU_ANALYSIS], { latency: 20, provider: 'B' }), adapter: adapter() });
  const t = turn('timeout');
  const required = job('timeout', CAPABILITIES.CPU_ANALYSIS, {
    turnId: t.turnId, correlationId: t.correlationId, metadata: { providerTimeoutMs: 10, freshnessToken: 'fresh:timeout' },
  });
  host.publishTurn(t, [required]);
  const quorum = await host.native.awaitForeground(t.turnId);
  assert.ok(quorum.requiredSatisfied.includes(required.taskId));
  const completed = results.find((r) => r.taskId === required.taskId && r.executionOutcome === 'COMPLETED');
  assert.equal(completed.providerProvenance.providerId, 'B');
  assert.equal(director.registry.snapshot().find((w) => w.workerId === 'timeout-a').health, 'degraded');
  assert.equal(director.ledger.get(required.taskId).retryState.attempts, 1);
});

test('malformed provider output is never accepted and retry may use another compatible resource', async () => {
  const { director, host, results } = makeHost({ cpu: 2, maxRetries: 2 });
  host.registerExecutionResource({ worker: resource('bad-a', [CAPABILITIES.CPU_ANALYSIS], { latency: 1, provider: 'bad' }), adapter: adapter({ value: 'not-an-object' }) });
  host.registerExecutionResource({ worker: resource('good-b', [CAPABILITIES.CPU_ANALYSIS], { latency: 20, provider: 'good' }), adapter: adapter() });
  const t = turn('malformed');
  const required = job('malformed', CAPABILITIES.CPU_ANALYSIS, { turnId: t.turnId, correlationId: t.correlationId });
  host.publishTurn(t, [required]);
  await host.native.awaitForeground(t.turnId);
  const completed = results.find((r) => r.taskId === required.taskId && r.executionOutcome === 'COMPLETED');
  assert.equal(completed.providerProvenance.providerId, 'good');
  assert.equal(director.ledger.get(required.taskId).retryState.failures[0].message.includes('Provider output rejected'), true);
});

test('unavailable primary resource is skipped and provider identity does not alter authority', async () => {
  const { host, results } = makeHost({ cpu: 2 });
  host.registerExecutionResource({ worker: resource('unavailable-a', [CAPABILITIES.GRAPH], { latency: 1, provider: 'A', available: false }), adapter: adapter() });
  host.registerExecutionResource({ worker: resource('available-b', [CAPABILITIES.GRAPH], { latency: 10, provider: 'B' }), adapter: adapter() });
  const t = turn('unavailable');
  const required = job('unavailable', CAPABILITIES.GRAPH, { turnId: t.turnId, correlationId: t.correlationId });
  host.publishTurn(t, [required]);
  await host.native.awaitForeground(t.turnId);
  const completed = results.find((r) => r.taskId === required.taskId && r.executionOutcome === 'COMPLETED');
  assert.equal(completed.providerProvenance.providerId, 'B');
  assert.equal(completed.authorityGranted, false);
});

test('active provider cancellation terminates without a successful cognitive result', async () => {
  const { director, host, results } = makeHost({ cpu: 1, maxRetries: 0 });
  const gated = gateAdapter();
  host.registerExecutionResource({ worker: resource('cancel-r', [CAPABILITIES.CPU_ANALYSIS]), adapter: gated.adapter });
  const t = turn('cancel');
  const optional = job('cancel', CAPABILITIES.CPU_ANALYSIS, { turnId: t.turnId, correlationId: t.correlationId, resultClass: 'OPPORTUNISTIC' });
  host.publishTurn(t, [optional]);
  await director.runCycle({ waitForTaskIds: [] });
  await gated.started;
  assert.equal(host.native.cancelTask(optional.taskId, 'operator-cancel'), true);
  await director.drain();
  assert.equal(director.ledger.get(optional.taskId).lifecycleStatus, LIFECYCLE_STATUS.CANCELLED);
  assert.equal(results.some((r) => r.taskId === optional.taskId && r.executionOutcome === 'COMPLETED'), false);
});

test('provider health can recover and future tasks may return to the recovered resource', async () => {
  const { host, results } = makeHost({ cpu: 2, maxRetries: 2 });
  let failA = true;
  host.registerExecutionResource({
    worker: resource('recover-a', [CAPABILITIES.CPU_ANALYSIS], { latency: 1, provider: 'A' }),
    adapter: { async invoke({ task }) { if (failA) throw new Error('temporary outage'); return { value: task.taskId }; } },
  });
  host.registerExecutionResource({ worker: resource('recover-b', [CAPABILITIES.CPU_ANALYSIS], { latency: 20, provider: 'B' }), adapter: adapter() });
  const t1 = turn('recover-1');
  host.publishTurn(t1, [job('recover-1', CAPABILITIES.CPU_ANALYSIS, { turnId: t1.turnId, correlationId: t1.correlationId })]);
  await host.native.awaitForeground(t1.turnId);
  assert.equal(results.find((r) => r.taskId === 'task:recover-1' && r.executionOutcome === 'COMPLETED').providerProvenance.providerId, 'B');
  failA = false;
  host.native.setExecutionResourceHealth('recover-a', 'healthy');
  host.native.setExecutionResourceAvailability('recover-a', true);
  const t2 = turn('recover-2');
  host.publishTurn(t2, [job('recover-2', CAPABILITIES.CPU_ANALYSIS, { turnId: t2.turnId, correlationId: t2.correlationId })]);
  await host.native.awaitForeground(t2.turnId);
  assert.equal(results.find((r) => r.taskId === 'task:recover-2' && r.executionOutcome === 'COMPLETED').providerProvenance.providerId, 'A');
});

test('newer revision supersedes active stale work and stale completion cannot publish success', async () => {
  const { director, host, results } = makeHost({ cpu: 1 });
  const gated = gateAdapter();
  host.registerExecutionResource({ worker: resource('stale-r', [CAPABILITIES.CPU_ANALYSIS]), adapter: gated.adapter });
  const t1 = turn('stale-1', { revision: 1 });
  const oldJob = job('stale-old', CAPABILITIES.CPU_ANALYSIS, {
    turnId: t1.turnId, correlationId: t1.correlationId, resultClass: 'OPPORTUNISTIC', metadata: { conflictKey: 'scene:x', revision: 1, freshnessToken: 'old' },
  });
  host.publishTurn(t1, [oldJob]);
  await director.runCycle({ waitForTaskIds: [] });
  await gated.started;
  const t2 = turn('stale-2', { revision: 2 });
  const newJob = job('stale-new', CAPABILITIES.CPU_ANALYSIS, {
    turnId: t2.turnId, correlationId: t2.correlationId, metadata: { conflictKey: 'scene:x', revision: 2, freshnessToken: 'new' },
  });
  host.publishTurn(t2, [newJob]);
  gated.release();
  await director.drain();
  assert.equal(results.some((r) => r.taskId === oldJob.taskId && r.executionOutcome === 'COMPLETED'), false);
  assert.equal([LIFECYCLE_STATUS.SUPERSEDED, LIFECYCLE_STATUS.CANCELLED].includes(director.ledger.get(oldJob.taskId).lifecycleStatus), true);
});

test('generation pressure yields background cognitive work at a safe checkpoint and one-resource mode remains usable', async () => {
  const { director, host } = makeHost({ cpu: 1 });
  const gated = gateAdapter();
  host.registerExecutionResource({ worker: resource('pressure-r', [CAPABILITIES.CPU_ANALYSIS]), adapter: gated.adapter });
  const t = turn('pressure');
  const background = job('pressure-bg', CAPABILITIES.CPU_ANALYSIS, { turnId: t.turnId, correlationId: t.correlationId, layer: 'L3', resultClass: 'DEFERRED' });
  host.publishTurn(t, [background]);
  await director.runCycle({ waitForTaskIds: [] });
  await gated.started;
  director.beginGeneration({ turnId: t.turnId });
  gated.release();
  await director.runCycle();
  assert.equal(director.ledger.get(background.taskId).executionStatus, EXECUTION_STATUS.PARKED);
  director.completeGeneration({ turnId: t.turnId });
  await director.drain();
  assert.equal(director.ledger.get(background.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
});

test('result-ready boundary preserves requested route/provenance but never decides effective route or authority', async () => {
  const { host, results } = makeHost({ cpu: 1 });
  host.registerExecutionResource({ worker: resource('boundary-r', [CAPABILITIES.CPU_ANALYSIS], { provider: 'boundary-provider' }), adapter: adapter() });
  const t = turn('boundary');
  const required = job('boundary', CAPABILITIES.CPU_ANALYSIS, {
    turnId: t.turnId,
    correlationId: t.correlationId,
    metadata: { requestedDestination: 'SETTLEMENT', freshnessToken: 'fresh-boundary' },
  });
  host.publishTurn(t, [required]);
  await host.native.awaitForeground(t.turnId);
  const envelope = results.find((r) => r.taskId === required.taskId && r.executionOutcome === 'COMPLETED');
  assert.equal(envelope.requestedDestination, 'SETTLEMENT');
  assert.equal('effectiveDestination' in envelope, false);
  assert.equal(envelope.freshnessToken, 'fresh-boundary');
  assert.equal(envelope.providerProvenance.providerId, 'boundary-provider');
  assert.equal(envelope.authorityGranted, false);
  assert.equal(envelope.canonicalMutation, false);
  assert.equal(envelope.settlementPerformed, false);
});

test('durable native obligation reload reattaches provider executor without changing task identity', async () => {
  const persistence = new MemoryPersistenceAdapter();
  const d1 = new WorkerDirector({ persistence, capacity: { CPU: 1 }, foregroundReserve: { CPU: 0 }, batch: { base: 1, max: 1 } });
  const h1 = new CognitiveRuntimeHost({ director: d1 });
  h1.registerExecutionResource({ worker: resource('reload-r', [CAPABILITIES.CPU_ANALYSIS]), adapter: adapter() });
  const t = turn('reload');
  const required = job('reload', CAPABILITIES.CPU_ANALYSIS, { turnId: t.turnId, correlationId: t.correlationId });
  h1.publishTurn(t, [required]);
  const snapshot = persistence.exportSnapshot();
  const d2 = new WorkerDirector({ persistence: new MemoryPersistenceAdapter(snapshot), capacity: { CPU: 1 }, foregroundReserve: { CPU: 0 }, batch: { base: 1, max: 1 } });
  const h2 = new CognitiveRuntimeHost({ director: d2 });
  h2.registerExecutionResource({ worker: resource('reload-r', [CAPABILITIES.CPU_ANALYSIS]), adapter: adapter() });
  await h2.native.awaitForeground(t.turnId);
  assert.equal(d2.ledger.get(required.taskId).lifecycleStatus, LIFECYCLE_STATUS.SATISFIED);
  assert.equal(d2.ledger.get(required.taskId).taskId, required.taskId);
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
console.log(`\nRuntime Fabric Wave 3 deterministic suite: ${passed}/${tests.length} PASS`);
