import { BatchEngine, AdaptiveBatchSizer } from './batch-engine.js';
import { CapabilityRegistry } from './capability-registry.js';
import { EVENT_TYPES, EXECUTION_STATUS, LIFECYCLE_STATUS } from './constants.js';
import { EventSpine } from './event-spine.js';
import { LifecycleCore } from './lifecycle.js';
import { MemoryPersistenceAdapter } from './persistence.js';
import { ResourceGovernor } from './resource-governor.js';
import { LayeredScheduler } from './scheduler.js';
import { RuntimeTelemetry } from './telemetry.js';
import { WorkLedger } from './work-ledger.js';

export class WorkerDirector {
  constructor({
    persistence = new MemoryPersistenceAdapter(),
    maxOutstanding = 1000,
    capacity = { CPU: 4 },
    foregroundReserve = { CPU: 1 },
    telemetrySink = null,
    batch = {},
    maxRetries = 3,
  } = {}) {
    this.persistence = persistence;
    this.telemetry = new RuntimeTelemetry({ sink: telemetrySink });
    this.events = new EventSpine();
    this.ledger = new WorkLedger({ persistence });
    this.lifecycle = new LifecycleCore({ ledger: this.ledger, maxOutstanding });
    this.registry = new CapabilityRegistry();
    this.governor = new ResourceGovernor({ capacity, foregroundReserve });
    this.scheduler = new LayeredScheduler({
      ledger: this.ledger,
      lifecycle: this.lifecycle,
      registry: this.registry,
      governor: this.governor,
      onBlocked: (taskId, reason) => {
        const record = this.ledger.get(taskId);
        this.telemetry.emit('WORK_BLOCKED', { taskId, reason, layer: record?.obligation.layer ?? null });
        this.events.emit(EVENT_TYPES.WORK_BLOCKED, { reason }, this.#eventMeta(taskId));
      },
    });
    this.batch = new BatchEngine({ ledger: this.ledger, telemetry: this.telemetry, sizer: new AdaptiveBatchSizer(batch) });
    this.maxRetries = maxRetries;
    this.executors = new Map();
    this.active = new Map();
    this.resumePending = new Set();
    this.#recoverInterruptedRecords();
  }

  registerWorker(worker) {
    return this.registry.register(worker);
  }

  submit(obligation, { units = [{ id: `${obligation.taskId ?? obligation.dedupeKey ?? obligation.taskType}:unit:0`, payload: null }], execute, validate = null, commit = null } = {}) {
    if (typeof execute !== 'function') throw new TypeError('submit requires an execute function');
    const admission = this.lifecycle.create(obligation);
    if (!admission.accepted) {
      this.telemetry.emit('BACKPRESSURE_REJECTED', { taskType: obligation.taskType, layer: obligation.layer, reason: admission.reason });
      return admission;
    }
    const taskId = admission.task.taskId;
    if (admission.coalesced) {
      this.batch.append(taskId, units);
      return admission;
    }
    if (!admission.deduped) {
      this.batch.prepare(taskId, units);
      this.lifecycle.markEligible(taskId);
      this.scheduler.enqueue(taskId);
      this.events.emit(EVENT_TYPES.WORK_ELIGIBLE, {}, this.#eventMeta(taskId));
    }
    if (!this.executors.has(taskId)) this.executors.set(taskId, { execute, validate, commit });
    this.#emitQueueTelemetry();
    return { ...admission, task: this.ledger.get(taskId).obligation };
  }

  attachExecutor(taskId, executor) {
    if (!this.ledger.get(taskId)) throw new Error(`Unknown task: ${taskId}`);
    if (typeof executor?.execute !== 'function') throw new TypeError('executor.execute is required');
    this.executors.set(taskId, executor);
  }

  recoverTask(taskId) {
    const record = this.ledger.get(taskId);
    if (!record) throw new Error(`Unknown task: ${taskId}`);
    if (record.recoveryState === 'commit-reconciliation-required') return false;
    const ok = this.ledger.markRecovered(taskId);
    if (ok) {
      this.resumePending.add(taskId);
      this.ledger.setExecution(taskId, EXECUTION_STATUS.QUEUED, 'recovered-from-checkpoint');
      this.scheduler.enqueue(taskId);
      this.telemetry.emit('WORK_RECOVERING', { taskId, checkpoint: record.checkpoint });
      this.events.emit(EVENT_TYPES.WORK_RECOVERING, {}, this.#eventMeta(taskId));
    }
    return ok;
  }

  resolveInDoubtCommit(taskId, resolution) {
    this.ledger.resolveInDoubtCommit(taskId, resolution);
    const record = this.ledger.get(taskId);
    if (this.ledger.isComplete(taskId)) {
      this.ledger.setExecution(taskId, EXECUTION_STATUS.COMPLETE);
      this.lifecycle.satisfy(taskId);
    } else {
      this.ledger.setExecution(taskId, EXECUTION_STATUS.PARKED, 'commit-reconciled');
      this.resumePending.add(taskId);
    }
  }

  beginGeneration(meta = {}) {
    this.events.emit(EVENT_TYPES.GENERATION_STARTED, {}, meta);
    const yieldTaskIds = this.governor.beginGeneration();
    for (const taskId of yieldTaskIds) {
      const record = this.ledger.get(taskId);
      if (!record || ![EXECUTION_STATUS.ACTIVE, EXECUTION_STATUS.YIELDING].includes(record.executionStatus)) continue;
      this.ledger.requestYield(taskId);
      this.telemetry.emit('WORK_YIELD_REQUESTED', { taskId, reason: 'foreground-demand' });
      this.telemetry.emit('WORK_YIELDING', { taskId, reason: 'foreground-demand' });
      this.events.emit(EVENT_TYPES.WORK_YIELD_REQUESTED, { reason: 'foreground-demand' }, this.#eventMeta(taskId));
    }
    this.#emitResourceTelemetry();
    return yieldTaskIds;
  }

  completeGeneration(meta = {}) {
    this.governor.completeGeneration();
    this.events.emit(EVENT_TYPES.GENERATION_COMPLETED, {}, meta);
    for (const record of this.ledger.list()) {
      if (record.executionStatus === EXECUTION_STATUS.PARKED && record.lifecycleStatus === LIFECYCLE_STATUS.ELIGIBLE && !record.supersession?.requested) {
        this.ledger.clearYield(record.taskId);
        this.ledger.setExecution(record.taskId, EXECUTION_STATUS.QUEUED, 'resume-eligible');
        this.scheduler.enqueue(record.taskId);
        this.resumePending.add(record.taskId);
      }
    }
    this.#emitQueueTelemetry();
  }

  async runCycle(signals = {}) {
    this.scheduler.tick();
    this.#dispatchAvailable();
    const runs = [...this.active.values()].map((assignment) => this.#runAssignment(assignment, signals));
    const results = await Promise.all(runs);
    this.#emitQueueTelemetry();
    this.#emitResourceTelemetry();
    return results;
  }

  async drain({ maxCycles = 10000, signals = {} } = {}) {
    let cycles = 0;
    while (cycles < maxCycles) {
      const open = this.lifecycle.listOpen().filter((record) => ![EXECUTION_STATUS.BLOCKED, EXECUTION_STATUS.RECOVERING].includes(record.executionStatus) || this.executors.has(record.taskId));
      if (!open.length && this.active.size === 0) break;
      const before = this.#progressFingerprint();
      await this.runCycle(signals);
      cycles += 1;
      const after = this.#progressFingerprint();
      if (before === after && this.active.size === 0) break;
    }
    return { cycles, open: this.lifecycle.listOpen().length, active: this.active.size };
  }

  snapshot() {
    return {
      lifecycle: this.ledger.list().map((record) => ({ taskId: record.taskId, lifecycleStatus: record.lifecycleStatus, executionStatus: record.executionStatus, layer: record.obligation.layer })),
      queueDepth: this.scheduler.depthByLayer(),
      resources: this.governor.snapshot(),
      workers: this.registry.snapshot(),
      telemetry: this.telemetry.snapshot(),
    };
  }

  #dispatchAvailable() {
    while (true) {
      const next = this.scheduler.next();
      if (!next) break;
      const { record, worker } = next;
      const executor = this.executors.get(record.taskId);
      if (!executor) {
        this.ledger.setExecution(record.taskId, EXECUTION_STATUS.BLOCKED, 'executor-not-attached');
        continue;
      }
      const lease = this.governor.acquire(record.obligation, worker);
      if (!lease) {
        this.scheduler.enqueue(record.taskId);
        break;
      }
      this.registry.claim(worker.workerId);
      const resumed = this.resumePending.delete(record.taskId) || record.startedCount > 0;
      this.ledger.setExecution(record.taskId, EXECUTION_STATUS.ACTIVE, resumed ? 'resumed' : 'started');
      this.active.set(record.taskId, { taskId: record.taskId, workerId: worker.workerId, lease, executor });
      const eventType = resumed ? EVENT_TYPES.WORK_RESUMED : EVENT_TYPES.WORK_STARTED;
      this.events.emit(eventType, { workerId: worker.workerId }, this.#eventMeta(record.taskId));
      this.telemetry.emit(eventType, { taskId: record.taskId, workerId: worker.workerId, layer: record.obligation.layer });
    }
  }

  async #runAssignment(assignment, signals) {
    const record = this.ledger.get(assignment.taskId);
    if (!record || !this.active.has(assignment.taskId)) return null;
    const outcome = await this.batch.runOneSlice(
      assignment.taskId,
      assignment.executor,
      {
        ...signals,
        foregroundDemand: this.governor.generationActive,
        queueDepth: Object.values(this.scheduler.depthByLayer()).reduce((a, b) => a + b, 0),
      },
      (taskId) => this.lifecycle.isFresh(taskId),
    );

    if (outcome.status === 'complete') {
      this.#completeTask(assignment.taskId);
    } else if (outcome.status === 'yield') {
      this.#parkTask(assignment.taskId);
    } else if (outcome.status === 'stale' || outcome.status === 'superseded-after-checkpoint') {
      this.lifecycle.supersede(assignment.taskId, 'superseded-during-execution');
      this.#releaseAssignment(assignment.taskId);
    } else if (outcome.status === 'commit-uncertain') {
      this.#releaseAssignment(assignment.taskId);
      this.telemetry.emit('WORK_RECOVERING', { taskId: assignment.taskId, recoveryState: 'commit-reconciliation-required' });
      this.events.emit(EVENT_TYPES.WORK_RECOVERING, { recoveryState: 'commit-reconciliation-required' }, this.#eventMeta(assignment.taskId));
    } else if (outcome.status?.startsWith('failed')) {
      const latest = this.ledger.get(assignment.taskId);
      this.#releaseAssignment(assignment.taskId);
      if (latest.retryState.attempts < this.maxRetries && latest.lifecycleStatus === LIFECYCLE_STATUS.ELIGIBLE) {
        this.ledger.setExecution(assignment.taskId, EXECUTION_STATUS.RECOVERING, outcome.status);
        this.ledger.setExecution(assignment.taskId, EXECUTION_STATUS.QUEUED, 'retry');
        this.scheduler.enqueue(assignment.taskId);
      } else {
        this.ledger.setExecution(assignment.taskId, EXECUTION_STATUS.FAILED, outcome.status);
      }
    }
    return { taskId: assignment.taskId, ...outcome };
  }

  #parkTask(taskId) {
    this.ledger.setExecution(taskId, EXECUTION_STATUS.PARKED, 'safe-yield-boundary');
    this.#releaseAssignment(taskId);
    const record = this.ledger.get(taskId);
    this.telemetry.emit('WORK_PARKED', { taskId, checkpoint: record.checkpoint });
    this.events.emit(EVENT_TYPES.WORK_PARKED, { checkpoint: record.checkpoint }, this.#eventMeta(taskId));
  }

  #completeTask(taskId) {
    this.ledger.setExecution(taskId, EXECUTION_STATUS.COMPLETE);
    this.lifecycle.satisfy(taskId);
    this.#releaseAssignment(taskId);
    this.telemetry.emit('WORK_COMPLETED', { taskId });
    this.events.emit(EVENT_TYPES.WORK_COMPLETED, {}, this.#eventMeta(taskId));
  }

  #releaseAssignment(taskId) {
    const assignment = this.active.get(taskId);
    if (!assignment) return;
    this.registry.release(assignment.workerId);
    this.governor.release(taskId);
    this.active.delete(taskId);
  }

  #recoverInterruptedRecords() {
    for (const record of this.ledger.list()) {
      if (record.executionStatus === EXECUTION_STATUS.RECOVERING) {
        this.telemetry.emit('WORK_RECOVERING', { taskId: record.taskId, recoveryState: record.recoveryState, checkpoint: record.checkpoint });
        this.events.emit(EVENT_TYPES.WORK_RECOVERING, { recoveryState: record.recoveryState }, this.#eventMeta(record.taskId));
      } else if (record.lifecycleStatus === LIFECYCLE_STATUS.ELIGIBLE && record.executionStatus === EXECUTION_STATUS.QUEUED) {
        this.scheduler.enqueue(record.taskId);
      }
    }
  }

  #eventMeta(taskId) {
    const record = this.ledger.get(taskId);
    return {
      taskId,
      sourceRevisions: record?.obligation.sourceRevisions ?? {},
      worldRevision: record?.obligation.worldRevision ?? null,
      sceneRevision: record?.obligation.sceneRevision ?? null,
      correlationId: record?.obligation.payload?.correlationId ?? null,
      causationId: record?.obligation.payload?.causationId ?? null,
    };
  }

  #emitQueueTelemetry() {
    const depthByLayer = this.scheduler.depthByLayer();
    this.telemetry.emit('QUEUE_DEPTH', { depthByLayer });
    const activeByLayer = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
    for (const taskId of this.active.keys()) {
      const layer = this.ledger.get(taskId)?.obligation.layer;
      if (layer) activeByLayer[layer] += 1;
    }
    this.telemetry.emit('LAYER_UTILIZATION', { activeByLayer, queuedByLayer: depthByLayer });
  }

  #emitResourceTelemetry() {
    const snapshot = this.governor.snapshot();
    this.telemetry.emit('RESOURCE_UTILIZATION', {
      usage: snapshot.usage,
      reservedForegroundCapacity: snapshot.foregroundReserve,
      borrowedBackgroundLeases: snapshot.borrowedBackgroundLeases,
    });
  }

  #progressFingerprint() {
    return this.ledger.list().map((record) => `${record.taskId}:${record.lifecycleStatus}:${record.executionStatus}:${record.batch?.completedUnitIds.length ?? 0}:${record.retryState?.attempts ?? 0}:${record.updatedSequence}`).join('|');
  }
}
