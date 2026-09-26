import { EXECUTION_STATUS, LIFECYCLE_STATUS } from './constants.js';

export class SleepMaintenanceRuntime {
  constructor({
    director,
    idleCyclesRequired = 3,
    maxL2Backlog = 0,
    maxL3Backlog = 2,
    maxOutstanding = 8,
    resourceBudget = {},
    maxSliceUnits = 1,
  } = {}) {
    if (!director) throw new TypeError('SleepMaintenanceRuntime requires a WorkerDirector');
    this.director = director;
    this.idleCyclesRequired = idleCyclesRequired;
    this.maxL2Backlog = maxL2Backlog;
    this.maxL3Backlog = maxL3Backlog;
    this.maxOutstanding = maxOutstanding;
    this.resourceBudget = structuredClone(resourceBudget);
    this.maxSliceUnits = Math.max(1, Number(maxSliceUnits));
    this.profiles = new Map();
  }

  registerProfile(profile) {
    if (!profile?.profileId) throw new TypeError('profileId is required');
    if (!profile.taskType) throw new TypeError('taskType is required');
    const normalized = {
      profileId: profile.profileId,
      taskType: profile.taskType,
      owner: profile.owner ?? 'MAINTENANCE',
      capabilityRequests: structuredClone(profile.capabilityRequests ?? []),
      requiredCapabilities: [...(profile.requiredCapabilities ?? [])],
      fallbackCapabilitySets: structuredClone(profile.fallbackCapabilitySets ?? []),
      serviceDependencies: structuredClone(profile.serviceDependencies ?? []),
      priority: Number.isFinite(profile.priority) ? profile.priority : 90,
      resourceLimits: { ...this.resourceBudget, ...(profile.resourceLimits ?? {}) },
      batchHint: { maxSliceUnits: this.maxSliceUnits, ...(profile.batchHint ?? {}) },
      checkpointPolicy: structuredClone(profile.checkpointPolicy ?? {}),
      yieldPolicy: structuredClone(profile.yieldPolicy ?? { mode: 'SAFE_BOUNDARY' }),
      resultContract: structuredClone(profile.resultContract ?? null),
    };
    if (this.profiles.has(normalized.profileId)) throw new Error(`Sleep profile already registered: ${normalized.profileId}`);
    this.profiles.set(normalized.profileId, normalized);
    return structuredClone(normalized);
  }

  evaluate({ idleCycles = 0, maintenanceDue = false, operatorRequested = false } = {}) {
    const depth = this.director.scheduler.depthByLayer();
    const outstanding = this.director.ledger.list().filter((record) =>
      record.obligation.layer === 'L4'
      && [LIFECYCLE_STATUS.PENDING, LIFECYCLE_STATUS.ELIGIBLE].includes(record.lifecycleStatus)
      && record.executionStatus !== EXECUTION_STATUS.COMPLETE
    ).length;
    const reasons = [];
    if (this.director.governor.generationActive) reasons.push('foreground-pressure');
    if (!operatorRequested && idleCycles < this.idleCyclesRequired) reasons.push('idle-threshold');
    if (!maintenanceDue && !operatorRequested) reasons.push('maintenance-not-due');
    if ((depth.L2 ?? 0) > this.maxL2Backlog) reasons.push('nearline-backlog');
    if ((depth.L3 ?? 0) > this.maxL3Backlog) reasons.push('deep-backlog');
    if (outstanding >= this.maxOutstanding) reasons.push('maintenance-budget');
    return { eligible: reasons.length === 0, reasons, outstanding, depth };
  }

  submit(profileId, request = {}, executor = {}, conditions = {}) {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error(`Unknown Sleep profile: ${profileId}`);
    const existing = this.director.ledger.list().find((record) =>
      record.lifecycleStatus !== LIFECYCLE_STATUS.CANCELLED
      && ((request.dedupeKey && record.obligation.dedupeKey === request.dedupeKey)
        || (request.coalescible && request.coalesceKey && record.obligation.coalesceKey === request.coalesceKey))
    );
    const eligibility = this.evaluate(conditions);
    if (!eligibility.eligible && !existing) {
      this.director.telemetry.emit('SLEEP_DEFERRED', { profileId, reasons: eligibility.reasons });
      return { accepted: false, deferred: true, reason: eligibility.reasons.join(','), eligibility };
    }
    const result = this.director.submit({
      taskType: request.taskType ?? profile.taskType,
      owner: request.owner ?? profile.owner,
      layer: 'L4',
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
      foreground: false,
      batchHint: { ...profile.batchHint, ...(request.batchHint ?? {}) },
      checkpointPolicy: request.checkpointPolicy ?? profile.checkpointPolicy,
      yieldPolicy: request.yieldPolicy ?? profile.yieldPolicy,
      resultContract: structuredClone(request.resultContract ?? profile.resultContract),
      dedupeKey: request.dedupeKey,
      conflictKey: request.conflictKey ?? null,
      coalesceKey: request.coalesceKey ?? null,
      coalescible: request.coalescible ?? true,
      payload: request.payload ?? {},
      runtimeClass: 'SLEEP',
    }, { ...executor, units: request.units ?? executor.units });
    if (result.accepted) this.director.telemetry.emit('SLEEP_ADMITTED', { taskId: result.task.taskId, profileId });
    return { ...result, eligibility };
  }
}
