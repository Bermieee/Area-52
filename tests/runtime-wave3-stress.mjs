import assert from 'node:assert/strict';
import {
  CAPABILITIES,
  CognitiveRuntimeHost,
  RuntimeResultClass,
  WorkerDirector,
} from '../src/runtime/index.js';

function resource(id, capabilities, latency = 10) {
  return {
    workerId: id,
    capabilities,
    supportedLayers: ['L0', 'L1', 'L2', 'L3', 'L4'],
    resourceProfile: { CPU: 1 },
    concurrencyCapacity: 1,
    latencyScore: latency,
    provider: `provider:${id}`,
    implementationId: `impl:${id}`,
    model: `model:${id}`,
    foregroundEligible: true,
    backgroundEligible: true,
  };
}

function adapter({ delay = 0 } = {}) {
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
      return { value: task.taskId, role: task.taskType };
    },
  };
}

function turn(n, suffix = '') {
  return {
    schemaVersion: '1.0.0',
    turnId: `stress-turn:${n}${suffix}`,
    eventId: `stress-event:${n}${suffix}`,
    eventType: 'TURN_EVENT',
    eventVersion: '1.0.0',
    correlationId: `stress-corr:${n}${suffix}`,
    sourceRevisionSet: [`source:${n}`],
    worldRevision: n,
    sceneRevision: n,
    characterStateRevision: n,
    createdAt: Date.now(),
    cognitiveLayer: 'L1',
    deliveryAttempt: 1,
    dedupeKey: `stress-turn:${n}${suffix}`,
  };
}

function job(t, index, capability, resultClass, options = {}) {
  const now = Date.now();
  const id = `${t.turnId}:job:${index}`;
  return {
    schemaVersion: '1.0.0',
    kind: 'CognitiveTask',
    taskId: id,
    taskType: index % 5 === 4 ? 'JEV_DECISION' : `STRESS_${index}`,
    turnId: t.turnId,
    correlationId: t.correlationId,
    requiredCapabilities: [capability],
    capabilityRequests: [{ id: capability, minVersion: 1, preferredVersion: 1 }],
    cognitiveLayer: resultClass === RuntimeResultClass.DEFERRED ? 'L3' : 'L1',
    resultClass,
    sourceRevisionSet: t.sourceRevisionSet,
    worldRevision: t.worldRevision,
    sceneRevision: t.sceneRevision,
    characterStateRevision: t.characterStateRevision,
    softDeadline: options.expired ? now - 2 : now + 2000,
    hardDeadline: options.expired ? now - 1 : now + 5000,
    dedupeKey: id,
    fallbackPolicy: { type: 'DETERMINISTIC', maxRetries: 1, result: { value: `fallback:${id}` } },
    outputSchema: { type: 'object', required: ['value'] },
    contextSealPolicy: 'BEFORE_SEAL_ONLY',
    compilerLane: 'externalGrounding',
    intentFingerprint: `intent:${id}`,
    metadata: {
      freshnessToken: `fresh:${id}`,
      requestedDestination: resultClass === RuntimeResultClass.DEFERRED ? 'BACKGROUND' : 'FOREGROUND',
      providerTimeoutMs: options.providerTimeoutMs ?? null,
    },
  };
}

async function mixedMultiResourceStress() {
  const results = [];
  const director = new WorkerDirector({
    persistence: null,
    capacity: { CPU: 3 },
    foregroundReserve: { CPU: 1 },
    batch: { base: 1, max: 1 },
    maxRetries: 2,
    resultSink: (r) => results.push(r),
  });
  const host = new CognitiveRuntimeHost({ director });
  const caps = [CAPABILITIES.CPU_ANALYSIS, CAPABILITIES.GRAPH, CAPABILITIES.SEMANTIC_JUDGMENT];
  for (let i = 0; i < 3; i += 1) host.registerExecutionResource({ worker: resource(`multi-${i}`, caps, i + 1), adapter: adapter() });

  let turns = 0;
  let duplicateDeliveries = 0;
  let admittedJobs = 0;
  let requiredJobs = 0;
  for (let n = 1; n <= 250; n += 1) {
    const t = turn(n);
    const count = n % 5;
    const jobs = [];
    for (let j = 0; j < count; j += 1) {
      const resultClass = j === 0 ? RuntimeResultClass.REQUIRED : j % 3 === 1 ? RuntimeResultClass.OPPORTUNISTIC : RuntimeResultClass.DEFERRED;
      const capability = caps[j % caps.length];
      jobs.push(job(t, j, capability, resultClass, { expired: n % 37 === 0 && resultClass === RuntimeResultClass.REQUIRED }));
      if (resultClass === RuntimeResultClass.REQUIRED) requiredJobs += 1;
    }
    host.publishTurn(t, jobs);
    turns += 1;
    admittedJobs += jobs.length;
    if (n % 4 === 0) {
      host.publishTurn(t, jobs);
      duplicateDeliveries += 1;
    }
    const quorum = await host.native.awaitForeground(t.turnId);
    assert.equal(quorum.deferred.some((id) => quorum.opportunisticReady.includes(id)), false);
    if (n % 25 === 0) await director.drain();
  }
  await director.drain();

  const completedOrFallback = results.filter((r) => ['COMPLETED', 'FALLBACK'].includes(r.executionOutcome));
  const uniqueTaskIds = new Set(completedOrFallback.map((r) => r.taskId));
  assert.equal(uniqueTaskIds.size, completedOrFallback.length);
  assert.equal(results.some((r) => r.authorityGranted !== false || r.canonicalMutation !== false || r.settlementPerformed !== false), false);
  for (const record of director.ledger.list().filter((r) => r.obligation.payload?.resultClass === RuntimeResultClass.REQUIRED)) {
    assert.equal(results.some((r) => r.taskId === record.taskId && ['COMPLETED', 'FALLBACK', 'DEGRADED'].includes(r.executionOutcome)), true);
  }
  return { turns, duplicateDeliveries, admittedJobs, requiredJobs, results: results.length };
}

async function oneResourceStress() {
  const results = [];
  const director = new WorkerDirector({
    persistence: null,
    capacity: { CPU: 1 },
    foregroundReserve: { CPU: 1 },
    batch: { base: 1, max: 1 },
    resultSink: (r) => results.push(r),
  });
  const host = new CognitiveRuntimeHost({ director });
  const caps = [CAPABILITIES.CPU_ANALYSIS, CAPABILITIES.GRAPH, CAPABILITIES.SEMANTIC_JUDGMENT];
  host.registerExecutionResource({ worker: resource('one', caps, 1), adapter: adapter() });
  let admittedJobs = 0;
  for (let n = 1; n <= 120; n += 1) {
    const t = turn(n, ':one');
    const jobs = [
      job(t, 0, caps[n % caps.length], RuntimeResultClass.REQUIRED),
      job(t, 1, caps[(n + 1) % caps.length], RuntimeResultClass.OPPORTUNISTIC),
      ...(n % 2 ? [job(t, 2, caps[(n + 2) % caps.length], RuntimeResultClass.DEFERRED)] : []),
    ];
    admittedJobs += jobs.length;
    host.publishTurn(t, jobs);
    const quorum = await host.native.awaitForeground(t.turnId);
    assert.equal(quorum.requiredSatisfied.length, 1);
    if (n % 20 === 0) await director.drain();
  }
  await director.drain();
  assert.equal(director.active.size, 0);
  assert.equal(director.inflight.size, 0);
  assert.equal(results.some((r) => r.authorityGranted !== false), false);
  return { turns: 120, admittedJobs, results: results.length };
}

async function providerChurnStress() {
  const results = [];
  const director = new WorkerDirector({
    persistence: null,
    capacity: { CPU: 2 },
    foregroundReserve: { CPU: 1 },
    batch: { base: 1, max: 1 },
    maxRetries: 2,
    resultSink: (r) => results.push(r),
  });
  const host = new CognitiveRuntimeHost({ director });
  host.registerExecutionResource({ worker: resource('churn-a', [CAPABILITIES.CPU_ANALYSIS], 1), adapter: adapter({ delay: 8 }) });
  host.registerExecutionResource({ worker: resource('churn-b', [CAPABILITIES.CPU_ANALYSIS], 20), adapter: adapter() });
  let timeoutCases = 0;
  for (let n = 1; n <= 30; n += 1) {
    host.native.setExecutionResourceHealth('churn-a', 'healthy');
    host.native.setExecutionResourceAvailability('churn-a', true);
    const t = turn(n, ':churn');
    const required = job(t, 0, CAPABILITIES.CPU_ANALYSIS, RuntimeResultClass.REQUIRED, { providerTimeoutMs: 1 });
    host.publishTurn(t, [required]);
    const quorum = await host.native.awaitForeground(t.turnId);
    assert.equal(quorum.requiredSatisfied.length, 1);
    timeoutCases += 1;
  }
  assert.equal(results.filter((r) => r.executionOutcome === 'COMPLETED' && r.providerProvenance?.workerId === 'churn-b').length, timeoutCases);
  return { turns: 30, timeoutCases, results: results.length };
}

const multi = await mixedMultiResourceStress();
const one = await oneResourceStress();
const churn = await providerChurnStress();
const totals = {
  turns: multi.turns + one.turns + churn.turns,
  duplicateDeliveries: multi.duplicateDeliveries,
  admittedJobs: multi.admittedJobs + one.admittedJobs + churn.timeoutCases,
  oneResourceTurns: one.turns,
  providerTimeoutCases: churn.timeoutCases,
  resultReadyEnvelopes: multi.results + one.results + churn.results,
  authorityViolations: 0,
  deadlocks: 0,
};
console.log(JSON.stringify({ stress: 'runtime-wave3-native-swarm', ...totals }));
console.log('Runtime Fabric Wave 3 stress: PASS');
