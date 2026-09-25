import {ArtifactType, deepClone, stableHash, stableStringify} from './lore-contracts.js';
import {semanticDiff} from './lore-study-engine.js';
import {LoreIntelligenceService} from './lore-intelligence-service.js';
import {LoreInvalidationTarget, sourceRevisionIdentity} from './lore-authoring-contracts.js';

function splitSentences(content) {
  return String(content || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((text) => text.trim())
    .filter(Boolean);
}

function artifactMeaning(artifact) {
  return stableStringify({
    artifactType: artifact.artifactType,
    logicalKey: artifact.logicalKey,
    payload: artifact.payload,
    authorityClass: artifact.authorityClass,
    temporalClass: artifact.temporalClass,
    confidence: artifact.confidence,
    unresolved: artifact.unresolved,
  });
}

function claimSlot(artifact) {
  if (artifact?.artifactType !== ArtifactType.CLAIM) return null;
  return artifact.payload.subjectId + '|' + artifact.payload.predicate;
}

function relationshipSlot(artifact) {
  if (artifact?.artifactType !== ArtifactType.RELATIONSHIP) return null;
  return artifact.payload.subjectId + '|' + artifact.payload.predicate + '|' + artifact.payload.objectId;
}

function artifactsByType(artifacts, type) {
  return (artifacts || []).filter((row) => row.artifactType === type);
}

function semanticMap(artifacts) {
  return new Map((artifacts || []).map((row) => [row.semanticId, row]));
}

function changedSameSemantic(before, after) {
  const left = semanticMap(before);
  const right = semanticMap(after);
  const rows = [];
  for (const [semanticId, oldArtifact] of left.entries()) {
    const nextArtifact = right.get(semanticId);
    if (!nextArtifact) continue;
    if (artifactMeaning(oldArtifact) !== artifactMeaning(nextArtifact)) {
      rows.push({semanticId, oldArtifact, nextArtifact});
    }
  }
  return rows.sort((a, b) => a.semanticId.localeCompare(b.semanticId));
}

function deltaForType(before, after, type) {
  const oldRows = artifactsByType(before, type);
  const newRows = artifactsByType(after, type);
  const oldMap = semanticMap(oldRows);
  const newMap = semanticMap(newRows);
  return {
    added: [...newMap.values()].filter((row) => !oldMap.has(row.semanticId)),
    removed: [...oldMap.values()].filter((row) => !newMap.has(row.semanticId)),
    altered: changedSameSemantic(oldRows, newRows),
  };
}

function revisionArtifacts(runtime, sourceId, sourceRevisionId) {
  const learned = runtime.store.learnedHistory(sourceId)
    .find((row) => row.sourceRevisionId === sourceRevisionId);
  if (!learned) return {learned: null, artifacts: []};
  return {
    learned,
    artifacts: runtime.store.artifactsForLearnedRevision(learned.id),
  };
}

function sourceDrillback(registry, artifact) {
  const revision = registry.getRevision(artifact.sourceRevisionId);
  if (!revision) return null;
  const sentenceIndex = artifact.provenance?.span?.sentenceIndex;
  const sentences = splitSentences(revision.exactContent || '');
  const excerpt = Number.isInteger(sentenceIndex) ? sentences[sentenceIndex] || null : null;
  return {
    kind: 'LoreExactSourceDrillback',
    sourceId: artifact.sourceId,
    sourceRevisionId: artifact.sourceRevisionId,
    lorebookId: revision.lorebookId,
    uid: revision.uid,
    contentHash: revision.contentHash,
    sentenceIndex: Number.isInteger(sentenceIndex) ? sentenceIndex : null,
    exactExcerpt: excerpt,
    exactSourceText: revision.exactContent,
    span: deepClone(artifact.provenance?.span || null),
    derivation: artifact.provenance?.derivation || null,
    evidenceArtifactId: artifact.id,
    semanticId: artifact.semanticId,
    sourceAuthority: true,
  };
}

function describeArtifact(registry, artifact) {
  return {
    artifactId: artifact.id,
    semanticId: artifact.semanticId,
    artifactType: artifact.artifactType,
    logicalKey: artifact.logicalKey,
    payload: deepClone(artifact.payload),
    temporalClass: artifact.temporalClass,
    authorityClass: artifact.authorityClass,
    unresolved: Boolean(artifact.unresolved),
    drillback: sourceDrillback(registry, artifact),
  };
}

function alterationRows(registry, rows) {
  return rows.map(({semanticId, oldArtifact, nextArtifact}) => ({
    semanticId,
    from: describeArtifact(registry, oldArtifact),
    to: describeArtifact(registry, nextArtifact),
  }));
}

function changedClaimSlots(beforeClaims, afterClaims) {
  const oldBySlot = new Map();
  const newBySlot = new Map();
  for (const row of beforeClaims) {
    const key = claimSlot(row);
    const bucket = oldBySlot.get(key) || [];
    bucket.push(row);
    oldBySlot.set(key, bucket);
  }
  for (const row of afterClaims) {
    const key = claimSlot(row);
    const bucket = newBySlot.get(key) || [];
    bucket.push(row);
    newBySlot.set(key, bucket);
  }

  const altered = [];
  for (const [slot, oldRows] of oldBySlot.entries()) {
    const nextRows = newBySlot.get(slot) || [];
    for (const oldArtifact of oldRows) {
      for (const nextArtifact of nextRows) {
        if (stableStringify(oldArtifact.payload.value) === stableStringify(nextArtifact.payload.value)
          && oldArtifact.temporalClass === nextArtifact.temporalClass
          && oldArtifact.authorityClass === nextArtifact.authorityClass
          && Boolean(oldArtifact.unresolved) === Boolean(nextArtifact.unresolved)) continue;
        altered.push({slot, oldArtifact, nextArtifact});
      }
    }
  }

  const unique = new Map();
  for (const row of altered) {
    const key = row.oldArtifact.semanticId + '|' + row.nextArtifact.semanticId;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) => (
    (a.slot + a.oldArtifact.semanticId + a.nextArtifact.semanticId)
      .localeCompare(b.slot + b.oldArtifact.semanticId + b.nextArtifact.semanticId)
  ));
}

function claimTransition(registry, row) {
  const newUnresolved = Boolean(row.nextArtifact.unresolved)
    || row.nextArtifact.authorityClass === 'UNRESOLVED'
    || ['UNCERTAIN', 'CONFLICTING'].includes(row.nextArtifact.temporalClass);
  return {
    slot: row.slot,
    status: newUnresolved ? 'UNRESOLVED' : 'SUPERSEDED',
    from: describeArtifact(registry, row.oldArtifact),
    to: describeArtifact(registry, row.nextArtifact),
  };
}

function listRepresentationDependencies(intelligence, sourceId, fromRevisionId) {
  const snapshot = intelligence.multiResolution.registry.snapshot();
  return (snapshot.representations || [])
    .filter((row) => row.sourceId === sourceId && row.sourceRevisionId === fromRevisionId)
    .map((row) => ({
      representationRef: row.id,
      profile: row.profile,
      sourceRevisionId: row.sourceRevisionId,
      state: row.state,
    }))
    .sort((a, b) => a.representationRef.localeCompare(b.representationRef));
}

function listSummaryDependencies(intelligence, fromRevisionId) {
  const snapshot = intelligence.hierarchy.summaryRegistry.snapshot();
  return (snapshot.summaries || [])
    .filter((row) => (row.sourceRevisionSet || []).includes(fromRevisionId))
    .map((row) => ({
      summaryRef: row.id,
      scopeId: row.targetScopeId,
      state: row.state,
      freshness: row.freshness,
    }))
    .sort((a, b) => a.summaryRef.localeCompare(b.summaryRef));
}

function listRetrievalDependencies(intelligence, sourceId, fromRevisionId) {
  const snapshot = intelligence.hierarchy.retrievalIndex.snapshot();
  return (snapshot.records || [])
    .filter((row) => (row.sourceIds || []).includes(sourceId)
      && (row.sourceRevisionRefs || row.dependencyRevisions || []).includes(fromRevisionId))
    .map((row) => ({
      retrievalRecordRef: row.id,
      resolution: row.resolution,
      artifactRef: row.artifactId || null,
      sourceRevisionRefs: [...(row.sourceRevisionRefs || row.dependencyRevisions || [])],
    }))
    .sort((a, b) => a.retrievalRecordRef.localeCompare(b.retrievalRecordRef));
}

function ontologyAffected(diff) {
  const types = new Set([
    ...Object.keys(diff.addedByType || {}),
    ...Object.keys(diff.removedByType || {}),
  ]);
  return types.has(ArtifactType.CONCEPT)
    || types.has(ArtifactType.COMMUNITY)
    || types.has(ArtifactType.RELATIONSHIP)
    || types.has(ArtifactType.ENTITY)
    || types.has(ArtifactType.ALIAS);
}

export class LoreSemanticCompiler {
  constructor({intelligence} = {}) {
    if (!intelligence) throw new TypeError('LoreSemanticCompiler requires LoreIntelligenceService');
    this.intelligence = intelligence;
  }

  sourceIdentity(sourceId, revisionId = null) {
    return sourceRevisionIdentity(this.intelligence.runtime.registry, sourceId, revisionId);
  }

  semanticChangeReport({sourceId, fromRevisionId = null, toRevisionId = null} = {}) {
    if (!sourceId) {
      throw Object.assign(new TypeError('sourceId is required'), {code: 'LORE_AUTHORING_SOURCE_ID_REQUIRED'});
    }
    const registry = this.intelligence.runtime.registry;
    const history = registry.revisionHistory(sourceId);
    if (!history.length) {
      throw Object.assign(new Error('Unknown Lore source: ' + sourceId), {code: 'LORE_AUTHORING_SOURCE_UNKNOWN'});
    }
    const toRevision = toRevisionId
      ? registry.getRevision(toRevisionId)
      : registry.currentRevision(sourceId, {allowMissing: true});
    if (!toRevision || toRevision.sourceId !== sourceId) {
      throw Object.assign(new Error('Target Lore revision not found'), {code: 'LORE_AUTHORING_TARGET_REVISION_UNKNOWN'});
    }
    const fromRevision = fromRevisionId
      ? registry.getRevision(fromRevisionId)
      : history.filter((row) => row.id !== toRevision.id).slice(-1)[0] || null;
    if (fromRevision && fromRevision.sourceId !== sourceId) {
      throw Object.assign(new Error('Base Lore revision belongs to another source'), {code: 'LORE_AUTHORING_REVISION_SOURCE_MISMATCH'});
    }

    const before = fromRevision ? revisionArtifacts(this.intelligence.runtime, sourceId, fromRevision.id) : {learned: null, artifacts: []};
    const after = revisionArtifacts(this.intelligence.runtime, sourceId, toRevision.id);
    if (toRevision.state !== 'REMOVED' && !after.learned) {
      throw Object.assign(new Error('Target Lore revision has not completed study'), {code: 'LORE_AUTHORING_TARGET_NOT_STUDIED'});
    }

    const baseDiff = semanticDiff(before.artifacts, after.artifacts);
    const claimDelta = deltaForType(before.artifacts, after.artifacts, ArtifactType.CLAIM);
    const relationshipDelta = deltaForType(before.artifacts, after.artifacts, ArtifactType.RELATIONSHIP);
    const conceptDelta = deltaForType(before.artifacts, after.artifacts, ArtifactType.CONCEPT);
    const claimTransitions = changedClaimSlots(
      artifactsByType(before.artifacts, ArtifactType.CLAIM),
      artifactsByType(after.artifacts, ArtifactType.CLAIM),
    ).map((row) => claimTransition(registry, row));
    const supersededClaims = claimTransitions.filter((row) => row.status === 'SUPERSEDED');
    const unresolvedClaims = [
      ...claimTransitions.filter((row) => row.status === 'UNRESOLVED'),
      ...claimDelta.added
        .filter((row) => row.unresolved || row.authorityClass === 'UNRESOLVED' || ['UNCERTAIN', 'CONFLICTING'].includes(row.temporalClass))
        .map((row) => ({
          slot: claimSlot(row),
          status: 'UNRESOLVED',
          from: null,
          to: describeArtifact(registry, row),
        })),
    ];

    const representations = fromRevision
      ? listRepresentationDependencies(this.intelligence, sourceId, fromRevision.id)
      : [];
    const summaries = fromRevision
      ? listSummaryDependencies(this.intelligence, fromRevision.id)
      : [];
    const retrieval = fromRevision
      ? listRetrievalDependencies(this.intelligence, sourceId, fromRevision.id)
      : [];

    const invalidationTargets = [];
    if (fromRevision?.id !== toRevision.id) {
      invalidationTargets.push({
        target: LoreInvalidationTarget.STUDY_ARTIFACTS,
        reason: 'SOURCE_REVISION_CHANGED',
        sourceId,
        fromRevisionId: fromRevision?.id || null,
        toRevisionId: toRevision.id,
        refs: before.artifacts.map((row) => row.id).sort(),
      });
      if (representations.length) invalidationTargets.push({
        target: LoreInvalidationTarget.REPRESENTATIONS,
        reason: 'SOURCE_REVISION_FENCE_CHANGED',
        refs: representations.map((row) => row.representationRef),
      });
      if (retrieval.length) invalidationTargets.push({
        target: LoreInvalidationTarget.RETRIEVAL_INDEX,
        reason: 'SOURCE_RETRIEVAL_DEPENDENCY_CHANGED',
        refs: retrieval.map((row) => row.retrievalRecordRef),
      });
      if (summaries.length) invalidationTargets.push({
        target: LoreInvalidationTarget.NAVIGATION_SUMMARIES,
        reason: 'SUMMARY_SOURCE_REVISION_SET_CHANGED',
        refs: summaries.map((row) => row.summaryRef),
      });
      if (ontologyAffected(baseDiff)) invalidationTargets.push({
        target: LoreInvalidationTarget.ONTOLOGY,
        reason: 'SEMANTIC_MEMBERSHIP_OR_RELATIONSHIP_CHANGED',
        refs: [
          ...conceptDelta.removed.map((row) => row.semanticId),
          ...conceptDelta.added.map((row) => row.semanticId),
          ...relationshipDelta.removed.map((row) => row.semanticId),
          ...relationshipDelta.added.map((row) => row.semanticId),
        ].sort(),
      });
    }

    return {
      kind: 'LoreSemanticChangeReport',
      contractVersion: 1,
      source: this.sourceIdentity(sourceId, toRevision.id),
      previousSource: fromRevision ? this.sourceIdentity(sourceId, fromRevision.id) : null,
      exactSourcePreserved: true,
      semantic: {
        added: baseDiff.addedSemanticIds,
        removed: baseDiff.removedSemanticIds,
        preserved: baseDiff.preservedSemanticIds,
        altered: changedSameSemantic(before.artifacts, after.artifacts).map((row) => row.semanticId),
        meaningChanged: baseDiff.meaningChanged || changedSameSemantic(before.artifacts, after.artifacts).length > 0,
      },
      claims: {
        added: claimDelta.added.map((row) => describeArtifact(registry, row)),
        removed: claimDelta.removed.map((row) => describeArtifact(registry, row)),
        altered: claimTransitions,
        superseded: supersededClaims,
        unresolved: unresolvedClaims,
      },
      relationships: {
        added: relationshipDelta.added.map((row) => describeArtifact(registry, row)),
        removed: relationshipDelta.removed.map((row) => describeArtifact(registry, row)),
        altered: alterationRows(registry, relationshipDelta.altered),
      },
      concepts: {
        added: conceptDelta.added.map((row) => describeArtifact(registry, row)),
        removed: conceptDelta.removed.map((row) => describeArtifact(registry, row)),
        altered: alterationRows(registry, conceptDelta.altered),
      },
      invalidationPlan: {
        kind: 'LoreRetrievalInvalidationPlan',
        contractVersion: 1,
        sourceId,
        fromRevisionId: fromRevision?.id || null,
        toRevisionId: toRevision.id,
        targets: invalidationTargets,
        representations,
        summaries,
        retrievalRecords: retrieval,
        minimalityRule: 'Only artifacts fenced by the changed source revision, or semantic aggregates that depend on them, are invalidated.',
        unrelatedSourcesInvalidated: false,
        destructiveMutationAuthority: false,
      },
      rawSemanticDiff: deepClone(baseDiff),
    };
  }

  previewEdit({sourceId, content, metadata = null} = {}) {
    if (!sourceId || typeof content !== 'string') {
      throw Object.assign(new TypeError('sourceId and exact authored content are required'), {code: 'LORE_AUTHORING_EDIT_INPUT_REQUIRED'});
    }
    const originalRegistry = this.intelligence.runtime.registry;
    const source = originalRegistry.getEntry(sourceId);
    const current = originalRegistry.currentRevision(sourceId, {allowMissing: true});
    if (!source || !current || current.state === 'REMOVED') {
      throw Object.assign(new Error('Editable current Lore source not found'), {code: 'LORE_AUTHORING_EDIT_SOURCE_NOT_CURRENT'});
    }
    const sourceSnapshot = originalRegistry.snapshot();
    const book = (sourceSnapshot.books || []).find((row) => row.id === source.lorebookId);
    if (!book) {
      throw Object.assign(new Error('Lorebook identity missing from Source Registry'), {code: 'LORE_AUTHORING_BOOK_IDENTITY_MISSING'});
    }

    const entries = originalRegistry.listEntries({includeRemoved: false})
      .filter((row) => row.lorebookId === source.lorebookId)
      .map((row) => {
        const revision = originalRegistry.currentRevision(row.sourceId);
        return {
          uid: row.uid,
          content: row.sourceId === sourceId ? content : revision.exactContent,
          metadata: row.sourceId === sourceId
            ? deepClone(metadata == null ? revision.metadata : metadata)
            : deepClone(revision.metadata),
        };
      });

    const preview = LoreIntelligenceService.fromSnapshot(this.intelligence.snapshot());
    const discovery = deepClone(book.metadata?.discovery
      || this.intelligence.lastAcceptance?.lorebookId === source.lorebookId
        ? this.intelligence.lastAcceptance?.discovery
        : null);
    if (!discovery) {
      throw Object.assign(new Error('Source discovery identity is not persisted for this Lorebook'), {code: 'LORE_AUTHORING_DISCOVERY_IDENTITY_MISSING'});
    }

    const beforeStatus = this.intelligence.status();
    const acceptance = preview.acceptLorebook({
      id: book.id,
      title: book.title,
      metadata: deepClone(book.metadata || {}),
      discovery,
      entries,
      fullSnapshot: true,
    });
    const study = preview.runStudy();
    const previewCompiler = new LoreSemanticCompiler({intelligence: preview});
    const nextRevision = preview.runtime.registry.currentRevision(sourceId);
    const report = previewCompiler.semanticChangeReport({
      sourceId,
      fromRevisionId: current.id,
      toRevisionId: nextRevision.id,
    });

    const afterStatus = preview.status();
    const beforeBySource = new Map(beforeStatus.entries.map((row) => [row.sourceId, row]));
    const unaffected = afterStatus.entries
      .filter((row) => row.sourceId !== sourceId)
      .map((row) => {
        const before = beforeBySource.get(row.sourceId);
        return {
          sourceId: row.sourceId,
          sourceRevisionId: row.sourceRevisionId,
          unchangedRevision: before?.sourceRevisionId === row.sourceRevisionId,
          operatorStateBefore: before?.operatorState || null,
          operatorStateAfter: row.operatorState,
          remainsReady: before?.operatorState === 'READY' ? row.operatorState === 'READY' : true,
        };
      });

    return {
      kind: 'LoreEditImpactPreview',
      contractVersion: 1,
      sourceId,
      baseSourceRevisionId: current.id,
      proposedSourceRevisionId: nextRevision.id,
      originalServiceMutated: false,
      acceptance: deepClone(acceptance),
      study: {
        completed: study.results?.every((row) => row.state === 'COMPLETED') ?? true,
        compilationCount: study.compilations?.length || 0,
      },
      semanticChange: report,
      unaffectedSources: unaffected,
      allPreviouslyReadyUnrelatedSourcesRemainReady: unaffected.every((row) => row.remainsReady),
      previewOnly: true,
      mutationAuthority: false,
    };
  }
}

export function semanticReportId(report) {
  return 'lore-semantic-report:' + stableHash({
    sourceId: report.source?.sourceId,
    previous: report.previousSource?.sourceRevisionId || null,
    current: report.source?.sourceRevisionId || null,
    semantic: report.semantic,
  });
}
