import {deepClone, stableHash} from './lore-contracts.js';

export const LoreReviewState = Object.freeze({
  PROPOSED: 'PROPOSED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  DEFERRED: 'DEFERRED',
  BLOCKED: 'BLOCKED',
});

export const LoreOperatorDecision = Object.freeze({
  ACCEPT: 'ACCEPT',
  CHANGE: 'CHANGE',
  DEFER: 'DEFER',
  REJECT: 'REJECT',
});

export const LoreAuthoringStage = Object.freeze({
  BUILDING: 'BUILDING',
  CHECKPOINTED: 'CHECKPOINTED',
  DRAFT_REVIEW: 'DRAFT_REVIEW',
  FINAL_PREVIEW: 'FINAL_PREVIEW',
  READY_TO_SETTLE: 'READY_TO_SETTLE',
  SETTLING: 'SETTLING',
  SETTLED: 'SETTLED',
  RESTORING: 'RESTORING',
  RESTORED: 'RESTORED',
  FAILED: 'FAILED',
});

export const LoreSettlementState = Object.freeze({
  PENDING: 'PENDING',
  APPLYING: 'APPLYING',
  CHECKPOINTED: 'CHECKPOINTED',
  SETTLED: 'SETTLED',
  RESTORING: 'RESTORING',
  RESTORED: 'RESTORED',
  FAILED: 'FAILED',
});

export const LoreTreeAction = Object.freeze({
  CREATE_NODE: 'CREATE_NODE',
  MOVE_ENTRY: 'MOVE_ENTRY',
  RENAME_NODE: 'RENAME_NODE',
  MERGE_NODE: 'MERGE_NODE',
  SPLIT_NODE: 'SPLIT_NODE',
});

export const LoreSourceAction = Object.freeze({
  CREATE_ENTRY: 'CREATE_ENTRY',
  UPDATE_ENTRY: 'UPDATE_ENTRY',
  DELETE_ENTRY: 'DELETE_ENTRY',
});

export const LoreMergeClassification = Object.freeze({
  EXACT_DUPLICATE: 'EXACT_DUPLICATE',
  LIKELY_OVERLAP: 'LIKELY_OVERLAP',
  COMPLEMENTARY: 'COMPLEMENTARY',
  TITLE_KEY_COLLISION: 'TITLE_KEY_COLLISION',
  UNRESOLVED_CONTRADICTION: 'UNRESOLVED_CONTRADICTION',
});

export const LoreInvalidationTarget = Object.freeze({
  STUDY_ARTIFACTS: 'STUDY_ARTIFACTS',
  REPRESENTATIONS: 'REPRESENTATIONS',
  ONTOLOGY: 'ONTOLOGY',
  NAVIGATION_SUMMARIES: 'NAVIGATION_SUMMARIES',
  RETRIEVAL_INDEX: 'RETRIEVAL_INDEX',
});

export function makeLoreAuthoringError(code, message, details = {}, {retryable = false} = {}) {
  return {
    kind: 'LoreAuthoringError',
    contractVersion: 1,
    code: String(code || 'LORE_AUTHORING_ERROR'),
    message: String(message || 'Lore authoring request failed'),
    details: deepClone(details || {}),
    retryable: Boolean(retryable),
    safe: true,
  };
}

export function normalizeLoreAuthoringError(error, fallbackCode = 'LORE_AUTHORING_ERROR') {
  if (error?.kind === 'LoreAuthoringError') return deepClone(error);
  return makeLoreAuthoringError(
    error?.code || fallbackCode,
    error?.message || String(error || 'Lore authoring request failed'),
    {},
  );
}

export function sourceRevisionIdentity(registry, sourceId, revisionId = null) {
  const source = registry.getEntry(sourceId);
  if (!source) {
    throw Object.assign(new Error('Unknown Lore source: ' + sourceId), {code: 'LORE_AUTHORING_SOURCE_UNKNOWN'});
  }
  const revision = revisionId
    ? registry.getRevision(revisionId)
    : registry.currentRevision(sourceId, {allowMissing: true});
  if (!revision || revision.sourceId !== sourceId) {
    throw Object.assign(new Error('Unknown Lore source revision: ' + String(revisionId)), {code: 'LORE_AUTHORING_REVISION_UNKNOWN'});
  }
  return {
    kind: 'LoreSourceRevisionIdentity',
    contractVersion: 1,
    sourceId: source.sourceId,
    lorebookId: source.lorebookId,
    uid: source.uid,
    sourceRevisionId: revision.id,
    revision: revision.revision,
    state: revision.state,
    contentHash: revision.contentHash,
    exactFingerprint: revision.exactFingerprint,
    replacesRevisionId: revision.replacesRevisionId || null,
    metadata: deepClone(revision.metadata || {}),
    authored: true,
    exactSourceRecoverable: revision.state !== 'REMOVED',
  };
}

export function makeReviewItem({type, message, sourceIds = [], evidenceRefs = [], details = {}, state = LoreReviewState.NEEDS_REVIEW}) {
  const payload = {
    kind: 'LoreAuthoringReviewItem',
    type: String(type),
    message: String(message),
    sourceIds: [...new Set((sourceIds || []).map(String))].sort(),
    evidenceRefs: [...new Set((evidenceRefs || []).map(String))].sort(),
    details: deepClone(details || {}),
    state,
  };
  return {
    ...payload,
    id: 'lore-review:' + stableHash(payload),
  };
}

export function safeOperatorResult(fn) {
  try {
    return {ok: true, value: fn(), error: null};
  } catch (error) {
    return {ok: false, value: null, error: normalizeLoreAuthoringError(error)};
  }
}
