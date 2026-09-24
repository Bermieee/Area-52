import { FailureCode } from './constants.js';

export const GREEN_ROOM_CONTRACT_VERSION = '1.0.0';
export const GreenRoomDimension = Object.freeze({
  GUARDEDNESS: 'guardedness',
  WARMTH: 'warmth',
  ANGER: 'anger',
  TRUST_TREND: 'trustTrend',
  ANXIETY: 'anxiety',
  LATENT_INTENT: 'latentIntent',
  ATTENTION_TARGET: 'attentionTarget',
  SOCIAL_PRESSURE: 'socialPressure',
  UNCERTAINTY: 'uncertainty',
});

const DIMENSIONS = new Set(Object.values(GreenRoomDimension));
const TRUST = new Set(['DOWN', 'STABLE', 'UP', 'UNKNOWN']);

export function createGreenRoomInference(input = {}, limits = {}) {
  if (input.authority != null && input.authority !== 'INFERRED') fail(FailureCode.AUTHORITY_VIOLATION, 'Green Room authority must remain INFERRED');
  if (input.canonical === true || input.settlementAuthority === true || input.memoryMutation === true) fail(FailureCode.AUTHORITY_VIOLATION, 'Green Room cannot claim canonical, Settlement, or Memory authority');
  const maxDimensions = positiveInteger(limits.maxDimensions ?? 9, 'maxDimensions');
  const maxEvidenceRefs = positiveInteger(limits.maxEvidenceRefs ?? 16, 'maxEvidenceRefs');
  const dimensions = normalizeDimensions(input.dimensions ?? inferLegacyDimensions(input), maxDimensions);
  const evidenceRefs = boundedStrings(input.evidenceRefs ?? [], maxEvidenceRefs, 'evidenceRefs');
  return deepFreeze({
    kind: 'GreenRoomInference',
    contractVersion: GREEN_ROOM_CONTRACT_VERSION,
    characterRef: required(input.characterRef ?? input.characterId, 'characterRef'),
    sceneRevision: nonNegativeInteger(input.sceneRevision, 'sceneRevision'),
    evidenceRefs,
    confidence: unit(input.confidence, 'confidence'),
    dimensions,
    createdAt: finite(input.createdAt ?? 0, 'createdAt'),
    expiryCondition: normalizeExpiry(input.expiryCondition ?? input.expiry ?? {}),
    sourceRevisionSet: boundedStrings(input.sourceRevisionSet ?? [], 32, 'sourceRevisionSet'),
    authority: 'INFERRED',
    canonical: false,
    settlementAuthority: false,
    memoryMutation: false,
  });
}

export function createGreenRoomBatch({ sceneRevision, characters = [], createdAt = 0, sourceRevisionSet = [] } = {}, limits = {}) {
  if (!Array.isArray(characters)) throw new TypeError('characters must be an array');
  const maxCharacters = positiveInteger(limits.maxCharacters ?? 16, 'maxCharacters');
  if (characters.length > maxCharacters) throw new RangeError(`Green Room character batch exceeds ${maxCharacters}`);
  const seen = new Set();
  const rows = characters.map((row) => {
    const normalized = createGreenRoomInference({ ...row, sceneRevision: row.sceneRevision ?? sceneRevision, createdAt: row.createdAt ?? createdAt, sourceRevisionSet: row.sourceRevisionSet ?? sourceRevisionSet }, limits);
    if (seen.has(normalized.characterRef)) fail(FailureCode.SCHEMA_INVALID, `Duplicate Green Room character: ${normalized.characterRef}`);
    seen.add(normalized.characterRef);
    return normalized;
  });
  return deepFreeze({ kind: 'GreenRoomBatch', contractVersion: GREEN_ROOM_CONTRACT_VERSION, sceneRevision: nonNegativeInteger(sceneRevision, 'sceneRevision'), characters: rows, authority: 'INFERRED' });
}

export function validateGreenRoomProviderOutput(value, context = {}, limits = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(FailureCode.SCHEMA_INVALID, 'Green Room output must be an object');
  const allowed = new Set(['kind', 'contractVersion', 'sceneRevision', 'characters', 'authority', 'canonical', 'settlementAuthority', 'memoryMutation']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(FailureCode.SCHEMA_INVALID, `Green Room output has unsupported field: ${key}`);
  if (!Array.isArray(value.characters)) fail(FailureCode.SCHEMA_INVALID, 'Green Room output characters must be an array');
  if (value.authority != null && value.authority !== 'INFERRED') fail(FailureCode.AUTHORITY_VIOLATION, 'Green Room provider attempted authority escalation');
  if (value.canonical || value.settlementAuthority || value.memoryMutation) fail(FailureCode.AUTHORITY_VIOLATION, 'Green Room provider attempted durable-state mutation');
  const sceneRevision = nonNegativeInteger(value.sceneRevision ?? context.sceneRevision, 'sceneRevision');
  if (context.sceneRevision != null && sceneRevision !== Number(context.sceneRevision)) fail(FailureCode.STALE_RESULT, 'Green Room output Scene revision expired');
  const knownEvidence = context.knownEvidenceRefs == null ? null : new Set(context.knownEvidenceRefs);
  const batch = createGreenRoomBatch({ ...value, sceneRevision }, limits);
  if (knownEvidence) {
    for (const row of batch.characters) for (const ref of row.evidenceRefs) if (!knownEvidence.has(ref)) fail(FailureCode.UNKNOWN_REFERENCE, `Unknown Green Room evidence ref: ${ref}`);
  }
  return batch;
}

export class GreenRoomStore {
  #states = new Map();
  #history = [];
  #seq = 0;
  #metrics = { puts: 0, expiries: 0, evictions: 0, contradictions: 0, sourceInvalidations: 0 };

  constructor({ maxCharacters = 16, maxDimensions = 9, maxEvidenceRefs = 16, maxHistory = 48, defaultTtlTurns = 2, onExpire = null } = {}) {
    this.maxCharacters = positiveInteger(maxCharacters, 'maxCharacters');
    this.maxDimensions = positiveInteger(maxDimensions, 'maxDimensions');
    this.maxEvidenceRefs = positiveInteger(maxEvidenceRefs, 'maxEvidenceRefs');
    this.maxHistory = nonNegativeInteger(maxHistory, 'maxHistory');
    this.defaultTtlTurns = nonNegativeInteger(defaultTtlTurns, 'defaultTtlTurns');
    this.onExpire = onExpire;
  }

  putBatch(batchInput, { turnSequence = 0, activeCharacterRefs = null } = {}) {
    const batch = batchInput?.kind === 'GreenRoomBatch' ? batchInput : createGreenRoomBatch(batchInput, this.#limits());
    const active = activeCharacterRefs == null ? null : new Set(activeCharacterRefs);
    let accepted = 0;
    for (const row of batch.characters) {
      if (active && !active.has(row.characterRef)) continue;
      const stored = deepFreeze({ ...row, storedTurn: Number(turnSequence), sequence: ++this.#seq, expiresAfterTurns: row.expiryCondition.ttlTurns ?? this.defaultTtlTurns });
      this.#states.set(row.characterRef, stored);
      this.#history.push(stored);
      accepted += 1;
      this.#metrics.puts += 1;
    }
    while (this.#states.size > this.maxCharacters) {
      const oldest = [...this.#states.values()].sort((a, b) => a.sequence - b.sequence)[0];
      this.#states.delete(oldest.characterRef);
      this.#metrics.evictions += 1;
    }
    if (this.#history.length > this.maxHistory) this.#history.splice(0, this.#history.length - this.maxHistory);
    return accepted;
  }

  get(characterRef, context = {}) {
    const value = this.#states.get(characterRef);
    if (!value) return null;
    const reason = expiryReason(value, context);
    if (reason) { this.#expire(characterRef, reason); return null; }
    return structuredClone(value);
  }

  invalidate(input = {}) {
    let count = 0;
    const sourceSet = new Set(input.invalidatedSourceRevisionIds ?? []);
    for (const [characterRef, value] of [...this.#states]) {
      let reason = null;
      if (input.sceneClosed && value.expiryCondition.onSceneClose) reason = 'SCENE_CLOSED';
      else if (input.sceneReplaced && value.expiryCondition.onSceneReplacement) reason = 'SCENE_REPLACED';
      else if (input.majorTimeShift && value.expiryCondition.onMajorTimeShift) reason = 'MAJOR_TIME_SHIFT';
      else if ((input.departedCharacterRefs ?? []).includes(characterRef) && value.expiryCondition.onCharacterDeparture) reason = 'CHARACTER_DEPARTED';
      else if ((input.contradictoryCharacterRefs ?? []).includes(characterRef) && value.expiryCondition.onContradiction) { reason = 'CONTRADICTORY_EVIDENCE'; this.#metrics.contradictions += 1; }
      else if (value.expiryCondition.onSourceRevisionInvalidation && value.sourceRevisionSet.some((id) => sourceSet.has(id))) { reason = 'SOURCE_REVISION_INVALIDATED'; this.#metrics.sourceInvalidations += 1; }
      if (reason) { this.#expire(characterRef, reason); count += 1; }
    }
    return count;
  }

  createReflectionCandidate(characterRef, { minCompatibleObservations = 3 } = {}) {
    const rows = this.#history.filter((row) => row.characterRef === characterRef);
    if (rows.length < minCompatibleObservations) return null;
    const refs = [...new Set(rows.flatMap((row) => row.evidenceRefs))];
    return deepFreeze({
      kind: 'ReflectionCandidate',
      characterRef,
      evidenceRefs: refs,
      observationCount: rows.length,
      authority: 'INFERRED',
      durableMutation: false,
      destination: 'SETTLEMENT_REVIEW',
    });
  }

  size() { return this.#states.size; }
  historySize() { return this.#history.length; }
  metrics() { return deepFreeze({ ...this.#metrics, active: this.#states.size, history: this.#history.length }); }

  #expire(characterRef, reason) {
    const value = this.#states.get(characterRef);
    if (!value) return;
    this.#states.delete(characterRef);
    this.#metrics.expiries += 1;
    try { this.onExpire?.({ characterRef, sceneRevision: value.sceneRevision, reason }); } catch {}
  }
  #limits() { return { maxCharacters: this.maxCharacters, maxDimensions: this.maxDimensions, maxEvidenceRefs: this.maxEvidenceRefs }; }
}

export function selectActiveGreenRoomBatch(activeCast = [], { maxCharacters = 16 } = {}) {
  if (!Array.isArray(activeCast)) throw new TypeError('activeCast must be an array');
  return activeCast
    .filter((item) => item && (item.presence == null || ['PRESENT', 'UNCERTAIN'].includes(item.presence)))
    .slice(0, positiveInteger(maxCharacters, 'maxCharacters'))
    .map((item) => typeof item === 'string' ? item : item.characterRef ?? item.characterId ?? item.ref)
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function inferLegacyDimensions(input) {
  const out = {};
  for (const key of DIMENSIONS) if (key in input) out[key] = input[key];
  return out;
}
function normalizeDimensions(input, maxDimensions) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(FailureCode.SCHEMA_INVALID, 'Green Room dimensions must be an object');
  const entries = Object.entries(input);
  if (entries.length > maxDimensions) throw new RangeError(`Green Room dimensions exceed ${maxDimensions}`);
  const out = {};
  for (const [key, value] of entries) {
    if (!DIMENSIONS.has(key)) fail(FailureCode.SCHEMA_INVALID, `Unknown Green Room dimension: ${key}`);
    if (['guardedness', 'warmth', 'anger', 'anxiety', 'socialPressure', 'uncertainty'].includes(key)) out[key] = value == null ? null : unit(value, key);
    else if (key === 'trustTrend') { if (!TRUST.has(value)) fail(FailureCode.SCHEMA_INVALID, `Unknown trustTrend: ${value}`); out[key] = value; }
    else out[key] = value == null ? null : boundedText(value, 300, key);
  }
  return deepFreeze(out);
}
function normalizeExpiry(value = {}) {
  return deepFreeze({
    onSceneClose: value.onSceneClose !== false,
    onSceneReplacement: value.onSceneReplacement !== false,
    onMajorTimeShift: value.onMajorTimeShift !== false,
    onCharacterDeparture: value.onCharacterDeparture !== false && value.onCharacterExit !== false,
    onContradiction: value.onContradiction !== false,
    onSourceRevisionInvalidation: value.onSourceRevisionInvalidation !== false,
    ttlTurns: nonNegativeInteger(value.ttlTurns ?? 2, 'expiryCondition.ttlTurns'),
  });
}
function expiryReason(value, context) {
  if (context.sceneRevision != null && Number(context.sceneRevision) !== value.sceneRevision) return 'SCENE_REVISION_CHANGED';
  if (context.sceneClosed && value.expiryCondition.onSceneClose) return 'SCENE_CLOSED';
  if (context.sceneReplaced && value.expiryCondition.onSceneReplacement) return 'SCENE_REPLACED';
  if (context.majorTimeShift && value.expiryCondition.onMajorTimeShift) return 'MAJOR_TIME_SHIFT';
  if (Array.isArray(context.activeCharacterRefs) && value.expiryCondition.onCharacterDeparture && !new Set(context.activeCharacterRefs).has(value.characterRef)) return 'CHARACTER_DEPARTED';
  if (context.turnSequence != null && Number(context.turnSequence) - Number(value.storedTurn) > Number(value.expiresAfterTurns)) return 'TTL_EXPIRED';
  return null;
}
function boundedStrings(values, max, name) { if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`); const out = [...new Set(values.map((value) => required(value, name)))]; if (out.length > max) throw new RangeError(`${name} exceeds ${max}`); return out; }
function required(value, name) { if (typeof value !== 'string' || !value.trim()) fail(FailureCode.SCHEMA_INVALID, `${name} must be a non-empty string`); return value.trim(); }
function finite(value, name) { const number = Number(value); if (!Number.isFinite(number)) fail(FailureCode.SCHEMA_INVALID, `${name} must be finite`); return number; }
function nonNegativeInteger(value, name) { const number = Number(value); if (!Number.isInteger(number) || number < 0) fail(FailureCode.SCHEMA_INVALID, `${name} must be a non-negative integer`); return number; }
function positiveInteger(value, name) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new TypeError(`${name} must be a positive integer`); return number; }
function unit(value, name) { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 1) fail(FailureCode.SCHEMA_INVALID, `${name} must be within 0..1`); return number; }
function boundedText(value, max, name) { if (typeof value !== 'string') fail(FailureCode.SCHEMA_INVALID, `${name} must be a string`); return value.slice(0, max); }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
