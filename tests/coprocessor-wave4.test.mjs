import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  AdaptiveRetrievalController, BroadSimilarityBaselineAdapter, CandidateFreshness, Capability, CapabilityProfileRegistry,
  CoprocessorPlacementPolicy, CoprocessorTelemetry, DeterministicPrecisionAdapter, DeterministicProviderAdapter,
  DeterministicSemanticJudgeAdapter, FailureCode, PrecisionFallbackStage, PrecisionGateway, PrecisionReasonCode,
  PrecisionRetrievalPipeline, PrecisionStage, ProviderAdapterRegistry, RetrievalQuality, SpecialistExecutionLayer,
  TelemetryEvent, Wave4MeasurementStatus, benchmarkCandidateScaling, classifyCandidateFreshness, createCandidateBusEnvelope,
  createColBertBenchmarkAdapter, createEmberTavernPrecisionFixture, createFlashRankBenchmarkAdapter, createLoreCandidateFixtures,
  createMemoryCandidateFixtures, createMultiChannelDedupeFixture, createPrecisionTask, dedupeCandidates,
  externalPrecisionAvailability, filterFreshCandidates, normalizeCandidate, precisionDeadlineDecision,
  runExternalPrecisionBenchmark, runPrecisionBenchmark, runPrecisionGainBenchmark, runProviderQualification,
  runTemporalPrecisionBenchmark, runTwoStagePrecisionBenchmark, summarizePrecisionTelemetry,
  summarizeWave4PrecisionQualification, toRuntimeObligation, toTruthCompatibleEvidenceSet, validatePrecisionProviderOutput,
} from '../src/coprocessor/index.js';

function candidate(id, text, extra = {}) {
  return { candidateId: id, evidenceIdentity: extra.evidenceIdentity ?? id, artifactRef: extra.artifactRef ?? { artifactId: id, revision: 5 }, sourceRevisionRefs: extra.sourceRevisionRefs ?? ['src:r5'], channel: extra.channel ?? 'DENSE', rankSignals: extra.rankSignals ?? { dense: .7 }, entityRefs: extra.entityRefs ?? [], relationshipRefs: [], temporalHints: extra.temporalHints ?? [], authorityClass: extra.authorityClass ?? 'OBSERVED', truthStatus: extra.truthStatus ?? 'CURRENT', provenance: extra.provenance ?? [{ source: id }], representationText: text, sceneRelevance: extra.sceneRelevance ?? .8 };
}
function set(candidates, extra = {}) { return createCandidateBusEnvelope({ candidateSetId: extra.candidateSetId ?? 'set', query: extra.query ?? 'Mara leaves now', intentFingerprint: extra.intentFingerprint ?? 'intent:test', sourceRevisionSet: extra.sourceRevisionSet ?? ['src:r5'], worldRevision: extra.worldRevision ?? 5, sceneRevision: extra.sceneRevision ?? 2, candidates, maxCandidates: extra.maxCandidates ?? 256 }); }
function revision(sourceRevisionSet = ['src:r5']) { return { sourceRevisionSet, worldRevision: 5, sceneRevision: 2, characterStateRevision: 0 }; }

// CandidateBus normalization / future Sensory Net seam

test('CandidateBus preserves channel-neutral identity/revision/provenance without granting admission authority', () => {
  const bus = set([candidate('c1', 'Mara leaves now', { channel: 'RAPTOR', authorityClass: 'DERIVED', truthStatus: 'CURRENT' })]);
  assert.equal(bus.kind, 'CandidateBusEnvelope'); assert.equal(bus.candidates[0].channel, 'RAPTOR'); assert.equal(bus.candidates[0].authorityClass, 'DERIVED');
  assert.equal(bus.admissionAuthority, false); assert.equal(bus.candidates[0].admissionAuthority, false); assert.deepEqual(bus.candidates[0].sourceRevisionRefs, ['src:r5']);
});

test('CandidateBus accepts sparse optional metadata from heterogeneous retrieval channels', () => {
  const bus = createCandidateBusEnvelope({ candidates: [{ candidateId: 'minimal', channel: 'KEYWORD', sourceRevisionRefs: [] }] });
  assert.equal(bus.candidates.length, 1); assert.equal(bus.candidates[0].artifactRef, null); assert.deepEqual(bus.candidates[0].entityRefs, []);
});

test('multi-channel nominations dedupe to one underlying fact without confidence multiplication', () => {
  const bus = createMultiChannelDedupeFixture();
  assert.equal(bus.inputCandidateCount, 3); assert.equal(bus.candidateCount, 1); assert.equal(bus.duplicateNominations, 2);
  assert.deepEqual(new Set(bus.candidates[0].nominatedBy), new Set(['BM25', 'DENSE', 'RAPTOR'])); assert.equal(bus.candidates[0].duplicateCount, 3);
});

test('candidate freshness rejects r5 after source advances to r6 rather than silently using latest', () => {
  const c = normalizeCandidate(candidate('stale', 'CURRENT x', { sourceRevisionRefs: ['src:r5'] }));
  assert.equal(classifyCandidateFreshness(c, revision(['src:r6'])), CandidateFreshness.STALE);
  const filtered = filterFreshCandidates([c], revision(['src:r6'])); assert.equal(filtered.fresh.length, 0); assert.equal(filtered.stale.length, 1);
});

// Precision Gateway / #8

test('Precision Gateway enforces independent input/late/semantic/final candidate caps', async () => {
  const candidates = Array.from({ length: 20 }, (_, i) => candidate(`c${i}`, i === 19 ? 'Mara leaves now' : `noise ${i}`));
  const gateway = new PrecisionGateway({ caps: { input: 20, lateInteraction: 10, semanticJudge: 6, final: 4 } });
  const out = await gateway.run({ candidateSet: set(candidates, { maxCandidates: 20 }), currentRevisionSet: revision(), query: 'Mara leaves now' });
  assert.equal(out.inputCandidateCount, 20); assert.ok(out.lateInteractionCandidateCount <= 10); assert.ok(out.semanticJudgeCandidateCount <= 6); assert.ok(out.finalCandidateCount <= 4);
});

test('Precision Gateway deterministically rejects stale candidates before ranking', async () => {
  const gateway = new PrecisionGateway();
  const out = await gateway.run({ candidateSet: set([candidate('old', 'CURRENT Mara leaves', { sourceRevisionRefs: ['src:r5'] })]), currentRevisionSet: revision(['src:r6']) });
  assert.equal(out.staleRejectedCount, 1); assert.equal(out.finalCandidateCount, 0);
});

test('Precision result preserves ranking metadata separately from truth confidence and authority', async () => {
  const gateway = new PrecisionGateway();
  const out = await gateway.run({ candidateSet: set([candidate('hist', 'HISTORICAL Mara left', { truthStatus: 'HISTORICAL', authorityClass: 'OBSERVED' })]), currentRevisionSet: revision(), query: 'where was Mara historically' });
  assert.equal(out.results[0].truthStatus, 'HISTORICAL'); assert.equal(out.results[0].authorityClass, 'OBSERVED'); assert.equal(out.results[0].authorityGranted, false); assert.equal(out.settlementAuthority, false);
});

test('credible contradiction survives score differences for Truth/Gather', async () => {
  const gateway = new PrecisionGateway({ caps: { input: 8, lateInteraction: 6, semanticJudge: 4, final: 3 } });
  const candidates = [candidate('a', 'Blade burned in Tavern', { truthStatus: 'UNRESOLVED' }), candidate('b', 'Blade removed before fire', { truthStatus: 'UNRESOLVED' }), candidate('top', 'CURRENT Tavern destroyed')];
  const out = await gateway.run({ candidateSet: set(candidates), currentRevisionSet: revision(), query: 'What happened to Blade?', conflictSets: [{ id: 'fate', refs: ['a', 'b'], credible: true }] });
  const refs = new Set(out.results.map((row) => row.candidateRef)); assert.ok(refs.has('a')); assert.ok(refs.has('b')); assert.ok(out.conflictSetsPreserved.includes('fate'));
});

test('Ember Tavern golden set preserves current destruction, historical Blade location and unresolved fate', async () => {
  const fixture = createEmberTavernPrecisionFixture();
  const gateway = new PrecisionGateway({ caps: { input: 16, lateInteraction: 8, semanticJudge: 6, final: 5 } });
  const out = await gateway.run({ candidateSet: fixture.candidateSet, currentRevisionSet: fixture.currentRevisionSet, conflictSets: fixture.conflictSets, query: fixture.candidateSet.query });
  const byId = new Map(out.results.map((row) => [row.candidateRef, row]));
  assert.equal(byId.get('tavern:destroyed')?.truthStatus, 'CURRENT'); assert.equal(byId.get('blade:tavern-history')?.truthStatus, 'HISTORICAL');
  assert.equal(byId.get('blade:destroyed')?.truthStatus, 'UNRESOLVED'); assert.equal(byId.get('blade:removed')?.truthStatus, 'UNRESOLVED');
});

test('Truth-compatible evidence set preserves temporal/authority metadata and leaves Truth authority external', async () => {
  const fixture = createEmberTavernPrecisionFixture(); const out = await new PrecisionGateway({ caps: { input: 16, lateInteraction: 8, semanticJudge: 6, final: 5 } }).run({ candidateSet: fixture.candidateSet, currentRevisionSet: fixture.currentRevisionSet, conflictSets: fixture.conflictSets });
  const truth = toTruthCompatibleEvidenceSet(out); assert.equal(truth.rankingAuthority, 'PRECISION_ONLY'); assert.equal(truth.truthClassificationAuthority, 'TRUTH_GATE'); assert.equal(truth.settlementAuthority, false);
});

// Intent/temporal quality

test('permanent intent-opposite corpus shows measurable precision gain over deliberately broad baseline', async () => {
  const gain = await runPrecisionGainBenchmark(); assert.equal(gain.baseline.cases, 16); assert.equal(gain.precision.correct, 16); assert.ok(gain.accuracyGain > .5); assert.equal(gain.providerSuperiorityClaimed, false);
});

test('temporal-opposite corpus distinguishes current from historical evidence', async () => {
  const temporal = await runTemporalPrecisionBenchmark(); assert.equal(temporal.cases, 4); assert.equal(temporal.temporalDiscriminationAccuracy, 1);
});

test('two-stage deterministic benchmark reports negligible extra gain instead of forcing complexity', async () => {
  const out = await runTwoStagePrecisionBenchmark({ secondStageAdapter: new DeterministicSemanticJudgeAdapter() }); assert.equal(out.measurementState, 'MEASURED'); assert.equal(out.accuracyGain, 0); assert.equal(out.materialGain, false);
});

test('candidate scaling benchmark records actual sizes and latency without provider claims', async () => {
  const out = await benchmarkCandidateScaling({ sizes: [8, 64, 256] }); assert.deepEqual(out.rows.map((row) => row.size), [8, 64, 256]); assert.ok(out.rows.every((row) => row.latencyMs >= 0));
});

// Adaptive Retrieval integration / #49

test('HIGH retrieval flows directly into Precision', async () => {
  const gateway = new PrecisionGateway(); const pipeline = new PrecisionRetrievalPipeline({ precisionGateway: gateway });
  const candidateSet = set([candidate('good', 'Mara leaves now', { rankSignals: { dense: 1 } })]);
  const out = await pipeline.run({ query: 'Mara leaves now', initialCandidateSet: candidateSet, qualityEvaluator: async () => ({ quality: RetrievalQuality.HIGH }), currentRevisionSet: revision() });
  assert.equal(out.action, 'PRECISION_COMPLETE'); assert.equal(out.correctivePasses, 0); assert.equal(out.precision.results[0].candidateRef, 'good');
});

test('MIXED retrieval performs one correction then enters Precision when reevaluated HIGH', async () => {
  const pipeline = new PrecisionRetrievalPipeline({ precisionGateway: new PrecisionGateway() }); let corrections = 0;
  const out = await pipeline.run({ query: 'Mara leaves now', initialCandidateSet: set([candidate('weak', 'Mara')]), correctiveRetrieve: async () => { corrections += 1; return set([candidate('good', 'Mara leaves now')]); }, qualityEvaluator: async (_set, { attempt }) => ({ quality: attempt === 0 ? RetrievalQuality.MIXED : RetrievalQuality.HIGH }), currentRevisionSet: revision() });
  assert.equal(corrections, 1); assert.equal(out.correctivePasses, 1); assert.equal(out.action, 'PRECISION_COMPLETE');
});

test('MIXED correction that remains non-HIGH abstains instead of looping', async () => {
  const pipeline = new PrecisionRetrievalPipeline({ precisionGateway: new PrecisionGateway(), maxCorrectiveAttempts: 9 }); let corrections = 0;
  const out = await pipeline.run({ query: 'x', initialCandidateSet: set([candidate('x', 'x')]), correctiveRetrieve: async () => { corrections += 1; return set([candidate('x2', 'x2')]); }, qualityEvaluator: async () => ({ quality: RetrievalQuality.MIXED }) });
  assert.equal(corrections, 1); assert.equal(out.correctivePasses, 1); assert.equal(out.action, 'NO_LONG_TERM_MEMORY');
});

test('LOW retrieval abstains and does not invoke Precision', async () => {
  const pipeline = new PrecisionRetrievalPipeline({ precisionGateway: new PrecisionGateway() }); const out = await pipeline.run({ query: 'x', initialCandidateSet: set([candidate('x', 'x')]), qualityEvaluator: async () => ({ quality: RetrievalQuality.LOW }) });
  assert.equal(out.action, 'NO_LONG_TERM_MEMORY'); assert.equal(out.precision, null); assert.equal(out.allowLongTermMemory, false);
});

test('simple turn may SKIP long-term retrieval entirely', async () => {
  const pipeline = new PrecisionRetrievalPipeline({ precisionGateway: new PrecisionGateway() }); const out = await pipeline.run({ query: 'thanks', initialCandidateSet: set([]), simpleTurn: true }); assert.equal(out.action, 'SKIP'); assert.equal(out.precision, null);
});

// Lore / Memory compatibility, FT003/FT004 side readiness

test('Lore derived candidates retain source drillback and DERIVED status through Precision', async () => {
  const lore = createLoreCandidateFixtures(); const out = await new PrecisionGateway().run({ candidateSet: lore, currentRevisionSet: { sourceRevisionSet: ['lore:ember:r6'], worldRevision: 8, sceneRevision: 4 }, query: lore.query });
  const derived = out.results.filter((row) => row.authorityClass === 'DERIVED'); assert.ok(derived.length); assert.ok(derived.every((row) => row.sourceRevisionRefs.includes('lore:ember:r6')));
});

test('Memory candidates preserve OBSERVED/INFERRED/SETTLED/UNRESOLVED distinctions through Precision', async () => {
  const memory = createMemoryCandidateFixtures(); const out = await new PrecisionGateway().run({ candidateSet: memory, currentRevisionSet: { sourceRevisionSet: ['memory:blade:r4'], worldRevision: 8, sceneRevision: 4 }, query: memory.query, conflictSets: [{ id: 'fate', refs: ['memory:unresolved-a', 'memory:unresolved-b'], credible: true }] });
  const authorities = new Set(out.results.map((row) => row.authorityClass)); assert.ok(authorities.has('OBSERVED')); assert.ok(authorities.has('SETTLED')); assert.ok([...out.results].every((row) => row.authorityGranted === false));
});

test('FT003/FT004 compatibility remains side readiness only with Truth-compatible output', async () => {
  for (const source of [createLoreCandidateFixtures(), createMemoryCandidateFixtures()]) {
    const current = { sourceRevisionSet: source.sourceRevisionSet, worldRevision: source.worldRevision, sceneRevision: source.sceneRevision };
    const out = await new PrecisionGateway().run({ candidateSet: source, currentRevisionSet: current, query: source.query });
    assert.equal(toTruthCompatibleEvidenceSet(out).truthClassificationAuthority, 'TRUTH_GATE');
  }
});

// Provider-side structured output / #46 + FT005

test('precision provider output rejects invented candidate', () => {
  const candidates = [normalizeCandidate(candidate('known', 'x'))];
  assert.throws(() => validatePrecisionProviderOutput({ results: [{ candidateId: 'invented', score: .9, reasonCodes: ['QUERY_MATCH'], sourceRevisionRefs: ['src:r5'], truthStatus: 'CURRENT', authorityClass: 'OBSERVED' }], stageSummary: 'x' }, { candidates, maxResults: 4 }), (error) => error.code === FailureCode.UNKNOWN_REFERENCE);
});

test('precision provider output rejects duplicate result IDs', () => {
  const c = normalizeCandidate(candidate('known', 'x')); const row = { candidateId: 'known', score: .9, reasonCodes: ['QUERY_MATCH'], sourceRevisionRefs: ['src:r5'], truthStatus: 'CURRENT', authorityClass: 'OBSERVED' };
  assert.throws(() => validatePrecisionProviderOutput({ results: [row, row], stageSummary: 'x' }, { candidates: [c], maxResults: 4 }), (error) => error.code === FailureCode.SCHEMA_INVALID);
});

test('precision provider output rejects missing required candidate', () => {
  const c = normalizeCandidate(candidate('required', 'x')); assert.throws(() => validatePrecisionProviderOutput({ results: [], stageSummary: 'x' }, { candidates: [c], requiredCandidateIds: ['required'], maxResults: 4 }), (error) => error.code === FailureCode.UNKNOWN_REFERENCE);
});

test('precision provider output rejects invalid score and reason enum', () => {
  const c = normalizeCandidate(candidate('known', 'x')); const base = { candidateId: 'known', sourceRevisionRefs: ['src:r5'], truthStatus: 'CURRENT', authorityClass: 'OBSERVED' };
  assert.throws(() => validatePrecisionProviderOutput({ results: [{ ...base, score: 1.2, reasonCodes: ['QUERY_MATCH'] }], stageSummary: 'x' }, { candidates: [c] }), (error) => error.code === FailureCode.SCHEMA_INVALID);
  assert.throws(() => validatePrecisionProviderOutput({ results: [{ ...base, score: .8, reasonCodes: ['MADE_UP'] }], stageSummary: 'x' }, { candidates: [c] }), (error) => error.code === FailureCode.SCHEMA_INVALID);
});

test('precision provider output rejects wrong source revision and authority escalation', () => {
  const c = normalizeCandidate(candidate('known', 'x', { truthStatus: 'HISTORICAL', authorityClass: 'OBSERVED' }));
  assert.throws(() => validatePrecisionProviderOutput({ results: [{ candidateId: 'known', score: .8, reasonCodes: ['QUERY_MATCH'], sourceRevisionRefs: ['src:r6'], truthStatus: 'HISTORICAL', authorityClass: 'OBSERVED' }], stageSummary: 'x' }, { candidates: [c] }), (error) => error.code === FailureCode.INVALID_REVISION);
  assert.throws(() => validatePrecisionProviderOutput({ results: [{ candidateId: 'known', score: .8, reasonCodes: ['QUERY_MATCH'], sourceRevisionRefs: ['src:r5'], truthStatus: 'CURRENT', authorityClass: 'SETTLED' }], stageSummary: 'x' }, { candidates: [c] }), (error) => error.code === FailureCode.AUTHORITY_VIOLATION);
});

test('Provider A and Provider B normalize same precision task to same canonical payload shape', async () => {
  const profiles = new CapabilityProfileRegistry();
  for (const id of ['a', 'b']) profiles.register({ profileId: `${id}-profile`, workerId: `${id}-worker`, providerId: id, capabilities: ['LATE_INTERACTION', 'CROSS_ENCODER_RERANK'], capabilityVersions: { LATE_INTERACTION: 1, CROSS_ENCODER_RERANK: 1 } });
  const adapters = new ProviderAdapterRegistry();
  const handler = async ({ input }) => ({ results: input.data.candidates.slice(0, 1).map((c) => ({ candidateId: c.candidateId, score: .9, reasonCodes: ['PROVIDER_RERANK'], sourceRevisionRefs: c.sourceRevisionRefs, truthStatus: c.truthStatus, authorityClass: c.authorityClass })), stageSummary: 'ok' });
  adapters.register(new DeterministicProviderAdapter({ providerId: 'a', capabilities: ['LATE_INTERACTION', 'CROSS_ENCODER_RERANK'], handlers: { PRECISION_RERANK: handler } }));
  adapters.register(new DeterministicProviderAdapter({ providerId: 'b', capabilities: ['LATE_INTERACTION', 'CROSS_ENCODER_RERANK'], handlers: { PRECISION_RERANK: handler } }));
  const layer = new SpecialistExecutionLayer({ profiles, adapters }); const task = createPrecisionTask({ taskId: 'p', turnId: 't', correlationId: 'c', inputRevisionSet: revision(), intentFingerprint: 'i' }); const input = { candidates: [candidate('known', 'Mara leaves now')], query: 'Mara leaves now', maxResults: 1 };
  const a = await layer.execute(task, { input, profileId: 'a-profile' }); const b = await layer.execute(task, { input, profileId: 'b-profile' });
  assert.deepEqual(Object.keys(a.payload).sort(), Object.keys(b.payload).sort()); assert.deepEqual(a.payload.results, b.payload.results); assert.equal(a.authorityClass, 'UNRESOLVED'); assert.equal(b.authorityClass, 'UNRESOLVED');
});

test('capability fallback profile can satisfy precision task without changing task semantics', async () => {
  const profiles = new CapabilityProfileRegistry(); profiles.register({ profileId: 'fallback-profile', workerId: 'fw', providerId: 'fallback-provider', capabilities: ['RERANK'] });
  const adapters = new ProviderAdapterRegistry(); adapters.register(new DeterministicProviderAdapter({ providerId: 'fallback-provider', capabilities: ['RERANK'], handlers: { PRECISION_RERANK: async ({ input }) => ({ results: [{ candidateId: input.data.candidates[0].candidateId, score: .8, reasonCodes: ['PROVIDER_RERANK'], sourceRevisionRefs: input.data.candidates[0].sourceRevisionRefs, truthStatus: input.data.candidates[0].truthStatus, authorityClass: input.data.candidates[0].authorityClass }], stageSummary: 'fallback-capability' }) } }));
  const layer = new SpecialistExecutionLayer({ profiles, adapters }); const task = createPrecisionTask({ taskId: 'cap-fallback', turnId: 't', correlationId: 'c', inputRevisionSet: revision(), intentFingerprint: 'i' });
  const result = await runProviderQualification({ registry: profiles, executionLayer: layer, task, input: { candidates: [candidate('known', 'Mara leaves now')], query: 'Mara leaves now', maxResults: 1 } });
  assert.equal(result.status, 'SUCCESS'); assert.equal(result.negotiation.degraded, true); assert.equal(result.negotiation.fallbackSetUsed, 0); assert.equal(result.result.payload.results[0].candidateId, 'known');
});

test('forced Provider A outage falls back to Provider B with same normalized precision contract', async () => {
  const profiles = new CapabilityProfileRegistry();
  for (const id of ['a', 'b']) profiles.register({ profileId: `${id}-profile`, workerId: `${id}-worker`, providerId: id, capabilities: ['LATE_INTERACTION', 'CROSS_ENCODER_RERANK'], capabilityVersions: { LATE_INTERACTION: 1, CROSS_ENCODER_RERANK: 1 } });
  const adapters = new ProviderAdapterRegistry();
  adapters.register(new DeterministicProviderAdapter({ providerId: 'a', capabilities: ['LATE_INTERACTION', 'CROSS_ENCODER_RERANK'], handlers: { PRECISION_RERANK: async () => { const e = new Error('offline'); e.code = FailureCode.PROVIDER_UNAVAILABLE; throw e; } } }));
  adapters.register(new DeterministicProviderAdapter({ providerId: 'b', capabilities: ['LATE_INTERACTION', 'CROSS_ENCODER_RERANK'], handlers: { PRECISION_RERANK: async ({ input }) => ({ results: [{ candidateId: input.data.candidates[0].candidateId, score: .9, reasonCodes: ['PROVIDER_RERANK'], sourceRevisionRefs: input.data.candidates[0].sourceRevisionRefs, truthStatus: input.data.candidates[0].truthStatus, authorityClass: input.data.candidates[0].authorityClass }], stageSummary: 'fallback' }) } }));
  const layer = new SpecialistExecutionLayer({ profiles, adapters }); const task = createPrecisionTask({ taskId: 'fallback', turnId: 't', correlationId: 'c', inputRevisionSet: revision(), intentFingerprint: 'i' });
  const result = await runProviderQualification({ registry: profiles, executionLayer: layer, task, input: { candidates: [candidate('known', 'Mara leaves now')], query: 'Mara leaves now', maxResults: 1 } });
  assert.equal(result.status, 'FALLBACK'); assert.deepEqual(result.attempts.map((x) => x.status), ['FAILED', 'SUCCESS']); assert.equal(result.result.payload.results[0].candidateId, 'known');
});

// Fallback / deadline / capability / placement

test('Precision Gateway safely falls back to deterministic baseline when precision adapter fails', async () => {
  const broken = { adapterId: 'broken', async rank() { throw new Error('unavailable'); } }; const out = await new PrecisionGateway({ lateInteractionAdapter: broken }).run({ candidateSet: set([candidate('good', 'Mara leaves now')]), currentRevisionSet: revision() });
  assert.equal(out.fallbackStage, PrecisionFallbackStage.DETERMINISTIC_BASELINE); assert.ok(out.stagesUsed.includes(PrecisionStage.DETERMINISTIC_FALLBACK)); assert.equal(out.finalCandidateCount, 1);
});

test('late optional second stage cannot extend hard deadline when first-stage result exists', () => {
  assert.deepEqual(precisionDeadlineDecision({ now: 121, softDeadline: 60, hardDeadline: 120, firstStageReady: true, secondStageReady: false }), { action: 'USE_FIRST_STAGE', reason: 'HARD_DEADLINE_SECOND_STAGE_MISSED', canBlockSeal: false });
});

test('Precision Runtime obligation remains HOT and exposes deterministic fallback without scheduling authority', () => {
  const task = createPrecisionTask({ taskId: 'ob', turnId: 't', correlationId: 'c', inputRevisionSet: revision(), intentFingerprint: 'i' }); const obligation = toRuntimeObligation(task);
  assert.equal(obligation.runtimeClass, 'HOT'); assert.equal(obligation.resultClass, 'REQUIRED'); assert.equal(obligation.schedulingDecision, null); assert.equal(obligation.fallbackContract.type, 'PRECISION_LADDER');
});

test('placement policy exposes precision as HOT L1', () => { assert.equal(CoprocessorPlacementPolicy.PRECISION_RERANK.placement, 'HOT'); assert.deepEqual(CoprocessorPlacementPolicy.PRECISION_RERANK.layers, ['L1']); });

// External benchmark adapters / #42

test('FlashRank and ColBERT benchmark seams remain optional and NOT_MEASURED without runners', async () => {
  const availability = externalPrecisionAvailability(); assert.equal(availability.flashRank.status, 'NOT_MEASURED'); assert.equal(availability.colBert.status, 'NOT_MEASURED');
  assert.equal((await runExternalPrecisionBenchmark({ adapterId: 'flashrank' })).measurementState, 'NOT_MEASURED');
  await assert.rejects(() => createFlashRankBenchmarkAdapter().rank({ query: 'x', candidates: [] })); await assert.rejects(() => createColBertBenchmarkAdapter().rank({ query: 'x', candidates: [] }));
});

// Telemetry / #86 + benchmark / #87

test('precision telemetry is bounded/reference-oriented and summarizes counts without raw candidate bodies', () => {
  const telemetry = new CoprocessorTelemetry({ limit: 16 });
  telemetry.emit(TelemetryEvent.PRECISION_REQUEST, { inputCandidateCount: 100, qualityClass: 'MIXED', correctivePass: true, rawPrompt: 'secret', candidateBodies: ['secret'] });
  telemetry.emit(TelemetryEvent.PRECISION_STAGE, { stage: 'LATE_INTERACTION', outputCandidateCount: 20, latencyMs: 4, providerId: 'p' });
  telemetry.emit(TelemetryEvent.CANDIDATE_REJECTED, { candidateRef: 'stale', stale: true, reason: 'STALE' });
  const events = telemetry.list(); assert.equal('rawPrompt' in events[0].payload, false); assert.equal('candidateBodies' in events[0].payload, false);
  const summary = summarizePrecisionTelemetry(events); assert.equal(summary.inputCandidates, 100); assert.equal(summary.outputCandidates, 20); assert.equal(summary.correctivePasses, 1); assert.equal(summary.staleRejected, 1);
});

test('Wave 4 benchmark harness keeps unmeasured resource/provider metrics explicit', async () => {
  const gain = await runPrecisionGainBenchmark(); const temporal = await runTemporalPrecisionBenchmark();
  const summary = summarizeWave4PrecisionQualification({ broadBaseline: gain.baseline, precision: gain.precision, temporal, contradiction: [true], fallback: [true], providerInterchange: [true] });
  assert.equal(summary.metrics.measurablePrecisionGain.status, Wave4MeasurementStatus.MEASURED); assert.equal(summary.metrics.flashRank.status, Wave4MeasurementStatus.NOT_MEASURED); assert.equal(summary.metrics.peakRamMb.status, Wave4MeasurementStatus.NOT_MEASURED);
});

// Browser safety

test('Wave 4 production precision modules contain no Node-only runtime dependencies', async () => {
  for (const rel of ['../src/coprocessor/candidate-bus.js','../src/coprocessor/precision-gateway.js','../src/coprocessor/precision-validation.js','../src/coprocessor/precision-retrieval-pipeline.js','../src/coprocessor/precision-specialists.js','../src/coprocessor/precision-truth-boundary.js','../src/coprocessor/precision-telemetry.js']) {
    const text = await readFile(new URL(rel, import.meta.url), 'utf8'); assert.doesNotMatch(text, /\bBuffer\b|from\s+['"]node:|\bprocess\.|\brequire\s*\(|from\s+['"](?:fs|path|worker_threads)['"]/);
  }
});

test('representative production precision path works with Buffer/process conveniences unavailable', async () => {
  const originalBuffer = globalThis.Buffer; const originalProcess = globalThis.process;
  try { globalThis.Buffer = undefined; globalThis.process = undefined; const fixture = createEmberTavernPrecisionFixture(); const out = await new PrecisionGateway({ caps: { input: 16, lateInteraction: 8, semanticJudge: 6, final: 5 } }).run({ candidateSet: fixture.candidateSet, currentRevisionSet: fixture.currentRevisionSet, conflictSets: fixture.conflictSets }); assert.ok(out.finalCandidateCount > 0); }
  finally { globalThis.Buffer = originalBuffer; globalThis.process = originalProcess; }
});
