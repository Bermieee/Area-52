import { createTurnEnvelope } from './contracts.js';

export const RUNTIME_TURN_EVENT_CONTRACT_VERSION = '1.0.0';

export function consumeRuntimeTurnEvent(input, { eventHub = null } = {}) {
  const normalized = normalizeRuntimeEvent(input);
  const turnEvent = createTurnEnvelope(normalized);
  if (!eventHub) return Object.freeze({ event: turnEvent, duplicate: false, accepted: true });
  const accepted = eventHub.publish(turnEvent);
  return Object.freeze({ ...accepted, accepted: true });
}

export function toFrameworkTurnEventEnvelope(turnEvent, payload = {}) {
  const event = createTurnEnvelope(turnEvent);
  return Object.freeze({
    kind: 'CognitiveEventEnvelope',
    eventId: event.eventId,
    eventType: 'TURN_EVENT',
    eventVersion: event.eventVersion ?? RUNTIME_TURN_EVENT_CONTRACT_VERSION,
    producer: 'COGNITIVE_COPROCESSOR',
    causationId: event.causationId,
    correlationId: event.correlationId,
    turnId: event.turnId,
    taskId: null,
    sourceRevisionSet: [...event.sourceRevisionSet],
    worldRevision: event.worldRevision,
    sceneRevision: event.sceneRevision,
    sequence: Number(payload.sequence ?? 0),
    time: event.createdAt,
    dedupeIdentity: event.dedupeKey,
    payload: {
      ...structuredClone(payload),
      requiredCapabilities: [...event.requiredCapabilities],
      deliveryAttempt: event.deliveryAttempt,
      cognitiveLayer: event.cognitiveLayer,
      characterStateRevision: event.characterStateRevision,
      deadline: event.deadline,
    },
    payloadSchemaVersion: RUNTIME_TURN_EVENT_CONTRACT_VERSION,
  });
}

function normalizeRuntimeEvent(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Runtime TURN_EVENT envelope is required');
  if (input.kind === 'CognitiveEventEnvelope') {
    if (input.eventType !== 'TURN_EVENT') throw new TypeError(`Unsupported event type: ${input.eventType}`);
    assertMajorOne(input.eventVersion, 'eventVersion');
    assertMajorOne(input.payloadSchemaVersion ?? '1.0.0', 'payloadSchemaVersion');
    const payload = input.payload ?? {};
    return {
      eventId: required(input.eventId, 'eventId'),
      eventType: 'TURN_EVENT',
      eventVersion: input.eventVersion ?? RUNTIME_TURN_EVENT_CONTRACT_VERSION,
      turnId: required(input.turnId, 'turnId'),
      causationId: input.causationId ?? null,
      correlationId: required(input.correlationId, 'correlationId'),
      sourceRevisionSet: [...(input.sourceRevisionSet ?? [])],
      worldRevision: input.worldRevision ?? 0,
      sceneRevision: input.sceneRevision ?? 0,
      characterStateRevision: payload.characterStateRevision ?? 0,
      createdAt: Number(input.time ?? 0),
      deadline: Number(payload.deadline ?? 0),
      cognitiveLayer: payload.cognitiveLayer ?? 'L1',
      requiredCapabilities: [...(payload.requiredCapabilities ?? [])],
      deliveryAttempt: Number(payload.deliveryAttempt ?? 1),
      dedupeKey: required(input.dedupeIdentity ?? input.eventId, 'dedupeIdentity'),
    };
  }
  if (input.eventType === 'TURN_EVENT' && input.meta) {
    assertMajorOne(input.meta.schemaVersion ?? '1.0', 'schemaVersion');
    const payload = input.payload ?? {};
    return {
      eventId: required(input.meta.eventId, 'eventId'), eventType: 'TURN_EVENT', eventVersion: input.meta.eventVersion ?? input.meta.schemaVersion ?? RUNTIME_TURN_EVENT_CONTRACT_VERSION,
      turnId: required(input.meta.turnId, 'turnId'), causationId: input.meta.causationId ?? null,
      correlationId: required(input.meta.correlationId, 'correlationId'),
      sourceRevisionSet: [...(input.meta.revisionFences?.sourceRevisionIds ?? [])],
      worldRevision: input.meta.worldRevision ?? input.meta.revisionFences?.worldRevision ?? 0,
      sceneRevision: input.meta.sceneRevision ?? input.meta.revisionFences?.sceneRevision ?? 0,
      characterStateRevision: payload.characterStateRevision ?? input.meta.revisionFences?.characterStateRevision ?? 0,
      createdAt: Number(input.meta.createdAt ?? 0), deadline: Number(payload.deadline ?? 0),
      cognitiveLayer: payload.cognitiveLayer ?? 'L1', requiredCapabilities: [...(payload.requiredCapabilities ?? [])],
      deliveryAttempt: Number(payload.deliveryAttempt ?? 1), dedupeKey: required(input.meta.dedupeKey ?? input.meta.eventId, 'dedupeKey'),
    };
  }
  throw new TypeError('Unsupported Runtime TURN_EVENT envelope shape');
}

function assertMajorOne(value, name) {
  if (String(value ?? '').split('.')[0] !== '1') throw new TypeError(`Unsupported ${name}: ${value}`);
}
function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}
