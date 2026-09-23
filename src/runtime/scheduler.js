import { COGNITIVE_LAYERS, EXECUTION_STATUS, LIFECYCLE_STATUS } from './constants.js';
import { stableSort } from './utils.js';

export class LayeredScheduler {
  constructor({ ledger, lifecycle, registry, governor, starvationCycles = 8, onBlocked = null } = {}) {
    this.ledger = ledger;
    this.lifecycle = lifecycle;
    this.registry = registry;
    this.governor = governor;
    this.starvationCycles = starvationCycles;
    this.onBlocked = onBlocked;
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
      if (!this.#dependenciesSatisfied(record)) {
        this.#block(record, 'dependencies');
        continue;
      }
      if (record.recoveryState === 'commit-reconciliation-required') {
        this.ledger.setExecution(taskId, EXECUTION_STATUS.RECOVERING, 'commit-reconciliation-required');
        continue;
      }
      const workers = this.registry.eligible(record.obligation, this.governor);
      if (!workers.length) {
        this.#block(record, 'no-eligible-worker-or-resource');
        continue;
      }
      candidates.push({ record, worker: workers[0] });
    }
    if (!candidates.length) return null;

    const sorted = stableSort(candidates, (a, b) => this.#compare(a.record, b.record));
    const selected = sorted[0];
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
    this.ledger.setExecution(record.taskId, EXECUTION_STATUS.BLOCKED, reason);
    if (changed) this.onBlocked?.(record.taskId, reason);
  }

  #dependenciesSatisfied(record) {
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
