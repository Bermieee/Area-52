import { FailureCode } from './constants.js';

export function toTruthCompatibleEvidenceSet(precisionResultSet) {
  if (!precisionResultSet || precisionResultSet.kind !== 'PrecisionResultSet') fail(FailureCode.SCHEMA_INVALID, 'PrecisionResultSet required');
  return Object.freeze({
    kind: 'TruthCompatibleEvidenceSet',
    candidateSetId: precisionResultSet.candidateSetId,
    sourceRevisionSet: Object.freeze([...(precisionResultSet.sourceRevisionSet ?? [])]),
    worldRevision: precisionResultSet.worldRevision,
    sceneRevision: precisionResultSet.sceneRevision,
    evidence: Object.freeze((precisionResultSet.results ?? []).map((result) => Object.freeze({
      candidateRef: result.candidateRef,
      artifactRef: structuredClone(result.artifactRef),
      sourceRevisionRefs: Object.freeze([...(result.sourceRevisionRefs ?? [])]),
      evidenceRefs: Object.freeze([...(result.evidenceRefs ?? [])]),
      relevanceScore: result.relevanceScore,
      temporalCompatibility: result.temporalCompatibility,
      sceneCompatibility: result.sceneCompatibility,
      authorityClass: result.authorityClass,
      truthStatus: result.truthStatus,
      provenance: structuredClone(result.provenance ?? []),
      reasonCodes: Object.freeze([...(result.reasonCodes ?? [])]),
    }))),
    rankingAuthority: 'PRECISION_ONLY',
    truthClassificationAuthority: 'TRUTH_GATE',
    settlementAuthority: false,
    canonicalMutation: false,
  });
}

export function assertPrecisionTruthBoundary(precisionResultSet) {
  for (const result of precisionResultSet?.results ?? []) {
    if (result.authorityGranted === true || result.settlementAuthority === true) fail(FailureCode.AUTHORITY_VIOLATION, `Precision result ${result.candidateRef} claims authority`);
    if (result.truthStatus === 'CURRENT' && result.temporalCompatibility === 0) fail(FailureCode.AUTHORITY_VIOLATION, `Precision result ${result.candidateRef} has incompatible CURRENT metadata`);
  }
  return true;
}

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
