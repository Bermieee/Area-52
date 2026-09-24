import {AuthorityClass, deepClone, stableHash, stableStringify} from './lore-contracts.js';

export const RepresentationProfile = Object.freeze({
  LEAN: 'LEAN',
  BALANCED: 'BALANCED',
  HEAVY: 'HEAVY',
  CUSTOM_CAP: 'CUSTOM_CAP',
});

export const SemanticClass = Object.freeze({
  REQUIRED_IDENTITY: 'REQUIRED_IDENTITY',
  LOAD_BEARING_FACT: 'LOAD_BEARING_FACT',
  HARD_CONSTRAINT: 'HARD_CONSTRAINT',
  RELATIONSHIP_CORE: 'RELATIONSHIP_CORE',
  TEMPORAL_ANCHOR: 'TEMPORAL_ANCHOR',
  UNRESOLVED_CONFLICT: 'UNRESOLVED_CONFLICT',
  CHARACTER_BEHAVIOR: 'CHARACTER_BEHAVIOR',
  SENSORY_ANCHOR: 'SENSORY_ANCHOR',
  CAUSAL_CONTEXT: 'CAUSAL_CONTEXT',
  EDGE_CASE: 'EDGE_CASE',
  FLAVOR_DETAIL: 'FLAVOR_DETAIL',
});

export const RequirementLevel = Object.freeze({
  MANDATORY: 'MANDATORY',
  PREFERRED: 'PREFERRED',
  OPTIONAL: 'OPTIONAL',
});

export const QualityStatus = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
});

export const QualityFailure = Object.freeze({
  MALFORMED_OUTPUT: 'MALFORMED_OUTPUT',
  UNKNOWN_CONTRIBUTION_REF: 'UNKNOWN_CONTRIBUTION_REF',
  DUPLICATE_CONTRIBUTION_REF: 'DUPLICATE_CONTRIBUTION_REF',
  UNSUPPORTED_AUTHORITY: 'UNSUPPORTED_AUTHORITY',
  INVENTED_SOURCE_ID: 'INVENTED_SOURCE_ID',
  SOURCE_REVISION_STALE: 'SOURCE_REVISION_STALE',
  UNEXPECTED_PERSISTENT_ID: 'UNEXPECTED_PERSISTENT_ID',
  CAP_EXCEEDED: 'CAP_EXCEEDED',
  CAP_IMPOSSIBLE: 'CAP_IMPOSSIBLE',
  MISSING_REQUIRED_RESULT: 'MISSING_REQUIRED_RESULT',
  MISSING_REQUIRED_CLAIM: 'MISSING_REQUIRED_CLAIM',
  MISSING_RELATIONSHIP: 'MISSING_RELATIONSHIP',
  TEMPORAL_COLLAPSE: 'TEMPORAL_COLLAPSE',
  CONFLICT_RESOLVED_WITHOUT_AUTHORITY: 'CONFLICT_RESOLVED_WITHOUT_AUTHORITY',
  HARD_CONSTRAINT_DROPPED: 'HARD_CONSTRAINT_DROPPED',
  UNSUPPORTED_ASSERTION: 'UNSUPPORTED_ASSERTION',
  SLICE_COVERAGE_FAILURE: 'SLICE_COVERAGE_FAILURE',
  UNKNOWN_SLICE_REF: 'UNKNOWN_SLICE_REF',
  DUPLICATE_SLICE_REF: 'DUPLICATE_SLICE_REF',
  MISSING_SLICE_REF: 'MISSING_SLICE_REF',
});

export const DEFAULT_POLICY_REVISION = 'lore-repr-policy-v1';
export const DEFAULT_COMPILER_REVISION = 'lore-repr-compiler-v1';

const mandatoryLean = [
  SemanticClass.REQUIRED_IDENTITY,
  SemanticClass.LOAD_BEARING_FACT,
  SemanticClass.HARD_CONSTRAINT,
  SemanticClass.RELATIONSHIP_CORE,
  SemanticClass.TEMPORAL_ANCHOR,
  SemanticClass.UNRESOLVED_CONFLICT,
  SemanticClass.CHARACTER_BEHAVIOR,
];

function policyMap(mandatory, preferred = []) {
  const out = {};
  for (const key of Object.values(SemanticClass)) out[key] = RequirementLevel.OPTIONAL;
  for (const key of preferred) out[key] = RequirementLevel.PREFERRED;
  for (const key of mandatory) out[key] = RequirementLevel.MANDATORY;
  return Object.freeze(out);
}

export const PROFILE_POLICIES = Object.freeze({
  [RepresentationProfile.LEAN]: Object.freeze({
    revision: DEFAULT_POLICY_REVISION,
    profile: RepresentationProfile.LEAN,
    classes: policyMap(mandatoryLean, [SemanticClass.CAUSAL_CONTEXT]),
  }),
  [RepresentationProfile.BALANCED]: Object.freeze({
    revision: DEFAULT_POLICY_REVISION,
    profile: RepresentationProfile.BALANCED,
    classes: policyMap(
      mandatoryLean,
      [SemanticClass.CAUSAL_CONTEXT, SemanticClass.SENSORY_ANCHOR, SemanticClass.EDGE_CASE],
    ),
  }),
  [RepresentationProfile.HEAVY]: Object.freeze({
    revision: DEFAULT_POLICY_REVISION,
    profile: RepresentationProfile.HEAVY,
    classes: policyMap(
      [...mandatoryLean, SemanticClass.SENSORY_ANCHOR],
      [SemanticClass.CAUSAL_CONTEXT, SemanticClass.EDGE_CASE, SemanticClass.FLAVOR_DETAIL],
    ),
  }),
});

export function createProfilePolicy({profile, revision = DEFAULT_POLICY_REVISION, classes = null, baseProfile = null} = {}) {
  const normalizedProfile = String(profile || '').toUpperCase();
  if (normalizedProfile === RepresentationProfile.CUSTOM_CAP) {
    const base = PROFILE_POLICIES[baseProfile || RepresentationProfile.LEAN];
    if (!base) throw new TypeError('Unknown custom-cap base profile');
    return {
      kind: 'LoreRepresentationProfilePolicy',
      profile: normalizedProfile,
      revision,
      baseProfile: base.profile,
      classes: classes ? {...base.classes, ...classes} : {...base.classes},
    };
  }
  const base = PROFILE_POLICIES[normalizedProfile];
  if (!base) throw new TypeError('Unknown representation profile: ' + profile);
  return {
    kind: 'LoreRepresentationProfilePolicy',
    profile: normalizedProfile,
    revision,
    baseProfile: null,
    classes: classes ? {...base.classes, ...classes} : {...base.classes},
  };
}

export function measureText(text) {
  const content = String(text || '');
  let bytes = 0;
  if (typeof TextEncoder !== 'undefined') bytes = new TextEncoder().encode(content).length;
  else bytes = unescape(encodeURIComponent(content)).length;
  return {
    characters: content.length,
    bytes,
    approximateTokens: Math.max(1, Math.ceil(content.length / 4)),
  };
}

export function createContribution({
  sourceId,
  sourceRevisionId,
  semanticClass,
  text,
  sourceSpan = null,
  entityRefs = [],
  claimRefs = [],
  relationshipRefs = [],
  temporalRefs = [],
  unresolvedRefs = [],
  behavioralRefs = [],
  sensoryRefs = [],
  dependencyArtifactIds = [],
  sourceAuthorityClass = null,
}) {
  if (!Object.values(SemanticClass).includes(semanticClass)) throw new TypeError('Unknown semantic contribution class');
  const signature = stableStringify({
    sourceId,
    sourceRevisionId,
    semanticClass,
    text,
    entityRefs,
    claimRefs,
    relationshipRefs,
    temporalRefs,
    unresolvedRefs,
    behavioralRefs,
    sensoryRefs,
    dependencyArtifactIds,
  });
  return {
    kind: 'LoreGroundedContribution',
    id: 'contribution:' + stableHash(signature),
    semanticId: 'contribution-sem:' + stableHash(stableStringify({
      semanticClass,
      text,
      entityRefs,
      claimRefs,
      relationshipRefs,
      temporalRefs,
      unresolvedRefs,
      behavioralRefs,
      sensoryRefs,
    })),
    sourceId,
    sourceRevisionId,
    semanticClass,
    text: String(text || ''),
    sourceSpan: sourceSpan ? deepClone(sourceSpan) : null,
    entityRefs: [...new Set(entityRefs)].sort(),
    claimRefs: [...new Set(claimRefs)].sort(),
    relationshipRefs: [...new Set(relationshipRefs)].sort(),
    temporalRefs: [...new Set(temporalRefs)].sort(),
    unresolvedRefs: [...new Set(unresolvedRefs)].sort(),
    behavioralRefs: [...new Set(behavioralRefs)].sort(),
    sensoryRefs: [...new Set(sensoryRefs)].sort(),
    dependencyArtifactIds: [...new Set(dependencyArtifactIds)].sort(),
    sourceAuthorityClass,
    authorityClass: AuthorityClass.DERIVED,
    provenance: {
      kind: 'LoreRepresentationProvenance',
      sourceId,
      sourceRevisionId,
      sourceSpan: sourceSpan ? deepClone(sourceSpan) : null,
      dependencyArtifactIds: [...new Set(dependencyArtifactIds)].sort(),
      derivation: 'GROUNDED_CONTRIBUTION',
    },
  };
}

export function representationReuseKey({
  sourceRevisionId,
  profile,
  capCharacters = null,
  policyRevision,
  compilerRevision,
  semanticDependencyHash,
}) {
  return stableHash(stableStringify({
    sourceRevisionId,
    profile,
    capCharacters,
    policyRevision,
    compilerRevision,
    semanticDependencyHash,
  }));
}

export function createRepresentationArtifact({
  sourceId,
  sourceRevisionId,
  profile,
  capCharacters = null,
  representationRevision,
  content,
  contributionIds,
  dependencyArtifactIds,
  policyRevision,
  compilerRevision,
  semanticDependencyHash,
  qualityReceipt,
}) {
  const reuseKey = representationReuseKey({
    sourceRevisionId,
    profile,
    capCharacters,
    policyRevision,
    compilerRevision,
    semanticDependencyHash,
  });
  return {
    kind: 'LoreRepresentationArtifact',
    id: 'lore-representation:' + reuseKey,
    representationRevision,
    profile,
    capCharacters,
    sourceId,
    sourceRevisionId,
    dependencyArtifactIds: [...new Set(dependencyArtifactIds)].sort(),
    contributionIds: [...new Set(contributionIds)],
    provenance: {
      kind: 'LoreRepresentationProvenance',
      sourceId,
      sourceRevisionId,
      dependencyArtifactIds: [...new Set(dependencyArtifactIds)].sort(),
    },
    content: String(content),
    size: measureText(content),
    retentionReceipt: deepClone(qualityReceipt),
    generation: {
      method: 'PROVIDER_NEUTRAL_CONTRIBUTION_COMPILER',
      compilerRevision,
      policyRevision,
    },
    semanticDependencyHash,
    reuseKey,
    state: 'CURRENT',
    authorityClass: AuthorityClass.DERIVED,
    temporalPreservation: {
      retained: qualityReceipt?.temporalAnchors?.retained ?? 0,
      total: qualityReceipt?.temporalAnchors?.total ?? 0,
    },
    unresolvedPreservation: {
      retained: qualityReceipt?.conflicts?.retained ?? 0,
      total: qualityReceipt?.conflicts?.total ?? 0,
    },
    hardCap: {
      requested: capCharacters,
      compliant: qualityReceipt?.capCompliant ?? true,
      minimumSafeEstimate: qualityReceipt?.minimumSafeEstimate ?? null,
    },
  };
}
