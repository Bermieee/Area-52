import {AuthorityClass, deepClone, stableHash, stableStringify} from './lore-contracts.js';

export const NavigationScopeType = Object.freeze({
  LEAF: 'LEAF',
  TREE: 'TREE',
  SHARD: 'SHARD',
  COMMUNITY: 'COMMUNITY',
  CORPUS: 'CORPUS',
});

export const NavigationSummaryState = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  BUILT: 'BUILT',
  REUSED: 'REUSED',
  STALE: 'STALE',
  BLOCKED: 'BLOCKED',
  INVALID: 'INVALID',
  HISTORICAL: 'HISTORICAL',
});

export const NavigationQualityStatus = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
});

export const NavigationFailure = Object.freeze({
  SOURCE_REF_MISSING: 'SOURCE_REF_MISSING',
  SOURCE_REF_EXTRA: 'SOURCE_REF_EXTRA',
  SOURCE_REF_DUPLICATE: 'SOURCE_REF_DUPLICATE',
  CHILD_REF_MISSING: 'CHILD_REF_MISSING',
  CHILD_REF_EXTRA: 'CHILD_REF_EXTRA',
  CHILD_REF_DUPLICATE: 'CHILD_REF_DUPLICATE',
  SOURCE_REVISION_STALE: 'SOURCE_REVISION_STALE',
  CHILD_SUMMARY_STALE: 'CHILD_SUMMARY_STALE',
  CHILD_SUMMARY_FAILED: 'CHILD_SUMMARY_FAILED',
  UNSUPPORTED_AUTHORITY: 'UNSUPPORTED_AUTHORITY',
  UNSUPPORTED_STATEMENT: 'UNSUPPORTED_STATEMENT',
  SUMMARY_TOO_LARGE: 'SUMMARY_TOO_LARGE',
  SOURCE_REF_LIMIT: 'SOURCE_REF_LIMIT',
  CHILD_LIMIT: 'CHILD_LIMIT',
  DEPTH_LIMIT: 'DEPTH_LIMIT',
  MALFORMED_OUTPUT: 'MALFORMED_OUTPUT',
});

export const LORE_WAVE3_LIMITS = Object.freeze({
  maxSourceRefsPerSummary: 4096,
  maxChildrenPerSummary: 64,
  maxHierarchyDepth: 12,
  maxSummaryCharacters: 12000,
  maxQueryCharacters: 512,
  maxExaminedEntries: 512,
  maxNominationsPerIntent: 16,
  maxTotalNominations: 24,
  maxDiagnostics: 128,
  maxActiveWorkBatch: 32,
  maxScopeCount: 12000,
  maxCommunityScopes: 256,
  maxTokensPerRecord: 192,
  maxCandidateTextCharacters: 1600,
});

export function makeScopeId(type, logicalKey) {
  return 'lore-scope:' + type.toLowerCase() + ':' + stableHash(logicalKey);
}

export function createNavigationScope({
  type,
  logicalKey,
  label,
  lorebookId = null,
  treePath = [],
  sourceIds = [],
  childScopeIds = [],
  communityKey = null,
  depth = 0,
  metadata = {},
}) {
  if (!Object.values(NavigationScopeType).includes(type)) throw new TypeError('Unknown navigation scope type: ' + type);
  const uniqueSources = [...new Set(sourceIds)].sort();
  const uniqueChildren = [...new Set(childScopeIds)].sort();
  return {
    kind: 'LoreNavigationScope',
    id: makeScopeId(type, logicalKey),
    type,
    logicalKey,
    label: String(label || logicalKey),
    lorebookId: lorebookId == null ? null : String(lorebookId),
    treePath: [...treePath].map(String),
    sourceIds: uniqueSources,
    childScopeIds: uniqueChildren,
    communityKey: communityKey == null ? null : String(communityKey),
    depth,
    structureRevision: 'structure:' + stableHash(stableStringify({
      type,
      logicalKey,
      lorebookId,
      treePath,
      sourceIds: uniqueSources,
      childScopeIds: uniqueChildren,
      communityKey,
    })),
    authorityClass: AuthorityClass.DERIVED,
    treeTruthAuthority: false,
    entityMergeAuthority: false,
    metadata: deepClone(metadata),
  };
}

export function createNavigationSummaryArtifact({
  scope,
  summaryRevision,
  sourceRevisionSet,
  childSummaryDependencies,
  content,
  provenance,
  qualityReceipt,
  criticalEvidence = [],
  generatorRevision = 'lore-nav-summary-v1',
}) {
  const dependencyFingerprint = stableHash(stableStringify({
    scopeId: scope.id,
    structureRevision: scope.structureRevision,
    sourceRevisionSet,
    childSummaryDependencies,
    generatorRevision,
  }));
  return {
    kind: 'NavigationSummary',
    id: 'navigation-summary:' + dependencyFingerprint,
    summaryRevision,
    targetScopeId: scope.id,
    targetScopeType: scope.type,
    targetLabel: scope.label,
    structureRevision: scope.structureRevision,
    sourceRevisionSet: [...sourceRevisionSet],
    childSummaryDependencies: deepClone(childSummaryDependencies),
    content: String(content),
    provenance: deepClone(provenance),
    qualityReceipt: deepClone(qualityReceipt),
    criticalEvidence: deepClone(criticalEvidence),
    generatorRevision,
    dependencyFingerprint,
    state: NavigationSummaryState.BUILT,
    freshness: 'FRESH',
    authorityClass: AuthorityClass.DERIVED,
    sourceAuthority: false,
    truthAuthority: false,
    settlementAuthority: false,
    candidateBusAdmissionAuthority: false,
    contextSealAuthority: false,
  };
}

export function summaryReuseKey({scope, sourceRevisionSet, childSummaryDependencies, generatorRevision}) {
  return stableHash(stableStringify({
    scopeId: scope.id,
    structureRevision: scope.structureRevision,
    sourceRevisionSet,
    childSummaryDependencies,
    generatorRevision,
  }));
}
