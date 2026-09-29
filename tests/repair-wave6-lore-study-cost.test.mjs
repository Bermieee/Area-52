// Wave 6 (audit D10): studying a Lorebook must not deep-clone the whole learned corpus once per
// obligation just to count unrelated artifacts. Deterministic call-count proof (no timings).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentDeploymentBrain } from '../src/deployment/brain.js';

function entries(n) {
  return Array.from({ length: n }, (_, i) => ({ uid: 'e' + i, content: `Person${i} lives at Place${i}. Person${i} owns the Item${i}.`, metadata: { title: 'Entry ' + i, at: i, treePath: ['People', 'P' + i] } }));
}

function corpusReadsFor(n) {
  const brain = new DevelopmentDeploymentBrain();
  const store = brain.loreIntelligence.runtime.store;
  let corpusReads = 0;
  const original = store.currentArtifacts.bind(store);
  store.currentArtifacts = (...args) => { corpusReads += 1; return original(...args); };
  brain.ingestLorebook({ id: 'perf', title: 'Perf', chatId: 'chat:perf', discovery: { kind: 'DevelopmentDeploymentFixture', stableId: 'perf', exactAuthoredSource: true }, entries: entries(n) });
  return corpusReads;
}

test('study does not clone the entire corpus once per obligation', () => {
  const small = corpusReadsFor(10), large = corpusReadsFor(40);
  assert.equal(large, small, 'corpus-wide deep clones must not grow with the number of obligations (10 -> ' + small + ', 40 -> ' + large + ')');
});

test('countCurrentArtifacts matches the cloning computation it replaces', () => {
  const brain = new DevelopmentDeploymentBrain();
  brain.ingestLorebook({ id: 'perf', title: 'Perf', chatId: 'chat:perf', discovery: { kind: 'DevelopmentDeploymentFixture', stableId: 'perf', exactAuthoredSource: true }, entries: entries(12) });
  const { store, registry } = brain.loreIntelligence.runtime;
  for (const source of registry.listEntries()) {
    const expected = store.currentArtifacts(registry).filter((a) => a.sourceId !== source.sourceId).length;
    assert.equal(store.countCurrentArtifacts(registry, { excludeSourceId: source.sourceId }), expected);
  }
  assert.equal(store.countCurrentArtifacts(registry), store.currentArtifacts(registry).length);
});
