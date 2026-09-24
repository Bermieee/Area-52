import { Capability, FailureCode, Placement, ResultClass } from './constants.js';
import { createCognitiveTask, createRevisionSet } from './contracts.js';

export const CONSOLIDATION_CONTRACT_VERSION = '1.0.0';
export const ConsolidationProposalKind = Object.freeze({
  EPISODE_SUMMARY: 'EPISODE_SUMMARY',
  CLAIM_CANDIDATE: 'CLAIM_CANDIDATE',
  RELATIONSHIP_UPDATE: 'RELATIONSHIP_UPDATE',
  REFLECTION_EVIDENCE: 'REFLECTION_EVIDENCE',
  STATE_CHANGE_PROPOSAL: 'STATE_CHANGE_PROPOSAL',
  COMPRESSED_REPRESENTATION: 'COMPRESSED_REPRESENTATION',
  CROSS_EPISODE_LINK: 'CROSS_EPISODE_LINK',
});
export const ConsolidationUnitStatus = Object.freeze({ PENDING: 'PENDING', CHECKPOINTED: 'CHECKPOINTED', SUPERSEDED: 'SUPERSEDED', STALE: 'STALE', COMPLETE: 'COMPLETE' });

export function createConsolidationUnit(input = {}) {
  const refs = normalizeArtifactRefs(input.artifactRefs ?? input.inputRefs ?? []);
  if (!refs.length) throw new TypeError('ConsolidationUnit requires at least one Artifact Reference');
  return deepFreeze({
    kind: 'ConsolidationUnit',
    contractVersion: CONSOLIDATION_CONTRACT_VERSION,
    unitId: required(input.unitId, 'unitId'),
    artifactRefs: refs,
    sourceRevisionSet: uniqueStrings(input.sourceRevisionSet ?? []),
    worldRevision: finite(input.worldRevision ?? 0, 'worldRevision'),
    sceneRevision: finite(input.sceneRevision ?? 0, 'sceneRevision'),
    characterStateRevision: finite(input.characterStateRevision ?? 0, 'characterStateRevision'),
    priority: finite(input.priority ?? 0, 'priority'),
    createdAt: finite(input.createdAt ?? 0, 'createdAt'),
    checkpoint: input.checkpoint == null ? null : structuredClone(input.checkpoint),
    resumeIdentity: required(input.resumeIdentity ?? `consolidation:${input.unitId}`, 'resumeIdentity'),
    status: input.status ?? ConsolidationUnitStatus.PENDING,
    authority: 'NONE',
  });
}

export function createConsolidationProposal(input = {}) {
  if (input.authority != null && !['UNRESOLVED', 'INFERRED'].includes(input.authority)) fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation proposal cannot claim canonical authority');
  if (input.settlementAuthority === true || input.memoryMutation === true || input.deleteSourceTurns === true) fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation proposal cannot mutate Memory, Settlement, or delete sources');
  if (!Object.values(ConsolidationProposalKind).includes(input.proposalKind)) fail(FailureCode.SCHEMA_INVALID, `Unknown consolidation proposal kind: ${input.proposalKind}`);
  const sourceArtifactRefs = normalizeArtifactRefs(input.sourceArtifactRefs ?? []);
  if (!sourceArtifactRefs.length) fail(FailureCode.SCHEMA_INVALID, 'Consolidation proposal requires sourceArtifactRefs');
  return deepFreeze({
    kind: 'ConsolidationProposal',
    contractVersion: CONSOLIDATION_CONTRACT_VERSION,
    proposalId: required(input.proposalId, 'proposalId'),
    proposalKind: input.proposalKind,
    sourceArtifactRefs,
    sourceRevisionSet: uniqueStrings(input.sourceRevisionSet ?? []),
    worldRevision: finite(input.worldRevision ?? 0, 'worldRevision'),
    sceneRevision: finite(input.sceneRevision ?? 0, 'sceneRevision'),
    characterStateRevision: finite(input.characterStateRevision ?? 0, 'characterStateRevision'),
    payload: structuredClone(input.payload ?? {}),
    provenance: structuredClone(input.provenance ?? {}),
    confidence: unit(input.confidence ?? 1, 'confidence'),
    createdAt: finite(input.createdAt ?? 0, 'createdAt'),
    authority: input.authority ?? 'UNRESOLVED',
    settlementAuthority: false,
    memoryMutation: false,
    deleteSourceTurns: false,
    destination: 'MEMORY_SETTLEMENT_REVIEW',
  });
}

export function validateConsolidationProviderOutput(value, context = {}) {
  const object = typeof value === 'string' ? parseStrictObject(value) : value;
  if (!object || typeof object !== 'object' || Array.isArray(object)) fail(FailureCode.SCHEMA_INVALID, 'Consolidation output must be an object');
  if (object.kind != null && object.kind !== 'ConsolidationProposal') fail(FailureCode.SCHEMA_INVALID, 'Consolidation output kind invalid');
  if (object.authority != null && !['UNRESOLVED', 'INFERRED'].includes(object.authority)) fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation output authority escalation');
  if (object.settlementAuthority || object.memoryMutation || object.deleteSourceTurns) fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation output attempted owner mutation');
  const proposal = createConsolidationProposal({ ...object, sourceRevisionSet: object.sourceRevisionSet ?? context.sourceRevisionSet, worldRevision: object.worldRevision ?? context.worldRevision, sceneRevision: object.sceneRevision ?? context.sceneRevision, characterStateRevision: object.characterStateRevision ?? context.characterStateRevision });
  if (context.currentRevisionSet && consolidationFreshness(proposal, context.currentRevisionSet) !== 'FRESH') fail(FailureCode.STALE_RESULT, 'Consolidation output revision is stale');
  return proposal;
}

export function createConsolidationTask(unitInput, {
  taskId = null,
  turnId = 'background',
  correlationId = 'background:consolidation',
  softDeadline = 60_000,
  hardDeadline = 300_000,
  maxSliceUnits = 16,
  maxUnitsPerCheckpoint = 16,
} = {}) {
  const unit = unitInput?.kind === 'ConsolidationUnit' ? unitInput : createConsolidationUnit(unitInput);
  const revisions = createRevisionSet({ sourceRevisionSet: unit.sourceRevisionSet, worldRevision: unit.worldRevision, sceneRevision: unit.sceneRevision, characterStateRevision: unit.characterStateRevision });
  return createCognitiveTask({
    taskId: taskId ?? `consolidate:${unit.unitId}`,
    taskType: 'CONSOLIDATION',
    turnId,
    correlationId,
    requiredCapabilities: [Capability.CONSOLIDATION, Capability.COMPRESSION],
    capabilityRequests: [Capability.CONSOLIDATION, Capability.COMPRESSION],
    cognitiveLayer: 'L3',
    resultClass: ResultClass.DEFERRED,
    placement: Placement.DEEP,
    inputRevisionSet: revisions,
    softDeadline,
    hardDeadline,
    compilerLane: 'consolidationProposals',
    intentFingerprint: `consolidation:${unit.unitId}:${unit.resumeIdentity}`,
    batchMetadata: { batchable: true, slicePolicy: 'ADAPTIVE', checkpointBoundary: 'SLICE', yieldSafety: 'CHECKPOINT_ONLY', partialResultSemantics: 'PRESERVE_VALID_SLICES' },
    fallbackPolicy: { type: 'PARK_OR_RECOMPUTE', maxRetries: 0 },
    metadata: {
      resourceClass: 'DEEP_BACKGROUND',
      resourceHints: { borrowIdleCapacity: true, foregroundPreemptible: true },
      resumeIdentity: unit.resumeIdentity,
      checkpoint: unit.checkpoint,
      maxSliceUnits,
      maxUnitsPerCheckpoint,
      batchSlice: { unitId: unit.unitId, artifactRefs: unit.artifactRefs },
      sourceRecoverabilityRequired: true,
      durableMutationAllowed: false,
    },
  });
}

export function consolidationFreshness(value, currentRevisionSet = {}) {
  const source = new Set(currentRevisionSet.sourceRevisionSet ?? []);
  const requiredSources = value.sourceRevisionSet ?? [];
  if (Number(value.worldRevision) !== Number(currentRevisionSet.worldRevision ?? value.worldRevision)) return 'STALE';
  if (Number(value.sceneRevision) !== Number(currentRevisionSet.sceneRevision ?? value.sceneRevision)) return 'STALE';
  if (Number(value.characterStateRevision) !== Number(currentRevisionSet.characterStateRevision ?? value.characterStateRevision)) return 'STALE';
  if (requiredSources.some((id) => !source.has(id))) return 'STALE';
  return 'FRESH';
}

export class ConsolidationBacklog {
  #units = new Map();
  #metrics = { enqueued: 0, checkpointed: 0, superseded: 0, staleDiscarded: 0, completed: 0, evicted: 0 };

  constructor({ capacity = 512 } = {}) { this.capacity = positiveInteger(capacity, 'capacity'); }

  enqueue(unitInput) {
    const unit = unitInput?.kind === 'ConsolidationUnit' ? unitInput : createConsolidationUnit(unitInput);
    this.#units.set(unit.unitId, unit);
    this.#metrics.enqueued += 1;
    while (this.#units.size > this.capacity) {
      const candidate = this.list().filter((x) => [ConsolidationUnitStatus.STALE, ConsolidationUnitStatus.SUPERSEDED, ConsolidationUnitStatus.COMPLETE].includes(x.status))[0] ?? this.list().at(-1);
      this.#units.delete(candidate.unitId);
      this.#metrics.evicted += 1;
    }
    return unit;
  }

  checkpoint(unitId, checkpoint) { return this.#update(unitId, { checkpoint: structuredClone(checkpoint), status: ConsolidationUnitStatus.CHECKPOINTED }, 'checkpointed'); }
  supersede(unitId, supersededBy = null) { return this.#update(unitId, { status: ConsolidationUnitStatus.SUPERSEDED, supersededBy }, 'superseded'); }
  complete(unitId) { return this.#update(unitId, { status: ConsolidationUnitStatus.COMPLETE }, 'completed'); }

  discardStale(currentRevisionSet) {
    let count = 0;
    for (const [id, unit] of [...this.#units]) {
      if (consolidationFreshness(unit, currentRevisionSet) === 'STALE' && ![ConsolidationUnitStatus.COMPLETE, ConsolidationUnitStatus.SUPERSEDED].includes(unit.status)) {
        this.#units.set(id, deepFreeze({ ...unit, status: ConsolidationUnitStatus.STALE }));
        this.#metrics.staleDiscarded += 1;
        count += 1;
      }
    }
    return count;
  }

  pending({ now = 0 } = {}) {
    return this.list().filter((unit) => [ConsolidationUnitStatus.PENDING, ConsolidationUnitStatus.CHECKPOINTED].includes(unit.status)).map((unit) => deepFreeze({ ...unit, age: Math.max(0, Number(now) - unit.createdAt) }));
  }
  list() { return [...this.#units.values()].sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt).map((unit) => structuredClone(unit)); }
  metrics({ now = 0 } = {}) { const pending = this.pending({ now }); return deepFreeze({ ...this.#metrics, pendingUnits: pending.length, oldestPendingAge: pending.length ? Math.max(...pending.map((u) => u.age)) : 0, capacity: this.capacity }); }

  #update(unitId, patch, metric) {
    const current = this.#units.get(unitId);
    if (!current) throw new Error(`Unknown consolidation unit: ${unitId}`);
    const next = deepFreeze({ ...current, ...patch });
    this.#units.set(unitId, next);
    this.#metrics[metric] += 1;
    return structuredClone(next);
  }
}

export function sourceFactRetention({ sourceFacts = [], proposalFacts = [] } = {}) {
  const source = new Set(sourceFacts.map(stableFact));
  const proposal = new Set(proposalFacts.map(stableFact));
  const retained = [...source].filter((fact) => proposal.has(fact));
  return deepFreeze({ total: source.size, retained: retained.length, lost: source.size - retained.length, ratio: source.size ? retained.length / source.size : 1, pass: retained.length === source.size });
}

function normalizeArtifactRefs(values) {
  if (!Array.isArray(values)) throw new TypeError('Artifact References must be an array');
  return values.map((ref) => {
    if (!ref || typeof ref !== 'object' || !['ArtifactReference', 'ArtifactRef'].includes(ref.kind)) throw new TypeError('Consolidation inputs must use Artifact References');
    const artifactId = required(ref.artifactId, 'artifactId');
    const artifactType = required(ref.artifactType, 'artifactType');
    const revision = positiveInteger(ref.revision, 'revision');
    return deepFreeze({ kind: ref.kind, artifactId, artifactType, revision, storageDomain: ref.storageDomain ?? ref.repositoryDomain ?? 'artifacts', sliceSelector: ref.sliceSelector ?? ref.sliceIdentity ?? null, contentHash: ref.contentHash ?? ref.digest ?? null });
  });
}
function parseStrictObject(text) { if (typeof text !== 'string') fail(FailureCode.MALFORMED_OUTPUT, 'Consolidation output must be JSON text'); const trimmed = text.trim(); if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) fail(FailureCode.MALFORMED_OUTPUT, 'Consolidation output must contain one JSON object'); try { return JSON.parse(trimmed); } catch (error) { fail(FailureCode.MALFORMED_OUTPUT, `Consolidation JSON parse failed: ${error.message}`); } }
function stableFact(value) { return typeof value === 'string' ? value.trim() : JSON.stringify(value); }
function uniqueStrings(values) { if (!Array.isArray(values)) throw new TypeError('expected array'); return [...new Set(values.map((value) => required(value, 'revision')))].sort(); }
function required(value, name) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`); return value.trim(); }
function finite(value, name) { const number = Number(value); if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`); return number; }
function positiveInteger(value, name) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new TypeError(`${name} must be a positive integer`); return number; }
function unit(value, name) { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 1) fail(FailureCode.SCHEMA_INVALID, `${name} must be within 0..1`); return number; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
