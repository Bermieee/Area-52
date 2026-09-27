import {deepClone, stableHash, stableStringify} from './lore-contracts.js';
import {
  LoreMutationOperation,
  LoreMutationScopeMode,
  LoreMutationState,
} from './lore-authoring-contracts.js';
import {LoreSemanticImpactPlanner} from './lore-semantic-impact-planner.js';
import {LoreIntelligenceService} from './lore-intelligence-service.js';

const MAX_PREVIEW_TEXT = 4096;
const MAX_EVIDENCE_REFS = 128;
const MAX_QUEUE = 128;

function requiredString(value, code, label) {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw Object.assign(new TypeError(label + ' is required'), {code});
  return text;
}

function unique(values = []) {
  return [...new Set((values || []).filter((row) => row !== null && row !== undefined).map(String))];
}

function sourceIdFor(lorebookId, uid) {
  return 'lore:' + String(lorebookId) + ':' + String(uid);
}

function boundedText(value) {
  if (value == null) return {content: null, contentIncluded: false, contentTruncated: false, contentLength: 0};
  const text = String(value);
  return {
    content: text.slice(0, MAX_PREVIEW_TEXT),
    contentIncluded: true,
    contentTruncated: text.length > MAX_PREVIEW_TEXT,
    contentLength: text.length,
  };
}

function sourceState(registry, sourceId) {
  const source = registry.getEntry(sourceId);
  const revision = source ? registry.currentRevision(sourceId, {allowMissing: true}) : null;
  return source && revision ? {
    sourceId,
    lorebookId: source.lorebookId,
    uid: source.uid,
    source: deepClone(source),
    revision: deepClone(revision),
    exactContent: revision.exactContent,
    metadata: deepClone(revision.metadata || {}),
  } : null;
}

function normalizeTarget(target = {}, fallback = {}) {
  const lorebookId = requiredString(target.lorebookId ?? fallback.lorebookId, 'LORE_MUTATION_TARGET_BOOK_REQUIRED', 'Target lorebookId');
  const uid = requiredString(target.uid ?? fallback.uid, 'LORE_MUTATION_TARGET_UID_REQUIRED', 'Target uid');
  const content = target.content ?? fallback.content;
  if (typeof content !== 'string') {
    throw Object.assign(new TypeError('Target exact authored content is required'), {code: 'LORE_MUTATION_TARGET_CONTENT_REQUIRED'});
  }
  return {
    lorebookId,
    uid,
    sourceId: sourceIdFor(lorebookId, uid),
    content,
    metadata: deepClone(target.metadata ?? fallback.metadata ?? {}),
  };
}

function normalizeScope(request = {}) {
  if (request.scopeMode === LoreMutationScopeMode.GLOBAL_OPERATOR) {
    return {
      scopeMode: LoreMutationScopeMode.GLOBAL_OPERATOR,
      chatId: null,
      exactChatBound: false,
      globalOperatorExplicit: true,
    };
  }
  const chatId = requiredString(
    request.chatId,
    'LORE_MUTATION_SCOPE_REQUIRED',
    'Exact chatId or scopeMode=GLOBAL_OPERATOR',
  );
  return {
    scopeMode: LoreMutationScopeMode.CHAT,
    chatId,
    exactChatBound: true,
    globalOperatorExplicit: false,
  };
}

function publicRevision(row) {
  if (!row) return null;
  return {
    sourceId: row.sourceId,
    lorebookId: row.lorebookId,
    uid: row.uid,
    sourceRevisionId: row.id,
    revision: row.revision,
    state: row.state,
    contentHash: row.contentHash,
    exactFingerprint: row.exactFingerprint,
    treePath: deepClone(row.metadata?.treePath || []),
  };
}

function makePreviewRow({sourceId, lorebookId, uid, revision = null, content = null, metadata = {}, removed = false}) {
  return {
    sourceId,
    lorebookId,
    uid,
    sourceRevisionId: revision?.id || null,
    revision: revision?.revision || null,
    state: removed ? 'REMOVED' : (revision?.state || 'PROPOSED'),
    contentHash: revision?.contentHash || null,
    metadata: deepClone(metadata || {}),
    treePath: deepClone(metadata?.treePath || []),
    removed: Boolean(removed),
    ...boundedText(removed ? null : content),
  };
}

function currentLearnedEvidence(intelligence, sourceIds) {
  const refs = [];
  const claimRefs = [];
  for (const sourceId of sourceIds) {
    const learned = intelligence.runtime.store.currentLearnedRevision(sourceId);
    if (!learned) continue;
    const artifacts = intelligence.runtime.store.artifactsForLearnedRevision(learned.id);
    for (const artifact of artifacts) {
      refs.push(artifact.id);
      if (artifact.artifactType === 'CLAIM') claimRefs.push(artifact.id);
      if (refs.length >= MAX_EVIDENCE_REFS) break;
    }
  }
  return {
    artifactRefs: unique(refs).slice(0, MAX_EVIDENCE_REFS),
    claimRefs: unique(claimRefs).slice(0, MAX_EVIDENCE_REFS),
  };
}

export class LoreReviewedMutationService {
  constructor({intelligence, impactPlanner = null, snapshot = null} = {}) {
    if (!intelligence) throw new TypeError('LoreReviewedMutationService requires LoreIntelligenceService');
    this.intelligence = intelligence;
    this.impactPlanner = impactPlanner || new LoreSemanticImpactPlanner({intelligence});
    this.proposals = new Map();
    this.fingerprintIndex = new Map();
    this.audits = new Map();
    this.decisionIds = new Map();
    this.sequence = 0;
    if (snapshot) this._restoreSnapshot(snapshot);
  }

  _assertCurrentSource(sourceId) {
    const registry = this.intelligence.runtime.registry;
    const state = sourceState(registry, sourceId);
    if (!state || state.revision.state === 'REMOVED') {
      throw Object.assign(new Error('Current Lore source is required: ' + sourceId), {code: 'LORE_MUTATION_SOURCE_NOT_CURRENT'});
    }
    return state;
  }

  _assertTargetAbsent(sourceId) {
    if (this.intelligence.runtime.registry.getEntry(sourceId)) {
      throw Object.assign(new Error('Target Lore UID already exists: ' + sourceId), {code: 'LORE_MUTATION_TARGET_COLLISION'});
    }
  }

  _assertScope(scope, sourceIds, targetLorebookIds) {
    if (scope.scopeMode === LoreMutationScopeMode.GLOBAL_OPERATOR) return;
    for (const sourceId of sourceIds) {
      const source = this.intelligence.runtime.registry.getEntry(sourceId);
      if (!source || !this.intelligence.storyAuthority.isReadAllowed(scope.chatId, source.lorebookId)) {
        throw Object.assign(new Error('Lore source is outside the exact chat authoring scope: ' + sourceId), {
          code: 'LORE_MUTATION_SCOPE_UNAUTHORIZED',
        });
      }
    }
    for (const lorebookId of unique(targetLorebookIds)) {
      if (!this.intelligence.storyAuthority.isReadAllowed(scope.chatId, lorebookId)) {
        throw Object.assign(new Error('Target Lorebook is outside the exact chat authoring scope: ' + lorebookId), {
          code: 'LORE_MUTATION_SCOPE_UNAUTHORIZED',
        });
      }
    }
  }

  _normalizeIntent(request = {}) {
    const operation = String(request.operation || '');
    if (!Object.values(LoreMutationOperation).includes(operation)) {
      throw Object.assign(new TypeError('Unsupported Lore mutation operation: ' + operation), {code: 'LORE_MUTATION_OPERATION_UNSUPPORTED'});
    }
    const registry = this.intelligence.runtime.registry;
    const scope = normalizeScope(request);
    const writes = [];
    const sourceIds = [];
    const targetLorebookIds = [];
    const input = {operation};

    if (operation === LoreMutationOperation.CREATE) {
      const target = normalizeTarget(request.target);
      this._assertTargetAbsent(target.sourceId);
      writes.push({kind: 'UPSERT', ...target, expectedSourceRevisionId: null});
      targetLorebookIds.push(target.lorebookId);
      input.target = target;
    } else if (operation === LoreMutationOperation.UPDATE) {
      const state = this._assertCurrentSource(requiredString(request.sourceId, 'LORE_MUTATION_SOURCE_REQUIRED', 'sourceId'));
      const after = request.after || {};
      if (typeof after.content !== 'string') {
        throw Object.assign(new TypeError('UPDATE requires after.content'), {code: 'LORE_MUTATION_UPDATE_CONTENT_REQUIRED'});
      }
      const target = normalizeTarget({
        lorebookId: state.lorebookId,
        uid: state.uid,
        content: after.content,
        metadata: after.metadata ?? state.metadata,
      });
      writes.push({kind: 'UPSERT', ...target, expectedSourceRevisionId: state.revision.id});
      sourceIds.push(state.sourceId);
      input.sourceId = state.sourceId;
      input.after = {content: target.content, metadata: deepClone(target.metadata)};
    } else if (operation === LoreMutationOperation.DELETE) {
      const state = this._assertCurrentSource(requiredString(request.sourceId, 'LORE_MUTATION_SOURCE_REQUIRED', 'sourceId'));
      writes.push({
        kind: 'REMOVE',
        sourceId: state.sourceId,
        lorebookId: state.lorebookId,
        uid: state.uid,
        expectedSourceRevisionId: state.revision.id,
      });
      sourceIds.push(state.sourceId);
      input.sourceId = state.sourceId;
    } else if (operation === LoreMutationOperation.TREE_ASSIGN) {
      const state = this._assertCurrentSource(requiredString(request.sourceId, 'LORE_MUTATION_SOURCE_REQUIRED', 'sourceId'));
      if (!Array.isArray(request.treePath)) {
        throw Object.assign(new TypeError('TREE_ASSIGN requires treePath'), {code: 'LORE_MUTATION_TREE_PATH_REQUIRED'});
      }
      const metadata = {...deepClone(state.metadata), treePath: request.treePath.map(String)};
      writes.push({
        kind: 'UPSERT',
        sourceId: state.sourceId,
        lorebookId: state.lorebookId,
        uid: state.uid,
        content: state.exactContent,
        metadata,
        expectedSourceRevisionId: state.revision.id,
      });
      sourceIds.push(state.sourceId);
      input.sourceId = state.sourceId;
      input.treePath = [...metadata.treePath];
    } else if (operation === LoreMutationOperation.MOVE) {
      const state = this._assertCurrentSource(requiredString(request.sourceId, 'LORE_MUTATION_SOURCE_REQUIRED', 'sourceId'));
      const target = normalizeTarget(request.target, {
        lorebookId: state.lorebookId,
        content: state.exactContent,
        metadata: state.metadata,
      });
      if (target.sourceId === state.sourceId) {
        throw Object.assign(new Error('MOVE target must be a different UID/source'), {code: 'LORE_MUTATION_MOVE_SAME_SOURCE'});
      }
      this._assertTargetAbsent(target.sourceId);
      writes.push({kind: 'UPSERT', ...target, expectedSourceRevisionId: null});
      writes.push({
        kind: 'REMOVE',
        sourceId: state.sourceId,
        lorebookId: state.lorebookId,
        uid: state.uid,
        expectedSourceRevisionId: state.revision.id,
      });
      sourceIds.push(state.sourceId);
      targetLorebookIds.push(target.lorebookId);
      input.sourceId = state.sourceId;
      input.target = target;
    } else if (operation === LoreMutationOperation.MERGE) {
      const ids = unique(request.sourceIds);
      if (ids.length < 2) {
        throw Object.assign(new TypeError('MERGE requires at least two sourceIds'), {code: 'LORE_MUTATION_MERGE_INPUTS_REQUIRED'});
      }
      for (const id of ids) this._assertCurrentSource(id);
      const target = normalizeTarget(request.target);
      this._assertTargetAbsent(target.sourceId);
      writes.push({kind: 'UPSERT', ...target, expectedSourceRevisionId: null});
      sourceIds.push(...ids);
      targetLorebookIds.push(target.lorebookId);
      input.sourceIds = ids.sort();
      input.target = target;
    } else if (operation === LoreMutationOperation.SPLIT) {
      const state = this._assertCurrentSource(requiredString(request.sourceId, 'LORE_MUTATION_SOURCE_REQUIRED', 'sourceId'));
      const outputs = Array.isArray(request.outputs) ? request.outputs.map((row) => normalizeTarget(row)) : [];
      if (outputs.length < 2) {
        throw Object.assign(new TypeError('SPLIT requires at least two exact outputs'), {code: 'LORE_MUTATION_SPLIT_OUTPUTS_REQUIRED'});
      }
      if (new Set(outputs.map((row) => row.sourceId)).size !== outputs.length) {
        throw Object.assign(new Error('SPLIT output UIDs must be unique'), {code: 'LORE_MUTATION_SPLIT_DUPLICATE_TARGET'});
      }
      for (const target of outputs) {
        this._assertTargetAbsent(target.sourceId);
        writes.push({kind: 'UPSERT', ...target, expectedSourceRevisionId: null});
        targetLorebookIds.push(target.lorebookId);
      }
      sourceIds.push(state.sourceId);
      input.sourceId = state.sourceId;
      input.outputs = outputs;
    }

    this._assertScope(scope, sourceIds, targetLorebookIds);

    const sourceRevisionFence = sourceIds
      .map((sourceId) => {
        const state = this._assertCurrentSource(sourceId);
        return {
          sourceId,
          lorebookId: state.lorebookId,
          uid: state.uid,
          sourceRevisionId: state.revision.id,
          contentHash: state.revision.contentHash,
        };
      })
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    const targetExpectations = writes
      .filter((row) => row.kind === 'UPSERT')
      .map((row) => ({
        sourceId: row.sourceId,
        expectedSourceRevisionId: row.expectedSourceRevisionId,
      }))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId));

    return {
      operation,
      scope,
      input,
      writes,
      sourceIds: sourceRevisionFence.map((row) => row.sourceId),
      targetLorebookIds: unique(targetLorebookIds),
      sourceRevisionFence,
      targetExpectations,
    };
  }

  _operationFingerprint(normalized) {
    return stableHash(stableStringify({
      operation: normalized.operation,
      scope: normalized.scope,
      input: normalized.input,
      sourceRevisionFence: normalized.sourceRevisionFence,
      targetExpectations: normalized.targetExpectations,
    }));
  }

  _simulate(normalized) {
    const preview = LoreIntelligenceService.fromSnapshot(this.intelligence.snapshot());
    const changed = [];
    for (const write of normalized.writes) {
      if (write.kind === 'UPSERT') {
        if (!(preview.runtime.registry.snapshot().books || []).some((row) => row.id === write.lorebookId)) {
          preview.runtime.registerLorebook({id: write.lorebookId, title: write.lorebookId});
        }
        const before = preview.runtime.registry.currentRevision(write.sourceId, {allowMissing: true});
        const result = preview.runtime.upsertEntry({
          lorebookId: write.lorebookId,
          uid: write.uid,
          content: write.content,
          metadata: write.metadata,
        });
        changed.push({sourceId: result.source.sourceId, fromRevisionId: before?.id || null, toRevisionId: result.revision.id});
      } else {
        const before = preview.runtime.registry.currentRevision(write.sourceId);
        const result = preview.runtime.removeEntry({
          lorebookId: write.lorebookId,
          uid: write.uid,
          reason: 'reviewed-mutation-preview',
        });
        changed.push({sourceId: result.source.sourceId, fromRevisionId: before.id, toRevisionId: result.revision.id});
      }
    }
    preview.runStudy({scope: 'DUE'});
    const planner = new LoreSemanticImpactPlanner({intelligence: preview});
    return changed.map((row) => planner.plan(row));
  }

  _preview(normalized) {
    const registry = this.intelligence.runtime.registry;
    const beforeIds = unique([
      ...normalized.sourceIds,
      ...normalized.writes.map((row) => row.sourceId),
    ]);
    const before = beforeIds.map((sourceId) => {
      const state = sourceState(registry, sourceId);
      return state ? makePreviewRow({
        sourceId,
        lorebookId: state.lorebookId,
        uid: state.uid,
        revision: state.revision,
        content: state.exactContent,
        metadata: state.metadata,
        removed: state.revision.state === 'REMOVED',
      }) : {
        sourceId,
        sourceRevisionId: null,
        state: 'ABSENT',
        contentIncluded: false,
        content: null,
        contentTruncated: false,
        contentLength: 0,
        metadata: null,
        treePath: [],
      };
    });
    const after = normalized.writes.map((write) => makePreviewRow({
      sourceId: write.sourceId,
      lorebookId: write.lorebookId,
      uid: write.uid,
      revision: null,
      content: write.kind === 'UPSERT' ? write.content : null,
      metadata: write.kind === 'UPSERT' ? write.metadata : (sourceState(registry, write.sourceId)?.metadata || {}),
      removed: write.kind === 'REMOVE',
    }));
    return {before, after, rawSourceBounded: true, maxPreviewCharacters: MAX_PREVIEW_TEXT};
  }

  _reconstruction(normalized) {
    const registry = this.intelligence.runtime.registry;
    const ids = unique([
      ...normalized.sourceIds,
      ...normalized.writes.map((row) => row.sourceId),
    ]);
    return {
      kind: 'LoreMutationReconstructionReceipt',
      sources: ids.map((sourceId) => {
        const state = sourceState(registry, sourceId);
        return state ? {
          sourceId,
          existed: true,
          lorebookId: state.lorebookId,
          uid: state.uid,
          sourceRevisionId: state.revision.id,
          state: state.revision.state,
          exactContent: state.exactContent,
          metadata: deepClone(state.metadata),
        } : {
          sourceId,
          existed: false,
          lorebookId: normalized.writes.find((row) => row.sourceId === sourceId)?.lorebookId || null,
          uid: normalized.writes.find((row) => row.sourceId === sourceId)?.uid || null,
          sourceRevisionId: null,
          state: 'ABSENT',
          exactContent: null,
          metadata: null,
        };
      }),
      appendOnlyRestoration: true,
    };
  }

  _ensureAudit(proposal) {
    let audit = this.audits.get(proposal.proposalId);
    if (!audit) {
      audit = {
        kind: 'LoreMutationAudit',
        contractVersion: 1,
        proposalId: proposal.proposalId,
        operationFingerprint: proposal.operationFingerprint,
        events: [],
        reconstruction: deepClone(proposal.reconstruction),
      };
      this.audits.set(proposal.proposalId, audit);
    }
    return audit;
  }

  _audit(proposal, event) {
    const audit = this._ensureAudit(proposal);
    audit.events.push(deepClone(event));
    if (audit.events.length > 128) audit.events.splice(0, audit.events.length - 128);
  }

  _public(proposal, extras = {}) {
    return {
      kind: 'LoreMutationProposal',
      contractVersion: 1,
      proposalId: proposal.proposalId,
      operationFingerprint: proposal.operationFingerprint,
      operation: proposal.operation,
      state: proposal.state,
      scope: deepClone(proposal.scope),
      sourceRevisionFence: deepClone(proposal.sourceRevisionFence),
      targetExpectations: deepClone(proposal.targetExpectations),
      evidence: deepClone(proposal.evidence),
      preview: deepClone(proposal.preview),
      semanticImpact: deepClone(proposal.semanticImpact),
      impactSummary: deepClone(proposal.impactSummary),
      affectedTreePaths: deepClone(proposal.affectedTreePaths),
      origin: deepClone(proposal.origin),
      approval: deepClone(proposal.approval || null),
      rejection: deepClone(proposal.rejection || null),
      commit: deepClone(proposal.commit || null),
      restoration: deepClone(proposal.restoration || null),
      recovery: deepClone(proposal.recovery || null),
      revisionEvents: deepClone(proposal.commit?.revisionEvents || []),
      invalidationReceipts: deepClone(proposal.commit?.invalidationReceipts || []),
      studyObligationIds: [...(proposal.commit?.studyObligationIds || [])],
      auditId: proposal.auditId,
      lastError: deepClone(proposal.lastError || null),
      reconstructionAvailable: true,
      authority: {
        sourceMutationAuthority: proposal.state === LoreMutationState.COMMITTED,
        modelMutationAuthority: false,
        jevMutationAuthority: false,
        inferredMutationAuthority: false,
        explicitOperatorApprovalRequired: true,
      },
      ...extras,
    };
  }

  createProposal(request = {}) {
    const normalized = this._normalizeIntent(request);
    const operationFingerprint = this._operationFingerprint(normalized);
    const existingId = this.fingerprintIndex.get(operationFingerprint);
    if (existingId && this.proposals.has(existingId)) return this._public(this.proposals.get(existingId), {duplicate: true});

    const semanticImpact = this._simulate(normalized);
    const evidence = currentLearnedEvidence(this.intelligence, normalized.sourceIds);
    evidence.sourceRevisionRefs = normalized.sourceRevisionFence.map((row) => row.sourceRevisionId);
    evidence.explicitEvidenceRefs = unique(request.evidenceRefs).slice(0, MAX_EVIDENCE_REFS);
    const preview = this._preview(normalized);
    const proposalId = 'lore-mutation-proposal:' + operationFingerprint;
    const proposal = {
      kind: 'LoreMutationProposalInternal',
      contractVersion: 1,
      proposalId,
      operationFingerprint,
      operation: normalized.operation,
      state: LoreMutationState.PROPOSED,
      scope: deepClone(normalized.scope),
      intent: deepClone(normalized.input),
      writes: deepClone(normalized.writes),
      sourceIds: [...normalized.sourceIds],
      targetLorebookIds: [...normalized.targetLorebookIds],
      sourceRevisionFence: deepClone(normalized.sourceRevisionFence),
      targetExpectations: deepClone(normalized.targetExpectations),
      evidence,
      preview,
      semanticImpact: deepClone(semanticImpact),
      impactSummary: {
        sourcePlans: semanticImpact.length,
        semanticChangeRows: semanticImpact.reduce((sum, row) => sum + Number(row.counts?.totalChangeRows || 0), 0),
        directDependents: semanticImpact.reduce((sum, row) => sum + (row.impact?.direct?.length || 0), 0),
        transitiveDependents: semanticImpact.reduce((sum, row) => sum + (row.impact?.transitive?.length || 0), 0),
        requiredActions: semanticImpact.reduce((sum, row) => sum + (row.impact?.required?.length || 0), 0),
        unrelatedSourcesInvalidated: false,
      },
      affectedTreePaths: unique([
        ...preview.before.flatMap((row) => (row.treePath || []).length ? [stableStringify(row.treePath)] : []),
        ...preview.after.flatMap((row) => (row.treePath || []).length ? [stableStringify(row.treePath)] : []),
      ]).map((row) => JSON.parse(row)),
      reconstruction: this._reconstruction(normalized),
      origin: deepClone(request.origin || {kind: 'OPERATOR'}),
      approval: null,
      rejection: null,
      commit: null,
      restoration: null,
      recovery: null,
      lastError: null,
      createdSequence: ++this.sequence,
      auditId: 'lore-mutation-audit:' + operationFingerprint,
    };
    proposal.state = LoreMutationState.REVIEW_READY;
    this.proposals.set(proposalId, proposal);
    this.fingerprintIndex.set(operationFingerprint, proposalId);
    this._audit(proposal, {
      kind: 'LoreMutationProposedAudit',
      proposalId,
      operation: proposal.operation,
      sourceRevisionFence: deepClone(proposal.sourceRevisionFence),
      sequence: this.sequence,
    });
    return this._public(proposal);
  }

  _proposal(proposalId) {
    const id = requiredString(proposalId, 'LORE_MUTATION_PROPOSAL_REQUIRED', 'proposalId');
    const proposal = this.proposals.get(id);
    if (!proposal) throw Object.assign(new Error('Unknown Lore mutation proposal: ' + id), {code: 'LORE_MUTATION_PROPOSAL_UNKNOWN'});
    return proposal;
  }

  _assertRequestScope(proposal, request = {}) {
    if (proposal.scope.scopeMode === LoreMutationScopeMode.GLOBAL_OPERATOR) {
      if (request.scopeMode !== LoreMutationScopeMode.GLOBAL_OPERATOR) {
        throw Object.assign(new Error('GLOBAL_OPERATOR scope must be explicit for this proposal'), {code: 'LORE_MUTATION_SCOPE_MISMATCH'});
      }
      return;
    }
    if (String(request.chatId || '') !== proposal.scope.chatId) {
      throw Object.assign(new Error('Exact chat scope does not match proposal'), {code: 'LORE_MUTATION_SCOPE_MISMATCH'});
    }
  }

  _validateCurrent(proposal) {
    const normalized = {
      operation: proposal.operation,
      scope: proposal.scope,
      input: proposal.intent,
      sourceRevisionFence: proposal.sourceRevisionFence,
      targetExpectations: proposal.targetExpectations,
    };
    const expectedFingerprint = stableHash(stableStringify(normalized));
    if (expectedFingerprint !== proposal.operationFingerprint) {
      return {ok: false, code: 'LORE_MUTATION_FINGERPRINT_CHANGED', message: 'Stored mutation fingerprint no longer matches proposal intent'};
    }
    const registry = this.intelligence.runtime.registry;
    for (const fence of proposal.sourceRevisionFence) {
      const current = registry.currentRevision(fence.sourceId, {allowMissing: true});
      if (!current || current.id !== fence.sourceRevisionId) {
        return {ok: false, code: 'LORE_MUTATION_SOURCE_STALE', message: 'Source revision fence changed', sourceId: fence.sourceId};
      }
    }
    for (const expectation of proposal.targetExpectations) {
      const entry = registry.getEntry(expectation.sourceId);
      const current = entry ? registry.currentRevision(expectation.sourceId, {allowMissing: true}) : null;
      if (expectation.expectedSourceRevisionId == null) {
        if (entry) return {ok: false, code: 'LORE_MUTATION_TARGET_COLLISION', message: 'Target UID is no longer absent', sourceId: expectation.sourceId};
      } else if (!current || current.id !== expectation.expectedSourceRevisionId) {
        return {ok: false, code: 'LORE_MUTATION_TARGET_STALE', message: 'Target revision changed', sourceId: expectation.sourceId};
      }
    }
    try {
      this._assertScope(proposal.scope, proposal.sourceIds, proposal.targetLorebookIds);
    } catch (error) {
      return {ok: false, code: error.code || 'LORE_MUTATION_SCOPE_UNAUTHORIZED', message: error.message};
    }
    return {ok: true};
  }

  _markStale(proposal, failure) {
    proposal.state = LoreMutationState.STALE;
    proposal.lastError = {
      kind: 'LoreMutationError',
      code: failure.code,
      message: failure.message,
      details: deepClone(failure),
      safe: true,
    };
    this._audit(proposal, {
      kind: 'LoreMutationStaleAudit',
      proposalId: proposal.proposalId,
      failure: deepClone(proposal.lastError),
      sequence: ++this.sequence,
    });
    return this._public(proposal);
  }

  approve({proposalId, operatorDecisionId, ...scopeRequest} = {}) {
    const proposal = this._proposal(proposalId);
    this._assertRequestScope(proposal, scopeRequest);
    const decisionId = requiredString(operatorDecisionId, 'LORE_MUTATION_DECISION_REQUIRED', 'operatorDecisionId');
    if (proposal.state === LoreMutationState.APPROVED && proposal.approval?.operatorDecisionId === decisionId) return this._public(proposal);
    if (proposal.state !== LoreMutationState.REVIEW_READY) {
      throw Object.assign(new Error('Proposal is not review-ready'), {code: 'LORE_MUTATION_NOT_REVIEW_READY'});
    }
    const claimed = this.decisionIds.get(decisionId);
    if (claimed && claimed !== proposal.proposalId) {
      throw Object.assign(new Error('Operator decision ID is already bound to another proposal'), {code: 'LORE_MUTATION_DECISION_REPLAY'});
    }
    const validation = this._validateCurrent(proposal);
    if (!validation.ok) return this._markStale(proposal, validation);
    this.decisionIds.set(decisionId, proposal.proposalId);
    proposal.approval = {
      kind: 'LoreMutationApproval',
      operatorDecisionId: decisionId,
      proposalId: proposal.proposalId,
      operationFingerprint: proposal.operationFingerprint,
      sequence: ++this.sequence,
      explicitOperatorApproval: true,
    };
    proposal.state = LoreMutationState.APPROVED;
    this._audit(proposal, {
      kind: 'LoreMutationApprovedAudit',
      proposalId: proposal.proposalId,
      operatorDecisionId: decisionId,
      sequence: this.sequence,
    });
    return this._public(proposal);
  }

  reject({proposalId, operatorDecisionId, note = null, ...scopeRequest} = {}) {
    const proposal = this._proposal(proposalId);
    this._assertRequestScope(proposal, scopeRequest);
    const decisionId = requiredString(operatorDecisionId, 'LORE_MUTATION_DECISION_REQUIRED', 'operatorDecisionId');
    if (proposal.state !== LoreMutationState.REVIEW_READY) {
      throw Object.assign(new Error('Proposal is not review-ready'), {code: 'LORE_MUTATION_NOT_REVIEW_READY'});
    }
    const claimed = this.decisionIds.get(decisionId);
    if (claimed && claimed !== proposal.proposalId) {
      throw Object.assign(new Error('Operator decision ID is already bound to another proposal'), {code: 'LORE_MUTATION_DECISION_REPLAY'});
    }
    this.decisionIds.set(decisionId, proposal.proposalId);
    proposal.rejection = {
      kind: 'LoreMutationRejection',
      operatorDecisionId: decisionId,
      note: note == null ? null : String(note),
      sequence: ++this.sequence,
    };
    proposal.state = LoreMutationState.REJECTED;
    this._audit(proposal, {
      kind: 'LoreMutationRejectedAudit',
      proposalId: proposal.proposalId,
      operatorDecisionId: decisionId,
      sequence: this.sequence,
    });
    return this._public(proposal);
  }

  _refreshDerivedFreshness() {
    this.intelligence.multiResolution.refreshFreshness();
    this.intelligence.ontology.rebuild();
    this.intelligence.hierarchy.refreshHierarchy();
    this.intelligence.hierarchy.refreshRetrieval();
  }

  _recordStoryRevision(result, previousRevisionId, origin) {
    this.intelligence.storyAuthority.recordRevisionChange({
      sourceId: result.source.sourceId,
      lorebookId: result.source.lorebookId,
      previousSourceRevisionId: previousRevisionId,
      sourceRevisionId: result.revision.id,
      sourceState: result.revision.state,
      origin,
    });
  }

  _executeWrites(proposal, writes, {restoration = false} = {}) {
    const registry = this.intelligence.runtime.registry;
    const revisionEvents = [];
    const studyObligationIds = [];
    for (const write of writes) {
      const before = registry.currentRevision(write.sourceId, {allowMissing: true});
      let result;
      try {
        if (write.kind === 'UPSERT') {
          if (!(registry.snapshot().books || []).some((row) => row.id === write.lorebookId)) {
            this.intelligence.runtime.registerLorebook({id: write.lorebookId, title: write.lorebookId});
          }
          result = this.intelligence.runtime.upsertEntry({
            lorebookId: write.lorebookId,
            uid: write.uid,
            content: write.content,
            metadata: write.metadata,
          });
        } else {
          result = this.intelligence.runtime.removeEntry({
            lorebookId: write.lorebookId,
            uid: write.uid,
            reason: restoration
              ? 'reviewed-mutation-restoration:' + proposal.proposalId
              : 'reviewed-mutation-commit:' + proposal.proposalId,
          });
        }
      } catch (error) {
        error.partialRevisionEvents = deepClone(revisionEvents);
        error.partialStudyObligationIds = unique(studyObligationIds);
        throw error;
      }
      if (!result.changed) continue;
      this._recordStoryRevision(
        result,
        before?.id || null,
        restoration ? 'REVIEWED_MUTATION_RESTORATION' : 'REVIEWED_MUTATION_COMMIT',
      );
      revisionEvents.push({
        kind: 'LoreSourceRevisionChanged',
        proposalId: proposal.proposalId,
        operationKind: proposal.operation,
        restoration,
        sourceId: result.source.sourceId,
        lorebookId: result.source.lorebookId,
        uid: result.source.uid,
        previousSourceRevisionId: before?.id || null,
        sourceRevisionId: result.revision.id,
        sourceState: result.revision.state,
        contentHash: result.revision.contentHash,
        exactFingerprint: result.revision.exactFingerprint,
        studyObligationId: result.obligation?.id || null,
        studyTrigger: result.obligation?.trigger || null,
      });
      if (result.obligation?.id) studyObligationIds.push(result.obligation.id);
    }
    this._refreshDerivedFreshness();
    return {revisionEvents, studyObligationIds: unique(studyObligationIds)};
  }

  _compensationWrites(proposal, partialRevisionEvents = []) {
    const beforeBySource = new Map((proposal.reconstruction?.sources || []).map((row) => [row.sourceId, row]));
    const changedIds = unique((partialRevisionEvents || []).map((row) => row.sourceId)).reverse();
    return changedIds.map((sourceId) => {
      const before = beforeBySource.get(sourceId);
      const current = this.intelligence.runtime.registry.currentRevision(sourceId, {allowMissing: true});
      if (!current) return null;
      if (!before || !before.existed) {
        const source = this.intelligence.runtime.registry.getEntry(sourceId);
        if (!source || current.state === 'REMOVED') return null;
        return {
          kind: 'REMOVE',
          sourceId,
          lorebookId: source.lorebookId,
          uid: source.uid,
          expectedSourceRevisionId: current.id,
        };
      }
      return {
        kind: 'UPSERT',
        sourceId,
        lorebookId: before.lorebookId,
        uid: before.uid,
        content: before.exactContent,
        metadata: deepClone(before.metadata || {}),
        expectedSourceRevisionId: current.id,
      };
    }).filter(Boolean);
  }

  commit({proposalId, operatorDecisionId, ...scopeRequest} = {}) {
    const proposal = this._proposal(proposalId);
    this._assertRequestScope(proposal, scopeRequest);
    if (proposal.state === LoreMutationState.COMMITTED) {
      if (String(operatorDecisionId || '') !== proposal.approval?.operatorDecisionId) {
        throw Object.assign(new Error('Commit approval identity does not match proposal approval'), {code: 'LORE_MUTATION_APPROVAL_MISMATCH'});
      }
      return this._public(proposal, {replayed: true});
    }
    if (proposal.state !== LoreMutationState.APPROVED || !proposal.approval) {
      throw Object.assign(new Error('Explicit approved mutation proposal is required before commit'), {code: 'LORE_MUTATION_APPROVAL_REQUIRED'});
    }
    if (String(operatorDecisionId || '') !== proposal.approval.operatorDecisionId) {
      throw Object.assign(new Error('Commit approval identity does not match proposal approval'), {code: 'LORE_MUTATION_APPROVAL_MISMATCH'});
    }
    const validation = this._validateCurrent(proposal);
    if (!validation.ok) return this._markStale(proposal, validation);

    let executed;
    try {
      executed = this._executeWrites(proposal, proposal.writes);
    } catch (error) {
      const partialRevisionEvents = deepClone(error?.partialRevisionEvents || []);
      let recovery = {
        kind: 'LoreMutationRecoveryReceipt',
        status: partialRevisionEvents.length ? 'REQUIRED' : 'NOT_REQUIRED',
        partialRevisionEvents,
        compensationRevisionEvents: [],
        studyObligationIds: [],
        error: null,
      };
      if (partialRevisionEvents.length) {
        try {
          const writes = this._compensationWrites(proposal, partialRevisionEvents);
          const compensated = this._executeWrites(proposal, writes, {restoration: true});
          recovery = {
            ...recovery,
            status: 'COMPENSATED',
            compensationRevisionEvents: deepClone(compensated.revisionEvents),
            studyObligationIds: [...compensated.studyObligationIds],
          };
        } catch (recoveryError) {
          recovery = {
            ...recovery,
            status: 'RECOVERY_FAILED',
            error: {
              code: String(recoveryError?.code || 'LORE_MUTATION_RECOVERY_FAILED'),
              message: String(recoveryError?.message || recoveryError),
              safe: true,
            },
          };
          try {
            this._refreshDerivedFreshness();
          } catch {}
        }
      }
      proposal.state = LoreMutationState.FAILED;
      proposal.recovery = recovery;
      proposal.lastError = {
        kind: 'LoreMutationError',
        code: String(error?.code || 'LORE_MUTATION_COMMIT_FAILED'),
        message: String(error?.message || error),
        safe: true,
      };
      this._audit(proposal, {
        kind: 'LoreMutationFailedAudit',
        proposalId: proposal.proposalId,
        error: deepClone(proposal.lastError),
        recovery: deepClone(recovery),
        partialRevisionEvents,
        compensationRevisionEvents: deepClone(recovery.compensationRevisionEvents),
        sequence: ++this.sequence,
      });
      return this._public(proposal);
    }

    const impactBySource = new Map(proposal.semanticImpact.map((row) => [row.source?.sourceId, row]));
    const invalidationReceipts = executed.revisionEvents.map((event) => {
      const impact = impactBySource.get(event.sourceId);
      return {
        kind: 'LoreInvalidationReceipt',
        proposalId: proposal.proposalId,
        sourceId: event.sourceId,
        fromRevisionId: event.previousSourceRevisionId,
        toRevisionId: event.sourceRevisionId,
        targets: deepClone(impact?.impact?.required || []),
        unrelatedSourcesInvalidated: false,
        authoritativePreflight: true,
      };
    });
    proposal.commit = {
      kind: 'LoreMutationCommitReceipt',
      proposalId: proposal.proposalId,
      operationFingerprint: proposal.operationFingerprint,
      operatorDecisionId: proposal.approval.operatorDecisionId,
      revisionEvents: executed.revisionEvents,
      invalidationReceipts,
      studyObligationIds: executed.studyObligationIds,
      committedSequence: ++this.sequence,
      originalSourcesDeletedImplicitly: false,
      newSourceRevisionsPublished: true,
      studyQueuedAfterCommit: true,
    };
    proposal.state = LoreMutationState.COMMITTED;
    proposal.lastError = null;
    this._audit(proposal, {
      kind: 'LoreMutationCommittedAudit',
      proposalId: proposal.proposalId,
      revisionEvents: deepClone(executed.revisionEvents),
      invalidationReceipts: deepClone(invalidationReceipts),
      sequence: this.sequence,
    });
    return this._public(proposal);
  }

  _restorationWrites(proposal) {
    const beforeBySource = new Map((proposal.reconstruction?.sources || []).map((row) => [row.sourceId, row]));
    const changedIds = unique((proposal.commit?.revisionEvents || []).map((row) => row.sourceId)).reverse();
    return changedIds.map((sourceId) => {
      const before = beforeBySource.get(sourceId);
      const current = this.intelligence.runtime.registry.currentRevision(sourceId, {allowMissing: true});
      if (!before || !before.existed) {
        const source = this.intelligence.runtime.registry.getEntry(sourceId);
        if (!source || !current || current.state === 'REMOVED') return null;
        return {
          kind: 'REMOVE',
          sourceId,
          lorebookId: source.lorebookId,
          uid: source.uid,
          expectedSourceRevisionId: current.id,
        };
      }
      return {
        kind: 'UPSERT',
        sourceId,
        lorebookId: before.lorebookId,
        uid: before.uid,
        content: before.exactContent,
        metadata: deepClone(before.metadata || {}),
        expectedSourceRevisionId: current?.id || null,
      };
    }).filter(Boolean);
  }

  restore({proposalId, restorationId = null, operatorDecisionId, ...scopeRequest} = {}) {
    const proposal = this._proposal(proposalId);
    this._assertRequestScope(proposal, scopeRequest);
    const decisionId = requiredString(operatorDecisionId, 'LORE_MUTATION_RESTORE_DECISION_REQUIRED', 'operatorDecisionId');
    if (proposal.state === LoreMutationState.RESTORED) {
      if (decisionId !== proposal.restoration?.operatorDecisionId) {
        throw Object.assign(new Error('Restoration approval identity does not match completed restoration'), {code: 'LORE_MUTATION_RESTORE_APPROVAL_MISMATCH'});
      }
      return this._public(proposal, {replayed: true});
    }
    if (proposal.state !== LoreMutationState.COMMITTED || !proposal.commit) {
      throw Object.assign(new Error('Committed mutation proposal is required for restoration'), {code: 'LORE_MUTATION_NOT_RESTORABLE'});
    }
    if (this.decisionIds.has(decisionId)) {
      throw Object.assign(new Error('Restoration requires a fresh operator decision ID'), {code: 'LORE_MUTATION_RESTORE_DECISION_REPLAY'});
    }
    for (const event of proposal.commit.revisionEvents) {
      const current = this.intelligence.runtime.registry.currentRevision(event.sourceId, {allowMissing: true});
      if (!current || current.id !== event.sourceRevisionId) {
        throw Object.assign(new Error('Mutation output changed after commit: ' + event.sourceId), {code: 'LORE_MUTATION_RESTORE_STALE'});
      }
    }
    const writes = this._restorationWrites(proposal);
    const executed = this._executeWrites(proposal, writes, {restoration: true});
    this.decisionIds.set(decisionId, proposal.proposalId);
    proposal.restoration = {
      kind: 'LoreMutationRestorationReceipt',
      restorationId: restorationId == null
        ? 'lore-mutation-restoration:' + stableHash({proposalId: proposal.proposalId, sequence: ++this.sequence})
        : String(restorationId),
      operatorDecisionId: decisionId,
      revisionEvents: executed.revisionEvents,
      studyObligationIds: executed.studyObligationIds,
      appendOnlyCompensatingRevisions: true,
      explicitOperatorApproval: true,
      restoredSequence: ++this.sequence,
    };
    proposal.state = LoreMutationState.RESTORED;
    this._audit(proposal, {
      kind: 'LoreMutationRestoredAudit',
      proposalId: proposal.proposalId,
      operatorDecisionId: decisionId,
      restoration: deepClone(proposal.restoration),
      sequence: this.sequence,
    });
    return this._public(proposal);
  }

  read(proposalId) {
    return this._public(this._proposal(proposalId));
  }

  list({chatId = null, status = null, limit = 64} = {}) {
    const size = Math.max(1, Math.min(MAX_QUEUE, Math.trunc(Number(limit) || 64)));
    return [...this.proposals.values()]
      .filter((row) => chatId == null || row.scope.chatId === String(chatId))
      .filter((row) => status == null || row.state === String(status))
      .sort((a, b) => b.createdSequence - a.createdSequence)
      .slice(0, size)
      .map((row) => this._public(row));
  }

  audit({proposalId} = {}) {
    const proposal = this._proposal(proposalId);
    return deepClone(this._ensureAudit(proposal));
  }

  snapshot() {
    return {
      kind: 'LoreReviewedMutationServiceSnapshot',
      contractVersion: 1,
      sequence: this.sequence,
      proposals: [...this.proposals.values()].map(deepClone),
      fingerprintIndex: [...this.fingerprintIndex.entries()],
      audits: [...this.audits.entries()].map(([id, row]) => [id, deepClone(row)]),
      decisionIds: [...this.decisionIds.entries()],
    };
  }

  _restoreSnapshot(snapshot) {
    this.sequence = Number(snapshot?.sequence || 0);
    this.proposals = new Map((snapshot?.proposals || []).map((row) => [row.proposalId, deepClone(row)]));
    this.fingerprintIndex = new Map(snapshot?.fingerprintIndex || []);
    this.audits = new Map((snapshot?.audits || []).map(([id, row]) => [id, deepClone(row)]));
    this.decisionIds = new Map(snapshot?.decisionIds || []);
  }

  static fromSnapshot(snapshot, {intelligence} = {}) {
    if (!snapshot || snapshot.kind !== 'LoreReviewedMutationServiceSnapshot') {
      throw new TypeError('Lore reviewed mutation snapshot is required');
    }
    return new LoreReviewedMutationService({intelligence, snapshot});
  }
}
