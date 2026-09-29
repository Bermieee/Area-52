// Cap remediation, cap ledger row 34 (owner handoff "Context Compiler"; owner pointed at Nexus's ranked, budgeted recall as
// an example of a working system). The Lore and Memory sections of the compiled packet took the first 12 admitted rows,
// unsorted. Contract now: they keep the best-ranked 12 by signals the evidence already carries (hard rule, precision rank,
// score, input rank; admission order breaks ties), kept rows stay in admission order, and what was left out is counted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextCompiler } from '../src/context-compiler.js';

const ev = (i, { cls = 'SOURCE_LORE', finalRank = null, score = null, artifact = 'a' + i, hardRule = false } = {}) => ({
  evidenceId: 'ev' + i, sourceClass: cls, authorityClass: 'SOURCE_CANON', temporalStatus: 'CURRENT', confidence: 1,
  artifactRef: { artifactId: artifact, revision: 1 }, representationText: 'row ' + i, hardRule,
  sourceRevisionRefs: ['src' + i], dependencyRevisionRefs: [], provenanceRefs: [],
  retrievalMetadata: { precision: finalRank == null && score == null ? null : { finalRank, score }, fusionScore: null, inputRank: i },
});
function compile(evidence, max = 12) {
  const compiler = new ContextCompiler({ graph: {}, maxFactsPerSection: max });
  const truthResults = evidence.map((row) => ({ usableForIntent: true, knowledgeEvidenceId: row.evidenceId, claimIds: [], claims: [], classification: 'CURRENT' }));
  return compiler.compileDetailed({ query: 'q', intent: 'CURRENT', truthResults, knowledgeEvidence: evidence });
}

test('within the section budget nothing changes: all rows kept in admission order', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ev(i));
  const { packet, metadata } = compile(rows);
  assert.deepEqual(packet.relevantLore.map((row) => row.evidenceId), rows.map((row) => row.evidenceId));
  assert.equal(metadata.externalKnowledge.loreBoundedOut, 0);
});

for (const n of [11, 12, 13, 24, 200]) {
  test(`${n} admitted Lore rows: the best-ranked 12 are kept, the rest counted`, () => {
    // Admitted in reverse rank order: the best rows arrive last.
    const rows = Array.from({ length: n }, (_, i) => ev(i, { finalRank: n - i }));
    const { packet, metadata } = compile(rows);
    const kept = packet.relevantLore.map((row) => row.evidenceId);
    const best = new Set(rows.slice().sort((a, b) => a.retrievalMetadata.precision.finalRank - b.retrievalMetadata.precision.finalRank).slice(0, 12).map((row) => row.evidenceId));
    assert.deepEqual(kept, rows.map((row) => row.evidenceId).filter((id) => best.has(id)), 'the best 12, in admission order');
    assert.equal(metadata.externalKnowledge.loreBoundedOut, Math.max(0, n - 12));
  });
}

test('a hard rule is always kept; memory keeps its highest-scored rows', () => {
  const rows = [
    ...Array.from({ length: 14 }, (_, i) => ev(i, { finalRank: i + 1 })),
    ev(100, { finalRank: 99, hardRule: true }),
    ...Array.from({ length: 14 }, (_, i) => ev(200 + i, { cls: 'MEMORY_EPISODE', score: i / 20 })),
  ];
  const { packet, metadata } = compile(rows);
  assert.ok(packet.relevantLore.some((row) => row.evidenceId === 'ev100'), 'the hard rule is kept despite its low rank');
  assert.ok(!packet.relevantLore.some((row) => row.evidenceId === 'ev13'), 'the worst ordinary row makes room');
  assert.deepEqual(packet.episodicMemory.map((row) => row.evidenceId), Array.from({ length: 12 }, (_, i) => 'ev' + (202 + i)), 'the 12 highest scores, in admission order');
  assert.equal(metadata.externalKnowledge.memoryBoundedOut, 2);
});
