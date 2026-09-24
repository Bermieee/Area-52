import { FailureCode, ResultClass, ResultStatus, TelemetryEvent } from './constants.js';
import { createWorkerFailure, createWorkerResult } from './contracts.js';
import { GatherCoordinator } from './gather-coordinator.js';
import { toNexusCognitiveResult } from './integration-adapters.js';
import { validateWorkerOutput } from './validation.js';
import { fallbackForTask } from './fallback-policy.js';
import { emitTelemetry } from './telemetry.js';

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
    emitTelemetry(this.telemetry,TelemetryEvent.TURN_EVENT_CREATED, {
      turnId: turnEvent.turnId, correlationId: turnEvent.correlationId, duplicate: published.duplicate,
    });
    const plan = this.planner.plan({ turnEvent, ...plannerInput });
    const gather = new GatherCoordinator({ turnEvent, plan, currentRevisionSet: turnEvent });
    for (const task of plan.tasks) {
      emitTelemetry(this.telemetry,TelemetryEvent.TASK_PLANNED, telemetryTask(task));
    }

    const dispatchEntries = plan.tasks.map((task) => {
      emitTelemetry(this.telemetry,TelemetryEvent.TASK_STARTED, telemetryTask(task));
      const promise=Promise.resolve()
        .then(() => this.executionRouter.dispatch(task, { attempt: 1, turnEvent }))
        .then((raw) => ({ task, raw, error: null, attempt: 1 }))
        .catch((error) => ({ task, raw: null, error, attempt: 1 }));
      return {task,promise};
    });
    const requiredEntries=dispatchEntries.filter((entry)=>entry.task.resultClass===ResultClass.REQUIRED);
    const nonBlockingEntries=dispatchEntries.filter((entry)=>entry.task.resultClass!==ResultClass.REQUIRED);
    const requiredSettled=[];const nonBlockingSettled=[];
    for(const entry of requiredEntries)entry.promise.then((outcome)=>requiredSettled.push(outcome));
    for(const entry of nonBlockingEntries)entry.promise.then((outcome)=>nonBlockingSettled.push(outcome));
    const foregroundBudget=Math.max(0,Math.min(30000,requiredEntries.length?Math.max(...requiredEntries.map((entry)=>entry.task.hardDeadline-turnEvent.createdAt)):0));
    if(requiredEntries.length)await Promise.race([Promise.all(requiredEntries.map((entry)=>entry.promise)),delay(foregroundBudget)]);
    const settledRequiredIds=new Set(requiredSettled.map((outcome)=>outcome.task.taskId));
    const firstOutcomes=[...requiredSettled];
    for(const entry of requiredEntries){
      if(settledRequiredIds.has(entry.task.taskId))continue;
      const error=new Error('foreground required task exceeded hard deadline');error.code=FailureCode.DEADLINE_MISS;
      firstOutcomes.push({task:entry.task,raw:null,error,attempt:1});
    }
    const resolved = [];
    const taskTraces = [];

    for (const outcome of firstOutcomes) {
      const next = await this.#resolveOutcome(outcome, turnEvent, semanticValidators[outcome.task.taskType], true);
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
        const external = gather.recordExternalRoute(item.result, route?.route);
        if (!external) await gather.accept(item.result, { arrivalAt: completedAt });
        foreground.push(item);
      } else if (item.failure) {
        gather.addFailure(item.failure);
      }
      if (gather.quorumSatisfied()) closureAt = completedAt;
    }

    if (!gather.quorumSatisfied()) {
      const hardDeadline = plan.tasks.filter((task)=>task.resultClass===ResultClass.REQUIRED).reduce((value, task) => Math.max(value, task.hardDeadline), turnEvent.deadline);
      for (const task of gather.missingRequired()) {
        const fallback = await this.fallbackResolver(task, { turnEvent, failure: resolved.find((item) => item.task.taskId === task.taskId)?.failure ?? null, at: hardDeadline });
        if (fallback) {
          const normalized = createWorkerResult(fallback);
          gather.addFallback(task.taskId, normalized);
          this.resultBus.receive(toNexusCognitiveResult(normalized, task));
          emitTelemetry(this.telemetry,TelemetryEvent.FALLBACK_USED, { ...telemetryTask(task), providerId: normalized.providerId });
          const trace = taskTraces.find((item) => item.taskId === task.taskId);
          if (trace) { trace.deadlineMiss = true; trace.fallbackUsed = true; }
        }
      }
      closureAt = hardDeadline;
    }

    // Opportunistic results that completed before quorum may join foreground, but are never awaited.
    for(const outcome of [...nonBlockingSettled].sort((a,b)=>a.task.taskId.localeCompare(b.task.taskId))){
      const next=await this.#resolveOutcome(outcome,turnEvent,semanticValidators[outcome.task.taskType],false);
      if(!resolved.some((item)=>item.task.taskId===next.task.taskId)){resolved.push(next);taskTraces.push(next.trace);}
      const completedAt=next.result?.completedAt??Number.MAX_SAFE_INTEGER;
      if(next.result&&next.task.resultClass===ResultClass.OPPORTUNISTIC&&completedAt<=(closureAt??turnEvent.createdAt)){
        const route=this.resultBus.receive(toNexusCognitiveResult(next.result,next.task));const external=gather.recordExternalRoute(next.result,route?.route);
        if(!external)await gather.accept(next.result,{arrivalAt:completedAt});
      }
    }

    const bundle = gather.close({ at: closureAt ?? turnEvent.createdAt, reason: gather.quorumSatisfied() ? 'FOREGROUND_QUORUM' : 'HARD_DEADLINE_DEGRADED' });
    emitTelemetry(this.telemetry,TelemetryEvent.GATHER_CLOSED, {
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
    emitTelemetry(this.telemetry,TelemetryEvent.CONTEXT_SEALED, {
      turnId: turnEvent.turnId, correlationId: turnEvent.correlationId, packetHash: seal.receipt.packetHash,
    });

    const alreadyLate=new Set();
    for (const item of [...afterClosure, ...resolved.filter((item) => item.task.resultClass === ResultClass.DEFERRED)]) {
      if (!item.result||alreadyLate.has(item.result.resultId)) continue;alreadyLate.add(item.result.resultId);
      const bus = this.resultBus.receive(toNexusCognitiveResult(item.result, item.task));
      const late = await gather.accept(item.result, { arrivalAt: item.result.completedAt });
      emitTelemetry(this.telemetry,TelemetryEvent.LATE_ROUTED, {
        ...telemetryTask(item.task), resultId: item.result.resultId,
        destination: bus?.route?.effectiveDestination ?? late.destination,
      });
    }
    const settledTaskIds=new Set(resolved.map((item)=>item.task.taskId));
    for(const entry of dispatchEntries){
      if(settledTaskIds.has(entry.task.taskId))continue;
      entry.promise.then(async(outcome)=>{
        const next=await this.#resolveOutcome(outcome,turnEvent,semanticValidators[outcome.task.taskType],false);
        if(!next.result)return;
        const bus=this.resultBus.receive(toNexusCognitiveResult(next.result,next.task));
        const late=await gather.accept(next.result,{arrivalAt:next.result.completedAt});
        emitTelemetry(this.telemetry,TelemetryEvent.LATE_ROUTED,{...telemetryTask(next.task),resultId:next.result.resultId,destination:bus?.route?.effectiveDestination??late.destination});
      }).catch(()=>{});
    }

    const finalBundle = gather.bundle();
    return Object.freeze({
      turnEvent, plan, gather: finalBundle, packet: seal.packet, sealReceipt: seal.receipt,
      taskTraces: Object.freeze(taskTraces.map((item) => Object.freeze({ ...item }))),
      duplicateTurnEvent: published.duplicate,
    });
  }

  async #resolveOutcome(outcome, turnEvent, semanticValidator, allowRetry = true) {
    const { task } = outcome;
    let attempt = outcome.attempt;
    let raw = outcome.raw;
    let error = outcome.error;

    while (true) {
      if (error) {
        const maxRetries=Number(task.fallbackPolicy?.maxRetries??0);
        const rawCode=Object.values(FailureCode).includes(error?.code)?error.code:FailureCode.PROVIDER_FAILURE;
        const retryable=attempt<=maxRetries && ![FailureCode.CAPABILITY_UNAVAILABLE,FailureCode.FUTURE_REVISION,FailureCode.PROVIDER_ABORTED].includes(rawCode);
        let failure = createWorkerFailure({
          code: rawCode, taskId: task.taskId, turnId: task.turnId, correlationId: task.correlationId,
          providerId:error?.providerId??null,message: error?.message ?? String(error), attempt, retryable,
          details:{providerCode:rawCode},
        });
        if (!failure.retryable || !allowRetry) {
          if(maxRetries>0&&attempt>maxRetries)failure=createWorkerFailure({code:FailureCode.RETRY_EXHAUSTED,taskId:task.taskId,turnId:task.turnId,
            correlationId:task.correlationId,providerId:error?.providerId??null,message:'provider retry budget exhausted',attempt,retryable:false,
            details:{lastFailureCode:rawCode}});
          return { task, failure, result: null, trace: failedTrace(task, failure) };
        }
        emitTelemetry(this.telemetry,TelemetryEvent.RETRY, { ...telemetryTask(task), attempt: attempt + 1, reason: failure.code });
      } else {
        const validation = await validateWorkerOutput(raw, task, { currentRevisionSet: turnEvent, semanticValidator, attempt });
        if (validation.valid) {
          emitTelemetry(this.telemetry,TelemetryEvent.TASK_COMPLETED, {
            ...telemetryTask(task), resultId: validation.result.resultId, providerId: validation.result.providerId,
            executionLatency: validation.result.latency,
          });
          if (validation.freshness === 'STALE') emitTelemetry(this.telemetry,TelemetryEvent.STALE_DROPPED, { ...telemetryTask(task), resultId: validation.result.resultId });
          return { task, result: validation.result, failure: validation.failure, trace: passedTrace(task, validation.result, validation.freshness) };
        }
        emitTelemetry(this.telemetry,TelemetryEvent.VALIDATION_FAILED, { ...telemetryTask(task), attempt, reason: validation.failure.code });
        if (!validation.failure.retryable || !allowRetry) return { task, failure: validation.failure, result: null, trace: failedTrace(task, validation.failure) };
        emitTelemetry(this.telemetry,TelemetryEvent.RETRY, { ...telemetryTask(task), attempt: attempt + 1, reason: validation.failure.code });
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

export async function defaultFallbackResolver(task, context = {}) {
  return fallbackForTask(task,context);
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

function delay(ms){return new Promise((resolve)=>setTimeout(resolve,Math.max(0,Number(ms)||0)));}
