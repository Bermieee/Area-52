import { clamp } from './utils.js';

export class AdaptiveBatchSizer {
  constructor({ min = 1, max = 32, base = 4, targetSliceMs = 25 } = {}) {
    this.min = min;
    this.max = max;
    this.base = clamp(base, min, max);
    this.targetSliceMs = targetSliceMs;
  }

  choose(signals = {}) {
    let size = this.base;
    if (signals.foregroundDemand) size = Math.ceil(size / 2);
    if ((signals.resourcePressure ?? 0) >= 0.75) size = Math.ceil(size / 2);
    if ((signals.historicalSliceMs ?? 0) > (signals.targetSliceMs ?? this.targetSliceMs)) size = Math.ceil(size / 2);
    if ((signals.queueDepth ?? 0) > 50 && !signals.foregroundDemand && (signals.resourcePressure ?? 0) < 0.5) size *= 2;
    if (signals.deadlineNear && !signals.foregroundDemand) size *= 2;
    return clamp(Math.max(1, Math.floor(size)), this.min, this.max);
  }
}

export class BatchEngine {
  constructor({ ledger, telemetry, sizer = new AdaptiveBatchSizer() } = {}) {
    this.ledger = ledger;
    this.telemetry = telemetry;
    this.sizer = sizer;
  }

  prepare(taskId, units, { batchId = `batch:${taskId}`, batchPolicy = {} } = {}) {
    const normalized = units.map((unit, index) => ({
      id: unit?.id ?? `${taskId}:unit:${String(index).padStart(6, '0')}`,
      payload: unit?.payload ?? unit,
    }));
    this.ledger.ensureBatch(taskId, {
      batchId,
      units: normalized,
      adaptiveBatchSize: this.sizer.base,
      batchPolicy,
    });
    return this.ledger.get(taskId).batch;
  }

  append(taskId, units) {
    const normalized = units.map((unit, index) => ({
      id: unit?.id ?? `${taskId}:appended:${String(index).padStart(6, '0')}`,
      payload: unit?.payload ?? unit,
    }));
    this.ledger.appendBatchUnits(taskId, normalized);
  }

  async runOneSlice(taskId, executor, signals = {}, freshnessCheck = () => true) {
    const record = this.ledger.get(taskId);
    if (record.recoveryState === 'commit-reconciliation-required') {
      return { status: 'blocked', reason: 'commit-reconciliation-required' };
    }
    const pending = this.ledger.pendingUnits(taskId);
    if (!pending.length) return { status: 'complete' };

    const adaptive = this.sizer.choose({
      ...signals,
      historicalSliceMs: signals.historicalSliceMs ?? record.batch?.lastSliceDurationMs ?? 0,
      targetSliceMs: record.obligation.yieldPolicy?.maxUninterruptedSliceMs ?? signals.targetSliceMs,
    });
    const maxSliceUnits = Number(record.obligation.batchHint?.maxSliceUnits ?? Number.POSITIVE_INFINITY);
    const maxCheckpointUnits = Number(record.obligation.checkpointPolicy?.maxUnitsPerCheckpoint ?? Number.POSITIVE_INFINITY);
    const size = Math.max(1, Math.min(adaptive, maxSliceUnits, maxCheckpointUnits));
    record.batch.adaptiveBatchSize = size;
    const units = pending.slice(0, size);
    const sliceId = `${record.batch.batchId}:${units.map((unit) => unit.id).join('+')}`;
    if (this.ledger.isSliceCommitted(taskId, sliceId)) return { status: 'already-committed', sliceId };

    this.ledger.startSlice(taskId, { sliceId, unitIds: units.map((unit) => unit.id), size });
    let output;
    const started = Date.now();
    try {
      output = await executor.execute({ task: record.obligation, units, sliceId });
    } catch (error) {
      this.ledger.failSlice(taskId, sliceId, error);
      return { status: 'failed', error, sliceId, retryable: true };
    }

    let valid = true;
    try {
      valid = executor.validate ? await executor.validate({ task: record.obligation, units, output, sliceId }) : true;
    } catch (error) {
      this.ledger.failSlice(taskId, sliceId, error, { validation: true });
      return { status: 'failed-validation', error, sliceId, retryable: true };
    }
    if (!valid) {
      const error = new Error(`Validation failed for ${sliceId}`);
      this.ledger.failSlice(taskId, sliceId, error, { validation: true });
      return { status: 'failed-validation', error, sliceId, retryable: true };
    }
    this.ledger.markSliceValidated(taskId, sliceId);

    if (!freshnessCheck(taskId)) {
      this.ledger.discardStaleSlice(taskId, sliceId);
      return { status: 'stale', sliceId };
    }

    const idempotencyKey = `${taskId}:${sliceId}`;
    this.ledger.prepareCommit(taskId, sliceId, idempotencyKey);
    let receipt = { idempotencyKey, committed: true };
    try {
      if (executor.commit) {
        const externalReceipt = await executor.commit({ task: record.obligation, units, output, sliceId, idempotencyKey });
        if (externalReceipt != null) receipt = { ...receipt, external: externalReceipt };
      }
    } catch (error) {
      this.ledger.markCommitUncertain(taskId, sliceId, error);
      return { status: 'commit-uncertain', error, sliceId, retryable: false };
    }
    this.ledger.commitSlice(taskId, { sliceId, unitIds: units.map((unit) => unit.id), receipt });
    const durationMs = Math.max(0, Date.now() - started);
    this.ledger.recordSliceDuration(taskId, durationMs);
    this.telemetry?.emit('BATCH_CHECKPOINT', {
      taskId,
      sliceId,
      completedUnits: this.ledger.get(taskId).batch.completedUnitIds.length,
      totalUnits: this.ledger.get(taskId).batch.units.length,
      durationMs,
      adaptiveBatchSize: size,
    });

    const after = this.ledger.get(taskId);
    if (after.supersession?.requested) return { status: 'superseded-after-checkpoint', sliceId };
    if (after.yieldRequested) return { status: 'yield', sliceId };
    if (this.ledger.isComplete(taskId)) return { status: 'complete', sliceId };
    return { status: 'progress', sliceId, durationMs };
  }
}
