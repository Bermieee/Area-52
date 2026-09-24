import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Capability,
  JevDecisionCore,
  JevDomainAdapterRegistry,
  createDefaultJevDomainAdapterRegistry,
  createJevDomainAdapterMatrix,
  createLoreJevAdapter,
} from '../src/coprocessor/index.js';
import { base, currentFor, loreReconciliation, output, providerExecutor, retrievalTruth, sceneBoundary } from './wave9-fixtures.mjs';

function sharedHandler({ input }) {
  const type = input.data.decisionType;
  if (type === 'LORE_RECONCILIATION') return { payload: output({ outcome: 'UNRESOLVED', decisionCode: 'UNRESOLVED', selected: [], rejected: [], evidenceUsed: ['lore:a', 'lore:b'], unresolvedFactors: ['Sun Blade fate remains disputed'], confidence: .4 }) };
  if (type === 'SCENE_BOUNDARY') return { payload: output({ selected: ['RESUME_PRIOR_SCENE'], rejected: ['CONTINUE_SCENE', 'OPEN_NEW_SCENE', 'UNRESOLVED'], evidenceUsed: ['scene:a', 'scene:b'] }) };
  if (type === 'TRUTH_SEMANTIC_AMBIGUITY') return { payload: output({ outcome: 'UNRESOLVED', decisionCode: 'UNRESOLVED', selected: [], rejected: [], evidenceUsed: ['rt:current', 'rt:historical'], unresolvedFactors: ['Current destruction and historical Blade location are different temporal classes'], confidence: .45 }) };
  return { payload: output({ outcome: 'ABSTAINED', decisionCode: 'ABSTAIN', selected: [], rejected: [], evidenceUsed: [], abstained: true, confidence: 0 }) };
}

test('adapter registry is explicit, deterministic, bounded by stable ID, and rejects duplicates/unsupported lookup', () => {
  const registry = createDefaultJevDomainAdapterRegistry();
  assert.equal(registry.size, 3);
  assert.deepEqual(registry.list().map((x) => x.adapterId), ['jev.adapter.lore.v1', 'jev.adapter.retrieval-truth.v1', 'jev.adapter.scene.v1']);
  assert.equal(registry.resolve('LORE', 'LORE_RECONCILIATION').adapterId, 'jev.adapter.lore.v1');
  assert.throws(() => registry.register(createLoreJevAdapter()), /duplicate Jev adapterId/);
  assert.throws(() => registry.resolve('MEMORY', 'FAKE_MEMORY_DECISION'), /unsupported Jev adapter/);
});

test('three independent owner domains use the same Jev core and separate owner proposal types', async () => {
  const core = new JevDecisionCore({ providerExecutor: providerExecutor(sharedHandler, { providerId: 'shared-provider', workerId: 'one-shared-resource' }) });
  const m = createJevDomainAdapterMatrix({ core });
  const lore = loreReconciliation('same-core-lore');
  const scene = sceneBoundary('same-core-scene');
  const retrieval = retrievalTruth('same-core-retrieval');
  const proposals = [
    await m.service.adjudicate(lore, { currentRevisionState: currentFor(lore) }),
    await m.service.adjudicate(scene, { currentRevisionState: currentFor(scene) }),
    await m.service.adjudicate(retrieval, { currentRevisionState: currentFor(retrieval) }),
  ];
  assert.deepEqual(proposals.map((p) => p.proposalType), ['LoreReconciliationProposal', 'SceneDecisionProposal', 'RetrievalTruthDecisionProposal']);
  assert.equal(core.metricsSnapshot().providerCalls, 3);
  assert.ok(proposals.every((p) => p.mutationAuthority === false && p.requiresOwnerPolicy === true));
  assert.ok(proposals.every((p) => p.providerProvenance.providerId === 'shared-provider'));
});

test('Ember Tavern cross-domain golden preserves domain ownership and temporal truth classes', async () => {
  const m = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(sharedHandler) });
  const lore = loreReconciliation('ember-lore');
  const scene = sceneBoundary('ember-scene');
  const retrieval = retrievalTruth('ember-retrieval');
  const lp = await m.service.adjudicate(lore, { currentRevisionState: currentFor(lore) });
  const sp = await m.service.adjudicate(scene, { currentRevisionState: currentFor(scene) });
  const rp = await m.service.adjudicate(retrieval, { currentRevisionState: currentFor(retrieval) });
  assert.equal(lp.proposedOutcome, 'UNRESOLVED');
  assert.equal(sp.proposedOutcome, 'RESUME_PRIOR_SCENE');
  assert.equal(rp.proposedOutcome, 'UNRESOLVED');
  assert.equal(lp.details.treeMutation, false);
  assert.equal(sp.details.createSceneRevision, false);
  assert.equal(rp.details.historicalToCurrentPromotion, false);
  assert.equal(rp.details.truthSettlement, false);
});

test('same bounded request replays one proposal/provider call; revision change creates new identity', async () => {
  let calls = 0;
  const m = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(() => { calls += 1; return { payload: output({ selected: ['TEMPORALLY_DISTINCT'], rejected: ['EXACT_DUPLICATE', 'CONTRADICTORY'], evidenceUsed: ['lore:a', 'lore:b'] }) }; }) });
  const input = loreReconciliation('replay-lore');
  const a = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  const b = await m.service.adjudicate(structuredClone(input), { currentRevisionState: currentFor(input) });
  assert.equal(a, b);
  assert.equal(calls, 1);
  const changed = loreReconciliation('replay-lore', { loreRevision: 8, ownerRevision: 4, freshnessToken: 'fresh:replay-lore:2' });
  const c = await m.service.adjudicate(changed, { currentRevisionState: currentFor(changed) });
  assert.notEqual(c.sourceRequestRef, a.sourceRequestRef);
  assert.equal(calls, 2);
});

test('malformed Lore adapter input is isolated; Scene and Retrieval adapters continue working', async () => {
  const m = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(sharedHandler) });
  const badLore = loreReconciliation('bad-lore', { options: [] });
  const scene = sceneBoundary('isolation-scene', { boundarySignals: { doorwayOnly: true } });
  const retrieval = retrievalTruth('isolation-retrieval', { retrievalQuality: 'LOW' });
  const lp = await m.service.adjudicate(badLore, { currentRevisionState: currentFor(badLore) });
  const sp = await m.service.adjudicate(scene, { currentRevisionState: currentFor(scene) });
  const rp = await m.service.adjudicate(retrieval, { currentRevisionState: currentFor(retrieval) });
  assert.equal(lp.status, 'ADAPTER_DEGRADED');
  assert.equal(lp.proposedOutcome, 'UNRESOLVED');
  assert.equal(sp.proposedOutcome, 'CONTINUE_SCENE');
  assert.equal(rp.proposedOutcome, 'UNRESOLVED');
});

test('Runtime compatibility is one generic JEV_DECISION / SEMANTIC_JUDGMENT logical task', () => {
  const m = createJevDomainAdapterMatrix({ core: new JevDecisionCore() });
  for (const input of [loreReconciliation('runtime-lore'), sceneBoundary('runtime-scene'), retrievalTruth('runtime-rt')]) {
    const task = m.service.toRuntimeTask(input);
    assert.equal(task.taskType, 'JEV_DECISION');
    assert.deepEqual(task.requiredCapabilities, [Capability.SEMANTIC_JUDGMENT]);
    assert.equal(task.metadata.domain, input.domain);
    assert.equal(task.metadata.authorityGranted, false);
    assert.doesNotMatch(task.taskType, /LORE|SCENE|TRUTH/);
  }
});

test('UI diagnostic projection is bounded/read-only and omits raw evidence bodies', async () => {
  const m = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(sharedHandler) });
  const input = sceneBoundary('ui-scene');
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  const basic = m.service.diagnosticProjection(proposal);
  const advanced = m.service.diagnosticProjection(proposal, { advanced: true });
  assert.equal(basic.domain, 'SCENE');
  assert.equal('advanced' in basic, false);
  assert.equal(advanced.advanced.providerId, 'wave9-provider');
  assert.equal(JSON.stringify(basic).includes('Eris remembers'), false);
  assert.equal(JSON.stringify(advanced).includes('Eris remembers'), false);
});

test('bounded telemetry records decision metadata/provenance only and never raw evidence', async () => {
  const m = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(sharedHandler) });
  const input = loreReconciliation('telemetry-lore');
  await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  const metrics = m.service.metricsSnapshot();
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].domain, 'LORE');
  assert.equal(metrics[0].jevInvoked, 1);
  assert.deepEqual(metrics[0].providerIds, ['wave9-provider']);
  assert.equal(JSON.stringify(metrics).includes('Sun Blade'), false);
});

test('provider unavailable, timeout, and malformed output degrade safely without domain facts', async () => {
  const fixtures = [loreReconciliation('fail-lore'), sceneBoundary('fail-scene'), retrievalTruth('fail-rt')];
  for (const input of fixtures) {
    const unavailable = createJevDomainAdapterMatrix({ core: new JevDecisionCore() });
    const up = await unavailable.service.adjudicate(input, { currentRevisionState: currentFor(input) });
    assert.equal(up.proposedOutcome, 'UNRESOLVED');
    assert.equal(up.mutationAuthority, false);

    const timeout = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(() => { const e = new Error('timeout'); e.code = 'PROVIDER_TIMEOUT'; throw e; }) });
    const tp = await timeout.service.adjudicate({ ...input, decisionId: `${input.decisionId}:timeout`, taskId: `${input.taskId}:timeout`, freshnessToken: `${input.freshnessToken}:timeout`, maxRetries: 0 }, { currentRevisionState: currentFor({ ...input, freshnessToken: `${input.freshnessToken}:timeout` }) });
    assert.equal(tp.proposedOutcome, 'UNRESOLVED');
    assert.equal(tp.mutationAuthority, false);

    const malformed = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(() => ({ payload: { bad: true } })) });
    const mpInput = { ...input, decisionId: `${input.decisionId}:malformed`, taskId: `${input.taskId}:malformed`, freshnessToken: `${input.freshnessToken}:malformed`, maxRetries: 0 };
    const mp = await malformed.service.adjudicate(mpInput, { currentRevisionState: currentFor(mpInput) });
    assert.equal(mp.proposedOutcome, 'UNRESOLVED');
    assert.equal(mp.mutationAuthority, false);
  }
});