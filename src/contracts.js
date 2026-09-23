const freeze = (value) => Object.freeze(value);

export const KnowledgeStatus = freeze({
  CURRENT: 'CURRENT',
  HISTORICAL: 'HISTORICAL',
  SUPERSEDED: 'SUPERSEDED',
  CONTRADICTED: 'CONTRADICTED',
  UNCERTAIN: 'UNCERTAIN',
  UNRESOLVED: 'UNRESOLVED',
  SOURCE_CANON: 'SOURCE_CANON',
  INFERRED: 'INFERRED',
});

export const AuthorityClass = freeze({
  OPERATOR: 'OPERATOR',
  SOURCE_CANON: 'SOURCE_CANON',
  OBSERVED: 'OBSERVED',
  SETTLED: 'SETTLED',
  INFERRED: 'INFERRED',
  UNRESOLVED: 'UNRESOLVED',
});

export const CognitiveTaskClass = freeze({
  REFLEX: 'REFLEX',
  THOUGHT: 'THOUGHT',
  SLEEP: 'SLEEP',
});

export const MutationType = freeze({
  SET_CLAIM: 'SET_CLAIM',
  CLOSE_SLOT: 'CLOSE_SLOT',
});

export const SettlementOutcome = freeze({
  SETTLED: 'SETTLED',
  REJECTED: 'REJECTED',
  STALE: 'STALE',
  FAILED: 'FAILED',
});

const enumValues = (e) => new Set(Object.values(e));
const STATUS = enumValues(KnowledgeStatus);
const AUTHORITY = enumValues(AuthorityClass);
const TASK_CLASS = enumValues(CognitiveTaskClass);
const MUTATION = enumValues(MutationType);
const OUTCOME = enumValues(SettlementOutcome);

function requiredString(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function stringArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${name} must be an array of strings`);
  }
  return [...value];
}

function oneOf(value, allowed, name) {
  if (!allowed.has(value)) throw new TypeError(`${name} has unsupported value: ${value}`);
  return value;
}

function serializable(value, name) {
  try { JSON.stringify(value); } catch { throw new TypeError(`${name} must be JSON-serializable`); }
  return value;
}

export function createSourceRecord({ id, sourceType, logicalKey = id, metadata = {} }) {
  return {
    kind: 'SourceRecord',
    id: requiredString(id, 'SourceRecord.id'),
    sourceType: requiredString(sourceType, 'SourceRecord.sourceType'),
    logicalKey: requiredString(logicalKey, 'SourceRecord.logicalKey'),
    metadata: serializable(structuredClone(metadata), 'SourceRecord.metadata'),
  };
}

export function createSourceRevision({ id, sourceId, revision, contentHash, exactContent, replacesRevisionId = null }) {
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError('SourceRevision.revision must be a positive integer');
  if (replacesRevisionId !== null) requiredString(replacesRevisionId, 'SourceRevision.replacesRevisionId');
  return {
    kind: 'SourceRevision', id: requiredString(id, 'SourceRevision.id'), sourceId: requiredString(sourceId, 'SourceRevision.sourceId'),
    revision, contentHash: requiredString(contentHash, 'SourceRevision.contentHash'), exactContent: requiredString(exactContent, 'SourceRevision.exactContent'),
    replacesRevisionId,
  };
}

export function createProvenance({ id, sourceRevisionIds = [], evidenceIds = [], derivedFromIds = [], activity, agent, invalidators = [] }) {
  return {
    kind: 'Provenance', id: requiredString(id, 'Provenance.id'),
    sourceRevisionIds: stringArray(sourceRevisionIds, 'Provenance.sourceRevisionIds'), evidenceIds: stringArray(evidenceIds, 'Provenance.evidenceIds'),
    derivedFromIds: stringArray(derivedFromIds, 'Provenance.derivedFromIds'), activity: requiredString(activity, 'Provenance.activity'),
    agent: requiredString(agent, 'Provenance.agent'), invalidators: stringArray(invalidators, 'Provenance.invalidators'),
  };
}

export function createEntity({ id, canonicalName, entityType, aliases = [], provenance }) {
  return {
    kind: 'Entity', id: requiredString(id, 'Entity.id'), canonicalName: requiredString(canonicalName, 'Entity.canonicalName'),
    entityType: requiredString(entityType, 'Entity.entityType'), aliases: stringArray(aliases, 'Entity.aliases'), provenance: serializable(structuredClone(provenance), 'Entity.provenance'),
  };
}

export function createAliasCandidate({ id, alias, entityId, confidence = 1, status = KnowledgeStatus.SOURCE_CANON, provenance }) {
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) throw new TypeError('AliasCandidate.confidence must be 0..1');
  return {
    kind: 'AliasCandidate', id: requiredString(id, 'AliasCandidate.id'), alias: requiredString(alias, 'AliasCandidate.alias'), entityId: requiredString(entityId, 'AliasCandidate.entityId'),
    confidence, status: oneOf(status, STATUS, 'AliasCandidate.status'), provenance: serializable(structuredClone(provenance), 'AliasCandidate.provenance'),
  };
}

export function createClaim({ id, subjectId, predicate, value, temporal, authorityClass, confidence = 1, status = KnowledgeStatus.CURRENT, provenance, supersedes = [], contradictedBy = [], owner = 'WORLD_STATE' }) {
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) throw new TypeError('Claim.confidence must be 0..1');
  if (!temporal || typeof temporal !== 'object') throw new TypeError('Claim.temporal is required');
  return {
    kind: 'Claim', id: requiredString(id, 'Claim.id'), subjectId: requiredString(subjectId, 'Claim.subjectId'), predicate: requiredString(predicate, 'Claim.predicate'),
    value: serializable(structuredClone(value), 'Claim.value'), temporal: serializable(structuredClone(temporal), 'Claim.temporal'),
    authorityClass: oneOf(authorityClass, AUTHORITY, 'Claim.authorityClass'), confidence, status: oneOf(status, STATUS, 'Claim.status'),
    provenance: serializable(structuredClone(provenance), 'Claim.provenance'), supersedes: stringArray(supersedes, 'Claim.supersedes'), contradictedBy: stringArray(contradictedBy, 'Claim.contradictedBy'),
    owner: requiredString(owner, 'Claim.owner'),
  };
}

export function createReflection({ id, statement, evidenceIds, confidence, provenance, status = KnowledgeStatus.INFERRED, owner = 'REFLECTION' }) {
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) throw new TypeError('Reflection.confidence must be 0..1');
  return {
    kind: 'Reflection', id: requiredString(id, 'Reflection.id'), statement: requiredString(statement, 'Reflection.statement'), evidenceIds: stringArray(evidenceIds, 'Reflection.evidenceIds'),
    confidence, provenance: serializable(structuredClone(provenance), 'Reflection.provenance'), status: oneOf(status, STATUS, 'Reflection.status'), owner: requiredString(owner, 'Reflection.owner'),
  };
}

export function createCandidateBusResult({ candidateId, sourceType, sourceId, entityIds = [], claimIds = [], scoreSignals = {}, retrievalIntents = [], temporalStatus = KnowledgeStatus.UNRESOLVED, provenance }) {
  return {
    kind: 'CandidateBusResult', candidateId: requiredString(candidateId, 'CandidateBusResult.candidateId'), sourceType: requiredString(sourceType, 'CandidateBusResult.sourceType'), sourceId: requiredString(sourceId, 'CandidateBusResult.sourceId'),
    entityIds: stringArray(entityIds, 'CandidateBusResult.entityIds'), claimIds: stringArray(claimIds, 'CandidateBusResult.claimIds'), scoreSignals: serializable(structuredClone(scoreSignals), 'CandidateBusResult.scoreSignals'),
    retrievalIntents: stringArray(retrievalIntents, 'CandidateBusResult.retrievalIntents'), temporalStatus: oneOf(temporalStatus, STATUS, 'CandidateBusResult.temporalStatus'),
    provenance: serializable(structuredClone(provenance), 'CandidateBusResult.provenance'),
  };
}

export function createTruthGateResult({ candidateId, classification, usableForIntent, reasons = [], claimIds = [], provenance }) {
  return {
    kind: 'TruthGateResult', candidateId: requiredString(candidateId, 'TruthGateResult.candidateId'), classification: oneOf(classification, STATUS, 'TruthGateResult.classification'),
    usableForIntent: Boolean(usableForIntent), reasons: stringArray(reasons, 'TruthGateResult.reasons'), claimIds: stringArray(claimIds, 'TruthGateResult.claimIds'),
    provenance: serializable(structuredClone(provenance), 'TruthGateResult.provenance'),
  };
}

export function createMutationProposal({ id, mutationType, owner, sourceRevisionIds = [], evidenceIds = [], freshnessRevisionIds = sourceRevisionIds, payload, status = 'PROPOSED' }) {
  return {
    kind: 'MutationProposal', id: requiredString(id, 'MutationProposal.id'), mutationType: oneOf(mutationType, MUTATION, 'MutationProposal.mutationType'), owner: requiredString(owner, 'MutationProposal.owner'),
    sourceRevisionIds: stringArray(sourceRevisionIds, 'MutationProposal.sourceRevisionIds'), evidenceIds: stringArray(evidenceIds, 'MutationProposal.evidenceIds'), freshnessRevisionIds: stringArray(freshnessRevisionIds, 'MutationProposal.freshnessRevisionIds'),
    payload: serializable(structuredClone(payload), 'MutationProposal.payload'), status: requiredString(status, 'MutationProposal.status'),
  };
}

export function createSettlementReceipt({ id, proposalId, owner, outcome, settledArtifactIds = [], supersededArtifactIds = [], revision, reason = null }) {
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError('SettlementReceipt.revision must be a positive integer');
  return {
    kind: 'SettlementReceipt', id: requiredString(id, 'SettlementReceipt.id'), proposalId: requiredString(proposalId, 'SettlementReceipt.proposalId'), owner: requiredString(owner, 'SettlementReceipt.owner'),
    outcome: oneOf(outcome, OUTCOME, 'SettlementReceipt.outcome'), settledArtifactIds: stringArray(settledArtifactIds, 'SettlementReceipt.settledArtifactIds'), supersededArtifactIds: stringArray(supersededArtifactIds, 'SettlementReceipt.supersededArtifactIds'),
    revision, reason: reason === null ? null : requiredString(reason, 'SettlementReceipt.reason'),
  };
}

export function createCompiledContextPacket({ id, query, intent, current = [], historical = [], unresolved = [], provenanceIndex = {}, dependencies = [] }) {
  return {
    kind: 'CompiledContextPacket', id: requiredString(id, 'CompiledContextPacket.id'), query: requiredString(query, 'CompiledContextPacket.query'), intent: requiredString(intent, 'CompiledContextPacket.intent'),
    current: serializable(structuredClone(current), 'CompiledContextPacket.current'), historical: serializable(structuredClone(historical), 'CompiledContextPacket.historical'), unresolved: serializable(structuredClone(unresolved), 'CompiledContextPacket.unresolved'),
    provenanceIndex: serializable(structuredClone(provenanceIndex), 'CompiledContextPacket.provenanceIndex'), dependencies: stringArray(dependencies, 'CompiledContextPacket.dependencies'),
  };
}

export function createCacheDependency({ cacheKey, sourceRevisionIds = [], artifactIds = [], invalidators = [] }) {
  return {
    kind: 'CacheDependency', cacheKey: requiredString(cacheKey, 'CacheDependency.cacheKey'), sourceRevisionIds: stringArray(sourceRevisionIds, 'CacheDependency.sourceRevisionIds'),
    artifactIds: stringArray(artifactIds, 'CacheDependency.artifactIds'), invalidators: stringArray(invalidators, 'CacheDependency.invalidators'),
  };
}

export function createCognitiveTask({ id, taskClass, taskType, inputRevisionIds = [], dependencyTaskIds = [], payload = {} }) {
  return {
    kind: 'CognitiveTask', id: requiredString(id, 'CognitiveTask.id'), taskClass: oneOf(taskClass, TASK_CLASS, 'CognitiveTask.taskClass'), taskType: requiredString(taskType, 'CognitiveTask.taskType'),
    inputRevisionIds: stringArray(inputRevisionIds, 'CognitiveTask.inputRevisionIds'), dependencyTaskIds: stringArray(dependencyTaskIds, 'CognitiveTask.dependencyTaskIds'), payload: serializable(structuredClone(payload), 'CognitiveTask.payload'),
  };
}
