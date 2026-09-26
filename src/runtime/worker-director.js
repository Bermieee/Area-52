import { BatchEngine, AdaptiveBatchSizer } from './batch-engine.js';
import { CapabilityRegistry } from './capability-registry.js';
import { EVENT_TYPES, EXECUTION_STATUS, LIFECYCLE_STATUS } from './constants.js';
import { ServiceDependencyGraph } from './dependency-graph.js';
import { EventSpine } from './event-spine.js';
import { EventTypeRegistry } from './event-type-registry.js';
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
    eventRegistry = null,
    dependencyGraph = null,
    isTurnSealed = () => false,
    resultSink = null,
  } = {}) {
    this.persistence = persistence;
    this.telemetry = new RuntimeTelemetry({ sink: telemetrySink });
    const diagnostic = (entry) => this.telemetry.emit(entry.type ?? 'RUNTIME_DIAGNOSTIC', entry);
    this.eventTypes = eventRegistry ?? new EventTypeRegistry({ builtins: Object.values(EVENT_TYPES), onDiagnostic: diagnostic });
    this.events = new EventSpine({
      registry: this.eventTypes,
      onDiagnostic: diagnostic,
    });
    this.dependencies = dependencyGraph ?? new ServiceDependencyGraph({ onDiagnostic: diagnostic });
    this.ledger = new WorkLedger({ persistence });
    this.lifecycle = new LifecycleCore({ ledger: this.ledger, maxOutstanding });
    this.registry = new CapabilityRegistry();
    this.governor = new ResourceGovernor({ capacity, foregroundReserve });
    this.scheduler = new LayeredScheduler({
      ledger: this.ledger,
      lifecycle: this.lifecycle,
      registry: this.registry,
      governor: this.governor,
      dependencyGraph: this.dependencies,
      onBlocked: (taskId, reason) => {
        const record = this.ledger.get(taskId);
        const type = reason.startsWith('required-dependency:') ? 'DEPENDENCY_BLOCKED' : 'WORK_BLOCKED';
        this.telemetry.emit(type, { taskId, reason, layer: record?.obligation.layer ?? null });
        this.events.emit(EVENT_TYPES.WORK_BLOCKED, { reason }, this.#eventMeta(taskId));
      },
      onDegraded: (taskId, degradation) => {
        this.telemetry.emit(degradation.degraded ? 'DEGRADED_EXECUTION' : 'DEGRADATION_CLEARED', { taskId, ...degradation });
      },
      onNegotiated: (taskId, negotiation) => {
        this.telemetry.emit('CAPABILITY_NEGOTIATED', { taskId, ...negotiation });
        if (negotiation.fallbackUsed) this.telemetry.emit('CAPABILITY_FALLBACK', { taskId, ...negotiation });
      },
      onStarvation: (taskId, detail) => {
        this.telemetry.emit('STARVATION_PROTECTION', { taskId, ...detail });
      },
    });
    this.batch = new BatchEngine({ ledger: this.ledger, telemetry: this.telemetry, sizer: new AdaptiveBatchSizer(batch) });
    this.maxRetries = maxRetries;
    this.isTurnSealed = isTurnSealed;
    this.resultSink = resultSink;
    this.executors = new Map();
    this.active = new Map();
    this.inflight = new Map();
    this.resumePending = new Set();
    this.#recoverInterruptedRecords();
  }

  registerWorker(worker) {
    const registered = this.registry.register(worker);
    this.telemetry.emit('CAPABILITY_PROVIDER_REGISTERED', {
      workerId: registered.workerId,
      provider: registered.provider,
      implementationId: registered.implementationId,
      capabilities: registered.capabilityDescriptors,
    });
    return registered;
  }

  setWorkerAvailability(workerId, available) {
    this.registry.setAvailability(workerId, available);
    this.telemetry.emit('CAPABILITY_PROVIDER_AVAILABILITY', { workerId, available: Boolean(available) });
  }

  setWorkerHealth(workerId, health) {
    this.registry.setHealth(workerId, health);
    this.telemetry.emit('CAPABILITY_PROVIDER_HEALTH', { workerId, health });
  }

  registerService(descriptor) {
    const service = this.dependencies.registerService(descriptor);
    this.telemetry.emit('DEPENDENCY_REGISTERED', { serviceId: service.serviceId, dependencies: service.dependencies });
    return service;
  }

  setServiceAvailability(serviceId, available, options = {}) {
    const service = this.dependencies.setAvailability(serviceId, available, options);
    this.telemetry.emit('DEPENDENCY_AVAILABILITY', { serviceId, available: service.available, degraded: service.degraded });
    return service;
  }

  registerEventType(descriptor) {
    const type = this.eventTypes.register(descriptor);
    this.telemetry.emit('EVENT_TYPE_REGISTERED', { eventType: type.eventType, schemaVersion: type.schemaVersion, producer: type.producer });
    return type;
  }

  submit(obligation, { units = [{ id: `${obligation.taskId ?? obligation.dedupeKey ?? obligation.taskType}:unit:0`, payload: null }], execute, validate = null, commit = null } = {}) {
    if (typeof execute !== 'function') throw new TypeError('submit requires an execute function');
    const admission = this.lifecycle.create(obligation);
    if (!admission.accepted) {
      const signal = admission.reason === 'dependency-cycle' ? 'DEPENDENCY_CYCLE_REJECTED' : 'BACKPRESSURE_REJECTED';
      this.telemetry.emit(signal, { taskType: obligation.taskType, layer: obligation.layer, reason: admission.reason, cycle: admission.cycle ?? null });
      return admission;
    }
    const taskId = admission.task.taskId;
    this.telemetry.emit(admission.deduped ? 'OBLIGATION_DEDUPED' : admission.coalesced ? 'OBLIGATION_COALESCED' : 'OBLIGATION_ADMITTED', {
      taskId, taskType: admission.task.taskType, owner: admission.task.owner,
      producerId: admission.task.producerId, cause: admission.task.cause,
    });
    if (admission.coalesced) {
      this.batch.append(taskId, units);
      return admission;
    }
    if (!admission.deduped) {
      this.batch.prepare(taskId, units, { batchPolicy: admission.task.batchHint ?? {} });
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

  cancelTask(taskId, reason = 'cancelled') {
    const record = this.ledger.get(taskId);
    if (!record) return false;
    if ([LIFECYCLE_STATUS.SATISFIED, LIFECYCLE_STATUS.SUPERSEDED, LIFECYCLE_STATUS.CANCELLED].includes(record.lifecycleStatus)) return false;
    this.scheduler.remove(taskId);
    if ([EXECUTION_STATUS.ACTIVE, EXECUTION_STATUS.YIELDING].includes(record.executionStatus)) this.ledger.requestYield(taskId);
    this.lifecycle.cancel(taskId, reason);
    if (!this.active.has(taskId)) this.ledger.setExecution(taskId, EXECUTION_STATUS.FAILED, reason);
    this.telemetry.emit('WORK_CANCELLED', { taskId, reason });
    return true;
  }

  publishResultReady(envelope) {
    const safe = structuredClone({ ...envelope, authorityGranted: false, canonicalMutation: false, settlementPerformed: false });
    this.telemetry.emit('RUNTIME_RESULT_READY', safe);
    if (this.resultSink) {
      try {
        const value = this.resultSink(safe);
        if (value?.catch) value.catch((error) => this.telemetry.emit('RESULT_SINK_FAILED', { taskId: safe.taskId ?? null, message: error?.message ?? String(error) }));
      } catch (error) {
        this.telemetry.emit('RESULT_SINK_FAILED', { taskId: safe.taskId ?? null, message: error?.message ?? String(error) });
      }
    }
    return safe;
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

  resumeParked() {
    let resumed = 0;
    for (const record of this.ledger.list()) {
      if (record.executionStatus === EXECUTION_STATUS.PARKED && record.lifecycleStatus === LIFECYCLE_STATUS.ELIGIBLE && !record.supersession?.requested) {
        this.ledger.clearYield(record.taskId);
        this.ledger.setExecution(record.taskId, EXECUTION_STATUS.QUEUED, 'resume-eligible');
        this.scheduler.enqueue(record.taskId);
        this.resumePending.add(record.taskId);
        resumed += 1;
      }
    }
    return resumed;
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
      this.telemetry.emit('WORK_YIELD_REQUESTED', { taskId, reason: 'foreground-demand', runtimeClass: record.obligation.runtimeClass });
      this.telemetry.emit('WORK_YIELDING', { taskId, reason: 'foreground-demand', runtimeClass: record.obligation.runtimeClass });
      this.events.emit(EVENT_TYPES.WORK_YIELD_REQUESTED, { reason: 'foreground-demand' }, this.#eventMeta(taskId));
    }
    this.#emitResourceTelemetry();
    return yieldTaskIds;
  }

  completeGeneration(meta = {}) {
    this.governor.completeGeneration();
    this.events.emit(EVENT_TYPES.GENERATION_COMPLETED, {}, meta);
    this.resumeParked();
    this.#emitQueueTelemetry();
  }

  async runCycle(signals = {}) {
    const waitForTaskIds = signals.waitForTaskIds == null ? null : new Set(signals.waitForTaskIds);
    const executionSignals = { ...signals };
    delete executionSignals.waitForTaskIds;
    this.scheduler.tick();
    this.#dispatchAvailable();
    for (const assignment of this.active.values()) {
      if (this.inflight.has(assignment.taskId)) continue;
      let run;
      run = this.#runAssignment(assignment, executionSignals)
        .catch((error) => {
          this.telemetry.emit('RUNTIME_ASSIGNMENT_FAILED', { taskId: assignment.taskId, message: error?.message ?? String(error) });
          this.#releaseAssignment(assignment.taskId);
          return { taskId: assignment.taskId, status: 'runtime-failed', error };
        })
        .finally(() => {
          if (this.inflight.get(assignment.taskId) === run) this.inflight.delete(assignment.taskId);
        });
      this.inflight.set(assignment.taskId, run);
    }
    const runs = [...this.inflight.entries()]
      .filter(([taskId]) => waitForTaskIds == null || waitForTaskIds.has(taskId))
      .map(([, promise]) => promise);
    const results = runs.length ? await Promise.all(runs) : [];
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
      lifecycle: this.ledger.list().map((record) => ({
        taskId: record.taskId,
        lifecycleStatus: record.lifecycleStatus,
        executionStatus: record.executionStatus,
        layer: record.obligation.layer,
        owner: record.obligation.owner,
        taskType: record.obligation.taskType,
        producerId: record.obligation.producerId ?? null,
        cause: structuredClone(record.obligation.cause ?? null),
        why: record.executionReason ?? record.lifecycleReason ?? null,
        degradation: structuredClone(record.degradation),
      })),
      queueDepth: this.scheduler.depthByLayer(),
      resources: this.governor.snapshot(),
      workers: this.registry.snapshot(),
      dependencies: this.dependencies.snapshot(),
      eventTypes: this.eventTypes.list(),
      telemetry: this.telemetry.snapshot(),
    };
  }

  explainObligation(taskId) {
    const record = this.ledger.get(taskId);
    if (!record) return null;
    const signals = this.telemetry.list().filter((signal) => signal.taskId === taskId);
    const communications = signals.flatMap((signal) => {
      if (signal.type === 'OBLIGATION_ADMITTED') return [{ from: record.obligation.owner, to: 'Runtime', action: 'OBLIGATION_ADMITTED', sequence: signal.sequence }];
      if (signal.type === 'WORK_STARTED' || signal.type === 'WORK_RESUMED') return [{ from: 'Runtime', to: signal.workerId, action: signal.type, sequence: signal.sequence }];
      return [];
    });
    if (!communications.some((item) => item.action === 'OBLIGATION_ADMITTED')) {
      communications.unshift({ from: record.obligation.owner, to: 'Runtime', action: 'OBLIGATION_ADMITTED', sequence: record.createdSequence });
    }
    if (record.startedCount > 0 && record.negotiation?.workerId && !communications.some((item) => item.to === record.negotiation.workerId)) {
      communications.push({ from: 'Runtime', to: record.negotiation.workerId, action: 'WORK_STARTED', sequence: record.updatedSequence });
    }
    return {
      taskId, taskType: record.obligation.taskType, owner: record.obligation.owner,
      producerId: record.obligation.producerId ?? null, cause: structuredClone(record.obligation.cause ?? null),
      lifecycleStatus: record.lifecycleStatus, executionStatus: record.executionStatus,
      why: record.executionReason ?? record.lifecycleReason ?? (record.lifecycleStatus === LIFECYCLE_STATUS.SATISFIED ? 'completed-and-satisfied' : null),
      dependencies: record.dependencies.map((id) => ({ taskId: id, lifecycleStatus: this.ledger.get(id)?.lifecycleStatus ?? 'MISSING' })),
      sourceRevisionIds: [...(record.obligation.sourceRevisionIds ?? [])],
      completedSlices: record.batch?.completedSliceIds?.length ?? 0,
      resultReceiptCount: record.resultReceipts.length,
      communications,
    };
  }

  #dispatchAvailable() {
    while (true) {
      const next = this.scheduler.next();
      if (!next) break;
      const { record, worker, negotiation } = next;
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
      this.active.set(record.taskId, { taskId: record.taskId, workerId: worker.workerId, worker, lease, executor, negotiation });
      const eventType = resumed ? EVENT_TYPES.WORK_RESUMED : EVENT_TYPES.WORK_STARTED;
      this.events.emit(eventType, { workerId: worker.workerId }, this.#eventMeta(record.taskId));
      this.telemetry.emit(eventType, {
        taskId: record.taskId,
        workerId: worker.workerId,
        layer: record.obligation.layer,
        runtimeClass: record.obligation.runtimeClass,
        resultContract: structuredClone(record.obligation.resultContract ?? null),
      degraded: record.degradation?.degraded ?? false,
      });
      if (record.obligation.runtimeClass === 'DEEP') this.telemetry.emit('DEEP_ACTIVE', { taskId: record.taskId, workerId: worker.workerId });
      if (record.obligation.runtimeClass === 'SLEEP') this.telemetry.emit('SLEEP_ACTIVE', { taskId: record.taskId, workerId: worker.workerId });
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
      { worker: assignment.worker, lease: assignment.lease, signal: signals.signal ?? null },
    );

    if (outcome.status === 'complete') {
      this.#completeTask(assignment.taskId);
    } else if (outcome.status === 'yield') {
      this.#parkTask(assignment.taskId);
    } else if (outcome.status === 'stale' || outcome.status === 'superseded-after-checkpoint') {
      const latest = this.ledger.get(assignment.taskId);
      if ([LIFECYCLE_STATUS.PENDING, LIFECYCLE_STATUS.ELIGIBLE].includes(latest?.lifecycleStatus)) this.lifecycle.supersede(assignment.taskId, 'superseded-during-execution');
      this.#releaseAssignment(assignment.taskId);
      this.telemetry.emit('STALE_RESULT_DROPPED', { taskId: assignment.taskId, status: outcome.status });
    } else if (outcome.status === 'commit-uncertain') {
      this.#releaseAssignment(assignment.taskId);
      this.telemetry.emit('WORK_RECOVERING', { taskId: assignment.taskId, recoveryState: 'commit-reconciliation-required' });
      this.events.emit(EVENT_TYPES.WORK_RECOVERING, { recoveryState: 'commit-reconciliation-required' }, this.#eventMeta(assignment.taskId));
    } else if (outcome.status?.startsWith('failed')) {
      const latest = this.ledger.get(assignment.taskId);
      const code = outcome.error?.code ?? outcome.status;
      this.#releaseAssignment(assignment.taskId);
      if (code === 'PROVIDER_UNAVAILABLE') {
        this.registry.setAvailability(assignment.workerId, false);
        this.telemetry.emit('CAPABILITY_PROVIDER_AVAILABILITY', { workerId: assignment.workerId, available: false, reason: code });
      } else if (['PROVIDER_TIMEOUT', 'MALFORMED_OUTPUT', 'PROVIDER_FAILURE'].includes(code)) {
        this.registry.setHealth(assignment.workerId, 'degraded');
        this.telemetry.emit('CAPABILITY_PROVIDER_HEALTH', { workerId: assignment.workerId, health: 'degraded', reason: code });
      }
      if (code === 'PROVIDER_ABORTED' || latest.lifecycleStatus === LIFECYCLE_STATUS.CANCELLED) {
        this.ledger.setExecution(assignment.taskId, EXECUTION_STATUS.FAILED, code);
      } else if (latest.retryState.attempts < this.maxRetries && latest.lifecycleStatus === LIFECYCLE_STATUS.ELIGIBLE) {
        this.ledger.setExecution(assignment.taskId, EXECUTION_STATUS.RECOVERING, outcome.status);
        this.ledger.setExecution(assignment.taskId, EXECUTION_STATUS.QUEUED, 'retry');
        this.scheduler.enqueue(assignment.taskId);
      } else {
        this.ledger.setExecution(assignment.taskId, EXECUTION_STATUS.FAILED, outcome.status);
        this.publishResultReady(this.#failureEnvelope(latest, outcome, assignment));
      }
    }
    return { taskId: assignment.taskId, ...outcome };
  }

  #parkTask(taskId) {
    this.ledger.setExecution(taskId, EXECUTION_STATUS.PARKED, 'safe-yield-boundary');
    this.#releaseAssignment(taskId);
    const record = this.ledger.get(taskId);
    this.telemetry.emit('WORK_PARKED', { taskId, checkpoint: record.checkpoint, runtimeClass: record.obligation.runtimeClass });
    this.events.emit(EVENT_TYPES.WORK_PARKED, { checkpoint: record.checkpoint }, this.#eventMeta(taskId));
  }

  #completeTask(taskId) {
    const before = this.ledger.get(taskId);
    this.ledger.setExecution(taskId, EXECUTION_STATUS.COMPLETE);
    this.lifecycle.satisfy(taskId);
    this.#releaseAssignment(taskId);
    const envelope = this.#completionEnvelope(before);
    this.telemetry.emit('WORK_COMPLETED', { taskId, runtimeClass: before.obligation.runtimeClass });
    this.publishResultReady(envelope);
    this.events.emit(EVENT_TYPES.WORK_COMPLETED, {}, this.#eventMeta(taskId));
  }

  #completionEnvelope(record) {
    const payload = record.obligation.payload ?? {};
    const turnId = payload.turnId ?? null;
    const late = Boolean(turnId && this.isTurnSealed(turnId));
    const receipt = record.resultReceipts.at(-1)?.external ?? null;
    const providerProvenance = receipt?.providerExecution ?? (record.negotiation ? {
      workerId: record.negotiation.workerId ?? null,
      providerId: record.negotiation.provider ?? null,
      implementationId: record.negotiation.implementationId ?? null,
      modelId: null,
    } : null);
    return {
      taskId: record.taskId,
      taskType: record.obligation.taskType,
      owner: record.obligation.owner,
      producerId: record.obligation.producerId,
      runtimeClass: record.obligation.runtimeClass,
      turnId,
      correlationId: payload.correlationId ?? null,
      causationId: payload.causationId ?? null,
      sourceRevisions: structuredClone(record.obligation.sourceRevisions ?? {}),
      sourceRevisionIds: [...(record.obligation.sourceRevisionIds ?? [])],
      worldRevision: record.obligation.worldRevision ?? null,
      sceneRevision: record.obligation.sceneRevision ?? null,
      characterStateRevision: payload.characterStateRevision ?? null,
      freshnessToken: payload.freshnessToken ?? null,
      resultClass: payload.resultClass ?? record.obligation.resultContract?.resultClass ?? null,
      requestedDestination: record.obligation.resultContract?.requestedDestination ?? null,
      resultContract: structuredClone(record.obligation.resultContract ?? null),
      executionOutcome: 'COMPLETED',
      providerProvenance: structuredClone(providerProvenance),
      opaqueResult: structuredClone(receipt?.output ?? null),
      validation: structuredClone(receipt?.validation ?? null),
      degraded: record.degradation?.degraded ?? false,
      fallback: record.degradation?.fallbackUsed ?? false,
      late,
      lateState: late ? 'AFTER_SEAL' : 'ON_TIME',
      timing: { completedSequence: this.ledger.sequence, completedAt: Date.now(), afterSeal: late, providerLatencyMs: receipt?.latencyMs ?? null },
      resultReceiptCount: record.resultReceipts.length,
      authorityGranted: false,
      canonicalMutation: false,
      settlementPerformed: false,
    };
  }

  #failureEnvelope(record, outcome, assignment) {
    const payload = record.obligation.payload ?? {};
    const turnId = payload.turnId ?? null;
    const late = Boolean(turnId && this.isTurnSealed(turnId));
    return {
      taskId: record.taskId,
      taskType: record.obligation.taskType,
      owner: record.obligation.owner,
      producerId: record.obligation.producerId,
      runtimeClass: record.obligation.runtimeClass,
      turnId,
      correlationId: payload.correlationId ?? null,
      causationId: payload.causationId ?? null,
      sourceRevisions: structuredClone(record.obligation.sourceRevisions ?? {}),
      sourceRevisionIds: [...(record.obligation.sourceRevisionIds ?? [])],
      worldRevision: record.obligation.worldRevision ?? null,
      sceneRevision: record.obligation.sceneRevision ?? null,
      freshnessToken: payload.freshnessToken ?? null,
      resultClass: payload.resultClass ?? record.obligation.resultContract?.resultClass ?? null,
      requestedDestination: record.obligation.resultContract?.requestedDestination ?? null,
      resultContract: structuredClone(record.obligation.resultContract ?? null),
      executionOutcome: 'FAILED',
      providerFailure: { code: outcome.error?.code ?? outcome.status ?? 'PROVIDER_FAILURE', message: outcome.error?.message ?? String(outcome.status ?? 'provider failure'), retryable: Boolean(outcome.retryable) },
      providerProvenance: { workerId: assignment.workerId, providerId: assignment.worker?.provider ?? null, implementationId: assignment.worker?.implementationId ?? null, modelId: assignment.worker?.model ?? null },
      degraded: true,
      fallback: false,
      late,
      lateState: late ? 'AFTER_SEAL' : 'ON_TIME',
      timing: { completedSequence: this.ledger.sequence, completedAt: Date.now(), afterSeal: late },
      authorityGranted: false,
      canonicalMutation: false,
      settlementPerformed: false,
    };
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
      } else if (record.lifecycleStatus === LIFECYCLE_STATUS.ELIGIBLE && [EXECUTION_STATUS.QUEUED, EXECUTION_STATUS.BLOCKED].includes(record.executionStatus)) {
        this.scheduler.enqueue(record.taskId);
      }
    }
  }

  #eventMeta(taskId) {
    const record = this.ledger.get(taskId);
    return {
      taskId,
      producer: 'RUNTIME_CORE',
      sourceRevisions: record?.obligation.sourceRevisions ?? {},
      revisionFences: {
        sourceRevisionIds: record?.obligation.sourceRevisionIds ?? [],
        worldRevision: record?.obligation.worldRevision ?? null,
        sceneRevision: record?.obligation.sceneRevision ?? null,
      },
      worldRevision: record?.obligation.worldRevision ?? null,
      sceneRevision: record?.obligation.sceneRevision ?? null,
      correlationId: record?.obligation.payload?.correlationId ?? null,
      causationId: record?.obligation.payload?.causationId ?? null,
      turnId: record?.obligation.payload?.turnId ?? null,
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
