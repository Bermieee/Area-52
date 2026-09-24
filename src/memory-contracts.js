export const MEMORY_API_VERSION = '1.0.0';
export const MEMORY_CONTRACT_VERSION = '1.0.0';
export const CORE_SETTLEMENT_COMPAT_VERSION = '1.0.0';
export const SCENE_MEMORY_HANDOFF_COMPAT_VERSION = '1.0.0';
export const GREEN_ROOM_COMPAT_VERSION = '1.1.0';
export const HISTORIAN_COMPAT_VERSION = '1.0.0';
export const MEMORY_HIERARCHY_API_VERSION = '1.0.0';
export const MEMORY_HIERARCHY_CONTRACT_VERSION = '1.0.0';

export const AuthorityClass = Object.freeze({
  OPERATOR:'OPERATOR',
  SOURCE_CANON:'SOURCE_CANON',
  OBSERVED:'OBSERVED',
  SETTLED:'SETTLED',
  INFERRED:'INFERRED',
  UNRESOLVED:'UNRESOLVED',
  DERIVED:'DERIVED',
  UNKNOWN:'UNKNOWN',
});

export const KnowledgeStatus = Object.freeze({
  CURRENT:'CURRENT',
  HISTORICAL:'HISTORICAL',
  SUPERSEDED:'SUPERSEDED',
  CONTRADICTED:'CONTRADICTED',
  UNCERTAIN:'UNCERTAIN',
  UNRESOLVED:'UNRESOLVED',
  SOURCE_CANON:'SOURCE_CANON',
  INFERRED:'INFERRED',
  STALE:'STALE',
});

export const SettlementDecisionType = Object.freeze({
  ACCEPT_CURRENT:'ACCEPT_CURRENT',
  ACCEPT_HISTORICAL:'ACCEPT_HISTORICAL',
  SUPERSEDE:'SUPERSEDE',
  CONTRADICT:'CONTRADICT',
  UNRESOLVED:'UNRESOLVED',
  REJECT:'REJECT',
});

export const MutationType = Object.freeze({
  SET_CLAIM:'SET_CLAIM',
  CLOSE_SLOT:'CLOSE_SLOT',
});

export const MemoryArtifactKind = Object.freeze({
  RAW_EVIDENCE:'RAW_EVIDENCE',
  SETTLED_CLAIM:'SETTLED_CLAIM',
  HISTORICAL_STATE:'HISTORICAL_STATE',
  UNRESOLVED_HYPOTHESIS:'UNRESOLVED_HYPOTHESIS',
  SCENE_EPISODE:'SCENE_EPISODE',
  EXPERIENCE:'EXPERIENCE',
  REFLECTION:'REFLECTION',
  GREEN_ROOM_INFERENCE:'GREEN_ROOM_INFERENCE',
  SCENE_SUMMARY:'SCENE_SUMMARY',
  CHAPTER_SUMMARY:'CHAPTER_SUMMARY',
  SESSION_SUMMARY:'SESSION_SUMMARY',
  ARC_SUMMARY:'ARC_SUMMARY',
  STORY_SUMMARY:'STORY_SUMMARY',
});

export const PerspectiveScope = Object.freeze({
  WORLD:'WORLD',
  CHARACTER_KNOWLEDGE:'CHARACTER_KNOWLEDGE',
  OBSERVED_BY:'OBSERVED_BY',
  HEARD_FROM:'HEARD_FROM',
  BELIEVED:'BELIEVED',
  UNCERTAIN:'UNCERTAIN',
  FALSE_BELIEF:'FALSE_BELIEF',
  PERSPECTIVE_UNAVAILABLE:'PERSPECTIVE_UNAVAILABLE',
});

export const MEMORY_LIMITS = Object.freeze({
  maxEvidenceRefsPerArtifact:128,
  maxSourceRevisionRefsPerArtifact:64,
  maxProjectionSlots:4096,
  maxJournalTraversal:8192,
  maxGraphTraversalClaims:512,
  maxGreenRoomCharacters:16,
  maxGreenRoomDimensions:9,
  maxGreenRoomHistory:512,
  maxEpisodeEvidenceRefs:128,
  maxEpisodesPerBatch:64,
  maxReflectionSupportRefs:128,
  maxReflectionContradictionRefs:128,
  maxReflectionBatch:32,
  maxHistorianQueryCharacters:600,
  maxHistorianExaminedArtifacts:512,
  maxHistorianCandidates:48,
  maxHistorianEpisodes:24,
  maxHistorianReflections:12,
  maxHistorianEvidenceBytes:65536,
  maxHistorianExcerptCharacters:1600,
  maxDiagnostics:128,
  maxCheckpointWorkUnits:32,
  maxConsolidationJobs:4096,
  maxIndexedTermsPerArtifact:192,
  maxSummaryScopes:2048,
  maxSummaryChildScopes:512,
  maxSummaryEpisodeLogicalIds:512,
  maxSummaryEvidenceRefs:8192,
  maxSummarySourceRevisionRefs:8192,
  maxSummaryEntityRefs:512,
  maxSummaryCharacters:12000,
  minSummaryCharacters:128,
  maxSummaryRepresentativeEvidence:24,
  maxSummaryWorkUnits:32,
  maxSummaryDrillbackRows:256,
});

export function deepClone(value) {
  return value == null ? value : structuredClone(value);
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
}

export function stableHash(value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return h1.toString(16).padStart(8,'0') + h2.toString(16).padStart(8,'0');
}

export function uniqStrings(values = [], limit = Infinity) {
  if (!Array.isArray(values)) throw new TypeError('Expected an array of strings');
  const out = [...new Set(values.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()))].sort();
  if (out.length > limit) throw new RangeError('String array exceeds bound ' + limit);
  return out;
}

export function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' must be a non-empty string');
  return value.trim();
}

export function finiteNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError(name + ' must be finite');
  return n;
}

export function unitNumber(value, name) {
  const n = finiteNumber(value, name);
  if (n < 0 || n > 1) throw new TypeError(name + ' must be within 0..1');
  return n;
}

export function slotKey(subjectId, predicate) {
  return requiredString(subjectId,'subjectId') + '|' + requiredString(predicate,'predicate');
}

export function createArtifactReference({
  artifactId,
  artifactType,
  owner='MEMORY',
  revision=1,
  domain='MEMORY',
  sourceRevisionSet=[],
  worldRevision=null,
  sceneRevision=null,
  contentHash=null,
  provenanceRef=null,
  expiry=null,
}={}) {
  const rev = Number(revision);
  if (!Number.isInteger(rev) || rev < 1) throw new TypeError('ArtifactReference.revision must be positive');
  return {
    kind:'ArtifactReference',
    artifactId:requiredString(artifactId,'ArtifactReference.artifactId'),
    artifactType:requiredString(artifactType,'ArtifactReference.artifactType'),
    owner:requiredString(owner,'ArtifactReference.owner'),
    revision:rev,
    domain:requiredString(domain,'ArtifactReference.domain'),
    sourceRevisionSet:uniqStrings(sourceRevisionSet,MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact),
    worldRevision:worldRevision == null ? null : finiteNumber(worldRevision,'ArtifactReference.worldRevision'),
    sceneRevision:sceneRevision == null ? null : finiteNumber(sceneRevision,'ArtifactReference.sceneRevision'),
    contentHash:contentHash == null ? null : String(contentHash),
    provenanceRef:provenanceRef == null ? null : String(provenanceRef),
    expiry:deepClone(expiry),
    authorityGranted:false,
    settlementAuthority:false,
    contextSealAuthority:false,
  };
}

export function createCandidateNomination({
  nominationId,
  candidateId,
  evidenceIdentity,
  artifactRef,
  artifactRevision=1,
  sourceRevisionRefs=[],
  claimRefs=[],
  eventRefs=[],
  entityRefs=[],
  relationshipRefs=[],
  retrievalIntentIds=[],
  rankSignals={},
  normalizedRank=null,
  temporalHints=[],
  authorityClass=AuthorityClass.UNKNOWN,
  truthStatusHint=KnowledgeStatus.UNRESOLVED,
  provenance=[],
  evidenceRefs=[],
  dependencyRevisions=[],
  representationRef=null,
  representationRevision=1,
  representationText='',
  metadata={},
  worldRevision=null,
  sceneRevision=null,
}={}) {
  return {
    kind:'CandidateNomination',
    contractVersion:'1.0.0',
    nominationId:requiredString(nominationId,'nominationId'),
    channelId:'memory-historian-local',
    channelVersion:'1.0.0',
    candidateId:requiredString(candidateId,'candidateId'),
    evidenceIdentity:requiredString(evidenceIdentity,'evidenceIdentity'),
    artifactRef:deepClone(artifactRef),
    artifactRevision:Number(artifactRevision),
    sourceRevisionRefs:uniqStrings(sourceRevisionRefs,64),
    claimRefs:uniqStrings(claimRefs,64),
    eventRefs:uniqStrings(eventRefs,64),
    entityRefs:uniqStrings(entityRefs,64),
    relationshipRefs:uniqStrings(relationshipRefs,64),
    retrievalIntentIds:uniqStrings(retrievalIntentIds,16),
    rankSignals:deepClone(rankSignals),
    normalizedRank:normalizedRank == null ? null : unitNumber(normalizedRank,'normalizedRank'),
    graphMetadata:null,
    temporalHints:deepClone(temporalHints).slice(0,32),
    continuitySignals:[],
    authorityClass,
    truthStatusHint,
    provenance:deepClone(provenance).slice(0,64),
    evidenceRefs:uniqStrings(evidenceRefs,64),
    dependencyRevisions:uniqStrings(dependencyRevisions,64),
    freshness:'FRESH',
    representationRef:representationRef == null ? null : String(representationRef),
    representationRevision:Number(representationRevision),
    representationText:String(representationText).slice(0,MEMORY_LIMITS.maxHistorianExcerptCharacters),
    metadata:deepClone(metadata),
    worldRevision:worldRevision == null ? null : Number(worldRevision),
    sceneRevision:sceneRevision == null ? null : Number(sceneRevision),
    authorityGranted:false,
    admissionAuthority:false,
    settlementAuthority:false,
    canonicalMutationAuthority:false,
  };
}
