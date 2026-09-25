import test from 'node:test';
import assert from 'node:assert/strict';

import { SignalHub } from '../src/ui-core/signals.js';
import { RenderScheduler } from '../src/ui-core/render-scheduler.js';
import { computeVirtualWindow } from '../src/ui-core/virtualization.js';
import { RuntimeStatus } from '../src/ui-core/constants.js';
import { ContextSealState } from '../src/ui-core/wave2-adapters.js';
import {
  ResultDestination,
  TruthClass,
  Wave3Signals,
  assertWave3AdapterBundle,
  lightweightEvent,
} from '../src/ui-core/wave3-adapters.js';
import {
  EmberTavernWave3Fixture,
  createEmberTavernWave3AdapterBundle,
  createWave3StressFixtures,
} from '../src/ui-core/ember-tavern-wave3.js';
import {
  MemoryTraceModel,
  PrecisionFunnelProjector,
  RuntimeTelemetryProjector,
} from '../src/ui-core/wave3-models.js';

function harness({ stress = false } = {}) {
  const signals = new SignalHub();
  const built = createEmberTavernWave3AdapterBundle({ signals, stress });
  return { signals, ...built };
}

test('Wave 3 adapter bundle preserves Wave 2 seams and adds typed memory/precision diagnostics', () => {
  const { adapters } = harness();
  assert.equal(assertWave3AdapterBundle(adapters), adapters);
  assert.equal(adapters.scene.kind, 'SceneUIAdapter');
  assert.equal(adapters.runtime.kind, 'RuntimeUIAdapter');
  assert.equal(adapters.coprocessor.kind, 'CoprocessorUIAdapter');
  assert.equal(adapters.knowledge.kind, 'KnowledgeUIAdapter');
  assert.equal(adapters.memory.kind, 'MemoryStateUIAdapter');
  assert.equal(adapters.precision.kind, 'PrecisionUIAdapter');
});

test('runtime telemetry summary stays lightweight and detailed worker/ledger snapshots are on-demand', () => {
  const { adapters, fixture } = harness();
  const summary = adapters.runtime.getTelemetrySummary();
  assert.equal(fixture.detailReads.worker, 0);
  assert.equal(fixture.detailReads.ledger, 0);
  assert.ok(summary.activeWorkerCount >= 0);
  assert.ok(summary.queuedObligations > 0);
  assert.equal('workers' in summary, false);
  assert.equal('ledger' in summary, false);
  const worker = adapters.runtime.getWorkerTelemetry('worker-0');
  const task = adapters.runtime.getLedgerTaskDetail('task-0');
  assert.equal(worker.id, 'worker-0');
  assert.equal(task.id, 'task-0');
  assert.equal(fixture.detailReads.worker, 1);
  assert.equal(fixture.detailReads.ledger, 1);
});

test('lightweight event helper strips large/raw diagnostic payload fields', () => {
  const event = lightweightEvent('X', {
    workerId: 'worker-1',
    state: 'ACTIVE',
    rawPayload: { huge: true },
    prompt: 'raw prompt',
    fullResponse: 'raw model response',
    ledger: [{ id: 1 }],
    workers: [{ id: 1 }],
  });
  assert.deepEqual(event.payload, { workerId: 'worker-1', state: 'ACTIVE' });
});

test('runtime worker transition storms coalesce per worker key', () => {
  const { adapters, fixture } = harness();
  let frame;
  const scheduler = new RenderScheduler({ requestFrame: (cb) => { frame = cb; return 1; }, cancelFrame() {} });
  let renders = 0;
  const projector = new RuntimeTelemetryProjector({ adapter: adapters.runtime, scheduler, onMetric: () => { renders += 1; } }).mount();
  fixture.runtimeSignalStorm(1500, 'worker-0');
  assert.equal(scheduler.pendingCount, 1);
  frame(1);
  assert.equal(renders, 1);
  projector.destroy();
});

test('runtime queue/utilization/capacity signals carry field-level telemetry instead of snapshots', () => {
  const { adapters, fixture } = harness();
  const seen = [];
  const off = adapters.runtime.subscribeRuntime((event) => {
    if ([Wave3Signals.RUNTIME_QUEUE_DEPTH_CHANGED, Wave3Signals.RUNTIME_UTILIZATION_CHANGED, Wave3Signals.RUNTIME_CAPACITY_CHANGED].includes(event.type)) seen.push(event);
  });
  fixture.updateQueueDepth(41);
  fixture.updateUtilization('L1', 88);
  fixture.updateCapacity({ reservedForegroundCapacity: 40, borrowedBackgroundCapacity: 16 });
  off();
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0].payload, { depth: 41 });
  assert.equal('workers' in seen[1].payload, false);
  assert.equal('ledger' in seen[2].payload, false);
});

test('lifecycle obligations remain visible independently of parked worker execution', () => {
  const { adapters, fixture } = harness();
  const before = adapters.runtime.getLifecyclePage({ offset: 0, limit: 200 });
  const queuedIds = before.items.filter((x) => x.state === 'QUEUED').map((x) => x.id);
  fixture.workers[0].state = RuntimeStatus.PARKED;
  fixture.emit('WORKER_STATE_CHANGED', { workerId: fixture.workers[0].id, state: RuntimeStatus.PARKED });
  const after = adapters.runtime.getLifecyclePage({ offset: 0, limit: 200 });
  assert.deepEqual(after.items.filter((x) => x.state === 'QUEUED').map((x) => x.id), queuedIds);
});

test('Work Ledger remains paged and exposes revision fences/dependencies/slices only on detail request', () => {
  const { adapters, fixture } = harness({ stress: true });
  const page = adapters.runtime.getLedgerPage({ offset: 0, limit: 100 });
  assert.equal(page.items.length, 100);
  assert.ok(page.total >= 10000);
  assert.equal(page.items[0].completedSlices, undefined);
  assert.equal(fixture.detailReads.ledger, 0);
  const detail = adapters.runtime.getLedgerTaskDetail(page.items[0].id);
  assert.ok(Array.isArray(detail.completedSlices));
  assert.ok(Array.isArray(detail.pendingSlices));
  assert.ok(detail.worldRevisionFence);
  assert.ok(detail.dedupeKey);
  assert.equal(fixture.detailReads.ledger, 1);
});

test('advanced memory preserves current, historical and unresolved evidence simultaneously', () => {
  const { adapters } = harness();
  const record = adapters.memory.getMemoryRecord('sun-blade-state');
  assert.equal(record.currentState.status, TruthClass.CURRENT);
  assert.ok(record.historicalStates.every((x) => x.status === TruthClass.HISTORICAL));
  assert.equal(record.unresolvedEvidence[0].status, TruthClass.UNRESOLVED);
  assert.equal(record.source.immutable, true);
});

test('memory lineage exposes source to settlement to temporal state without UI authority', () => {
  const { adapters } = harness();
  const model = new MemoryTraceModel({ adapter: adapters.memory });
  const stages = model.lineage('sun-blade-state').map((x) => x.stage);
  assert.deepEqual(stages, ['SOURCE','DERIVED UNDERSTANDING','PROPOSAL','SETTLEMENT','CURRENT']);
});

test('Settlement trace renders validation path and retains unresolved contradiction', () => {
  const { adapters } = harness();
  const trace = adapters.memory.getSettlementTrace('sun-blade-state');
  assert.deepEqual(trace.stages.map((x) => x.name), ['evidence','worker proposal','schema validation','evidence validation','freshness validation','Settlement','Temporal State']);
  assert.equal(trace.settlementOutcome, 'ACCEPTED');
  assert.ok(trace.resultingClaims.current.includes('claim-blade-destroyed'));
  assert.ok(trace.resultingClaims.historical.includes('claim-blade-at-tavern'));
  assert.ok(trace.resultingClaims.unresolved.includes('journal-17'));
});

test('Reflection remains INFERRED and can weaken when support is contradicted', () => {
  const { adapters, fixture } = harness();
  const before = adapters.memory.getReflections().find((x) => x.id === 'reflection-eris-mara');
  const after = fixture.weakenReflection('reflection-eris-mara');
  assert.equal(before.authority, 'INFERRED');
  assert.equal(after.authority, 'INFERRED');
  assert.equal(after.status, 'WEAKENED');
  assert.ok(after.confidence < before.confidence);
  assert.ok(after.contradictingEvidence.includes('journal-contradiction'));
});

test('episodic chain keeps raw narrative recoverable through retrieval candidate', () => {
  const { adapters } = harness();
  const chain = adapters.memory.getEpisodicChain('episode-ember-intact');
  assert.ok(chain.rawEvidence.includes('turn-112'));
  assert.equal(chain.episode, 'episode-ember-intact');
  assert.equal(chain.reflection, 'reflection-eris-mara');
  assert.equal(chain.retrievalCandidate, 'cand-historical-tavern');
});

test('Candidate Bus funnel uses an adaptive budget rather than architectural fixed Top-N', () => {
  const { adapters } = harness();
  const funnel = adapters.precision.getCandidateFunnel();
  assert.ok(funnel.adaptiveCandidateBudget >= 5);
  assert.ok(funnel.budgetReason);
  assert.equal(Object.keys(funnel.stages).join(','), 'retrieved,truth-valid,cheap-pruned,reranked,admitted');
});

test('Candidate Bus stage storms coalesce into one funnel render', () => {
  const { adapters, fixture } = harness();
  let frame;
  const scheduler = new RenderScheduler({ requestFrame: (cb) => { frame = cb; return 1; }, cancelFrame() {} });
  let renders = 0;
  const projector = new PrecisionFunnelProjector({ adapter: adapters.precision, scheduler, onUpdate: () => { renders += 1; } }).mount();
  for (let i = 0; i < 1200; i += 1) fixture.updateFunnel('truth-valid', i % 80);
  assert.equal(scheduler.pendingCount, 1);
  frame(1);
  assert.equal(renders, 1);
  projector.destroy();
});

test('rerank result inspection exposes implementation-neutral precision metadata', () => {
  const { adapters } = harness();
  const current = adapters.precision.getCandidateDetail('cand-current-destroyed');
  const historical = adapters.precision.getCandidateDetail('cand-historical-carried');
  assert.equal(current.truthClass, TruthClass.CURRENT);
  assert.equal(historical.truthClass, TruthClass.HISTORICAL);
  assert.equal(current.finalRank, 1);
  assert.ok(current.modelProfileId);
  assert.ok(current.runtime.includes('implementation-neutral'));
  assert.ok(current.tokenBudget > 0);
  assert.equal(typeof current.truncationApplied, 'boolean');
});

test('intent-opposite fixtures show precision separating semantic near-neighbors', () => {
  const { adapters } = harness();
  const fixtures = adapters.precision.getIntentOppositeFixtures();
  assert.equal(fixtures.length, 6);
  for (const item of fixtures) {
    assert.ok(Math.abs(item.fusedScores.wanted - item.fusedScores.wrong) < 0.1);
    assert.ok(item.rerankScores.wanted > item.rerankScores.wrong);
  }
});

test('runtime benchmark records cover precision/device/latency/memory/stability/fallback metadata', () => {
  const { adapters } = harness();
  const rows = adapters.precision.getRuntimeBenchmarks();
  assert.ok(rows.some((x) => x.precision === 'FP32'));
  assert.ok(rows.some((x) => x.precision === 'FP16'));
  assert.ok(rows.some((x) => x.precision === 'INT8'));
  assert.ok(rows.some((x) => x.device === 'CPU'));
  assert.ok(rows.some((x) => x.device === 'GPU'));
  for (const row of rows) {
    assert.ok(row.p50Ms <= row.p95Ms);
    assert.ok(row.candidatesPerSec > 0);
    assert.ok(row.fallbackBehavior);
  }
});

test('foreground reranker timeout activates deterministic fallback and preserves sealed-context boundary', () => {
  const { fixture } = harness();
  const state = fixture.simulateRerankTimeout();
  assert.equal(state.rerankerState, 'LATE');
  assert.equal(state.fallbackActive, true);
  assert.equal(state.fallbackType, 'deterministic fused ranking');
  assert.equal(state.gatherQuorum, true);
  assert.equal(state.contextSeal, ContextSealState.SEALED);
  assert.equal(state.mainProceeding, true);
  assert.equal(state.lateDestination, ResultDestination.NEXT_TURN);
});

test('Coprocessor telemetry exposes operational fields without continuously exposing raw payloads', () => {
  const { adapters, fixture } = harness();
  fixture.createTurnEvent();
  const telemetry = adapters.coprocessor.getCoprocessorTelemetry('TURN-W3-EMBER-001');
  assert.equal(telemetry.turnId, 'TURN-W3-EMBER-001');
  assert.ok(telemetry.correlationId);
  for (const worker of telemetry.workers) {
    assert.ok(worker.capabilities.length);
    assert.ok(worker.resultClass);
    assert.ok(worker.cognitiveLayer);
    assert.equal('rawPayload' in worker, false);
  }
  assert.equal(fixture.detailReads.coprocessor, 0);
  assert.equal(adapters.coprocessor.getWorkerTelemetryDetail('historian').rawPayload.hidden, 'loaded only in explicit debug view');
  assert.equal(fixture.detailReads.coprocessor, 1);
});

test('Gather quorum may be satisfied by deterministic fallback without waiting for Green Room', () => {
  const { adapters, fixture } = harness();
  fixture.createTurnEvent();
  fixture.completeWorker('historian');
  fixture.completeWorker('graph');
  fixture.satisfyTruthWithFallback();
  const gather = adapters.coprocessor.getGather();
  assert.equal(gather.foregroundQuorum, true);
  assert.deepEqual(gather.requiredMissing, []);
  assert.ok(gather.fallbackSatisfied.includes('truth-precision'));
  assert.equal(gather.completedWorkers.includes('green-room'), false);
});

test('stale and duplicate coprocessor results are explicitly observable and contained', () => {
  const { adapters, fixture } = harness();
  fixture.createTurnEvent();
  fixture.completeWorker('historian', { stale: true });
  fixture.dedupeWorkerResult('historian');
  const gather = adapters.coprocessor.getGather();
  const worker = adapters.coprocessor.getTurnSwarm().workers.find((x) => x.id === 'historian');
  assert.equal(worker.destination, ResultDestination.STALE_DROPPED);
  assert.equal(worker.contributedToSealedContext, false);
  assert.ok(gather.staleRejected.includes('historian'));
  assert.equal(gather.duplicateResults, 1);
});

test('Context Seal contains late Green Room result outside current context', () => {
  const { adapters, fixture } = harness();
  fixture.createTurnEvent();
  fixture.completeWorker('historian');
  fixture.completeWorker('graph');
  fixture.satisfyTruthWithFallback();
  fixture.sealTurn();
  const late = fixture.completeWorker('green-room', { destination: ResultDestination.BACKGROUND, executionLatencyMs: 190 });
  assert.equal(adapters.coprocessor.getGather().contextSeal, ContextSealState.SEALED);
  assert.equal(late.destination, ResultDestination.BACKGROUND);
  assert.equal(late.contributedToSealedContext, false);
  assert.ok(adapters.coprocessor.getGather().lateResults.some((x) => x.workerId === 'green-room'));
});

test('large memory/candidate histories remain paged and virtualizable', () => {
  const { adapters } = harness({ stress: true });
  const candidates = adapters.precision.getCandidatesPage({ offset: 500, limit: 100 });
  assert.equal(candidates.items.length, 100);
  assert.ok(candidates.total >= 10000);
  const range = computeVirtualWindow({ count: candidates.total, itemSize: 50, viewportSize: 500, scrollOffset: 25000, overscan: 6 });
  assert.ok(range.end - range.start <= 22);
});

test('Wave 3 stress fixtures cover telemetry, ledger, state, provenance, candidate and stale-result storms', () => {
  const stress = createWave3StressFixtures();
  assert.equal(stress.workers.length, 256);
  assert.equal(stress.obligations.length, 8000);
  assert.equal(stress.ledger.length, 12000);
  assert.equal(stress.batches.length, 128);
  assert.equal(stress.memory.length, 5000);
  assert.equal(stress.reflections.length, 1500);
  assert.equal(stress.episodes.length, 10000);
  assert.equal(stress.candidates.length, 12000);
  assert.equal(stress.provenanceEdges.length, 16000);
  assert.equal(stress.staleResults.length, 600);
});

test('runtime projector mount/destroy/remount does not duplicate subscriptions', () => {
  const { signals, adapters, fixture } = harness();
  let frame;
  const scheduler = new RenderScheduler({ requestFrame: (cb) => { frame = cb; return 1; }, cancelFrame() {} });
  let hits = 0;
  const make = () => new RuntimeTelemetryProjector({ adapter: adapters.runtime, scheduler, onMetric: () => { hits += 1; } });
  const first = make().mount();
  const initial = signals.listenerCount('WORKER_STATE_CHANGED');
  assert.ok(initial >= 1);
  first.destroy();
  const afterDestroy = signals.listenerCount('WORKER_STATE_CHANGED');
  assert.equal(afterDestroy, initial - 1);
  const second = make().mount();
  fixture.emit('WORKER_STATE_CHANGED', { workerId: 'worker-0', state: 'ACTIVE' });
  frame(1);
  second.destroy();
  assert.equal(hits, 1);
  assert.equal(signals.listenerCount('WORKER_STATE_CHANGED'), afterDestroy);
});

test('integrated Ember Tavern Wave 3 acceptance scenario completes all 18 UI steps', () => {
  const { adapters, fixture } = harness();
  const steps = fixture.runAcceptanceScenario();
  assert.equal(steps.length, 18);
  assert.equal(adapters.scene.getCurrentScene().location.name, 'Ruined Ember Tavern');
  const record = adapters.memory.getMemoryRecord('sun-blade-state');
  assert.equal(record.currentState.status, TruthClass.CURRENT);
  assert.ok(record.historicalStates.length >= 2);
  assert.ok(record.unresolvedEvidence.length >= 1);
  const gather = adapters.coprocessor.getGather();
  assert.equal(gather.contextSeal, ContextSealState.SEALED);
  const green = adapters.coprocessor.getTurnSwarm().workers.find((x) => x.id === 'green-room');
  assert.equal(green.destination, ResultDestination.BACKGROUND);
  assert.equal(green.contributedToSealedContext, false);
  assert.equal(adapters.precision.getDeadlineState().fallbackActive, true);
});
