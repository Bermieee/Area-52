import {deepClone, StudyState} from './lore-contracts.js';
import {LoreStudyRuntime} from './lore-study-runtime.js';
import {LoreMultiResolutionSystem} from './lore-multi-resolution.js';
import {LoreRepresentationRegistry} from './lore-representation-registry.js';
import {LoreWorldOntology} from './lore-world-ontology.js';
import {LoreHierarchyRetrievalSystem} from './lore-hierarchy-retrieval-system.js';
import {QualityStatus, RepresentationProfile} from './lore-representation-contracts.js';
import {LoreStoryAuthorityRegistry} from './lore-story-authority.js';

const MAX_SCOPE_RECEIPTS = 64;

const REQUIRED_PROFILES = Object.freeze([
  RepresentationProfile.LEAN,
  RepresentationProfile.BALANCED,
  RepresentationProfile.HEAVY,
]);

function assertDiscoveredLorebook(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Lorebook snapshot is required');
  if (input.id === undefined || input.id === null || String(input.id).trim() === '') {
    const error = new TypeError('Discovered Lorebook id is required');
    error.code = 'LORE_DISCOVERY_ID_REQUIRED';
    throw error;
  }
  const discovery = input.discovery || input.origin || null;
  if (!discovery || typeof discovery !== 'object') {
    const error = new TypeError('Worker 3 discovery receipt is required for Lore acceptance');
    error.code = 'LORE_DISCOVERY_RECEIPT_REQUIRED';
    throw error;
  }
  if (String(input.id) === 'operator-lore') {
    const error = new TypeError('Fallback operator-lore id is not an accepted discovered Lorebook identity');
    error.code = 'LORE_DISCOVERY_DEFAULT_ID_REJECTED';
    throw error;
  }
  if (!Array.isArray(input.entries)) {
    const error = new TypeError('Discovered Lorebook entries are required');
    error.code = 'LORE_DISCOVERY_ENTRIES_REQUIRED';
    throw error;
  }
  const ids = new Set();
  const entries = input.entries.map((entry, index) => {
    if (!entry || entry.uid === undefined || entry.uid === null || String(entry.uid).trim() === '') {
      const error = new TypeError('Lore entry ' + (index + 1) + ' requires its SillyTavern UID');
      error.code = 'LORE_DISCOVERY_UID_REQUIRED';
      throw error;
    }
    if (typeof entry.content !== 'string') {
      const error = new TypeError('Lore entry ' + String(entry.uid) + ' requires exact authored text');
      error.code = 'LORE_DISCOVERY_CONTENT_REQUIRED';
      throw error;
    }
    const uid = String(entry.uid);
    if (ids.has(uid)) {
      const error = new TypeError('Duplicate Lore UID in discovered snapshot: ' + uid);
      error.code = 'LORE_DISCOVERY_DUPLICATE_UID';
      throw error;
    }
    ids.add(uid);
    return {
      uid,
      content: entry.content,
      metadata: deepClone(entry.metadata || {}),
    };
  });
  return {
    id: String(input.id),
    title: input.title == null ? String(input.id) : String(input.title),
    metadata: deepClone(input.metadata || {}),
    discovery: deepClone(discovery),
    entries,
    fullSnapshot: input.fullSnapshot !== false,
  };
}

function profileSummary(selection) {
  return (selection?.available || []).map((row) => ({
    profile: row.profile,
    representationRef: row.representationRef,
    sourceRevisionId: row.sourceRevisionId,
    representationRevision: row.representationRevision,
    qualityStatus: row.qualityStatus,
    size: deepClone(row.size),
  }));
}

function requiredProfilesReady(selection) {
  const byProfile = new Map((selection?.available || []).map((row) => [row.profile, row]));
  return REQUIRED_PROFILES.every((profile) => byProfile.get(profile)?.qualityStatus === QualityStatus.PASS);
}

function operatorStateFor({entry, compileFailure = null, representationReady = false, retrievalReady = false}) {
  if (entry.sourceState === 'REMOVED') return 'REMOVED';
  if (compileFailure) return 'FAILED';
  if (entry.operatorState === 'FAILED') return 'FAILED';
  if (entry.operatorState === 'READY' && representationReady && retrievalReady) return 'READY';
  if (entry.operatorState === 'ACCEPTED') return 'ACCEPTED';
  return 'STUDYING';
}

export class LoreIntelligenceService {
  constructor({
    runtime = new LoreStudyRuntime(),
    multiResolution = null,
    hierarchy = null,
    ontology = null,
    storyAuthority = null,
  } = {}) {
    this.runtime = runtime;
    this.multiResolution = multiResolution || new LoreMultiResolutionSystem({runtime});
    this.hierarchy = hierarchy || new LoreHierarchyRetrievalSystem({runtime});
    this.ontology = ontology || new LoreWorldOntology({runtime});
    this.storyAuthority = storyAuthority || new LoreStoryAuthorityRegistry();
    this.compileFailures = new Map();
    this.lastAcceptance = null;
    this.lastStudyRun = null;
    this.lastStoryQuery = null;
  }

  recordHostDiscovery({chatId, lorebookId, title = null, discovery = null, hostSelectionRevision = null} = {}) {
    return this.storyAuthority.recordDiscovery({chatId, lorebookId, title, discovery, hostSelectionRevision});
  }

  setStoryReadScope({chatId, lorebookIds = []} = {}) {
    return this.storyAuthority.setReadScope({chatId, lorebookIds});
  }

  _rememberStoryQuery(packet) {
    const receipt = {
      kind: 'LoreProducerQueryReceipt',
      contractVersion: 1,
      chatId: packet?.storyScope?.chatId ?? null,
      status: packet?.status ?? null,
      reason: packet?.reason ?? null,
      retrievalIntentId: packet?.retrievalIntentId ?? null,
      indexRevision: packet?.indexRevision ?? null,
      ontologyRevision: packet?.ontologyRevision ?? null,
      sourceRevisionFence: [...(packet?.sourceRevisionFence || [])].slice(0, MAX_SCOPE_RECEIPTS),
      candidateReceipts: (packet?.candidateReceipts || []).slice(0, MAX_SCOPE_RECEIPTS).map((row) => ({
        candidateId: row.candidateId ?? null,
        retrievalRecordRef: row.retrievalRecordRef ?? null,
        sourceEntries: deepClone(row.sourceEntries || []).slice(0, 16),
        sourceRevisionRefs: [...(row.sourceRevisionRefs || [])].slice(0, 32),
        evidenceRefs: [...(row.evidenceRefs || [])].slice(0, 32),
        authorityScope: deepClone(row.authorityScope || null),
        authorityClass: row.authorityClass ?? null,
        truthStatusHint: row.truthStatusHint ?? null,
        temporalHints: deepClone(row.temporalHints || []).slice(0, 16),
        decision: row.decision ?? null,
        reason: row.reason ?? null,
        normalizedRank: row.normalizedRank ?? null,
        rawLoreIncluded: false,
      })),
      exclusionReceipts: (packet?.exclusionReceipts || []).slice(0, MAX_SCOPE_RECEIPTS).map((row) => ({
        sourceId: row.sourceId ?? null,
        lorebookId: row.lorebookId ?? null,
        uid: row.uid ?? null,
        sourceRevisionId: row.sourceRevisionId ?? null,
        authorityScope: deepClone(row.authorityScope || null),
        decision: row.decision ?? 'EXCLUDED',
        reason: row.reason ?? null,
      })),
      rawLoreIncluded: false,
      truthGateAuthority: false,
      gatherAuthority: false,
      contextSealAuthority: false,
      promptPlanAuthority: false,
      hostDeliveryAuthority: false,
    };
    this.lastStoryQuery = deepClone(receipt);
    return packet;
  }

  acceptLorebook(input) {
    const requestedChatId = input?.chatId ?? input?.storyScope?.chatId ?? input?.discovery?.chatId ?? null;
    const book = assertDiscoveredLorebook(input);
    const before = new Map();
    for (const source of this.runtime.registry.listEntries({includeRemoved: true})) {
      if (source.lorebookId !== book.id) continue;
      const revision = this.runtime.registry.currentRevision(source.sourceId, {allowMissing: true});
      before.set(source.sourceId, {
        sourceRevisionId: revision?.id || null,
        learnedRevisionId: this.runtime.store.currentLearnedRevision(source.sourceId)?.id || null,
        representationIds: this.multiResolution.registry.activeForSource(source.sourceId, this.runtime.registry).map((row) => row.id),
      });
    }

    const results = this.runtime.ingestLorebook({
      ...book,
      metadata: {
        ...deepClone(book.metadata || {}),
        discovery: deepClone(book.discovery),
      },
    });
    const sourceRevisionChanged = results.some((row) => Boolean(row.changed));
    const staleRepresentationIds = sourceRevisionChanged ? this.multiResolution.refreshFreshness() : [];
    if (sourceRevisionChanged || !this.hierarchy.hierarchy) {
      this.ontology.rebuild();
      this.hierarchy.refreshHierarchy();
      this.hierarchy.refreshRetrieval();
    }

    const changes = results.map((row) => {
      const sourceId = row.source.sourceId;
      const previous = before.get(sourceId) || null;
      const current = this.runtime.registry.currentRevision(sourceId, {allowMissing: true});
      const obligation = row.obligation || this.runtime.findObligation(current?.id);
      const affectedRepresentations = staleRepresentationIds
        .filter((id) => this.multiResolution.registry.get(id)?.sourceId === sourceId);
      return {
        sourceId,
        uid: row.source.uid,
        changed: row.changed,
        previousSourceRevisionId: row.previousRevision?.id || previous?.sourceRevisionId || null,
        sourceRevisionId: current?.id || null,
        sourceState: current?.state || null,
        exactContentHash: current?.contentHash || null,
        studyObligationId: obligation?.id || null,
        studyState: obligation?.state || null,
        invalidatedRepresentationIds: affectedRepresentations,
        unaffectedOtherSourcesRemainCurrent: true,
      };
    });

    let storyScope = requestedChatId == null ? null : this.storyAuthority.scopeReceipt(requestedChatId);
    if (requestedChatId != null) {
      if (!storyScope.discoveredLorebooks.some((row) => row.lorebookId === book.id)) {
        this.storyAuthority.recordDiscovery({
          chatId: requestedChatId,
          lorebookId: book.id,
          title: book.title,
          discovery: book.discovery,
          hostSelectionRevision: book.discovery?.hostSelectionRevision ?? null,
        });
      }
      storyScope = this.storyAuthority.acceptForStudy({
        chatId: requestedChatId,
        lorebookId: book.id,
        sourceRevisionFence: changes.map((row) => ({
          lorebookId: book.id,
          sourceId: row.sourceId,
          sourceRevisionId: row.sourceRevisionId,
        })),
        enableRead: true,
      });
    }
    for (const change of changes.filter((row) => row.changed && row.sourceRevisionId)) {
      this.storyAuthority.recordRevisionChange({
        sourceId: change.sourceId,
        lorebookId: book.id,
        previousSourceRevisionId: change.previousSourceRevisionId,
        sourceRevisionId: change.sourceRevisionId,
        sourceState: change.sourceState,
        origin: 'LOREBOOK_ACCEPTANCE_SOURCE_CHANGE',
      });
    }
    if (requestedChatId != null) storyScope = this.storyAuthority.scopeReceipt(requestedChatId);

    const receipt = {
      kind: 'LoreSourceAcceptanceReceipt',
      contractVersion: 1,
      lorebookId: book.id,
      title: book.title,
      discovery: deepClone(book.discovery),
      fullSnapshot: book.fullSnapshot,
      acceptedEntryCount: book.entries.length,
      exactSourcePreserved: true,
      sourceMutationByStudy: false,
      changes,
      sourceRevisionChanged,
      maintenancePerformed: sourceRevisionChanged,
      maintenanceReason: sourceRevisionChanged ? 'SOURCE_REVISION_CHANGED' : 'NO_SOURCE_REVISION_CHANGE',
      dueStudyObligations: this.runtime.dueObligations().filter((row) => changes.some((change) => change.sourceId === row.sourceId)).length,
      storyScope: deepClone(storyScope),
      status: this.status({chatId: requestedChatId}),
    };
    this.lastAcceptance = deepClone(receipt);
    return receipt;
  }

  runStudy({scope = 'DUE', maxUnitsPerObligation = Infinity, rebuildRetrieval = true} = {}) {
    if (scope !== 'DUE') throw new TypeError('LoreIntelligenceService currently supports scope=DUE');
    const results = [];
    const compilations = [];
    for (const due of this.runtime.dueObligations()) {
      const result = this.runtime.run(due.id, {maxUnits: maxUnitsPerObligation});
      results.push(result);
      const learned = result.learnedRevision;
      if (!learned || learned.state !== 'CURRENT') continue;
      try {
        const family = this.multiResolution.compileFamily({sourceId: learned.sourceId});
        const failures = Object.entries(family)
          .filter(([, row]) => row?.status !== QualityStatus.PASS)
          .map(([profile, row]) => ({profile, failure: row?.failure || 'REPRESENTATION_COMPILE_FAILED'}));
        if (failures.length) {
          this.compileFailures.set(learned.sourceId, failures);
        } else {
          this.compileFailures.delete(learned.sourceId);
        }
        compilations.push({
          sourceId: learned.sourceId,
          sourceRevisionId: learned.sourceRevisionId,
          learnedRevisionId: learned.id,
          semanticDiff: deepClone(learned.semanticDiff),
          profiles: Object.fromEntries(Object.entries(family).map(([profile, row]) => [profile, {
            status: row.status,
            failure: row.failure || null,
            representationRef: row.representation?.id || null,
            sourceRevisionId: row.representation?.sourceRevisionId || learned.sourceRevisionId,
            retentionReceipt: deepClone(row.qualityReceipt || null),
            reused: Boolean(row.reused),
          }])),
        });
      } catch (error) {
        this.compileFailures.set(learned.sourceId, [{
          profile: 'FAMILY',
          failure: String(error?.code || error?.message || error),
        }]);
        compilations.push({
          sourceId: learned.sourceId,
          sourceRevisionId: learned.sourceRevisionId,
          learnedRevisionId: learned.id,
          semanticDiff: deepClone(learned.semanticDiff),
          profiles: {},
          failure: String(error?.message || error),
        });
      }
    }

    const maintenancePerformed = results.length > 0;
    const ontology = maintenancePerformed ? this.ontology.rebuild() : this.ontology.current();
    let retrieval = this.hierarchy.diagnostics();
    if (rebuildRetrieval && maintenancePerformed) {
      this.hierarchy.rebuild();
      retrieval = this.hierarchy.diagnostics();
    }

    const receipt = {
      kind: 'LoreStudyRunReceipt',
      contractVersion: 1,
      requested: results.length,
      results: deepClone(results),
      compilations,
      retrieval,
      ontology,
      maintenancePerformed,
      maintenanceReason: maintenancePerformed ? 'DUE_STUDY_PROCESSED' : 'NO_DUE_STUDY',
      status: this.status(),
    };
    this.lastStudyRun = deepClone(receipt);
    return receipt;
  }

  retryStudy({obligationId = null, sourceId = null, run = false, maxUnitsPerObligation = Infinity} = {}) {
    let id = obligationId;
    if (!id && sourceId) {
      const revision = this.runtime.registry.currentRevision(sourceId, {allowMissing: true});
      id = revision ? this.runtime.findObligation(revision.id)?.id : null;
    }
    if (!id) throw new Error('Lore retry requires obligationId or sourceId');
    const obligation = this.runtime.retry(id);
    const receipt = {
      kind: 'LoreStudyRetryReceipt',
      obligation,
      runRequested: Boolean(run),
    };
    if (run && [StudyState.DUE, StudyState.CHECKPOINTED, StudyState.PENDING].includes(obligation.state)) {
      receipt.run = this.runStudy({maxUnitsPerObligation});
    }
    return receipt;
  }

  status({chatId = null} = {}) {
    const surface = this.runtime.publicSurface();
    const retrievalStatus = this.hierarchy.retrievalIndex.status();
    const storyScope = chatId == null ? null : this.storyAuthority.scopeReceipt(chatId);
    const acceptedLorebookIds = new Set((storyScope?.acceptedForStudy || []).map((row) => row.lorebookId));
    const readLorebookIds = new Set(storyScope?.readLorebookIds || []);
    const entries = surface.entries.map((entry) => {
      const selection = entry.sourceState === 'REMOVED'
        ? null
        : this.multiResolution.selection({sourceId: entry.sourceId});
      const representationReady = entry.sourceState !== 'REMOVED' && requiredProfilesReady(selection);
      const retrievalReady = entry.sourceState !== 'REMOVED'
        && Boolean(this.hierarchy.retrievalIndex.sourceRecordIds.get(entry.sourceId));
      const compileFailure = this.compileFailures.get(entry.sourceId) || null;
      return {
        sourceId: entry.sourceId,
        lorebookId: entry.lorebookId,
        uid: entry.uid,
        sourceRevisionId: entry.sourceRevisionId,
        sourceState: entry.sourceState,
        exactSourceHash: entry.exactSource?.contentHash || null,
        exactSourceRecoverable: Boolean(entry.exactSource),
        learnedRevisionId: entry.learnedRevisionId,
        freshness: entry.freshness,
        studyObligationId: entry.studyObligationId,
        studyState: entry.studyState,
        studyAttempts: entry.studyAttempts,
        studyError: deepClone(entry.studyError),
        semanticDiff: deepClone(entry.semanticDiff),
        artifactIds: [...(entry.artifactIds || [])],
        retrievalRepresentations: deepClone(entry.retrievalRepresentations || []),
        representations: profileSummary(selection),
        representationReady,
        retrievalReady,
        acceptedForStudy: storyScope == null ? null : acceptedLorebookIds.has(entry.lorebookId),
        authorizedForStory: storyScope == null ? null : (acceptedLorebookIds.has(entry.lorebookId) && readLorebookIds.has(entry.lorebookId)),
        eligibleForStoryRetrieval: storyScope == null ? null : (
          entry.freshness === 'CURRENT'
          && retrievalReady
          && acceptedLorebookIds.has(entry.lorebookId)
          && readLorebookIds.has(entry.lorebookId)
        ),
        compileFailure: deepClone(compileFailure),
        operatorState: operatorStateFor({entry, compileFailure, representationReady, retrievalReady}),
      };
    });

    const counts = {ACCEPTED: 0, STUDYING: 0, READY: 0, FAILED: 0, REMOVED: 0};
    for (const entry of entries) counts[entry.operatorState] = (counts[entry.operatorState] || 0) + 1;
    return {
      kind: 'LoreIntelligenceStatus',
      contractVersion: 1,
      counts,
      entries,
      conflicts: deepClone(surface.conflicts),
      lifecycle: deepClone(surface.lifecycle),
      retrieval: retrievalStatus,
      storyScope: deepClone(storyScope),
      storyAuthorizedReady: storyScope == null ? null : entries.filter((row) => row.eligibleForStoryRetrieval).length,
      ontology: this.ontology.current(),
      exactSourcePreserved: true,
      derivedArtifactsAreCanon: false,
      externalProviderRequired: false,
      externalDatabaseRequired: false,
      orchestrationServiceRequired: false,
    };
  }

  operatorReadModel({chatId = null, maxEntries = 64, maxReceipts = 32} = {}) {
    const entryLimit = Math.max(1, Math.min(128, Math.trunc(Number(maxEntries) || 64)));
    const receiptLimit = Math.max(1, Math.min(64, Math.trunc(Number(maxReceipts) || 32)));
    const status = this.status({chatId});
    const scope = status.storyScope;
    const discovered = new Set((scope?.discoveredLorebooks || []).map((row) => row.lorebookId));
    const lastQuery = this.lastStoryQuery && (
      chatId == null || String(this.lastStoryQuery.chatId ?? '') === String(chatId)
    ) ? this.lastStoryQuery : null;

    const candidatesBySource = new Map();
    for (const receipt of lastQuery?.candidateReceipts || []) {
      for (const source of receipt.sourceEntries || []) {
        if (!source?.sourceId || candidatesBySource.has(source.sourceId)) continue;
        candidatesBySource.set(source.sourceId, receipt);
      }
    }
    const exclusionsBySource = new Map();
    for (const receipt of lastQuery?.exclusionReceipts || []) {
      if (receipt?.sourceId && !exclusionsBySource.has(receipt.sourceId)) exclusionsBySource.set(receipt.sourceId, receipt);
    }

    const entries = status.entries.slice(0, entryLimit).map((row) => {
      const revision = this.runtime.registry.currentRevision(row.sourceId, {allowMissing: true});
      const candidate = candidatesBySource.get(row.sourceId) || null;
      const exclusion = exclusionsBySource.get(row.sourceId) || null;
      const learnedCurrent = row.sourceState !== 'REMOVED'
        && row.freshness === 'CURRENT'
        && Boolean(row.learnedRevisionId);
      return {
        sourceId: row.sourceId,
        lorebookId: row.lorebookId,
        uid: row.uid,
        title: revision?.metadata?.title ?? null,
        treePath: Array.isArray(revision?.metadata?.treePath) ? [...revision.metadata.treePath].slice(0, 24) : [],
        sourceRevisionId: row.sourceRevisionId,
        sourceState: row.sourceState,
        exactSourceHash: row.exactSourceHash,
        exactSourceRecoverable: row.exactSourceRecoverable,
        lifecycle: {
          discoveredForStory: scope == null ? null : discovered.has(row.lorebookId),
          acceptedForStudy: row.acceptedForStudy,
          studiedCurrent: learnedCurrent,
          representationReady: row.representationReady,
          retrievalReady: row.retrievalReady,
          selectedChatAuthorized: row.authorizedForStory,
          eligibleForNomination: row.eligibleForStoryRetrieval,
          producerNomination: candidate ? 'NOMINATED' : exclusion ? 'EXCLUDED' : lastQuery ? 'NOT_NOMINATED' : 'NOT_OBSERVED',
          producerReason: candidate?.reason ?? exclusion?.reason ?? null,
          truthPrecision: 'DOWNSTREAM_NOT_OBSERVED_BY_LORE',
          gather: 'DOWNSTREAM_NOT_OBSERVED_BY_LORE',
          contextSeal: 'DOWNSTREAM_NOT_OBSERVED_BY_LORE',
          promptPlan: 'DOWNSTREAM_NOT_OBSERVED_BY_LORE',
          hostDelivery: 'DOWNSTREAM_NOT_OBSERVED_BY_LORE',
        },
        truthStatusHint: candidate?.truthStatusHint ?? null,
        temporalHints: deepClone(candidate?.temporalHints || []).slice(0, 16),
        studyState: row.studyState,
        compileFailure: deepClone(row.compileFailure),
        operatorState: row.operatorState,
        rawLoreIncluded: false,
      };
    });

    const counts = {
      totalEntries: status.entries.length,
      discoveredLorebooks: scope?.discoveredLorebooks?.length ?? null,
      acceptedLorebooks: scope?.acceptedForStudy?.length ?? null,
      studiedCurrentEntries: status.entries.filter((row) => row.sourceState !== 'REMOVED' && row.freshness === 'CURRENT' && row.learnedRevisionId).length,
      representationReadyEntries: status.entries.filter((row) => row.representationReady).length,
      retrievalReadyEntries: status.entries.filter((row) => row.retrievalReady).length,
      storyAuthorizedEntries: scope == null ? null : status.entries.filter((row) => row.authorizedForStory).length,
      eligibleForNominationEntries: scope == null ? null : status.entries.filter((row) => row.eligibleForStoryRetrieval).length,
      nominatedLastQueryEntries: lastQuery == null ? null : candidatesBySource.size,
      removedEntries: status.entries.filter((row) => row.sourceState === 'REMOVED').length,
      failedEntries: status.entries.filter((row) => row.operatorState === 'FAILED').length,
    };

    return {
      kind: 'LoreOperatorReadModel',
      contractVersion: 1,
      chatId: scope?.chatId ?? (chatId == null ? null : String(chatId)),
      storyScopeState: scope?.state ?? (chatId == null ? null : 'UNBOUND'),
      counts,
      entries,
      entryCountTotal: status.entries.length,
      entriesTruncated: status.entries.length > entries.length,
      recentRevisionChanges: deepClone(scope?.recentRevisionChanges || []).slice(-receiptLimit).map((row) => ({
        receiptId: row.receiptId ?? null,
        lorebookId: row.lorebookId ?? null,
        sourceId: row.sourceId ?? null,
        previousSourceRevisionId: row.previousSourceRevisionId ?? null,
        sourceRevisionId: row.sourceRevisionId ?? null,
        sourceState: row.sourceState ?? null,
        origin: row.origin ?? null,
      })),
      lastAcceptance: this.lastAcceptance ? {
        lorebookId: this.lastAcceptance.lorebookId ?? null,
        acceptedEntryCount: this.lastAcceptance.acceptedEntryCount ?? 0,
        sourceRevisionChanged: Boolean(this.lastAcceptance.sourceRevisionChanged),
        dueStudyObligations: Number(this.lastAcceptance.dueStudyObligations || 0),
        maintenancePerformed: Boolean(this.lastAcceptance.maintenancePerformed),
        maintenanceReason: this.lastAcceptance.maintenanceReason ?? null,
      } : null,
      lastStudyRun: this.lastStudyRun ? {
        requested: Number(this.lastStudyRun.requested || 0),
        compilationCount: (this.lastStudyRun.compilations || []).length,
        maintenancePerformed: Boolean(this.lastStudyRun.maintenancePerformed),
        maintenanceReason: this.lastStudyRun.maintenanceReason ?? null,
        sourceRevisionRefs: [...new Set((this.lastStudyRun.compilations || []).map((row) => row.sourceRevisionId).filter(Boolean))].slice(0, receiptLimit),
      } : null,
      lastProducerQuery: lastQuery ? deepClone({
        status: lastQuery.status,
        reason: lastQuery.reason,
        retrievalIntentId: lastQuery.retrievalIntentId,
        indexRevision: lastQuery.indexRevision,
        sourceRevisionFence: lastQuery.sourceRevisionFence.slice(0, receiptLimit),
        candidateCount: lastQuery.candidateReceipts.length,
        exclusionCount: lastQuery.exclusionReceipts.length,
      }) : null,
      bounds: {maxEntries: entryLimit, maxReceipts: receiptLimit},
      rawLoreIncluded: false,
      sourceMutationAuthority: false,
      truthGateAuthority: false,
      gatherAuthority: false,
      contextSealAuthority: false,
      promptPlanAuthority: false,
      hostDeliveryAuthority: false,
    };
  }

  summarySurface() {
    const scopes = new Map((this.hierarchy.hierarchy?.scopes || []).map((scope) => [scope.id, scope]));
    const summaries = this.hierarchy.summaryRegistry.activeSummaries().map((summary) => {
      const scope = scopes.get(summary.targetScopeId) || null;
      let level = 'TOPIC';
      if (scope?.type === 'LEAF') level = 'ENTRY';
      else if (scope?.type === 'TREE' && (scope.treePath || []).length === 0 && scope.lorebookId) level = 'BOOK';
      else if (scope?.type === 'CORPUS') level = 'CORPUS';
      else if (scope?.type === 'COMMUNITY') level = 'COMMUNITY';
      return {
        summaryRef: summary.id,
        level,
        scopeId: summary.targetScopeId,
        scopeType: summary.targetScopeType,
        label: summary.targetLabel,
        lorebookId: scope?.lorebookId || null,
        sourceRevisionRefs: [...summary.sourceRevisionSet],
        childSummaryRefs: summary.childSummaryDependencies.map((row) => row.summaryId),
        evidenceRefs: [...(summary.criticalEvidenceRefs || [])].slice(0, 64),
        evidenceRefCount: (summary.criticalEvidenceRefs || []).length,
        evidenceRefsTruncated: (summary.criticalEvidenceRefs || []).length > 64,
        rawEvidenceIncluded: false,
        content: summary.content,
        qualityReceipt: deepClone(summary.qualityReceipt),
        provenance: deepClone(summary.provenance),
        authorityClass: summary.authorityClass,
        sourceAuthority: false,
        truthAuthority: false,
        settlementAuthority: false,
      };
    });
    return {
      kind: 'LoreMultiLevelSummarySurface',
      contractVersion: 1,
      summaries,
      counts: summaries.reduce((acc, row) => {
        acc[row.level] = (acc[row.level] || 0) + 1;
        return acc;
      }, {}),
      exactSourceDrillbackAvailable: true,
      evidenceDrillbackAvailable: true,
      rawEvidenceIncluded: false,
      sourceAuthority: false,
      temporalStateAuthority: false,
    };
  }

  queryForStory({chatId, query, intent = 'AUTO', intentId = null, profile = null} = {}) {
    const scope = this.storyAuthority.scopeReceipt(chatId);
    const blocked = (reason) => ({
      kind: 'LoreBrainRetrievalPacket',
      contractVersion: 1,
      status: 'EXCLUDED',
      reason,
      query: String(query || ''),
      intent: String(intent || 'AUTO'),
      retrievalIntentId: intentId,
      indexRevision: this.hierarchy.retrievalIndex.revision,
      ontologyRevision: this.ontology.current().ontologyRevision,
      desiredProfile: profile,
      sourceRevisionFence: [],
      nominations: [],
      candidateReceipts: [],
      exclusionReceipts: [],
      storyScope: deepClone(scope),
      thematicCommunities: [],
      summaries: [],
      conflicts: [],
      provenanceRequired: true,
      exactSourceDrillbackAvailable: true,
      retainedDiagnosticsMetadataOnly: true,
      rawLoreIncludedInDiagnostics: false,
      candidateBusAdmissionAuthority: false,
      truthGateAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    });
    if (scope.state !== 'BOUND') return this._rememberStoryQuery(blocked('LORE_STORY_SCOPE_REQUIRED'));
    const allowedBooks = new Set(this.storyAuthority.allowedLorebookIds(scope.chatId));
    if (!allowedBooks.size) return this._rememberStoryQuery(blocked('LORE_STORY_READ_SCOPE_EMPTY'));

    const allowedSourceIds = [];
    const exclusionReceipts = [];
    for (const source of this.runtime.registry.listEntries({includeRemoved: true})) {
      const current = this.runtime.registry.currentRevision(source.sourceId, {allowMissing: true});
      const learned = this.runtime.store.currentLearnedRevision(source.sourceId);
      let reason = null;
      if (!allowedBooks.has(source.lorebookId)) {
        const accepted = scope.acceptedForStudy.some((row) => row.lorebookId === source.lorebookId);
        reason = accepted ? 'LOREBOOK_OUTSIDE_STORY_READ_SCOPE' : 'LOREBOOK_NOT_ACCEPTED_FOR_STUDY';
      } else if (!current || current.state === 'REMOVED') {
        reason = 'SOURCE_REMOVED';
      } else if (!learned || learned.state !== 'CURRENT' || learned.sourceRevisionId !== current.id) {
        reason = 'SOURCE_REVISION_NOT_LEARNED_CURRENT';
      } else if (!this.hierarchy.retrievalIndex.sourceRecordIds.get(source.sourceId)) {
        reason = 'SOURCE_NOT_RETRIEVAL_READY';
      }
      if (!reason) {
        allowedSourceIds.push(source.sourceId);
        continue;
      }
      if (exclusionReceipts.length < MAX_SCOPE_RECEIPTS) {
        exclusionReceipts.push({
          kind: 'LoreCandidateExclusionReceipt',
          sourceId: source.sourceId,
          lorebookId: source.lorebookId,
          uid: String(source.uid),
          sourceRevisionId: current?.id || null,
          authorityScope: {chatId: scope.chatId, lorebookId: source.lorebookId},
          decision: 'EXCLUDED',
          reason,
          mutationAuthority: false,
          settlementAuthority: false,
          contextSealAuthority: false,
        });
      }
    }

    const result = this.hierarchy.query({query, intent, intentId, allowedSourceIds});
    const desiredProfile = profile || (result.intent === 'BROAD' ? RepresentationProfile.LEAN : RepresentationProfile.HEAVY);
    const candidateReceipts = [];
    const nominations = result.nominations.map((nomination) => {
      const drillback = this.hierarchy.drillDown(nomination)
        .filter((source) => allowedSourceIds.includes(source.sourceId))
        .map((source) => {
          const selection = this.multiResolution.selection({sourceId: source.sourceId, desiredProfile});
          return {
            ...source,
            selectedRepresentation: deepClone(selection.requestedMatch),
            availableRepresentations: profileSummary(selection),
          };
        });
      if (candidateReceipts.length < MAX_SCOPE_RECEIPTS) {
        candidateReceipts.push({
          kind: 'LoreCandidateProvenanceReceipt',
          candidateId: nomination.candidateId,
          retrievalRecordRef: nomination.metadata?.retrievalRecordRef || null,
          sourceEntries: drillback.slice(0, 16).map((source) => ({
            sourceId: source.sourceId,
            lorebookId: source.lorebookId,
            uid: source.uid,
            sourceRevisionId: source.sourceRevisionId,
            truthStatusHint: source.truthStatusHint ?? null,
          })),
          sourceRevisionRefs: [...new Set(drillback.map((source) => source.sourceRevisionId).filter(Boolean))].sort(),
          evidenceRefs: [...(nomination.evidenceRefs || [])].slice(0, 32),
          provenanceRefs: (nomination.provenance || []).slice(0, 16).map((row) => row?.sourceRevisionId ?? row?.ref ?? row?.sourceId ?? null).filter(Boolean),
          authorityScope: {chatId: scope.chatId, lorebookIds: [...allowedBooks].sort()},
          authorityClass: nomination.authorityClass,
          truthStatusHint: nomination.truthStatusHint ?? null,
          temporalHints: deepClone(nomination.temporalHints || []).slice(0, 16),
          decision: 'ELIGIBLE',
          reason: 'AUTHORIZED_CURRENT_RETRIEVAL_MATCH',
          normalizedRank: nomination.normalizedRank ?? null,
          mutationAuthority: false,
          settlementAuthority: false,
          contextSealAuthority: false,
          rawLoreIncluded: false,
        });
      }
      return {nomination: deepClone(nomination), drillback};
    }).filter((row) => row.drillback.length > 0);
    const sourceRevisionFence = [...new Set(nominations.flatMap((row) => row.drillback.map((source) => source.sourceRevisionId)))].sort();
    const packet = {
      kind: 'LoreBrainRetrievalPacket',
      contractVersion: 1,
      status: 'ELIGIBLE',
      reason: nominations.length ? 'AUTHORIZED_CURRENT_RETRIEVAL_MATCH' : 'NO_AUTHORIZED_RETRIEVAL_MATCH',
      query: result.query,
      intent: result.intent,
      retrievalIntentId: result.retrievalIntentId,
      indexRevision: result.indexRevision,
      ontologyRevision: this.ontology.current().ontologyRevision,
      desiredProfile,
      sourceRevisionFence,
      nominations,
      candidateReceipts,
      exclusionReceipts,
      exclusionReceiptCount: exclusionReceipts.length,
      exclusionReceiptsTruncated: exclusionReceipts.length >= MAX_SCOPE_RECEIPTS,
      storyScope: deepClone(scope),
      thematicCommunities: this.ontology.communitiesForSources(
        [...new Set(nominations.flatMap((row) => row.drillback.map((source) => source.sourceId)))],
      ),
      summaries: this.summarySurface().summaries.filter((summary) => (
        summary.sourceRevisionRefs.some((revisionId) => sourceRevisionFence.includes(revisionId))
        && summary.sourceRevisionRefs.every((revisionId) => sourceRevisionFence.includes(revisionId))
      )),
      conflicts: this.runtime.store.conflicts(this.runtime.registry).filter((row) => {
        const refs = row?.sourceRevisionRefs || row?.sourceRevisionSet || [];
        return refs.length === 0 || refs.every((revisionId) => sourceRevisionFence.includes(revisionId));
      }),
      provenanceRequired: true,
      exactSourceDrillbackAvailable: true,
      retainedDiagnosticsMetadataOnly: true,
      rawLoreIncludedInDiagnostics: false,
      candidateBusAdmissionAuthority: false,
      truthGateAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    };
    return this._rememberStoryQuery(packet);
  }

  queryForBrain({query, intent = 'AUTO', intentId = null, profile = null} = {}) {
    const result = this.hierarchy.query({query, intent, intentId});
    const desiredProfile = profile
      || (result.intent === 'BROAD' ? RepresentationProfile.LEAN : RepresentationProfile.HEAVY);
    const nominations = result.nominations.map((nomination) => {
      const drillback = this.hierarchy.drillDown(nomination).map((source) => {
        const selection = this.multiResolution.selection({
          sourceId: source.sourceId,
          desiredProfile,
        });
        return {
          ...source,
          selectedRepresentation: deepClone(selection.requestedMatch),
          availableRepresentations: profileSummary(selection),
        };
      });
      return {
        nomination: deepClone(nomination),
        drillback,
      };
    });
    const sourceRevisionFence = [...new Set(nominations.flatMap((row) => row.drillback.map((source) => source.sourceRevisionId)))].sort();
    return {
      kind: 'LoreBrainRetrievalPacket',
      contractVersion: 1,
      query: result.query,
      intent: result.intent,
      retrievalIntentId: result.retrievalIntentId,
      indexRevision: result.indexRevision,
      ontologyRevision: this.ontology.current().ontologyRevision,
      desiredProfile,
      sourceRevisionFence,
      nominations,
      thematicCommunities: this.ontology.communitiesForSources(
        [...new Set(nominations.flatMap((row) => row.drillback.map((source) => source.sourceId)))],
      ),
      summaries: this.summarySurface().summaries.filter((summary) => (
        summary.sourceRevisionRefs.some((revisionId) => sourceRevisionFence.includes(revisionId))
      )),
      conflicts: this.runtime.store.conflicts(this.runtime.registry),
      provenanceRequired: true,
      exactSourceDrillbackAvailable: true,
      candidateBusAdmissionAuthority: false,
      truthGateAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    };
  }

  brainInterface() {
    return Object.freeze({
      kind: 'LoreBrainRetrievalInterface',
      contractVersion: 1,
      query: (request = {}) => request?.chatId ? this.queryForStory(request) : this.queryForBrain(request),
      queryScoped: (request = {}) => this.queryForStory(request),
      status: (request = {}) => this.status({chatId: request?.chatId ?? null}),
      storyScope: (chatId) => this.storyAuthority.scopeReceipt(chatId),
      summaries: () => this.summarySurface(),
      sourceRevision: (sourceId) => this.runtime.registry.currentRevision(sourceId, {allowMissing: true}),
    });
  }

  operatorInterface() {
    const read = Object.freeze({
      surface: () => this.status(),
      status: () => this.status(),
      loreStudy: (request = {}) => this.status({chatId: request?.chatId ?? null}),
      loreReadModel: (request = {}) => this.operatorReadModel(request),
    });
    const actions = Object.freeze({
      acceptLorebook: (input) => this.acceptLorebook(input),
      submitLorebook: (input) => this.acceptLorebook(input),
      ingestLorebook: (input) => this.acceptLorebook(input),
      runLoreStudy: (input) => this.runStudy(input || {}),
      startLoreStudy: (input) => this.runStudy(input || {}),
      retryLoreStudy: (input) => this.retryStudy(input || {}),
      recordHostDiscovery: (input) => this.recordHostDiscovery(input || {}),
      setStoryReadScope: (input) => this.setStoryReadScope(input || {}),
    });
    return Object.freeze({
      kind: 'LoreStudyOperatorHost',
      contractVersion: 1,
      read,
      actions,
    });
  }

  snapshot() {
    return {
      kind: 'LoreIntelligenceServiceSnapshot',
      contractVersion: 1,
      runtime: this.runtime.snapshot(),
      multiResolution: this.multiResolution.snapshot(),
      hierarchy: this.hierarchy.snapshot({compact: true}),
      ontology: this.ontology.current(),
      storyAuthority: this.storyAuthority.snapshot(),
      compileFailures: [...this.compileFailures.entries()].map(([sourceId, failures]) => [sourceId, deepClone(failures)]),
      lastAcceptance: deepClone(this.lastAcceptance),
      lastStudyRun: deepClone(this.lastStudyRun),
      lastStoryQuery: deepClone(this.lastStoryQuery),
    };
  }

  static fromSnapshot(snapshot) {
    if (!snapshot || snapshot.kind !== 'LoreIntelligenceServiceSnapshot') throw new TypeError('Lore Intelligence snapshot is required');
    const runtime = LoreStudyRuntime.fromSnapshot(snapshot.runtime);
    const representationRegistry = new LoreRepresentationRegistry(snapshot.multiResolution?.representationRegistry || null);
    const multiResolution = new LoreMultiResolutionSystem({
      runtime,
      registry: representationRegistry,
      compilerRevision: snapshot.multiResolution?.compilerRevision || null,
      policyOverrides: snapshot.multiResolution?.policyOverrides || {},
    });
    const hierarchy = LoreHierarchyRetrievalSystem.fromSnapshot({
      runtime,
      snapshot: snapshot.hierarchy,
    });
    const ontology = new LoreWorldOntology({runtime});
    ontology.snapshotValue = deepClone(snapshot.ontology || null);
    const storyAuthority = new LoreStoryAuthorityRegistry(snapshot.storyAuthority || null);
    const service = new LoreIntelligenceService({runtime, multiResolution, hierarchy, ontology, storyAuthority});
    service.compileFailures = new Map((snapshot.compileFailures || []).map(([sourceId, failures]) => [sourceId, deepClone(failures)]));
    service.lastAcceptance = deepClone(snapshot.lastAcceptance || null);
    service.lastStudyRun = deepClone(snapshot.lastStudyRun || null);
    service.lastStoryQuery = deepClone(snapshot.lastStoryQuery || null);
    return service;
  }
}

export function createLoreIntelligenceService(options = {}) {
  return new LoreIntelligenceService(options);
}
