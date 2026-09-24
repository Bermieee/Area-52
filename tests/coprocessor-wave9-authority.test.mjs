import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JevDecisionCore,
  createDefaultJevDomainAdapterRegistry,
  createJevDecisionReceipt,
  createJevDomainAdapterMatrix,
} from '../src/coprocessor/index.js';
import { currentFor, loreReconciliation, output, providerExecutor, retrievalTruth, sceneBoundary } from './wave9-fixtures.mjs';

test('Jev confidence 1.0 never becomes Lore/Scene/Truth authority', async () => {
  const handler = ({ input }) => {
    const ids = input.data.options.map((x) => x.optionId);
    const selected = ids[0];
    return { payload: output({ selected: [selected], rejected: ids.slice(1), evidenceUsed: input.data.options[0].evidenceRefs.slice(0, 1), confidence: 1 }) };
  };
  const m = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(handler) });
  for (const input of [loreReconciliation('auth-lore'), sceneBoundary('auth-scene'), retrievalTruth('auth-rt')]) {
    const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
    assert.equal(proposal.mutationAuthority, false);
    assert.equal(proposal.requiresOwnerPolicy, true);
  }
});

test('Lore proposal cannot set SOURCE_CANON/delete UID/move Tree/merge source entries', async () => {
  const m = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(() => ({ payload: output({ selected: ['CONTRADICTORY'], rejected: ['EXACT_DUPLICATE', 'TEMPORALLY_DISTINCT'], evidenceUsed: ['lore:a', 'lore:b'] }) })) });
  const input = loreReconciliation('auth-lore-neg');
  const p = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(p.details.sourceCanon, false);
  assert.equal(p.details.uidDeletion, false);
  assert.equal(p.details.treeMutation, false);
  assert.equal(p.details.sourceMerge, false);
});

test('Scene proposal cannot create revision or upgrade presence/location authority', async () => {
  const m = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(() => ({ payload: output({ selected: ['RESUME_PRIOR_SCENE'], rejected: ['CONTINUE_SCENE', 'OPEN_NEW_SCENE', 'UNRESOLVED'], evidenceUsed: ['scene:a', 'scene:b'] }) })) });
  const input = sceneBoundary('auth-scene-neg');
  const p = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(p.details.createSceneRevision, false);
  assert.equal(p.details.presenceAuthority, false);
  assert.equal(p.details.locationAuthority, false);
});

test('Retrieval/Truth proposal cannot set candidate authority, rewrite provenance, settle truth, promote history, mutate Candidate Bus, or write Context Seal', async () => {
  const m = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(() => ({ payload: output({ selected: ['SUPPORT_A'], rejected: ['SUPPORT_B', 'PRESERVE_UNRESOLVED', 'ABSTAIN', 'ESCALATE'], evidenceUsed: ['rt:current'] }) })) });
  const input = retrievalTruth('auth-rt-neg');
  const p = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(p.details.candidateAuthority, false);
  assert.equal(p.details.provenanceRewrite, false);
  assert.equal(p.details.truthSettlement, false);
  assert.equal(p.details.historicalToCurrentPromotion, false);
  assert.equal(p.details.candidateBusMutation, false);
  assert.equal(p.details.contextSealWrite, false);
});

test('adapter receipt validation rejects forged authority even when decision IDs/fingerprint match', () => {
  const registry = createDefaultJevDomainAdapterRegistry();
  const adapter = registry.resolve('LORE', 'LORE_RECONCILIATION');
  const input = loreReconciliation('forged-authority');
  const pre = adapter.deterministicPrecheck(input);
  const request = adapter.buildRequest(input, pre);
  const receipt = createJevDecisionReceipt({ ...output({ selected: ['TEMPORALLY_DISTINCT'], rejected: ['EXACT_DUPLICATE', 'CONTRADICTORY'], evidenceUsed: ['lore:a'] }), providerProvenance: { providerId: 'p' } }, request);
  const forged = { ...receipt, authorityGranted: true };
  assert.throws(() => adapter.validateReceipt(forged, { input, request, currentRevisionState: currentFor(input), precheck: pre }), /authority boundary violated/);
});

test('ABSTAIN is successful bounded behavior and never converted to default winner', async () => {
  const m = createJevDomainAdapterMatrix({ providerExecutor: providerExecutor(() => ({ payload: output({ outcome: 'ABSTAINED', decisionCode: 'ABSTAIN', selected: [], rejected: [], evidenceUsed: [], abstained: true, confidence: 0 }) })) });
  const input = loreReconciliation('abstain-authority');
  const p = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(p.abstained, true);
  assert.equal(p.proposedOutcome, 'UNRESOLVED');
  assert.equal(p.mutationAuthority, false);
});