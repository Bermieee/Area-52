import {deepClone} from './lore-contracts.js';
import {
  LoreReviewState,
  normalizeLoreAuthoringError,
  safeOperatorResult,
  sourceRevisionIdentity,
} from './lore-authoring-contracts.js';
import {LoreSemanticCompiler} from './lore-semantic-authoring.js';
import {LoreStructurePlanner} from './lore-structure-planner.js';
import {LoreMergePreviewer} from './lore-merge-preview.js';

export class LoreAuthoringService {
  constructor({intelligence} = {}) {
    if (!intelligence) throw new TypeError('LoreAuthoringService requires LoreIntelligenceService');
    this.intelligence = intelligence;
    this.semantic = new LoreSemanticCompiler({intelligence});
    this.structure = new LoreStructurePlanner({intelligence});
    this.merge = new LoreMergePreviewer({intelligence});
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

  reviewStateContract() {
    return {
      kind: 'LoreAuthoringReviewStateContract',
      contractVersion: 1,
      states: Object.values(LoreReviewState),
      destructiveMutationRequires: ['DETERMINISTIC_VALIDATION_PASS', 'EXPLICIT_OPERATOR_APPROVAL'],
      proposalStatesGrantMutationAuthority: false,
    };
  }

  worker1InvalidationContract() {
    return {
      kind: 'LoreSourceRevisionRetrievalInvalidationContract',
      contractVersion: 1,
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
      safeError: {
        kind: 'LoreAuthoringError',
        requiredFields: ['code', 'message', 'details', 'retryable', 'safe'],
      },
      integrationStatus: 'PUBLISHED_NOT_CLAIMED_WIRED',
    };
  }

  operatorContract() {
    const safe = (fn) => (...args) => safeOperatorResult(() => fn(...args));
    const read = Object.freeze({
      sourceDiscoveryIdentity: safe((request = {}) => this.sourceDiscoveryIdentity(request)),
      reviewStates: safe(() => this.reviewStateContract()),
      worker1InvalidationContract: safe(() => this.worker1InvalidationContract()),
    });
    const actions = Object.freeze({
      previewEditImpact: safe((request) => this.editImpactPreview(request)),
      semanticChangeReport: safe((request) => this.semanticChangeReport(request)),
      proposeTree: safe((request = {}) => this.treeProposal(request)),
      previewMerge: safe((request) => this.mergePreview(request)),
    });
    return Object.freeze({
      kind: 'LoreAuthoringOperatorContract',
      contractVersion: 1,
      read,
      actions,
      destructiveMergeApply: null,
      destructiveTreeApply: null,
      exactSourceMutationAuthority: false,
      safeErrorShape: normalizeLoreAuthoringError(new Error('example')).kind,
      integrationStatus: 'BACKEND_CONTRACT_ONLY_NOT_WORKER3_WIRED',
    });
  }
}

export function createLoreAuthoringService(intelligence) {
  return new LoreAuthoringService({intelligence});
}
