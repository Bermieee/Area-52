import { FailureCode } from './constants.js';

export const CANDIDATE_BUS_CONTRACT_VERSION = '1.0.0';
export const CandidateFreshness = Object.freeze({ FRESH: 'FRESH', STALE: 'STALE', INVALID: 'INVALID' });
export const CandidateTruthStatus = Object.freeze({
  CURRENT: 'CURRENT', HISTORICAL: 'HISTORICAL', SUPERSEDED: 'SUPERSEDED', CONTRADICTED: 'CONTRADICTED',
  UNCERTAIN: 'UNCERTAIN', UNRESOLVED: 'UNRESOLVED', UNKNOWN: 'UNKNOWN',
});
export const CandidateAuthorityClass = Object.freeze({
  OBSERVED: 'OBSERVED', INFERRED: 'INFERRED', SETTLED: 'SETTLED', UNRESOLVED: 'UNRESOLVED', DERIVED: 'DERIVED', SOURCE_CANON: 'SOURCE_CANON', UNKNOWN: 'UNKNOWN',
});

const TRUTH_STATUSES = new Set(Object.values(CandidateTruthStatus));
const AUTHORITY_CLASSES = new Set(Object.values(CandidateAuthorityClass));

export function createCandidateBusEnvelope({
  candidateSetId = 'candidate-set', query = null, intentFingerprint = null, sourceRevisionSet = [], worldRevision = 0,
  sceneRevision = 0, candidates = [], unavailableChannels = [], maxCandidates = 256,
} = {}) {
  const limit = boundedInteger(maxCandidates, 1, 4096, 'maxCandidates');
  if (!Array.isArray(candidates)) fail(FailureCode.SCHEMA_INVALID, 'CandidateBus.candidates must be an array');
  if (candidates.length > limit) fail(FailureCode.SCHEMA_INVALID, `CandidateBus input exceeds maxCandidates=${limit}`);
  const normalized = candidates.map((candidate, index) => normalizeCandidate(candidate, { inputRank: index + 1 }));
  const deduped = dedupeCandidates(normalized);
  return deepFreeze({
    kind: 'CandidateBusEnvelope', contractVersion: CANDIDATE_BUS_CONTRACT_VERSION,
    candidateSetId: required(candidateSetId, 'candidateSetId'), query: query == null ? null : String(query),
    intentFingerprint: intentFingerprint == null ? null : required(intentFingerprint, 'intentFingerprint'),
    sourceRevisionSet: uniqueStrings(sourceRevisionSet), worldRevision: finite(worldRevision, 'worldRevision'),
    sceneRevision: finite(sceneRevision, 'sceneRevision'), unavailableChannels: uniqueStrings(unavailableChannels),
    inputCandidateCount: candidates.length, candidateCount: deduped.candidates.length,
    duplicateNominations: deduped.duplicateNominations, candidates: deduped.candidates,
    authorityGranted: false, admissionAuthority: false,
  });
}

export function normalizeCandidate(input = {}, { inputRank = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(FailureCode.SCHEMA_INVALID, 'candidate must be an object');
  const candidateId = required(input.candidateId ?? input.ref, 'candidateId');
  const sourceRevisionRefs = uniqueStrings(input.sourceRevisionRefs ?? input.sourceRevisionSet ?? []);
  const channel = required(input.channel ?? 'UNKNOWN', 'channel');
  const truthStatus = normalizeEnum(input.truthStatus, TRUTH_STATUSES, CandidateTruthStatus.UNKNOWN, 'truthStatus');
  const authorityClass = normalizeEnum(input.authorityClass, AUTHORITY_CLASSES, CandidateAuthorityClass.UNKNOWN, 'authorityClass');
  const normalized = {
    kind: 'RetrievalCandidate', contractVersion: CANDIDATE_BUS_CONTRACT_VERSION,
    candidateId,
    evidenceIdentity: required(input.evidenceIdentity ?? deriveEvidenceIdentity(input, candidateId), 'evidenceIdentity'),
    artifactRef: input.artifactRef == null ? null : structuredClone(input.artifactRef),
    sourceRevisionRefs,
    worldRevision: input.worldRevision == null ? null : finite(input.worldRevision, 'candidate.worldRevision'),
    sceneRevision: input.sceneRevision == null ? null : finite(input.sceneRevision, 'candidate.sceneRevision'),
    channel,
    nominatedBy: Object.freeze(uniqueStrings([...(input.nominatedBy ?? []), channel])),
    rankSignals: normalizeRankSignals(input.rankSignals ?? {}),
    entityRefs: Object.freeze(uniqueStrings(input.entityRefs ?? [])),
    relationshipRefs: Object.freeze(uniqueStrings(input.relationshipRefs ?? [])),
    eventRefs: Object.freeze(uniqueStrings(input.eventRefs ?? [])),
    claimRefs: Object.freeze(uniqueStrings(input.claimRefs ?? [])),
    retrievalIntentIds: Object.freeze(uniqueStrings(input.retrievalIntentIds ?? [])),
    temporalHints: Object.freeze(uniqueStrings(input.temporalHints ?? [])),
    freshness: input.freshness ?? CandidateFreshness.FRESH,
    dependencyRevisions: Object.freeze(uniqueStrings(input.dependencyRevisions ?? [])),
    perspective: input.perspective == null ? null : Object.freeze(structuredClone(input.perspective)),
    truthStatusHint: normalizeEnum(input.truthStatusHint ?? truthStatus, TRUTH_STATUSES, truthStatus, 'truthStatusHint'),
    sceneRelevance: input.sceneRelevance == null ? null : unit(input.sceneRelevance, 'sceneRelevance'),
    authorityClass,
    truthStatus,
    provenance: Object.freeze(normalizeProvenance(input.provenance ?? [])),
    evidenceRefs: Object.freeze(uniqueStrings(input.evidenceRefs ?? sourceRevisionRefs)),
    representationText: input.representationText ?? input.text ?? input.statement ?? input.summary ?? null,
    inputRank: input.inputRank == null ? inputRank : boundedInteger(input.inputRank, 1, Number.MAX_SAFE_INTEGER, 'inputRank'),
    duplicateCount: Math.max(1, Number(input.duplicateCount ?? 1) || 1),
    metadata: structuredClone(input.metadata ?? {}),
    authorityGranted: false,
    admissionAuthority: false,
  };
  if (normalized.representationText != null) normalized.representationText = String(normalized.representationText);
  return deepFreeze(normalized);
}

export function dedupeCandidates(candidates = []) {
  const byIdentity = new Map();
  let duplicateNominations = 0;
  for (const raw of candidates) {
    const candidate = raw?.kind === 'RetrievalCandidate' ? raw : normalizeCandidate(raw);
    const prior = byIdentity.get(candidate.evidenceIdentity);
    if (!prior) { byIdentity.set(candidate.evidenceIdentity, structuredClone(candidate)); continue; }
    duplicateNominations += 1;
    prior.nominatedBy = uniqueStrings([...prior.nominatedBy, ...candidate.nominatedBy]);
    prior.rankSignals = mergeRankSignals(prior.rankSignals, candidate.rankSignals);
    prior.provenance = mergeProvenance(prior.provenance, candidate.provenance);
    prior.evidenceRefs = uniqueStrings([...prior.evidenceRefs, ...candidate.evidenceRefs]);
    prior.sourceRevisionRefs = uniqueStrings([...prior.sourceRevisionRefs, ...candidate.sourceRevisionRefs]);
    prior.entityRefs = uniqueStrings([...prior.entityRefs, ...candidate.entityRefs]);
    prior.relationshipRefs = uniqueStrings([...prior.relationshipRefs, ...candidate.relationshipRefs]);
    prior.eventRefs = uniqueStrings([...(prior.eventRefs ?? []), ...(candidate.eventRefs ?? [])]);
    prior.claimRefs = uniqueStrings([...(prior.claimRefs ?? []), ...(candidate.claimRefs ?? [])]);
    prior.retrievalIntentIds = uniqueStrings([...(prior.retrievalIntentIds ?? []), ...(candidate.retrievalIntentIds ?? [])]);
    prior.temporalHints = uniqueStrings([...prior.temporalHints, ...candidate.temporalHints]);
    prior.dependencyRevisions = uniqueStrings([...(prior.dependencyRevisions ?? []), ...(candidate.dependencyRevisions ?? [])]);
    if (prior.perspective == null && candidate.perspective != null) prior.perspective = structuredClone(candidate.perspective);
    prior.duplicateCount = Number(prior.duplicateCount ?? 1) + 1;
    // Ranking support from multiple channels is metadata, never confidence multiplication.
    prior.sceneRelevance = maxNullable(prior.sceneRelevance, candidate.sceneRelevance);
  }
  const values = [...byIdentity.values()].map((value) => deepFreeze(value));
  return deepFreeze({ candidates: values, duplicateNominations });
}

export function classifyCandidateFreshness(candidate, currentRevisionSet = {}) {
  if (!candidate || typeof candidate !== 'object') return CandidateFreshness.INVALID;
  if (candidate.worldRevision != null && Number(candidate.worldRevision) !== Number(currentRevisionSet.worldRevision ?? candidate.worldRevision)) return CandidateFreshness.STALE;
  if (candidate.sceneRevision != null && Number(candidate.sceneRevision) !== Number(currentRevisionSet.sceneRevision ?? candidate.sceneRevision)) return CandidateFreshness.STALE;
  const currentSources = new Set(currentRevisionSet.sourceRevisionSet ?? []);
  if ((candidate.sourceRevisionRefs ?? []).some((ref) => !currentSources.has(ref))) return CandidateFreshness.STALE;
  return CandidateFreshness.FRESH;
}

export function filterFreshCandidates(candidates = [], currentRevisionSet = {}) {
  const fresh = [], stale = [], invalid = [];
  for (const candidate of candidates) {
    const state = classifyCandidateFreshness(candidate, currentRevisionSet);
    if (state === CandidateFreshness.FRESH) fresh.push(candidate);
    else if (state === CandidateFreshness.STALE) stale.push(candidate);
    else invalid.push(candidate);
  }
  return deepFreeze({ fresh: structuredClone(fresh), stale: structuredClone(stale), invalid: structuredClone(invalid) });
}

export function candidateDrilldown(candidate) {
  const value = candidate?.kind === 'RetrievalCandidate' ? candidate : normalizeCandidate(candidate);
  return deepFreeze({
    precisionCandidateRef: value.candidateId,
    candidateRef: value.candidateId,
    artifactRef: structuredClone(value.artifactRef),
    sourceRevisionRefs: [...value.sourceRevisionRefs],
    provenance: structuredClone(value.provenance),
    evidenceIdentity: value.evidenceIdentity,
    retrievalIntentIds: [...(value.retrievalIntentIds ?? [])],
    eventRefs: [...(value.eventRefs ?? [])],
    claimRefs: [...(value.claimRefs ?? [])],
    dependencyRevisions: [...(value.dependencyRevisions ?? [])],
    perspective: value.perspective == null ? null : structuredClone(value.perspective),
  });
}

function deriveEvidenceIdentity(input, candidateId) {
  const artifact = input.artifactRef;
  const artifactKey = artifact && typeof artifact === 'object'
    ? `${artifact.artifactId ?? artifact.id ?? ''}@${artifact.revision ?? ''}`
    : String(artifact ?? '');
  const sources = uniqueStrings(input.sourceRevisionRefs ?? input.sourceRevisionSet ?? []).join('|');
  return artifactKey || sources ? `${artifactKey}#${sources}` : candidateId;
}
function normalizeRankSignals(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(FailureCode.SCHEMA_INVALID, 'rankSignals must be an object');
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const number = Number(value);
    if (!Number.isFinite(number)) fail(FailureCode.SCHEMA_INVALID, `rankSignals.${key} must be finite`);
    out[key] = number;
  }
  return out;
}
function mergeRankSignals(a = {}, b = {}) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = key in out ? Math.max(Number(out[key]), Number(value)) : Number(value);
  return out;
}
function normalizeProvenance(values) {
  if (!Array.isArray(values)) fail(FailureCode.SCHEMA_INVALID, 'provenance must be an array');
  return values.map((value) => typeof value === 'string' ? { ref: value } : structuredClone(value));
}
function mergeProvenance(a = [], b = []) {
  const seen = new Set(); const out = [];
  for (const value of [...a, ...b]) {
    const key = JSON.stringify(value);
    if (!seen.has(key)) { seen.add(key); out.push(structuredClone(value)); }
  }
  return out;
}
function normalizeEnum(value, allowed, fallback, name) {
  if (value == null) return fallback;
  if (!allowed.has(value)) fail(FailureCode.SCHEMA_INVALID, `unsupported ${name}: ${value}`);
  return value;
}
function maxNullable(a, b) { if (a == null) return b; if (b == null) return a; return Math.max(Number(a), Number(b)); }
function unit(value, name) { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 1) fail(FailureCode.SCHEMA_INVALID, `${name} must be within 0..1`); return n; }
function finite(value, name) { const n = Number(value); if (!Number.isFinite(n)) fail(FailureCode.SCHEMA_INVALID, `${name} must be finite`); return n; }
function boundedInteger(value, min, max, name) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) fail(FailureCode.SCHEMA_INVALID, `${name} must be an integer within ${min}..${max}`); return n; }
function required(value, name) { if (typeof value !== 'string' || !value.trim()) fail(FailureCode.SCHEMA_INVALID, `${name} must be a non-empty string`); return value.trim(); }
function uniqueStrings(values) { if (!Array.isArray(values)) fail(FailureCode.SCHEMA_INVALID, 'expected array of strings'); return [...new Set(values.map((value) => required(value, 'reference')))]; }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
