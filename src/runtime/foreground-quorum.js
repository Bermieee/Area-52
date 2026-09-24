import { EXECUTION_STATUS, LIFECYCLE_STATUS } from './constants.js';

export const RuntimeResultClass = Object.freeze({
  REQUIRED: 'REQUIRED',
  OPPORTUNISTIC: 'OPPORTUNISTIC',
  DEFERRED: 'DEFERRED',
});

const TERMINAL_LIFECYCLE = new Set([
  LIFECYCLE_STATUS.SATISFIED,
  LIFECYCLE_STATUS.SUPERSEDED,
  LIFECYCLE_STATUS.CANCELLED,
]);

function deadline(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : Number.POSITIVE_INFINITY;
}

function fallbackFor(record) {
  const payload = record?.obligation?.payload ?? {};
  const direct = payload.deterministicFallback;
  if (direct != null) return structuredClone(direct);
  const policy = payload.fallbackPolicy;
  if (policy?.type === 'DETERMINISTIC') {
    return structuredClone(policy.result ?? policy.payload ?? { status: 'UNRESOLVED', reason: 'deterministic-fallback' });
  }
  return null;
}

export class ForegroundQuorumController {
  constructor({ director, now = () => Date.now() } = {}) {
    if (!director) throw new TypeError('ForegroundQuorumController requires a WorkerDirector');
    this.director = director;
    this.now = now;
    this.closed = new Map();
    this.fallbacks = new Map();
  }

  async awaitTurn(cohort, { maxCycles = 256 } = {}) {
    if (!cohort?.turnId) throw new TypeError('foreground cohort requires turnId');
    const prior = this.closed.get(cohort.turnId);
    if (prior) return structuredClone(prior);
    const requiredIds = [...(cohort.required ?? [])];
    let cycles = 0;

    while (cycles < maxCycles) {
      const before = this.#fingerprint(requiredIds);
      await this.director.runCycle({ waitForTaskIds: requiredIds });
      cycles += 1;
      const evaluation = this.#evaluateRequired(requiredIds);
      if (evaluation.done) return this.#close(cohort, cycles, evaluation);
      const after = this.#fingerprint(requiredIds);
      if (before === after && !this.#hasActive(requiredIds)) {
        for (const taskId of evaluation.pending) this.#applyFallbackOrDegraded(taskId, 'NO_EXECUTION_PROGRESS');
        return this.#close(cohort, cycles, this.#evaluateRequired(requiredIds));
      }
    }

    for (const taskId of requiredIds) {
      const record = this.director.ledger.get(taskId);
      if (record?.lifecycleStatus !== LIFECYCLE_STATUS.SATISFIED && !this.fallbacks.has(taskId)) {
        this.#applyFallbackOrDegraded(taskId, 'QUORUM_CYCLE_BUDGET_EXHAUSTED');
      }
    }
    return this.#close(cohort, cycles, this.#evaluateRequired(requiredIds));
  }

  snapshot(turnId) {
    const value = this.closed.get(turnId);
    return value ? structuredClone(value) : null;
  }

  #evaluateRequired(requiredIds) {
    const now = this.now();
    const pending = [];
    const satisfied = [];
    const fallback = [];
    for (const taskId of requiredIds) {
      if (this.fallbacks.has(taskId)) {
        fallback.push(taskId);
        continue;
      }
      const record = this.director.ledger.get(taskId);
      if (!record) {
        this.#applyFallbackOrDegraded(taskId, 'MISSING_RUNTIME_OBLIGATION');
        fallback.push(taskId);
        continue;
      }
      if (record.lifecycleStatus === LIFECYCLE_STATUS.SATISFIED || record.executionStatus === EXECUTION_STATUS.COMPLETE) {
        satisfied.push(taskId);
        continue;
      }
      const payload = record.obligation.payload ?? {};
      const soft = deadline(payload.softDeadline);
      const hard = deadline(payload.hardDeadline ?? record.obligation.deadline);
      const blockedOrFailed = [EXECUTION_STATUS.BLOCKED, EXECUTION_STATUS.FAILED].includes(record.executionStatus);
      if (now >= hard) {
        this.#applyFallbackOrDegraded(taskId, 'HARD_DEADLINE_EXPIRED');
        fallback.push(taskId);
        continue;
      }
      if (blockedOrFailed && fallbackFor(record) != null && now >= soft) {
        this.#applyFallbackOrDegraded(taskId, 'SOFT_DEADLINE_FALLBACK');
        fallback.push(taskId);
        continue;
      }
      if (blockedOrFailed && /no-compatible-provider-or-resource/.test(record.executionReason ?? '')) {
        this.#applyFallbackOrDegraded(taskId, 'NO_ELIGIBLE_EXECUTION_RESOURCE');
        fallback.push(taskId);
        continue;
      }
      if (TERMINAL_LIFECYCLE.has(record.lifecycleStatus)) {
        this.#applyFallbackOrDegraded(taskId, `TERMINAL_${record.lifecycleStatus}`);
        fallback.push(taskId);
        continue;
      }
      pending.push(taskId);
    }
    return { done: pending.length === 0, pending, satisfied, fallback };
  }

  #applyFallbackOrDegraded(taskId, reason) {
    if (this.fallbacks.has(taskId)) return this.fallbacks.get(taskId);
    const record = this.director.ledger.get(taskId);
    const deterministic = fallbackFor(record);
    const payload = record?.obligation?.payload ?? {};
    const turnId = payload.turnId ?? null;
    const late = Boolean(turnId && this.director.isTurnSealed(turnId));
    const fallback = {
      taskId,
      taskType: record?.obligation?.taskType ?? null,
      owner: record?.obligation?.owner ?? null,
      producerId: record?.obligation?.producerId ?? null,
      runtimeClass: record?.obligation?.runtimeClass ?? 'NATIVE_COGNITIVE',
      turnId,
      correlationId: payload.correlationId ?? null,
      causationId: payload.causationId ?? null,
      sourceRevisions: structuredClone(record?.obligation?.sourceRevisions ?? {}),
      sourceRevisionIds: [...(record?.obligation?.sourceRevisionIds ?? [])],
      worldRevision: record?.obligation?.worldRevision ?? null,
      sceneRevision: record?.obligation?.sceneRevision ?? null,
      freshnessToken: payload.freshnessToken ?? null,
      resultClass: payload.resultClass ?? RuntimeResultClass.REQUIRED,
      requestedDestination: record?.obligation?.resultContract?.requestedDestination ?? null,
      resultContract: structuredClone(record?.obligation?.resultContract ?? null),
      executionOutcome: deterministic == null ? 'DEGRADED' : 'FALLBACK',
      fallback: deterministic != null,
      fallbackState: { reason, deterministic: deterministic != null },
      degraded: true,
      late,
      lateState: late ? 'AFTER_SEAL' : 'ON_TIME',
      opaqueResult: deterministic,
      providerProvenance: null,
      authorityGranted: false,
      canonicalMutation: false,
      settlementPerformed: false,
    };
    this.fallbacks.set(taskId, fallback);
    this.director.telemetry.emit('REQUIRED_FALLBACK_APPLIED', { taskId, reason, deterministic: deterministic != null });
    this.director.publishResultReady(fallback);
    return fallback;
  }

  #close(cohort, cycles, evaluation) {
    const opportunisticReady = [...(cohort.opportunistic ?? [])].filter((taskId) => {
      const record = this.director.ledger.get(taskId);
      return record?.lifecycleStatus === LIFECYCLE_STATUS.SATISFIED || record?.executionStatus === EXECUTION_STATUS.COMPLETE;
    });
    const snapshot = {
      kind: 'RuntimeForegroundQuorum',
      turnId: cohort.turnId,
      correlationId: cohort.correlationId ?? null,
      closed: true,
      cycles,
      required: [...(cohort.required ?? [])],
      requiredSatisfied: [...evaluation.satisfied],
      requiredFallback: [...evaluation.fallback],
      opportunisticReady,
      opportunisticPending: [...(cohort.opportunistic ?? [])].filter((taskId) => !opportunisticReady.includes(taskId)),
      deferred: [...(cohort.deferred ?? [])],
      authorityGranted: false,
      settlementPerformed: false,
    };
    this.closed.set(cohort.turnId, snapshot);
    this.director.telemetry.emit('FOREGROUND_QUORUM_CLOSED', {
      turnId: cohort.turnId,
      required: snapshot.required.length,
      requiredFallback: snapshot.requiredFallback.length,
      opportunisticReady: snapshot.opportunisticReady.length,
      opportunisticPending: snapshot.opportunisticPending.length,
      deferred: snapshot.deferred.length,
      cycles,
    });
    return structuredClone(snapshot);
  }

  #hasActive(taskIds) {
    return taskIds.some((taskId) => this.director.active?.has(taskId) || this.director.inflight?.has(taskId));
  }

  #fingerprint(taskIds) {
    return taskIds.map((taskId) => {
      const record = this.director.ledger.get(taskId);
      return `${taskId}:${record?.lifecycleStatus ?? 'missing'}:${record?.executionStatus ?? 'missing'}:${record?.retryState?.attempts ?? 0}:${record?.updatedSequence ?? 0}:${this.fallbacks.has(taskId)}`;
    }).join('|');
  }
}
