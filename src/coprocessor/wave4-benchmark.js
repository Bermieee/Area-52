export const Wave4MeasurementStatus = Object.freeze({ MEASURED: 'MEASURED', REPLAYED: 'REPLAYED', NOT_MEASURED: 'NOT_MEASURED', NOT_APPLICABLE: 'NOT_APPLICABLE' });

export function summarizeWave4PrecisionQualification({
  broadBaseline = null,
  precision = null,
  temporal = null,
  contradiction = null,
  fallback = null,
  providerInterchange = null,
  scaling = null,
  telemetry = null,
  stress = null,
  external = {},
  measured = {},
} = {}) {
  return Object.freeze({
    kind: 'CoprocessorWave4PrecisionQualification',
    metrics: Object.freeze({
      broadCandidateBaseline: wrap(broadBaseline),
      precisionRanking: wrap(precision),
      intentOppositeAccuracy: precision?.intentOppositeAccuracy == null ? missing('precision accuracy not supplied') : measuredMetric(precision.intentOppositeAccuracy),
      measurablePrecisionGain: broadBaseline?.intentOppositeAccuracy == null || precision?.intentOppositeAccuracy == null
        ? missing('baseline and precision accuracy required')
        : measuredMetric(precision.intentOppositeAccuracy - broadBaseline.intentOppositeAccuracy),
      temporalDiscrimination: temporal?.temporalDiscriminationAccuracy == null ? missing('temporal benchmark not supplied') : measuredMetric(temporal.temporalDiscriminationAccuracy),
      contradictionPreservation: checks(contradiction),
      fallbackBehavior: checks(fallback),
      providerInterchangeability: checks(providerInterchange),
      candidateScaling: wrap(scaling),
      telemetryVolume: wrap(telemetry),
      stress: wrap(stress),
      flashRank: external.flashRank ?? missing('FlashRank external runtime/model not measured'),
      colBert: external.colBert ?? missing('ColBERT external runtime/model not measured'),
      cpuMs: optionalMeasured(measured.cpuMs, 'CPU instrumentation unavailable'),
      peakRamMb: optionalMeasured(measured.peakRamMb, 'RAM instrumentation unavailable'),
      llmInputTokens: optionalMeasured(measured.llmInputTokens, 'provider usage unavailable'),
      llmOutputTokens: optionalMeasured(measured.llmOutputTokens, 'provider usage unavailable'),
      estimatedCost: optionalMeasured(measured.estimatedCost, 'provider cost unavailable'),
    }),
  });
}

export function wave4Measured(value) { return measuredMetric(value); }
export function wave4Replayed(value) { return Object.freeze({ status: Wave4MeasurementStatus.REPLAYED, value: structuredClone(value) }); }
export function wave4NotMeasured(reason) { return missing(reason); }
export function wave4NotApplicable(reason) { return Object.freeze({ status: Wave4MeasurementStatus.NOT_APPLICABLE, value: null, reason }); }

function wrap(value) { return value == null ? missing('measurement input not supplied') : measuredMetric(value); }
function measuredMetric(value) { return Object.freeze({ status: Wave4MeasurementStatus.MEASURED, value: structuredClone(value) }); }
function missing(reason) { return Object.freeze({ status: Wave4MeasurementStatus.NOT_MEASURED, value: null, reason }); }
function optionalMeasured(value, reason) { return value == null ? missing(reason) : measuredMetric(value); }
function checks(values) { return values == null ? missing('check set not supplied') : measuredMetric({ passed: values.filter(Boolean).length, total: values.length, ratio: values.length ? values.filter(Boolean).length / values.length : null }); }
