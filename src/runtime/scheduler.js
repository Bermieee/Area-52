import { COGNITIVE_LAYERS, EXECUTION_STATUS, LIFECYCLE_STATUS } from './constants.js';
import { stableSort } from './utils.js';

export class LayeredScheduler {
  constructor({
    ledger,
    lifecycle,
    registry,
    governor,
    dependencyGraph = null,
    starvationCycles = 8,
    onBlocked = null,
    onDegraded = null,
    onNegotiated = null,
    onStarvation = null,
  } = {}) {
    this.ledger = ledger;
    this.lifecycle = lifecycle;
    this.registry = registry;
    this.governor = governor;
    this.dependencyGraph = dependencyGraph;
    this.starvationCycles = starvationCycles;
    this.onBlocked = onBlocked;
    this.onDegraded = onDegraded;
    this.onNegotiated = onNegotiated;
    this.onStarvation = onStarvation;
    this.queued = new Set();
    this.waitCycles = new Map();
    this.cycle = 0;
  }

  enqueue(taskId) {
    const record = this.ledger.get(taskId);
    if (!record || record.lifecycleStatus !== LIFECYCLE_STATUS.ELIGIBLE) return false;
    this.queued.add(taskId);
    if (![EXECUTION_STATUS.ACTIVE, EXECUTION_STATUS.YIELDING, EXECUTION_STATUS.PARKED, EXECUTION_STATUS.RECOVERING].includes(record.executionStatus)) {
      this.ledger.setExecution(taskId, EXECUTION_STATUS.QUEUED);
    }
    return true;
  }

  remove(taskId) {
    this.queued.delete(taskId);
    this.waitCycles.delete(taskId);
  }

  tick() {
    this.cycle += 1;
    for (const taskId of this.queued) this.waitCycles.set(taskId, (this.waitCycles.get(taskId) ?? 0) + 1);
  }

  next() {
    const candidates = [];
    for (const taskId of this.queued) {
      const record = this.ledger.get(taskId);
      if (!record || record.lifecycleStatus !== LIFECYCLE_STATUS.ELIGIBLE) {
        this.remove(taskId);
        continue;
      }
      if (!this.#taskDependenciesSatisfied(record)) {
        this.#block(record, 'task-dependencies');
        continue;
      }
      const dependencyState = this.dependencyGraph?.evaluateTask(record.obligation) ?? {
        executable: true, degraded: false, missingRequired: [], missingOptional: [], degradedServices: [],
      };
      this.ledger.setDependencyState(taskId, dependencyState);
      if (!dependencyState.executable) {
        this.#block(record, `required-dependency:${dependencyState.missingRequired.join(',')}`);
        continue;
      }
      if (record.recoveryState === 'commit-reconciliation-required') {
        this.ledger.setExecution(taskId, EXECUTION_STATUS.RECOVERING, 'commit-reconciliation-required');
        continue;
      }
      const negotiation = this.registry.negotiate(record.obligation, this.governor);
      if (!negotiation.workers.length) {
        this.#block(record, 'no-compatible-provider-or-resource');
        continue;
      }
      const reasons = [];
      if (dependencyState.missingOptional.length) reasons.push('optional-dependency-unavailable');
      if (dependencyState.degradedServices.length) reasons.push('dependency-degraded');
      if (negotiation.fallbackUsed) reasons.push('capability-fallback');
      const degradation = {
        degraded: reasons.length > 0,
        reasons,
        missingOptional: dependencyState.missingOptional,
        degradedServices: dependencyState.degradedServices,
        fallbackUsed: negotiation.fallbackUsed,
      };
      const degradationChanged = this.ledger.setDegradation(taskId, degradation);
      if (degradationChanged) this.onDegraded?.(taskId, degradation);
      const negotiationSummary = {
        workerId: negotiation.worker.workerId,
        provider: negotiation.worker.provider,
        implementationId: negotiation.worker.implementationId,
        fallbackUsed: negotiation.fallbackUsed,
        selectedRequests: negotiation.selectedRequests,
        reason: negotiation.reason,
      };
      const negotiationChanged = this.ledger.setNegotiation(taskId, negotiationSummary);
      if (negotiationChanged) this.onNegotiated?.(taskId, negotiationSummary);
      candidates.push({ record, worker: negotiation.worker, negotiation: negotiationSummary });
    }
    if (!candidates.length) return null;

    const sorted = stableSort(candidates, (a, b) => this.#compare(a.record, b.record));
    const selected = sorted[0];
    const baseLayer = COGNITIVE_LAYERS[selected.record.obligation.layer];
    const effectiveLayer = this.#effectiveLayer(selected.record);
    if (effectiveLayer < baseLayer) {
      this.onStarvation?.(selected.record.taskId, { baseLayer, effectiveLayer, waitedCycles: this.waitCycles.get(selected.record.taskId) ?? 0 });
    }
    this.remove(selected.record.taskId);
    return selected;
  }

  depthByLayer() {
    const depth = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
    for (const taskId of this.queued) {
      const record = this.ledger.get(taskId);
      if (record?.lifecycleStatus === LIFECYCLE_STATUS.ELIGIBLE) depth[record.obligation.layer] += 1;
    }
    return depth;
  }

  #block(record, reason) {
    const changed = record.executionStatus !== EXECUTION_STATUS.BLOCKED || record.executionReason !== reason;
    if (!changed) return;
    this.ledger.setExecution(record.taskId, EXECUTION_STATUS.BLOCKED, reason);
    this.onBlocked?.(record.taskId, reason);
  }

  #taskDependenciesSatisfied(record) {
    return record.dependencies.every((dependencyId) => {
      const dependency = this.ledger.get(dependencyId);
      return dependency?.lifecycleStatus === LIFECYCLE_STATUS.SATISFIED || dependency?.executionStatus === EXECUTION_STATUS.COMPLETE;
    });
  }

  #compare(a, b) {
    const aLayer = this.#effectiveLayer(a);
    const bLayer = this.#effectiveLayer(b);
    const aDeadline = a.obligation.deadline ?? Number.POSITIVE_INFINITY;
    const bDeadline = b.obligation.deadline ?? Number.POSITIVE_INFINITY;
    return aLayer - bLayer
      || a.obligation.priority - b.obligation.priority
      || aDeadline - bDeadline
      || a.createdSequence - b.createdSequence
      || a.taskId.localeCompare(b.taskId);
  }

  #effectiveLayer(record) {
    const base = COGNITIVE_LAYERS[record.obligation.layer];
    if (base <= COGNITIVE_LAYERS.L1) return base;
    const waited = this.waitCycles.get(record.taskId) ?? 0;
    const boost = Math.floor(waited / this.starvationCycles);
    return Math.max(COGNITIVE_LAYERS.L2, base - boost);
  }
}
