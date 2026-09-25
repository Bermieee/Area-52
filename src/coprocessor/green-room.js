import { Capability, FailureCode, Placement, ResultClass } from './constants.js';
import { createCognitiveTask, createRevisionSet } from './contracts.js';
import { assertProviderPayloadBoundary, buildBoundedProviderPayload } from './provider-payload-boundary.js';

export const GREEN_ROOM_CONTRACT_VERSION = '1.1.0';
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
  if (input.canonical === true || input.settlementAuthority === true || input.memoryMutation === true || input.characterStateMutation === true) {
    fail(FailureCode.AUTHORITY_VIOLATION, 'Green Room cannot claim canonical, Settlement, Character State, or Memory authority');
  }
  const maxDimensions = positiveInteger(limits.maxDimensions ?? 9, 'maxDimensions');
  const maxEvidenceRefs = positiveInteger(limits.maxEvidenceRefs ?? 16, 'maxEvidenceRefs');
  const dimensions = normalizeDimensions(input.dimensions ?? inferLegacyDimensions(input), maxDimensions);
  const directEvidenceRefs = boundedStrings(input.directEvidenceRefs ?? input.evidenceRefs ?? [], maxEvidenceRefs, 'evidenceRefs');
  const priorInferenceRefs = boundedStrings(input.priorInferenceRefs ?? input.derivedInferenceRefs ?? [], maxEvidenceRefs, 'priorInferenceRefs');
  const sourceRevisionSet = boundedStrings(input.sourceRevisionSet ?? [], 32, 'sourceRevisionSet');
  const characterRef = required(input.characterRef ?? input.characterId, 'characterRef');
  const sceneRevision = nonNegativeInteger(input.sceneRevision, 'sceneRevision');
  const createdAt = finite(input.createdAt ?? 0, 'createdAt');
  return deepFreeze({
    kind: 'GreenRoomInference',
    contractVersion: GREEN_ROOM_CONTRACT_VERSION,
    characterRef,
    sceneRevision,
    directEvidenceRefs,
    evidenceRefs: directEvidenceRefs,
    priorInferenceRefs,
    confidence: unit(input.confidence, 'confidence'),
    dimensions,
    createdAt,
    updatedAt: finite(input.updatedAt ?? createdAt, 'updatedAt'),
    expiryCondition: normalizeExpiry(input.expiryCondition ?? input.expiry ?? {}),
    sourceRevisionSet,
    supportIdentity: supportIdentity({ characterRef, sceneRevision, directEvidenceRefs, sourceRevisionSet }),
    authority: 'INFERRED',
    canonical: false,
    settlementAuthority: false,
    memoryMutation: false,
    characterStateMutation: false,
  });
}

export function createGreenRoomBatch({ sceneRevision, characters = [], createdAt = 0, sourceRevisionSet = [] } = {}, limits = {}) {
  if (!Array.isArray(characters)) throw new TypeError('characters must be an array');
  const maxCharacters = positiveInteger(limits.maxCharacters ?? 16, 'maxCharacters');
  if (characters.length > maxCharacters) throw new RangeError('Green Room character batch exceeds ' + maxCharacters);
  const seen = new Set();
  const rows = characters.map((row) => {
    const normalized = createGreenRoomInference({
      ...row,
      sceneRevision: row.sceneRevision ?? sceneRevision,
      createdAt: row.createdAt ?? createdAt,
      sourceRevisionSet: row.sourceRevisionSet ?? sourceRevisionSet,
    }, limits);
    if (seen.has(normalized.characterRef)) fail(FailureCode.SCHEMA_INVALID, 'Duplicate Green Room character: ' + normalized.characterRef);
    seen.add(normalized.characterRef);
    return normalized;
  });
  return deepFreeze({
    kind: 'GreenRoomBatch',
    contractVersion: GREEN_ROOM_CONTRACT_VERSION,
    sceneRevision: nonNegativeInteger(sceneRevision, 'sceneRevision'),
    characters: rows,
    authority: 'INFERRED',
    canonical: false,
    durableMutation: false,
  });
}

export function createGreenRoomTask({
  turnId,
  taskId = null,
  correlationId,
  causationId = null,
  sceneRevision = 0,
  worldRevision = 0,
  characterStateRevision = 0,
  sourceRevisionSet = [],
  activeCast = [],
  evidenceRefs = [],
  relationshipEvidenceRefs = [],
  characterStateRefs = [],
  unresolvedEvidenceRefs = [],
  cognitiveLayer = 'L1',
  resultClass = ResultClass.OPPORTUNISTIC,
  requiredCapabilities = [Capability.SEMANTIC_JUDGMENT, Capability.CHARACTER_INFERENCE],
  optionalCapabilities = [Capability.FAST_CLASSIFICATION],
  softDeadline = 60,
  hardDeadline = 120,
  fallbackPolicy = { type: 'SKIP_GREEN_ROOM', maxRetries: 0 },
  intentFingerprint = null,
  maxCharacters = 16,
} = {}) {
  const activeCharacterRefs = selectActiveGreenRoomBatch(activeCast, { maxCharacters });
  if (!activeCharacterRefs.length) throw new TypeError('Green Room task requires at least one PRESENT or UNCERTAIN active character');
  const revisions = createRevisionSet({ sourceRevisionSet, worldRevision, sceneRevision, characterStateRevision });
  return createCognitiveTask({
    taskId: taskId ?? 'green-room:' + turnId + ':' + sceneRevision,
    taskType: 'GREEN_ROOM',
    turnId,
    correlationId,
    causationId,
    requiredCapabilities,
    optionalCapabilities,
    cognitiveLayer,
    resultClass,
    inputRevisionSet: revisions,
    softDeadline,
    hardDeadline,
    fallbackPolicy,
    placement: Placement.HOT,
    contextSealPolicy: 'BEFORE_SEAL_ONLY',
    compilerLane: 'greenRoom',
    intentFingerprint: intentFingerprint ?? 'green-room:' + turnId + ':' + sceneRevision,
    batchMetadata: {
      batchable: true,
      slicePolicy: 'ACTIVE_CAST',
      checkpointBoundary: 'TASK',
      yieldSafety: 'NOT_APPLICABLE',
      partialResultSemantics: 'PRESERVE_VALID_CHARACTERS',
    },
    metadata: {
      activeCharacterRefs,
      evidenceRefs: boundedStrings(evidenceRefs, 64, 'evidenceRefs'),
      relationshipEvidenceRefs: boundedStrings(relationshipEvidenceRefs, 32, 'relationshipEvidenceRefs'),
      characterStateRefs: boundedStrings(characterStateRefs, 32, 'characterStateRefs'),
      unresolvedEvidenceRefs: boundedStrings(unresolvedEvidenceRefs, 32, 'unresolvedEvidenceRefs'),
      provenanceRequired: true,
      durableMutationAllowed: false,
      expectedOutputTokens: 800,
    },
  });
}

export function createGreenRoomProviderInput(task, input = {}, limits = {}) {
  const maxCharacters = positiveInteger(limits.maxCharacters ?? 16, 'maxCharacters');
  const maxEvidenceRefs = positiveInteger(limits.maxEvidenceRefs ?? 16, 'maxEvidenceRefs');
  const candidates = input.characters ?? input.activeCast ?? (task.metadata?.activeCharacterRefs ?? []).map((characterRef) => ({ characterRef, presence: 'PRESENT' }));
  if (!Array.isArray(candidates)) fail(FailureCode.SCHEMA_INVALID, 'Green Room active cast must be an array');
  const selected = [];
  const seen = new Set();
  for (const value of candidates) {
    const item = typeof value === 'string' ? { characterRef: value, presence: 'PRESENT' } : value;
    if (!item || (item.presence != null && !['PRESENT', 'UNCERTAIN'].includes(item.presence))) continue;
    const characterRef = required(item.characterRef ?? item.characterId ?? item.ref, 'characterRef');
    if (seen.has(characterRef)) fail(FailureCode.SCHEMA_INVALID, 'Duplicate Green Room character: ' + characterRef);
    seen.add(characterRef);
    const direct = boundedStrings([
      ...(item.evidenceRefs ?? []),
      ...(item.sceneEvidenceRefs ?? []),
      ...(item.relationshipEvidenceRefs ?? []),
      ...(item.characterStateRefs ?? []),
      ...(item.unresolvedEvidenceRefs ?? []),
    ], maxEvidenceRefs, 'evidenceRefs');
    selected.push({
      characterRef,
      characterId: characterRef,
      presence: item.presence ?? 'PRESENT',
      evidenceRefs: direct,
      relationshipEvidenceRefs: boundedStrings(item.relationshipEvidenceRefs ?? [], maxEvidenceRefs, 'relationshipEvidenceRefs'),
      characterStateRefs: boundedStrings(item.characterStateRefs ?? [], maxEvidenceRefs, 'characterStateRefs'),
      unresolvedEvidenceRefs: boundedStrings(item.unresolvedEvidenceRefs ?? [], maxEvidenceRefs, 'unresolvedEvidenceRefs'),
      priorInferenceRefs: boundedStrings(item.priorInferenceRefs ?? [], maxEvidenceRefs, 'priorInferenceRefs'),
    });
    if (selected.length > maxCharacters) throw new RangeError('Green Room character batch exceeds ' + maxCharacters);
  }
  if (!selected.length) fail(FailureCode.SCHEMA_INVALID, 'Green Room provider input has no active characters');
  const allowedRefs = [...new Set(selected.flatMap((row) => row.evidenceRefs))];
  const selectedContext = (input.evidenceSlices ?? []).filter((slice) => {
    const ref = slice?.ref ?? slice?.id;
    return typeof ref === 'string' && allowedRefs.includes(ref);
  });
  const payload = buildBoundedProviderPayload({
    taskSlice: {
      taskId: task.taskId,
      turnId: task.turnId,
      sceneRevision: task.sceneRevision,
      worldRevision: task.worldRevision,
      characterStateRevision: task.characterStateRevision,
      sourceRevisionSet: task.sourceRevisionSet,
      characters: selected,
      expiry: input.expiry ?? { ttlTurns: 2, onSceneClose: true, onCharacterDeparture: true },
    },
    sourceReferences: allowedRefs,
    selectedContext,
    diagnosticMetadata: { cognitiveLayer: task.cognitiveLayer, resultClass: task.resultClass, placement: task.placement },
  });
  assertProviderPayloadBoundary(payload);
  return payload;
}

export function validateGreenRoomProviderOutput(value, context = {}, limits = {}) {
  const object = typeof value === 'string' ? parseStrictObject(value) : value;
  if (!object || typeof object !== 'object' || Array.isArray(object)) fail(FailureCode.SCHEMA_INVALID, 'Green Room output must be an object');
  const allowed = new Set(['kind', 'contractVersion', 'sceneRevision', 'characters', 'authority', 'canonical', 'settlementAuthority', 'memoryMutation', 'characterStateMutation', 'durableMutation']);
  for (const key of Object.keys(object)) if (!allowed.has(key)) fail(FailureCode.SCHEMA_INVALID, 'Green Room output has unsupported field: ' + key);
  if (!Array.isArray(object.characters)) fail(FailureCode.SCHEMA_INVALID, 'Green Room output characters must be an array');
  if (object.authority != null && object.authority !== 'INFERRED') fail(FailureCode.AUTHORITY_VIOLATION, 'Green Room provider attempted authority escalation');
  if (object.canonical || object.settlementAuthority || object.memoryMutation || object.characterStateMutation || object.durableMutation) {
    fail(FailureCode.AUTHORITY_VIOLATION, 'Green Room provider attempted durable-state mutation');
  }
  const sceneRevision = nonNegativeInteger(object.sceneRevision ?? context.sceneRevision, 'sceneRevision');
  if (context.sceneRevision != null && sceneRevision !== Number(context.sceneRevision)) fail(FailureCode.STALE_RESULT, 'Green Room output Scene revision expired');
  const knownEvidence = context.knownEvidenceRefs == null ? null : new Set(context.knownEvidenceRefs);
  const knownByCharacter = normalizeKnownEvidenceByCharacter(context.knownEvidenceRefsByCharacter);
  const knownCharacters = context.knownCharacterRefs == null ? null : new Set(context.knownCharacterRefs);
  const batch = createGreenRoomBatch({ ...object, sceneRevision }, limits);
  for (const row of batch.characters) {
    if (knownCharacters && !knownCharacters.has(row.characterRef)) fail(FailureCode.UNKNOWN_REFERENCE, 'Unknown Green Room character: ' + row.characterRef);
    if (knownEvidence) for (const ref of row.directEvidenceRefs) if (!knownEvidence.has(ref)) fail(FailureCode.UNKNOWN_REFERENCE, 'Unknown Green Room evidence ref: ' + ref);
    const perspectiveEvidence=knownByCharacter?.get(row.characterRef)??null;
    if (perspectiveEvidence) for (const ref of row.directEvidenceRefs) if (!perspectiveEvidence.has(ref)) fail(FailureCode.AUTHORITY_VIOLATION, 'Green Room evidence is not available to character perspective: ' + row.characterRef + ' -> ' + ref);
    if (knownEvidence) for (const ref of row.priorInferenceRefs) if (!knownEvidence.has(ref) && !String(ref).startsWith('green-room:')) fail(FailureCode.UNKNOWN_REFERENCE, 'Unknown Green Room prior-inference ref: ' + ref);
  }
  return batch;
}


function normalizeKnownEvidenceByCharacter(value) {
  if(value==null)return null;
  const entries=value instanceof Map?[...value.entries()]:Object.entries(value);
  const out=new Map();
  for(const [characterRef,refs] of entries){
    if(!Array.isArray(refs))throw new TypeError('knownEvidenceRefsByCharacter values must be arrays');
    out.set(String(characterRef),new Set(refs.map(String)));
  }
  return out;
}

export class GreenRoomStore {
  #states = new Map();
  #history = [];
  #seq = 0;
  #metrics = { puts: 0, expiries: 0, evictions: 0, contradictions: 0, sourceInvalidations: 0, chatSwitches: 0, sceneCorrections: 0 };

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
      const previous = this.#states.get(row.characterRef);
      const directEvidenceChanged = !previous || previous.supportIdentity !== row.supportIdentity;
      const stored = deepFreeze({
        ...row,
        storedTurn: Number(turnSequence),
        sequence: ++this.#seq,
        expiresAfterTurns: row.expiryCondition.ttlTurns ?? this.defaultTtlTurns,
        priorSupportIdentity: previous?.supportIdentity ?? null,
        directEvidenceChanged,
      });
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

  active(context = {}) {
    const rows = [];
    for (const characterRef of [...this.#states.keys()]) {
      const value = this.get(characterRef, context);
      if (value) rows.push(value);
    }
    return rows.sort((a, b) => a.characterRef.localeCompare(b.characterRef));
  }

  invalidate(input = {}) {
    let count = 0;
    const sourceSet = new Set(input.invalidatedSourceRevisionIds ?? []);
    for (const [characterRef, value] of [...this.#states]) {
      let reason = null;
      if (input.chatSwitch) { reason = 'CHAT_SWITCH'; this.#metrics.chatSwitches += 1; }
      else if (input.sceneCorrection) { reason = 'SCENE_CORRECTION'; this.#metrics.sceneCorrections += 1; }
      else if (input.sceneClosed && value.expiryCondition.onSceneClose) reason = 'SCENE_CLOSED';
      else if (input.sceneReplaced && value.expiryCondition.onSceneReplacement) reason = 'SCENE_REPLACED';
      else if (input.majorTimeShift && value.expiryCondition.onMajorTimeShift) reason = 'MAJOR_TIME_SHIFT';
      else if ((input.departedCharacterRefs ?? []).includes(characterRef) && value.expiryCondition.onCharacterDeparture) reason = 'CHARACTER_DEPARTED';
      else if ((input.contradictoryCharacterRefs ?? []).includes(characterRef) && value.expiryCondition.onContradiction) { reason = 'CONTRADICTORY_EVIDENCE'; this.#metrics.contradictions += 1; }
      else if (value.expiryCondition.onSourceRevisionInvalidation && value.sourceRevisionSet.some((id) => sourceSet.has(id))) { reason = 'SOURCE_REVISION_INVALIDATED'; this.#metrics.sourceInvalidations += 1; }
      if (reason) { this.#expire(characterRef, reason); count += 1; }
    }
    return count;
  }

  createReflectionCandidate(characterRef, { minCompatibleObservations = 3, contradictingEvidenceRefs = [] } = {}) {
    const rows = this.#history.filter((row) => row.characterRef === characterRef && row.directEvidenceRefs.length);
    const bySupport = new Map();
    for (const row of rows) if (!bySupport.has(row.supportIdentity)) bySupport.set(row.supportIdentity, row);
    const independent = [...bySupport.values()];
    if (independent.length < minCompatibleObservations) return null;
    const evidenceRefs = [...new Set(independent.flatMap((row) => row.directEvidenceRefs))];
    return deepFreeze({
      kind: 'ReflectionCandidate',
      characterRef,
      supportingEvidenceRefs: evidenceRefs,
      evidenceRefs,
      sourceRevisionSet: [...new Set(independent.flatMap((row) => row.sourceRevisionSet))].sort(),
      observationCount: independent.length,
      compatibleEvidence: independent.map((row) => ({ supportIdentity: row.supportIdentity, sceneRevision: row.sceneRevision, evidenceRefs: row.directEvidenceRefs })),
      contradictingEvidence: boundedStrings(contradictingEvidenceRefs, 32, 'contradictingEvidenceRefs'),
      worldRevision: null,
      sceneRevision: independent.at(-1)?.sceneRevision ?? null,
      authority: 'INFERRED',
      durableMutation: false,
      destination: 'MEMORY_SETTLEMENT_REVIEW',
    });
  }

  exportState() {
    return structuredClone({ states: [...this.#states], history: this.#history, seq: this.#seq, metrics: this.#metrics });
  }

  importState(state = {}) {
    this.#states = new Map(state.states ?? []);
    this.#history = structuredClone(state.history ?? []).slice(-this.maxHistory);
    this.#seq = Number(state.seq ?? 0);
    this.#metrics = { ...this.#metrics, ...(state.metrics ?? {}) };
    return this;
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
  const refs = [];
  const seen = new Set();
  for (const item of activeCast) {
    if (!item) continue;
    const object = typeof item === 'string' ? { characterRef: item, presence: 'PRESENT' } : item;
    if (object.presence != null && !['PRESENT', 'UNCERTAIN'].includes(object.presence)) continue;
    const ref = object.characterRef ?? object.characterId ?? object.ref;
    if (typeof ref !== 'string' || !ref.length) continue;
    if (seen.has(ref)) fail(FailureCode.SCHEMA_INVALID, 'Duplicate Green Room character: ' + ref);
    seen.add(ref);
    refs.push(ref);
    if (refs.length > positiveInteger(maxCharacters, 'maxCharacters')) throw new RangeError('Green Room active cast exceeds ' + maxCharacters);
  }
  return refs;
}

export function projectGreenRoomForGeneration(source, context = {}) {
  const rows = source instanceof GreenRoomStore ? source.active(context) : source?.characters ?? [];
  return deepFreeze({
    lane: 'greenRoom',
    authority: 'INFERRED',
    canonical: false,
    sceneRevision: context.sceneRevision ?? source?.sceneRevision ?? null,
    freshness: 'FRESH',
    characters: rows.map((row) => ({
      characterRef: row.characterRef,
      characterId: row.characterRef,
      dimensions: structuredClone(row.dimensions),
      ...structuredClone(row.dimensions),
      confidence: row.confidence,
      uncertainty: row.dimensions?.uncertainty ?? null,
      evidenceRefs: [...row.directEvidenceRefs],
      sourceRevisionSet: [...row.sourceRevisionSet],
      sceneRevision: row.sceneRevision,
      expiry: structuredClone(row.expiryCondition),
      authority: 'INFERRED',
      supportIdentity: row.supportIdentity,
    })),
    durableMutation: false,
  });
}

function inferLegacyDimensions(input) {
  const out = {};
  for (const key of DIMENSIONS) if (key in input) out[key] = input[key];
  return out;
}
function normalizeDimensions(input, maxDimensions) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(FailureCode.SCHEMA_INVALID, 'Green Room dimensions must be an object');
  const entries = Object.entries(input);
  if (entries.length > maxDimensions) throw new RangeError('Green Room dimensions exceed ' + maxDimensions);
  const out = {};
  for (const [key, value] of entries) {
    if (!DIMENSIONS.has(key)) fail(FailureCode.SCHEMA_INVALID, 'Unknown Green Room dimension: ' + key);
    if (['guardedness', 'warmth', 'anger', 'anxiety', 'socialPressure', 'uncertainty'].includes(key)) out[key] = value == null ? null : unit(value, key);
    else if (key === 'trustTrend') { if (!TRUST.has(value)) fail(FailureCode.SCHEMA_INVALID, 'Unknown trustTrend: ' + value); out[key] = value; }
    else out[key] = value == null ? null : boundedText(value, 300, key);
  }
  return deepFreeze(out);
}
function normalizeExpiry(value = {}) {
  return deepFreeze({
    onSceneClose: value.onSceneClose !== false && value.onSceneRevisionChange !== false,
    onSceneReplacement: value.onSceneReplacement !== false && value.onSceneRevisionChange !== false,
    onMajorTimeShift: value.onMajorTimeShift !== false,
    onCharacterDeparture: value.onCharacterDeparture !== false && value.onCharacterExit !== false,
    onContradiction: value.onContradiction !== false,
    onSourceRevisionInvalidation: value.onSourceRevisionInvalidation !== false,
    ttlTurns: nonNegativeInteger(value.ttlTurns ?? 2, 'expiryCondition.ttlTurns'),
  });
}
function expiryReason(value, context) {
  if (context.chatSwitch) return 'CHAT_SWITCH';
  if (context.sceneCorrection) return 'SCENE_CORRECTION';
  if (context.sceneRevision != null && Number(context.sceneRevision) !== value.sceneRevision) return 'SCENE_REVISION_CHANGED';
  if (context.sceneClosed && value.expiryCondition.onSceneClose) return 'SCENE_CLOSED';
  if (context.sceneReplaced && value.expiryCondition.onSceneReplacement) return 'SCENE_REPLACED';
  if (context.majorTimeShift && value.expiryCondition.onMajorTimeShift) return 'MAJOR_TIME_SHIFT';
  if (Array.isArray(context.activeCharacterRefs) && value.expiryCondition.onCharacterDeparture && !new Set(context.activeCharacterRefs).has(value.characterRef)) return 'CHARACTER_DEPARTED';
  if (context.turnSequence != null && Number(context.turnSequence) - Number(value.storedTurn) > Number(value.expiresAfterTurns)) return 'TTL_EXPIRED';
  return null;
}
function supportIdentity({ characterRef, sceneRevision, directEvidenceRefs, sourceRevisionSet }) {
  return ['green-room', characterRef, sceneRevision, [...directEvidenceRefs].sort().join(','), [...sourceRevisionSet].sort().join(',')].join(':');
}
function parseStrictObject(text) {
  if (typeof text !== 'string') fail(FailureCode.MALFORMED_OUTPUT, 'Green Room output must be JSON text');
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) fail(FailureCode.MALFORMED_OUTPUT, 'Green Room output must contain one JSON object');
  try { return JSON.parse(trimmed); } catch (error) { fail(FailureCode.MALFORMED_OUTPUT, 'Green Room JSON parse failed: ' + error.message); }
}
function boundedStrings(values, max, name) {
  if (!Array.isArray(values)) throw new TypeError(name + ' must be an array');
  const out = [...new Set(values.map((value) => required(value, name)))];
  if (out.length > max) throw new RangeError(name + ' exceeds ' + max);
  return out;
}
function required(value, name) { if (typeof value !== 'string' || !value.trim()) fail(FailureCode.SCHEMA_INVALID, name + ' must be a non-empty string'); return value.trim(); }
function finite(value, name) { const number = Number(value); if (!Number.isFinite(number)) fail(FailureCode.SCHEMA_INVALID, name + ' must be finite'); return number; }
function nonNegativeInteger(value, name) { const number = Number(value); if (!Number.isInteger(number) || number < 0) fail(FailureCode.SCHEMA_INVALID, name + ' must be a non-negative integer'); return number; }
function positiveInteger(value, name) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new TypeError(name + ' must be a positive integer'); return number; }
function unit(value, name) { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 1) fail(FailureCode.SCHEMA_INVALID, name + ' must be within 0..1'); return number; }
function boundedText(value, max, name) { if (typeof value !== 'string') fail(FailureCode.SCHEMA_INVALID, name + ' must be a string'); return value.slice(0, max); }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
