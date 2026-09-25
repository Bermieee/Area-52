import test from 'node:test';
import assert from 'node:assert/strict';

import { SignalHub } from '../src/ui-core/signals.js';
import { RenderScheduler } from '../src/ui-core/render-scheduler.js';
import { computeVirtualWindow } from '../src/ui-core/virtualization.js';
import { RuntimeStatus } from '../src/ui-core/constants.js';
import { assertAdapterBundle, ContextSealState, LateRoute, ResultClass, SceneRelation, Wave2Signals } from '../src/ui-core/wave2-adapters.js';
import { createEmberTavernAdapterBundle } from '../src/ui-core/ember-tavern-wave2.js';
import { ProvenanceInspectorModel, SceneDeltaProjector, SceneNavigator, TurnSwarmModel } from '../src/ui-core/wave2-models.js';

function harness({ stress = false } = {}) {
  const signals = new SignalHub();
  const built = createEmberTavernAdapterBundle({ signals, stress });
  return { signals, ...built };
}

test('adapter bundle satisfies Scene/Runtime/Coprocessor/Knowledge UI contracts', () => {
  const { adapters } = harness();
  assert.equal(assertAdapterBundle(adapters), adapters);
  assert.equal(adapters.scene.kind, 'SceneUIAdapter');
  assert.equal(adapters.runtime.kind, 'RuntimeUIAdapter');
  assert.equal(adapters.coprocessor.kind, 'CoprocessorUIAdapter');
  assert.equal(adapters.knowledge.kind, 'KnowledgeUIAdapter');
});

test('scene-delta projector updates only changed fields through keyed scheduler invalidations', () => {
  const { adapters, fixture } = harness();
  let frame;
  const scheduler = new RenderScheduler({ requestFrame: (cb) => { frame = cb; return 1; }, cancelFrame() {} });
  const changed = [];
  const projector = new SceneDeltaProjector({ adapter: adapters.scene, scheduler, onFieldUpdate: (field) => changed.push(field) }).mount();
  fixture.applySceneField('atmosphere', { label: 'tense', epistemic: 'inferred' }, Wave2Signals.SCENE_VIBE_CHANGED);
  assert.equal(scheduler.pendingCount, 1);
  frame(1);
  assert.deepEqual(changed, ['atmosphere']);
  assert.equal(projector.renderCounts.get('atmosphere'), 1);
  assert.equal(projector.renderCounts.get('location') ?? 0, 0);
  projector.destroy();
});

test('boundary state exposes evidence, contradiction, confirmation window and final decision', () => {
  const { adapters, fixture } = harness();
  const candidate = fixture.showBoundaryCandidate();
  assert.equal(candidate.state, 'CONFIRMING');
  assert.ok(candidate.supportingSignals.length >= 2);
  assert.ok(candidate.contradictoryEvidence.length >= 1);
  assert.equal(candidate.confirmationWindow.state, 'OPEN');
  const final = fixture.confirmSceneBoundary();
  assert.equal(final.decision, 'CUT');
  assert.equal(final.confirmationWindow.state, 'SATISFIED');
  assert.equal(adapters.scene.getBoundaryState().confidence, 0.96);
});

test('scene navigation supports non-linear relation types', () => {
  const { adapters, fixture } = harness();
  fixture.erisLeavesSunBlade();
  fixture.showBoundaryCandidate();
  fixture.confirmSceneBoundary();
  fixture.compileClosedEpisode();
  const edges = adapters.scene.getRelatedScenes('scene-ember-intact');
  const types = new Set(edges.map((edge) => edge.relation));
  assert.ok(types.has(SceneRelation.FLASHBACK_OF));
  assert.ok(types.has(SceneRelation.PARALLEL_TO));
  assert.ok(types.has(SceneRelation.INTERRUPTS));
  const nav = new SceneNavigator({ adapter: adapters.scene, sceneId: 'scene-ember-intact' });
  const moved = nav.moveTo('scene-sunblade-flashback');
  assert.equal(moved.relation, SceneRelation.FLASHBACK_OF);
});

test('Turn Event fans out to four typed cognitive coprocessors', () => {
  const { adapters, fixture } = harness();
  fixture.createTurnEvent();
  const turn = adapters.coprocessor.getTurnSwarm('TURN-EMBER-001');
  assert.deepEqual(turn.workers.map((w) => w.name), ['Historian','Graph Walker','Green Room','Truth Worker']);
  assert.deepEqual(turn.workers.map((w) => w.resultClass), [ResultClass.REQUIRED, ResultClass.REQUIRED, ResultClass.OPPORTUNISTIC, ResultClass.REQUIRED]);
});

test('Gather closes on required foreground quorum without waiting for Green Room', () => {
  const { adapters, fixture } = harness();
  fixture.createTurnEvent();
  fixture.completeTurnWorker('historian');
  fixture.completeTurnWorker('graph');
  fixture.completeTurnWorker('truth');
  const gather = adapters.coprocessor.getGather('TURN-EMBER-001');
  assert.equal(gather.foregroundQuorum, true);
  assert.deepEqual(gather.requiredMissing, []);
  assert.equal(gather.completedWorkers.includes('green-room'), false);
  assert.equal(gather.contextSeal, ContextSealState.QUORUM);
});

test('Context Seal is a hard foreground publication boundary', () => {
  const { adapters, fixture } = harness();
  fixture.createTurnEvent();
  fixture.completeTurnWorker('historian');
  fixture.completeTurnWorker('graph');
  fixture.completeTurnWorker('truth');
  fixture.closeGatherAndSeal();
  const gather = adapters.coprocessor.getGather('TURN-EMBER-001');
  const timeline = adapters.coprocessor.getContextSealTimeline('TURN-EMBER-001');
  assert.equal(gather.contextSeal, ContextSealState.SEALED);
  assert.ok(timeline.some((entry) => entry.stage === 'CONTEXT SEALED'));
  assert.ok(timeline.some((entry) => entry.stage === 'Main'));
});

test('late Green Room result is visibly routed to NEXT TURN and cannot contribute to sealed context', () => {
  const { adapters, fixture } = harness();
  fixture.createTurnEvent();
  fixture.completeTurnWorker('historian');
  fixture.completeTurnWorker('graph');
  fixture.completeTurnWorker('truth');
  fixture.closeGatherAndSeal();
  const late = fixture.completeTurnWorker('green-room', { latency: 180 });
  assert.equal(late.lateRoute, LateRoute.NEXT_TURN);
  assert.equal(late.contributedToCurrentContext, false);
  const swarm = new TurnSwarmModel({ adapter: adapters.coprocessor, turnId: 'TURN-EMBER-001' });
  assert.equal(swarm.lateWorkers.length, 1);
  assert.equal(swarm.foregroundWorkers.some((w) => w.id === 'green-room'), false);
});

test('queued lifecycle obligations remain visible while a worker parks and resumes', () => {
  const { adapters, fixture } = harness();
  const before = adapters.runtime.getLifecyclePage({ offset: 0, limit: 80 });
  const queued = before.items.filter((item) => item.state === 'QUEUED');
  assert.ok(queued.length > 0);
  fixture.parkWorker('worker-deep-reflection');
  const parked = adapters.runtime.getWorkers().find((w) => w.id === 'worker-deep-reflection');
  assert.equal(parked.state, RuntimeStatus.PARKED);
  const during = adapters.runtime.getLifecyclePage({ offset: 0, limit: 80 });
  assert.equal(during.total, before.total);
  assert.deepEqual(during.items.filter((item) => item.state === 'QUEUED').map((x) => x.id), queued.map((x) => x.id));
  fixture.resumeWorker('worker-deep-reflection');
  const resumed = adapters.runtime.getWorkers().find((w) => w.id === 'worker-deep-reflection');
  assert.equal(resumed.state, RuntimeStatus.ACTIVE);
});

test('high-frequency scene signals coalesce by field instead of causing whole-state redraws', () => {
  const { adapters, fixture } = harness();
  let frame;
  const scheduler = new RenderScheduler({ requestFrame: (cb) => { frame = cb; return 1; }, cancelFrame() {} });
  let updates = 0;
  const projector = new SceneDeltaProjector({ adapter: adapters.scene, scheduler, onFieldUpdate: () => { updates += 1; } }).mount();
  for (let i = 0; i < 1000; i += 1) fixture.applySceneField('atmosphere', { label: `vibe-${i}`, epistemic: 'inferred' }, Wave2Signals.SCENE_VIBE_CHANGED);
  assert.equal(scheduler.pendingCount, 1);
  frame(1);
  assert.equal(updates, 1);
  assert.equal(projector.scene.atmosphere.label, 'vibe-999');
  projector.destroy();
});

test('large scene history remains virtualizable and paged', () => {
  const { adapters } = harness({ stress: true });
  const history = adapters.scene.getSceneHistoryPage({ offset: 0, limit: 100 });
  assert.ok(history.total >= 5000);
  assert.equal(history.items.length, 100);
  const range = computeVirtualWindow({ count: history.total, itemSize: 48, viewportSize: 480, scrollOffset: 48000, overscan: 6 });
  assert.ok(range.end - range.start <= 22);
  assert.ok(range.totalSize >= 240000);
});

test('provenance inspection is universal read-only adapter interaction', () => {
  const { adapters } = harness();
  const inspector = new ProvenanceInspectorModel({ knowledgeAdapter: adapters.knowledge });
  const provenance = inspector.inspect('provenance', { id: 'scene-ember-intact', kind: 'scene' });
  const history = inspector.inspect('history', { id: 'scene-ember-intact', kind: 'scene' });
  const settlement = inspector.inspect('settlement', { id: 'scene-ember-intact', kind: 'scene' });
  assert.equal(provenance.readOnly, true);
  assert.ok(provenance.provenance.includes('source-ember-tavern'));
  assert.deepEqual(history.history, ['OPEN','CLOSED']);
  assert.equal(settlement.settlement.authority, 'owning-subsystem');
  const currentScene = adapters.scene.getCurrentScene();
  const currentProvenance = adapters.knowledge.inspectProvenance({ id: currentScene.id, kind: 'scene', provenance: currentScene.sourceEvidence });
  assert.ok(currentProvenance.provenance.includes('source-ember-tavern'));
  assert.equal(adapters.knowledge.inspectSource({ id: currentScene.id, kind: 'scene', provenance: currentScene.sourceEvidence }).source, 'turn-112');
});

test('mount/destroy/remount cleans adapter signal subscriptions without duplicates', () => {
  const { signals, adapters, fixture } = harness();
  let frame;
  const scheduler = new RenderScheduler({ requestFrame: (cb) => { frame = cb; return 1; }, cancelFrame() {} });
  let hits = 0;
  const make = () => new SceneDeltaProjector({ adapter: adapters.scene, scheduler, onFieldUpdate: () => { hits += 1; } });
  const first = make().mount();
  assert.equal(signals.listenerCount(Wave2Signals.SCENE_STATE_DELTA), 1);
  first.destroy();
  assert.equal(signals.listenerCount(Wave2Signals.SCENE_STATE_DELTA), 0);
  const second = make().mount();
  fixture.applySceneField('location', { id:'x', name:'X', epistemic:'observed' }, Wave2Signals.SCENE_LOCATION_CHANGED);
  frame(1);
  second.destroy();
  assert.equal(hits, 1);
  assert.equal(signals.listenerCount(Wave2Signals.SCENE_STATE_DELTA), 0);
});

test('integrated Ember Tavern acceptance sequence preserves required foreground/late-result semantics', () => {
  const { fixture, adapters } = harness();
  const steps = fixture.runAcceptanceScenario();
  assert.equal(steps.length, 16);
  assert.equal(adapters.scene.getCurrentScene().location.name, 'Ruins of Ember Tavern');
  const turn = adapters.coprocessor.getTurnSwarm('TURN-EMBER-001');
  assert.equal(turn.gather.contextSeal, ContextSealState.SEALED);
  const green = turn.workers.find((w) => w.id === 'green-room');
  assert.equal(green.lateRoute, LateRoute.NEXT_TURN);
  assert.equal(green.contributedToCurrentContext, false);
  assert.equal(adapters.scene.getSceneEpisode('scene-ember-intact').status, 'CLOSED');
});

test('stress fixtures cover large workers, obligations, batches, histories, provenance and stale/late swarm results', async () => {
  const { createWave2StressFixtures } = await import('../src/ui-core/ember-tavern-wave2.js');
  const stress = createWave2StressFixtures();
  assert.equal(stress.workers.length, 256);
  assert.equal(stress.obligations.length, 8000);
  assert.equal(stress.batches.length, 128);
  assert.equal(stress.history.length, 10000);
  assert.equal(stress.provenance.length, 12000);
  assert.equal(stress.swarm.length, 192);
  assert.ok(stress.swarm.some((worker) => worker.freshness === 'STALE'));
  assert.ok(stress.swarm.some((worker) => worker.lateRoute === LateRoute.NEXT_TURN || worker.lateRoute === LateRoute.BACKGROUND));
});

test('high-frequency batch updates coalesce per batch key', () => {
  const { adapters, fixture } = harness({ stress: true });
  let frame;
  const scheduler = new RenderScheduler({ requestFrame: (cb) => { frame = cb; return 1; }, cancelFrame() {} });
  let renders = 0;
  const release = adapters.runtime.subscribeRuntime((event) => {
    if (event.type === Wave2Signals.RUNTIME_BATCH_CHANGED) scheduler.invalidate(`batch:${event.payload.batch.id}`, () => { renders += 1; });
  });
  for (let i = 0; i < 2000; i += 1) fixture.updateBatch('batch-0', { completedUnits: i % 100 });
  assert.equal(scheduler.pendingCount, 1);
  frame(1);
  assert.equal(renders, 1);
  release();
});
