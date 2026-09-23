import { EXECUTION_STATUS, LIFECYCLE_STATUS } from './constants.js';
import { deepClone } from './utils.js';

const SNAPSHOT_VERSION = 1;

export class WorkLedger {
  constructor({ persistence } = {}) {
    this.persistence = persistence;
    const snapshot = persistence?.load?.();
    this.sequence = snapshot?.sequence ?? 0;
    this.records = new Map((snapshot?.records ?? []).map((record) => [record.taskId, record]));
    this.#markInterruptedWorkForRecovery();
    this.flush();
  }

  #markInterruptedWorkForRecovery() {
    for (const record of this.records.values()) {
      if ([EXECUTION_STATUS.ACTIVE, EXECUTION_STATUS.YIELDING].includes(record.executionStatus)) {
        record.executionStatus = EXECUTION_STATUS.RECOVERING;
        record.recoveryState = record.batch?.activeSlice?.phase === 'COMMITTING'
          ? 'commit-reconciliation-required'
          : 'checkpoint-resume-required';
        record.updatedSequence = ++this.sequence;
      }
    }
  }

  flush() {
    this.persistence?.save?.(this.snapshot());
  }

  snapshot() {
    return deepClone({
      version: SNAPSHOT_VERSION,
      sequence: this.sequence,
      records: [...this.records.values()],
    });
  }

  createTask(obligation) {
    if (this.records.has(obligation.taskId)) return this.records.get(obligation.taskId);
    const sequence = ++this.sequence;
    const record = {
      taskId: obligation.taskId,
      obligation: deepClone(obligation),
      lifecycleStatus: obligation.lifecycleStatus ?? LIFECYCLE_STATUS.PENDING,
      executionStatus: EXECUTION_STATUS.QUEUED,
      executionReason: null,
      dependencies: [...(obligation.dependencies ?? [])],
      batch: null,
      checkpoint: null,
      resultReceipts: [],
      retryState: { attempts: 0, failures: [] },
      recoveryState: null,
      supersession: null,
      yieldRequested: false,
      startedCount: 0,
      resumeCount: 0,
      createdSequence: sequence,
      updatedSequence: sequence,
    };
    this.records.set(obligation.taskId, record);
    this.flush();
    return record;
  }

  get(taskId) {
    return this.records.get(taskId) ?? null;
  }

  list() {
    return [...this.records.values()];
  }

  updateObligation(taskId, patch) {
    const record = this.#required(taskId);
    record.obligation = { ...record.obligation, ...deepClone(patch) };
    record.updatedSequence = ++this.sequence;
    this.flush();
    return record;
  }

  setLifecycle(taskId, lifecycleStatus, reason = null) {
    const record = this.#required(taskId);
    record.lifecycleStatus = lifecycleStatus;
    record.obligation.lifecycleStatus = lifecycleStatus;
    if (reason) record.lifecycleReason = reason;
    record.updatedSequence = ++this.sequence;
    this.flush();
    return record;
  }

  setExecution(taskId, executionStatus, reason = null) {
    const record = this.#required(taskId);
    record.executionStatus = executionStatus;
    record.executionReason = reason;
    if (executionStatus === EXECUTION_STATUS.ACTIVE) record.startedCount += 1;
    if (executionStatus === EXECUTION_STATUS.RECOVERING) record.recoveryState ??= 'checkpoint-resume-required';
    record.updatedSequence = ++this.sequence;
    this.flush();
    return record;
  }

  ensureBatch(taskId, { batchId, units, adaptiveBatchSize = 1, batchPolicy = {} }) {
    const record = this.#required(taskId);
    if (!record.batch) {
      record.batch = {
        batchId,
        units: deepClone(units),
        completedUnitIds: [],
        completedSliceIds: [],
        activeSlice: null,
        adaptiveBatchSize,
        batchPolicy: deepClone(batchPolicy),
        retryState: {},
        validationState: null,
      };
      record.updatedSequence = ++this.sequence;
      this.flush();
    }
    return record.batch;
  }

  appendBatchUnits(taskId, units) {
    const record = this.#required(taskId);
    if (!record.batch) throw new Error(`Task ${taskId} has no batch`);
    const existing = new Set(record.batch.units.map((unit) => unit.id));
    for (const unit of units) {
      if (!existing.has(unit.id)) {
        record.batch.units.push(deepClone(unit));
        existing.add(unit.id);
      }
    }
    record.updatedSequence = ++this.sequence;
    this.flush();
  }

  startSlice(taskId, slice) {
    const record = this.#required(taskId);
    record.batch.activeSlice = { ...deepClone(slice), phase: 'EXECUTING' };
    record.updatedSequence = ++this.sequence;
    this.flush();
  }

  markSliceValidated(taskId, sliceId) {
    const record = this.#required(taskId);
    this.#assertActiveSlice(record, sliceId);
    record.batch.activeSlice.phase = 'VALIDATED';
    record.batch.validationState = { sliceId, valid: true };
    record.updatedSequence = ++this.sequence;
    this.flush();
  }

  prepareCommit(taskId, sliceId, idempotencyKey) {
    const record = this.#required(taskId);
    this.#assertActiveSlice(record, sliceId);
    record.batch.activeSlice.phase = 'COMMITTING';
    record.batch.activeSlice.idempotencyKey = idempotencyKey;
    record.updatedSequence = ++this.sequence;
    this.flush();
  }

  commitSlice(taskId, { sliceId, unitIds, receipt = null }) {
    const record = this.#required(taskId);
    if (record.batch.completedSliceIds.includes(sliceId)) return false;
    const completedUnits = new Set(record.batch.completedUnitIds);
    for (const unitId of unitIds) completedUnits.add(unitId);
    record.batch.completedUnitIds = [...completedUnits];
    record.batch.completedSliceIds.push(sliceId);
    if (receipt) record.resultReceipts.push(deepClone(receipt));
    record.batch.activeSlice = null;
    record.checkpoint = {
      afterSliceId: sliceId,
      completedUnitIds: [...record.batch.completedUnitIds],
      sequence: ++this.sequence,
    };
    record.recoveryState = null;
    record.updatedSequence = this.sequence;
    this.flush();
    return true;
  }


  markCommitUncertain(taskId, sliceId, error) {
    const record = this.#required(taskId);
    this.#assertActiveSlice(record, sliceId);
    record.executionStatus = EXECUTION_STATUS.RECOVERING;
    record.executionReason = 'commit-reconciliation-required';
    record.recoveryState = 'commit-reconciliation-required';
    record.retryState.attempts += 1;
    record.retryState.failures.push({
      sliceId,
      validation: false,
      commitUncertain: true,
      message: error?.message ?? String(error),
      sequence: ++this.sequence,
    });
    record.updatedSequence = this.sequence;
    this.flush();
  }

  failSlice(taskId, sliceId, error, { validation = false } = {}) {
    const record = this.#required(taskId);
    record.retryState.attempts += 1;
    record.retryState.failures.push({
      sliceId,
      validation,
      message: error?.message ?? String(error),
      sequence: ++this.sequence,
    });
    if (record.batch) {
      record.batch.retryState[sliceId] = (record.batch.retryState[sliceId] ?? 0) + 1;
      record.batch.validationState = validation ? { sliceId, valid: false } : record.batch.validationState;
      record.batch.activeSlice = null;
    }
    record.updatedSequence = this.sequence;
    this.flush();
  }

  discardStaleSlice(taskId, sliceId, reason = 'stale-revision') {
    const record = this.#required(taskId);
    if (record.batch?.activeSlice?.sliceId === sliceId) record.batch.activeSlice = null;
    record.batch.validationState = { sliceId, valid: false, reason };
    record.updatedSequence = ++this.sequence;
    this.flush();
  }

  requestYield(taskId) {
    const record = this.#required(taskId);
    record.yieldRequested = true;
    if (record.executionStatus === EXECUTION_STATUS.ACTIVE) record.executionStatus = EXECUTION_STATUS.YIELDING;
    record.updatedSequence = ++this.sequence;
    this.flush();
  }

  clearYield(taskId) {
    const record = this.#required(taskId);
    record.yieldRequested = false;
    record.updatedSequence = ++this.sequence;
    this.flush();
  }

  requestSupersession(taskId, byTaskId, revision) {
    const record = this.#required(taskId);
    record.supersession = { requested: true, byTaskId, revision };
    record.updatedSequence = ++this.sequence;
    this.flush();
  }

  markRecovered(taskId) {
    const record = this.#required(taskId);
    if (record.recoveryState === 'commit-reconciliation-required') return false;
    record.recoveryState = null;
    record.executionStatus = EXECUTION_STATUS.PARKED;
    record.resumeCount += 1;
    record.updatedSequence = ++this.sequence;
    this.flush();
    return true;
  }

  resolveInDoubtCommit(taskId, { committed, receipt = null } = {}) {
    const record = this.#required(taskId);
    const slice = record.batch?.activeSlice;
    if (record.recoveryState !== 'commit-reconciliation-required' || slice?.phase !== 'COMMITTING') {
      throw new Error(`Task ${taskId} has no in-doubt commit to reconcile`);
    }
    if (committed) {
      this.commitSlice(taskId, { sliceId: slice.sliceId, unitIds: slice.unitIds, receipt });
    } else {
      record.batch.activeSlice = null;
      record.recoveryState = null;
      record.executionStatus = EXECUTION_STATUS.PARKED;
      record.updatedSequence = ++this.sequence;
      this.flush();
    }
  }

  isSliceCommitted(taskId, sliceId) {
    return this.#required(taskId).batch?.completedSliceIds.includes(sliceId) ?? false;
  }

  isComplete(taskId) {
    const record = this.#required(taskId);
    if (!record.batch) return record.executionStatus === EXECUTION_STATUS.COMPLETE;
    return record.batch.completedUnitIds.length >= record.batch.units.length;
  }

  pendingUnits(taskId) {
    const record = this.#required(taskId);
    if (!record.batch) return [];
    const completed = new Set(record.batch.completedUnitIds);
    return record.batch.units.filter((unit) => !completed.has(unit.id));
  }

  #required(taskId) {
    const record = this.records.get(taskId);
    if (!record) throw new Error(`Unknown task: ${taskId}`);
    return record;
  }

  #assertActiveSlice(record, sliceId) {
    if (record.batch?.activeSlice?.sliceId !== sliceId) {
      throw new Error(`Slice ${sliceId} is not active for task ${record.taskId}`);
    }
  }
}
