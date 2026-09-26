import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AdaptiveRetrievalController, ConsolidationBacklog, DynamicFanOutPlanner, GreenRoomStore,
  RetrievalQuality, StreamingTruthObserver, WarmState, createConsolidationTask, createConsolidationUnit,
  createGreenRoomBatch, createTurnEnvelope, createWarmIdentity, createWarmPacket, evaluateWarmPacket,
  toRuntimeObligation,
} from '../src/coprocessor/index.js';

const artifact = (i) => ({ kind: 'ArtifactReference', artifactId: `episode:${i}`, artifactType: 'SceneEpisode', owner: 'SCENE_INTELLIGENCE', revision: 1, storageDomain: 'episodes' });
const identity = (i, extra = {}) => createWarmIdentity({ sceneRevision: i, worldRevision: 1, characterStateRevision: 1, sourceRevisionSet: [`src:${i}`], intentFingerprint: `intent:${i % 7}`, retrievalPolicyRevision: '1', ...extra });

test('Wave 3 stress: 3,000 Fan-Out plans remain bounded under scene/capability/load/revision churn', () => {
  const planner = new DynamicFanOutPlanner({ maxWorkers: 12 });
  let zero = 0, totalWorkers = 0, background = 0, maxWorkers = 0;
  for (let i = 0; i < 3000; i++) {
    const event = createTurnEnvelope({ turnId: `plan:${i}`, eventId: `evt:${i}`, correlationId: `corr:${i}`, dedupeKey: `plan:${i}`, sourceRevisionSet: [`src:${i}`], worldRevision: i % 13, sceneRevision: i % 31, characterStateRevision: i % 17, createdAt: 0 });
    const acknowledgement = i % 9 === 0;
    const plan = planner.plan({
      turnEvent: event,
      text: acknowledgement ? 'Thanks!' : i % 3 === 0 ? 'Where is the Blade?' : i % 3 === 1 ? 'Mara speaks to Eris.' : 'Continue the thread.',
      queryIntent: i % 3 === 0 ? 'LOCATION' : null,
      activeCast: i % 3 === 1 ? ['Mara', 'Eris'] : ['Eris'],
      activeThreads: acknowledgement ? [] : ['blade'],
      retrievalQuality: i % 11 === 0 ? 'MIXED' : 'HIGH',
      warmState: i % 5 === 0 ? WarmState.FRESH : null,
      backgroundSignals: { consolidationPending: i % 10 === 0, pendingUnits: i % 10 === 0 ? 4 : 0 },
      providerHealth: i % 17 === 0 ? { 'green-room': 'unavailable' } : {},
      providerLoad: i % 19 === 0 ? { 'truth-precision': 1 } : {},
      resourceConstraint: { maxForegroundWorkers: 4, maxOpportunisticWorkers: 1, maxBackgroundNominations: 1, maxCostUnits: 8 },
      maxFanOut: 5,
    });
    if (!plan.tasks.length) zero += 1;
    totalWorkers += plan.tasks.length;
    background += plan.tasks.filter((task) => task.resultClass === 'DEFERRED').length;
    maxWorkers = Math.max(maxWorkers, plan.tasks.length);
    assert.ok(plan.tasks.length <= 5); assert.ok(plan.budget.foregroundWorkers <= 4); assert.ok(plan.budget.opportunisticWorkers <= 1); assert.ok(plan.budget.backgroundNominations <= 1); assert.ok(plan.budget.estimatedCostUnits <= 8);
    assert.ok(plan.tasks.every((task) => !('providerId' in task) && !('workerId' in task)));
  }
  console.log(JSON.stringify({ stress: 'wave3-fanout', plans: 3000, totalWorkers, zeroWorkerPlans: zero, backgroundNominations: background, maxWorkers }));
});

test('Wave 3 stress: 2,000 WarmPacket evaluations reject scene/intent churn and preserve bounded salvage', () => {
  let fresh = 0, partial = 0, stale = 0, invalid = 0;
  for (let i = 0; i < 2000; i++) {
    const current = identity(i);
    let prior;
    if (i % 4 === 0) prior = current;
    else if (i % 4 === 1) prior = identity(i, { sourceRevisionSet: [`src:${i}`, 'shared'] });
    else if (i % 4 === 2) prior = identity(i + 1, { intentFingerprint: current.intentFingerprint });
    else prior = identity(i, { intentFingerprint: `different:${i}` });
    const packet = createWarmPacket({ identity: prior, candidateRefs: [`c:${i}`], evidenceRefs: prior.sourceRevisionSet, compiledRepresentation: { unsafeIfStale: true }, expiresAfterTurns: 2 });
    const out = evaluateWarmPacket(packet, current, { turnSequence: 1, storedTurn: 0 });
    if (out.state === WarmState.FRESH) fresh += 1;
    else if (out.state === WarmState.PARTIALLY_STALE) partial += 1;
    else if (out.state === WarmState.STALE) stale += 1;
    else invalid += 1;
    if (out.state !== WarmState.FRESH) assert.equal(out.compiledRepresentation, null);
  }
  assert.equal(fresh + partial + stale + invalid, 2000);
  console.log(JSON.stringify({ stress: 'wave3-warmer', evaluations: 2000, fresh, partial, stale, invalid }));
});

test('Wave 3 stress: 1,000 adaptive retrieval evaluations never exceed one corrective pass', async () => {
  const controller = new AdaptiveRetrievalController({ maxCorrectiveAttempts: 1 });
  let corrections = 0, abstentions = 0, proceeds = 0, calls = 0;
  for (let i = 0; i < 1000; i++) {
    const first = i % 3 === 0 ? RetrievalQuality.HIGH : i % 3 === 1 ? RetrievalQuality.MIXED : RetrievalQuality.LOW;
    const out = await controller.run({
      query: `q:${i}`,
      retrieve: async ({ attempt }) => { calls += 1; return { quality: attempt ? RetrievalQuality.LOW : first }; },
      evaluate: async (result) => ({ quality: result.quality }),
    });
    corrections += out.correctivePasses;
    if (out.action === 'NO_LONG_TERM_MEMORY') abstentions += 1;
    if (out.action === 'PROCEED') proceeds += 1;
    assert.ok(out.correctivePasses <= 1);
  }
  console.log(JSON.stringify({ stress: 'wave3-retrieval', evaluations: 1000, retrievalCalls: calls, correctivePasses: corrections, abstentions, proceeds }));
});

test('Wave 3 stress: 1,000 Green Room states plus 500 expiry cases remain bounded and non-durable', () => {
  const store = new GreenRoomStore({ maxCharacters: 24, maxHistory: 64, defaultTtlTurns: 2 });
  let outputs = 0, expiryCases = 0;
  for (let i = 0; i < 1000; i++) {
    const characterRef = `char:${i % 40}`;
    const batch = createGreenRoomBatch({ sceneRevision: i % 20, characters: [{ characterRef, evidenceRefs: [`e:${i}`], confidence: .6, dimensions: { uncertainty: (i % 10) / 10 }, sourceRevisionSet: [`src:${i}`] }] });
    store.putBatch(batch, { turnSequence: i, activeCharacterRefs: [characterRef] });
    outputs += 1;
    assert.ok(store.size() <= 24); assert.ok(store.historySize() <= 64);
    if (i < 500) { store.invalidate({ sceneClosed: true }); expiryCases += 1; assert.equal(store.get(characterRef, { sceneRevision: i % 20, turnSequence: i }), null); }
  }
  console.log(JSON.stringify({ stress: 'wave3-green-room', outputs, expiryCases, finalActive: store.size(), history: store.historySize() }));
});

test('Wave 3 stress: 1,000 consolidation units expose legal checkpoint/yield/resume metadata', () => {
  const backlog = new ConsolidationBacklog({ capacity: 1200 });
  let checkpointed = 0, deep = 0;
  for (let i = 0; i < 1000; i++) {
    const unit = createConsolidationUnit({ unitId: `u:${i}`, artifactRefs: [artifact(i)], sourceRevisionSet: [`src:${i}`], worldRevision: 1, sceneRevision: i % 30, characterStateRevision: i % 11, priority: i % 5, createdAt: i, resumeIdentity: `resume:${i}` });
    backlog.enqueue(unit);
    if (i % 2 === 0) { backlog.checkpoint(unit.unitId, { slice: i }); checkpointed += 1; }
    const task = createConsolidationTask(unit, { softDeadline: 1000, hardDeadline: 5000, maxSliceUnits: 8, maxUnitsPerCheckpoint: 8 });
    const obligation = toRuntimeObligation(task);
    if (obligation.runtimeClass === 'DEEP') deep += 1;
    assert.equal(obligation.yieldPolicy.legal, true); assert.equal(obligation.yieldPolicy.resumeIdentity, `resume:${i}`); assert.equal(obligation.schedulingDecision, null);
  }
  assert.equal(backlog.metrics({ now: 1500 }).pendingUnits, 1000);
  console.log(JSON.stringify({ stress: 'wave3-consolidation', units: 1000, checkpointed, deep, pending: backlog.metrics({ now: 1500 }).pendingUnits }));
});

test('Wave 3 stress: 2,000 streamed claim checks preserve history and ambiguity without hard interception', async () => {
  let checks = 0, historical = 0, ambiguous = 0;
  const observer = new StreamingTruthObserver({ deterministicCheck: async (claim) => {
    checks += 1;
    if (claim.includes('remembered')) { historical += 1; return { classification: 'SUPPORTED', confidence: 1, temporalContext: 'HISTORICAL', currentCanonViolation: false, severity: 'NONE' }; }
    if (claim.includes('perhaps')) { ambiguous += 1; return { classification: 'AMBIGUOUS', confidence: .4, creativeAmbiguity: true, currentCanonViolation: false, severity: 'LOW' }; }
    return { classification: 'VIOLATION', confidence: .99, temporalContext: 'CURRENT', currentCanonViolation: true, severity: 'HIGH', deterministic: true };
  } });
  for (let i = 0; i < 2000; i++) {
    const text = i % 3 === 0 ? 'She remembered when the Tavern stood intact.' : i % 3 === 1 ? 'Perhaps the Tavern lives in memory.' : 'The intact Tavern stood before her.';
    const out = await observer.push(text, { worldRevision: 1, sceneRevision: 1 });
    assert.equal(out.intercepted, false); assert.equal(out.mode, 'OBSERVE');
  }
  assert.equal(checks, 2000);
  console.log(JSON.stringify({ stress: 'wave3-stream-truth', checks, historical, ambiguous, metrics: observer.snapshotMetrics() }));
});
