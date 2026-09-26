import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, MemoryPersistenceAdapter, WorkerDirector, CognitiveObligationReconciler } from '../src/runtime/index.js';

const worker = { workerId: 'native', capabilities: [CAPABILITIES.CPU_ANALYSIS], supportedLayers: ['L2'], resourceProfile: { CPU: 1 }, concurrencyCapacity: 1, health: 'healthy' };
const executor = { execute: async () => ['learned'], validate: () => true, commit: () => ({ accepted: true }) };
const obligation = (key) => ({ taskType: 'LORE_STUDY', owner: 'Lore', layer: 'L2', requiredCapabilities: [CAPABILITIES.CPU_ANALYSIS], dedupeKey: key, sourceRevisionIds: ['lore:a@2'] });

test('reconciler explains missing, blocked, admitted, and completed steps from durable work', async () => {
  const persistence = new MemoryPersistenceAdapter();
  const director = new WorkerDirector({ persistence, foregroundReserve: { CPU: 0 } });
  const reconciler = new CognitiveObligationReconciler({ director });
  const expected = [{ stepId: 'study', obligation: obligation('lore:a@2:study'), executor, cause: { eventType: 'SOURCE_CHANGED', eventId: 'evt-2', correlationId: 'lore-a-2' } }];

  assert.equal(reconciler.inspect(expected).steps[0].state, 'MISSING');
  const admitted = reconciler.reconcile(expected);
  assert.equal(admitted.steps[0].state, 'DUE');
  assert.equal(admitted.steps[0].why, 'admitted-for-execution');
  assert.equal(admitted.steps[0].cause.eventId, 'evt-2');
  assert.equal(director.snapshot().lifecycle[0].cause.eventType, 'SOURCE_CHANGED');
  assert.match(admitted.steps[0].taskId, /^task-/);
  assert.equal(reconciler.reconcile(expected).steps[0].taskId, admitted.steps[0].taskId);

  await director.runCycle();
  assert.equal(reconciler.inspect(expected).steps[0].state, 'BLOCKED');
  assert.match(reconciler.inspect(expected).steps[0].why, /capability|worker|resource/i);

  director.registerWorker(worker);
  await director.drain();
  const done = reconciler.inspect(expected);
  assert.equal(done.steps[0].state, 'DONE');
  assert.equal(done.steps[0].producer, 'Lore');
  assert.ok(done.steps[0].communications.some((entry) => entry.from === 'Lore' && entry.to === 'Runtime'));
  assert.ok(done.steps[0].communications.some((entry) => entry.from === 'Runtime' && entry.to === 'native'));

  const restored = new WorkerDirector({ persistence, foregroundReserve: { CPU: 0 } });
  assert.equal(new CognitiveObligationReconciler({ director: restored }).inspect(expected).steps[0].state, 'DONE');
});

test('reconciler records why dependent work cannot start and never invents an executor', () => {
  const director = new WorkerDirector();
  const reconciler = new CognitiveObligationReconciler({ director });
  const expected = [
    { stepId: 'study', obligation: obligation('study'), cause: { eventType: 'SOURCE_CHANGED', eventId: 'evt-3' } },
    { stepId: 'index', dependsOn: ['study'], obligation: { ...obligation('index'), taskType: 'INDEX' }, executor },
  ];
  const state = reconciler.reconcile(expected);
  assert.equal(state.steps[0].state, 'BLOCKED');
  assert.equal(state.steps[0].why, 'executor-not-provided');
  assert.equal(state.steps[1].state, 'BLOCKED');
  assert.equal(state.steps[1].why, 'dependency-not-done:study');
  assert.equal(director.ledger.list().length, 0);
});

test('a dependent obligation starts only after its prerequisite has a satisfied receipt', async () => {
  const director = new WorkerDirector({ foregroundReserve: { CPU: 0 } });
  director.registerWorker(worker);
  const reconciler = new CognitiveObligationReconciler({ director });
  const expected = [
    { stepId: 'study', obligation: obligation('book:study'), executor },
    { stepId: 'index', dependsOn: ['study'], obligation: { ...obligation('book:index'), taskType: 'INDEX' }, executor },
  ];
  assert.deepEqual(reconciler.reconcile(expected).steps.map((step) => step.state), ['DUE', 'BLOCKED']);
  await director.drain();
  assert.deepEqual(reconciler.reconcile(expected).steps.map((step) => step.state), ['DONE', 'DUE']);
  await director.drain();
  assert.deepEqual(reconciler.inspect(expected).steps.map((step) => step.state), ['DONE', 'DONE']);
});

test('cause metadata cannot leak event payloads into the explanation', () => {
  const director = new WorkerDirector();
  const expected = [{ stepId: 'study', obligation: obligation('private'), cause: { eventType: 'SOURCE_CHANGED', eventId: 'e', payload: 'secret lore', apiKey: 'secret' } }];
  const result = new CognitiveObligationReconciler({ director }).inspect(expected);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
