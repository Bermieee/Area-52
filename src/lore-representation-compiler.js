import {
  ArtifactType,
  AuthorityClass,
  TemporalClass,
  deepClone,
  stableHash,
  stableStringify,
} from './lore-contracts.js';
import {
  DEFAULT_COMPILER_REVISION,
  QualityFailure,
  QualityStatus,
  RepresentationProfile,
  RequirementLevel,
  SemanticClass,
  createContribution,
  createProfilePolicy,
  createRepresentationArtifact,
  measureText,
  representationReuseKey,
} from './lore-representation-contracts.js';

export const LORE_REPRESENTATION_LIMITS = Object.freeze({
  sliceCharacters: 1200,
  sliceOverlap: 120,
  maxSlices: 128,
  contributionsPerSlice: 48,
  totalContributions: 512,
  relationshipRefs: 128,
  claimRefs: 192,
  behavioralAnchors: 64,
  sensoryAnchors: 64,
  validationRefs: 768,
  maxRepresentationCharacters: 24000,
  maxProviderRequestCharacters: 96000,
});

function humanizeId(id, labels) {
  if (labels.has(id)) return labels.get(id);
  return String(id || '').replace(/^entity:/, '').split('-').map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ');
}

function sentenceSpans(text) {
  const content = String(text || '');
  const rows = [];
  const regex = /[^.!?\n]+[.!?]?/g;
  let match;
  let index = 0;
  while ((match = regex.exec(content)) && rows.length < 512) {
    const sentence = match[0].trim();
    if (!sentence) continue;
    const local = match[0].indexOf(sentence);
    rows.push({
      index: index++,
      start: match.index + Math.max(0, local),
      end: match.index + Math.max(0, local) + sentence.length,
      text: sentence,
    });
  }
  return rows;
}

export function sliceSource(content, limits = LORE_REPRESENTATION_LIMITS) {
  const text = String(content || '');
  if (!text.length) return [];
  const size = limits.sliceCharacters;
  const overlap = Math.min(limits.sliceOverlap, Math.max(0, size - 1));
  const slices = [];
  let start = 0;
  while (start < text.length) {
    if (slices.length >= limits.maxSlices) throw new Error('SOURCE_SLICE_LIMIT_EXCEEDED');
    const hardEnd = Math.min(text.length, start + size);
    let end = hardEnd;
    if (hardEnd < text.length) {
      const floor = Math.max(start + Math.floor(size * 0.65), start + 1);
      const window = text.slice(floor, hardEnd);
      const boundary = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'), window.lastIndexOf('; '));
      if (boundary >= 0) end = floor + boundary + 1;
    }
    if (end <= start) end = hardEnd;
    const sliceText = text.slice(start, end);
    slices.push({
      kind: 'LoreSourceSlice',
      id: 'slice:' + stableHash(start + '|' + end + '|' + sliceText),
      index: slices.length,
      start,
      end,
      text: sliceText,
      textHash: stableHash(sliceText),
    });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return slices;
}

export function validateSlices(content, slices) {
  const text = String(content || '');
  const failures = [];
  if (text.length && !slices.length) failures.push(QualityFailure.SLICE_COVERAGE_FAILURE);
  const ids = new Set();
  let coveredUntil = 0;
  for (const slice of slices) {
    if (ids.has(slice.id)) failures.push('DUPLICATE_SLICE_ID');
    ids.add(slice.id);
    if (slice.start > coveredUntil) failures.push(QualityFailure.SLICE_COVERAGE_FAILURE);
    if (slice.end <= slice.start || text.slice(slice.start, slice.end) !== slice.text) failures.push('SLICE_SPAN_MISMATCH');
    coveredUntil = Math.max(coveredUntil, slice.end);
  }
  if (coveredUntil < text.length) failures.push(QualityFailure.SLICE_COVERAGE_FAILURE);
  return {
    kind: 'LoreSliceCoverageReceipt',
    ok: failures.length === 0,
    failures: [...new Set(failures)],
    sourceCharacters: text.length,
    sliceCount: slices.length,
    maxSliceCharacters: Math.max(0, ...slices.map((slice) => slice.text.length)),
    overlapCharacters: slices.length > 1 ? slices.slice(1).reduce((sum, slice, index) => sum + Math.max(0, slices[index].end - slice.start), 0) : 0,
    everySliceAccountedFor: failures.length === 0,
  };
}

export function validateProviderSliceResults(slices, results) {
  const failures = [];
  if (!Array.isArray(results)) {
    return {
      kind: 'LoreProviderSliceResultReceipt',
      ok: false,
      failures: [QualityFailure.MALFORMED_OUTPUT],
      expectedSliceRefs: slices.map((slice) => slice.id),
      receivedSliceRefs: [],
    };
  }
  const expected = new Set(slices.map((slice) => slice.id));
  const seen = new Set();
  for (const row of results) {
    const ref = row?.sliceRef;
    if (!expected.has(ref)) failures.push(QualityFailure.UNKNOWN_SLICE_REF);
    if (seen.has(ref)) failures.push(QualityFailure.DUPLICATE_SLICE_REF);
    if (ref) seen.add(ref);
  }
  for (const ref of expected) if (!seen.has(ref)) failures.push(QualityFailure.MISSING_SLICE_REF);
  return {
    kind: 'LoreProviderSliceResultReceipt',
    ok: failures.length === 0,
    failures: [...new Set(failures)],
    expectedSliceRefs: [...expected],
    receivedSliceRefs: [...seen],
  };
}

function artifactContributionText(artifact, labels) {
  if (artifact.artifactType === ArtifactType.ENTITY) {
    return artifact.payload.canonicalName + ' is a ' + String(artifact.payload.entityType || 'world entity').toLowerCase() + '.';
  }
  if (artifact.artifactType === ArtifactType.CLAIM) {
    const temporal = artifact.temporalClass && artifact.temporalClass !== TemporalClass.TIMELESS
      ? '[' + artifact.temporalClass + '] '
      : '';
    const unresolved = artifact.unresolved ? '[UNRESOLVED] ' : '';
    return temporal + unresolved + [
      humanizeId(artifact.payload.subjectId, labels),
      artifact.payload.predicate,
      humanizeId(artifact.payload.value, labels),
    ].join(' ') + '.';
  }
  if (artifact.artifactType === ArtifactType.RELATIONSHIP) {
    const temporal = artifact.temporalClass && artifact.temporalClass !== TemporalClass.TIMELESS
      ? '[' + artifact.temporalClass + '] '
      : '';
    const unresolved = artifact.unresolved ? '[UNRESOLVED] ' : '';
    return temporal + unresolved + [
      humanizeId(artifact.payload.subjectId, labels),
      artifact.payload.predicate,
      humanizeId(artifact.payload.objectId, labels),
    ].join(' ') + '.';
  }
  return '';
}

function claimSemanticClass(artifact) {
  if (artifact.unresolved || artifact.authorityClass === AuthorityClass.UNRESOLVED || artifact.temporalClass === TemporalClass.UNCERTAIN || artifact.temporalClass === TemporalClass.CONFLICTING) {
    return SemanticClass.UNRESOLVED_CONFLICT;
  }
  if ([TemporalClass.CURRENT, TemporalClass.HISTORICAL, TemporalClass.SEQUENCE, TemporalClass.DATED].includes(artifact.temporalClass)) {
    return SemanticClass.TEMPORAL_ANCHOR;
  }
  return SemanticClass.LOAD_BEARING_FACT;
}

function sourceTextureContributions({sourceId, sourceRevisionId, content, slices}) {
  const out = [];
  const spans = sentenceSpans(content);
  const perSlice = new Map();
  for (const row of spans) {
    const text = row.text;
    const ownerSlice = (slices || []).find((slice) => row.start >= slice.start && row.end <= slice.end)
      || (slices || []).find((slice) => row.start < slice.end && row.end > slice.start)
      || null;
    if (ownerSlice) {
      const count = perSlice.get(ownerSlice.id) || 0;
      if (count >= LORE_REPRESENTATION_LIMITS.contributionsPerSlice) continue;
      perSlice.set(ownerSlice.id, count + 1);
    }
    const sourceSpan = {
      start: row.start,
      end: row.end,
      sentenceIndex: row.index,
      textHash: stableHash(text),
      sliceId: ownerSlice?.id || null,
    };
    const add = (semanticClass, refs = {}) => out.push(createContribution({
      sourceId,
      sourceRevisionId,
      semanticClass,
      text,
      sourceSpan,
      behavioralRefs: refs.behavioralRefs || [],
      sensoryRefs: refs.sensoryRefs || [],
      sourceAuthorityClass: AuthorityClass.SOURCE_CANON,
    }));

    if (/\b(cannot|can't|must|never|only|prohibited|required|immune|unable|may not|must not)\b/i.test(text)) {
      add(SemanticClass.HARD_CONSTRAINT);
      continue;
    }
    if (/^(?:except|unless|however)\b/i.test(text) || /\bexcept when\b/i.test(text)) {
      add(SemanticClass.EDGE_CASE);
      continue;
    }
    if (/\b(after|before|later|formerly|previously|once|years? later|days? later)\b/i.test(text)) {
      add(SemanticClass.TEMPORAL_ANCHOR);
    }
    if (/\b(taps?|fidgets?|flinches?|smiles?|laughs?|hums?|paces?|avoids? eye contact|leans?|touches?|stares?|whispers?|speaks?|stands? closer|pulls? away|reaches? for)\b/i.test(text)) {
      add(SemanticClass.CHARACTER_BEHAVIOR, {behavioralRefs: ['source-span:' + row.index]});
    }
    if (/\b(scent|smell|voice|sound|eyes?|gaze|visual|glow|scar|warmth|cold|smoky|raspy|silky|ringing|perfume|ozone)\b/i.test(text)) {
      add(SemanticClass.SENSORY_ANCHOR, {sensoryRefs: ['source-span:' + row.index]});
    }
    if (/\b(because|therefore|so that|caused|due to|as a result)\b/i.test(text)) {
      add(SemanticClass.CAUSAL_CONTEXT);
    }
    if (/\b(embroider\w*|ornate|decorative|trimmed|patterned|painted)\b/i.test(text)) {
      add(SemanticClass.FLAVOR_DETAIL);
    }
  }
  return out;
}

export function buildGroundedContributions({runtime, sourceId, slices = null}) {
  const source = runtime.registry.getEntry(sourceId);
  if (!source) throw new Error('Unknown Lore source: ' + sourceId);
  const revision = runtime.registry.currentRevision(sourceId);
  const learned = runtime.store.currentLearnedRevision(sourceId);
  if (!learned || learned.sourceRevisionId !== revision.id || learned.state !== 'CURRENT') throw new Error('SOURCE_NOT_CURRENTLY_LEARNED');

  const artifacts = runtime.store.artifactsForLearnedRevision(learned.id);
  const sourceSlices = slices || sliceSource(revision.exactContent);
  const labels = new Map(
    artifacts
      .filter((artifact) => artifact.artifactType === ArtifactType.ENTITY)
      .map((artifact) => [artifact.payload.entityId, artifact.payload.canonicalName]),
  );
  const contributions = [];

  for (const artifact of artifacts) {
    if (artifact.artifactType === ArtifactType.ENTITY) {
      contributions.push(createContribution({
        sourceId,
        sourceRevisionId: revision.id,
        semanticClass: SemanticClass.REQUIRED_IDENTITY,
        text: artifactContributionText(artifact, labels),
        entityRefs: [artifact.payload.entityId],
        dependencyArtifactIds: [artifact.id],
        sourceAuthorityClass: artifact.authorityClass,
      }));
    } else if (artifact.artifactType === ArtifactType.CLAIM) {
      const semanticClass = claimSemanticClass(artifact);
      contributions.push(createContribution({
        sourceId,
        sourceRevisionId: revision.id,
        semanticClass,
        text: artifactContributionText(artifact, labels),
        entityRefs: [artifact.payload.subjectId].filter(Boolean),
        claimRefs: [artifact.payload.claimId || artifact.semanticId],
        temporalRefs: artifact.temporalClass !== TemporalClass.TIMELESS ? [artifact.semanticId + '@' + artifact.temporalClass] : [],
        unresolvedRefs: artifact.unresolved ? [artifact.semanticId] : [],
        dependencyArtifactIds: [artifact.id],
        sourceAuthorityClass: artifact.authorityClass,
      }));
    } else if (artifact.artifactType === ArtifactType.RELATIONSHIP) {
      contributions.push(createContribution({
        sourceId,
        sourceRevisionId: revision.id,
        semanticClass: artifact.unresolved ? SemanticClass.UNRESOLVED_CONFLICT : SemanticClass.RELATIONSHIP_CORE,
        text: artifactContributionText(artifact, labels),
        entityRefs: [artifact.payload.subjectId, artifact.payload.objectId].filter(Boolean),
        relationshipRefs: [artifact.payload.relationshipId || artifact.semanticId],
        temporalRefs: artifact.temporalClass !== TemporalClass.TIMELESS ? [artifact.semanticId + '@' + artifact.temporalClass] : [],
        unresolvedRefs: artifact.unresolved ? [artifact.semanticId] : [],
        dependencyArtifactIds: [artifact.id, ...(artifact.payload.supportingClaimIds || [])],
        sourceAuthorityClass: artifact.payload.sourceAuthorityClass || artifact.authorityClass,
      }));
    }
  }

  contributions.push(...sourceTextureContributions({
    sourceId,
    sourceRevisionId: revision.id,
    content: revision.exactContent,
    slices: sourceSlices,
  }));

  const deduped = new Map();
  for (const contribution of contributions) {
    const key = contribution.semanticId;
    if (!deduped.has(key)) deduped.set(key, contribution);
    else {
      const prior = deduped.get(key);
      prior.dependencyArtifactIds = [...new Set([...prior.dependencyArtifactIds, ...contribution.dependencyArtifactIds])].sort();
    }
  }
  const rows = [...deduped.values()]
    .sort((a, b) => a.semanticClass.localeCompare(b.semanticClass) || a.semanticId.localeCompare(b.semanticId))
    .slice(0, LORE_REPRESENTATION_LIMITS.totalContributions);

  return {
    kind: 'LoreContributionSet',
    sourceId,
    sourceRevisionId: revision.id,
    learnedRevisionId: learned.id,
    contributions: rows,
    contributionFingerprint: stableHash(rows.map((row) => row.semanticId).sort()),
    dependencyArtifactIds: [...new Set(rows.flatMap((row) => row.dependencyArtifactIds))].sort(),
    sourceArtifactCount: artifacts.length,
  };
}

function requirementFor(policy, contribution) {
  return policy.classes[contribution.semanticClass] || RequirementLevel.OPTIONAL;
}

function selectedForProfile(contributions, policy) {
  const effectiveProfile = policy.profile === RepresentationProfile.CUSTOM_CAP
    ? (policy.baseProfile || RepresentationProfile.LEAN)
    : policy.profile;
  return contributions.filter((contribution) => {
    const level = requirementFor(policy, contribution);
    if (effectiveProfile === RepresentationProfile.LEAN) return level === RequirementLevel.MANDATORY;
    if (effectiveProfile === RepresentationProfile.BALANCED) return level !== RequirementLevel.OPTIONAL;
    return true;
  });
}

function contributionLine(contribution) {
  return '[' + contribution.semanticClass + '] ' + contribution.text.trim();
}

export class DeterministicRepresentationProvider {
  generate(request) {
    const selected = request.selectedContributions;
    return {
      kind: 'LoreRepresentationDraft',
      sourceId: request.sourceId,
      sourceRevisionId: request.sourceRevisionId,
      profile: request.profile,
      contributionRefs: selected.map((row) => row.id),
      content: selected.map(contributionLine).join('\n'),
      providerMetadata: {
        provider: 'DETERMINISTIC_TESTABLE_PROVIDER',
        persistentId: null,
        confidence: null,
      },
      authorityClass: AuthorityClass.DERIVED,
    };
  }
}

function categoryMetric(contributions, retainedSet, semanticClass) {
  const rows = contributions.filter((row) => row.semanticClass === semanticClass);
  return {
    total: rows.length,
    retained: rows.filter((row) => retainedSet.has(row.id)).length,
  };
}

function failureCodeForMissing(contribution) {
  if (contribution.semanticClass === SemanticClass.RELATIONSHIP_CORE) return QualityFailure.MISSING_RELATIONSHIP;
  if (contribution.semanticClass === SemanticClass.TEMPORAL_ANCHOR) return QualityFailure.TEMPORAL_COLLAPSE;
  if (contribution.semanticClass === SemanticClass.UNRESOLVED_CONFLICT) return QualityFailure.CONFLICT_RESOLVED_WITHOUT_AUTHORITY;
  if (contribution.semanticClass === SemanticClass.HARD_CONSTRAINT) return QualityFailure.HARD_CONSTRAINT_DROPPED;
  return QualityFailure.MISSING_REQUIRED_CLAIM;
}

export function validateRepresentationDraft({
  draft,
  contributionSet,
  policy,
  sourceRevision,
  capCharacters = null,
  slicesReceipt,
}) {
  const failures = [];
  if (!draft || draft.kind !== 'LoreRepresentationDraft' || !Array.isArray(draft.contributionRefs) || typeof draft.content !== 'string') {
    failures.push(QualityFailure.MALFORMED_OUTPUT);
  }
  if (draft?.sourceId !== sourceRevision.sourceId) failures.push(QualityFailure.INVENTED_SOURCE_ID);
  if (draft?.sourceRevisionId !== sourceRevision.id) failures.push(QualityFailure.SOURCE_REVISION_STALE);
  if (draft?.authorityClass !== AuthorityClass.DERIVED) failures.push(QualityFailure.UNSUPPORTED_AUTHORITY);
  if (draft?.providerMetadata?.persistentId) failures.push(QualityFailure.UNEXPECTED_PERSISTENT_ID);
  if (!slicesReceipt?.ok) failures.push(QualityFailure.SLICE_COVERAGE_FAILURE);

  const refs = Array.isArray(draft?.contributionRefs) ? draft.contributionRefs : [];
  const refSet = new Set(refs);
  if (refSet.size !== refs.length) failures.push(QualityFailure.DUPLICATE_CONTRIBUTION_REF);
  const known = new Map(contributionSet.contributions.map((row) => [row.id, row]));
  for (const ref of refs) if (!known.has(ref)) failures.push(QualityFailure.UNKNOWN_CONTRIBUTION_REF);

  const mandatory = contributionSet.contributions.filter((row) => requirementFor(policy, row) === RequirementLevel.MANDATORY);
  for (const contribution of mandatory) {
    if (!refSet.has(contribution.id)) failures.push(failureCodeForMissing(contribution));
  }

  const minimumSafeText = mandatory.map(contributionLine).join('\n');
  const minimumSafeEstimate = measureText(minimumSafeText).characters;
  const size = measureText(draft?.content || '');
  if (capCharacters != null && minimumSafeEstimate > capCharacters) failures.push(QualityFailure.CAP_IMPOSSIBLE);
  if (capCharacters != null && size.characters > capCharacters) failures.push(QualityFailure.CAP_EXCEEDED);
  if (size.characters > LORE_REPRESENTATION_LIMITS.maxRepresentationCharacters) failures.push(QualityFailure.CAP_EXCEEDED);

  const expectedGroundedContent = refs.filter((ref) => known.has(ref)).map((ref) => contributionLine(known.get(ref))).join('\n');
  const freeFloatingContent = typeof draft?.content === 'string' && draft.content !== expectedGroundedContent;
  const unsupportedStatements = refs.filter((ref) => !known.has(ref)).length + (freeFloatingContent ? 1 : 0);
  if (unsupportedStatements) failures.push(QualityFailure.UNSUPPORTED_ASSERTION);

  const mandatoryRetained = mandatory.filter((row) => refSet.has(row.id)).length;
  const preferred = contributionSet.contributions.filter((row) => requirementFor(policy, row) === RequirementLevel.PREFERRED);
  const optional = contributionSet.contributions.filter((row) => requirementFor(policy, row) === RequirementLevel.OPTIONAL);
  const sourceSize = measureText(sourceRevision.exactContent || '');
  const receipt = {
    kind: 'RepresentationQualityReceipt',
    sourceId: sourceRevision.sourceId,
    sourceRevisionId: sourceRevision.id,
    profile: policy.profile,
    policyRevision: policy.revision,
    sourceSize,
    representationSize: size,
    compressionRatio: sourceSize.characters ? Number((size.characters / sourceSize.characters).toFixed(4)) : 1,
    requiredContributions: mandatory.length,
    requiredRetained: mandatoryRetained,
    preferredContributions: preferred.length,
    preferredRetained: preferred.filter((row) => refSet.has(row.id)).length,
    optionalContributions: optional.length,
    optionalRetained: optional.filter((row) => refSet.has(row.id)).length,
    claims: {
      total: contributionSet.contributions.filter((row) => row.claimRefs.length).length,
      retained: contributionSet.contributions.filter((row) => row.claimRefs.length && refSet.has(row.id)).length,
    },
    relationships: {
      total: contributionSet.contributions.filter((row) => row.relationshipRefs.length).length,
      retained: contributionSet.contributions.filter((row) => row.relationshipRefs.length && refSet.has(row.id)).length,
    },
    temporalAnchors: categoryMetric(contributionSet.contributions, refSet, SemanticClass.TEMPORAL_ANCHOR),
    conflicts: categoryMetric(contributionSet.contributions, refSet, SemanticClass.UNRESOLVED_CONFLICT),
    constraints: categoryMetric(contributionSet.contributions, refSet, SemanticClass.HARD_CONSTRAINT),
    behavioralAnchors: categoryMetric(contributionSet.contributions, refSet, SemanticClass.CHARACTER_BEHAVIOR),
    sensoryAnchors: categoryMetric(contributionSet.contributions, refSet, SemanticClass.SENSORY_ANCHOR),
    unsupportedStatementsDetected: unsupportedStatements,
    capCharacters,
    minimumSafeEstimate,
    capCompliant: capCharacters == null || size.characters <= capCharacters,
    sliceCoverage: deepClone(slicesReceipt),
    validationFailures: [...new Set(failures)],
    status: failures.length ? QualityStatus.FAIL : QualityStatus.PASS,
    qualityAuthority: false,
    settlementAuthority: false,
  };
  return receipt;
}

function fitCustomCap(selected, policy, capCharacters) {
  const mandatory = selected.filter((row) => requirementFor(policy, row) === RequirementLevel.MANDATORY);
  const minimum = mandatory.map(contributionLine).join('\n');
  if (measureText(minimum).characters > capCharacters) {
    return {
      possible: false,
      selected: mandatory,
      minimumSafeEstimate: measureText(minimum).characters,
    };
  }
  const chosen = [...mandatory];
  const optional = selected.filter((row) => !mandatory.some((required) => required.id === row.id));
  for (const row of optional) {
    const candidate = [...chosen, row].map(contributionLine).join('\n');
    if (measureText(candidate).characters <= capCharacters) chosen.push(row);
  }
  return {possible: true, selected: chosen, minimumSafeEstimate: measureText(minimum).characters};
}

export class LoreRepresentationCompiler {
  constructor({
    runtime,
    representationRegistry,
    provider = new DeterministicRepresentationProvider(),
    compilerRevision = DEFAULT_COMPILER_REVISION,
    policyOverrides = {},
  }) {
    if (!runtime) throw new TypeError('LoreRepresentationCompiler requires a LoreStudyRuntime');
    if (!representationRegistry) throw new TypeError('LoreRepresentationCompiler requires a representation registry');
    this.runtime = runtime;
    this.registry = representationRegistry;
    this.provider = provider;
    this.compilerRevision = compilerRevision;
    this.policyOverrides = {...policyOverrides};
  }

  policy(profile, {policyRevision = null, baseProfile = null} = {}) {
    const override = this.policyOverrides[profile];
    if (override && (!policyRevision || override.revision === policyRevision)) return deepClone(override);
    return createProfilePolicy({
      profile,
      revision: policyRevision || undefined,
      baseProfile,
    });
  }

  compile({
    sourceId,
    profile,
    capCharacters = null,
    baseProfile = RepresentationProfile.LEAN,
    policyRevision = null,
  }) {
    const sourceRevision = this.runtime.registry.currentRevision(sourceId);
    if (sourceRevision.state === 'REMOVED') return {
      status: QualityStatus.FAIL,
      failure: 'SOURCE_REMOVED',
      representation: null,
      qualityReceipt: null,
      reused: false,
    };
    const learned = this.runtime.store.currentLearnedRevision(sourceId);
    if (!learned || learned.sourceRevisionId !== sourceRevision.id || learned.state !== 'CURRENT') {
      return {
        status: QualityStatus.FAIL,
        failure: QualityFailure.SOURCE_REVISION_STALE,
        representation: null,
        qualityReceipt: null,
        reused: false,
      };
    }

    const normalizedProfile = String(profile).toUpperCase();
    if (normalizedProfile === RepresentationProfile.CUSTOM_CAP && (!Number.isInteger(capCharacters) || capCharacters <= 0)) {
      throw new TypeError('CUSTOM_CAP requires a positive integer capCharacters');
    }
    const policy = this.policy(normalizedProfile, {policyRevision, baseProfile});
    this.registry.refreshPolicyFreshness(this.runtime.registry, {
      profile: normalizedProfile,
      policyRevision: policy.revision,
      compilerRevision: this.compilerRevision,
    });
    const slices = sliceSource(sourceRevision.exactContent);
    const slicesReceipt = validateSlices(sourceRevision.exactContent, slices);
    if (!slicesReceipt.ok) return {
      status: QualityStatus.FAIL,
      failure: QualityFailure.SLICE_COVERAGE_FAILURE,
      representation: null,
      qualityReceipt: {status: QualityStatus.FAIL, validationFailures: slicesReceipt.failures, sliceCoverage: slicesReceipt},
      reused: false,
    };

    const contributionSet = buildGroundedContributions({runtime: this.runtime, sourceId, slices});
    const semanticDependencyHash = stableHash(stableStringify({
      contributionFingerprint: contributionSet.contributionFingerprint,
      dependencyArtifactIds: contributionSet.dependencyArtifactIds,
    }));
    const reuseKey = representationReuseKey({
      sourceRevisionId: sourceRevision.id,
      profile: normalizedProfile,
      capCharacters,
      policyRevision: policy.revision,
      compilerRevision: this.compilerRevision,
      semanticDependencyHash,
    });
    const reusable = this.registry.getByReuseKey(reuseKey, {sourceRegistry: this.runtime.registry});
    if (reusable) {
      return {
        status: QualityStatus.PASS,
        representation: reusable,
        qualityReceipt: deepClone(reusable.retentionReceipt),
        reused: true,
        contributionSet,
        slicesReceipt,
      };
    }

    let selected = selectedForProfile(contributionSet.contributions, policy);
    let capPlan = null;
    if (normalizedProfile === RepresentationProfile.CUSTOM_CAP) {
      capPlan = fitCustomCap(selected, policy, capCharacters);
      if (!capPlan.possible) {
        const fakeDraft = {
          kind: 'LoreRepresentationDraft',
          sourceId,
          sourceRevisionId: sourceRevision.id,
          profile: normalizedProfile,
          contributionRefs: capPlan.selected.map((row) => row.id),
          content: capPlan.selected.map(contributionLine).join('\n'),
          providerMetadata: {persistentId: null},
          authorityClass: AuthorityClass.DERIVED,
        };
        const receipt = validateRepresentationDraft({
          draft: fakeDraft,
          contributionSet,
          policy,
          sourceRevision,
          capCharacters,
          slicesReceipt,
        });
        return {
          status: QualityStatus.FAIL,
          failure: QualityFailure.CAP_IMPOSSIBLE,
          representation: null,
          qualityReceipt: receipt,
          reused: false,
          contributionSet,
          slicesReceipt,
        };
      }
      selected = capPlan.selected;
    }

    const providerRequestCharacters = selected.reduce((sum, row) => sum + row.text.length + 96, 0);
    if (providerRequestCharacters > LORE_REPRESENTATION_LIMITS.maxProviderRequestCharacters) {
      return {
        status: QualityStatus.FAIL,
        failure: 'PROVIDER_REQUEST_LIMIT_EXCEEDED',
        representation: null,
        qualityReceipt: {
          kind: 'RepresentationQualityReceipt',
          status: QualityStatus.FAIL,
          sourceId,
          sourceRevisionId: sourceRevision.id,
          profile: normalizedProfile,
          providerRequestCharacters,
          providerRequestLimit: LORE_REPRESENTATION_LIMITS.maxProviderRequestCharacters,
          validationFailures: ['PROVIDER_REQUEST_LIMIT_EXCEEDED'],
        },
        reused: false,
        contributionSet,
        slicesReceipt,
      };
    }

    const draft = this.provider.generate({
      sourceId,
      sourceRevisionId: sourceRevision.id,
      profile: normalizedProfile,
      capCharacters,
      policy: deepClone(policy),
      selectedContributions: deepClone(selected),
      allContributions: deepClone(contributionSet.contributions),
      sliceReceipt: deepClone(slicesReceipt),
    });
    const qualityReceipt = validateRepresentationDraft({
      draft,
      contributionSet,
      policy,
      sourceRevision,
      capCharacters,
      slicesReceipt,
    });
    if (qualityReceipt.status !== QualityStatus.PASS) {
      return {
        status: QualityStatus.FAIL,
        failure: qualityReceipt.validationFailures[0] || QualityFailure.MALFORMED_OUTPUT,
        representation: null,
        qualityReceipt,
        reused: false,
        contributionSet,
        slicesReceipt,
      };
    }

    const representationRevision = this.registry.nextRevision({
      sourceId,
      profile: normalizedProfile,
      capCharacters,
    });
    const representation = createRepresentationArtifact({
      sourceId,
      sourceRevisionId: sourceRevision.id,
      profile: normalizedProfile,
      capCharacters,
      representationRevision,
      content: draft.content,
      contributionIds: draft.contributionRefs,
      dependencyArtifactIds: contributionSet.dependencyArtifactIds,
      policyRevision: policy.revision,
      compilerRevision: this.compilerRevision,
      semanticDependencyHash,
      qualityReceipt,
    });
    const published = this.registry.publish({
      representation,
      sourceRegistry: this.runtime.registry,
    });
    return {
      status: QualityStatus.PASS,
      representation: published,
      qualityReceipt,
      reused: false,
      contributionSet,
      slicesReceipt,
    };
  }

  compileFamily({sourceId, customCapCharacters = null, customBaseProfile = RepresentationProfile.LEAN} = {}) {
    const out = {};
    for (const profile of [RepresentationProfile.LEAN, RepresentationProfile.BALANCED, RepresentationProfile.HEAVY]) {
      out[profile] = this.compile({sourceId, profile});
    }
    if (customCapCharacters != null) {
      out[RepresentationProfile.CUSTOM_CAP] = this.compile({
        sourceId,
        profile: RepresentationProfile.CUSTOM_CAP,
        capCharacters: customCapCharacters,
        baseProfile: customBaseProfile,
      });
    }
    return out;
  }

  semanticRetentionSignature(sourceId) {
    const set = buildGroundedContributions({runtime: this.runtime, sourceId});
    return {
      sourceId,
      sourceRevisionId: set.sourceRevisionId,
      contributionFingerprint: set.contributionFingerprint,
      semanticIds: set.contributions.map((row) => row.semanticId).sort(),
    };
  }
}
