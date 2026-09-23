import {
  COPROCESSOR_SCHEMA_VERSION, FailureCode, Placement, ResultClass, ResultStatus,
} from './constants.js';

const CLASSES = new Set(Object.values(ResultClass));
const STATUSES = new Set(Object.values(ResultStatus));
const PLACEMENTS = new Set(Object.values(Placement));

export function createRevisionSet({
  sourceRevisionSet = [], worldRevision = 0, sceneRevision = 0, characterStateRevision = 0,
} = {}) {
  return deepFreeze({
    sourceRevisionSet: uniqueStrings(sourceRevisionSet, 'sourceRevisionSet').sort(),
    worldRevision: finiteNumber(worldRevision, 'worldRevision'),
    sceneRevision: finiteNumber(sceneRevision, 'sceneRevision'),
    characterStateRevision: finiteNumber(characterStateRevision, 'characterStateRevision'),
  });
}

export function createTurnEnvelope(input = {}) {
  assertSchema(input.schemaVersion ?? COPROCESSOR_SCHEMA_VERSION);
  const turnId = requiredString(input.turnId, 'turnId');
  const correlationId = requiredString(input.correlationId ?? `corr:${turnId}`, 'correlationId');
  return deepFreeze({
    schemaVersion: COPROCESSOR_SCHEMA_VERSION,
    kind: 'TurnCorrelationEnvelope',
    turnId,
    eventId: requiredString(input.eventId ?? `turn-event:${turnId}`, 'eventId'),
    eventType: requiredString(input.eventType ?? 'TURN_EVENT', 'eventType'),
    causationId: optionalString(input.causationId),
    correlationId,
    taskId: optionalString(input.taskId),
    ...createRevisionSet(input),
    createdAt: finiteNumber(input.createdAt ?? 0, 'createdAt'),
    deadline: finiteNumber(input.deadline ?? 0, 'deadline'),
    cognitiveLayer: requiredString(input.cognitiveLayer ?? 'L1', 'cognitiveLayer'),
    requiredCapabilities: uniqueStrings(input.requiredCapabilities ?? [], 'requiredCapabilities'),
    deliveryAttempt: positiveInteger(input.deliveryAttempt ?? 1, 'deliveryAttempt'),
    dedupeKey: requiredString(input.dedupeKey ?? `turn:${turnId}`, 'dedupeKey'),
  });
}

export function toCloudEvent(envelope, { source = 'area52://cognitive-coprocessor', typePrefix = 'area52' } = {}) {
  const e = createTurnEnvelope(envelope);
  return deepFreeze({
    specversion: '1.0',
    id: e.eventId,
    source,
    type: `${typePrefix}.${e.eventType.toLowerCase()}`,
    subject: e.turnId,
    time: e.createdAt,
    datacontenttype: 'application/json',
    data: e,
  });
}

export function createCognitiveTask(input = {}) {
  assertSchema(input.schemaVersion ?? COPROCESSOR_SCHEMA_VERSION);
  const resultClass = input.resultClass ?? ResultClass.REQUIRED;
  if (!CLASSES.has(resultClass)) throw new TypeError(`Unsupported resultClass: ${resultClass}`);
  const placement = input.placement ?? Placement.HOT;
  if (!PLACEMENTS.has(placement)) throw new TypeError(`Unsupported placement: ${placement}`);
  const requiredCapabilities = uniqueStrings(input.requiredCapabilities ?? [], 'requiredCapabilities');
  if (!requiredCapabilities.length) throw new TypeError('requiredCapabilities must contain at least one capability');
  const softDeadline = finiteNumber(input.softDeadline, 'softDeadline');
  const hardDeadline = finiteNumber(input.hardDeadline, 'hardDeadline');
  if (softDeadline > hardDeadline) throw new TypeError('softDeadline must not exceed hardDeadline');
  const taskId = requiredString(input.taskId, 'taskId');
  const turnId = requiredString(input.turnId, 'turnId');
  return deepFreeze({
    schemaVersion: COPROCESSOR_SCHEMA_VERSION,
    kind: 'CognitiveTask',
    taskId,
    taskType: requiredString(input.taskType, 'taskType'),
    turnId,
    correlationId: requiredString(input.correlationId, 'correlationId'),
    causationId: optionalString(input.causationId),
    requiredCapabilities,
    cognitiveLayer: requiredString(input.cognitiveLayer ?? 'L1', 'cognitiveLayer'),
    resultClass,
    inputRevisionSet: createRevisionSet(input.inputRevisionSet ?? input),
    sceneRevision: finiteNumber(input.sceneRevision ?? input.inputRevisionSet?.sceneRevision ?? 0, 'sceneRevision'),
    worldRevision: finiteNumber(input.worldRevision ?? input.inputRevisionSet?.worldRevision ?? 0, 'worldRevision'),
    sourceRevisionSet: uniqueStrings(input.sourceRevisionSet ?? input.inputRevisionSet?.sourceRevisionSet ?? [], 'sourceRevisionSet').sort(),
    characterStateRevision: finiteNumber(input.characterStateRevision ?? input.inputRevisionSet?.characterStateRevision ?? 0, 'characterStateRevision'),
    softDeadline,
    hardDeadline,
    batchMetadata: normalizeBatchMetadata(input.batchMetadata),
    outputSchema: cloneSerializable(input.outputSchema ?? { type: 'object' }, 'outputSchema'),
    dedupeKey: requiredString(input.dedupeKey ?? `task:${taskId}`, 'dedupeKey'),
    fallbackPolicy: cloneSerializable(input.fallbackPolicy ?? { type: 'DETERMINISTIC', maxRetries: 1 }, 'fallbackPolicy'),
    placement,
    contextSealPolicy: requiredString(input.contextSealPolicy ?? 'BEFORE_SEAL_ONLY', 'contextSealPolicy'),
    compilerLane: requiredString(input.compilerLane ?? 'externalGrounding', 'compilerLane'),
    intentFingerprint: requiredString(input.intentFingerprint ?? `intent:${turnId}`, 'intentFingerprint'),
    metadata: cloneSerializable(input.metadata ?? {}, 'metadata'),
  });
}

export function createWorkerResult(input = {}) {
  assertSchema(input.schemaVersion ?? COPROCESSOR_SCHEMA_VERSION);
  const status = input.status ?? ResultStatus.SUCCESS;
  if (!STATUSES.has(status)) throw new TypeError(`Unsupported result status: ${status}`);
  const confidence = finiteNumber(input.confidence ?? 1, 'confidence');
  if (confidence < 0 || confidence > 1) throw new TypeError('confidence must be between 0 and 1');
  const startedAt = finiteNumber(input.startedAt ?? 0, 'startedAt');
  const completedAt = finiteNumber(input.completedAt ?? startedAt, 'completedAt');
  if (completedAt < startedAt) throw new TypeError('completedAt must not precede startedAt');
  return deepFreeze({
    schemaVersion: COPROCESSOR_SCHEMA_VERSION,
    kind: 'CognitiveWorkerResult',
    resultId: requiredString(input.resultId, 'resultId'),
    taskId: requiredString(input.taskId, 'taskId'),
    turnId: requiredString(input.turnId, 'turnId'),
    correlationId: requiredString(input.correlationId, 'correlationId'),
    workerId: requiredString(input.workerId, 'workerId'),
    providerId: requiredString(input.providerId, 'providerId'),
    capabilities: uniqueStrings(input.capabilities ?? [], 'capabilities'),
    status,
    payload: cloneSerializable(input.payload ?? {}, 'payload'),
    provenance: cloneSerializable(input.provenance ?? {}, 'provenance'),
    confidence,
    freshnessIdentity: createRevisionSet(input.freshnessIdentity ?? input.inputRevisionSet ?? {}),
    inputRevisionSet: createRevisionSet(input.inputRevisionSet ?? {}),
    startedAt,
    completedAt,
    latency: finiteNumber(input.latency ?? completedAt - startedAt, 'latency'),
    validationReceipt: cloneSerializable(input.validationReceipt ?? { syntax: 'PASS', deterministic: 'PASS' }, 'validationReceipt'),
    authorityClass: requiredString(input.authorityClass ?? 'UNRESOLVED', 'authorityClass'),
  });
}

export function createWorkerFailure(input = {}) {
  const code = requiredString(input.code ?? FailureCode.PROVIDER_FAILURE, 'failure.code');
  return deepFreeze({
    kind: 'CognitiveWorkerFailure',
    code,
    taskId: requiredString(input.taskId, 'failure.taskId'),
    turnId: requiredString(input.turnId, 'failure.turnId'),
    correlationId: requiredString(input.correlationId, 'failure.correlationId'),
    providerId: optionalString(input.providerId),
    workerId: optionalString(input.workerId),
    message: requiredString(input.message ?? code, 'failure.message'),
    attempt: positiveInteger(input.attempt ?? 1, 'failure.attempt'),
    retryable: Boolean(input.retryable),
    fallbackEligible: input.fallbackEligible !== false,
    details: cloneSerializable(input.details ?? {}, 'failure.details'),
  });
}

export function normalizeBatchMetadata(value = {}) {
  return deepFreeze({
    batchable: Boolean(value?.batchable),
    slicePolicy: value?.slicePolicy ?? (value?.batchable ? 'ADAPTIVE' : 'SINGLE'),
    checkpointBoundary: value?.checkpointBoundary ?? (value?.batchable ? 'SLICE' : 'TASK'),
    yieldSafety: value?.yieldSafety ?? (value?.batchable ? 'CHECKPOINT_ONLY' : 'NOT_APPLICABLE'),
    partialResultSemantics: value?.partialResultSemantics ?? 'NONE',
  });
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function cloneSerializable(value, name = 'value') {
  try {
    const clone = structuredClone(value);
    JSON.stringify(clone);
    return clone;
  } catch {
    throw new TypeError(`${name} must be structured-cloneable and JSON-serializable`);
  }
}

export function assertSchema(version) {
  const major = String(version).split('.')[0];
  if (major !== COPROCESSOR_SCHEMA_VERSION.split('.')[0]) {
    throw new TypeError(`Unsupported coprocessor schema version: ${version}`);
  }
  return version;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}
function optionalString(value) {
  return value == null ? null : requiredString(value, 'optional string');
}
function uniqueStrings(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new TypeError(`${name} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}
function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
  return number;
}
function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`${name} must be a positive integer`);
  return number;
}
