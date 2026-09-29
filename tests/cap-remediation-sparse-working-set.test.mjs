// Cap ledger rows 26-27. The production sparse index is a bounded working set; it used to be filled alphabetically after
// exact-name matches (an entry titled with the query's words but late in the alphabet was left out), and only the first
// 512 tokens of an entry were indexed. Contract: the working set prefers entries whose titles carry query terms, the
// receipt says when the set is bounded, and a term late in a long entry matches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductionSparseRetrievalChannel } from '../src/production-sparse-retrieval.js';

function owner(entries) {
  const revisions = new Map(entries.map((row) => [row.sourceId, row.revision]));
  return {
    contractVersion: 1,
    // The owner's lean read: rows mirror status(); titles travel beside them.
    retrievalEligibility: () => ({ kind: 'LoreRetrievalEligibility', entries: entries.map((row) => ({ sourceId: row.sourceId, lorebookId: 'b', uid: row.uid, sourceRevisionId: row.revision.id, sourceState: 'CURRENT', freshness: 'CURRENT', retrievalReady: true, eligibleForStoryRetrieval: true })), titles: Object.fromEntries(entries.map((row) => [row.sourceId, row.revision.metadata.title])) }),
    status: () => ({ kind: 'LoreIntelligenceStatus', entries: [] }),
    sourceRevision: (id) => structuredClone(revisions.get(String(id)) ?? null),
  };
}
function entry(uid, title, content) {
  const sourceId = 'lore:b:' + uid;
  return { sourceId, uid: String(uid), revision: { kind: 'LoreSourceRevision', id: sourceId + '@r1', sourceId, lorebookId: 'b', uid: String(uid), revision: 1, state: 'CURRENT', exactContent: content, contentHash: 'h' + uid, metadata: { title, tags: [], treePath: [], extra: {} }, provenance: { kind: 'SourceProvenance', sourceId, sourceRevisionId: sourceId + '@r1', authored: true } } };
}

test('the bounded working set prefers entries whose titles carry the query terms', () => {
  const rows = Array.from({ length: 20 }, (_, i) => entry('a' + String(i).padStart(2, '0'), 'Alpha filler ' + i, 'Nothing relevant here ' + i));
  rows.push(entry('zz', 'Zephyr Observatory', 'The Zephyr Observatory holds the star chart.'));
  const channel = new ProductionSparseRetrievalChannel({ maxArtifacts: 8, maxCandidates: 8 });
  const receipt = channel.hydrateLoreOwner(owner(rows), { chatId: 'chat:a', query: 'Where is the zephyr observatory star chart?' });
  assert.equal(receipt.workingSetBounded, true);
  assert.equal(receipt.coverageComplete, false);
  assert.equal(receipt.canonicalFallback, 'OWNER_LORE');
  const hits = channel.retrieve({ intentId: 'i', intentKind: 'NARROW', query: 'zephyr observatory star chart' }, {});
  assert.ok(hits.some((row) => JSON.stringify(row).includes('lore:b:zz')), 'the relevant late-alphabet entry is in the working set');
});

test('a term near the end of a long entry matches', () => {
  const long = 'filler text about the harbor and the rain '.repeat(200) + ' the obsidian lantern rests here.';
  const channel = new ProductionSparseRetrievalChannel({ maxArtifacts: 8, maxCandidates: 8 });
  channel.hydrateLoreOwner(owner([entry('1', 'Harbor', long), entry('2', 'Other', 'Nothing.')]), { chatId: 'chat:a', query: 'obsidian lantern' });
  const hits = channel.retrieve({ intentId: 'i', intentKind: 'NARROW', query: 'obsidian lantern' }, {});
  assert.ok(hits.some((row) => JSON.stringify(row).includes('lore:b:1')));
});
