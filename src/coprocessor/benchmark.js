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
