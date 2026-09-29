// Cap remediation, cap ledger rows 51-52 (owner handoff "Memory Vector Index"). Pending embedding work over capacity used
// to be dropped silently (oldest first, never re-queued) and vector eviction was silent. Contract now: work over capacity
// is DEFERRED_BACKPRESSURE and rebuilt from the owner's current episodes once the queue drains, so every fresh episode is
// eventually embedded; eviction is counted and reported; a superseded revision frees its slot; snapshots keep the state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryVectorIndex } from '../src/memory-vector-index.js';

function fakeProducer(n) {
  const records = new Map(), episodes = new Map();
  for (let i = 0; i < n; i += 1) {
    const id = 'episode:' + i;
    records.set('rec:' + i, { id: 'rec:' + i, artifactId: id, artifactRevision: 1, channel: 'SCENE_EPISODE', freshness: 'FRESH', sourceRevisionRefs: ['src:' + i], representationText: 'Episode ' + i });
    episodes.set(id, { id, chatId: 'chat:a' });
  }
  return { historian: { records }, experienceStore: { episodes }, graph: { isSourceRevisionActive: () => true }, plasticity: { retrievable: () => true } };
}
const enqueueAll = (index, producer) => [...producer.historian.records.values()].map((r) => index.enqueueArtifact({ artifactId: r.artifactId, artifactRevision: 1, chatId: 'chat:a', sourceRevisionRefs: r.sourceRevisionRefs, historianRecordRef: r.id }));
const embed = async () => ({ executionId: 'x', embeddings: [[0.1, 0.2, 0.3]] });
async function drain(index, guard = 1000) { for (let i = 0; i < guard && (index.pending.length || index.backpressure.active); i += 1) await index.runMaintenance({ maxUnits: 16 }); }

for (const [cap, n] of [[8, 7], [8, 8], [8, 9], [8, 16], [8, 200]]) {
  test(`capacity ${cap}, ${n} episodes: nothing is dropped, every episode is eventually embedded`, async () => {
    const producer = fakeProducer(n);
    const index = new MemoryVectorIndex({ producer, maxPending: cap, maxVectors: 100000 });
    index.attachExecutor(embed);
    const receipts = enqueueAll(index, producer);
    assert.equal(index.pending.length, Math.min(cap, n), 'queue bounded');
    const deferred = receipts.filter((row) => row.status === 'DEFERRED_BACKPRESSURE').length;
    assert.equal(deferred, Math.max(0, n - cap));
    assert.equal(index.status().backpressure.active, n > cap);
    await drain(index);
    assert.equal(index.vectors.size, n, 'every episode embedded');
    assert.equal(index.status().backpressure.active, false);
    assert.ok(index.pending.length <= cap);
  });
}

test('vector eviction is visible; a superseded revision frees its slot', async () => {
  const producer = fakeProducer(6);
  const index = new MemoryVectorIndex({ producer, maxVectors: 4 });
  index.attachExecutor(embed);
  enqueueAll(index, producer);
  await drain(index);
  assert.equal(index.vectors.size, 4);
  const status = index.status();
  assert.equal(status.evictions.count, 2);
  assert.equal(status.evictions.canonicalKnowledgeDropped, false);
  assert.equal(status.evictions.fallback, 'LEXICAL_HISTORIAN');
  // Revision 2 of episode 5 replaces revision 1 instead of evicting another episode.
  producer.historian.records.set('rec:5', { ...producer.historian.records.get('rec:5'), artifactRevision: 2 });
  index.enqueueArtifact({ artifactId: 'episode:5', artifactRevision: 2, chatId: 'chat:a', sourceRevisionRefs: ['src:5'], historianRecordRef: 'rec:5' });
  await drain(index);
  assert.ok(index.vectors.has('episode:5@2') && !index.vectors.has('episode:5@1'));
  assert.equal(index.status().evictions.count, 2, 'no extra eviction');
});

test('backpressure survives a snapshot and an oversized restored queue is deferred, not trimmed', async () => {
  const producer = fakeProducer(20);
  const index = new MemoryVectorIndex({ producer, maxPending: 5 });
  enqueueAll(index, producer);
  const restored = new MemoryVectorIndex({ producer, maxPending: 5, snapshot: JSON.parse(JSON.stringify(index.snapshot())) });
  assert.equal(restored.status().backpressure.active, true);
  const small = new MemoryVectorIndex({ producer, maxPending: 3, snapshot: JSON.parse(JSON.stringify(index.snapshot())) });
  assert.equal(small.pending.length, 3);
  assert.equal(small.status().backpressure.active, true);
  small.attachExecutor(embed);
  await drain(small);
  assert.equal(small.vectors.size, 20);
});
