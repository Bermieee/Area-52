import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JevDecisionCore,
  createJevDomainAdapterMatrix,
  LoreJevDecisionKind,
} from '../src/coprocessor/index.js';
import { base, currentFor, loreReconciliation, output, providerExecutor } from './wave9-fixtures.mjs';

function matrix(handler) { return createJevDomainAdapterMatrix({ core: new JevDecisionCore({ providerExecutor: handler ? providerExecutor(handler) : null }) }); }

test('Lore obvious exact duplicate is deterministic and skips provider', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output() }; });
  const input = loreReconciliation('lore-duplicate', { exactDuplicate: true });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(proposal.path, 'DETERMINISTIC');
  assert.equal(proposal.proposedOutcome, 'EXACT_DUPLICATE');
  assert.equal(calls, 0);
  assert.equal(proposal.mutationAuthority, false);
  assert.equal(proposal.details.sourceMerge, false);
});

test('Lore ambiguous duplicate versus temporal succession invokes generic Jev and returns proposal only', async () => {
  let calls = 0;
  const m = matrix(({ input }) => { calls += 1; return { payload: output({ selected: ['TEMPORALLY_DISTINCT'], rejected: ['EXACT_DUPLICATE', 'CONTRADICTORY'], evidenceUsed: ['lore:a', 'lore:b'], classification: 'TEMPORALLY_DISTINCT' }) }; });
  const input = loreReconciliation('lore-temporal');
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 1);
  assert.equal(proposal.proposedOutcome, 'TEMPORALLY_DISTINCT');
  assert.equal(proposal.requiresOwnerPolicy, true);
  assert.equal(proposal.details.treeMutation, false);
});

test('Lore contradictory Sun Blade evidence may remain UNRESOLVED', async () => {
  const m = matrix(() => ({ payload: output({ outcome: 'UNRESOLVED', decisionCode: 'UNRESOLVED', selected: [], rejected: [], evidenceUsed: ['lore:a', 'lore:b'], unresolvedFactors: ['Both admissible fates retain support'], confidence: .35 }) }));
  const input = loreReconciliation('sun-blade');
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(proposal.proposedOutcome, 'UNRESOLVED');
  assert.equal(proposal.unresolved, true);
  assert.equal(proposal.details.sourceCanon, false);
});

test('Lore protected Tree placement is rejected before Jev and cannot be selected', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output() }; });
  const input = base('LORE', LoreJevDecisionKind.TREE_PLACEMENT, 'lore-tree', {
    options: [
      { optionId: 'tree:protected', protected: true, evidenceRefs: ['e:place'] },
      { optionId: 'tree:safe', evidenceRefs: ['e:place'] },
    ],
    evidence: [{ evidenceId: 'e:place', summary: 'Membership evidence', provenanceRefs: ['src:tree'] }],
    provenanceRefs: ['src:tree'],
  });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 0);
  assert.equal(proposal.proposedOutcome, 'tree:safe');
  assert.equal(proposal.details.treeMutation, false);
});

test('Lore stale source/world revision yields STALE proposal and no owner mutation', async () => {
  const m = matrix(() => ({ payload: output({ selected: ['EXACT_DUPLICATE'], rejected: ['TEMPORALLY_DISTINCT', 'CONTRADICTORY'], evidenceUsed: ['lore:a'] }) }));
  const input = loreReconciliation('lore-stale');
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input, { worldRevision: 12 }) });
  assert.equal(proposal.staleState, 'STALE');
  assert.equal(proposal.proposedOutcome, 'UNRESOLVED');
  assert.equal(proposal.mutationAuthority, false);
});

test('Lore representation retention failure may recommend REWORK_REQUIRED but cannot rewrite source', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output() }; });
  const input = base('LORE', LoreJevDecisionKind.RETENTION_REVIEW, 'lore-retention', {
    options: [
      { optionId: 'PASS', evidenceRefs: ['e:retention'] },
      { optionId: 'REWORK_REQUIRED', evidenceRefs: ['e:retention'] },
      { optionId: 'UNRESOLVED', evidenceRefs: ['e:retention'] },
    ],
    evidence: [{ evidenceId: 'e:retention', summary: 'Required contribution omitted from representation.', provenanceRefs: ['representation:17'] }],
    provenanceRefs: ['representation:17'],
    representationRef: 'representation:17',
    requiredContributionMissing: true,
  });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 0);
  assert.equal(proposal.proposedOutcome, 'REWORK_REQUIRED');
  assert.equal(proposal.details.sourceMerge, false);
  assert.equal(proposal.mutationAuthority, false);
});