import { LoreReconciliationClassification } from './coprocessor/jev-lore-adapter.js';

const ADVISORY_CLASSIFICATIONS = new Set(
  Object.values(LoreReconciliationClassification).filter((value) => value !== LoreReconciliationClassification.UNRESOLVED),
);

const receipt = (decision, reasonCode) => Object.freeze({
  decision,
  reasonCode,
  settlementPerformed: false,
  canonicalMutation: false,
});

// Lore accepts only the admissibility of a current advisory classification.
// Truth, authored source, Tree changes, and Settlement remain separate owner paths.
export function reviewLoreJevAdvisory(proposal, { currentLoreRevision } = {}) {
  if (proposal?.kind !== 'LoreReconciliationProposal'
    || proposal.domain !== 'LORE'
    || proposal.decisionKind !== 'LORE_RECONCILIATION'
    || proposal.owner !== 'LORE_OWNER'
    || proposal.requiresOwnerPolicy !== true
    || proposal.mutationAuthority !== false
    || proposal.requiresOperatorReview === true) {
    return receipt('REJECTED', 'LORE_JEV_OWNER_BOUNDARY_INVALID');
  }
  if (proposal.staleState === 'STALE'
    || !currentLoreRevision
    || proposal.revisionFence?.domainRevisions?.lore !== currentLoreRevision) {
    return receipt('REJECTED', 'LORE_JEV_REVISION_STALE');
  }
  if (proposal.abstained || proposal.unresolved || proposal.proposedOutcome === LoreReconciliationClassification.UNRESOLVED) {
    return receipt('UNRESOLVED', 'LORE_JEV_UNRESOLVED');
  }
  if (!ADVISORY_CLASSIFICATIONS.has(proposal.proposedOutcome)) {
    return receipt('REJECTED', 'LORE_JEV_OPTION_UNSUPPORTED');
  }
  if (proposal.evidenceCount < 2 || proposal.optionCount < 2) {
    return receipt('DEFERRED', 'LORE_JEV_EVIDENCE_INSUFFICIENT');
  }
  return receipt('ACCEPTED', 'LORE_ADVISORY_CLASSIFICATION_ADMITTED');
}
