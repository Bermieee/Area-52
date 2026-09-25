import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  AdaptiveRetrievalController, Capability, CapabilityProfileRegistry, ConsolidationBacklog, ConsolidationProposalKind,
  CoprocessorPlacementPolicy, CoprocessorTelemetry, CorrectiveRetrievalAction, DeterministicPrecisionAdapter, DeterministicProviderAdapter,
  DynamicFanOutPlanner, FailureCode, GreenRoomStore, Placement, PRECISION_INTENT_OPPOSITE_CORPUS,
  ProviderAdapterRegistry, ResultClass, RetrievalQuality, SpecialistExecutionLayer, SpeculativeContextWarmer, StreamingTruthMode, StreamingTruthObserver,
  TelemetryEvent, TruthViolationClassification, WarmPacketCache, WarmState, Wave3MeasurementStatus,
  adaptSceneEvent, adaptScenePublicSignals, createConsolidationProposal, createConsolidationTask,
  createCognitiveTask, createConsolidationUnit, createGreenRoomBatch, createGreenRoomInference, createRevisionSet, createTurnEnvelope,
  createWarmIdentity, createWarmPacket, evaluateRetrievalQuality, evaluateWarmPacket, isHardInterceptEligible,
  normalizePrefetchRecommendation, plannerInputFromScene, retrievalControlDecision, runPrecisionBenchmark,
  selectActiveGreenRoomBatch, sourceFactRetention, summarizeWave3Qualification, toRuntimeObligation,
  validateConsolidationProviderOutput, validateGreenRoomProviderOutput, validateTruthMonitorReceipt,
  wave3SpecialistForTask,
} from '../src/coprocessor/index.js';

function turn(id = 'w3') {
  return createTurnEnvelope({ turnId: id, eventId: `evt:${id}`, correlationId: `corr:${id}`, dedupeKey: `turn:${id}`, sourceRevisionSet: ['src:1'], worldRevision: 5, sceneRevision: 7, characterStateRevision: 3, createdAt: 0 });
}
function identity(overrides = {}) { return createWarmIdentity({ sceneRevision: 7, worldRevision: 5, characterStateRevision: 3, sourceRevisionSet: ['src:1'], intentFingerprint: 'intent:blade', retrievalPolicyRevision: '1', ...overrides }); }
function artifact(id = 'episode:1', revision = 1) { return { kind: 'ArtifactReference', artifactId: id, artifactType: 'SceneEpisode', owner: 'SCENE_INTELLIGENCE', revision, storageDomain: 'episodes', sourceRevisionSet: ['src:1'] }; }

// Dynamic Fan-Out / #93

test('Wave 3 fan-out emits expected-value nominations with reason codes and revision fences', () => {
  const plan = new DynamicFanOutPlanner().plan({ turnEvent: turn(), text: 'Where is the Sun Blade now?', queryIntent: 'LOCATION', activeCast: ['Eris'], activeThreads: ['sun-blade'], uncertainSceneFields: ['location'], retrievalQuality: 'MIXED' });
  assert.ok(plan.tasks.length >= 3);
  assert.equal(plan.nominations.length, plan.tasks.length);
  assert.ok(plan.nominations.every((n) => n.expectedValue > 0 && n.reasonCodes.length && n.requiredInputs.length && n.freshnessFence.sceneRevision === 7));
  assert.ok(plan.nominations.every((n) => n.providerIdentity === null && n.canonicalAuthority === false));
});

test('Wave 3 fan-out keeps zero-worker success legal when hot state is sufficient', () => {
  const plan = new DynamicFanOutPlanner().plan({ turnEvent: turn('zero'), text: 'Thanks!', hotStateSufficient: true });
  assert.equal(plan.tasks.length, 0); assert.match(plan.reason, /zero-worker/); assert.equal(plan.budget.foregroundWorkers, 0);
});

test('Wave 3 fan-out independently caps foreground, opportunistic, background and cost', () => {
  const plan = new DynamicFanOutPlanner().plan({ turnEvent: turn('caps'), text: 'Mara asks where the Blade is now.', queryIntent: 'LOCATION', activeCast: ['Mara', 'Eris'], conflictSignals: ['blade'], backgroundSignals: { consolidationPending: true, expectedValue: .9 }, expectedValue: { consolidation: .9 }, resourceConstraint: { maxForegroundWorkers: 2, maxOpportunisticWorkers: 0, maxBackgroundNominations: 1, maxCostUnits: 7 }, maxFanOut: 4 });
  assert.ok(plan.budget.foregroundWorkers <= 2); assert.equal(plan.budget.opportunisticWorkers, 0); assert.ok(plan.budget.backgroundNominations <= 1); assert.ok(plan.budget.estimatedCostUnits <= 7);
});

test('fan-out cannot nominate a role whose capabilities do not exist', () => {
  const plan = new DynamicFanOutPlanner().plan({ turnEvent: turn('caps-missing'), text: 'Where is the Blade?', queryIntent: 'LOCATION', availableCapabilities: [Capability.RETRIEVAL, Capability.LONG_CONTEXT] });
  assert.deepEqual(plan.tasks.map((t) => t.metadata.roleId), ['historian']);
});

test('fresh warm state suppresses unnecessary historian work for continuity-only turn', () => {
  const plan = new DynamicFanOutPlanner().plan({ turnEvent: turn('warm-plan'), text: 'Continue this thread.', activeThreads: ['blade'], warmState: WarmState.FRESH });
  assert.equal(plan.tasks.some((task) => task.metadata.roleId === 'historian'), false);
});

// Scene -> Coprocessor / FT002 side readiness

test('Scene public signal adapter consumes Worker 3 provider-neutral public shape', () => {
  const recommendation = { kind: 'PrefetchRecommendation', recommendationId: 'p1', sceneId: 'scene:1', sceneRevision: 7, trigger: 'thread', entityRefs: ['Eris'], locationRefs: ['Tavern'], threadRefs: ['blade'], sceneRefs: ['scene:0'], priority: 'HIGH', expiryRevision: 9, evidenceRefs: ['src:1'], authority: 'NONE', status: 'ACTIVE' };
  const adapted = adaptScenePublicSignals({ sceneRevision: 7, activeCast: [{ characterId: 'Eris' }], location: 'Ruins', activeThreads: ['blade'], uncertainFields: ['location'], conflictSignals: ['blade-fate'], sceneRelationship: 'CONTINUES', retrievalQuality: 'MIXED', prefetchRecommendations: [recommendation] });
  assert.deepEqual(adapted.sceneEntities, ['Eris']); assert.equal(adapted.prefetchRecommendations[0].authority, 'NONE'); assert.equal(adapted.retrievalQuality, 'MIXED');
});

test('PREFETCH_RECOMMENDED event adapts without importing Scene implementation', () => {
  const event = adaptSceneEvent({ eventType: 'PREFETCH_RECOMMENDED', sceneId: 'scene:1', sceneRevision: 7, payload: { recommendation: { kind: 'PrefetchRecommendation', recommendationId: 'p2', sceneId: 'scene:1', sceneRevision: 7, trigger: 'cast', entityRefs: ['Mara'], expiryRevision: 9, authority: 'NONE' } } });
  assert.equal(event.prefetchRecommendations.length, 1); assert.equal(event.prefetchRecommendations[0].entityRefs[0], 'Mara');
});

test('FT002 contract fixtures map scene changes into planner inputs without claiming FT002 pass', () => {
  const cases = [
    ['same-scene dialogue', { eventType: 'ACTIVE_CAST_CHANGED', sceneId: 's', sceneRevision: 2, payload: { change: { value: ['Mara', 'Eris'] } } }],
    ['location change', { eventType: 'LOCATION_CHANGED', sceneId: 's', sceneRevision: 3, payload: { change: { value: 'Forge' } } }],
    ['cast exit', { eventType: 'ACTIVE_CAST_CHANGED', sceneId: 's', sceneRevision: 4, payload: { change: { value: ['Eris'] } } }],
    ['time shift', { eventType: 'TIME_SHIFT_DETECTED', sceneId: 's', sceneRevision: 5, payload: {} }],
    ['flashback', { eventType: 'SCENE_OPENED', sceneId: 'flash', sceneRevision: 1, payload: { relationshipToPrior: 'FLASHBACK_OF' } }],
    ['resumed scene', { eventType: 'SCENE_OPENED', sceneId: 's', sceneRevision: 6, payload: { relationshipToPrior: 'RESUMES' } }],
    ['false boundary', { eventType: 'SCENE_BOUNDARY_CANDIDATE', sceneId: 's', sceneRevision: 6, payload: { candidate: { proposedBoundaryType: 'MIXED' } } }],
    ['uncertain correction', { eventType: 'SCENE_STATE_DELTA', sceneId: 's', sceneRevision: 7, payload: { delta: { refreshReasons: ['LOW_CONFIDENCE_CHAIN'] } } }],
  ];
  for (const [name, event] of cases) {
    const input = plannerInputFromScene({ events: [event], base: { text: name } });
    const plan = new DynamicFanOutPlanner().plan({ turnEvent: turn(`ft2:${name}`), ...input, text: name });
    assert.ok(Array.isArray(plan.tasks)); assert.ok(plan.tasks.every((task) => !('providerId' in task)));
  }
});

// Speculative Context Warmer / #77

test('WarmPacket is FRESH only when all identity fences match', () => {
  const packet = createWarmPacket({ identity: identity(), candidateRefs: ['a'], evidenceRefs: ['e'], compiledRepresentation: { refs: ['a'] }, expiresAfterTurns: 2 });
  const result = evaluateWarmPacket(packet, identity(), { turnSequence: 1, storedTurn: 0 });
  assert.equal(result.state, WarmState.FRESH); assert.deepEqual(result.compiledRepresentation, { refs: ['a'] }); assert.equal(result.requiresForegroundRetrieval, false);
});

test('warm packet from previous Scene is rejected from foreground', () => {
  const packet = createWarmPacket({ identity: identity({ sceneRevision: 6 }), candidateRefs: ['a'], compiledRepresentation: { refs: ['a'] } });
  const result = evaluateWarmPacket(packet, identity());
  assert.equal(result.state, WarmState.STALE); assert.equal(result.compiledRepresentation, null); assert.equal(result.requiresForegroundRetrieval, true);
});

test('same Scene but different intent never blindly reuses warm packet', () => {
  const packet = createWarmPacket({ identity: identity({ intentFingerprint: 'intent:old' }), candidateRefs: ['a'], compiledRepresentation: { refs: ['a'] } });
  assert.equal(evaluateWarmPacket(packet, identity()).state, WarmState.INVALID);
});

test('partially stale warm packet salvages references but forces rerank/revalidate/recompile', () => {
  const packet = createWarmPacket({ identity: identity({ sourceRevisionSet: ['src:1', 'src:old'] }), candidateRefs: ['candidate:1'], evidenceRefs: ['src:1'], compiledRepresentation: { unsafe: true } });
  const result = evaluateWarmPacket(packet, identity({ sourceRevisionSet: ['src:1', 'src:new'] }));
  assert.equal(result.state, WarmState.PARTIALLY_STALE); assert.ok(result.salvageableRefs.includes('candidate:1')); assert.equal(result.compiledRepresentation, null); assert.equal(result.requiresRerank, true);
});

test('WarmPacket cache is capacity bounded and repeat warming never grants authority', () => {
  const cache = new WarmPacketCache({ capacity: 2 });
  for (let i = 0; i < 3; i++) cache.put(createWarmPacket({ identity: identity({ intentFingerprint: `intent:${i}` }), candidateRefs: [`c${i}`] }), { turnSequence: i });
  assert.equal(cache.size(), 2); assert.equal(cache.metrics().evictions, 1);
  const value = cache.evaluate(identity({ intentFingerprint: 'intent:2' }), { turnSequence: 3 });
  assert.equal(value.state, WarmState.FRESH); assert.equal(value.authority, 'NONE');
});

test('Speculative warmer failure degrades latency only and falls back to foreground retrieval', async () => {
  const warmer = new SpeculativeContextWarmer({ retrieve: async () => { throw new Error('offline'); }, evaluateQuality: async () => ({ quality: 'HIGH' }) });
  const out = await warmer.prepare({ recommendation: { recommendationId: 'p3', sceneId: 's', sceneRevision: 7, trigger: 'thread', expiryRevision: 9, authority: 'NONE' }, identity: identity() });
  assert.equal(out.status, 'WARMER_FAILED'); assert.equal(out.correctnessDegraded, false); assert.equal(out.foregroundFallback, 'NORMAL_FOREGROUND_RETRIEVAL');
});

test('Speculative warmer executes retrieval -> quality -> truth -> precision -> compile pipeline', async () => {
  const calls = [];
  const warmer = new SpeculativeContextWarmer({
    retrieve: async () => { calls.push('retrieve'); return { candidateRefs: ['a'], evidenceRefs: ['src:1'] }; },
    evaluateQuality: async () => { calls.push('quality'); return { quality: 'HIGH' }; },
    truthCheck: async () => { calls.push('truth'); return { status: 'ok' }; },
    precisionRank: async () => { calls.push('precision'); return { ranking: ['a'] }; },
    compile: async () => { calls.push('compile'); return { refs: ['a'] }; },
  });
  const out = await warmer.prepare({ recommendation: { recommendationId: 'p4', sceneId: 's', sceneRevision: 7, trigger: 'thread', expiryRevision: 9, authority: 'NONE' }, identity: identity() });
  assert.deepEqual(calls, ['retrieve', 'quality', 'truth', 'precision', 'compile']); assert.equal(out.status, 'WARMED'); assert.equal(out.packet.authority, 'NONE');
});

// Adaptive Retrieval / #49

test('retrieval HIGH proceeds but does not itself grant truth authority', () => {
  const q = evaluateRetrievalQuality({ candidateCount: 4, relevantCount: 4, confidence: .9, requiredCoverage: .75 });
  const decision = retrievalControlDecision({ quality: q.quality });
  assert.equal(q.quality, RetrievalQuality.HIGH); assert.equal(decision.action, 'PROCEED'); assert.equal(decision.canonicalTruthGranted, false);
});

test('MIXED retrieval receives at most one corrective pass and then stops on LOW', async () => {
  let calls = 0;
  const controller = new AdaptiveRetrievalController({ maxCorrectiveAttempts: 9, chooseCorrectiveAction: () => CorrectiveRetrievalAction.TEMPORAL_NARROWING });
  const out = await controller.run({
    query: 'blade',
    retrieve: async ({ attempt }) => { calls += 1; return attempt === 0 ? { quality: 'MIXED' } : { quality: 'LOW' }; },
    evaluate: async (result) => ({ quality: result.quality }),
  });
  assert.equal(calls, 2); assert.equal(out.correctivePasses, 1); assert.equal(out.action, 'NO_LONG_TERM_MEMORY'); assert.equal(out.allowLongTermMemory, false);
});

test('retrieval LOW abstains instead of injecting garbage memory', () => {
  const q = evaluateRetrievalQuality({ candidateCount: 3, relevantCount: 0, confidence: .2 });
  assert.equal(q.quality, RetrievalQuality.LOW); assert.equal(retrievalControlDecision({ quality: q.quality }).allowLongTermMemory, false);
});

test('simple hot-satisfied turn may SKIP retrieval', () => {
  assert.equal(retrievalControlDecision({ quality: RetrievalQuality.HIGH, simpleTurn: true }).action, 'SKIP');
});

// Green Room / #78

test('Green Room supports sparse optional dimensions with required evidence metadata', () => {
  const row = createGreenRoomInference({ characterRef: 'Mara', sceneRevision: 7, evidenceRefs: ['src:1'], confidence: .72, createdAt: 10, dimensions: { anger: .8, latentIntent: 'leave quietly' }, expiryCondition: { ttlTurns: 2 }, sourceRevisionSet: ['src:1'] });
  assert.deepEqual(Object.keys(row.dimensions), ['anger', 'latentIntent']); assert.equal(row.authority, 'INFERRED'); assert.equal(row.memoryMutation, false);
});

test('Green Room rejects canonical authority claims', () => {
  assert.throws(() => createGreenRoomInference({ characterRef: 'Mara', sceneRevision: 7, evidenceRefs: ['src:1'], confidence: .5, createdAt: 0, authority: 'CURRENT', dimensions: {} }), (error) => error.code === FailureCode.AUTHORITY_VIOLATION);
});

test('Green Room batch rejects duplicate characters', () => {
  assert.throws(() => createGreenRoomBatch({ sceneRevision: 7, characters: [
    { characterRef: 'Mara', evidenceRefs: ['src:1'], confidence: .5, dimensions: {} },
    { characterRef: 'Mara', evidenceRefs: ['src:1'], confidence: .6, dimensions: {} },
  ] }), (error) => error.code === FailureCode.SCHEMA_INVALID);
});

test('Green Room provider validation rejects unknown evidence and expired Scene revision', () => {
  const value = { sceneRevision: 7, authority: 'INFERRED', characters: [{ characterRef: 'Mara', sceneRevision: 7, evidenceRefs: ['unknown'], confidence: .5, createdAt: 0, dimensions: {}, expiryCondition: { ttlTurns: 1 } }] };
  assert.throws(() => validateGreenRoomProviderOutput(value, { sceneRevision: 7, knownEvidenceRefs: ['src:1'] }), (error) => error.code === FailureCode.UNKNOWN_REFERENCE);
  assert.throws(() => validateGreenRoomProviderOutput({ ...value, sceneRevision: 6, characters: [{ ...value.characters[0], sceneRevision: 6, evidenceRefs: ['src:1'] }] }, { sceneRevision: 7, knownEvidenceRefs: ['src:1'] }), (error) => error.code === FailureCode.STALE_RESULT);
});

test('Green Room false persistence regression: Scene A anger cannot survive Scene close into Scene B', () => {
  const store = new GreenRoomStore({ defaultTtlTurns: 5 });
  store.putBatch({ sceneRevision: 1, characters: [{ characterRef: 'Mara', evidenceRefs: ['a'], confidence: .9, dimensions: { anger: .9 }, sourceRevisionSet: ['src:a'] }] }, { turnSequence: 1, activeCharacterRefs: ['Mara'] });
  assert.equal(store.get('Mara', { sceneRevision: 1, turnSequence: 2, activeCharacterRefs: ['Mara'] }).dimensions.anger, .9);
  store.invalidate({ sceneClosed: true });
  assert.equal(store.get('Mara', { sceneRevision: 2, turnSequence: 3, activeCharacterRefs: ['Mara'] }), null);
});

test('Green Room cache bounds active characters, history and batch selection', () => {
  const store = new GreenRoomStore({ maxCharacters: 2, maxHistory: 2 });
  for (const characterRef of ['A', 'B', 'C']) store.putBatch({ sceneRevision: 7, characters: [{ characterRef, evidenceRefs: ['src:1'], confidence: .5, dimensions: {} }] });
  assert.equal(store.size(), 2); assert.equal(store.historySize(), 2);
  assert.deepEqual(selectActiveGreenRoomBatch([{ characterId: 'A', presence: 'PRESENT' }, { characterId: 'B', presence: 'MENTIONED_ONLY' }, { characterId: 'C', presence: 'UNCERTAIN' }], { maxCharacters: 2 }), ['A', 'C']);
});

test('repeated compatible Green Room evidence creates proposal-only ReflectionCandidate', () => {
  const store = new GreenRoomStore({ maxHistory: 8 });
  for (let i = 0; i < 3; i++) store.putBatch({ sceneRevision: 7, characters: [{ characterRef: 'Mara', evidenceRefs: [`e${i}`], confidence: .7, dimensions: { warmth: .6 } }] }, { turnSequence: i });
  const candidate = store.createReflectionCandidate('Mara');
  assert.equal(candidate.kind, 'ReflectionCandidate'); assert.equal(candidate.authority, 'INFERRED'); assert.equal(candidate.durableMutation, false);
});

// Continuous Consolidation / #79

test('consolidation task is DEEP L3, reference-first, yieldable and resumable through Runtime obligation', () => {
  const unit = createConsolidationUnit({ unitId: 'u1', artifactRefs: [artifact()], sourceRevisionSet: ['src:1'], worldRevision: 5, sceneRevision: 7, characterStateRevision: 3, resumeIdentity: 'resume:u1' });
  const task = createConsolidationTask(unit, { softDeadline: 100, hardDeadline: 500, maxSliceUnits: 8, maxUnitsPerCheckpoint: 8 });
  const obligation = toRuntimeObligation(task);
  assert.equal(task.placement, Placement.DEEP); assert.equal(task.resultClass, ResultClass.DEFERRED); assert.equal(task.cognitiveLayer, 'L3');
  assert.equal(obligation.yieldPolicy.legal, true); assert.equal(obligation.yieldPolicy.resumeIdentity, 'resume:u1'); assert.equal(obligation.checkpointPolicy.storageOwnedByRuntime, true); assert.equal(obligation.schedulingDecision, null);
});

test('consolidation proposal is proposal-only and rejects Settlement or source deletion claims', () => {
  const base = { proposalId: 'cp1', proposalKind: ConsolidationProposalKind.CLAIM_CANDIDATE, sourceArtifactRefs: [artifact()], sourceRevisionSet: ['src:1'], worldRevision: 5, sceneRevision: 7, characterStateRevision: 3, payload: { claim: 'x' } };
  assert.equal(createConsolidationProposal(base).memoryMutation, false);
  assert.throws(() => createConsolidationProposal({ ...base, settlementAuthority: true }), (error) => error.code === FailureCode.AUTHORITY_VIOLATION);
  assert.throws(() => createConsolidationProposal({ ...base, deleteSourceTurns: true }), (error) => error.code === FailureCode.AUTHORITY_VIOLATION);
});

test('stale consolidation output cannot become active durable memory', () => {
  const value = { proposalId: 'cp2', proposalKind: ConsolidationProposalKind.EPISODE_SUMMARY, sourceArtifactRefs: [artifact()], sourceRevisionSet: ['src:old'], worldRevision: 5, sceneRevision: 7, characterStateRevision: 3, payload: {} };
  assert.throws(() => validateConsolidationProviderOutput(value, { currentRevisionSet: { sourceRevisionSet: ['src:new'], worldRevision: 5, sceneRevision: 7, characterStateRevision: 3 } }), (error) => error.code === FailureCode.STALE_RESULT);
});

test('consolidation backlog exposes pending age/checkpoint/superseded/stale pressure without scheduling', () => {
  const backlog = new ConsolidationBacklog({ capacity: 3 });
  backlog.enqueue({ unitId: 'a', artifactRefs: [artifact('a')], sourceRevisionSet: ['src:1'], worldRevision: 5, sceneRevision: 7, characterStateRevision: 3, createdAt: 1, priority: 2 });
  backlog.enqueue({ unitId: 'b', artifactRefs: [artifact('b')], sourceRevisionSet: ['src:1'], worldRevision: 5, sceneRevision: 7, characterStateRevision: 3, createdAt: 2, priority: 1 });
  backlog.checkpoint('a', { offset: 1 }); backlog.supersede('b', 'c');
  assert.equal(backlog.pending({ now: 10 })[0].age, 9);
  assert.equal(backlog.discardStale({ sourceRevisionSet: ['src:new'], worldRevision: 5, sceneRevision: 7, characterStateRevision: 3 }), 1);
  assert.equal(backlog.metrics({ now: 10 }).staleDiscarded, 1);
});

test('consolidation qualification fails when a unique source fact is lost', () => {
  const result = sourceFactRetention({ sourceFacts: ['A', 'B', 'C'], proposalFacts: ['A', 'B'] });
  assert.equal(result.pass, false); assert.equal(result.lost, 1);
});

// Streaming Truth / #80

test('Streaming Truth OBSERVE preserves historical statement and does not intercept', async () => {
  const observer = new StreamingTruthObserver({ deterministicCheck: async () => ({ classification: 'SUPPORTED', confidence: 1, severity: 'NONE', temporalContext: 'HISTORICAL', currentCanonViolation: false, deterministic: true }) });
  const out = await observer.push('She remembered when the Ember Tavern stood intact.');
  assert.equal(out.mode, StreamingTruthMode.OBSERVE); assert.equal(out.intercepted, false); assert.equal(out.releasedText, 'She remembered when the Ember Tavern stood intact.'); assert.equal(out.observations[0].temporalContext, 'HISTORICAL');
});

test('VERIFIED_CHUNKS buffers incomplete text and releases checked complete chunks', async () => {
  const observer = new StreamingTruthObserver({ mode: StreamingTruthMode.VERIFIED_CHUNKS, deterministicCheck: async () => ({ classification: 'SUPPORTED', confidence: 1, claimSpan: { start: 0, end: 20 } }) });
  assert.equal((await observer.push('The intact')).releasedText, '');
  const out = await observer.push(' memory remained.');
  assert.match(out.releasedText, /memory remained/); assert.equal(out.intercepted, false);
});

test('HARD_INTERCEPT remains opt-in and only blocks deterministic high-confidence current-canon violations', async () => {
  const disabled = new StreamingTruthObserver({ mode: StreamingTruthMode.HARD_INTERCEPT, deterministicCheck: async () => ({ classification: 'VIOLATION', confidence: 1, severity: 'HIGH', temporalContext: 'CURRENT', currentCanonViolation: true, deterministic: true }) });
  assert.equal((await disabled.push('The intact Ember Tavern stood before her.')).mode, StreamingTruthMode.OBSERVE);
  const enabled = new StreamingTruthObserver({ mode: StreamingTruthMode.HARD_INTERCEPT, hardInterceptEnabled: true, deterministicCheck: async () => ({ classification: 'VIOLATION', confidence: .99, severity: 'HIGH', temporalContext: 'CURRENT', currentCanonViolation: true, deterministic: true }) });
  const out = await enabled.push('The intact Ember Tavern stood before her.');
  assert.equal(out.intercepted, true); assert.equal(out.releasedText, '');
});

test('metaphor or ambiguity abstains from hard interception', () => {
  assert.equal(isHardInterceptEligible({ classification: 'VIOLATION', deterministic: true, currentCanonViolation: true, temporalContext: 'CURRENT', creativeAmbiguity: true, confidence: 1, severity: 'HIGH' }), false);
  assert.equal(isHardInterceptEligible({ classification: 'AMBIGUOUS', deterministic: false, currentCanonViolation: false, temporalContext: 'CURRENT', creativeAmbiguity: false, confidence: .4, severity: 'LOW' }), false);
});

test('Streaming Truth checker failure fails open and generation continues unverified', async () => {
  const observer = new StreamingTruthObserver({ mode: StreamingTruthMode.VERIFIED_CHUNKS, deterministicCheck: async () => { throw new Error('checker offline'); } });
  const out = await observer.push('The Tavern doors opened.');
  assert.equal(out.intercepted, false); assert.equal(out.verificationFailedOpen, true); assert.match(out.releasedText, /Tavern/); assert.equal(out.observations[0].classification, TruthViolationClassification.CHECK_FAILED);
});

test('Truth Monitor provider receipt missing claim span fails closed', () => {
  assert.throws(() => validateTruthMonitorReceipt({ classification: 'SUPPORTED', confidence: 1 }), (error) => error.code === FailureCode.SCHEMA_INVALID);
});

// Telemetry / benchmarks / placement / structured worker routing

test('Wave 3 telemetry tracks warm/retrieval/result destination while stripping raw material', () => {
  const telemetry = new CoprocessorTelemetry({ limit: 8 });
  telemetry.emit(TelemetryEvent.WARM_HIT, { packetId: 'p', rawPrompt: 'secret', sourceText: 'secret' });
  telemetry.emit(TelemetryEvent.WARM_MISS, { intentFingerprint: 'i' });
  telemetry.emit(TelemetryEvent.RETRIEVAL_QUALITY, { quality: 'MIXED', retrievedSourceText: 'secret' });
  telemetry.emit(TelemetryEvent.RESULT_ROUTED, { destination: 'NEXT_TURN', payload: { huge: true } });
  const snapshot = telemetry.snapshot();
  assert.deepEqual(snapshot.warm, { hit: 1, miss: 1 }); assert.equal(snapshot.retrieval.MIXED, 1); assert.equal(snapshot.resultDestinations.NEXT_TURN, 1);
  assert.equal('rawPrompt' in telemetry.list()[0].payload, false); assert.equal('sourceText' in telemetry.list()[0].payload, false);
});

test('Wave 3 benchmark preserves explicit MEASURED/REPLAYED/NOT_MEASURED state', () => {
  const summary = summarizeWave3Qualification({ warmer: { total: 10, hits: 5, partial: 2, stale: 2, invalid: 1 }, fanOut: { plans: 4, nominatedWorkers: 6, zeroWorkerPlans: 1 }, mode: Wave3MeasurementStatus.REPLAYED });
  assert.equal(summary.warmer.status, 'REPLAYED'); assert.equal(summary.warmer.value.warmHitRate, .5); assert.equal(summary.retrieval.status, 'NOT_MEASURED'); assert.equal(summary.fanOut.value.zeroWorkerRate, .25);
});

test('HOT versus DEEP policy includes Wave 3 cognition without granting scheduler ownership', () => {
  for (const type of ['FAN_OUT_PLANNER', 'WARM_VALIDATION', 'ADAPTIVE_RETRIEVAL', 'GREEN_ROOM', 'STREAM_VERIFY']) assert.equal(CoprocessorPlacementPolicy[type].placement, Placement.HOT);
  assert.equal(CoprocessorPlacementPolicy.CONSOLIDATION.placement, Placement.DEEP); assert.deepEqual(CoprocessorPlacementPolicy.CONSOLIDATION.layers, ['L3', 'L4']);
});

test('Wave 3 specialist registry keeps new provider-backed cognition capability-defined', () => {
  assert.ok(wave3SpecialistForTask('RETRIEVAL_QUALITY')); assert.ok(wave3SpecialistForTask('CONSOLIDATION')); assert.ok(wave3SpecialistForTask('STREAM_VERIFY')); assert.equal(wave3SpecialistForTask('UNKNOWN'), null);
});



test('new Wave 3 provider-backed capabilities route through the existing provider-neutral execution layer', async () => {
  const task = createCognitiveTask({ taskId: 'rq', taskType: 'RETRIEVAL_QUALITY', turnId: 't', correlationId: 'c', requiredCapabilities: [Capability.RERANK, Capability.SEMANTIC_JUDGMENT], inputRevisionSet: createRevisionSet({ sourceRevisionSet: ['s'], worldRevision: 1, sceneRevision: 1, characterStateRevision: 1 }), softDeadline: 10, hardDeadline: 20, intentFingerprint: 'i' });
  const profiles = new CapabilityProfileRegistry(); profiles.register({ profileId: 'rq-profile', workerId: 'slot', providerId: 'provider-a', capabilities: [Capability.RERANK, Capability.SEMANTIC_JUDGMENT] });
  const adapters = new ProviderAdapterRegistry(); adapters.register(new DeterministicProviderAdapter({ providerId: 'provider-a', capabilities: [Capability.RERANK, Capability.SEMANTIC_JUDGMENT], handlers: { RETRIEVAL_QUALITY: async () => ({ payload: { quality: 'MIXED', confidence: .8, reasoningSummary: 'mixed evidence', correctiveAction: 'TEMPORAL_NARROWING' } }) } }));
  const layer = new SpecialistExecutionLayer({ profiles, adapters });
  const result = await layer.execute(task, { input: { query: 'blade', candidateRefs: ['a', 'b'] } });
  assert.equal(result.payload.quality, 'MIXED'); assert.equal(result.providerId, 'provider-a'); assert.equal(result.authorityClass, 'UNRESOLVED');
});

test('Wave 3 provider output claiming owner authority is rejected before Result Bus eligibility', async () => {
  const task = createConsolidationTask(createConsolidationUnit({ unitId: 'provider-c', artifactRefs: [artifact()], sourceRevisionSet: ['src:1'], worldRevision: 5, sceneRevision: 7, characterStateRevision: 3 }), { turnId: 't', correlationId: 'c', softDeadline: 10, hardDeadline: 20 });
  const profiles = new CapabilityProfileRegistry(); profiles.register({ profileId: 'c-profile', workerId: 'slot', providerId: 'provider-c', capabilities: [Capability.CONSOLIDATION, Capability.COMPRESSION], resourceClass: 'DEEP_BACKGROUND', foregroundEligible: false, backgroundEligible: true, placements: ['DEEP'], supportedLayers: ['L3'] });
  const adapters = new ProviderAdapterRegistry(); adapters.register(new DeterministicProviderAdapter({ providerId: 'provider-c', capabilities: [Capability.CONSOLIDATION, Capability.COMPRESSION], handlers: { CONSOLIDATION: async () => ({ payload: { proposalId: 'bad', proposalKind: 'CLAIM_CANDIDATE', sourceArtifactRefs: [artifact()], authority: 'CURRENT', settlementAuthority: true, payload: {} } }) } }));
  const layer = new SpecialistExecutionLayer({ profiles, adapters });
  await assert.rejects(() => layer.execute(task, { input: { unit: { artifactRefs: [artifact()] } } }), (error) => error.code === FailureCode.AUTHORITY_VIOLATION);
});

test('precision intent-opposite corpus remains executable qualification input', async () => {
  const report = await runPrecisionBenchmark({ adapter: new DeterministicPrecisionAdapter() });
  assert.equal(report.cases, PRECISION_INTENT_OPPOSITE_CORPUS.length); assert.equal(report.intentOppositeAccuracy, 1);
});

test('browser execution remains valid with Buffer/process conveniences unavailable', () => {
  const oldBuffer = globalThis.Buffer, oldProcess = globalThis.process;
  try {
    globalThis.Buffer = undefined; globalThis.process = undefined;
    const packet = createWarmPacket({ identity: identity(), candidateRefs: ['a'] });
    assert.equal(packet.kind, 'WarmPacket');
  } finally { globalThis.Buffer = oldBuffer; globalThis.process = oldProcess; }
});

test('Wave 3 production modules contain no Node-only runtime dependency', async () => {
  for (const rel of [
    '../src/coprocessor/speculative-warmer.js', '../src/coprocessor/green-room.js', '../src/coprocessor/continuous-consolidation.js',
    '../src/coprocessor/scene-signal-adapter.js', '../src/coprocessor/wave3-benchmark.js', '../src/coprocessor/wave3-specialists.js',
    '../src/coprocessor/streaming-truth-observer.js', '../src/coprocessor/fanout-planner.js', '../src/coprocessor/retrieval-control-policy.js',
  ]) {
    const text = await readFile(new URL(rel, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\bBuffer\b/); assert.doesNotMatch(text, /from\s+['"]node:/); assert.doesNotMatch(text, /\brequire\s*\(/); assert.doesNotMatch(text, /\bprocess\./);
  }
});
