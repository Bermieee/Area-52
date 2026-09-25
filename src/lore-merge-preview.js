import {ArtifactType, deepClone, slug, stableHash, stableStringify} from './lore-contracts.js';
import {LoreMergeClassification, LoreReviewState, makeReviewItem, sourceRevisionIdentity} from './lore-authoring-contracts.js';

const FACT_TYPES = new Set([
  ArtifactType.CLAIM,
  ArtifactType.RELATIONSHIP,
  ArtifactType.RULE,
  ArtifactType.CAPABILITY,
  ArtifactType.RESTRICTION,
  ArtifactType.EVENT,
  ArtifactType.CONCEPT,
]);

function studiedRow(intelligence, source) {
  const revision = intelligence.runtime.registry.currentRevision(source.sourceId, {allowMissing: true});
  const learned = intelligence.runtime.store.currentLearnedRevision(source.sourceId);
  if (!revision || revision.state === 'REMOVED' || !learned || learned.state !== 'CURRENT' || learned.sourceRevisionId !== revision.id) {
    return null;
  }
  return {
    source,
    revision,
    learned,
    artifacts: intelligence.runtime.store.artifactsForLearnedRevision(learned.id),
  };
}

function titleFor(row) {
  return row.revision.metadata?.title || row.source.uid;
}

function normalizedTitle(row) {
  return slug(titleFor(row));
}

function setIntersection(a, b) {
  const rows = [];
  for (const value of a) if (b.has(value)) rows.push(value);
  return rows;
}

function jaccard(a, b) {
  const union = new Set([...a, ...b]);
  if (!union.size) return 0;
  return setIntersection(a, b).length / union.size;
}

function factSet(row) {
  return new Set(row.artifacts.filter((artifact) => FACT_TYPES.has(artifact.artifactType)).map((artifact) => artifact.semanticId));
}

function entitySet(row) {
  return new Set(row.artifacts
    .filter((artifact) => artifact.artifactType === ArtifactType.ENTITY)
    .map((artifact) => artifact.payload.entityId));
}

function claimRows(row) {
  return row.artifacts.filter((artifact) => artifact.artifactType === ArtifactType.CLAIM);
}

function claimSlot(artifact) {
  return artifact.payload.subjectId + '|' + artifact.payload.predicate;
}

function contradictions(left, right) {
  const a = new Map();
  const b = new Map();
  for (const claim of claimRows(left)) {
    const bucket = a.get(claimSlot(claim)) || [];
    bucket.push(claim);
    a.set(claimSlot(claim), bucket);
  }
  for (const claim of claimRows(right)) {
    const bucket = b.get(claimSlot(claim)) || [];
    bucket.push(claim);
    b.set(claimSlot(claim), bucket);
  }
  const rows = [];
  for (const [slot, leftClaims] of a.entries()) {
    const rightClaims = b.get(slot) || [];
    for (const x of leftClaims) {
      for (const y of rightClaims) {
        if (stableStringify(x.payload.value) === stableStringify(y.payload.value)) continue;
        const clearlySequenced = (
          x.temporalClass === 'HISTORICAL' && ['CURRENT', 'SEQUENCE'].includes(y.temporalClass)
        ) || (
          y.temporalClass === 'HISTORICAL' && ['CURRENT', 'SEQUENCE'].includes(x.temporalClass)
        );
        if (clearlySequenced) continue;
        rows.push({
          slot,
          leftClaimRef: x.id,
          rightClaimRef: y.id,
          leftSemanticId: x.semanticId,
          rightSemanticId: y.semanticId,
          leftValue: deepClone(x.payload.value),
          rightValue: deepClone(y.payload.value),
          leftTemporalClass: x.temporalClass,
          rightTemporalClass: y.temporalClass,
          unresolved: true,
        });
      }
    }
  }
  return rows.sort((x, y) => stableStringify(x).localeCompare(stableStringify(y)));
}

function pairId(left, right) {
  return 'lore-merge-pair:' + stableHash([left.source.sourceId, right.source.sourceId].sort());
}

function classification(kind, left, right, details = {}) {
  return {
    kind: 'LoreMergeClassification',
    id: 'lore-merge-class:' + stableHash({kind, left: left.source.sourceId, right: right.source.sourceId, details}),
    classification: kind,
    leftSourceId: left.source.sourceId,
    rightSourceId: right.source.sourceId,
    leftSourceRevisionId: left.revision.id,
    rightSourceRevisionId: right.revision.id,
    details: deepClone(details),
    reviewState: LoreReviewState.NEEDS_REVIEW,
    destructiveMutationAuthority: false,
  };
}

function sourceRevisionHistory(registry, sourceId) {
  return registry.revisionHistory(sourceId).map((revision) => ({
    sourceRevisionId: revision.id,
    revision: revision.revision,
    state: revision.state,
    contentHash: revision.contentHash,
    exactFingerprint: revision.exactFingerprint,
    exactContent: revision.exactContent,
    metadata: deepClone(revision.metadata || {}),
    replacesRevisionId: revision.replacesRevisionId || null,
  }));
}

function outputForSource(row) {
  const facts = [...factSet(row)].sort();
  return {
    kind: 'LoreMergeOutputEntryPreview',
    outputId: 'lore-merge-output:' + stableHash(row.revision.id),
    strategy: 'KEEP_SOURCE_ENTRY',
    title: titleFor(row),
    uid: row.source.uid,
    sourceRefs: [row.source.sourceId],
    sourceRevisionRefs: [row.revision.id],
    exactContent: row.revision.exactContent,
    metadata: deepClone(row.revision.metadata || {}),
    semanticFactRefs: facts,
    uniqueFactRefs: facts,
    synthesizedText: false,
    reviewState: LoreReviewState.PROPOSED,
  };
}

export class LoreMergePreviewer {
  constructor({intelligence} = {}) {
    if (!intelligence) throw new TypeError('LoreMergePreviewer requires LoreIntelligenceService');
    this.intelligence = intelligence;
  }

  preview({lorebookIds} = {}) {
    if (!Array.isArray(lorebookIds) || lorebookIds.length !== 2 || lorebookIds[0] === lorebookIds[1]) {
      throw Object.assign(new TypeError('Exactly two distinct Lorebook ids are required'), {code: 'LORE_MERGE_TWO_BOOKS_REQUIRED'});
    }
    const [leftBookId, rightBookId] = lorebookIds.map(String);
    const registry = this.intelligence.runtime.registry;
    const all = registry.listEntries({includeRemoved: false}).map((source) => studiedRow(this.intelligence, source)).filter(Boolean);
    const leftRows = all.filter((row) => row.source.lorebookId === leftBookId);
    const rightRows = all.filter((row) => row.source.lorebookId === rightBookId);
    if (!leftRows.length || !rightRows.length) {
      throw Object.assign(new Error('Both Lorebooks must contain current studied entries'), {code: 'LORE_MERGE_BOOK_NOT_READY'});
    }

    const exactDuplicates = [];
    const likelyOverlap = [];
    const complementary = [];
    const titleKeyCollisions = [];
    const unresolvedContradictions = [];
    const reviewItems = [];
    const pairDiagnostics = [];

    for (const left of leftRows) {
      for (const right of rightRows) {
        const leftFacts = factSet(left);
        const rightFacts = factSet(right);
        const sharedFacts = setIntersection(leftFacts, rightFacts).sort();
        const leftUnique = [...leftFacts].filter((id) => !rightFacts.has(id)).sort();
        const rightUnique = [...rightFacts].filter((id) => !leftFacts.has(id)).sort();
        const sharedEntities = setIntersection(entitySet(left), entitySet(right)).sort();
        const semanticSimilarity = jaccard(leftFacts, rightFacts);
        const conflictRows = contradictions(left, right);
        const exact = left.revision.contentHash === right.revision.contentHash
          && left.revision.exactContent === right.revision.exactContent;
        const titleCollision = normalizedTitle(left) === normalizedTitle(right);
        const keyCollision = String(left.source.uid) === String(right.source.uid);

        pairDiagnostics.push({
          pairId: pairId(left, right),
          leftSourceId: left.source.sourceId,
          rightSourceId: right.source.sourceId,
          semanticSimilarity,
          sharedFactCount: sharedFacts.length,
          sharedEntityCount: sharedEntities.length,
          scoreAuthority: false,
        });

        if (exact) {
          exactDuplicates.push(classification(LoreMergeClassification.EXACT_DUPLICATE, left, right, {
            contentHash: left.revision.contentHash,
            sameExactAuthoredText: true,
          }));
        }
        if (titleCollision || keyCollision) {
          titleKeyCollisions.push(classification(LoreMergeClassification.TITLE_KEY_COLLISION, left, right, {
            titleCollision,
            keyCollision,
            leftTitle: titleFor(left),
            rightTitle: titleFor(right),
            leftUid: left.source.uid,
            rightUid: right.source.uid,
          }));
        }
        if (conflictRows.length) {
          const row = classification(LoreMergeClassification.UNRESOLVED_CONTRADICTION, left, right, {
            contradictions: conflictRows,
          });
          unresolvedContradictions.push(row);
          reviewItems.push(makeReviewItem({
            type: 'MERGE_CONTRADICTION',
            message: 'Current source-backed claims disagree and no deterministic temporal supersession resolves them.',
            sourceIds: [left.source.sourceId, right.source.sourceId],
            evidenceRefs: conflictRows.flatMap((conflict) => [conflict.leftClaimRef, conflict.rightClaimRef]),
            details: {pairId: pairId(left, right), contradictions: conflictRows},
          }));
        }
        if (!exact && (semanticSimilarity >= 0.2 || sharedFacts.length >= 1 || sharedEntities.length >= 2)) {
          likelyOverlap.push(classification(LoreMergeClassification.LIKELY_OVERLAP, left, right, {
            semanticSimilarity,
            sharedFactRefs: sharedFacts,
            sharedEntityRefs: sharedEntities,
            scoreAuthority: false,
          }));
        }
        if (!exact && sharedEntities.length >= 1 && leftUnique.length && rightUnique.length) {
          complementary.push(classification(LoreMergeClassification.COMPLEMENTARY, left, right, {
            sharedEntityRefs: sharedEntities,
            leftUniqueFactRefs: leftUnique,
            rightUniqueFactRefs: rightUnique,
            uniqueFactsRetainedByDefault: true,
          }));
        }
      }
    }

    const duplicateGroups = new Map();
    for (const row of [...leftRows, ...rightRows]) {
      const bucket = duplicateGroups.get(row.revision.contentHash) || [];
      bucket.push(row);
      duplicateGroups.set(row.revision.contentHash, bucket);
    }

    const sourceToOutput = new Map();
    const proposedOutput = [];
    for (const group of duplicateGroups.values()) {
      const books = new Set(group.map((row) => row.source.lorebookId));
      const exactText = group.every((row) => row.revision.exactContent === group[0].revision.exactContent);
      if (group.length >= 2 && books.size >= 2 && exactText) {
        const facts = new Set(group.flatMap((row) => [...factSet(row)]));
        const output = {
          kind: 'LoreMergeOutputEntryPreview',
          outputId: 'lore-merge-output:' + stableHash(group.map((row) => row.revision.id).sort()),
          strategy: 'CONSOLIDATE_EXACT_DUPLICATE_PREVIEW_ONLY',
          title: titleFor(group[0]),
          uid: group[0].source.uid,
          sourceRefs: group.map((row) => row.source.sourceId).sort(),
          sourceRevisionRefs: group.map((row) => row.revision.id).sort(),
          exactContent: group[0].revision.exactContent,
          metadata: deepClone(group[0].revision.metadata || {}),
          semanticFactRefs: [...facts].sort(),
          uniqueFactRefs: [...facts].sort(),
          synthesizedText: false,
          reviewState: LoreReviewState.NEEDS_REVIEW,
        };
        proposedOutput.push(output);
        for (const row of group) sourceToOutput.set(row.source.sourceId, output.outputId);
      }
    }

    for (const row of [...leftRows, ...rightRows]) {
      if (sourceToOutput.has(row.source.sourceId)) continue;
      const output = outputForSource(row);
      proposedOutput.push(output);
      sourceToOutput.set(row.source.sourceId, output.outputId);
    }

    const contradictionSources = new Set(unresolvedContradictions.flatMap((row) => [row.leftSourceId, row.rightSourceId]));
    for (const row of unresolvedContradictions) {
      const leftOutput = sourceToOutput.get(row.leftSourceId);
      const rightOutput = sourceToOutput.get(row.rightSourceId);
      if (leftOutput === rightOutput) {
        reviewItems.push(makeReviewItem({
          type: 'UNSAFE_CONTRADICTION_COALESCENCE',
          message: 'Contradictory sources would map to one output; deterministic validation blocks application.',
          sourceIds: [row.leftSourceId, row.rightSourceId],
          details: {outputId: leftOutput},
          state: LoreReviewState.BLOCKED,
        }));
      }
    }

    const allInputFacts = new Set([...leftRows, ...rightRows].flatMap((row) => [...factSet(row)]));
    const allOutputFacts = new Set(proposedOutput.flatMap((row) => row.semanticFactRefs || []));
    const missingFacts = [...allInputFacts].filter((id) => !allOutputFacts.has(id)).sort();
    const currentSources = [...leftRows, ...rightRows].map((row) => row.source.sourceId).sort();
    const unmappedSources = currentSources.filter((sourceId) => !sourceToOutput.has(sourceId));
    const contradictionCoalescence = unresolvedContradictions.filter((row) => (
      sourceToOutput.get(row.leftSourceId) === sourceToOutput.get(row.rightSourceId)
    ));

    const reconstructionManifest = {
      kind: 'LoreMergeReconstructionManifest',
      books: [leftBookId, rightBookId].map((lorebookId) => {
        const book = (registry.snapshot().books || []).find((row) => row.id === lorebookId);
        const bookRows = [...leftRows, ...rightRows].filter((row) => row.source.lorebookId === lorebookId);
        return {
          lorebookId,
          title: book?.title || lorebookId,
          metadata: deepClone(book?.metadata || {}),
          entries: bookRows.map((row) => ({
            sourceId: row.source.sourceId,
            uid: row.source.uid,
            currentSourceRevisionId: row.revision.id,
            revisionHistory: sourceRevisionHistory(registry, row.source.sourceId),
          })),
        };
      }),
      reconstructsExactAuthoredInputs: true,
    };

    const validation = {
      kind: 'LoreMergePreviewValidation',
      mappedEveryCurrentSource: unmappedSources.length === 0,
      retainedEverySemanticFact: missingFacts.length === 0,
      preservedContradictionsSeparately: contradictionCoalescence.length === 0,
      reconstructionManifestPresent: reconstructionManifest.books.length === 2,
      missingFactRefs: missingFacts,
      unmappedSourceIds: unmappedSources,
      unsafeContradictionPairs: contradictionCoalescence.map((row) => row.id),
    };
    validation.ok = validation.mappedEveryCurrentSource
      && validation.retainedEverySemanticFact
      && validation.preservedContradictionsSeparately
      && validation.reconstructionManifestPresent;

    const sourceMapping = currentSources.map((sourceId) => ({
      sourceId,
      outputId: sourceToOutput.get(sourceId),
      sourceIdentity: sourceRevisionIdentity(registry, sourceId),
    }));

    const previewCore = {
      lorebookIds: [leftBookId, rightBookId],
      sourceRevisionFence: sourceMapping.map((row) => row.sourceIdentity.sourceRevisionId).sort(),
      classifications: {
        exactDuplicates,
        likelyOverlap,
        complementary,
        titleKeyCollisions,
        unresolvedContradictions,
      },
      sourceToOutput: sourceMapping,
      proposedOutput: proposedOutput.sort((a, b) => a.outputId.localeCompare(b.outputId)),
      reconstructionManifest,
      validation,
    };

    return {
      kind: 'LoreMergePreview',
      contractVersion: 1,
      previewId: 'lore-merge-preview:' + stableHash(previewCore),
      ...previewCore,
      pairDiagnostics: pairDiagnostics.sort((a, b) => a.pairId.localeCompare(b.pairId)),
      reviewItems: reviewItems.sort((a, b) => a.id.localeCompare(b.id)),
      contradictionSourceIds: [...contradictionSources].sort(),
      similarityScoresAreAdvisory: true,
      modelSuggestionsMayProposeOnly: true,
      deterministicValidationRequiredForMutation: true,
      explicitOperatorApprovalRequiredForMutation: true,
      destructiveApplyImplemented: false,
      mutationAuthority: false,
      safeApplicationBoundary: 'Wave 6 stops at validated preview. No destructive source or Tree mutation API is implemented.',
    };
  }
}
