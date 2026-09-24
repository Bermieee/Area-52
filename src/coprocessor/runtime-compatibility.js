import { Placement, ResultClass } from './constants.js';
import { createCapabilityRequirement } from './capability-negotiation.js';

export const RUNTIME_OBLIGATION_CONTRACT_VERSION = '1.1.0';

export function toRuntimeObligation(task, {
  owner = 'COGNITIVE_COPROCESSOR',
  producerId = 'SIDECAR_JEV',
  priority = task.resultClass === ResultClass.REQUIRED ? 90 : task.resultClass === ResultClass.OPPORTUNISTIC ? 60 : 30,
} = {}) {
  const qualityWeight = Number(task.metadata?.qualityWeight ?? (task.resultClass === ResultClass.REQUIRED ? 1 : task.resultClass === ResultClass.OPPORTUNISTIC ? 0.5 : 0.25));
  const capabilityRequirement = createCapabilityRequirement(task, {
    contextTokens: task.metadata?.contextTokens ?? 0,
    expectedOutputTokens: task.metadata?.expectedOutputTokens ?? 0,
    requireStructuredOutput: task.metadata?.requireStructuredOutput ?? true,
    maxLatencyClass: task.metadata?.maxLatencyClass ?? null,
    maxLatencyMs: task.metadata?.maxLatencyMs ?? null,
    maxCostClass: task.metadata?.maxCostClass ?? 'HIGH',
  });
  const deep = task.placement === Placement.DEEP;
  const resumeIdentity = task.metadata?.resumeIdentity ?? `resume:${task.taskId}:${task.dedupeKey}`;
  return Object.freeze({
    contractVersion: RUNTIME_OBLIGATION_CONTRACT_VERSION,
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
      settlementAuthority: false,
      contextSealBypass: false,
    },
    runtimeClass: deep ? 'DEEP' : 'HOT',
    executionClass: deep ? 'DEEP' : 'HOT',
    placement: task.placement,
    preemptionPolicy: deep ? 'YIELD_TO_FOREGROUND' : 'FOREGROUND_PRIORITY',
    resumeRequired: deep && task.batchMetadata.yieldSafety !== 'NOT_APPLICABLE',
    foregroundReserveEligibility: !deep,
    resultClass: task.resultClass,
    requiredCapabilities: [...task.requiredCapabilities],
    capabilityRequests: structuredClone(task.capabilityRequests ?? []),
    fallbackCapabilitySets: structuredClone(task.fallbackCapabilitySets ?? []),
    capabilityRequirement,
    resourceClass: task.metadata?.resourceClass ?? null,
    resourceHints: structuredClone(task.metadata?.resourceHints ?? task.metadata?.resourceLimits ?? {}),
    resourceLimits: structuredClone(task.metadata?.resourceLimits ?? {}),
    sourceRevisions: structuredClone(task.metadata?.sourceRevisions ?? {}),
    sourceRevisionIds: [...task.sourceRevisionSet],
    worldRevision: task.worldRevision,
    sceneRevision: task.sceneRevision,
    revision: task.worldRevision,
    dependencies: [...(task.metadata?.dependencies ?? [])],
    priority,
    softDeadline: task.softDeadline,
    hardDeadline: task.hardDeadline,
    deadline: task.hardDeadline,
    deadlineClass: task.resultClass,
    deadlineBudget: Object.freeze({ softDeadline: task.softDeadline, hardDeadline: task.hardDeadline, resultClass: task.resultClass, qualityWeight }),
    qualityWeight,
    fallbackContract: structuredClone(task.fallbackPolicy),
    foreground: task.resultClass !== ResultClass.DEFERRED,
    foregroundSensitivity: 'CONTEXT_SEAL',
    expectedCost: structuredClone(task.metadata?.expectedCost ?? {}),
    yieldPolicy: {
      mode: task.batchMetadata.yieldSafety,
      legal: deep && task.batchMetadata.yieldSafety !== 'NOT_APPLICABLE',
      checkpointBoundary: task.batchMetadata.checkpointBoundary,
      partialResultSemantics: task.batchMetadata.partialResultSemantics,
      resumeIdentity,
      maxUninterruptedSliceMs: task.metadata?.maxUninterruptedSliceMs ?? null,
    },
    checkpointPolicy: {
      boundary: task.batchMetadata.checkpointBoundary,
      maxUnitsPerCheckpoint: task.metadata?.maxUnitsPerCheckpoint ?? null,
      resumeIdentity,
      storageOwnedByRuntime: true,
    },
    batchHint: {
      batchable: task.batchMetadata.batchable,
      slicePolicy: task.batchMetadata.slicePolicy,
      maxSliceUnits: task.metadata?.maxSliceUnits ?? null,
      partialResultSemantics: task.batchMetadata.partialResultSemantics,
      batchSlice: task.metadata?.batchSlice ?? null,
    },
    speculative: task.resultClass === ResultClass.OPPORTUNISTIC,
    dedupeKey: task.dedupeKey,
    schedulingDecision: null,
    authorityGranted: false,
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
      eventVersion: turnEvent.eventVersion ?? '1.0.0',
    },
  });
}
