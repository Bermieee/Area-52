import {deepClone, StudyState} from './lore-contracts.js';
import {LoreStudyRuntime} from './lore-study-runtime.js';
import {LoreMultiResolutionSystem} from './lore-multi-resolution.js';
import {LoreRepresentationRegistry} from './lore-representation-registry.js';
import {LoreWorldOntology} from './lore-world-ontology.js';
import {LoreHierarchyRetrievalSystem} from './lore-hierarchy-retrieval-system.js';
import {QualityStatus, RepresentationProfile} from './lore-representation-contracts.js';
import {LoreStoryAuthorityRegistry} from './lore-story-authority.js';

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
    storyAuthority = new LoreStoryAuthorityRegistry(),
  } = {}) {
    this.runtime = runtime;
    this.multiResolution = multiResolution || new LoreMultiResolutionSystem({runtime});
    this.hierarchy = hierarchy || new LoreHierarchyRetrievalSystem({runtime});
    this.ontology = ontology || new LoreWorldOntology({runtime});
    this.storyAuthority = storyAuthority;
    this.compileFailures = new Map();
    this.lastAcceptance = null;
    this.lastStudyRun = null;
  }

  _storyChatId(input = {}) {
    const value = input?.storyScope?.chatId ?? input?.chatId ?? input?.discovery?.chatId ?? null;
    return value == null || String(value).trim() === '' ? null : String(value);
  }

  _sourceRevisionFenceForLorebooks(lorebookIds = []) {
    const allowed = new Set((lorebookIds || []).map(String));
    return this.runtime.registry.listEntries({includeRemoved: true})
      .filter((source) => allowed.has(source.lorebookId))
      .map((source) => {
        const revision = this.runtime.registry.currentRevision(source.sourceId, {allowMissing: true});
        return revision ? {
          sourceId: source.sourceId,
          lorebookId: source.lorebookId,
          uid: source.uid,
          sourceRevisionId: revision.id,
          sourceState: revision.state,
          contentHash: revision.contentHash,
        } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  }

  recordHostDiscovery({chatId, lorebookId, title = null, discovery = null, hostSelectionRevision = null} = {}) {
    return this.storyAuthority.recordDiscovery({chatId, lorebookId, title, discovery, hostSelectionRevision});
  }

  setStoryReadScope({chatId, lorebookIds = []} = {}) {
    return this.storyAuthority.setReadScope({chatId, lorebookIds});
  }

  grantStoryWriteAuthority({chatId, lorebookIds = [], operatorAuthorityId = null} = {}) {
    const sourceRevisionFence = this._sourceRevisionFenceForLorebooks(lorebookIds);
    return this.storyAuthority.grantWriteAuthority({
      chatId,
      lorebookIds,
      sourceRevisionFence,
      operatorAuthorityId,
    });
  }

  revokeStoryWriteAuthority(request = {}) {
    return this.storyAuthority.revokeWriteAuthority(request);
  }

  storyScopeReceipt({chatId} = {}) {
    return this.storyAuthority.scopeReceipt(chatId);
  }

  recordRevisionChanges(events = [], {origin = 'SOURCE_REVISION_CHANGED'} = {}) {
    const receipts = [];
    for (const event of events || []) {
      if (!event?.lorebookId || !event?.sourceRevisionId) continue;
      receipts.push(...this.storyAuthority.recordRevisionChange({
        sourceId: event.sourceId,
        lorebookId: event.lorebookId,
        previousSourceRevisionId: event.previousSourceRevisionId,
        sourceRevisionId: event.sourceRevisionId,
        sourceState: event.sourceState,
        origin: event.operationKind || origin,
      }));
    }
    return receipts;
  }

  storyRevisionReceipts({chatId = null, limit = 128} = {}) {
    const max = Math.max(1, Math.min(512, Number(limit) || 128));
    return this.storyAuthority.revisionReceipts
      .filter((row) => chatId == null || row.chatId === String(chatId))
      .slice(-max)
      .map(deepClone);
  }

  acceptLorebook(input) {
    const book = assertDiscoveredLorebook(input);
    const chatId = this._storyChatId(input);
    if (chatId) {
      this.storyAuthority.recordDiscovery({
        chatId,
        lorebookId: book.id,
        title: book.title,
        discovery: book.discovery,
        hostSelectionRevision: input?.hostSelectionRevision ?? input?.discovery?.hostSelectionRevision ?? null,
      });
    }
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
    const staleRepresentationIds = this.multiResolution.refreshFreshness();
    this.ontology.rebuild();
    this.hierarchy.refreshHierarchy();
    this.hierarchy.refreshRetrieval();

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

    const receipt = {
      kind: 'LoreSourceAcceptanceReceipt',
      contractVersion: 2,
      lorebookId: book.id,
      title: book.title,
      discovery: deepClone(book.discovery),
      fullSnapshot: book.fullSnapshot,
      acceptedEntryCount: book.entries.length,
      exactSourcePreserved: true,
      sourceMutationByStudy: false,
      changes,
      storyScope: null,
      status: null,
    };
    if (chatId) {
      receipt.storyScope = this.storyAuthority.acceptForStudy({
        chatId,
        lorebookId: book.id,
        sourceRevisionFence: changes.map((row) => ({
          sourceId: row.sourceId,
          lorebookId: book.id,
          sourceRevisionId: row.sourceRevisionId,
        })),
        acceptanceReceiptId: 'lore-source-acceptance:' + book.id + ':' + chatId,
        enableRead: true,
      });
      const revisionEvents = changes
        .filter((row) => row.changed && row.sourceRevisionId)
        .map((row) => ({
          sourceId: row.sourceId,
          lorebookId: book.id,
          previousSourceRevisionId: row.previousSourceRevisionId,
          sourceRevisionId: row.sourceRevisionId,
          sourceState: row.sourceState,
          operationKind: 'HOST_ACCEPTANCE',
        }));
      receipt.storyRevisionReceipts = this.recordRevisionChanges(revisionEvents, {origin: 'HOST_ACCEPTANCE'});
    }
    receipt.status = this.status(chatId ? {chatId} : {});
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

    const ontology = this.ontology.rebuild();
    let retrieval = this.hierarchy.diagnostics();
    let navigationRebuild = null;
    if (rebuildRetrieval) {
      const changedSourceIds = [...new Set(results
        .map((row) => row.learnedRevision?.sourceId)
        .filter(Boolean))]
        .sort();
      if (changedSourceIds.length) {
        navigationRebuild = this.hierarchy.rebuildAffected({sourceIds: changedSourceIds});
      } else {
        this.hierarchy.rebuild();
      }
      retrieval = this.hierarchy.diagnostics();
    }

    const receipt = {
      kind: 'LoreStudyRunReceipt',
      contractVersion: 2,
      requested: results.length,
      results: deepClone(results),
      compilations,
      retrieval,
      navigationRebuild: deepClone(navigationRebuild),
      ontology,
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
      ontology: this.ontology.current(),
      exactSourcePreserved: true,
      derivedArtifactsAreCanon: false,
      externalProviderRequired: false,
      externalDatabaseRequired: false,
      orchestrationServiceRequired: false,
      storyScopeRequiredForScopedRetrieval: true,
      storyScope: chatId == null ? null : this.storyAuthority.scopeReceipt(chatId),
      selectedLorebookAutoAccepted: false,
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
      sourceAuthority: false,
      temporalStateAuthority: false,
    };
  }

  queryForStory({chatId, query, intent = 'AUTO', intentId = null, profile = null} = {}) {
    const scope = this.storyAuthority.scopeReceipt(chatId);
    if (!chatId || scope.state !== 'BOUND' || !scope.readLorebookIds.length) {
      return {
        kind: 'LoreBrainRetrievalPacket',
        contractVersion: 2,
        query: String(query || ''),
        intent: String(intent || 'AUTO').toUpperCase(),
        retrievalIntentId: intentId || null,
        chatId: chatId == null ? null : String(chatId),
        storyScope: scope,
        blocked: true,
        reasonCode: !chatId ? 'LORE_STORY_SCOPE_REQUIRED' : 'LORE_STORY_READ_SCOPE_EMPTY',
        sourceRevisionFence: [],
        nominations: [],
        thematicCommunities: [],
        summaries: [],
        conflicts: [],
        provenanceRequired: true,
        exactSourceDrillbackAvailable: true,
        storyScopeEnforced: true,
        candidateBusAdmissionAuthority: false,
        truthGateAuthority: false,
        settlementAuthority: false,
        contextSealAuthority: false,
      };
    }
    const allowedBooks = new Set(scope.readLorebookIds);
    const allowedSourceIds = this.runtime.registry.listEntries({includeRemoved: false})
      .filter((source) => allowedBooks.has(source.lorebookId))
      .map((source) => source.sourceId)
      .sort();
    const result = this.hierarchy.query({query, intent, intentId, allowedSourceIds});
    const desiredProfile = profile
      || (result.intent === 'BROAD' ? RepresentationProfile.LEAN : RepresentationProfile.HEAVY);
    const nominations = result.nominations.map((nomination) => {
      const drillback = this.hierarchy.drillDown(nomination)
        .filter((source) => allowedSourceIds.includes(source.sourceId))
        .map((source) => {
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
    }).filter((row) => row.drillback.length > 0);
    const sourceRevisionFence = [...new Set(nominations.flatMap((row) => row.drillback.map((source) => source.sourceRevisionId)))].sort();
    return {
      kind: 'LoreBrainRetrievalPacket',
      contractVersion: 2,
      query: result.query,
      intent: result.intent,
      retrievalIntentId: result.retrievalIntentId,
      indexRevision: result.indexRevision,
      ontologyRevision: this.ontology.current().ontologyRevision,
      desiredProfile,
      chatId: String(chatId),
      storyScope: scope,
      blocked: false,
      sourceRevisionFence,
      nominations,
      thematicCommunities: this.ontology.communitiesForSources(
        [...new Set(nominations.flatMap((row) => row.drillback.map((source) => source.sourceId)))],
      ),
      summaries: this.summarySurface().summaries.filter((summary) => (
        summary.sourceRevisionRefs.some((revisionId) => sourceRevisionFence.includes(revisionId))
        && summary.sourceRevisionRefs.every((revisionId) => {
          const revision = this.runtime.registry.getRevision(revisionId);
          const source = revision ? this.runtime.registry.getEntry(revision.sourceId) : null;
          return Boolean(source && allowedBooks.has(source.lorebookId));
        })
      )),
      conflicts: this.runtime.store.conflicts(this.runtime.registry).filter((conflict) => {
        const refs = [conflict.leftSourceId, conflict.rightSourceId, ...(conflict.sourceIds || [])].filter(Boolean);
        return !refs.length || refs.every((sourceId) => allowedSourceIds.includes(sourceId));
      }),
      retrievalDiagnostics: deepClone(result.diagnostics),
      provenanceRequired: true,
      exactSourceDrillbackAvailable: true,
      storyScopeEnforced: true,
      candidateBusAdmissionAuthority: false,
      truthGateAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    };
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
      storyScopeEnforced: false,
      legacyGlobalQuery: true,
    };
  }

  brainInterface() {
    return Object.freeze({
      kind: 'LoreBrainRetrievalInterface',
      contractVersion: 1,
      query: (request) => this.queryForBrain(request),
      queryScoped: (request) => this.queryForStory(request),
      status: (request = {}) => this.status(request),
      storyScope: (request = {}) => this.storyScopeReceipt(request),
      revisionReceipts: (request = {}) => this.storyRevisionReceipts(request),
      summaries: () => this.summarySurface(),
      sourceRevision: (sourceId) => this.runtime.registry.currentRevision(sourceId, {allowMissing: true}),
    });
  }

  operatorInterface() {
    const read = Object.freeze({
      surface: () => this.status(),
      status: () => this.status(),
      loreStudy: (request = {}) => this.status(request),
      storyScope: (request = {}) => this.storyScopeReceipt(request),
      storyRevisionReceipts: (request = {}) => this.storyRevisionReceipts(request),
    });
    const actions = Object.freeze({
      recordHostDiscovery: (input) => this.recordHostDiscovery(input),
      setStoryReadScope: (input) => this.setStoryReadScope(input),
      grantStoryWriteAuthority: (input) => this.grantStoryWriteAuthority(input),
      revokeStoryWriteAuthority: (input) => this.revokeStoryWriteAuthority(input),
      acceptLorebook: (input) => this.acceptLorebook(input),
      submitLorebook: (input) => this.acceptLorebook(input),
      ingestLorebook: (input) => this.acceptLorebook(input),
      runLoreStudy: (input) => this.runStudy(input || {}),
      startLoreStudy: (input) => this.runStudy(input || {}),
      retryLoreStudy: (input) => this.retryStudy(input || {}),
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
      hierarchy: this.hierarchy.snapshot(),
      ontology: this.ontology.current(),
      storyAuthority: this.storyAuthority.snapshot(),
      compileFailures: [...this.compileFailures.entries()].map(([sourceId, failures]) => [sourceId, deepClone(failures)]),
      lastAcceptance: deepClone(this.lastAcceptance),
      lastStudyRun: deepClone(this.lastStudyRun),
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
    return service;
  }
}

export function createLoreIntelligenceService(options = {}) {
  return new LoreIntelligenceService(options);
}
