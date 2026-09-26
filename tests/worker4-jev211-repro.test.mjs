import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JevDecisionCore,
  JevDomainAdapterService,
  createDefaultJevDomainAdapterRegistry,
  createJevDomainAdapterMatrix,
} from '../src/coprocessor/index.js';
import { currentFor, output, providerExecutor, sceneBoundary } from './wave9-fixtures.mjs';

function decidedOutput() {
  return output({
    selected: ['RESUME_PRIOR_SCENE'],
    rejected: ['CONTINUE_SCENE', 'OPEN_NEW_SCENE', 'UNRESOLVED'],
    evidenceUsed: ['scene:a', 'scene:b'],
  });
}

function buildSceneRequest(input) {
  const registry = createDefaultJevDomainAdapterRegistry();
  const adapter = registry.resolve(input.domain, input.decisionKind);
  const precheck = adapter.deterministicPrecheck(input);
  return adapter.buildRequest(input, precheck);
}

test('Jev #211 repro: adapter replay rechecks current Scene revision instead of returning a previously fresh proposal', async () => {
  let calls = 0;
  const matrix = createJevDomainAdapterMatrix({
    providerExecutor: providerExecutor(() => {
      calls += 1;
      return { payload: decidedOutput() };
    }),
  });
  const input = sceneBoundary('worker4-scene-revision');

  const fresh = await matrix.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  const stale = await matrix.service.adjudicate(input, {
    currentRevisionState: currentFor(input, {
      sceneRevision: 6,
      domainRevisions: { scene: 6, owner: 2 },
    }),
  });

  assert.equal(calls, 1);
  assert.equal(fresh.staleState, 'FRESH');
  assert.equal(stale.staleState, 'STALE');
  assert.equal(stale.proposedOutcome, 'UNRESOLVED');
  assert.equal(stale.details.preserveCurrentScene, true);
  assert.equal(stale.mutationAuthority, false);
  assert.equal(stale.requiresOwnerPolicy, true);
});

test('Jev #211 repro: Decision Core replay re-evaluates generation seal and marks cached result late', async () => {
  let calls = 0;
  const core = new JevDecisionCore({
    providerExecutor: providerExecutor(() => {
      calls += 1;
      return { payload: decidedOutput() };
    }),
  });
  const input = sceneBoundary('worker4-seal-replay');
  const request = buildSceneRequest(input);

  const first = await core.decide(request, { currentRevisionState: currentFor(input), sealed: false });
  const replay = await core.decide(request, { currentRevisionState: currentFor(input), sealed: true });

  assert.equal(calls, 1);
  assert.equal(first.admission.late, false);
  assert.equal(first.admission.foregroundEligible, true);
  assert.equal(replay.admission.late, true);
  assert.equal(replay.admission.foregroundEligible, false);
  assert.equal(replay.admission.destination, 'NEXT_TURN');
  assert.equal(replay.authorityGranted, false);
  assert.equal(replay.canonicalMutation, false);
});

test('Jev #211 regression: in-flight provider result becomes late when generation seals before completion', async () => {
  let sealed = false;
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const core = new JevDecisionCore({
    providerExecutor: providerExecutor(async () => {
      await blocker;
      return { payload: decidedOutput() };
    }),
  });
  const input = sceneBoundary('worker4-inflight-late');
  const request = buildSceneRequest(input);
  const pending = core.decide(request, {
    currentRevisionState: () => currentFor(input),
    sealed: () => sealed,
  });
  sealed = true;
  release();
  const receipt = await pending;
  assert.equal(receipt.admission.late, true);
  assert.equal(receipt.admission.foregroundEligible, false);
  assert.equal(receipt.admission.destination, 'NEXT_TURN');
});

test('Jev #211 repro: Decision Core replay retention is bounded and evicts oldest entries', async () => {
  let calls = 0;
  const core = new JevDecisionCore({
    replayLimit: 2,
    providerExecutor: providerExecutor(() => {
      calls += 1;
      return { payload: decidedOutput() };
    }),
  });
  const inputs = ['a', 'b', 'c'].map((id) => sceneBoundary('worker4-core-' + id));
  for (const input of inputs) {
    await core.decide(buildSceneRequest(input), { currentRevisionState: currentFor(input) });
  }
  await core.decide(buildSceneRequest(inputs[0]), { currentRevisionState: currentFor(inputs[0]) });
  assert.equal(calls, 4);
});

test('Jev #211 repro: domain-adapter proposal replay retention is bounded', async () => {
  const core = new JevDecisionCore({
    providerExecutor: providerExecutor(() => ({ payload: decidedOutput() })),
  });
  const service = new JevDomainAdapterService({
    registry: createDefaultJevDomainAdapterRegistry(),
    core,
    replayLimit: 2,
  });
  const inputs = ['a', 'b', 'c'].map((id) => sceneBoundary('worker4-adapter-' + id));
  for (const input of inputs) {
    await service.adjudicate(input, { currentRevisionState: currentFor(input) });
  }
  await service.adjudicate(inputs[0], { currentRevisionState: currentFor(inputs[0]) });
  const sceneMetric = service.metricsSnapshot().find((row) => row.domain === 'SCENE');
  assert.equal(sceneMetric.replays, 0);
});
