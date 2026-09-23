export function summarizeSwarmTrace(trace, measured = {}) {
  const starts = trace.taskTraces.map((item) => item.startedAt).filter(Number.isFinite);
  const completions = trace.taskTraces.map((item) => item.completedAt).filter(Number.isFinite);
  const required = trace.taskTraces.filter((item) => item.resultClass === 'REQUIRED');
  return Object.freeze({
    turnId: trace.turnEvent.turnId,
    plannedWorkers: trace.plan.tasks.length,
    fanOutStartSkew: starts.length ? Math.max(...starts) - Math.min(...starts) : 0,
    foregroundQuorumLatency: trace.gather.closedAt - trace.turnEvent.createdAt,
    fullSwarmCompletionLatency: completions.length ? Math.max(...completions) - trace.turnEvent.createdAt : 0,
    requiredDeadlineMisses: required.filter((item) => item.deadlineMiss).length,
    lateResultRate: trace.plan.tasks.length ? trace.gather.lateResults.length / trace.plan.tasks.length : 0,
    staleRejected: trace.gather.staleResultIds.length,
    structuredOutputValidity: trace.taskTraces.length ? trace.taskTraces.filter((item) => item.validation === 'PASS').length / trace.taskTraces.length : 1,
    duplicateDeliveries: trace.duplicateDeliveries ?? 0,
    fallbacksUsed: trace.gather.fallbacksUsed.length,
    cpuMs: measured.cpuMs ?? null,
    peakRamMb: measured.peakRamMb ?? null,
    llmInputTokens: measured.llmInputTokens ?? null,
    llmOutputTokens: measured.llmOutputTokens ?? null,
    estimatedCost: measured.estimatedCost ?? null,
  });
}


export function summarizeWave2Benchmarks({traces=[],batchReceipts=[],greenRoomChecks=[],disagreementChecks=[]}={}) {
  const taskTraces=traces.flatMap(t=>t.taskTraces??[]);
  const attempts=taskTraces.reduce((n,t)=>n+Number(t.attempts??1),0);
  const fallbacks=traces.reduce((n,t)=>n+(t.gather?.fallbacksUsed?.length??0),0);
  const planned=traces.reduce((n,t)=>n+(t.plan?.tasks?.length??0),0);
  const late=traces.reduce((n,t)=>n+(t.gather?.lateResults?.length??0),0);
  const valid=taskTraces.filter(t=>t.validation==='PASS').length;
  const committed=batchReceipts.reduce((n,r)=>n+Number(r.committedUnits??0),0);
  const failed=batchReceipts.reduce((n,r)=>n+Number(r.failedUnits??0),0);
  return Object.freeze({
    turns:traces.length,
    fanOutTasks:planned,
    structuredOutputValidity:taskTraces.length?valid/taskTraces.length:1,
    retryRate:taskTraces.length?Math.max(0,attempts-taskTraces.length)/taskTraces.length:0,
    fallbackRate:planned?fallbacks/planned:0,
    opportunisticLateRate:planned?late/planned:0,
    batchCommittedUnits:committed,
    batchFailedUnits:failed,
    greenRoomExpiryCorrectness:greenRoomChecks.length?greenRoomChecks.filter(Boolean).length/greenRoomChecks.length:1,
    disagreementPreservation:disagreementChecks.length?disagreementChecks.filter(Boolean).length/disagreementChecks.length:1,
    cpuMs:null,peakRamMb:null,llmInputTokens:null,llmOutputTokens:null,estimatedCost:null,
  });
}
