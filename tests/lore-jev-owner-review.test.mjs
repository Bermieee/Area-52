import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewLoreJevAdvisory } from '../src/lore-jev-owner-review.js';

function proposal(overrides = {}) {
  return {
    kind: 'LoreReconciliationProposal',
    domain: 'LORE',
    decisionKind: 'LORE_RECONCILIATION',
    owner: 'LORE_OWNER',
    proposedOutcome: 'CONTRADICTORY',
    requiresOwnerPolicy: true,
    mutationAuthority: false,
    requiresOperatorReview: false,
    abstained: false,
    unresolved: false,
    staleState: 'FRESH',
    evidenceCount: 2,
    optionCount: 2,
    revisionFence: { domainRevisions: { lore: 'lore:7' } },
    ...overrides,
  };
}

test('Lore owner admits a current bounded Jev classification as advice only', () => {
  assert.deepEqual(reviewLoreJevAdvisory(proposal(), { currentLoreRevision: 'lore:7' }), {
    decision: 'ACCEPTED',
    reasonCode: 'LORE_ADVISORY_CLASSIFICATION_ADMITTED',
    settlementPerformed: false,
    canonicalMutation: false,
  });
});

test('Lore owner preserves unresolved, stale, and unsupported Jev proposals', () => {
  assert.equal(reviewLoreJevAdvisory(proposal({ proposedOutcome: 'UNRESOLVED', unresolved: true }), { currentLoreRevision: 'lore:7' }).decision, 'UNRESOLVED');
  assert.equal(reviewLoreJevAdvisory(proposal(), { currentLoreRevision: 'lore:8' }).decision, 'REJECTED');
  assert.equal(reviewLoreJevAdvisory(proposal({ evidenceCount: 1 }), { currentLoreRevision: 'lore:7' }).decision, 'DEFERRED');
  assert.equal(reviewLoreJevAdvisory(proposal({ mutationAuthority: true }), { currentLoreRevision: 'lore:7' }).decision, 'REJECTED');
  assert.equal(reviewLoreJevAdvisory(proposal({ proposedOutcome: 'DELETE_SOURCE' }), { currentLoreRevision: 'lore:7' }).decision, 'REJECTED');
});
