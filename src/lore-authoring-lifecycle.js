import {deepClone, slug, stableHash, stableStringify} from './lore-contracts.js';
import {
  LoreAuthoringStage,
  LoreOperatorDecision,
  LoreReviewState,
  LoreSettlementState,
  LoreTreeAction,
  LoreSourceAction,
  normalizeLoreAuthoringError,
  sourceRevisionIdentity,
} from './lore-authoring-contracts.js';

const MAX_BUILD_BATCH = 128;
const MAX_SETTLEMENT_BATCH = 128;

function unique(values) {
  return [...new Set((values || []).filter((value) => value !== null && value !== undefined).map(String))].sort();
}

function pathArray(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function isPrefix(path, prefix) {
  const left = pathArray(path);
  const right = pathArray(prefix);
  return right.length <= left.length && right.every((part, index) => left[index] === part);
}

function replacePrefix(path, fromPrefix, toPrefix) {
  const current = pathArray(path);
  const from = pathArray(fromPrefix);
  if (!isPrefix(current, from)) return current;
  return [...pathArray(toPrefix), ...current.slice(from.length)];
}

function metadataChanged(a, b) {
  return stableStringify(a || {}) !== stableStringify(b || {});
}

function exactRevisionMatches(revision, content, metadata) {
  return Boolean(revision
    && revision.state !== 'REMOVED'
    && revision.exactContent === content
    && stableStringify(revision.metadata || {}) === stableStringify(metadata || {}));
}

function decisionCounts(actions) {
  const counts = {
    PENDING: 0,
    ACCEPT: 0,
    CHANGE: 0,
    DEFER: 0,
    REJECT: 0,
  };
  for (const action of actions || []) {
    const key = action.decision || 'PENDING';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function assertOperatorDecisionId(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw Object.assign(new TypeError('Explicit operatorDecisionId is required'), {code: 'LORE_AUTHORING_OPERATOR_DECISION_REQUIRED'});
  }
  return String(value);
}

function actionTreeNodes(proposal) {
  return [
    proposal.fromPath,
    proposal.toPath,
    proposal.proposedPath,
    proposal.path,
    proposal.parentPath,
    ...(proposal.nodePaths || []),
  ]
    .filter(Array.isArray)
    .map((path) => pathArray(path));
}

function proposalSourceIds(proposal, registry) {
  const explicit = unique([
    proposal.sourceId,
    ...(proposal.sourceIds || []),
    ...(proposal.childSuggestions || []).map((row) => row.sourceId),
  ]);
  if (explicit.length) return explicit;
  if (!proposal.lorebookId) return [];
  const rows = registry.listEntries({includeRemoved: false})
    .filter((source) => source.lorebookId === String(proposal.lorebookId));

  if (proposal.action === LoreTreeAction.RENAME_NODE) {
    return rows.filter((source) => {
      const revision = registry.currentRevision(source.sourceId);
      return isPrefix(revision.metadata?.treePath, proposal.fromPath);
    }).map((source) => source.sourceId).sort();
  }
  if (proposal.action === LoreTreeAction.MERGE_NODE) {
    return rows.filter((source) => {
      const revision = registry.currentRevision(source.sourceId);
      return (proposal.nodePaths || []).some((path) => isPrefix(revision.metadata?.treePath, path));
    }).map((source) => source.sourceId).sort();
  }
  return [];
}

function sourceFenceFromIdentities(identities) {
  return (identities || []).map((identity) => ({
    sourceId: identity.sourceId,
    lorebookId: identity.lorebookId,
    uid: identity.uid,
    sourceRevisionId: identity.sourceRevisionId,
    contentHash: identity.contentHash,
    exactFingerprint: identity.exactFingerprint,
    treePath: pathArray(identity.metadata?.treePath),
  })).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

function currentFence(intelligence, sourceIds) {
  const registry = intelligence.runtime.registry;
  return unique(sourceIds).map((sourceId) => sourceRevisionIdentity(registry, sourceId));
}

function checkSourceFence(intelligence, fence) {
  const registry = intelligence.runtime.registry;
  const stale = [];
  for (const row of fence || []) {
    const current = registry.currentRevision(row.sourceId, {allowMissing: true});
    if (!current || current.id !== row.sourceRevisionId || current.state === 'REMOVED') {
      stale.push({
        sourceId: row.sourceId,
        expectedSourceRevisionId: row.sourceRevisionId,
        currentSourceRevisionId: current?.id || null,
        currentState: current?.state || 'MISSING',
      });
    }
  }
  return {
    ok: stale.length === 0,
    stale,
  };
}

function dependencyFenceFor(intelligence, type) {
  const ontology = intelligence.ontology.current();
  const hierarchy = intelligence.hierarchy.hierarchy;
  return {
    kind: 'LoreAuthoringDependencyFence',
    sourceRevisionFence: [...(ontology.sourceRevisionFence || [])].sort(),
    ontologyRevision: type === 'TREE' ? ontology.ontologyRevision : null,
    hierarchyRevision: type === 'TREE' ? (hierarchy?.hierarchyRevision || null) : null,
  };
}

function checkDependencyFence(intelligence, fence, type) {
  if (!fence) return {ok: true, reasons: []};
  const reasons = [];
  if (type === 'TREE') {
    const ontology = intelligence.ontology.current();
    const hierarchy = intelligence.hierarchy.hierarchy;
    if (fence.ontologyRevision !== ontology.ontologyRevision) {
      reasons.push({
        kind: 'ONTOLOGY_REVISION_CHANGED',
        expected: fence.ontologyRevision,
        current: ontology.ontologyRevision,
      });
    }
    if (fence.hierarchyRevision !== (hierarchy?.hierarchyRevision || null)) {
      reasons.push({
        kind: 'HIERARCHY_REVISION_CHANGED',
        expected: fence.hierarchyRevision,
        current: hierarchy?.hierarchyRevision || null,
      });
    }
  }
  return {ok: reasons.length === 0, reasons};
}

function decisionChange(proposed, change, type) {
  if (!change || typeof change !== 'object') {
    throw Object.assign(new TypeError('CHANGE decision requires change fields'), {code: 'LORE_AUTHORING_CHANGE_REQUIRED'});
  }
  if (type === 'SOURCE') {
    const next = deepClone(proposed);
    const action = String(next.action || '').toUpperCase();
    const allowed = action === LoreSourceAction.DELETE_ENTRY ? ['reason'] : ['content', 'metadata', 'reason'];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(change, key)) next[key] = deepClone(change[key]);
    }
    for (const protectedKey of ['action', 'sourceId', 'lorebookId', 'uid', 'expectedSourceRevisionId', 'evidenceSourceIds']) {
      if (Object.prototype.hasOwnProperty.call(change, protectedKey)) {
        throw Object.assign(new Error('Source review cannot change fenced identity or operation authority'), {
          code: 'LORE_SOURCE_CHANGE_FENCE_PROTECTED',
        });
      }
    }
    if ([LoreSourceAction.CREATE_ENTRY, LoreSourceAction.UPDATE_ENTRY].includes(action) && typeof next.content !== 'string') {
      throw Object.assign(new TypeError('Source create/update requires string content'), {code: 'LORE_SOURCE_CONTENT_REQUIRED'});
    }
    return next;
  }

  if (type === 'MERGE') {
    const next = deepClone(proposed);
    for (const key of ['uid', 'title', 'metadata']) {
      if (Object.prototype.hasOwnProperty.call(change, key)) next[key] = deepClone(change[key]);
    }
    if (Object.prototype.hasOwnProperty.call(change, 'exactContent')
      || Object.prototype.hasOwnProperty.call(change, 'sourceRefs')
      || Object.prototype.hasOwnProperty.call(change, 'sourceRevisionRefs')
      || Object.prototype.hasOwnProperty.call(change, 'semanticFactRefs')) {
      throw Object.assign(new Error('Merge review cannot rewrite source text, provenance, or semantic fact refs'), {
        code: 'LORE_MERGE_CHANGE_AUTHORITY_EXCEEDED',
      });
    }
    return next;
  }

  const next = deepClone(proposed);
  const allowed = ['toPath', 'proposedPath', 'toLabel', 'proposedLabel', 'childSuggestions', 'rationale'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(change, key)) next[key] = deepClone(change[key]);
  }
  for (const protectedKey of ['sourceId', 'sourceIds', 'sourceRevisionId', 'lorebookId', 'action', 'evidenceRefs']) {
    if (Object.prototype.hasOwnProperty.call(change, protectedKey)) {
      throw Object.assign(new Error('Tree review cannot change fenced source identity or action authority'), {
        code: 'LORE_TREE_CHANGE_FENCE_PROTECTED',
      });
    }
  }
  return next;
}

function proposalEvidenceReceipt(intelligence, identities, proposedOutput, affectedTreeNodes, extra = {}) {
  const registry = intelligence.runtime.registry;
  const store = intelligence.runtime.store;
  const sourceIds = unique((identities || []).map((row) => row.sourceId));
  const artifacts = sourceIds.flatMap((sourceId) => {
    const learned = store.currentLearnedRevision(sourceId);
    if (!learned || learned.state !== 'CURRENT') return [];
    return store.artifactsForLearnedRevision(learned.id)
      .filter((artifact) => artifact.sourceRevisionId === registry.currentRevision(sourceId, {allowMissing: true})?.id);
  });
  const artifactIds = new Set(artifacts.map((row) => row.id));
  const contradictions = store.conflicts(registry)
    .filter((conflict) => (conflict.artifactIds || []).some((id) => artifactIds.has(id)))
    .map(deepClone);
  const impact = sourceIds.map((sourceId) => store.impactPreview(sourceId));
  return {
    kind: 'LoreProposalEvidenceReceipt',
    contractVersion: 1,
    exactSourceRevisions: sourceFenceFromIdentities(identities),
    learnedEvidenceRefs: artifacts.map((row) => ({
      artifactId: row.id,
      semanticId: row.semanticId,
      artifactType: row.artifactType,
      sourceId: row.sourceId,
      sourceRevisionId: row.sourceRevisionId,
      authorityClass: row.authorityClass,
      temporalClass: row.temporalClass,
      unresolved: Boolean(row.unresolved),
    })).sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    contradictionAnalysis: {
      unresolvedConflictSets: contradictions,
      additional: deepClone(extra.contradictionAnalysis || null),
      modelMayNotResolveWithoutReview: true,
    },
    impactAnalysis: {
      affectedTreeNodes: deepClone(affectedTreeNodes || []),
      sourceImpacts: impact,
      additional: deepClone(extra.impactAnalysis || null),
      advisoryOnly: true,
    },
    before: identities.map((identity) => ({
      sourceId: identity.sourceId,
      lorebookId: identity.lorebookId,
      uid: identity.uid,
      sourceRevisionId: identity.sourceRevisionId,
      sourceState: identity.state,
      treePath: pathArray(identity.metadata?.treePath),
      contentHash: identity.contentHash,
    })),
    afterProposal: deepClone(proposedOutput),
    exactSourceTextCopiedIntoReceipt: false,
    proposalMutationAuthority: false,
    explicitApprovalRequired: true,
    settlementRequired: true,
  };
}

function stableActionId(type, sessionSeed, key) {
  return 'lore-authoring-action:' + stableHash({type, sessionSeed, key});
}

function treeActionRows(plan, intelligence, sessionSeed) {
  const registry = intelligence.runtime.registry;
  const membershipBySource = new Map();
  for (const membership of plan.semanticMemberships || []) {
    const bucket = membershipBySource.get(membership.sourceId) || [];
    bucket.push(membership);
    membershipBySource.set(membership.sourceId, bucket);
  }

  return (plan.proposals || []).map((proposal, index) => {
    const sourceIds = proposalSourceIds(proposal, registry);
    const identities = sourceIds.map((sourceId) => sourceRevisionIdentity(registry, sourceId));
    const memberships = sourceIds.flatMap((sourceId) => membershipBySource.get(sourceId) || []);
    const semanticDependencies = {
      evidenceRefs: unique([
        ...(proposal.evidenceRefs || []),
        ...memberships.map((row) => row.evidenceArtifactId),
      ]),
      conceptRefs: unique(memberships.map((row) => row.conceptRef)),
      semanticMembershipRefs: memberships.map((row) => ({
        sourceId: row.sourceId,
        sourceRevisionId: row.sourceRevisionId,
        conceptRef: row.conceptRef,
        entityId: row.entityId,
        evidenceArtifactId: row.evidenceArtifactId,
      })),
    };
    const key = proposal.id || stableHash({index, proposal});
    const affectedTreeNodes = actionTreeNodes(proposal);
    const evidenceReceipt = proposalEvidenceReceipt(
      intelligence,
      identities,
      proposal,
      affectedTreeNodes,
      {impactAnalysis: {semanticMembershipRefs: semanticDependencies.semanticMembershipRefs}},
    );
    return {
      kind: 'LoreAuthoringReviewAction',
      id: stableActionId('TREE', sessionSeed, key),
      type: 'TREE',
      sequence: index + 1,
      origin: 'SYSTEM_PROPOSAL',
      proposalId: proposal.id,
      action: proposal.action,
      inputLorebookIds: unique(identities.map((row) => row.lorebookId)),
      inputSourceIds: sourceIds,
      inputUids: unique(identities.map((row) => row.uid)),
      inputSourceRevisions: sourceFenceFromIdentities(identities),
      affectedTreeNodes,
      semanticDependencies,
      evidenceReceipt,
      originalProposal: deepClone(proposal),
      proposedOutput: deepClone(proposal),
      decision: null,
      decisionRecord: null,
      reviewState: LoreReviewState.NEEDS_REVIEW,
      materialized: false,
    };
  });
}

function mergeUidPlan(preview, registry) {
  const rows = (preview.proposedOutput || []).map((row) => deepClone(row));
  const byUid = new Map();
  for (const row of rows) {
    const base = String(row.uid || 'entry');
    const bucket = byUid.get(base) || [];
    bucket.push(row);
    byUid.set(base, bucket);
  }
  const used = new Set();
  const planned = new Map();
  for (const row of rows.sort((a, b) => a.outputId.localeCompare(b.outputId))) {
    const base = String(row.uid || 'entry');
    const collides = (byUid.get(base) || []).length > 1;
    let candidate = base;
    if (collides) {
      if ((row.sourceRefs || []).length === 1) {
        const source = registry.getEntry(row.sourceRefs[0]);
        candidate = slug(source?.lorebookId || 'source') + '--' + base;
      } else {
        candidate = 'merged--' + base;
      }
    }
    if (used.has(candidate)) candidate += '--' + stableHash(row.outputId).slice(0, 6);
    used.add(candidate);
    planned.set(row.outputId, candidate);
  }
  return planned;
}

function mergeActionRows(preview, intelligence, sessionSeed) {
  const registry = intelligence.runtime.registry;
  const uidPlan = mergeUidPlan(preview, registry);
  return (preview.proposedOutput || []).map((output, index) => {
    const identities = (output.sourceRefs || []).map((sourceId) => sourceRevisionIdentity(registry, sourceId));
    const proposed = deepClone(output);
    proposed.uid = uidPlan.get(output.outputId);
    const treeNodes = identities.map((identity) => pathArray(identity.metadata?.treePath));
    const evidenceReceipt = proposalEvidenceReceipt(
      intelligence,
      identities,
      proposed,
      treeNodes,
      {
        contradictionAnalysis: {
          previewClassifications: deepClone(preview.classifications || {}),
          sourceRefs: unique(output.sourceRefs || []),
        },
        impactAnalysis: {
          reconstructionManifestAvailable: Boolean(preview.reconstructionManifest),
          proposedOutputId: output.outputId,
        },
      },
    );
    return {
      kind: 'LoreAuthoringReviewAction',
      id: stableActionId('MERGE', sessionSeed, output.outputId),
      type: 'MERGE',
      sequence: index + 1,
      origin: 'SYSTEM_PROPOSAL',
      proposalId: output.outputId,
      action: output.strategy,
      inputLorebookIds: unique(identities.map((row) => row.lorebookId)),
      inputSourceIds: unique(output.sourceRefs || []),
      inputUids: unique(identities.map((row) => row.uid)),
      inputSourceRevisions: sourceFenceFromIdentities(identities),
      affectedTreeNodes: treeNodes,
      semanticDependencies: {
        semanticFactRefs: unique(output.semanticFactRefs || []),
        uniqueFactRefs: unique(output.uniqueFactRefs || []),
      },
      evidenceReceipt,
      originalProposal: deepClone(output),
      proposedOutput: proposed,
      decision: null,
      decisionRecord: null,
      reviewState: LoreReviewState.NEEDS_REVIEW,
      materialized: false,
    };
  });
}

function readSession(session, settlement = null) {
  return {
    kind: 'LoreAuthoringProgressReadModel',
    contractVersion: 1,
    sessionId: session.id,
    type: session.type,
    stage: session.stage,
    draftRevision: session.draftRevision,
    inputLorebookIds: [...(session.inputLorebookIds || [])],
    build: deepClone(session.build),
    decisions: decisionCounts(session.actions),
    totalActions: session.actions.length,
    materializedActions: session.actions.filter((row) => row.materialized).length,
    stale: deepClone(session.stale || null),
    lastError: deepClone(session.lastError || null),
    finalPreviewId: session.finalPreview?.finalPreviewId || null,
    finalPreviewReady: Boolean(session.finalPreview?.validation?.ok),
    approval: deepClone(session.approval || null),
    storyScope: deepClone(session.storyScope || null),
    settlement: settlement ? {
      settlementId: settlement.id,
      state: settlement.state,
      cursor: settlement.cursor,
      operationCount: settlement.operations.length,
      appliedCount: settlement.receipts.length,
      restoration: deepClone(settlement.restoration || null),
    } : null,
  };
}

function selectedActions(session) {
  return session.actions
    .filter((action) => [LoreOperatorDecision.ACCEPT, LoreOperatorDecision.CHANGE].includes(action.decision))
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}

function applyTreeProposalToMetadata(action, stateBySource) {
  const proposal = action.proposedOutput || {};
  const sourceIds = action.inputSourceIds || [];

  if (proposal.action === LoreTreeAction.MOVE_ENTRY) {
    const row = stateBySource.get(proposal.sourceId || sourceIds[0]);
    if (row) row.metadata.treePath = pathArray(proposal.toPath);
    return;
  }

  if (proposal.action === LoreTreeAction.CREATE_NODE) {
    for (const sourceId of sourceIds) {
      const row = stateBySource.get(sourceId);
      if (row) row.metadata.treePath = pathArray(proposal.proposedPath);
    }
    return;
  }

  if (proposal.action === LoreTreeAction.RENAME_NODE) {
    const from = pathArray(proposal.fromPath);
    const to = [...from.slice(0, -1), String(proposal.toLabel || from.at(-1) || '')];
    for (const sourceId of sourceIds) {
      const row = stateBySource.get(sourceId);
      if (row) row.metadata.treePath = replacePrefix(row.metadata.treePath, from, to);
    }
    return;
  }

  if (proposal.action === LoreTreeAction.MERGE_NODE) {
    const parent = pathArray(proposal.parentPath);
    const target = [...parent, String(proposal.proposedLabel || 'Merged')];
    const nodes = (proposal.nodePaths || []).map(pathArray).sort((a, b) => b.length - a.length);
    for (const sourceId of sourceIds) {
      const row = stateBySource.get(sourceId);
      if (!row) continue;
      const match = nodes.find((node) => isPrefix(row.metadata.treePath, node));
      if (match) row.metadata.treePath = replacePrefix(row.metadata.treePath, match, target);
    }
    return;
  }

  if (proposal.action === LoreTreeAction.SPLIT_NODE) {
    const base = pathArray(proposal.path);
    const suggestionBySource = new Map((proposal.childSuggestions || []).map((row) => [String(row.sourceId), row]));
    for (const sourceId of sourceIds) {
      const row = stateBySource.get(sourceId);
      const suggestion = suggestionBySource.get(sourceId);
      if (row && suggestion) row.metadata.treePath = [...base, String(suggestion.suggestedChildLabel || row.identity.uid)];
    }
  }
}

function newSourceInvalidationReceipt({sourceId, sourceRevisionId, settlementId}) {
  return {
    kind: 'LoreInvalidationReceipt',
    contractVersion: 1,
    sourceId,
    fromRevisionId: null,
    toRevisionId: sourceRevisionId,
    settlementId,
    reason: 'NEW_MERGE_OUTPUT_SOURCE',
    targets: [
      {target: 'STUDY_ARTIFACTS', reason: 'NEW_SOURCE_REQUIRES_STUDY'},
      {target: 'REPRESENTATIONS', reason: 'NEW_SOURCE_REQUIRES_REPRESENTATIONS'},
      {target: 'ONTOLOGY', reason: 'NEW_SOURCE_MAY_AFFECT_CORPUS_SEMANTICS'},
      {target: 'NAVIGATION_SUMMARIES', reason: 'NEW_SOURCE_MAY_AFFECT_NAVIGATION'},
      {target: 'RETRIEVAL_INDEX', reason: 'NEW_SOURCE_REQUIRES_RETRIEVAL'},
    ],
    unrelatedSourcesInvalidated: false,
    authoritativePreflight: true,
  };
}

function revisionEvent({result, settlementId, operationKind, restoration = false}) {
  return {
    kind: 'LoreSourceRevisionChanged',
    contractVersion: 1,
    settlementId,
    operationKind,
    restoration,
    sourceId: result.source.sourceId,
    lorebookId: result.source.lorebookId,
    uid: result.source.uid,
    previousSourceRevisionId: result.previousRevision?.id || null,
    sourceRevisionId: result.revision.id,
    sourceState: result.revision.state,
    contentHash: result.revision.contentHash,
    exactFingerprint: result.revision.exactFingerprint,
    studyObligationId: result.obligation?.id || null,
    studyTrigger: result.obligation?.trigger || null,
  };
}

function treeInvalidationReceipt(preflight, actualRevisionId, settlementId, restoration = false) {
  const plan = deepClone(preflight.semanticChange.invalidationPlan);
  return {
    kind: 'LoreInvalidationReceipt',
    contractVersion: 1,
    settlementId,
    restoration,
    sourceId: preflight.sourceId,
    fromRevisionId: preflight.baseSourceRevisionId,
    toRevisionId: actualRevisionId,
    predictedToRevisionId: preflight.proposedSourceRevisionId,
    targets: plan.targets,
    representations: plan.representations,
    summaries: plan.summaries,
    retrievalRecords: plan.retrievalRecords,
    retrievalForms: plan.retrievalForms,
    unrelatedSourcesInvalidated: false,
    authoritativePreflight: true,
  };
}

export class LoreAuthoringLifecycle {
  constructor({intelligence, semantic, structure, merge, snapshot = null} = {}) {
    if (!intelligence || !semantic || !structure || !merge) {
      throw new TypeError('LoreAuthoringLifecycle requires intelligence and Wave 6 authoring components');
    }
    this.intelligence = intelligence;
    this.semantic = semantic;
    this.structure = structure;
    this.merge = merge;
    this.sessions = new Map();
    this.settlements = new Map();
    this.sequence = 0;
    this.decisionSequence = 0;
    if (snapshot) this.restore(snapshot);
  }

  _nextSessionId(type, seed) {
    this.sequence += 1;
    return 'lore-authoring-session:' + stableHash({type, seed, sequence: this.sequence});
  }

  _session(sessionId) {
    const session = this.sessions.get(String(sessionId));
    if (!session) throw Object.assign(new Error('Unknown Lore authoring session: ' + sessionId), {code: 'LORE_AUTHORING_SESSION_UNKNOWN'});
    return session;
  }

  _settlementForSession(sessionId) {
    return [...this.settlements.values()].find((row) => row.sessionId === String(sessionId)) || null;
  }

  startTreeBuild({lorebookIds = null, storyScope = null} = {}) {
    const plan = this.structure.plan({lorebookIds});
    const sessionId = this._nextSessionId('TREE', {
      lorebookIds: lorebookIds || [],
      planId: plan.planId,
      sourceRevisionFence: plan.sourceRevisionFence,
    });
    const actions = treeActionRows(plan, this.intelligence, sessionId);
    const inputIdentities = currentFence(this.intelligence, plan.sourceIdentities.map((row) => row.sourceId));
    const session = {
      kind: 'LoreAuthoringSession',
      contractVersion: 1,
      id: sessionId,
      type: 'TREE',
      stage: LoreAuthoringStage.BUILDING,
      draftRevision: 1,
      inputLorebookIds: unique(plan.sourceIdentities.map((row) => row.lorebookId)),
      inputSourceFence: sourceFenceFromIdentities(inputIdentities),
      dependencyFence: dependencyFenceFor(this.intelligence, 'TREE'),
      storyScope: deepClone(storyScope),
      baseProposal: deepClone(plan),
      actions,
      reviewItems: deepClone(plan.reviewItems || []),
      taxonomyEdits: [],
      build: {
        cursor: 0,
        total: actions.length,
        batchLimit: MAX_BUILD_BATCH,
        checkpointSequence: 0,
        complete: actions.length === 0,
      },
      checkpoints: [],
      finalPreview: null,
      approval: null,
      stale: null,
      lastError: null,
    };
    if (session.build.complete) session.stage = LoreAuthoringStage.DRAFT_REVIEW;
    this.sessions.set(session.id, session);
    return this.progress(session.id);
  }

  startMergeBuild({lorebookIds, outputLorebookId, outputTitle = null, storyScope = null} = {}) {
    if (!outputLorebookId || String(outputLorebookId).trim() === '') {
      throw Object.assign(new TypeError('outputLorebookId is required'), {code: 'LORE_MERGE_OUTPUT_BOOK_REQUIRED'});
    }
    const outputId = String(outputLorebookId);
    if ((lorebookIds || []).map(String).includes(outputId)) {
      throw Object.assign(new Error('Merge output Lorebook must be distinct from both inputs'), {code: 'LORE_MERGE_OUTPUT_BOOK_COLLISION'});
    }
    const existingBook = (this.intelligence.runtime.registry.snapshot().books || []).find((row) => row.id === outputId);
    if (existingBook) {
      throw Object.assign(new Error('Merge output Lorebook already exists: ' + outputId), {code: 'LORE_MERGE_OUTPUT_BOOK_EXISTS'});
    }

    const preview = this.merge.preview({lorebookIds});
    const sessionId = this._nextSessionId('MERGE', {
      lorebookIds,
      outputLorebookId: outputId,
      previewId: preview.previewId,
    });
    const actions = mergeActionRows(preview, this.intelligence, sessionId);
    const inputIdentities = preview.sourceToOutput.map((row) => row.sourceIdentity);
    const session = {
      kind: 'LoreAuthoringSession',
      contractVersion: 1,
      id: sessionId,
      type: 'MERGE',
      stage: LoreAuthoringStage.BUILDING,
      draftRevision: 1,
      inputLorebookIds: unique(lorebookIds),
      inputSourceFence: sourceFenceFromIdentities(inputIdentities),
      dependencyFence: dependencyFenceFor(this.intelligence, 'MERGE'),
      storyScope: deepClone(storyScope),
      outputLorebookId: outputId,
      outputTitle: outputTitle == null ? outputId : String(outputTitle),
      baseProposal: deepClone(preview),
      actions,
      reviewItems: deepClone(preview.reviewItems || []),
      taxonomyEdits: [],
      build: {
        cursor: 0,
        total: actions.length,
        batchLimit: MAX_BUILD_BATCH,
        checkpointSequence: 0,
        complete: actions.length === 0,
      },
      checkpoints: [],
      finalPreview: null,
      approval: null,
      stale: null,
      lastError: null,
    };
    if (session.build.complete) session.stage = LoreAuthoringStage.DRAFT_REVIEW;
    this.sessions.set(session.id, session);
    return this.progress(session.id);
  }

  resumeBuild({sessionId, maxActions = MAX_BUILD_BATCH} = {}) {
    const session = this._session(sessionId);
    if (![LoreAuthoringStage.BUILDING, LoreAuthoringStage.CHECKPOINTED].includes(session.stage)) {
      return this.progress(session.id);
    }
    const batch = Math.max(1, Math.min(MAX_BUILD_BATCH, Number(maxActions) || MAX_BUILD_BATCH));
    const end = Math.min(session.actions.length, session.build.cursor + batch);
    for (let index = session.build.cursor; index < end; index += 1) {
      session.actions[index].materialized = true;
    }
    session.build.cursor = end;
    session.build.complete = end >= session.actions.length;
    session.build.checkpointSequence += 1;
    const checkpoint = {
      kind: 'LoreAuthoringBuildCheckpoint',
      sessionId: session.id,
      checkpointSequence: session.build.checkpointSequence,
      cursor: end,
      total: session.actions.length,
      actionIds: session.actions.slice(0, end).map((row) => row.id),
      checksum: stableHash(session.actions.slice(0, end).map((row) => [row.id, row.proposalId])),
    };
    session.checkpoints.push(checkpoint);
    session.stage = session.build.complete ? LoreAuthoringStage.DRAFT_REVIEW : LoreAuthoringStage.CHECKPOINTED;
    return {
      kind: 'LoreAuthoringBuildReceipt',
      contractVersion: 1,
      checkpoint: deepClone(checkpoint),
      progress: this.progress(session.id),
      duplicateActionIds: session.actions.length - new Set(session.actions.map((row) => row.id)).size,
    };
  }

  draftReview({sessionId} = {}) {
    const session = this._session(sessionId);
    return {
      kind: 'LoreDraftReview',
      contractVersion: 1,
      sessionId: session.id,
      type: session.type,
      stage: session.stage,
      draftRevision: session.draftRevision,
      inputLorebookIds: [...session.inputLorebookIds],
      inputSourceFence: deepClone(session.inputSourceFence),
      dependencyFence: deepClone(session.dependencyFence),
      storyScope: deepClone(session.storyScope || null),
      actions: session.actions.filter((row) => row.materialized || session.build.complete).map(deepClone),
      reviewItems: deepClone(session.reviewItems),
      taxonomyEdits: deepClone(session.taxonomyEdits),
      availableDecisions: Object.values(LoreOperatorDecision),
      explicitOperatorDecisionRequired: true,
      modelSuggestionMutationAuthority: false,
      similarityScoreMutationAuthority: false,
      treePlacementTruthAuthority: false,
    };
  }

  recordDecision({sessionId, actionId, decision, operatorDecisionId, change = null, note = null} = {}) {
    const session = this._session(sessionId);
    if (session.stage !== LoreAuthoringStage.DRAFT_REVIEW && session.stage !== LoreAuthoringStage.FINAL_PREVIEW) {
      throw Object.assign(new Error('Authoring session is not in review'), {code: 'LORE_AUTHORING_NOT_IN_REVIEW'});
    }
    const action = session.actions.find((row) => row.id === String(actionId));
    if (!action || (!action.materialized && !session.build.complete)) {
      throw Object.assign(new Error('Unknown or unmaterialized review action: ' + actionId), {code: 'LORE_AUTHORING_ACTION_UNKNOWN'});
    }
    const normalizedDecision = String(decision || '').toUpperCase();
    if (!Object.values(LoreOperatorDecision).includes(normalizedDecision)) {
      throw Object.assign(new TypeError('Unsupported operator decision: ' + decision), {code: 'LORE_AUTHORING_DECISION_INVALID'});
    }
    const decisionId = assertOperatorDecisionId(operatorDecisionId);
    if (normalizedDecision === LoreOperatorDecision.CHANGE) {
      action.proposedOutput = decisionChange(action.proposedOutput, change, session.type);
    }
    action.decision = normalizedDecision;
    action.reviewState = normalizedDecision === LoreOperatorDecision.REJECT
      ? LoreReviewState.REJECTED
      : normalizedDecision === LoreOperatorDecision.DEFER
        ? LoreReviewState.DEFERRED
        : LoreReviewState.APPROVED;
    action.decisionRecord = {
      kind: 'LoreOperatorDecisionRecord',
      operatorDecisionId: decisionId,
      decision: normalizedDecision,
      decisionSequence: ++this.decisionSequence,
      note: note == null ? null : String(note),
      changedFields: normalizedDecision === LoreOperatorDecision.CHANGE ? Object.keys(change || {}).sort() : [],
    };
    session.draftRevision += 1;
    session.stage = LoreAuthoringStage.DRAFT_REVIEW;
    session.finalPreview = null;
    session.approval = null;
    session.stale = null;
    return {
      kind: 'LoreDraftDecisionReceipt',
      contractVersion: 1,
      sessionId: session.id,
      draftRevision: session.draftRevision,
      action: deepClone(action),
      decisions: decisionCounts(session.actions),
    };
  }

  reclassifyAfterTaxonomyEdit({
    sessionId,
    sourceIds,
    toPath,
    fromPath = null,
    operatorDecisionId,
    note = null,
  } = {}) {
    const session = this._session(sessionId);
    if (session.type !== 'TREE') {
      throw Object.assign(new Error('Taxonomy reclassification is only valid for Tree authoring sessions'), {code: 'LORE_TAXONOMY_TREE_ONLY'});
    }
    if (session.stage !== LoreAuthoringStage.DRAFT_REVIEW) {
      throw Object.assign(new Error('Taxonomy edit requires Draft Review'), {code: 'LORE_TAXONOMY_REVIEW_REQUIRED'});
    }
    const decisionId = assertOperatorDecisionId(operatorDecisionId);
    const requested = unique(sourceIds);
    if (!requested.length) {
      throw Object.assign(new TypeError('Targeted taxonomy edit requires sourceIds'), {code: 'LORE_TAXONOMY_SOURCES_REQUIRED'});
    }
    const fenceBySource = new Map(session.inputSourceFence.map((row) => [row.sourceId, row]));
    const targetRows = requested.map((sourceId) => {
      const row = fenceBySource.get(sourceId);
      if (!row) {
        throw Object.assign(new Error('Taxonomy edit source is outside the session fence: ' + sourceId), {
          code: 'LORE_TAXONOMY_SOURCE_OUTSIDE_FENCE',
        });
      }
      if (fromPath && !isPrefix(row.treePath, fromPath)) {
        throw Object.assign(new Error('Taxonomy edit source does not match fromPath: ' + sourceId), {
          code: 'LORE_TAXONOMY_SOURCE_PATH_MISMATCH',
        });
      }
      return row;
    });

    const supersededActionIds = [];
    for (const action of session.actions) {
      if (!action.inputSourceIds.some((sourceId) => requested.includes(sourceId))) continue;
      if (action.origin === 'OPERATOR_TAXONOMY_EDIT') continue;
      action.decision = LoreOperatorDecision.DEFER;
      action.reviewState = LoreReviewState.DEFERRED;
      action.decisionRecord = {
        kind: 'LoreOperatorDecisionRecord',
        operatorDecisionId: decisionId,
        decision: LoreOperatorDecision.DEFER,
        decisionSequence: ++this.decisionSequence,
        note: 'Superseded by targeted operator taxonomy edit',
        changedFields: [],
      };
      supersededActionIds.push(action.id);
    }

    const createdActionIds = [];
    for (const row of targetRows) {
      const proposed = {
        kind: 'LoreStructureProposal',
        action: LoreTreeAction.MOVE_ENTRY,
        state: LoreReviewState.APPROVED,
        confidence: 1,
        sourceId: row.sourceId,
        sourceRevisionId: row.sourceRevisionId,
        lorebookId: row.lorebookId,
        fromPath: [...row.treePath],
        toPath: pathArray(toPath),
        rationale: note == null ? 'Operator taxonomy edit targeted reclassification.' : String(note),
        automaticMutation: false,
        truthAuthority: false,
      };
      const actionId = stableActionId('TREE', session.id, {
        taxonomyEdit: session.taxonomyEdits.length + 1,
        sourceId: row.sourceId,
        toPath: pathArray(toPath),
      });
      const membershipRows = (session.baseProposal.semanticMemberships || []).filter((membership) => membership.sourceId === row.sourceId);
      const action = {
        kind: 'LoreAuthoringReviewAction',
        id: actionId,
        type: 'TREE',
        sequence: session.actions.length + 1,
        origin: 'OPERATOR_TAXONOMY_EDIT',
        proposalId: null,
        action: LoreTreeAction.MOVE_ENTRY,
        inputLorebookIds: [row.lorebookId],
        inputSourceIds: [row.sourceId],
        inputUids: [row.uid],
        inputSourceRevisions: [deepClone(row)],
        affectedTreeNodes: [[...row.treePath], pathArray(toPath)],
        semanticDependencies: {
          evidenceRefs: unique(membershipRows.map((membership) => membership.evidenceArtifactId)),
          conceptRefs: unique(membershipRows.map((membership) => membership.conceptRef)),
          semanticMembershipRefs: deepClone(membershipRows),
        },
        originalProposal: null,
        proposedOutput: proposed,
        decision: LoreOperatorDecision.CHANGE,
        decisionRecord: {
          kind: 'LoreOperatorDecisionRecord',
          operatorDecisionId: decisionId,
          decision: LoreOperatorDecision.CHANGE,
          decisionSequence: ++this.decisionSequence,
          note: note == null ? null : String(note),
          changedFields: ['toPath'],
        },
        reviewState: LoreReviewState.APPROVED,
        materialized: true,
      };
      session.actions.push(action);
      createdActionIds.push(action.id);
    }

    const edit = {
      kind: 'LoreTaxonomyEditReceipt',
      id: 'lore-taxonomy-edit:' + stableHash({
        sessionId: session.id,
        operatorDecisionId: decisionId,
        sourceIds: requested,
        toPath: pathArray(toPath),
        draftRevision: session.draftRevision + 1,
      }),
      operatorDecisionId: decisionId,
      sourceIds: requested,
      fromPath: fromPath ? pathArray(fromPath) : null,
      toPath: pathArray(toPath),
      supersededActionIds,
      createdActionIds,
      unaffectedSourceCount: session.inputSourceFence.length - requested.length,
      targetedReclassification: true,
    };
    session.taxonomyEdits.push(edit);
    session.build.total = session.actions.length;
    session.build.cursor = session.actions.length;
    session.build.complete = true;
    session.draftRevision += 1;
    session.finalPreview = null;
    session.approval = null;
    return deepClone(edit);
  }

  _markStale(session, reason, details) {
    session.stage = LoreAuthoringStage.DRAFT_REVIEW;
    session.stale = {
      kind: 'LoreAuthoringStaleReceipt',
      reason,
      details: deepClone(details),
      returnedToDraftReview: true,
    };
    session.finalPreview = null;
    session.approval = null;
    return {
      kind: 'LoreFinalPreviewReceipt',
      contractVersion: 1,
      sessionId: session.id,
      readyForApproval: false,
      stale: deepClone(session.stale),
      stage: session.stage,
    };
  }

  _assertCurrentFences(session, {checkDependencies = true} = {}) {
    const sourceCheck = checkSourceFence(this.intelligence, session.inputSourceFence);
    if (!sourceCheck.ok) return {ok: false, reason: 'SOURCE_REVISION_FENCE_CHANGED', details: sourceCheck};
    if (checkDependencies) {
      const dependencyCheck = checkDependencyFence(this.intelligence, session.dependencyFence, session.type);
      if (!dependencyCheck.ok) return {ok: false, reason: 'DEPENDENCY_FENCE_CHANGED', details: dependencyCheck};
      if (session.type === 'MERGE') {
        const existingOutputBook = (this.intelligence.runtime.registry.snapshot().books || [])
          .find((book) => book.id === session.outputLorebookId);
        if (existingOutputBook) {
          return {
            ok: false,
            reason: 'OUTPUT_LOREBOOK_CONFLICT',
            details: {
              kind: 'LoreMergeOutputFenceCheck',
              outputLorebookId: session.outputLorebookId,
              existingTitle: existingOutputBook.title || null,
              existingAuthoringSettlementId: existingOutputBook.metadata?.authoringSettlementId || null,
            },
          };
        }
        const currentPreview = this.merge.preview({lorebookIds: session.inputLorebookIds});
        if (!currentPreview.validation?.ok || currentPreview.previewId !== session.baseProposal.previewId) {
          return {
            ok: false,
            reason: 'DEPENDENCY_FENCE_CHANGED',
            details: {
              kind: 'LoreMergeDependencyFenceCheck',
              expectedPreviewId: session.baseProposal.previewId,
              currentPreviewId: currentPreview.previewId,
              currentValidationOk: Boolean(currentPreview.validation?.ok),
            },
          };
        }
      }
    }
    return {ok: true};
  }

  _treeFinalPreview(session) {
    const registry = this.intelligence.runtime.registry;
    const stateBySource = new Map(session.inputSourceFence.map((fence) => {
      const identity = sourceRevisionIdentity(registry, fence.sourceId, fence.sourceRevisionId);
      return [fence.sourceId, {
        identity,
        beforeMetadata: deepClone(identity.metadata || {}),
        metadata: deepClone(identity.metadata || {}),
      }];
    }));

    for (const action of selectedActions(session)) applyTreeProposalToMetadata(action, stateBySource);

    const changes = [];
    for (const [sourceId, row] of stateBySource.entries()) {
      if (!metadataChanged(row.beforeMetadata, row.metadata)) continue;
      const revision = registry.currentRevision(sourceId);
      const preflight = this.semantic.previewEdit({
        sourceId,
        content: revision.exactContent,
        metadata: row.metadata,
      });
      changes.push({
        sourceId,
        lorebookId: row.identity.lorebookId,
        uid: row.identity.uid,
        expectedSourceRevisionId: row.identity.sourceRevisionId,
        exactContent: revision.exactContent,
        beforeMetadata: deepClone(row.beforeMetadata),
        afterMetadata: deepClone(row.metadata),
        affectedTreeNodes: [pathArray(row.beforeMetadata.treePath), pathArray(row.metadata.treePath)],
        semanticPreflight: preflight,
      });
    }

    const preflightOk = changes.every((row) => (
      row.semanticPreflight.previewOnly
      && row.semanticPreflight.semanticChange?.invalidationPlan?.authoritativePreflight === true
      && row.semanticPreflight.allPreviouslyReadyUnrelatedSourcesRemainReady
    ));
    const validation = {
      kind: 'LoreTreeFinalPreviewValidation',
      ok: preflightOk,
      sourceChanges: changes.length,
      preflightReports: changes.length,
      unrelatedReadyPreservedInPreflight: changes.every((row) => row.semanticPreflight.allPreviouslyReadyUnrelatedSourcesRemainReady),
      noAutomaticTreeAuthority: true,
      explicitOperatorDecisions: true,
    };
    return {
      output: {
        kind: 'LoreTreeFinalOutputPreview',
        sourceChanges: changes.map((row) => ({
          sourceId: row.sourceId,
          lorebookId: row.lorebookId,
          uid: row.uid,
          expectedSourceRevisionId: row.expectedSourceRevisionId,
          beforeTreePath: pathArray(row.beforeMetadata.treePath),
          afterTreePath: pathArray(row.afterMetadata.treePath),
        })),
      },
      operations: changes,
      validation,
    };
  }

  _mergeFinalPreview(session) {
    const preview = session.baseProposal;
    const selected = selectedActions(session);
    const inputSourceIds = session.inputSourceFence.map((row) => row.sourceId);
    const covered = new Set(selected.flatMap((row) => row.proposedOutput.sourceRefs || []));
    const missingSources = inputSourceIds.filter((sourceId) => !covered.has(sourceId));
    const allFacts = new Set((preview.proposedOutput || []).flatMap((row) => row.semanticFactRefs || []));
    const selectedFacts = new Set(selected.flatMap((row) => row.proposedOutput.semanticFactRefs || []));
    const missingFacts = [...allFacts].filter((fact) => !selectedFacts.has(fact)).sort();

    const contradictionCoalescence = (preview.classifications?.unresolvedContradictions || []).filter((classification) => (
      selected.some((action) => {
        const refs = new Set(action.proposedOutput.sourceRefs || []);
        return refs.has(classification.leftSourceId) && refs.has(classification.rightSourceId);
      })
    ));

    const existingBook = (this.intelligence.runtime.registry.snapshot().books || [])
      .find((book) => book.id === session.outputLorebookId);
    const sourcePreflights = session.inputSourceFence.map((row) => this.semantic.semanticChangeReport({
      sourceId: row.sourceId,
      fromRevisionId: row.sourceRevisionId,
      toRevisionId: row.sourceRevisionId,
    }));

    const entries = selected.map((action) => {
      const output = action.proposedOutput;
      const metadata = deepClone(output.metadata || {});
      metadata.title = output.title || metadata.title || output.uid;
      metadata.extra = {
        ...(metadata.extra || {}),
        authoringMerge: {
          sessionId: session.id,
          previewId: preview.previewId,
          sourceRefs: unique(output.sourceRefs || []),
          sourceRevisionRefs: unique(output.sourceRevisionRefs || []),
          exactSourceTextReused: true,
          synthesizedText: false,
        },
      };
      return {
        actionId: action.id,
        outputId: output.outputId,
        uid: String(output.uid),
        title: String(output.title || output.uid),
        content: String(output.exactContent),
        metadata,
        sourceRefs: unique(output.sourceRefs || []),
        sourceRevisionRefs: unique(output.sourceRevisionRefs || []),
        semanticFactRefs: unique(output.semanticFactRefs || []),
      };
    });

    const duplicateUids = entries.length - new Set(entries.map((row) => row.uid)).size;
    const authoritativeSourcePreflight = sourcePreflights.every((report) => (
      report.invalidationPlan?.authoritativePreflight === true
      && report.source?.sourceRevisionId
      && report.source?.sourceRevisionId === report.previousSource?.sourceRevisionId
    ));
    const validation = {
      kind: 'LoreMergeFinalPreviewValidation',
      ok: !existingBook
        && missingSources.length === 0
        && missingFacts.length === 0
        && contradictionCoalescence.length === 0
        && duplicateUids === 0
        && authoritativeSourcePreflight
        && Boolean(preview.validation?.ok),
      baseMergePreviewValid: Boolean(preview.validation?.ok),
      outputLorebookAlreadyExists: Boolean(existingBook),
      missingSourceIds: missingSources,
      missingSemanticFactRefs: missingFacts,
      unsafeContradictionPairs: contradictionCoalescence.map((row) => row.id),
      duplicateOutputUids: duplicateUids,
      sourcePreflightCount: sourcePreflights.length,
      authoritativeSourcePreflight,
      exactSourceTextOnly: entries.every((row) => {
        return row.sourceRefs.some((sourceId) => {
          const revision = this.intelligence.runtime.registry.currentRevision(sourceId, {allowMissing: true});
          return revision?.exactContent === row.content;
        });
      }),
      originalBooksMutated: false,
    };

    return {
      output: {
        kind: 'LoreMergeFinalOutputPreview',
        lorebookId: session.outputLorebookId,
        title: session.outputTitle,
        entries,
        sourceToOutput: deepClone(preview.sourceToOutput),
        reconstructionManifest: deepClone(preview.reconstructionManifest),
        contradictionsRemainSeparate: contradictionCoalescence.length === 0,
      },
      operations: entries,
      sourcePreflights,
      validation,
    };
  }

  computeFinalPreview({sessionId} = {}) {
    const session = this._session(sessionId);
    if (!session.build.complete) {
      throw Object.assign(new Error('Authoring build is not complete'), {code: 'LORE_AUTHORING_BUILD_INCOMPLETE'});
    }
    const pending = session.actions.filter((row) => !row.decision);
    if (pending.length) {
      throw Object.assign(new Error('Every Draft Review action requires an explicit decision before Final Preview'), {
        code: 'LORE_AUTHORING_REVIEW_INCOMPLETE',
        pendingActionIds: pending.map((row) => row.id),
      });
    }
    const fence = this._assertCurrentFences(session, {checkDependencies: true});
    if (!fence.ok) return this._markStale(session, fence.reason, fence.details);

    const body = session.type === 'TREE'
      ? this._treeFinalPreview(session)
      : this._mergeFinalPreview(session);
    const core = {
      sessionId: session.id,
      type: session.type,
      draftRevision: session.draftRevision,
      inputSourceFence: session.inputSourceFence,
      dependencyFence: session.dependencyFence,
      decisions: session.actions.map((row) => [row.id, row.decision, row.decisionRecord?.operatorDecisionId || null]),
      storyScope: deepClone(session.storyScope || null),
      proposalEvidenceReceipts: session.actions.map((row) => ({
        actionId: row.id,
        decision: row.decision,
        evidenceReceipt: deepClone(row.evidenceReceipt || null),
      })),
      output: body.output,
      validation: body.validation,
    };
    const finalPreview = {
      kind: 'LoreFinalPreview',
      contractVersion: 1,
      finalPreviewId: 'lore-final-preview:' + stableHash(core),
      ...core,
      operations: deepClone(body.operations || []),
      sourcePreflights: deepClone(body.sourcePreflights || []),
      authoritativeSemanticPreflight: true,
      modelMutationAuthority: false,
      similarityScoreMutationAuthority: false,
      treePlacementTruthAuthority: false,
      explicitApprovalRequired: true,
    };
    session.finalPreview = finalPreview;
    session.stage = LoreAuthoringStage.FINAL_PREVIEW;
    session.stale = null;
    return deepClone(finalPreview);
  }

  approveFinalPreview({sessionId, operatorApprovalId, note = null} = {}) {
    const session = this._session(sessionId);
    if (session.stage !== LoreAuthoringStage.FINAL_PREVIEW || !session.finalPreview) {
      throw Object.assign(new Error('Final Preview must be computed before approval'), {code: 'LORE_AUTHORING_FINAL_PREVIEW_REQUIRED'});
    }
    if (!session.finalPreview.validation?.ok) {
      throw Object.assign(new Error('Final Preview failed deterministic validation'), {code: 'LORE_AUTHORING_FINAL_PREVIEW_INVALID'});
    }
    const approvalId = assertOperatorDecisionId(operatorApprovalId);
    const fence = this._assertCurrentFences(session, {checkDependencies: true});
    if (!fence.ok) return this._markStale(session, fence.reason, fence.details);
    session.approval = {
      kind: 'LoreFinalPreviewApproval',
      operatorApprovalId: approvalId,
      finalPreviewId: session.finalPreview.finalPreviewId,
      draftRevision: session.draftRevision,
      approvalSequence: ++this.decisionSequence,
      note: note == null ? null : String(note),
      explicit: true,
    };
    session.stage = LoreAuthoringStage.READY_TO_SETTLE;
    return {
      kind: 'LoreFinalPreviewApprovalReceipt',
      contractVersion: 1,
      sessionId: session.id,
      stage: session.stage,
      approval: deepClone(session.approval),
    };
  }

  _refreshDerivedFreshness() {
    this.intelligence.multiResolution.refreshFreshness();
    this.intelligence.ontology.rebuild();
    this.intelligence.hierarchy.refreshHierarchy();
    this.intelligence.hierarchy.refreshRetrieval();
  }

  _newSettlement(session) {
    const settlementId = 'lore-settlement:' + stableHash({
      sessionId: session.id,
      finalPreviewId: session.finalPreview.finalPreviewId,
      approvalId: session.approval.operatorApprovalId,
      sequence: ++this.sequence,
    });
    const operations = session.type === 'TREE'
      ? session.finalPreview.operations.map((row, index) => ({
        kind: 'TREE_SOURCE_REVISION',
        operationId: settlementId + ':op:' + (index + 1),
        sourceId: row.sourceId,
        lorebookId: row.lorebookId,
        uid: row.uid,
        expectedSourceRevisionId: row.expectedSourceRevisionId,
        exactContent: row.exactContent,
        beforeMetadata: deepClone(row.beforeMetadata),
        afterMetadata: deepClone(row.afterMetadata),
        semanticPreflight: deepClone(row.semanticPreflight),
      }))
      : session.finalPreview.operations.map((row, index) => ({
        kind: 'MERGE_OUTPUT_ENTRY',
        operationId: settlementId + ':op:' + (index + 1),
        lorebookId: session.outputLorebookId,
        outputId: row.outputId,
        uid: row.uid,
        content: row.content,
        metadata: deepClone(row.metadata),
        sourceRefs: [...row.sourceRefs],
        sourceRevisionRefs: [...row.sourceRevisionRefs],
        semanticFactRefs: [...row.semanticFactRefs],
      }));
    const settlement = {
      kind: 'LoreAuthoringSettlement',
      contractVersion: 1,
      id: settlementId,
      sessionId: session.id,
      type: session.type,
      state: LoreSettlementState.PENDING,
      finalPreviewId: session.finalPreview.finalPreviewId,
      operatorApprovalId: session.approval.operatorApprovalId,
      inputSourceFence: deepClone(session.inputSourceFence),
      dependencyFence: deepClone(session.dependencyFence),
      storyScope: deepClone(session.storyScope || null),
      operations,
      cursor: 0,
      receipts: [],
      revisionEvents: [],
      invalidationReceipts: [],
      checkpoints: [],
      reconstructionManifest: session.type === 'TREE'
        ? {
          kind: 'LoreTreeReconstructionManifest',
          sources: operations.map((operation) => ({
            sourceId: operation.sourceId,
            lorebookId: operation.lorebookId,
            uid: operation.uid,
            sourceRevisionId: operation.expectedSourceRevisionId,
            exactContent: operation.exactContent,
            beforeMetadata: deepClone(operation.beforeMetadata),
            afterMetadata: deepClone(operation.afterMetadata),
          })),
          preservesExactAuthoredText: true,
          restoresByNewRevision: true,
          reconstructable: true,
        }
        : deepClone(session.finalPreview.output?.reconstructionManifest || null),
      restoration: null,
      lastError: null,
    };
    this.settlements.set(settlement.id, settlement);
    return settlement;
  }

  _applyTreeOperation(settlement, operation) {
    const registry = this.intelligence.runtime.registry;
    const current = registry.currentRevision(operation.sourceId, {allowMissing: true});
    let result;
    let resumed = false;
    if (exactRevisionMatches(current, operation.exactContent, operation.afterMetadata)) {
      const source = registry.getEntry(operation.sourceId);
      result = {
        changed: false,
        source,
        revision: current,
        previousRevision: registry.getRevision(current.replacesRevisionId) || current,
        obligation: this.intelligence.runtime.findObligation(current.id),
      };
      resumed = true;
    } else {
      if (!current || current.id !== operation.expectedSourceRevisionId) {
        throw Object.assign(new Error('Tree settlement source fence changed during application: ' + operation.sourceId), {
          code: 'LORE_SETTLEMENT_SOURCE_STALE',
        });
      }
      result = this.intelligence.runtime.upsertEntry({
        lorebookId: operation.lorebookId,
        uid: operation.uid,
        content: operation.exactContent,
        metadata: operation.afterMetadata,
      });
    }
    const event = revisionEvent({
      result,
      settlementId: settlement.id,
      operationKind: 'TREE_SOURCE_REVISION',
    });
    const invalidation = treeInvalidationReceipt(operation.semanticPreflight, result.revision.id, settlement.id);
    return {
      receipt: {
        kind: 'LoreSettlementOperationReceipt',
        operationId: operation.operationId,
        sourceId: operation.sourceId,
        sourceRevisionId: result.revision.id,
        previousSourceRevisionId: result.previousRevision?.id || null,
        changed: Boolean(result.changed),
        resumedIdempotently: resumed,
        studyObligationId: result.obligation?.id || null,
        studyTrigger: result.obligation?.trigger || null,
        beforeTreePath: pathArray(operation.beforeMetadata?.treePath),
        afterTreePath: pathArray(operation.afterMetadata?.treePath),
      },
      event,
      invalidation,
    };
  }

  _ensureMergeBook(session, settlement) {
    const registry = this.intelligence.runtime.registry;
    const existing = (registry.snapshot().books || []).find((book) => book.id === session.outputLorebookId);
    if (existing) {
      if (existing.metadata?.authoringSettlementId !== settlement.id) {
        throw Object.assign(new Error('Merge output Lorebook was created by another owner'), {code: 'LORE_SETTLEMENT_OUTPUT_BOOK_COLLISION'});
      }
      return;
    }
    registry.registerLorebook({
      id: session.outputLorebookId,
      title: session.outputTitle,
      metadata: {
        discovery: {
          kind: 'LoreAuthoringMergeSettlement',
          settlementId: settlement.id,
          inputLorebookIds: [...session.inputLorebookIds],
        },
        authoringSettlementId: settlement.id,
        sourceLorebookIds: [...session.inputLorebookIds],
        reconstructable: true,
      },
    });
  }

  _applyMergeOperation(session, settlement, operation) {
    this._ensureMergeBook(session, settlement);
    const registry = this.intelligence.runtime.registry;
    const sourceId = 'lore:' + operation.lorebookId + ':' + operation.uid;
    const current = registry.currentRevision(sourceId, {allowMissing: true});
    let result;
    let resumed = false;
    if (exactRevisionMatches(current, operation.content, operation.metadata)) {
      const source = registry.getEntry(sourceId);
      result = {
        changed: false,
        source,
        revision: current,
        previousRevision: registry.getRevision(current.replacesRevisionId) || null,
        obligation: this.intelligence.runtime.findObligation(current.id),
      };
      resumed = true;
    } else {
      if (current && current.state !== 'REMOVED') {
        throw Object.assign(new Error('Merge output UID collision during settlement: ' + operation.uid), {
          code: 'LORE_SETTLEMENT_OUTPUT_UID_COLLISION',
        });
      }
      result = this.intelligence.runtime.upsertEntry({
        lorebookId: operation.lorebookId,
        uid: operation.uid,
        content: operation.content,
        metadata: operation.metadata,
      });
    }
    const event = revisionEvent({
      result,
      settlementId: settlement.id,
      operationKind: 'MERGE_OUTPUT_ENTRY',
    });
    const invalidation = newSourceInvalidationReceipt({
      sourceId: result.source.sourceId,
      sourceRevisionId: result.revision.id,
      settlementId: settlement.id,
    });
    return {
      receipt: {
        kind: 'LoreSettlementOperationReceipt',
        operationId: operation.operationId,
        outputId: operation.outputId,
        sourceId: result.source.sourceId,
        sourceRevisionId: result.revision.id,
        previousSourceRevisionId: result.previousRevision?.id || null,
        sourceRefs: [...operation.sourceRefs],
        sourceRevisionRefs: [...operation.sourceRevisionRefs],
        semanticFactRefs: [...operation.semanticFactRefs],
        changed: Boolean(result.changed),
        resumedIdempotently: resumed,
        studyObligationId: result.obligation?.id || null,
        studyTrigger: result.obligation?.trigger || null,
      },
      event,
      invalidation,
    };
  }

  _assertAppliedSettlementReceiptsCurrent(settlement) {
    const registry = this.intelligence.runtime.registry;
    const stale = [];
    for (const receipt of settlement.receipts || []) {
      const current = registry.currentRevision(receipt.sourceId, {allowMissing: true});
      if (!current || current.id !== receipt.sourceRevisionId) {
        stale.push({
          operationId: receipt.operationId,
          sourceId: receipt.sourceId,
          expectedSourceRevisionId: receipt.sourceRevisionId,
          currentSourceRevisionId: current?.id || null,
          currentState: current?.state || 'MISSING',
        });
      }
    }
    return {ok: stale.length === 0, stale};
  }

  applySettlement({sessionId, maxOperations = MAX_SETTLEMENT_BATCH} = {}) {
    const session = this._session(sessionId);
    let settlement = this._settlementForSession(session.id);
    if (!settlement) {
      if (session.stage !== LoreAuthoringStage.READY_TO_SETTLE || !session.approval || !session.finalPreview?.validation?.ok) {
        throw Object.assign(new Error('Approved valid Final Preview is required before Settlement'), {
          code: 'LORE_SETTLEMENT_APPROVAL_REQUIRED',
        });
      }
      const fence = this._assertCurrentFences(session, {checkDependencies: true});
      if (!fence.ok) return this._markStale(session, fence.reason, fence.details);
      settlement = this._newSettlement(session);
    }
    if ([LoreSettlementState.SETTLED, LoreSettlementState.RESTORED].includes(settlement.state)) {
      return this.settlementReadModel({settlementId: settlement.id});
    }

    const appliedFence = this._assertAppliedSettlementReceiptsCurrent(settlement);
    if (!appliedFence.ok) {
      settlement.state = LoreSettlementState.FAILED;
      settlement.lastError = normalizeLoreAuthoringError(Object.assign(
        new Error('An already-applied Settlement revision changed before resume'),
        {
          code: 'LORE_SETTLEMENT_APPLIED_REVISION_STALE',
          details: {stale: appliedFence.stale},
        },
      ));
      session.stage = LoreAuthoringStage.FAILED;
      session.lastError = deepClone(settlement.lastError);
      return this.settlementReadModel({settlementId: settlement.id});
    }

    const batch = Math.max(1, Math.min(MAX_SETTLEMENT_BATCH, Number(maxOperations) || MAX_SETTLEMENT_BATCH));
    settlement.state = LoreSettlementState.APPLYING;
    session.stage = LoreAuthoringStage.SETTLING;
    let executed = 0;
    try {
      while (settlement.cursor < settlement.operations.length && executed < batch) {
        const operation = settlement.operations[settlement.cursor];
        const result = session.type === 'TREE'
          ? this._applyTreeOperation(settlement, operation)
          : this._applyMergeOperation(session, settlement, operation);
        settlement.receipts.push(result.receipt);
        settlement.revisionEvents.push(result.event);
        settlement.invalidationReceipts.push(result.invalidation);
        settlement.cursor += 1;
        executed += 1;
        settlement.checkpoints.push({
          kind: 'LoreSettlementCheckpoint',
          settlementId: settlement.id,
          cursor: settlement.cursor,
          total: settlement.operations.length,
          completedOperationIds: settlement.receipts.map((row) => row.operationId),
          checksum: stableHash(settlement.receipts.map((row) => [row.operationId, row.sourceRevisionId])),
        });
      }
      if (executed > 0) this._refreshDerivedFreshness();
      if (settlement.cursor >= settlement.operations.length) {
        settlement.state = LoreSettlementState.SETTLED;
        session.stage = LoreAuthoringStage.SETTLED;
      } else {
        settlement.state = LoreSettlementState.CHECKPOINTED;
        session.stage = LoreAuthoringStage.CHECKPOINTED;
      }
      return this.settlementReadModel({settlementId: settlement.id});
    } catch (error) {
      settlement.state = LoreSettlementState.FAILED;
      settlement.lastError = normalizeLoreAuthoringError(error, 'LORE_SETTLEMENT_FAILED');
      session.stage = LoreAuthoringStage.FAILED;
      session.lastError = deepClone(settlement.lastError);
      return this.settlementReadModel({settlementId: settlement.id});
    }
  }

  _beginRestoration(settlement, restorationId) {
    const id = assertOperatorDecisionId(restorationId);
    const applied = settlement.receipts.slice(0, settlement.cursor);
    settlement.restoration = {
      kind: 'LoreSettlementRestoration',
      restorationId: id,
      state: LoreSettlementState.RESTORING,
      cursor: 0,
      operationCount: applied.length,
      operationIndexes: applied.map((_, index) => index).reverse(),
      receipts: [],
      revisionEvents: [],
      invalidationReceipts: [],
      checkpoints: [],
      lastError: null,
    };
    return settlement.restoration;
  }

  _restoreTreeOperation(settlement, operation, appliedReceipt) {
    const registry = this.intelligence.runtime.registry;
    const current = registry.currentRevision(operation.sourceId, {allowMissing: true});
    if (!current) {
      throw Object.assign(new Error('Restoration source missing: ' + operation.sourceId), {code: 'LORE_RESTORE_SOURCE_MISSING'});
    }
    if (current.id !== appliedReceipt.sourceRevisionId
      && !exactRevisionMatches(current, operation.exactContent, operation.beforeMetadata)) {
      throw Object.assign(new Error('Restoration source changed after Settlement: ' + operation.sourceId), {
        code: 'LORE_RESTORE_SOURCE_STALE',
      });
    }
    let result;
    let resumed = false;
    let preflight;
    if (exactRevisionMatches(current, operation.exactContent, operation.beforeMetadata)) {
      result = {
        changed: false,
        source: registry.getEntry(operation.sourceId),
        revision: current,
        previousRevision: registry.getRevision(current.replacesRevisionId) || current,
        obligation: this.intelligence.runtime.findObligation(current.id),
      };
      resumed = true;
      preflight = operation.semanticPreflight;
    } else {
      preflight = this.semantic.previewEdit({
        sourceId: operation.sourceId,
        content: operation.exactContent,
        metadata: operation.beforeMetadata,
      });
      result = this.intelligence.runtime.upsertEntry({
        lorebookId: operation.lorebookId,
        uid: operation.uid,
        content: operation.exactContent,
        metadata: operation.beforeMetadata,
      });
    }
    return {
      receipt: {
        kind: 'LoreRestorationOperationReceipt',
        operationId: operation.operationId,
        sourceId: operation.sourceId,
        sourceRevisionId: result.revision.id,
        restoredTreePath: pathArray(operation.beforeMetadata.treePath),
        changed: Boolean(result.changed),
        resumedIdempotently: resumed,
        studyObligationId: result.obligation?.id || null,
      },
      event: revisionEvent({
        result,
        settlementId: settlement.id,
        operationKind: 'TREE_RESTORATION',
        restoration: true,
      }),
      invalidation: treeInvalidationReceipt(preflight, result.revision.id, settlement.id, true),
    };
  }

  _restoreMergeOperation(settlement, operation, appliedReceipt) {
    const registry = this.intelligence.runtime.registry;
    const sourceId = appliedReceipt.sourceId;
    const source = registry.getEntry(sourceId);
    const current = registry.currentRevision(sourceId, {allowMissing: true});
    if (!source || !current) {
      throw Object.assign(new Error('Merge restoration output source missing: ' + sourceId), {code: 'LORE_RESTORE_OUTPUT_MISSING'});
    }
    let result;
    let resumed = false;
    if (current.state === 'REMOVED') {
      result = {
        changed: false,
        source,
        revision: current,
        previousRevision: registry.getRevision(current.replacesRevisionId) || current,
        obligation: this.intelligence.runtime.findObligation(current.id),
      };
      resumed = true;
    } else {
      if (current.id !== appliedReceipt.sourceRevisionId) {
        throw Object.assign(new Error('Merge output changed after Settlement: ' + sourceId), {code: 'LORE_RESTORE_OUTPUT_STALE'});
      }
      result = this.intelligence.runtime.removeEntry({
        lorebookId: operation.lorebookId,
        uid: operation.uid,
        reason: 'authoring-settlement-restoration:' + settlement.id,
      });
    }
    const event = revisionEvent({
      result,
      settlementId: settlement.id,
      operationKind: 'MERGE_OUTPUT_RESTORATION',
      restoration: true,
    });
    return {
      receipt: {
        kind: 'LoreRestorationOperationReceipt',
        operationId: operation.operationId,
        sourceId,
        sourceRevisionId: result.revision.id,
        sourceState: result.revision.state,
        changed: Boolean(result.changed),
        resumedIdempotently: resumed,
        studyObligationId: result.obligation?.id || null,
      },
      event,
      invalidation: {
        kind: 'LoreInvalidationReceipt',
        contractVersion: 1,
        settlementId: settlement.id,
        restoration: true,
        sourceId,
        fromRevisionId: appliedReceipt.sourceRevisionId,
        toRevisionId: result.revision.id,
        targets: [
          {target: 'STUDY_ARTIFACTS', reason: 'MERGE_OUTPUT_REMOVED'},
          {target: 'REPRESENTATIONS', reason: 'MERGE_OUTPUT_REMOVED'},
          {target: 'ONTOLOGY', reason: 'MERGE_OUTPUT_REMOVED'},
          {target: 'NAVIGATION_SUMMARIES', reason: 'MERGE_OUTPUT_REMOVED'},
          {target: 'RETRIEVAL_INDEX', reason: 'MERGE_OUTPUT_REMOVED'},
        ],
        unrelatedSourcesInvalidated: false,
        authoritativePreflight: true,
      },
    };
  }

  restoreSettlement({settlementId, restorationId = null, maxOperations = MAX_SETTLEMENT_BATCH} = {}) {
    const settlement = this.settlements.get(String(settlementId));
    if (!settlement) throw Object.assign(new Error('Unknown Lore Settlement: ' + settlementId), {code: 'LORE_SETTLEMENT_UNKNOWN'});
    const session = this._session(settlement.sessionId);
    if (![LoreSettlementState.SETTLED, LoreSettlementState.CHECKPOINTED, LoreSettlementState.FAILED, LoreSettlementState.RESTORING].includes(settlement.state)
      && !settlement.restoration) {
      throw Object.assign(new Error('Settlement is not restorable in state ' + settlement.state), {code: 'LORE_SETTLEMENT_NOT_RESTORABLE'});
    }
    const restoration = settlement.restoration || this._beginRestoration(settlement, restorationId);
    const batch = Math.max(1, Math.min(MAX_SETTLEMENT_BATCH, Number(maxOperations) || MAX_SETTLEMENT_BATCH));
    restoration.state = LoreSettlementState.RESTORING;
    settlement.state = LoreSettlementState.RESTORING;
    session.stage = LoreAuthoringStage.RESTORING;
    let executed = 0;
    try {
      while (restoration.cursor < restoration.operationIndexes.length && executed < batch) {
        const receiptIndex = restoration.operationIndexes[restoration.cursor];
        const appliedReceipt = settlement.receipts[receiptIndex];
        const operation = settlement.operations.find((row) => row.operationId === appliedReceipt.operationId);
        const result = settlement.type === 'TREE'
          ? this._restoreTreeOperation(settlement, operation, appliedReceipt)
          : this._restoreMergeOperation(settlement, operation, appliedReceipt);
        restoration.receipts.push(result.receipt);
        restoration.revisionEvents.push(result.event);
        restoration.invalidationReceipts.push(result.invalidation);
        restoration.cursor += 1;
        executed += 1;
        restoration.checkpoints.push({
          kind: 'LoreRestorationCheckpoint',
          settlementId: settlement.id,
          restorationId: restoration.restorationId,
          cursor: restoration.cursor,
          total: restoration.operationIndexes.length,
          checksum: stableHash(restoration.receipts.map((row) => [row.operationId, row.sourceRevisionId])),
        });
      }
      if (executed > 0) this._refreshDerivedFreshness();
      if (restoration.cursor >= restoration.operationIndexes.length) {
        restoration.state = LoreSettlementState.RESTORED;
        settlement.state = LoreSettlementState.RESTORED;
        session.stage = LoreAuthoringStage.RESTORED;
      } else {
        restoration.state = LoreSettlementState.CHECKPOINTED;
        settlement.state = LoreSettlementState.RESTORING;
        session.stage = LoreAuthoringStage.CHECKPOINTED;
      }
    } catch (error) {
      restoration.state = LoreSettlementState.FAILED;
      restoration.lastError = normalizeLoreAuthoringError(error, 'LORE_RESTORATION_FAILED');
      settlement.state = LoreSettlementState.FAILED;
      session.stage = LoreAuthoringStage.FAILED;
      session.lastError = deepClone(restoration.lastError);
    }
    return this.settlementReadModel({settlementId: settlement.id});
  }

  progress(sessionId) {
    const session = this._session(sessionId);
    return readSession(session, this._settlementForSession(session.id));
  }

  finalPreview({sessionId} = {}) {
    return deepClone(this._session(sessionId).finalPreview || null);
  }

  settlementReadModel({settlementId} = {}) {
    const settlement = this.settlements.get(String(settlementId));
    if (!settlement) throw Object.assign(new Error('Unknown Lore Settlement: ' + settlementId), {code: 'LORE_SETTLEMENT_UNKNOWN'});
    return {
      kind: 'LoreSettlementReadModel',
      contractVersion: 1,
      settlementId: settlement.id,
      sessionId: settlement.sessionId,
      type: settlement.type,
      state: settlement.state,
      finalPreviewId: settlement.finalPreviewId,
      operatorApprovalId: settlement.operatorApprovalId,
      storyScope: deepClone(settlement.storyScope || null),
      cursor: settlement.cursor,
      operationCount: settlement.operations.length,
      receipts: deepClone(settlement.receipts),
      revisionEvents: deepClone(settlement.revisionEvents),
      invalidationReceipts: deepClone(settlement.invalidationReceipts),
      checkpoints: deepClone(settlement.checkpoints),
      reconstructionManifest: deepClone(settlement.reconstructionManifest),
      restoration: deepClone(settlement.restoration),
      lastError: deepClone(settlement.lastError),
      originalSourcesDeleted: false,
      reconstructable: true,
    };
  }

  worker1Receipts({settlementId} = {}) {
    const read = this.settlementReadModel({settlementId});
    const restoration = read.restoration || null;
    return {
      kind: 'LoreWorker1SettlementReceipts',
      contractVersion: 1,
      settlementId: read.settlementId,
      storyScope: deepClone(read.storyScope || null),
      revisionEvents: [
        ...read.revisionEvents,
        ...(restoration?.revisionEvents || []),
      ],
      invalidationReceipts: [
        ...read.invalidationReceipts,
        ...(restoration?.invalidationReceipts || []),
      ],
      studyObligationIds: unique([
        ...read.receipts.map((row) => row.studyObligationId),
        ...((restoration?.receipts || []).map((row) => row.studyObligationId)),
      ]),
      unrelatedSourcesInvalidated: false,
    };
  }

  snapshot() {
    return {
      kind: 'LoreAuthoringLifecycleSnapshot',
      contractVersion: 1,
      sequence: this.sequence,
      decisionSequence: this.decisionSequence,
      sessions: [...this.sessions.values()].map(deepClone),
      settlements: [...this.settlements.values()].map(deepClone),
    };
  }

  restore(snapshot) {
    this.sequence = Number(snapshot?.sequence || 0);
    this.decisionSequence = Number(snapshot?.decisionSequence || 0);
    this.sessions = new Map((snapshot?.sessions || []).map((row) => [row.id, deepClone(row)]));
    this.settlements = new Map((snapshot?.settlements || []).map((row) => [row.id, deepClone(row)]));
  }
}
