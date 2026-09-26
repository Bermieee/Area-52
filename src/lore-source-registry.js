import {
  ArtifactType,
  deepClone,
  stableHash,
  stableStringify,
} from './lore-contracts.js';

function normalizedMetadata(metadata = {}) {
  const passthrough = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (['title', 'treePath', 'tags', 'scope', 'order', 'extra'].includes(key)) continue;
    passthrough[key] = deepClone(value);
  }
  return {
    title: metadata.title == null ? null : String(metadata.title),
    treePath: Array.isArray(metadata.treePath) ? metadata.treePath.map(String) : [],
    tags: Array.isArray(metadata.tags) ? [...new Set(metadata.tags.map(String))].sort() : [],
    scope: metadata.scope == null ? null : String(metadata.scope),
    order: Number.isFinite(metadata.order) ? metadata.order : null,
    extra: {
      ...(metadata.extra && typeof metadata.extra === 'object' ? deepClone(metadata.extra) : {}),
      ...passthrough,
    },
  };
}

export class LoreSourceRegistry {
  constructor(snapshot = null) {
    this.books = new Map();
    this.entries = new Map();
    this.revisions = new Map();
    this.sequence = 0;
    if (snapshot) this.restore(snapshot);
  }

  registerLorebook({id, title = null, metadata = {}}) {
    if (!id) throw new TypeError('Lorebook id is required');
    const existing = this.books.get(id);
    const record = {
      kind: 'LorebookSource',
      id: String(id),
      title: title == null ? (existing?.title || String(id)) : String(title),
      metadata: deepClone(metadata),
    };
    this.books.set(record.id, record);
    return deepClone(record);
  }

  upsertEntry({lorebookId, uid, content, metadata = {}}) {
    if (!lorebookId || uid === undefined || uid === null) throw new TypeError('lorebookId and uid are required');
    if (typeof content !== 'string') throw new TypeError('Lore source content must be a string');
    if (!this.books.has(String(lorebookId))) this.registerLorebook({id: String(lorebookId)});
    const sourceId = 'lore:' + String(lorebookId) + ':' + String(uid);
    const meta = normalizedMetadata(metadata);
    const exactFingerprint = stableHash({content, metadata: meta});
    const current = this.currentRevision(sourceId, {allowMissing: true});
    if (current && current.state !== 'REMOVED' && current.exactFingerprint === exactFingerprint) {
      return {changed: false, source: this.getEntry(sourceId), revision: current, previousRevision: current};
    }
    const entry = this.entries.get(sourceId) || {
      kind: 'LoreSourceEntry',
      sourceId,
      lorebookId: String(lorebookId),
      uid: String(uid),
      revisionIds: [],
      currentRevisionId: null,
      removed: false,
    };
    const revisionNumber = entry.revisionIds.length + 1;
    const revisionId = sourceId + '@r' + revisionNumber;
    const revision = {
      kind: 'LoreSourceRevision',
      id: revisionId,
      sourceId,
      lorebookId: entry.lorebookId,
      uid: entry.uid,
      revision: revisionNumber,
      state: 'CURRENT',
      exactContent: content,
      contentHash: stableHash(content),
      exactFingerprint,
      metadata: meta,
      replacesRevisionId: current?.id || null,
      createdSequence: ++this.sequence,
      provenance: {
        kind: 'SourceProvenance',
        sourceId,
        sourceRevisionId: revisionId,
        authored: true,
      },
    };
    if (current) {
      const prior = this.revisions.get(current.id);
      prior.state = current.state === 'REMOVED' ? 'REMOVED' : 'REPLACED';
      prior.replacedByRevisionId = revisionId;
    }
    entry.revisionIds.push(revisionId);
    entry.currentRevisionId = revisionId;
    entry.removed = false;
    this.entries.set(sourceId, entry);
    this.revisions.set(revisionId, revision);
    return {
      changed: true,
      source: deepClone(entry),
      revision: deepClone(revision),
      previousRevision: current ? deepClone(current) : null,
    };
  }

  removeEntry({lorebookId, uid, reason = 'source-removed'}) {
    const sourceId = 'lore:' + String(lorebookId) + ':' + String(uid);
    const entry = this.entries.get(sourceId);
    if (!entry) throw new Error('Unknown lore source: ' + sourceId);
    const current = this.currentRevision(sourceId, {allowMissing: true});
    if (current?.state === 'REMOVED') return {changed: false, source: this.getEntry(sourceId), revision: current, previousRevision: current};
    const revisionNumber = entry.revisionIds.length + 1;
    const revisionId = sourceId + '@r' + revisionNumber;
    const revision = {
      kind: 'LoreSourceRevision',
      id: revisionId,
      sourceId,
      lorebookId: entry.lorebookId,
      uid: entry.uid,
      revision: revisionNumber,
      state: 'REMOVED',
      exactContent: null,
      contentHash: null,
      exactFingerprint: stableHash({removed: true, reason}),
      metadata: current ? deepClone(current.metadata) : normalizedMetadata(),
      replacesRevisionId: current?.id || null,
      createdSequence: ++this.sequence,
      removalReason: String(reason),
      provenance: {
        kind: 'SourceProvenance',
        sourceId,
        sourceRevisionId: revisionId,
        authored: true,
        removal: true,
      },
    };
    if (current) {
      const prior = this.revisions.get(current.id);
      prior.state = 'REPLACED';
      prior.replacedByRevisionId = revisionId;
    }
    entry.revisionIds.push(revisionId);
    entry.currentRevisionId = revisionId;
    entry.removed = true;
    this.revisions.set(revisionId, revision);
    return {changed: true, source: deepClone(entry), revision: deepClone(revision), previousRevision: current ? deepClone(current) : null};
  }

  getEntry(sourceId) {
    const entry = this.entries.get(sourceId);
    return entry ? deepClone(entry) : null;
  }

  getRevision(revisionId) {
    const revision = this.revisions.get(revisionId);
    return revision ? deepClone(revision) : null;
  }

  currentRevision(sourceId, {allowMissing = false} = {}) {
    const entry = this.entries.get(sourceId);
    if (!entry || !entry.currentRevisionId) {
      if (allowMissing) return null;
      throw new Error('Unknown lore source: ' + sourceId);
    }
    return this.getRevision(entry.currentRevisionId);
  }

  revisionHistory(sourceId) {
    const entry = this.entries.get(sourceId);
    if (!entry) return [];
    return entry.revisionIds.map((id) => this.getRevision(id));
  }

  listEntries({includeRemoved = false} = {}) {
    return [...this.entries.values()]
      .filter((entry) => includeRemoved || !entry.removed)
      .map(deepClone)
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  }

  isCurrentRevision(revisionId) {
    const revision = this.revisions.get(revisionId);
    if (!revision) return false;
    const entry = this.entries.get(revision.sourceId);
    return Boolean(entry && entry.currentRevisionId === revisionId);
  }

  snapshot() {
    return {
      kind: 'LoreSourceRegistrySnapshot',
      sequence: this.sequence,
      books: [...this.books.values()].map(deepClone),
      entries: [...this.entries.values()].map(deepClone),
      revisions: [...this.revisions.values()].map(deepClone),
    };
  }

  restore(snapshot) {
    this.sequence = Number(snapshot.sequence || 0);
    this.books = new Map((snapshot.books || []).map((row) => [row.id, deepClone(row)]));
    this.entries = new Map((snapshot.entries || []).map((row) => [row.sourceId, deepClone(row)]));
    this.revisions = new Map((snapshot.revisions || []).map((row) => [row.id, deepClone(row)]));
  }
}

export class LoreDerivedStore {
  constructor(snapshot = null) {
    this.artifacts = new Map();
    this.learnedRevisions = new Map();
    this.learnedRevisionIdsBySource = new Map();
    this.currentLearnedBySource = new Map();
    this.publicationSequence = 0;
    if (snapshot) this.restore(snapshot);
  }

  publish({source, sourceRevision, artifacts, semanticDiff, validation}) {
    if (sourceRevision.state === 'REMOVED') {
      return this.publishRemoval({source, sourceRevision, semanticDiff, validation});
    }
    if (!validation?.ok) throw new Error('Cannot publish unvalidated Lore learned revision');
    const artifactIds = [];
    for (const artifact of artifacts) {
      if (artifact.sourceId !== source.sourceId || artifact.sourceRevisionId !== sourceRevision.id) {
        throw new Error('Lore artifact source provenance mismatch: ' + artifact.id);
      }
      this.artifacts.set(artifact.id, deepClone(artifact));
      artifactIds.push(artifact.id);
    }
    const ids = this.learnedRevisionIdsBySource.get(source.sourceId) || [];
    const previousId = this.currentLearnedBySource.get(source.sourceId) || null;
    const learnedId = 'learned:' + stableHash(sourceRevision.id + '|' + stableStringify(artifactIds));
    const learned = {
      kind: 'LoreLearnedRevision',
      id: learnedId,
      sourceId: source.sourceId,
      sourceRevisionId: sourceRevision.id,
      sequence: ++this.publicationSequence,
      state: 'CURRENT',
      replacesLearnedRevisionId: previousId,
      artifactIds: [...artifactIds],
      semanticDiff: deepClone(semanticDiff),
      validation: deepClone(validation),
      atomicPublication: true,
    };
    if (previousId && this.learnedRevisions.has(previousId)) this.learnedRevisions.get(previousId).state = 'HISTORICAL';
    this.learnedRevisions.set(learnedId, learned);
    this.learnedRevisionIdsBySource.set(source.sourceId, [...ids, learnedId]);
    this.currentLearnedBySource.set(source.sourceId, learnedId);
    return deepClone(learned);
  }

  publishRemoval({source, sourceRevision, semanticDiff, validation}) {
    if (!validation?.ok) throw new Error('Cannot publish invalid Lore removal');
    const previousId = this.currentLearnedBySource.get(source.sourceId) || null;
    if (previousId && this.learnedRevisions.has(previousId)) this.learnedRevisions.get(previousId).state = 'HISTORICAL';
    const ids = this.learnedRevisionIdsBySource.get(source.sourceId) || [];
    const learnedId = 'learned:' + stableHash(sourceRevision.id + '|REMOVED');
    const learned = {
      kind: 'LoreLearnedRevision',
      id: learnedId,
      sourceId: source.sourceId,
      sourceRevisionId: sourceRevision.id,
      sequence: ++this.publicationSequence,
      state: 'REMOVED',
      replacesLearnedRevisionId: previousId,
      artifactIds: [],
      semanticDiff: deepClone(semanticDiff),
      validation: deepClone(validation),
      atomicPublication: true,
    };
    this.learnedRevisions.set(learnedId, learned);
    this.learnedRevisionIdsBySource.set(source.sourceId, [...ids, learnedId]);
    this.currentLearnedBySource.set(source.sourceId, learnedId);
    return deepClone(learned);
  }

  currentLearnedRevision(sourceId) {
    const id = this.currentLearnedBySource.get(sourceId);
    return id ? deepClone(this.learnedRevisions.get(id)) : null;
  }

  learnedHistory(sourceId) {
    return (this.learnedRevisionIdsBySource.get(sourceId) || []).map((id) => deepClone(this.learnedRevisions.get(id)));
  }

  artifactsForLearnedRevision(learnedRevisionId) {
    const learned = this.learnedRevisions.get(learnedRevisionId);
    if (!learned) return [];
    return learned.artifactIds.map((id) => deepClone(this.artifacts.get(id))).filter(Boolean);
  }

  currentArtifacts(registry, {types = null} = {}) {
    const allowed = types ? new Set(types) : null;
    const rows = [];
    for (const [sourceId, learnedId] of this.currentLearnedBySource.entries()) {
      const learned = this.learnedRevisions.get(learnedId);
      const sourceRevision = registry.currentRevision(sourceId, {allowMissing: true});
      if (!learned || !sourceRevision || sourceRevision.state === 'REMOVED') continue;
      if (learned.sourceRevisionId !== sourceRevision.id || learned.state !== 'CURRENT') continue;
      for (const id of learned.artifactIds) {
        const artifact = this.artifacts.get(id);
        if (artifact && (!allowed || allowed.has(artifact.artifactType))) rows.push(deepClone(artifact));
      }
    }
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }

  impactPreview(sourceId) {
    const current = this.currentLearnedRevision(sourceId);
    const artifacts = current ? this.artifactsForLearnedRevision(current.id) : [];
    const byType = {};
    for (const artifact of artifacts) byType[artifact.artifactType] = (byType[artifact.artifactType] || 0) + 1;
    return {
      kind: 'LoreImpactPreview',
      sourceId,
      previousLearnedRevisionId: current?.id || null,
      affectedArtifactIds: artifacts.map((row) => row.id).sort(),
      affectedByType: byType,
      currentArtifactCount: artifacts.length,
      advisory: true,
      mutationAuthority: false,
    };
  }

  conflicts(registry) {
    const claims = this.currentArtifacts(registry, {types: [ArtifactType.CLAIM]});
    const slots = new Map();
    for (const claim of claims) {
      const key = claim.payload.subjectId + '|' + claim.payload.predicate;
      const rows = slots.get(key) || [];
      rows.push(claim);
      slots.set(key, rows);
    }
    const conflicts = [];
    for (const [slotKey, rows] of slots.entries()) {
      const values = [...new Set(rows.map((row) => stableStringify(row.payload.value)))];
      const uncertain = rows.some((row) => row.unresolved || row.temporalClass === 'UNCERTAIN' || row.temporalClass === 'CONFLICTING');
      if (values.length > 1 && uncertain) {
        conflicts.push({
          kind: 'LoreConflictSet',
          id: 'conflict:' + stableHash(slotKey + '|' + values.sort().join('|')),
          slotKey,
          artifactIds: rows.map((row) => row.id).sort(),
          semanticIds: rows.map((row) => row.semanticId).sort(),
          status: 'UNRESOLVED',
          authorityClass: 'UNRESOLVED',
        });
      }
    }
    return conflicts.sort((a, b) => a.id.localeCompare(b.id));
  }

  snapshot() {
    return {
      kind: 'LoreDerivedStoreSnapshot',
      publicationSequence: this.publicationSequence,
      artifacts: [...this.artifacts.values()].map(deepClone),
      learnedRevisions: [...this.learnedRevisions.values()].map(deepClone),
      learnedRevisionIdsBySource: [...this.learnedRevisionIdsBySource.entries()].map(([key, value]) => [key, [...value]]),
      currentLearnedBySource: [...this.currentLearnedBySource.entries()],
    };
  }

  restore(snapshot) {
    this.publicationSequence = Number(snapshot.publicationSequence || 0);
    this.artifacts = new Map((snapshot.artifacts || []).map((row) => [row.id, deepClone(row)]));
    this.learnedRevisions = new Map((snapshot.learnedRevisions || []).map((row) => [row.id, deepClone(row)]));
    this.learnedRevisionIdsBySource = new Map((snapshot.learnedRevisionIdsBySource || []).map(([key, value]) => [key, [...value]]));
    this.currentLearnedBySource = new Map(snapshot.currentLearnedBySource || []);
  }
}
