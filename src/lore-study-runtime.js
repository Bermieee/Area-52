import {
  ArtifactType,
  RetrievalForm,
  StudyState,
  createStudyObligation,
  deepClone,
  stableHash,
} from './lore-contracts.js';
import {LoreDerivedStore, LoreSourceRegistry} from './lore-source-registry.js';
import {LoreStudyEngine, semanticDiff} from './lore-study-engine.js';

export class LoreStudyRuntime {
  constructor({registry = new LoreSourceRegistry(), store = new LoreDerivedStore(), engine = new LoreStudyEngine(), snapshot = null} = {}) {
    this.registry = registry;
    this.store = store;
    this.engine = engine;
    this.obligations = new Map();
    this.sessions = new Map();
    this.obligationSequence = 0;
    if (snapshot) this.restore(snapshot);
  }

  registerLorebook(input) {
    return this.registry.registerLorebook(input);
  }

  upsertEntry(input) {
    const result = this.registry.upsertEntry(input);
    if (result.changed) {
      const trigger = result.previousRevision ? (result.previousRevision.state === 'REMOVED' ? 'RESTORED_UID' : 'CHANGED_UID') : 'NEW_UID';
      result.obligation = this.enqueue(result.revision, trigger);
    } else {
      result.obligation = this.findObligation(result.revision.id);
    }
    return deepClone(result);
  }

  removeEntry(input) {
    const result = this.registry.removeEntry(input);
    if (result.changed) result.obligation = this.enqueue(result.revision, 'REMOVED_UID');
    else result.obligation = this.findObligation(result.revision.id);
    return deepClone(result);
  }

  ingestLorebook({id, title = null, metadata = {}, entries = [], fullSnapshot = false}) {
    this.registerLorebook({id, title, metadata});
    const seen = new Set();
    const results = [];
    for (const entry of entries) {
      const row = this.upsertEntry({
        lorebookId: id,
        uid: entry.uid,
        content: entry.content,
        metadata: entry.metadata || {},
      });
      seen.add(String(entry.uid));
      results.push(row);
    }
    if (fullSnapshot) {
      for (const source of this.registry.listEntries({includeRemoved: false})) {
        if (source.lorebookId === String(id) && !seen.has(String(source.uid))) {
          results.push(this.removeEntry({lorebookId: id, uid: source.uid, reason: 'missing-from-lorebook-snapshot'}));
        }
      }
    }
    return results;
  }

  enqueue(revision, trigger = 'DEPENDENCY_INVALIDATION') {
    const existing = this.findObligation(revision.id);
    if (existing && ![StudyState.SUPERSEDED, StudyState.INVALID].includes(existing.state)) return existing;

    for (const obligation of this.obligations.values()) {
      if (obligation.sourceId !== revision.sourceId) continue;
      if ([StudyState.DUE, StudyState.PENDING, StudyState.CHECKPOINTED].includes(obligation.state) && obligation.sourceRevisionId !== revision.id) {
        obligation.state = StudyState.SUPERSEDED;
        obligation.supersededBy = revision.id;
        this.sessions.delete(obligation.id);
      }
    }
    const id = 'obligation:' + stableHash(revision.sourceId + '|' + revision.id + '|' + trigger);
    const obligation = createStudyObligation({
      id,
      sourceId: revision.sourceId,
      sourceRevisionId: revision.id,
      trigger,
      sequence: ++this.obligationSequence,
    });
    this.obligations.set(id, obligation);
    return deepClone(obligation);
  }

  findObligation(sourceRevisionId) {
    const rows = [...this.obligations.values()].filter((row) => row.sourceRevisionId === sourceRevisionId);
    return rows.length ? deepClone(rows.sort((a, b) => b.sequence - a.sequence)[0]) : null;
  }

  listObligations({states = null} = {}) {
    const allowed = states ? new Set(states) : null;
    return [...this.obligations.values()]
      .filter((row) => !allowed || allowed.has(row.state))
      .map(deepClone)
      .sort((a, b) => a.sequence - b.sequence);
  }

  dueObligations() {
    return this.listObligations({states: [StudyState.DUE, StudyState.PENDING, StudyState.CHECKPOINTED]});
  }

  begin(obligationId) {
    const obligation = this.obligations.get(obligationId);
    if (!obligation) throw new Error('Unknown Lore study obligation: ' + obligationId);
    if ([StudyState.COMPLETED, StudyState.SUPERSEDED, StudyState.INVALID].includes(obligation.state)) return deepClone(obligation);
    const currentRevision = this.registry.currentRevision(obligation.sourceId);
    if (currentRevision.id !== obligation.sourceRevisionId) {
      obligation.state = StudyState.SUPERSEDED;
      obligation.supersededBy = currentRevision.id;
      return deepClone(obligation);
    }
    if (currentRevision.state === 'REMOVED') {
      obligation.state = StudyState.ACTIVE;
      obligation.attempts += 1;
      return deepClone(obligation);
    }
    if (!this.sessions.has(obligationId)) {
      const source = this.registry.getEntry(obligation.sourceId);
      this.sessions.set(obligationId, this.engine.createSession({source, revision: currentRevision}));
    }
    obligation.state = StudyState.ACTIVE;
    obligation.attempts += 1;
    return deepClone(obligation);
  }

  run(obligationId, {maxUnits = Infinity} = {}) {
    const started = this.begin(obligationId);
    const obligation = this.obligations.get(obligationId);
    if ([StudyState.COMPLETED, StudyState.SUPERSEDED, StudyState.INVALID].includes(obligation.state)) {
      return {obligation: deepClone(obligation), learnedRevision: null, checkpointed: false};
    }

    const currentRevision = this.registry.currentRevision(obligation.sourceId);
    if (currentRevision.id !== obligation.sourceRevisionId) {
      obligation.state = StudyState.SUPERSEDED;
      obligation.supersededBy = currentRevision.id;
      return {obligation: deepClone(obligation), learnedRevision: null, checkpointed: false};
    }

    const previousLearned = this.store.currentLearnedRevision(obligation.sourceId);
    const previousArtifacts = previousLearned ? this.store.artifactsForLearnedRevision(previousLearned.id) : [];
    const impactPreview = this.store.impactPreview(obligation.sourceId);
    impactPreview.unrelatedReusableArtifactCount = this.store.currentArtifacts(this.registry).filter((artifact) => artifact.sourceId !== obligation.sourceId).length;

    if (currentRevision.state === 'REMOVED') {
      const diff = semanticDiff(previousArtifacts, []);
      const learnedRevision = this.store.publishRemoval({
        source: this.registry.getEntry(obligation.sourceId),
        sourceRevision: currentRevision,
        semanticDiff: diff,
        validation: {kind: 'LoreStudyValidation', ok: true, removal: true, failures: []},
      });
      obligation.state = StudyState.COMPLETED;
      obligation.checkpoint = {unitIndex: 1, totalUnits: 1, checksum: stableHash(learnedRevision.id)};
      this.sessions.delete(obligationId);
      return {obligation: deepClone(obligation), learnedRevision, impactPreview, semanticDiff: diff, checkpointed: false};
    }

    let session = this.sessions.get(obligationId);
    let executed = 0;
    while (!session.complete && executed < maxUnits) {
      if (this.registry.currentRevision(obligation.sourceId).id !== obligation.sourceRevisionId) {
        obligation.state = StudyState.SUPERSEDED;
        obligation.supersededBy = this.registry.currentRevision(obligation.sourceId).id;
        return {obligation: deepClone(obligation), learnedRevision: null, impactPreview, checkpointed: false};
      }
      session = this.engine.step(session);
      this.sessions.set(obligationId, session);
      executed += 1;
      obligation.checkpoint = {
        unitIndex: session.unitIndex,
        totalUnits: session.units.length,
        lastUnit: session.workspace.unitReceipts.at(-1)?.unit || null,
        checksum: stableHash(session.workspace.unitReceipts),
      };
    }

    if (!session.complete) {
      obligation.state = StudyState.CHECKPOINTED;
      return {
        obligation: deepClone(obligation),
        learnedRevision: null,
        impactPreview,
        checkpointed: true,
        stagedArtifactCount: session.workspace.artifacts.length,
      };
    }

    if (!session.valid || !session.workspace.validation?.ok) {
      obligation.state = StudyState.INVALID;
      this.sessions.delete(obligationId);
      return {
        obligation: deepClone(obligation),
        learnedRevision: null,
        impactPreview,
        checkpointed: false,
        validation: deepClone(session.workspace.validation),
      };
    }

    if (this.registry.currentRevision(obligation.sourceId).id !== obligation.sourceRevisionId) {
      obligation.state = StudyState.SUPERSEDED;
      obligation.supersededBy = this.registry.currentRevision(obligation.sourceId).id;
      this.sessions.delete(obligationId);
      return {obligation: deepClone(obligation), learnedRevision: null, impactPreview, checkpointed: false};
    }

    const diff = semanticDiff(previousArtifacts, session.workspace.artifacts);
    const learnedRevision = this.store.publish({
      source: this.registry.getEntry(obligation.sourceId),
      sourceRevision: currentRevision,
      artifacts: session.workspace.artifacts,
      semanticDiff: diff,
      validation: session.workspace.validation,
    });
    obligation.state = StudyState.COMPLETED;
    this.sessions.delete(obligationId);
    obligation.checkpoint = {
      ...obligation.checkpoint,
      committedLearnedRevisionId: learnedRevision.id,
      atomicPublication: true,
    };
    return {
      obligation: deepClone(obligation),
      learnedRevision,
      impactPreview,
      semanticDiff: diff,
      checkpointed: false,
      warnings: deepClone(session.workspace.warnings),
    };
  }

  runDue({maxUnitsPerObligation = Infinity} = {}) {
    const results = [];
    for (const obligation of this.dueObligations()) results.push(this.run(obligation.id, {maxUnits: maxUnitsPerObligation}));
    return results;
  }

  pause(obligationId, reason = 'generation-pressure') {
    const obligation = this.obligations.get(obligationId);
    if (!obligation) throw new Error('Unknown Lore study obligation: ' + obligationId);
    if (obligation.state === StudyState.ACTIVE) obligation.state = StudyState.CHECKPOINTED;
    obligation.pauseReason = reason;
    return deepClone(obligation);
  }

  studyStatus() {
    const counts = {};
    for (const state of Object.values(StudyState)) counts[state] = 0;
    for (const obligation of this.obligations.values()) counts[obligation.state] = (counts[obligation.state] || 0) + 1;
    return {
      kind: 'LoreStudyLifecycleStatus',
      counts,
      due: counts.DUE + counts.PENDING + counts.CHECKPOINTED,
      active: counts.ACTIVE,
      runtimeSchedulingAuthority: false,
      physicalWorkerAuthority: false,
    };
  }

  publicSurface() {
    const currentArtifacts = this.store.currentArtifacts(this.registry);
    const conflicts = this.store.conflicts(this.registry);
    const entries = this.registry.listEntries({includeRemoved: true}).map((source) => {
      const revision = this.registry.currentRevision(source.sourceId);
      const learned = this.store.currentLearnedRevision(source.sourceId);
      const fresh = Boolean(learned && learned.sourceRevisionId === revision.id && learned.state === (revision.state === 'REMOVED' ? 'REMOVED' : 'CURRENT'));
      const artifacts = fresh && revision.state !== 'REMOVED'
        ? this.store.artifactsForLearnedRevision(learned.id)
        : [];
      return {
        sourceId: source.sourceId,
        lorebookId: source.lorebookId,
        uid: source.uid,
        sourceRevisionId: revision.id,
        sourceState: revision.state,
        learnedRevisionId: learned?.id || null,
        freshness: fresh ? (revision.state === 'REMOVED' ? 'REMOVED' : 'CURRENT') : 'STALE_OR_UNLEARNED',
        exactSource: revision.state === 'REMOVED' ? null : {
          form: RetrievalForm.EXACT_SOURCE,
          content: revision.exactContent,
          contentHash: revision.contentHash,
          sourceRevisionId: revision.id,
          authorityClass: 'SOURCE_CANON',
        },
        artifactIds: artifacts.map((artifact) => artifact.id).sort(),
        retrievalRepresentations: artifacts
          .filter((artifact) => artifact.artifactType === ArtifactType.RETRIEVAL || artifact.artifactType === ArtifactType.COMPACT)
          .map((artifact) => ({
            artifactId: artifact.id,
            semanticId: artifact.semanticId,
            artifactType: artifact.artifactType,
            sourceId: artifact.sourceId,
            sourceRevisionId: artifact.sourceRevisionId,
            authorityClass: artifact.authorityClass,
            temporalClass: artifact.temporalClass,
            unresolved: artifact.unresolved,
            provenance: deepClone(artifact.provenance),
            representation: deepClone(artifact.payload),
            retrievalScoreAuthority: false,
          })),
      };
    });
    return {
      kind: 'LorePublicIntegrationSurface',
      contractVersion: 1,
      entries,
      artifacts: currentArtifacts.map((artifact) => ({
        artifactId: artifact.id,
        semanticId: artifact.semanticId,
        artifactType: artifact.artifactType,
        sourceId: artifact.sourceId,
        sourceRevisionId: artifact.sourceRevisionId,
        payload: deepClone(artifact.payload),
        temporalClass: artifact.temporalClass,
        provenance: deepClone(artifact.provenance),
        authorityClass: artifact.authorityClass,
        dependencyRevisions: [artifact.sourceRevisionId],
        freshness: 'CURRENT',
        unresolved: artifact.unresolved,
      })),
      conflicts,
      lifecycle: this.studyStatus(),
      candidateBusAuthority: false,
      truthGateAuthority: false,
      precisionAuthority: false,
      gatherSealAuthority: false,
      settlementAuthority: false,
    };
  }

  snapshot() {
    return {
      kind: 'LoreStudyRuntimeSnapshot',
      registry: this.registry.snapshot(),
      store: this.store.snapshot(),
      obligations: [...this.obligations.values()].map(deepClone),
      sessions: [...this.sessions.entries()].map(([id, session]) => [id, deepClone(session)]),
      obligationSequence: this.obligationSequence,
    };
  }

  restore(snapshot) {
    this.registry.restore(snapshot.registry);
    this.store.restore(snapshot.store);
    this.obligations = new Map((snapshot.obligations || []).map((row) => [row.id, deepClone(row)]));
    this.sessions = new Map((snapshot.sessions || []).map(([id, session]) => [id, deepClone(session)]));
    this.obligationSequence = Number(snapshot.obligationSequence || 0);
  }

  static fromSnapshot(snapshot) {
    return new LoreStudyRuntime({snapshot});
  }
}
