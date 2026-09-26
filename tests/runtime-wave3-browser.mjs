import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  CAPABILITIES,
  CognitiveRuntimeHost,
  WorkerDirector,
} from '../src/runtime/index.js';

const productionPaths = [
  'src/runtime/provider-execution.js',
  'src/runtime/foreground-quorum.js',
  'src/runtime/native-swarm.js',
  'src/runtime/worker-director.js',
  'src/runtime/batch-engine.js',
  'src/runtime/runtime-host.js',
];
const banned = [
  /\bBuffer\b/,
  /\bprocess\b/,
  /\brequire\s*\(/,
  /from\s+['"]node:/,
  /from\s+['"]fs['"]/,
  /from\s+['"]path['"]/,
  /worker_threads/,
];
for (const path of productionPaths) {
  const source = await fs.readFile(path, 'utf8');
  for (const pattern of banned) assert.equal(pattern.test(source), false, `${path} contains browser-hostile token ${pattern}`);
}

const results = [];
const director = new WorkerDirector({
  persistence: null,
  capacity: { CPU: 1 },
  foregroundReserve: { CPU: 1 },
  resultSink: (r) => results.push(r),
});
const host = new CognitiveRuntimeHost({ director });
host.registerExecutionResource({
  worker: {
    workerId: 'browser-resource',
    capabilities: [CAPABILITIES.CPU_ANALYSIS],
    supportedLayers: ['L0', 'L1', 'L2', 'L3', 'L4'],
    resourceProfile: { CPU: 1 },
    provider: 'browser-provider',
    implementationId: 'browser-adapter',
    foregroundEligible: true,
    backgroundEligible: true,
  },
  adapter: { async invoke({ task }) { return { value: task.taskId }; } },
});
const now = Date.now();
const t = {
  schemaVersion: '1.0.0',
  turnId: 'browser-turn',
  eventId: 'browser-event',
  eventType: 'TURN_EVENT',
  eventVersion: '1.0.0',
  correlationId: 'browser-corr',
  sourceRevisionSet: ['source:1'],
  worldRevision: 1,
  sceneRevision: 1,
  characterStateRevision: 1,
  createdAt: now,
  cognitiveLayer: 'L1',
  dedupeKey: 'browser-turn',
};
host.publishTurn(t, [{
  schemaVersion: '1.0.0',
  kind: 'CognitiveTask',
  taskId: 'browser-task',
  taskType: 'BROWSER_GENERIC',
  turnId: t.turnId,
  correlationId: t.correlationId,
  requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS],
  cognitiveLayer: 'L1',
  resultClass: 'REQUIRED',
  sourceRevisionSet: ['source:1'],
  worldRevision: 1,
  sceneRevision: 1,
  characterStateRevision: 1,
  softDeadline: now + 1000,
  hardDeadline: now + 2000,
  dedupeKey: 'browser-task',
  fallbackPolicy: { type: 'DETERMINISTIC', maxRetries: 1 },
  outputSchema: { type: 'object', required: ['value'] },
  metadata: { freshnessToken: 'browser-fresh', requestedDestination: 'FOREGROUND' },
}]);
const quorum = await host.native.awaitForeground(t.turnId);
assert.deepEqual(quorum.requiredSatisfied, ['browser-task']);
assert.equal(results[0].opaqueResult.value, 'browser-task');
assert.equal(results[0].authorityGranted, false);
console.log(`Runtime Fabric Wave 3 browser-like production path: ${productionPaths.length}/${productionPaths.length} modules clean; execution PASS`);
