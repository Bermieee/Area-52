export const Wave3MeasurementStatus = Object.freeze({ MEASURED: 'MEASURED', REPLAYED: 'REPLAYED', NOT_MEASURED: 'NOT_MEASURED', NOT_APPLICABLE: 'NOT_APPLICABLE' });

export function summarizeWave3Qualification({
  warmer = null,
  retrieval = null,
  greenRoom = null,
  consolidation = null,
  streamingTruth = null,
  fanOut = null,
  mode = Wave3MeasurementStatus.MEASURED,
} = {}) {
  const status = Object.values(Wave3MeasurementStatus).includes(mode) ? mode : Wave3MeasurementStatus.MEASURED;
  return Object.freeze({
    kind: 'CoprocessorWave3Qualification',
    measurementState: status,
    warmer: warmer ? qualifyWarmer(warmer, status) : missing('warmer metrics not supplied'),
    retrieval: retrieval ? qualifyRetrieval(retrieval, status) : missing('retrieval metrics not supplied'),
    greenRoom: greenRoom ? qualifyGreenRoom(greenRoom, status) : missing('Green Room metrics not supplied'),
    consolidation: consolidation ? qualifyConsolidation(consolidation, status) : missing('consolidation metrics not supplied'),
    streamingTruth: streamingTruth ? qualifyStreamingTruth(streamingTruth, status) : missing('Streaming Truth metrics not supplied'),
    fanOut: fanOut ? qualifyFanOut(fanOut, status) : missing('Fan-Out metrics not supplied'),
  });
}

export function qualifyWarmer(input, status = Wave3MeasurementStatus.MEASURED) {
  const total = n(input.totalEvaluations ?? input.total ?? 0);
  const hits = n(input.hits ?? 0), partial = n(input.partial ?? 0), stale = n(input.stale ?? 0), invalid = n(input.invalid ?? 0);
  return metric(status, {
    totalEvaluations: total,
    warmHitRate: ratio(hits, total),
    partialSalvageRate: ratio(partial, total),
    staleDiscardRate: ratio(stale + invalid, total),
    foregroundRetrievalAvoided: n(input.foregroundRetrievalAvoided ?? hits),
    foregroundLatencySavedMs: optional(input.foregroundLatencySavedMs),
    falseUseRate: optionalRatio(input.falseUses, input.reuses ?? hits),
  });
}

export function qualifyRetrieval(input, status = Wave3MeasurementStatus.MEASURED) {
  const total = n(input.total ?? 0);
  return metric(status, {
    total,
    highCorrectness: optionalRatio(input.highCorrect, input.highTotal),
    mixedCorrectionImprovement: optionalRatio(input.mixedImproved, input.mixedCorrectiveTotal),
    lowAbstentionCorrectness: optionalRatio(input.lowCorrectAbstentions, input.lowTotal),
    correctivePassRate: optionalRatio(input.correctivePasses, total),
    garbageInjectionAvoided: n(input.garbageInjectionAvoided ?? 0),
  });
}

export function qualifyGreenRoom(input, status = Wave3MeasurementStatus.MEASURED) {
  return metric(status, {
    inferenceConsistency: optional(input.inferenceConsistency),
    evidenceCoverage: optional(input.evidenceCoverage),
    falsePersistence: n(input.falsePersistence ?? 0),
    expiryCorrectness: optional(input.expiryCorrectness),
    batchSize: optional(input.batchSize),
    latencyMs: optional(input.latencyMs),
  });
}

export function qualifyConsolidation(input, status = Wave3MeasurementStatus.MEASURED) {
  return metric(status, {
    sourceFactRetention: optional(input.sourceFactRetention),
    provenanceRetention: optional(input.provenanceRetention),
    uniqueFactLoss: n(input.uniqueFactLoss ?? 0),
    contradictionPreservation: optional(input.contradictionPreservation),
    yieldLatencyMs: optional(input.yieldLatencyMs),
    resumeCorrectness: optional(input.resumeCorrectness),
    staleResultRejection: optional(input.staleResultRejection),
  });
}

export function qualifyStreamingTruth(input, status = Wave3MeasurementStatus.MEASURED) {
  return metric(status, {
    truePositiveRate: optionalRatio(input.truePositive, input.positiveCases),
    falsePositiveRate: optionalRatio(input.falsePositive, input.negativeCases),
    ambiguousCaseAbstention: optionalRatio(input.ambiguousAbstained, input.ambiguousCases),
    latencyMs: optional(input.latencyMs),
    historicalCurrentDiscrimination: optionalRatio(input.temporalCorrect, input.temporalCases),
  });
}

export function qualifyFanOut(input, status = Wave3MeasurementStatus.MEASURED) {
  const plans = n(input.plans ?? 0), nominated = n(input.nominatedWorkers ?? 0);
  return metric(status, {
    plans,
    averageNominatedWorkers: plans ? nominated / plans : null,
    zeroWorkerRate: optionalRatio(input.zeroWorkerPlans, plans),
    unnecessaryWorkerRate: optionalRatio(input.unnecessaryWorkers, nominated),
    expectedValueHitRate: optionalRatio(input.usefulWorkers, nominated),
    foregroundCostUnits: optional(input.foregroundCostUnits),
    deadlineImpactMs: optional(input.deadlineImpactMs),
  });
}

export function measured(value) { return metric(Wave3MeasurementStatus.MEASURED, value); }
export function replayed(value) { return metric(Wave3MeasurementStatus.REPLAYED, value); }
export function notMeasured(reason) { return Object.freeze({ status: Wave3MeasurementStatus.NOT_MEASURED, value: null, reason }); }
export function notApplicable(reason) { return Object.freeze({ status: Wave3MeasurementStatus.NOT_APPLICABLE, value: null, reason }); }

function metric(status, value) { return Object.freeze({ status, value: structuredClone(value) }); }
function missing(reason) { return notMeasured(reason); }
function n(value) { const x = Number(value); return Number.isFinite(x) ? x : 0; }
function ratio(a, b) { const aa = n(a), bb = n(b); return bb > 0 ? aa / bb : null; }
function optional(value) { return value == null ? null : structuredClone(value); }
function optionalRatio(a, b) { return a == null || b == null ? null : ratio(a, b); }
