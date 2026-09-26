import {
  ArtifactType,
  AuthorityClass,
  TemporalClass,
  deepClone,
  stableStringify,
} from './lore-contracts.js';

const MAX_ROWS = 128;
const MAX_REFS = 256;

const ARTIFACT_BUCKETS = Object.freeze({
  [ArtifactType.CLAIM]: 'CLAIM',
  [ArtifactType.PROPERTY]: 'CLAIM',
  [ArtifactType.ENTITY]: 'ENTITY',
  [ArtifactType.ALIAS]: 'ALIAS',
  [ArtifactType.RELATIONSHIP]: 'RELATIONSHIP',
  [ArtifactType.RULE]: 'RULE',
  [ArtifactType.RESTRICTION]: 'RULE',
  [ArtifactType.CAPABILITY]: 'CAPABILITY',
  [ArtifactType.CONCEPT]: 'CONCEPT',
  [ArtifactType.COMMUNITY]: 'COMMUNITY',
  [ArtifactType.RETRIEVAL]: 'RETRIEVAL',
  [ArtifactType.COMPACT]: 'COMPACT',
  [ArtifactType.STRUCTURE]: 'STRUCTURE',
});

const REQUIRED_BUCKETS = Object.freeze([
  'CLAIM',
  'ENTITY',
  'ALIAS',
  'RELATIONSHIP',
  'RULE',
  'CAPABILITY',
  'TEMPORAL',
  'CONTRADICTION',
  'CONCEPT',
  'COMMUNITY',
  'RETRIEVAL',
  'COMPACT',
  'STRUCTURE',
  'BEHAVIORAL_ANCHOR',
  'SENSORY_ANCHOR',
]);

function splitSentences(content) {
  return String(content || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((row) => row.trim())
    .filter(Boolean);
}

function revisionArtifacts(runtime, sourceId, sourceRevisionId) {
  if (!sourceRevisionId) return [];
  const learned = runtime.store.learnedHistory(sourceId)
    .find((row) => row.sourceRevisionId === sourceRevisionId);
  return learned ? runtime.store.artifactsForLearnedRevision(learned.id) : [];
}

function normalizedPayload(artifact) {
  const payload = deepClone(artifact?.payload || {});
  if (artifact?.artifactType === ArtifactType.COMPACT) {
    if (payload?.representation && typeof payload.representation === 'object') {
      delete payload.representation.sourceRef;
    }
  }
  return payload;
}

function meaningFingerprint(artifact) {
  return stableStringify({
    artifactType: artifact.artifactType,
    logicalKey: artifact.logicalKey,
    payload: normalizedPayload(artifact),
    authorityClass: artifact.authorityClass,
    temporalClass: artifact.temporalClass,
    unresolved: Boolean(artifact.unresolved),
  });
}

function sourceEvidence(registry, artifact) {
  const revision = artifact?.sourceRevisionId ? registry.getRevision(artifact.sourceRevisionId) : null;
  if (!revision) return null;
  const sentenceIndex = artifact?.provenance?.span?.sentenceIndex;
  const sentences = splitSentences(revision.exactContent || '');
  return {
    sourceId: artifact.sourceId,
    sourceRevisionId: artifact.sourceRevisionId,
    lorebookId: revision.lorebookId,
    uid: revision.uid,
    contentHash: revision.contentHash,
    sentenceIndex: Number.isInteger(sentenceIndex) ? sentenceIndex : null,
    exactExcerpt: Number.isInteger(sentenceIndex) ? (sentences[sentenceIndex] || null) : null,
    span: deepClone(artifact?.provenance?.span || null),
  };
}

function describe(registry, artifact) {
  return {
    artifactId: artifact.id,
    semanticId: artifact.semanticId,
    artifactType: artifact.artifactType,
    logicalKey: artifact.logicalKey,
    sourceId: artifact.sourceId,
    sourceRevisionId: artifact.sourceRevisionId,
    payload: normalizedPayload(artifact),
    authorityClass: artifact.authorityClass,
    temporalClass: artifact.temporalClass,
    unresolved: Boolean(artifact.unresolved),
    exactEvidence: sourceEvidence(registry, artifact),
  };
}

function emptyBucket() {
  return {added: [], removed: [], changed: []};
}

function bounded(rows, limit = MAX_ROWS) {
  return (rows || []).slice(0, limit);
}

function bySemantic(rows = []) {
  return new Map(rows.map((row) => [row.semanticId, row]));
}

function bucketFor(beforeRows, afterRows, registry, predicate = null) {
  const before = predicate ? beforeRows.filter(predicate) : beforeRows;
  const after = predicate ? afterRows.filter(predicate) : afterRows;
  const left = bySemantic(before);
  const right = bySemantic(after);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, row] of right.entries()) {
    if (!left.has(id)) added.push(describe(registry, row));
  }
  for (const [id, row] of left.entries()) {
    if (!right.has(id)) removed.push(describe(registry, row));
  }
  for (const [id, oldRow] of left.entries()) {
    const next = right.get(id);
    if (!next) continue;
    if (meaningFingerprint(oldRow) !== meaningFingerprint(next)) {
      changed.push({
        semanticId: id,
        before: describe(registry, oldRow),
        after: describe(registry, next),
      });
    }
  }
  const sortDescriptor = (a, b) => String(a.semanticId || a.artifactId).localeCompare(String(b.semanticId || b.artifactId));
  return {
    added: bounded(added.sort(sortDescriptor)),
    removed: bounded(removed.sort(sortDescriptor)),
    changed: bounded(changed.sort((a, b) => a.semanticId.localeCompare(b.semanticId))),
  };
}

function temporalPredicate(row) {
  return row.temporalClass && row.temporalClass !== TemporalClass.TIMELESS;
}

function contradictionPredicate(row) {
  return Boolean(row.unresolved)
    || row.authorityClass === AuthorityClass.UNRESOLVED
    || [TemporalClass.UNCERTAIN, TemporalClass.CONFLICTING].includes(row.temporalClass);
}

function meaningRows(rows) {
  return rows.filter((row) => ![ArtifactType.CONTEXT_CHUNK, ArtifactType.STRUCTURE].includes(row.artifactType));
}

function semanticMeaningChanged(beforeRows, afterRows) {
  const left = new Map(meaningRows(beforeRows).map((row) => [row.semanticId, meaningFingerprint(row)]));
  const right = new Map(meaningRows(afterRows).map((row) => [row.semanticId, meaningFingerprint(row)]));
  if (left.size !== right.size) return true;
  for (const [id, value] of left.entries()) if (right.get(id) !== value) return true;
  return false;
}

function listRepresentationDependencies(intelligence, sourceId, revisionId) {
  return (intelligence.multiResolution.registry.snapshot()?.representations || [])
    .filter((row) => row.sourceId === sourceId && row.sourceRevisionId === revisionId)
    .map((row) => ({
      kind: 'REPRESENTATION',
      ref: row.id,
      sourceId,
      sourceRevisionId: revisionId,
      profile: row.profile,
    }));
}

function listSummaryDependencies(intelligence, revisionId) {
  return (intelligence.hierarchy.summaryRegistry.snapshot()?.summaries || [])
    .filter((row) => (row.sourceRevisionSet || []).includes(revisionId))
    .map((row) => ({
      kind: 'NAVIGATION_SUMMARY',
      ref: row.id,
      sourceRevisionId: revisionId,
      scopeId: row.targetScopeId,
      state: row.state,
    }));
}

function listRetrievalDependencies(intelligence, sourceId, revisionId) {
  const snapshot = intelligence.hierarchy.retrievalIndex.snapshot();
  return (snapshot?.records || [])
    .filter((row) => (row.sourceIds || []).includes(sourceId)
      && (row.sourceRevisionRefs || row.dependencyRevisions || []).includes(revisionId))
    .map((row) => ({
      kind: 'RETRIEVAL_RECORD',
      ref: row.id,
      sourceId,
      sourceRevisionId: revisionId,
      resolution: row.resolution,
    }));
}

function listOntologyDependencies(intelligence, sourceId, revisionId) {
  const current = intelligence.ontology.current();
  const edges = (current?.edges || [])
    .filter((row) => row.sourceId === sourceId && row.sourceRevisionId === revisionId)
    .map((row) => ({
      kind: 'ONTOLOGY_EDGE',
      ref: 'ontology-edge:' + stableStringify([row.kind, row.from, row.to, row.predicate || null, revisionId]),
      sourceId,
      sourceRevisionId: revisionId,
    }));
  const communities = (current?.communities || [])
    .filter((row) => (row.sourceIds || []).includes(sourceId) && (row.sourceRevisionRefs || []).includes(revisionId))
    .map((row) => ({
      kind: 'ONTOLOGY_COMMUNITY',
      ref: row.id,
      sourceId,
      sourceRevisionId: revisionId,
    }));
  return [...edges, ...communities];
}

function dedupeRefs(rows) {
  return [...new Set((rows || []).map((row) => row.ref).filter(Boolean))].sort();
}

function sourceIdentity(registry, sourceId, revisionId) {
  if (!revisionId) return null;
  const revision = registry.getRevision(revisionId);
  const source = registry.getEntry(sourceId);
  if (!revision || !source) return null;
  return {
    sourceId,
    lorebookId: source.lorebookId,
    uid: source.uid,
    sourceRevisionId: revision.id,
    revision: revision.revision,
    state: revision.state,
    contentHash: revision.contentHash,
    exactFingerprint: revision.exactFingerprint,
    treePath: deepClone(revision.metadata?.treePath || []),
  };
}

function summarizeBucket(bucket) {
  return {
    added: bucket.added.length,
    removed: bucket.removed.length,
    changed: bucket.changed.length,
  };
}

export class LoreSemanticImpactPlanner {
  constructor({intelligence} = {}) {
    if (!intelligence) throw new TypeError('LoreSemanticImpactPlanner requires LoreIntelligenceService');
    this.intelligence = intelligence;
  }

  plan({sourceId, fromRevisionId = null, toRevisionId = null} = {}) {
    if (!sourceId) throw Object.assign(new TypeError('sourceId is required'), {code: 'LORE_IMPACT_SOURCE_REQUIRED'});
    const registry = this.intelligence.runtime.registry;
    const source = registry.getEntry(sourceId);
    if (!source) throw Object.assign(new Error('Unknown Lore source: ' + sourceId), {code: 'LORE_IMPACT_SOURCE_UNKNOWN'});
    const history = registry.revisionHistory(sourceId);
    const toRevision = toRevisionId
      ? registry.getRevision(toRevisionId)
      : registry.currentRevision(sourceId, {allowMissing: true});
    if (!toRevision || toRevision.sourceId !== sourceId) {
      throw Object.assign(new Error('Target source revision is unavailable'), {code: 'LORE_IMPACT_TARGET_REVISION_UNKNOWN'});
    }
    const fromRevision = fromRevisionId
      ? registry.getRevision(fromRevisionId)
      : history.filter((row) => row.id !== toRevision.id).slice(-1)[0] || null;
    if (fromRevision && fromRevision.sourceId !== sourceId) {
      throw Object.assign(new Error('Source revision fence mismatch'), {code: 'LORE_IMPACT_REVISION_SOURCE_MISMATCH'});
    }

    const beforeRows = revisionArtifacts(this.intelligence.runtime, sourceId, fromRevision?.id || null);
    const afterRows = revisionArtifacts(this.intelligence.runtime, sourceId, toRevision.id);
    if (toRevision.state !== 'REMOVED' && !afterRows.length) {
      throw Object.assign(new Error('Target source revision has not completed study'), {code: 'LORE_IMPACT_TARGET_NOT_STUDIED'});
    }

    const changes = Object.fromEntries(REQUIRED_BUCKETS.map((key) => [key, emptyBucket()]));
    for (const [type, key] of Object.entries(ARTIFACT_BUCKETS)) {
      const bucket = bucketFor(
        beforeRows.filter((row) => row.artifactType === type),
        afterRows.filter((row) => row.artifactType === type),
        registry,
      );
      changes[key].added.push(...bucket.added);
      changes[key].removed.push(...bucket.removed);
      changes[key].changed.push(...bucket.changed);
    }
    changes.TEMPORAL = bucketFor(beforeRows, afterRows, registry, temporalPredicate);
    changes.CONTRADICTION = bucketFor(beforeRows, afterRows, registry, contradictionPredicate);
    changes.BEHAVIORAL_ANCHOR = bucketFor(
      beforeRows,
      afterRows,
      registry,
      (row) => [ArtifactType.RULE, ArtifactType.RESTRICTION, ArtifactType.CAPABILITY].includes(row.artifactType),
    );
    changes.SENSORY_ANCHOR = bucketFor(
      beforeRows,
      afterRows,
      registry,
      (row) => row.artifactType === ArtifactType.PROPERTY && row.payload?.ruleKind === 'SENSORY_ANCHOR',
    );
    for (const key of REQUIRED_BUCKETS) {
      changes[key].added = bounded(changes[key].added);
      changes[key].removed = bounded(changes[key].removed);
      changes[key].changed = bounded(changes[key].changed);
    }

    const meaningChanged = semanticMeaningChanged(beforeRows, afterRows);
    const sourceTextChanged = (fromRevision?.contentHash || null) !== (toRevision.contentHash || null);
    const beforeTreePath = deepClone(fromRevision?.metadata?.treePath || []);
    const afterTreePath = deepClone(toRevision.metadata?.treePath || []);
    const structureChanged = stableStringify(beforeTreePath) !== stableStringify(afterTreePath)
      || stableStringify(fromRevision?.metadata || {}) !== stableStringify(toRevision.metadata || {});

    const representations = fromRevision ? listRepresentationDependencies(this.intelligence, sourceId, fromRevision.id) : [];
    const summaries = fromRevision ? listSummaryDependencies(this.intelligence, fromRevision.id) : [];
    const retrievalRecords = fromRevision ? listRetrievalDependencies(this.intelligence, sourceId, fromRevision.id) : [];
    const ontology = fromRevision ? listOntologyDependencies(this.intelligence, sourceId, fromRevision.id) : [];
    const beforeRetrievalArtifacts = beforeRows
      .filter((row) => [ArtifactType.RETRIEVAL, ArtifactType.COMPACT].includes(row.artifactType))
      .map((row) => ({
        kind: 'RETRIEVAL_ARTIFACT',
        ref: row.id,
        sourceId,
        sourceRevisionId: fromRevision?.id || null,
      }));
    const beforeOntologyArtifacts = beforeRows
      .filter((row) => [ArtifactType.ENTITY, ArtifactType.ALIAS, ArtifactType.RELATIONSHIP, ArtifactType.CONCEPT, ArtifactType.COMMUNITY].includes(row.artifactType))
      .map((row) => ({
        kind: 'ONTOLOGY_SOURCE_ARTIFACT',
        ref: row.id,
        sourceId,
        sourceRevisionId: fromRevision?.id || null,
      }));
    const beforeArtifactRows = beforeRows.map((row) => ({
      kind: 'STUDY_ARTIFACT',
      ref: row.id,
      sourceId,
      sourceRevisionId: fromRevision?.id || null,
      artifactType: row.artifactType,
    }));

    const direct = bounded([
      ...beforeArtifactRows,
      ...representations,
      ...retrievalRecords,
      ...beforeRetrievalArtifacts,
    ], MAX_REFS);
    const transitive = bounded([
      ...summaries,
      ...ontology,
      ...beforeOntologyArtifacts,
    ], MAX_REFS);

    const required = [];
    if (fromRevision?.id !== toRevision.id) {
      required.push({
        target: 'STUDY_ARTIFACTS',
        action: 'REGENERATE',
        reason: 'SOURCE_REVISION_CHANGED',
        refs: bounded(beforeArtifactRows.map((row) => row.ref), MAX_REFS),
      });
      if (representations.length) required.push({
        target: 'REPRESENTATIONS',
        action: 'REGENERATE',
        reason: 'SOURCE_REVISION_FENCE_CHANGED',
        refs: bounded(dedupeRefs(representations), MAX_REFS),
      });
      if (retrievalRecords.length || beforeRetrievalArtifacts.length) required.push({
        target: 'RETRIEVAL_INDEX',
        action: 'REINDEX',
        reason: 'SOURCE_REVISION_FENCE_CHANGED',
        refs: bounded([...new Set([...dedupeRefs(retrievalRecords), ...dedupeRefs(beforeRetrievalArtifacts)])].sort(), MAX_REFS),
      });
      if (summaries.length) required.push({
        target: 'NAVIGATION_SUMMARIES',
        action: 'REGENERATE',
        reason: 'EXPLICIT_SOURCE_REVISION_DEPENDENCY',
        refs: bounded(dedupeRefs(summaries), MAX_REFS),
      });
      if (meaningChanged && (ontology.length || beforeOntologyArtifacts.length)) required.push({
        target: 'ONTOLOGY',
        action: 'REGENERATE',
        reason: 'SEMANTIC_MEANING_CHANGED',
        refs: bounded([...new Set([...dedupeRefs(ontology), ...dedupeRefs(beforeOntologyArtifacts)])].sort(), MAX_REFS),
      });
      if (structureChanged) required.push({
        target: 'HUMAN_TREE_CLASSIFICATION',
        action: 'REVIEW',
        reason: 'AUTHORED_STRUCTURE_METADATA_CHANGED',
        refs: [sourceId],
      });
    }

    const edges = [
      ...direct.map((row) => ({
        class: row.kind === 'RETRIEVAL_RECORD' ? 'REINDEX' : row.kind === 'REPRESENTATION' ? 'REGENERATE' : 'DIRECT',
        from: fromRevision?.id || sourceId,
        to: row.ref,
        dependencyKind: row.kind,
      })),
      ...transitive.map((row) => ({
        class: row.kind === 'ONTOLOGY_EDGE' || row.kind === 'ONTOLOGY_COMMUNITY' ? 'TRANSITIVE' : 'REGENERATE',
        from: fromRevision?.id || sourceId,
        to: row.ref,
        dependencyKind: row.kind,
      })),
    ];

    const invalidatedRefs = bounded([
      ...direct.map((row) => row.ref),
      ...transitive.map((row) => row.ref),
    ], MAX_REFS);

    const currentUnrelatedSources = this.intelligence.runtime.registry.listEntries({includeRemoved: false})
      .filter((row) => row.sourceId !== sourceId);
    const allCurrentArtifacts = this.intelligence.runtime.store.currentArtifacts(this.intelligence.runtime.registry);
    const preservedRefs = bounded(
      allCurrentArtifacts.filter((row) => row.sourceId !== sourceId).map((row) => row.id).sort(),
      MAX_REFS,
    );
    edges.push(...preservedRefs.slice(0, 32).map((ref) => ({
      class: 'PRESERVE',
      from: sourceId,
      to: ref,
      dependencyKind: 'UNRELATED_SOURCE_ARTIFACT',
    })));

    const totalChangeRows = Object.values(changes).reduce(
      (sum, bucket) => sum + bucket.added.length + bucket.removed.length + bucket.changed.length,
      0,
    );

    return {
      kind: 'LoreSemanticImpactPlan',
      contractVersion: 1,
      source: sourceIdentity(registry, sourceId, toRevision.id),
      previousSource: sourceIdentity(registry, sourceId, fromRevision?.id || null),
      exactSourcePreserved: true,
      classification: {
        sourceTextChanged,
        meaningChanged,
        wordingOnly: Boolean(sourceTextChanged && !meaningChanged && !structureChanged),
        structureChanged,
        targetRemoved: toRevision.state === 'REMOVED',
      },
      structure: {
        changed: structureChanged,
        beforeTreePath,
        afterTreePath,
        treePlacementTruthAuthority: false,
      },
      changes,
      counts: {
        totalChangeRows,
        byCategory: Object.fromEntries(Object.entries(changes).map(([key, bucket]) => [key, summarizeBucket(bucket)])),
      },
      impact: {
        kind: 'LoreDependencyImpactCone',
        sourceId,
        fromRevisionId: fromRevision?.id || null,
        toRevisionId: toRevision.id,
        direct,
        transitive,
        required,
        edges: bounded(edges, MAX_REFS),
        invalidatedRefs,
        preserved: {
          unrelatedSourceCount: currentUnrelatedSources.length,
          unrelatedArtifactCount: allCurrentArtifacts.filter((row) => row.sourceId !== sourceId).length,
          refs: preservedRefs,
        },
        unrelatedSourcesInvalidated: false,
        dependencyEdgesInferred: false,
        missingDependencyEvidence: [],
      },
      bounds: {
        maxRowsPerCategory: MAX_ROWS,
        maxRefs: MAX_REFS,
        truncated: Object.values(changes).some((bucket) => (
          bucket.added.length >= MAX_ROWS || bucket.removed.length >= MAX_ROWS || bucket.changed.length >= MAX_ROWS
        )) || edges.length > MAX_REFS,
      },
      authority: {
        sourceMutationAuthority: false,
        truthAuthority: false,
        settlementAuthority: false,
        modelMutationAuthority: false,
        jevMutationAuthority: false,
      },
    };
  }
}
