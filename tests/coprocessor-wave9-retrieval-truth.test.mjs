import test from 'node:test';
import assert from 'node:assert/strict';
import { JevDecisionCore, createJevDomainAdapterMatrix } from '../src/coprocessor/index.js';
import { base, currentFor, output, providerExecutor, retrievalTruth } from './wave9-fixtures.mjs';

function matrix(handler, provider = {}) { return createJevDomainAdapterMatrix({ core: new JevDecisionCore({ providerExecutor: handler ? providerExecutor(handler, provider) : null }) }); }

test('Retrieval obvious stale candidate is deterministically rejected and Jev is skipped', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output() }; });
  const input = base('RETRIEVAL_TRUTH', 'RETRIEVAL_CANDIDATE_INTERPRETATION', 'rt-stale-candidate', {
    options: [
      { optionId: 'candidate:stale', stale: true, evidenceRefs: ['e:stale'] },
      { optionId: 'candidate:fresh', evidenceRefs: ['e:fresh'] },
    ],
    evidence: [
      { evidenceId: 'e:stale', summary: 'Old candidate', stale: true },
      { evidenceId: 'e:fresh', summary: 'Current candidate' },
    ],
    retrievalQuality: 'MIXED',
  });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 0);
  assert.equal(proposal.proposedOutcome, 'candidate:fresh');
  assert.equal(proposal.details.candidateAuthority, false);
});

test('HIGH-quality retrieval deterministically chooses NO_CORRECTION', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output() }; });
  const input = base('RETRIEVAL_TRUTH', 'RETRIEVAL_CORRECTIVE_CHOICE', 'rt-high', {
    retrievalQuality: 'HIGH',
    options: [
      { optionId: 'NO_CORRECTION', evidenceRefs: ['e:quality'] },
      { optionId: 'RETRY_SPARSE', evidenceRefs: ['e:quality'] },
      { optionId: 'RETRY_DENSE', evidenceRefs: ['e:quality'] },
      { optionId: 'RETRY_GRAPH', evidenceRefs: ['e:quality'] },
      { optionId: 'ABSTAIN', evidenceRefs: [] },
    ],
    evidence: [{ evidenceId: 'e:quality', summary: 'All required intents are covered by fresh candidates.' }],
  });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 0);
  assert.equal(proposal.proposedOutcome, 'NO_CORRECTION');
});

test('MIXED ambiguity after correction may invoke Jev for finite corrective alternative', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output({ selected: ['RETRY_GRAPH'], rejected: ['NO_CORRECTION', 'RETRY_SPARSE', 'RETRY_DENSE', 'ABSTAIN'], evidenceUsed: ['e:mixed'] }) }; });
  const input = base('RETRIEVAL_TRUTH', 'RETRIEVAL_CORRECTIVE_CHOICE', 'rt-mixed', {
    retrievalQuality: 'MIXED',
    correctiveAttempt: 1,
    options: [
      { optionId: 'NO_CORRECTION', evidenceRefs: ['e:mixed'] },
      { optionId: 'RETRY_SPARSE', evidenceRefs: ['e:mixed'] },
      { optionId: 'RETRY_DENSE', evidenceRefs: ['e:mixed'] },
      { optionId: 'RETRY_GRAPH', evidenceRefs: ['e:mixed'] },
      { optionId: 'ABSTAIN', evidenceRefs: [] },
    ],
    evidence: [{ evidenceId: 'e:mixed', summary: 'Sparse and dense remain semantically ambiguous after one correction.' }],
  });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 1);
  assert.equal(proposal.proposedOutcome, 'RETRY_GRAPH');
  assert.equal(proposal.details.candidateBusMutation, false);
});

test('LOW-quality Retrieval/Truth safely remains unresolved without provider', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output() }; });
  const input = retrievalTruth('rt-low', { retrievalQuality: 'LOW' });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 0);
  assert.equal(proposal.proposedOutcome, 'UNRESOLVED');
  assert.equal(proposal.details.allowWeakEvidencePromotion, false);
});

test('historical candidate cannot be promoted to CURRENT by semantic preference', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output() }; });
  const input = base('RETRIEVAL_TRUTH', 'RETRIEVAL_CANDIDATE_INTERPRETATION', 'rt-temporal', {
    options: [
      { optionId: 'historical-as-current', evidenceRefs: ['e:historical'], payload: { promotesHistoricalToCurrent: true } },
      { optionId: 'preserve-temporal-class', evidenceRefs: ['e:historical'] },
    ],
    evidence: [{ evidenceId: 'e:historical', summary: 'Blade was at the Tavern before destruction.', metadata: { temporalClass: 'HISTORICAL' } }],
  });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 0);
  assert.equal(proposal.proposedOutcome, 'preserve-temporal-class');
  assert.equal(proposal.details.historicalToCurrentPromotion, false);
});

test('provider disagreement changes proposal provenance/outcome but never grants truth authority', async () => {
  const input = retrievalTruth('rt-provider-disagreement');
  const a = matrix(() => ({ payload: output({ selected: ['SUPPORT_A'], rejected: ['SUPPORT_B', 'PRESERVE_UNRESOLVED', 'ABSTAIN', 'ESCALATE'], evidenceUsed: ['rt:current'] }) }), { providerId: 'provider-a' });
  const b = matrix(() => ({ payload: output({ selected: ['SUPPORT_B'], rejected: ['SUPPORT_A', 'PRESERVE_UNRESOLVED', 'ABSTAIN', 'ESCALATE'], evidenceUsed: ['rt:historical'] }) }), { providerId: 'provider-b' });
  const pa = await a.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  const pb = await b.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.notEqual(pa.proposedOutcome, pb.proposedOutcome);
  for (const p of [pa, pb]) {
    assert.equal(p.mutationAuthority, false);
    assert.equal(p.details.truthSettlement, false);
    assert.equal(p.details.candidateAuthority, false);
  }
});

test('stale candidate-set revision is rejected', async () => {
  const m = matrix(() => ({ payload: output({ selected: ['SUPPORT_A'], rejected: ['SUPPORT_B', 'PRESERVE_UNRESOLVED', 'ABSTAIN', 'ESCALATE'], evidenceUsed: ['rt:current'] }) }));
  const input = retrievalTruth('rt-stale-set');
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input, { domainRevisions: { candidateSet: 10, truthOwner: 4 } }) });
  assert.equal(proposal.staleState, 'STALE');
  assert.equal(proposal.proposedOutcome, 'UNRESOLVED');
  assert.equal(proposal.details.contextSealWrite, false);
});