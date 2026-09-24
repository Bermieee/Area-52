import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PrecisionGateway, PrecisionFallbackStage, createCandidateBusEnvelope, createEmberTavernPrecisionFixture,
  deterministicPrecisionScore, runPrecisionBenchmark, PRECISION_INTENT_OPPOSITE_CORPUS, PRECISION_TEMPORAL_CORPUS,
} from '../src/coprocessor/index.js';

const unitAdapter = Object.freeze({
  adapterId: 'stress-unit-precision', providerId: 'stress-a', modelId: 'unit',
  async rank({ query, candidates }) {
    return candidates.map((candidate) => ({ ref: candidate.ref, score: unit(deterministicPrecisionScore(query, candidate.text)) }))
      .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
  },
});
const semanticAdapter = Object.freeze({
  adapterId: 'stress-semantic', providerId: 'stress-b', modelId: 'unit-semantic',
  async rank({ query, candidates }) {
    return candidates.map((candidate) => ({ ref: candidate.ref, score: unit(deterministicPrecisionScore(query, candidate.text) + (candidate.text.includes('CURRENT') ? 2 : 0)) }))
      .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
  },
});
const brokenAdapter = Object.freeze({ adapterId: 'stress-offline', providerId: 'stress-offline', async rank() { throw new Error('provider unavailable'); } });

function unit(value) { return Math.max(0, Math.min(1, (Number(value) + 8) / 16)); }
function makeCandidate(request, index, { stale = false, duplicateIdentity = null, text = null, truthStatus = 'CURRENT' } = {}) {
  return {
    candidateId: `r${request}:c${index}`,
    evidenceIdentity: duplicateIdentity ?? `r${request}:e${index}`,
    artifactRef: { artifactId: `a:${request}:${duplicateIdentity ?? index}`, revision: stale ? 5 : 6 },
    sourceRevisionRefs: [stale ? 'src:r5' : 'src:r6'], channel: ['BM25', 'DENSE', 'RAPTOR', 'TREE'][index % 4],
    rankSignals: { fused: ((index * 17) % 100) / 100 }, entityRefs: index < 4 ? ['Blade'] : [], relationshipRefs: [], temporalHints: truthStatus === 'HISTORICAL' ? ['HISTORICAL'] : ['CURRENT'],
    authorityClass: 'OBSERVED', truthStatus, provenance: [{ ref: `p:${request}:${index}` }],
    representationText: text ?? `candidate ${index} for request ${request}`,
  };
}

test('Wave 4 stress: 5,000 precision requests process 100k+ candidates with bounded caps, dedupe, stale rejection, contradiction preservation and terminating fallback', async () => {
  const sizes = [8, 16, 24, 32, 40];
  let broadCandidates = 0, duplicateNominations = 0, staleRejected = 0, fallbacks = 0, deadlineCutoffs = 0, contradictionCases = 0, contradictionPreserved = 0, maxCandidateSet = 0, totalOutput = 0;
  const started = globalThis.performance?.now?.() ?? Date.now();
  for (let i = 0; i < 5000; i++) {
    const size = sizes[i % sizes.length]; maxCandidateSet = Math.max(maxCandidateSet, size); broadCandidates += size;
    const intentCase = i < 2000 ? PRECISION_INTENT_OPPOSITE_CORPUS[i % PRECISION_INTENT_OPPOSITE_CORPUS.length] : null;
    const temporalCase = i >= 2000 && i < 3000 ? PRECISION_TEMPORAL_CORPUS[(i - 2000) % PRECISION_TEMPORAL_CORPUS.length] : null;
    const query = intentCase?.query ?? temporalCase?.query ?? (i < 4000 ? 'What happened to Blade fate?' : `query ${i}`);
    const candidates = [];
    const duplicateIdentity = `r${i}:shared`;
    candidates.push(makeCandidate(i, 0, { duplicateIdentity, text: intentCase?.candidates[0]?.text ?? temporalCase?.candidates[0]?.text ?? 'Blade destroyed in fire', truthStatus: temporalCase ? (temporalCase.candidates[0].text.includes('HISTORICAL') ? 'HISTORICAL' : 'CURRENT') : i < 4000 ? 'UNRESOLVED' : 'CURRENT' }));
    candidates.push(makeCandidate(i, 1, { duplicateIdentity, text: candidates[0].representationText, truthStatus: candidates[0].truthStatus }));
    candidates.push(makeCandidate(i, 2, { duplicateIdentity, text: candidates[0].representationText, truthStatus: candidates[0].truthStatus }));
    for (let j = 3; j < size; j++) {
      const stale = i % 5 === 0 && j === 3;
      const text = j === 3 && (intentCase || temporalCase) ? (intentCase?.candidates[1]?.text ?? temporalCase?.candidates[1]?.text) : j === 4 && i < 1000 ? 'Blade removed before fire' : `noise candidate ${j}`;
      const truthStatus = j === 3 && temporalCase ? (text.includes('HISTORICAL') ? 'HISTORICAL' : 'CURRENT') : i < 1000 && j === 4 ? 'UNRESOLVED' : 'CURRENT';
      candidates.push(makeCandidate(i, j, { stale, text, truthStatus }));
    }
    const bus = createCandidateBusEnvelope({ candidateSetId: `set:${i}`, query, intentFingerprint: `intent:${i}`, sourceRevisionSet: ['src:r6'], worldRevision: 6, sceneRevision: 3, candidates, maxCandidates: 64 });
    duplicateNominations += bus.duplicateNominations;
    const conflictSets = i < 1000 && size > 4 ? [{ id: `fate:${i}`, refs: [bus.candidates.find((c) => c.evidenceIdentity === duplicateIdentity)?.candidateId, `r${i}:c4`].filter(Boolean), credible: true }] : [];
    const late = i % 7 === 0 ? brokenAdapter : unitAdapter;
    const deadline = i % 11 === 0 ? { now: 121, hardDeadline: 120 } : { now: 20, hardDeadline: 120 };
    const gateway = new PrecisionGateway({ caps: { input: 64, lateInteraction: 20, semanticJudge: 12, final: 8 }, lateInteractionAdapter: late, semanticJudgeAdapter: semanticAdapter });
    const out = await gateway.run({ candidateSet: bus, query, currentRevisionSet: { sourceRevisionSet: ['src:r6'], worldRevision: 6, sceneRevision: 3 }, conflictSets, deadline });
    staleRejected += out.staleRejectedCount; totalOutput += out.finalCandidateCount;
    if (out.fallbackStage !== PrecisionFallbackStage.NONE) fallbacks += 1;
    if (out.fallbackStage === PrecisionFallbackStage.FIRST_STAGE_DEADLINE_CUTOFF) deadlineCutoffs += 1;
    if (conflictSets.length) {
      contradictionCases += 1; const refs = new Set(out.results.map((row) => row.candidateRef)); if (conflictSets[0].refs.every((ref) => refs.has(ref))) contradictionPreserved += 1;
    }
    assert.ok(out.lateInteractionCandidateCount <= 20); assert.ok(out.semanticJudgeCandidateCount <= 12); assert.ok(out.finalCandidateCount <= 8);
    assert.ok(out.results.every((row) => row.authorityGranted === false && row.settlementAuthority === false));
  }
  const elapsedMs = Math.max(0.001, (globalThis.performance?.now?.() ?? Date.now()) - started);
  assert.ok(broadCandidates >= 100000); assert.equal(duplicateNominations, 10000); assert.equal(staleRejected, 1000); assert.equal(contradictionCases, 1000); assert.equal(contradictionPreserved, 1000); assert.ok(fallbacks > 0); assert.ok(deadlineCutoffs > 0); assert.ok(totalOutput <= 5000 * 8);
  console.log(JSON.stringify({ stress: 'wave4-precision', requests: 5000, broadCandidates, duplicateNominations, staleRejected, contradictionCases, contradictionPreserved, fallbacks, deadlineCutoffs, maxCandidateSet, totalOutput, elapsedMs, candidateThroughputPerSecond: broadCandidates / (elapsedMs / 1000) }));
});

test('Wave 4 stress: 2,000 intent-opposite and 1,000 temporal-opposite replays preserve deterministic discrimination', async () => {
  let intentCorrect = 0, temporalCorrect = 0;
  const adapter = { adapterId: 'stress-deterministic', async rank({ query, candidates }) { return unitAdapter.rank({ query, candidates }); } };
  for (let i = 0; i < 2000; i++) { const item = PRECISION_INTENT_OPPOSITE_CORPUS[i % PRECISION_INTENT_OPPOSITE_CORPUS.length]; const ranked = await adapter.rank(item); if (ranked[0]?.ref === item.expectedRef) intentCorrect += 1; }
  for (let i = 0; i < 1000; i++) { const item = PRECISION_TEMPORAL_CORPUS[i % PRECISION_TEMPORAL_CORPUS.length]; const ranked = await adapter.rank(item); if (ranked[0]?.ref === item.expectedRef) temporalCorrect += 1; }
  assert.equal(intentCorrect, 2000); assert.equal(temporalCorrect, 1000);
  console.log(JSON.stringify({ stress: 'wave4-opposites', intentCases: 2000, intentCorrect, temporalCases: 1000, temporalCorrect }));
});

test('Wave 4 stress: Ember Tavern contradiction stays unresolved across 1,000 precision passes', async () => {
  const fixture = createEmberTavernPrecisionFixture(); let preserved = 0;
  const gateway = new PrecisionGateway({ caps: { input: 16, lateInteraction: 8, semanticJudge: 6, final: 5 }, lateInteractionAdapter: unitAdapter });
  for (let i = 0; i < 1000; i++) {
    const out = await gateway.run({ candidateSet: fixture.candidateSet, currentRevisionSet: fixture.currentRevisionSet, conflictSets: fixture.conflictSets, query: fixture.candidateSet.query });
    const refs = new Set(out.results.map((row) => row.candidateRef)); if (refs.has('blade:destroyed') && refs.has('blade:removed')) preserved += 1;
    assert.equal(out.results.find((row) => row.candidateRef === 'blade:tavern-history')?.truthStatus, 'HISTORICAL');
  }
  assert.equal(preserved, 1000); console.log(JSON.stringify({ stress: 'wave4-ember-contradiction', cases: 1000, preserved }));
});
