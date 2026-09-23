import { Placement, ResultClass } from './constants.js';

export function toRuntimeObligation(task, {
  owner = 'COGNITIVE_COPROCESSOR',
  producerId = 'SIDECAR_JEV',
  priority = task.resultClass === ResultClass.REQUIRED ? 90 : task.resultClass === ResultClass.OPPORTUNISTIC ? 60 : 30,
} = {}) {
  return Object.freeze({
    taskId: task.taskId,
    taskType: task.taskType,
    layer: task.cognitiveLayer,
    owner,
    producerId,
    resultContract: {
      schemaVersion: task.schemaVersion,
      resultClass: task.resultClass,
      outputSchema: structuredClone(task.outputSchema),
      compilerLane: task.compilerLane,
      contextSealPolicy: task.contextSealPolicy,
      authority: 'NON_CANONICAL_WORKER_RESULT',
    },
    runtimeClass: task.placement === Placement.DEEP ? 'DEEP' : 'HOT',
    requiredCapabilities: [...task.requiredCapabilities],
    capabilityRequests: structuredClone(task.capabilityRequests ?? []),
    fallbackCapabilitySets: structuredClone(task.fallbackCapabilitySets ?? []),
    resourceClass: task.metadata?.resourceClass ?? null,
    resourceLimits: structuredClone(task.metadata?.resourceLimits ?? {}),
    sourceRevisions: structuredClone(task.metadata?.sourceRevisions ?? {}),
    sourceRevisionIds: [...task.sourceRevisionSet],
    worldRevision: task.worldRevision,
    sceneRevision: task.sceneRevision,
    revision: task.worldRevision,
    dependencies: [...(task.metadata?.dependencies ?? [])],
    priority,
    deadline: task.hardDeadline,
    deadlineClass: task.resultClass,
    foreground: task.resultClass !== ResultClass.DEFERRED,
    foregroundSensitivity: 'CONTEXT_SEAL',
    expectedCost: structuredClone(task.metadata?.expectedCost ?? {}),
    yieldPolicy: {
      mode: task.batchMetadata.yieldSafety,
      maxUninterruptedSliceMs: task.metadata?.maxUninterruptedSliceMs ?? null,
    },
    checkpointPolicy: {
      boundary: task.batchMetadata.checkpointBoundary,
      maxUnitsPerCheckpoint: task.metadata?.maxUnitsPerCheckpoint ?? null,
    },
    batchHint: {
      batchable: task.batchMetadata.batchable,
      slicePolicy: task.batchMetadata.slicePolicy,
      maxSliceUnits: task.metadata?.maxSliceUnits ?? null,
      partialResultSemantics: task.batchMetadata.partialResultSemantics,
    },
    speculative: task.resultClass === ResultClass.OPPORTUNISTIC,
    dedupeKey: task.dedupeKey,
    payload: {
      turnId: task.turnId,
      correlationId: task.correlationId,
      causationId: task.causationId,
      characterStateRevision: task.characterStateRevision,
      intentFingerprint: task.intentFingerprint,
      compilerLane: task.compilerLane,
      resultClass: task.resultClass,
    },
  });
}

export function runtimeTurnEventTypeDescriptor() {
  return Object.freeze({
    eventType: 'TURN_EVENT',
    schemaVersion: '1.0',
    producer: 'COGNITIVE_COPROCESSOR',
    payloadSchema: {
      required: ['requiredCapabilities','deliveryAttempt'],
      properties: {
        requiredCapabilities: 'array',
        deliveryAttempt: 'number',
        cognitiveLayer: 'string',
        characterStateRevision: 'number',
      },
      allowUnknown: true,
    },
  });
}

export function toRuntimeTurnEventEmission(turnEvent, payload = {}) {
  return Object.freeze({
    eventType: 'TURN_EVENT',
    payload: {
      ...structuredClone(payload),
      requiredCapabilities: [...turnEvent.requiredCapabilities],
      deliveryAttempt: turnEvent.deliveryAttempt,
      cognitiveLayer: turnEvent.cognitiveLayer,
      characterStateRevision: turnEvent.characterStateRevision,
    },
    meta: {
      schemaVersion: '1.0',
      eventId: turnEvent.eventId,
      producer: 'COGNITIVE_COPROCESSOR',
      causationId: turnEvent.causationId,
      correlationId: turnEvent.correlationId,
      turnId: turnEvent.turnId,
      revisionFences: {
        sourceRevisionIds: [...turnEvent.sourceRevisionSet],
        worldRevision: turnEvent.worldRevision,
        sceneRevision: turnEvent.sceneRevision,
        characterStateRevision: turnEvent.characterStateRevision,
      },
      worldRevision: turnEvent.worldRevision,
      sceneRevision: turnEvent.sceneRevision,
      createdAt: turnEvent.createdAt,
      dedupeKey: turnEvent.dedupeKey,
    },
  });
}
