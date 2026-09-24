import { Freshness, ResultClass, ResultDestination } from './constants.js';
import { resultSatisfiesForeground, validateWorkerOutput } from './validation.js';

const LANES = Object.freeze([
  'loreEvidence','episodicEvidence','worldState','graphResults','greenRoom',
  'truthClassifications','precisionResults','externalGrounding',
]);

export class GatherCoordinator {
  constructor({ turnEvent, plan, currentRevisionSet = turnEvent } = {}) {
    if (!turnEvent || !plan) throw new TypeError('GatherCoordinator requires turnEvent and plan');
    this.turnEvent = turnEvent;
    this.plan = plan;
    this.currentRevisionSet = currentRevisionSet;
    this.tasks = new Map(plan.tasks.map((task) => [task.taskId, task]));
    this.accepted = new Map();
    this.seenResultIds = new Set();
    this.rejected = [];
    this.stale = [];
    this.failures = [];
    this.fallbacks = [];
    this.late = [];
    this.closed = false;
    this.sealed = false;
    this.closedAt = null;
    this.closeReason = null;
    this.sealReceipt = null;
    this.maxDiagnostics = Math.max(64, plan.tasks.length * 8);
  }

  async accept(rawResult, { arrivalAt = rawResult?.completedAt ?? 0, semanticValidator = null, attempt = 1 } = {}) {
    const resultId = rawResult?.resultId;
    if (resultId && this.seenResultIds.has(resultId)) return { accepted: false, duplicate: true, destination: ResultDestination.EVALUATION };
    if (resultId) this.seenResultIds.add(resultId);

    const task = this.tasks.get(rawResult?.taskId);
    if (!task) {
      this.#boundedPush(this.rejected,{ resultId: resultId ?? null, reason: 'unknown-task' });
      return { accepted: false, duplicate: false, destination: ResultDestination.EVALUATION, reason: 'unknown-task' };
    }

    const validation = await validateWorkerOutput(rawResult, task, {
      currentRevisionSet: this.currentRevisionSet, semanticValidator, attempt,
    });
    if (!validation.valid) {
      this.#boundedPush(this.failures,validation.failure);
      this.#boundedPush(this.rejected,{ resultId: resultId ?? null, taskId: task.taskId, reason: validation.failure.code });
      return { accepted: false, duplicate: false, destination: ResultDestination.EVALUATION, validation };
    }
    if (validation.freshness === Freshness.STALE) {
      this.#boundedPush(this.stale,validation.result.resultId);
      return { accepted: false, stale: true, destination: ResultDestination.EVALUATION, validation };
    }

    if (this.accepted.has(task.taskId)) {
      this.#boundedPush(this.rejected,{resultId:validation.result.resultId,taskId:task.taskId,reason:'duplicate-task-result'});
      return {accepted:false,duplicateTask:true,destination:ResultDestination.EVALUATION,validation};
    }

    if (this.closed || this.sealed || task.resultClass === ResultClass.DEFERRED) {
      const destination = task.resultClass === ResultClass.DEFERRED ? ResultDestination.BACKGROUND : ResultDestination.NEXT_TURN;
      this.#boundedPush(this.late,{ resultId: validation.result.resultId, taskId: task.taskId, destination, arrivalAt });
      return { accepted: false, late: true, destination, validation };
    }

    this.accepted.set(task.taskId, validation.result);
    return { accepted: true, duplicate: false, destination: ResultDestination.FOREGROUND, validation };
  }

  addFailure(failure) { this.#boundedPush(this.failures,failure); return failure; }

  recordExternalRoute(result, route = {}) {
    const freshness = route.freshness ?? Freshness.FRESH;
    if (freshness === Freshness.STALE) {
      if (!this.stale.includes(result.resultId)) this.#boundedPush(this.stale,result.resultId);
      return { accepted: false, stale: true, destination: route.effectiveDestination ?? ResultDestination.EVALUATION };
    }
    if (freshness === Freshness.INVALID) {
      this.#boundedPush(this.rejected,{ resultId: result.resultId, taskId: result.taskId, reason: route.reason ?? 'result-bus-invalid' });
      return { accepted: false, invalid: true, destination: route.effectiveDestination ?? ResultDestination.EVALUATION };
    }
    return null;
  }

  addFallback(taskId, result) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    this.accepted.set(taskId, result);
    this.fallbacks.push({ taskId, resultId: result.resultId, policy: task.fallbackPolicy.type });
    return result;
  }

  requiredTasks() { return [...this.tasks.values()].filter((task) => task.resultClass === ResultClass.REQUIRED); }
  missingRequired() {
    return this.requiredTasks().filter((task) => !resultSatisfiesForeground(this.accepted.get(task.taskId)));
  }
  quorumSatisfied() { return this.missingRequired().length === 0; }

  close({ at, reason = this.quorumSatisfied() ? 'FOREGROUND_QUORUM' : 'HARD_DEADLINE' } = {}) {
    if (this.closed) return this.bundle();
    this.closed = true;
    this.closedAt = Number(at ?? 0);
    this.closeReason = reason;
    return this.bundle();
  }

  markSealed(receipt) {
    this.sealed = true;
    this.sealReceipt = receipt ?? null;
  }

  compilerInput() {
    const bundle=this.bundle();
    const currentWorldState=bundle.graphResults.flatMap(x=>[
      ...(x.current??[]),...(x.currentStateRefs??[]).map(ref=>({ref,temporalStatus:'CURRENT'}))
    ]);
    const historicalState=bundle.graphResults.flatMap(x=>[
      ...(x.historical??[]),...(x.historicalRefs??[]).map(ref=>({ref,temporalStatus:'HISTORICAL'}))
    ]);
    const unresolved=[
      ...bundle.unresolvedDisagreement,
      ...bundle.graphResults.flatMap(x=>(x.unresolvedRefs??[]).map(ref=>({ref,temporalStatus:'UNRESOLVED'}))),
    ];
    return structuredClone({
      kind:'GatherCompilerInput',
      turnIdentity:bundle.turnIdentity,
      evidence:bundle.loreEvidence,
      currentWorldState,
      historicalState,
      characterInference:bundle.greenRoom,
      truthClassifications:bundle.truthClassifications,
      precisionResults:bundle.precisionResults,
      rankedCandidates:bundle.truthClassifications.flatMap(x=>x.ranking??[]),
      unresolved,
      externalGrounding:bundle.externalGrounding,
      provenance:bundle.provenanceIndex,
      freshness:bundle.freshnessIndex,
      degradedCapabilities:this.#degradedCapabilities(),
      acceptedResultIds:bundle.acceptedResultIds,
    });
  }

  #degradedCapabilities() {
    const degraded=[];
    for(const item of this.fallbacks){const task=this.tasks.get(item.taskId);degraded.push({taskId:item.taskId,roleId:task?.metadata?.roleId??null,reason:'FALLBACK_USED',policy:item.policy});}
    for(const failure of this.failures){const task=this.tasks.get(failure.taskId);degraded.push({taskId:failure.taskId,roleId:task?.metadata?.roleId??null,reason:failure.code});}
    return degraded;
  }

  #boundedPush(target,value){target.push(value);if(target.length>this.maxDiagnostics)target.splice(0,target.length-this.maxDiagnostics);}

  bundle() {
    const lanes = Object.fromEntries(LANES.map((lane) => [lane, []]));
    const provenanceIndex = {};
    const freshnessIndex = {};
    for (const [taskId, result] of this.accepted) {
      const task = this.tasks.get(taskId);
      const lane = LANES.includes(task.compilerLane) ? task.compilerLane : 'externalGrounding';
      lanes[lane].push(structuredClone(result.payload));
      provenanceIndex[result.resultId] = structuredClone(result.provenance);
      freshnessIndex[result.resultId] = structuredClone(result.freshnessIdentity);
    }
    const unresolvedDisagreement = detectDisagreement([...this.accepted.values()]);
    return structuredClone({
      kind: 'GatherBundle',
      turnIdentity: {
        turnId: this.turnEvent.turnId,
        correlationId: this.turnEvent.correlationId,
        eventId: this.turnEvent.eventId,
      },
      ...lanes,
      provenanceIndex,
      freshnessIndex,
      unresolvedDisagreement,
      missingRequired: this.missingRequired().map((task) => task.taskId),
      fallbacksUsed: this.fallbacks,
      lateResults: this.late,
      acceptedResultIds: [...this.accepted.values()].map((result) => result.resultId).sort(),
      rejectedResultIds: this.rejected.map((item) => item.resultId).filter(Boolean).sort(),
      staleResultIds: [...this.stale].sort(),
      closeReason: this.closeReason,
      closedAt: this.closedAt,
      sealed: this.sealed,
    });
  }
}

export function detectDisagreement(results) {
  const groups = new Map();
  for (const result of results) {
    for (const evidence of result.payload?.evidence ?? []) {
      const key = evidence.semanticKey;
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        evidenceId: evidence.id ?? null,
        value: evidence.value ?? evidence.claim ?? evidence.statement ?? null,
        authority: evidence.authority ?? result.authorityClass,
        resultId: result.resultId,
      });
    }
  }
  const disagreements = [];
  for (const [semanticKey, evidence] of groups) {
    const values = new Set(evidence.map((item) => JSON.stringify(item.value)));
    if (values.size > 1) disagreements.push({ semanticKey, evidence });
  }
  return disagreements;
}
