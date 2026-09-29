// Cap remediation, cap ledger row 41 (owner handoff "Memory Historian / indexed terms", "Memory Vector Index"). An episode's
// representation is the first 1,600 characters of the reply and was the only text embedded, so the rest of a long reply
// could not be found by dense recall. Contract: a long reply is embedded as its representation plus overlapping windows
// over the whole exact evidence (always including the ending) in ONE provider call; a query matches the best segment;
// a reply within the representation is embedded exactly as before (single string input).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryVectorIndex } from '../src/memory-vector-index.js';

function producerWith(texts) {
  const records = new Map(), evidence = new Map();
  texts.forEach((text, i) => {
    evidence.set('ev' + i, { exactContent: text });
    records.set('rec' + i, { id: 'rec' + i, artifactId: 'ep' + i, artifactRevision: 1, channel: 'SCENE_EPISODE', freshness: 'FRESH', sourceRevisionRefs: ['s' + i], evidenceRefs: ['ev' + i], representationText: text.slice(0, 1600) });
  });
  return { historian: { records }, experienceStore: { episodes: new Map() }, graph: { isSourceRevisionActive: () => true, evidenceView: (id) => evidence.get(id) ?? null }, plasticity: { retrievable: () => true } };
}
// A toy embedding: dimension 0 lights up for "compass", dimension 1 for everything else.
const embed = (text) => (String(text).includes('compass') ? [1, 0] : [0, 1]);
function executor(calls) {
  return async (request) => { calls.push(request); const inputs = Array.isArray(request.input) ? request.input : [request.input]; return { executionId: 'x', embeddings: inputs.map(embed) }; };
}
const filler = (n) => 'The rain kept falling over the harbor while they talked. '.repeat(Math.ceil(n / 56)).slice(0, n);

for (const n of [1599, 1600, 1601, 3200, 40000]) {
  test(`a ${n}-character reply whose key detail is at the end is found by dense recall`, async () => {
    const text = filler(n) + ' Finally Mira hid the compass.';
    const producer = producerWith([text, filler(3000)]);
    const index = new MemoryVectorIndex({ producer }), calls = [];
    index.attachExecutor(executor(calls));
    for (const r of producer.historian.records.values()) index.enqueueArtifact({ artifactId: r.artifactId, artifactRevision: 1, chatId: 'c', sourceRevisionRefs: r.sourceRevisionRefs, historianRecordRef: r.id });
    await index.runMaintenance({ maxUnits: 16 });
    const artifactCalls = calls.filter((c) => c.operation === 'EMBED_ARTIFACT');
    assert.equal(artifactCalls.length, 2, 'one provider call per artifact, whatever its length');
    const long = artifactCalls.find((c) => c.artifactId === 'ep0');
    if (text.length <= 1600) assert.equal(typeof long.input, 'string', 'a short reply is embedded exactly as before');
    else {
      assert.ok(Array.isArray(long.input) && long.input.length <= 8);
      assert.ok(long.input.at(-1).endsWith('hid the compass.'), 'the ending is always embedded');
    }
    await index.primeQuery({ query: 'where is the compass', selection: { chatId: 'c' }, maxCandidates: 1 });
    const cached = [...index.queryCache.values()][0].selected;
    assert.equal(cached[0].artifactId, 'ep0', 'the long reply ranks first for its tail detail');
  });
}

test('segment coverage is recorded; a very long reply keeps its opening, early windows and ending', async () => {
  const text = filler(60000) + ' Finally Mira hid the compass.';
  const producer = producerWith([text]);
  const index = new MemoryVectorIndex({ producer }), calls = [];
  index.attachExecutor(executor(calls));
  index.enqueueArtifact({ artifactId: 'ep0', artifactRevision: 1, chatId: 'c', sourceRevisionRefs: ['s0'], historianRecordRef: 'rec0' });
  await index.runMaintenance({ maxUnits: 1 });
  const entry = index.vectors.get('ep0@1');
  assert.equal(entry.segmentVectors.length, 7);
  assert.equal(entry.segmentCoverage.complete, false);
  assert.equal(entry.segmentCoverage.endingIncluded, true);
  assert.equal(entry.segmentCoverage.canonicalKnowledgeDropped, false);
});

test('a provider answer with the wrong number of vectors is rejected, not half-stored', async () => {
  const producer = producerWith([filler(5000)]);
  const index = new MemoryVectorIndex({ producer });
  index.attachExecutor(async () => ({ executionId: 'x', embeddings: [[1, 0]] }));
  index.enqueueArtifact({ artifactId: 'ep0', artifactRevision: 1, chatId: 'c', sourceRevisionRefs: ['s0'], historianRecordRef: 'rec0' });
  const receipt = await index.runMaintenance({ maxUnits: 1 });
  assert.equal(receipt.outcomes[0].status, 'REJECTED');
  assert.equal(index.vectors.size, 0);
});

test('a reply within the representation text is embedded exactly as before', async () => {
  const text = filler(1000) + ' Mira hid the compass.';
  const producer = producerWith([text]);
  const index = new MemoryVectorIndex({ producer }), calls = [];
  index.attachExecutor(executor(calls));
  index.enqueueArtifact({ artifactId: 'ep0', artifactRevision: 1, chatId: 'c', sourceRevisionRefs: ['s0'], historianRecordRef: 'rec0' });
  await index.runMaintenance({ maxUnits: 1 });
  assert.equal(calls[0].input, text);
  assert.equal(index.vectors.get('ep0@1').segmentVectors, undefined);
});
