import { COGNITIVE_LAYERS, assertLayer } from './constants.js';

function normalizeProfile(profile) {
  if (!profile?.profileId) throw new TypeError('profileId is required');
  if (!profile.taskType) throw new TypeError('taskType is required');
  const preferredLayer = assertLayer(profile.preferredLayer ?? 'L3');
  const minimumLayer = assertLayer(profile.minimumLayer ?? 'L3');
  if (COGNITIVE_LAYERS[preferredLayer] < COGNITIVE_LAYERS[minimumLayer]) {
    throw new TypeError('preferredLayer may not be more foreground than minimumLayer');
  }
  if (COGNITIVE_LAYERS[minimumLayer] < COGNITIVE_LAYERS.L3) {
    throw new TypeError('Deep Cognition profiles must have minimumLayer L3 or L4');
  }
  return {
    profileId: profile.profileId,
    taskType: profile.taskType,
    owner: profile.owner ?? 'EXTERNAL',
    preferredLayer,
    minimumLayer,
    capabilityRequests: structuredClone(profile.capabilityRequests ?? []),
    requiredCapabilities: [...(profile.requiredCapabilities ?? [])],
    fallbackCapabilitySets: structuredClone(profile.fallbackCapabilitySets ?? []),
    resourceLimits: structuredClone(profile.resourceLimits ?? {}),
    batchable: profile.batchable ?? true,
    batchHint: structuredClone(profile.batchHint ?? {}),
    checkpointPolicy: structuredClone(profile.checkpointPolicy ?? {}),
    serviceDependencies: structuredClone(profile.serviceDependencies ?? []),
    priority: Number.isFinite(profile.priority) ? profile.priority : 60,
    deadlineClass: profile.deadlineClass ?? 'BACKGROUND',
    foregroundSensitivity: profile.foregroundSensitivity ?? 'YIELD_ON_GENERATION',
    expectedCost: structuredClone(profile.expectedCost ?? {}),
    yieldPolicy: structuredClone(profile.yieldPolicy ?? { mode: 'SAFE_BOUNDARY' }),
    speculative: Boolean(profile.speculative),
    resultContract: structuredClone(profile.resultContract ?? null),
  };
}

export class DeepCognitionRuntime {
  constructor({ director } = {}) {
    if (!director) throw new TypeError('DeepCognitionRuntime requires a WorkerDirector');
    this.director = director;
    this.profiles = new Map();
  }

  registerProfile(profile) {
    const normalized = normalizeProfile(profile);
    if (this.profiles.has(normalized.profileId)) throw new Error(`Deep profile already registered: ${normalized.profileId}`);
    this.profiles.set(normalized.profileId, normalized);
    return structuredClone(normalized);
  }

  profile(profileId) {
    const value = this.profiles.get(profileId);
    return value ? structuredClone(value) : null;
  }

  submit(profileId, request = {}, executor = {}) {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error(`Unknown Deep Cognition profile: ${profileId}`);
    const layer = assertLayer(request.layer ?? profile.preferredLayer);
    if (COGNITIVE_LAYERS[layer] < COGNITIVE_LAYERS[profile.minimumLayer]) {
      throw new TypeError(`Deep work ${profileId} cannot run above minimum layer ${profile.minimumLayer}`);
    }
    const obligation = {
      taskType: request.taskType ?? profile.taskType,
      owner: request.owner ?? profile.owner,
      layer,
      requiredCapabilities: request.requiredCapabilities ?? profile.requiredCapabilities,
      capabilityRequests: request.capabilityRequests ?? profile.capabilityRequests,
      fallbackCapabilitySets: request.fallbackCapabilitySets ?? profile.fallbackCapabilitySets,
      resourceLimits: { ...profile.resourceLimits, ...(request.resourceLimits ?? {}) },
      serviceDependencies: request.serviceDependencies ?? profile.serviceDependencies,
      dependencies: request.dependencies ?? [],
      sourceRevisions: request.sourceRevisions ?? {},
      sourceRevisionIds: request.sourceRevisionIds ?? [],
      worldRevision: request.worldRevision ?? null,
      sceneRevision: request.sceneRevision ?? null,
      revision: request.revision ?? request.worldRevision ?? 0,
      priority: request.priority ?? profile.priority,
      deadline: request.deadline ?? null,
      deadlineClass: request.deadlineClass ?? profile.deadlineClass,
      foreground: false,
      foregroundSensitivity: profile.foregroundSensitivity,
      expectedCost: request.expectedCost ?? profile.expectedCost,
      yieldPolicy: request.yieldPolicy ?? profile.yieldPolicy,
      checkpointPolicy: request.checkpointPolicy ?? profile.checkpointPolicy,
      batchHint: { ...profile.batchHint, ...(request.batchHint ?? {}) },
      speculative: request.speculative ?? profile.speculative,
      resultContract: structuredClone(request.resultContract ?? profile.resultContract),
      dedupeKey: request.dedupeKey,
      conflictKey: request.conflictKey ?? null,
      coalesceKey: request.coalesceKey ?? null,
      coalescible: request.coalescible ?? false,
      payload: request.payload ?? {},
      runtimeClass: 'DEEP',
    };
    const result = this.director.submit(obligation, { ...executor, units: request.units ?? executor.units });
    if (result.accepted) {
      this.director.telemetry.emit('DEEP_ADMITTED', { taskId: result.task.taskId, profileId, layer });
    }
    return result;
  }
}
