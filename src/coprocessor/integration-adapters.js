import { sha256Hex } from '../browser-compat.js';
import { ResultClass, ResultDestination } from './constants.js';

export function toNexusCognitiveResult(result, task, {
  destination = task.resultClass === ResultClass.DEFERRED ? ResultDestination.BACKGROUND : ResultDestination.FOREGROUND,
  sourceSubsystem = 'COGNITIVE_COPROCESSOR',
} = {}) {
  return Object.freeze({
    kind: 'CognitiveResult',
    id: result.resultId,
    taskId: result.taskId,
    turnId: result.turnId,
    correlationId: result.correlationId,
    causationId: task.causationId,
    sourceSubsystem,
    workerId: result.workerId,
    destinationOwner: null,
    resultType: task.taskType,
    resultClass: task.resultClass,
    payloadClass: result.authorityClass === 'INFERRED' ? 'PROPOSAL' : 'DERIVED_DATA',
    evidenceIds: [...new Set(result.payload?.evidence?.map((item) => item.id).filter(Boolean) ?? [])],
    provenance: structuredClone(result.provenance),
    sourceRevisionIds: [...result.freshnessIdentity.sourceRevisionSet],
    worldRevision: result.freshnessIdentity.worldRevision,
    sceneRevision: result.freshnessIdentity.sceneRevision,
    authorityClass: result.authorityClass,
    destination,
    payload: structuredClone(result.payload),
    timing: { startedAt: result.startedAt, completedAt: result.completedAt, latency: result.latency },
    freshness: 'FRESH',
    staleReason: null,
    rejectionReason: null,
  });
}

export class NexusResultBusBoundary {
  constructor({ receive } = {}) {
    if (typeof receive !== 'function') throw new TypeError('NexusResultBusBoundary requires ResultBus.receive binding');
    this.receiveImpl = receive;
  }
  receive(result) { return this.receiveImpl(structuredClone(result)); }
}

export class NexusContextSealBoundary {
  constructor({ seal, isTurnSealed } = {}) {
    if (typeof seal !== 'function' || typeof isTurnSealed !== 'function') throw new TypeError('NexusContextSealBoundary requires seal/isTurnSealed');
    this.sealImpl = seal;
    this.isTurnSealedImpl = isTurnSealed;
  }
  seal(input) { return this.sealImpl(structuredClone(input)); }
  isTurnSealed(turnId) { return Boolean(this.isTurnSealedImpl(turnId)); }
}

export class DeterministicContextSealFixture {
  #sealed = new Map();
  seal({ turnId, correlationId, packet, admittedResultIds = [], rejectedResultIds = [], staleResultIds = [], deadline = null, sourceRevisionIds = [], worldRevision = 0, sceneRevision = 0 }) {
    const frozen = deepFreeze(structuredClone(packet));
    const packetHash = hashPacket(frozen);
    const existing = this.#sealed.get(turnId);
    if (existing) {
      if (existing.receipt.packetHash !== packetHash) throw new Error(`Turn ${turnId} already sealed with different packet content`);
      return { ...existing, duplicate: true };
    }
    const receipt = deepFreeze({
      kind: 'ContextSealReceipt', id: `fixture-seal:${turnId}`, turnId, correlationId,
      packetId: frozen.id, packetHash, sourceRevisionIds: [...sourceRevisionIds].sort(),
      worldRevision, sceneRevision, admittedResultIds: [...admittedResultIds].sort(),
      rejectedResultIds: [...rejectedResultIds].sort(), staleResultIds: [...staleResultIds].sort(),
      fallbackState: 'NONE', deadline, sealedState: true,
    });
    const stored = { packet: frozen, receipt };
    this.#sealed.set(turnId, stored);
    return { packet: frozen, receipt: structuredClone(receipt), duplicate: false };
  }
  isTurnSealed(turnId) { return this.#sealed.has(turnId); }
  getPacket(turnId) { return this.#sealed.get(turnId)?.packet ?? null; }
  getReceipt(turnId) { const r = this.#sealed.get(turnId)?.receipt; return r ? structuredClone(r) : null; }
}

export class RecordingResultBusFixture {
  constructor({ isTurnSealed = () => false } = {}) {
    this.isTurnSealed = isTurnSealed;
    this.results = new Map();
  }
  receive(result) {
    if (this.results.has(result.id)) return { ...this.results.get(result.id), duplicate: true };
    const late = Boolean(result.turnId && this.isTurnSealed(result.turnId));
    const effectiveDestination = late && result.destination === ResultDestination.FOREGROUND
      ? (result.resultClass === ResultClass.DEFERRED ? ResultDestination.BACKGROUND : ResultDestination.NEXT_TURN)
      : result.destination;
    const route = { accepted: true, freshness: result.freshness, late, effectiveDestination };
    const stored = { result: structuredClone(result), route, duplicate: false };
    this.results.set(result.id, stored);
    return structuredClone(stored);
  }
}

export class StructuredCompilerFixture {
  compile(bundle) {
    return {
      id: `fixture-packet:${bundle.turnIdentity.turnId}`,
      kind: 'CompiledCoprocessorPacket',
      turnIdentity: structuredClone(bundle.turnIdentity),
      loreEvidence: structuredClone(bundle.loreEvidence),
      episodicEvidence: structuredClone(bundle.episodicEvidence),
      worldState: structuredClone(bundle.worldState),
      graphResults: structuredClone(bundle.graphResults),
      greenRoom: structuredClone(bundle.greenRoom),
      truthClassifications: structuredClone(bundle.truthClassifications),
      precisionResults: structuredClone(bundle.precisionResults),
      externalGrounding: structuredClone(bundle.externalGrounding),
      unresolvedDisagreement: structuredClone(bundle.unresolvedDisagreement),
      provenanceIndex: structuredClone(bundle.provenanceIndex),
      freshnessIndex: structuredClone(bundle.freshnessIndex),
      dependencies: [...new Set(Object.values(bundle.freshnessIndex).flatMap((x) => x.sourceRevisionSet ?? []))].sort(),
    };
  }
}

export function hashPacket(value) {
  return sha256Hex(stableString(value));
}
function stableString(value) {
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value;
}
