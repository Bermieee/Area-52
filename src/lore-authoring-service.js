import {deepClone} from './lore-contracts.js';
import {
  LoreAuthoringStage,
  LoreOperatorDecision,
  LoreReviewState,
  LoreSettlementState,
  normalizeLoreAuthoringError,
  safeOperatorResult,
  sourceRevisionIdentity,
} from './lore-authoring-contracts.js';
import {LoreSemanticCompiler} from './lore-semantic-authoring.js';
import {LoreStructurePlanner} from './lore-structure-planner.js';
import {LoreMergePreviewer} from './lore-merge-preview.js';
import {LoreAuthoringLifecycle} from './lore-authoring-lifecycle.js';

export class LoreAuthoringService {
  constructor({intelligence, lifecycleSnapshot = null} = {}) {
    if (!intelligence) throw new TypeError('LoreAuthoringService requires LoreIntelligenceService');
    this.intelligence = intelligence;
    this.semantic = new LoreSemanticCompiler({intelligence});
    this.structure = new LoreStructurePlanner({intelligence});
    this.merge = new LoreMergePreviewer({intelligence});
    this.lifecycle = new LoreAuthoringLifecycle({
      intelligence,
      semantic: this.semantic,
      structure: this.structure,
      merge: this.merge,
      snapshot: lifecycleSnapshot,
    });
  }

  sourceDiscoveryIdentity({lorebookId = null} = {}) {
    const registry = this.intelligence.runtime.registry;
    const snapshot = registry.snapshot();
    const books = (snapshot.books || [])
      .filter((book) => lorebookId == null || book.id === String(lorebookId))
      .map((book) => {
        const discovery = deepClone(book.metadata?.discovery
          || (this.intelligence.lastAcceptance?.lorebookId === book.id
            ? this.intelligence.lastAcceptance.discovery
            : null));
        const sources = registry.listEntries({includeRemoved: true})
          .filter((source) => source.lorebookId === book.id)
          .map((source) => sourceRevisionIdentity(registry, source.sourceId));
        return {
          kind: 'LorebookDiscoveryIdentity',
          lorebookId: book.id,
          title: book.title,
          discovery,
          discoveryIdentityPersisted: Boolean(discovery),
          sources,
        };
      });
    return {
      kind: 'LoreSourceDiscoverySurface',
      contractVersion: 1,
      books,
      exactSourceIdentityRequired: true,
      fallbackLorebookIdentityAllowed: false,
      mutationAuthority: false,
    };
  }

  editImpactPreview(request) {
    return this.semantic.previewEdit(request);
  }

  semanticChangeReport(request) {
    return this.semantic.semanticChangeReport(request);
  }

  treeProposal(request = {}) {
    return this.structure.plan(request);
  }

  mergePreview(request) {
    return this.merge.preview(request);
  }

  startTreeBuild(request = {}) {
    return this.lifecycle.startTreeBuild(request);
  }

  startMergeBuild(request) {
    return this.lifecycle.startMergeBuild(request);
  }

  resumeAuthoringBuild(request) {
    return this.lifecycle.resumeBuild(request);
  }

  draftReview(request) {
    return this.lifecycle.draftReview(request);
  }

  recordDraftDecision(request) {
    return this.lifecycle.recordDecision(request);
  }

  reclassifyAfterTaxonomyEdit(request) {
    return this.lifecycle.reclassifyAfterTaxonomyEdit(request);
  }

  computeFinalPreview(request) {
    return this.lifecycle.computeFinalPreview(request);
  }

  approveFinalPreview(request) {
    return this.lifecycle.approveFinalPreview(request);
  }

  applySettlement(request) {
    return this.lifecycle.applySettlement(request);
  }

  restoreSettlement(request) {
    return this.lifecycle.restoreSettlement(request);
  }

  authoringProgress(sessionId) {
    return this.lifecycle.progress(sessionId);
  }

  settlementReadModel(request) {
    return this.lifecycle.settlementReadModel(request);
  }

  worker1SettlementReceipts(request) {
    return this.lifecycle.worker1Receipts(request);
  }

  reviewStateContract() {
    return {
      kind: 'LoreAuthoringReviewStateContract',
      contractVersion: 2,
      states: Object.values(LoreReviewState),
      reviewStates: Object.values(LoreReviewState),
      operatorDecisions: Object.values(LoreOperatorDecision),
      authoringStages: Object.values(LoreAuthoringStage),
      settlementStates: Object.values(LoreSettlementState),
      lifecycle: [
        'PROPOSAL_BUILD',
        'DRAFT_REVIEW',
        'FINAL_PREVIEW',
        'EXPLICIT_APPROVAL',
        'SETTLEMENT',
        'OPTIONAL_RESTORATION',
      ],
      destructiveMutationRequires: [
        'AUTHORITATIVE_SEMANTIC_PREFLIGHT',
        'CURRENT_SOURCE_AND_DEPENDENCY_FENCES',
        'DETERMINISTIC_VALIDATION_PASS',
        'EXPLICIT_OPERATOR_APPROVAL',
      ],
      proposalStatesGrantMutationAuthority: false,
      modelSuggestionMutationAuthority: false,
      similarityScoreMutationAuthority: false,
      treePlacementTruthAuthority: false,
    };
  }

  worker1InvalidationContract() {
    return {
      kind: 'LoreSourceRevisionRetrievalInvalidationContract',
      contractVersion: 2,
      sourceRevisionIdentity: {
        key: ['sourceId', 'sourceRevisionId'],
        exactSourceHashField: 'contentHash',
        authoredRevisionIsImmutable: true,
        currentRevisionMayReplacePriorRevision: true,
      },
      editEvent: {
        kind: 'LoreSourceRevisionChanged',
        requiredFields: [
          'sourceId',
          'lorebookId',
          'uid',
          'previousSourceRevisionId',
          'sourceRevisionId',
          'contentHash',
        ],
      },
      revisionChangeEvent: {
        kind: 'LoreSourceRevisionChanged',
        requiredFields: [
          'settlementId',
          'operationKind',
          'sourceId',
          'lorebookId',
          'uid',
          'previousSourceRevisionId',
          'sourceRevisionId',
          'sourceState',
          'contentHash',
          'exactFingerprint',
          'studyObligationId',
          'studyTrigger',
        ],
        restorationField: 'restoration',
      },
      invalidationPlan: {
        requiredFields: ['sourceId', 'fromRevisionId', 'toRevisionId', 'targets'],
        targetKinds: [
          'STUDY_ARTIFACTS',
          'REPRESENTATIONS',
          'ONTOLOGY',
          'NAVIGATION_SUMMARIES',
          'RETRIEVAL_INDEX',
        ],
        minimalityRule: 'Invalidate only artifacts fenced by the changed source revision and aggregates that explicitly depend on it.',
        unrelatedSourceArtifactsRemainReusable: true,
        retrievalMustFenceSourceRevision: true,
      },
      invalidationReceipt: {
        kind: 'LoreInvalidationReceipt',
        requiredFields: [
          'settlementId',
          'sourceId',
          'fromRevisionId',
          'toRevisionId',
          'targets',
          'unrelatedSourcesInvalidated',
          'authoritativePreflight',
        ],
        targetKinds: [
          'STUDY_ARTIFACTS',
          'REPRESENTATIONS',
          'ONTOLOGY',
          'NAVIGATION_SUMMARIES',
          'RETRIEVAL_INDEX',
        ],
        minimalityRule: 'Invalidate only changed source revisions and semantic/navigation aggregates that explicitly depend on them.',
        unrelatedSourceArtifactsRemainReusable: true,
        retrievalMustFenceSourceRevision: true,
        newMergeOutputCreatesNewSourceObligation: true,
        treeSettlementCollapsesToOneRevisionPerAffectedSource: true,
      },
      backlog: {
        owner: 'LoreStudyRuntime',
        newSourceTrigger: 'NEW_UID',
        changedSourceTrigger: 'CHANGED_UID',
        removedSourceTrigger: 'REMOVED_UID',
        resumableAfterSnapshotRestore: true,
        authoringCreatesNoSecondStudyQueue: true,
      },
      safeError: {
        kind: 'LoreAuthoringError',
        requiredFields: ['code', 'message', 'details', 'retryable', 'safe'],
      },
      integrationStatus: 'PUBLISHED_NOT_CLAIMED_WIRED',
    };
  }

  worker3AuthoringContract() {
    return {
      kind: 'LoreAuthoringOperatorContract',
      contractVersion: 2,
      readModels: {
        sourceDiscoveryIdentity: 'LoreSourceDiscoverySurface',
        progress: 'LoreAuthoringProgressReadModel',
        draftReview: 'LoreDraftReview',
        finalPreview: 'LoreFinalPreview',
        settlement: 'LoreSettlementReadModel',
        worker1Receipts: 'LoreWorker1SettlementReceipts',
      },
      actions: [
        'startTreeBuild',
        'startMergeBuild',
        'resumeAuthoringBuild',
        'recordDraftDecision',
        'reclassifyAfterTaxonomyEdit',
        'computeFinalPreview',
        'approveFinalPreview',
        'applySettlement',
        'restoreSettlement',
      ],
      explicitOperatorDecisionRequired: true,
      finalPreviewApprovalRequired: true,
      stalePreviewReturnsToDraftReview: true,
      checkpointResumeSupported: true,
      restorationSupported: true,
      safeErrors: true,
      uiImplementationOwner: 'Worker 3',
      integrationStatus: 'BACKEND_CONTRACT_ONLY_NOT_WORKER3_WIRED',
    };
  }

  operatorContract() {
    const safe = (fn) => (...args) => safeOperatorResult(() => fn(...args));
    const read = Object.freeze({
      sourceDiscoveryIdentity: safe((request = {}) => this.sourceDiscoveryIdentity(request)),
      reviewStates: safe(() => this.reviewStateContract()),
      worker1InvalidationContract: safe(() => this.worker1InvalidationContract()),
      worker3AuthoringContract: safe(() => this.worker3AuthoringContract()),
      progress: safe((request) => this.authoringProgress(request?.sessionId)),
      draftReview: safe((request) => this.draftReview(request)),
      finalPreview: safe((request) => this.lifecycle.finalPreview(request)),
      settlement: safe((request) => this.settlementReadModel(request)),
      worker1Receipts: safe((request) => this.worker1SettlementReceipts(request)),
    });
    const actions = Object.freeze({
      previewEditImpact: safe((request) => this.editImpactPreview(request)),
      semanticChangeReport: safe((request) => this.semanticChangeReport(request)),
      proposeTree: safe((request = {}) => this.treeProposal(request)),
      previewMerge: safe((request) => this.mergePreview(request)),
      startTreeBuild: safe((request = {}) => this.startTreeBuild(request)),
      startMergeBuild: safe((request) => this.startMergeBuild(request)),
      resumeAuthoringBuild: safe((request) => this.resumeAuthoringBuild(request)),
      recordDraftDecision: safe((request) => this.recordDraftDecision(request)),
      reclassifyAfterTaxonomyEdit: safe((request) => this.reclassifyAfterTaxonomyEdit(request)),
      computeFinalPreview: safe((request) => this.computeFinalPreview(request)),
      approveFinalPreview: safe((request) => this.approveFinalPreview(request)),
      applySettlement: safe((request) => this.applySettlement(request)),
      restoreSettlement: safe((request) => this.restoreSettlement(request)),
    });
    return Object.freeze({
      kind: 'LoreAuthoringOperatorContract',
      contractVersion: 2,
      read,
      actions,
      destructiveMergeApply: null,
      destructiveTreeApply: null,
      exactSourceMutationAuthority: false,
      safeErrorShape: normalizeLoreAuthoringError(new Error('example')).kind,
      integrationStatus: 'BACKEND_CONTRACT_ONLY_NOT_WORKER3_WIRED',
    });
  }

  snapshot() {
    return {
      kind: 'LoreAuthoringServiceSnapshot',
      contractVersion: 1,
      lifecycle: this.lifecycle.snapshot(),
    };
  }

  static fromSnapshot(snapshot, {intelligence} = {}) {
    if (!snapshot || snapshot.kind !== 'LoreAuthoringServiceSnapshot') {
      throw new TypeError('Lore Authoring snapshot is required');
    }
    return new LoreAuthoringService({
      intelligence,
      lifecycleSnapshot: snapshot.lifecycle,
    });
  }
}

export function createLoreAuthoringService(intelligence) {
  return new LoreAuthoringService({intelligence});
}
