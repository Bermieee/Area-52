import { FailureCode, ResultClass, ResultStatus, TelemetryEvent } from './constants.js';
import { createWorkerFailure, createWorkerResult } from './contracts.js';
import { GatherCoordinator } from './gather-coordinator.js';
import { toNexusCognitiveResult } from './integration-adapters.js';
import { validateWorkerOutput } from './validation.js';

export class CognitiveSwarm {
  constructor({
    eventHub, planner, executionRouter, resultBus, compiler, contextSeal,
    fallbackResolver = defaultFallbackResolver, telemetry = null,
  } = {}) {
    for (const [name, value] of Object.entries({ eventHub, planner, executionRouter, resultBus, compiler, contextSeal })) {
      if (!value) throw new TypeError(`CognitiveSwarm requires ${name}`);
    }
    this.eventHub = eventHub;
    this.planner = planner;
    this.executionRouter = executionRouter;
    this.resultBus = resultBus;
    this.compiler = compiler;
    this.contextSeal = contextSeal;
    this.fallbackResolver = fallbackResolver;
    this.telemetry = telemetry;
  }

  async run({ turn, plannerInput = {}, semanticValidators = {} } = {}) {
    const published = this.eventHub.publish(turn);
    const turnEvent = published.event;
    this.telemetry?.emit(TelemetryEvent.TURN_EVENT_CREATED, {
      turnId: turnEvent.turnId, correlationId: turnEvent.correlationId, duplicate: published.duplicate,
    });
    const plan = this.planner.plan({ turnEvent, ...plannerInput });
    const gather = new GatherCoordinator({ turnEvent, plan, currentRevisionSet: turnEvent });
    for (const task of plan.tasks) {
      this.telemetry?.emit(TelemetryEvent.TASK_PLANNED, telemetryTask(task));
    }

    const dispatches = plan.tasks.map((task) => {
      this.telemetry?.emit(TelemetryEvent.TASK_STARTED, telemetryTask(task));
      return Promise.resolve()
        .then(() => this.executionRouter.dispatch(task, { attempt: 1, turnEvent }))
        .then((raw) => ({ task, raw, error: null, attempt: 1 }))
        .catch((error) => ({ task, raw: null, error, attempt: 1 }));
    });
    const firstOutcomes = await Promise.all(dispatches);
    const resolved = [];
    const taskTraces = [];

    for (const outcome of firstOutcomes) {
      const next = await this.#resolveOutcome(outcome, turnEvent, semanticValidators[outcome.task.taskType]);
      resolved.push(next);
      taskTraces.push(next.trace);
    }

    resolved.sort((a, b) => (a.result?.completedAt ?? Number.MAX_SAFE_INTEGER) - (b.result?.completedAt ?? Number.MAX_SAFE_INTEGER)
      || a.task.taskId.localeCompare(b.task.taskId));

    let closureAt = null;
    const foreground = [];
    const afterClosure = [];
    for (const item of resolved) {
      const completedAt = item.result?.completedAt ?? item.task.hardDeadline + 1;
      if (closureAt != null || completedAt > item.task.hardDeadline) {
        afterClosure.push(item);
        continue;
      }
      if (item.result) {
        const route = this.resultBus.receive(toNexusCognitiveResult(item.result, item.task));
        if (route?.route?.freshness === 'STALE' || route?.route?.freshness === 'INVALID') {
          await gather.accept({ ...item.result, freshnessIdentity: { ...item.result.freshnessIdentity, worldRevision: turnEvent.worldRevision - 1 } }, { arrivalAt: completedAt });
        } else {
          await gather.accept(item.result, { arrivalAt: completedAt, semanticValidator: semanticValidators[item.task.taskType] });
        }
        foreground.push(item);
      } else if (item.failure) {
        gather.addFailure(item.failure);
      }
      if (gather.quorumSatisfied()) closureAt = completedAt;
    }

    if (!gather.quorumSatisfied()) {
      const hardDeadline = plan.tasks.reduce((value, task) => Math.max(value, task.hardDeadline), turnEvent.deadline);
      for (const task of gather.missingRequired()) {
        const fallback = await this.fallbackResolver(task, { turnEvent, failure: resolved.find((item) => item.task.taskId === task.taskId)?.failure ?? null, at: hardDeadline });
        if (fallback) {
          const normalized = createWorkerResult(fallback);
          gather.addFallback(task.taskId, normalized);
          this.resultBus.receive(toNexusCognitiveResult(normalized, task));
          this.telemetry?.emit(TelemetryEvent.FALLBACK_USED, { ...telemetryTask(task), providerId: normalized.providerId });
          const trace = taskTraces.find((item) => item.taskId === task.taskId);
          if (trace) { trace.deadlineMiss = true; trace.fallbackUsed = true; }
        }
      }
      closureAt = hardDeadline;
    }

    const bundle = gather.close({ at: closureAt ?? turnEvent.createdAt, reason: gather.quorumSatisfied() ? 'FOREGROUND_QUORUM' : 'HARD_DEADLINE_DEGRADED' });
    this.telemetry?.emit(TelemetryEvent.GATHER_CLOSED, {
      turnId: turnEvent.turnId, correlationId: turnEvent.correlationId, closeReason: bundle.closeReason,
      missingRequired: bundle.missingRequired.length, fallbacksUsed: bundle.fallbacksUsed.length,
    });

    const packet = this.compiler.compile(bundle);
    const seal = this.contextSeal.seal({
      turnId: turnEvent.turnId,
      correlationId: turnEvent.correlationId,
      packet,
      sourceRevisionIds: turnEvent.sourceRevisionSet,
      worldRevision: turnEvent.worldRevision,
      sceneRevision: turnEvent.sceneRevision,
      admittedResultIds: bundle.acceptedResultIds,
      rejectedResultIds: bundle.rejectedResultIds,
      staleResultIds: bundle.staleResultIds,
      deadline: { soft: Math.min(...plan.tasks.map((task) => task.softDeadline), turnEvent.deadline), hard: Math.max(...plan.tasks.map((task) => task.hardDeadline), turnEvent.deadline) },
    });
    gather.markSealed(seal.receipt);
    this.telemetry?.emit(TelemetryEvent.CONTEXT_SEALED, {
      turnId: turnEvent.turnId, correlationId: turnEvent.correlationId, packetHash: seal.receipt.packetHash,
    });

    for (const item of [...afterClosure, ...resolved.filter((item) => item.task.resultClass === ResultClass.DEFERRED)]) {
      if (!item.result) continue;
      const bus = this.resultBus.receive(toNexusCognitiveResult(item.result, item.task));
      const late = await gather.accept(item.result, { arrivalAt: item.result.completedAt });
      this.telemetry?.emit(TelemetryEvent.LATE_ROUTED, {
        ...telemetryTask(item.task), resultId: item.result.resultId,
        destination: bus?.route?.effectiveDestination ?? late.destination,
      });
    }

    const finalBundle = gather.bundle();
    return Object.freeze({
      turnEvent, plan, gather: finalBundle, packet: seal.packet, sealReceipt: seal.receipt,
      taskTraces: Object.freeze(taskTraces.map((item) => Object.freeze({ ...item }))),
      duplicateTurnEvent: published.duplicate,
    });
  }

  async #resolveOutcome(outcome, turnEvent, semanticValidator) {
    const { task } = outcome;
    let attempt = outcome.attempt;
    let raw = outcome.raw;
    let error = outcome.error;

    while (true) {
      if (error) {
        const failure = createWorkerFailure({
          code: FailureCode.PROVIDER_FAILURE, taskId: task.taskId, turnId: task.turnId, correlationId: task.correlationId,
          message: error?.message ?? String(error), attempt, retryable: attempt <= Number(task.fallbackPolicy?.maxRetries ?? 0),
        });
        if (!failure.retryable) return { task, failure, result: null, trace: failedTrace(task, failure) };
        this.telemetry?.emit(TelemetryEvent.RETRY, { ...telemetryTask(task), attempt: attempt + 1, reason: failure.code });
      } else {
        const validation = await validateWorkerOutput(raw, task, { currentRevisionSet: turnEvent, semanticValidator, attempt });
        if (validation.valid) {
          this.telemetry?.emit(TelemetryEvent.TASK_COMPLETED, {
            ...telemetryTask(task), resultId: validation.result.resultId, providerId: validation.result.providerId,
            executionLatency: validation.result.latency,
          });
          if (validation.freshness === 'STALE') this.telemetry?.emit(TelemetryEvent.STALE_DROPPED, { ...telemetryTask(task), resultId: validation.result.resultId });
          return { task, result: validation.result, failure: validation.failure, trace: passedTrace(task, validation.result, validation.freshness) };
        }
        this.telemetry?.emit(TelemetryEvent.VALIDATION_FAILED, { ...telemetryTask(task), attempt, reason: validation.failure.code });
        if (!validation.failure.retryable) return { task, failure: validation.failure, result: null, trace: failedTrace(task, validation.failure) };
        this.telemetry?.emit(TelemetryEvent.RETRY, { ...telemetryTask(task), attempt: attempt + 1, reason: validation.failure.code });
      }

      attempt += 1;
      try {
        raw = await this.executionRouter.dispatch(task, { attempt, turnEvent });
        error = null;
      } catch (nextError) {
        raw = null;
        error = nextError;
      }
    }
  }
}

export async function defaultFallbackResolver(task, { at } = {}) {
  if (task.resultClass !== ResultClass.REQUIRED) return null;
  const authorityClass = task.metadata?.roleId === 'green-room' ? 'INFERRED' : 'UNRESOLVED';
  return {
    resultId: `fallback:${task.taskId}`,
    taskId: task.taskId, turnId: task.turnId, correlationId: task.correlationId,
    workerId: 'deterministic-fallback', providerId: 'area52:deterministic',
    capabilities: [...task.requiredCapabilities], status: ResultStatus.FALLBACK,
    payload: {
      lane: task.compilerLane,
      fallback: task.fallbackPolicy.type,
      unresolved: task.fallbackPolicy.type.includes('UNRESOLVED'),
      evidence: [],
    },
    provenance: { fallback: true }, confidence: 0,
    freshnessIdentity: task.inputRevisionSet, inputRevisionSet: task.inputRevisionSet,
    startedAt: at ?? task.hardDeadline, completedAt: at ?? task.hardDeadline, latency: 0,
    validationReceipt: { syntax: 'PASS', deterministic: 'FALLBACK' }, authorityClass,
  };
}

function telemetryTask(task) {
  return {
    taskId: task.taskId, turnId: task.turnId, correlationId: task.correlationId,
    requiredCapabilities: task.requiredCapabilities, cognitiveLayer: task.cognitiveLayer,
    resultClass: task.resultClass, placement: task.placement,
  };
}
function passedTrace(task, result, freshness) {
  return {
    taskId: task.taskId, resultClass: task.resultClass, startedAt: result.startedAt, completedAt: result.completedAt,
    providerId: result.providerId, workerId: result.workerId, validation: 'PASS', freshness,
    deadlineMiss: result.completedAt > task.hardDeadline, fallbackUsed: result.status === ResultStatus.FALLBACK,
  };
}
function failedTrace(task, failure) {
  return {
    taskId: task.taskId, resultClass: task.resultClass, startedAt: null, completedAt: null,
    providerId: failure.providerId, workerId: failure.workerId, validation: 'FAIL', freshness: null,
    deadlineMiss: true, fallbackUsed: false, failureCode: failure.code,
  };
}
