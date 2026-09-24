import { utf8ByteLength } from './browser-compat.js';

export const MeasurementStatus = Object.freeze({ MEASURED: 'MEASURED', REPLAYED: 'REPLAYED', NOT_MEASURED: 'NOT_MEASURED', NOT_APPLICABLE: 'NOT_APPLICABLE' });

export function summarizeCoprocessorIntegrationBenchmarks({
  traces = null,
  batchReceipts = null,
  artifactBenchmarks = null,
  telemetryEvents = null,
  zeroWorkerChecks = null,
  malformedOutputChecks = null,
  fallbackChecks = null,
  providerInterchangeChecks = null,
  futureRevisionChecks = null,
  measured = {},
} = {}) {
  const taskTraces = traces ? traces.flatMap((trace) => trace.taskTraces ?? []) : null;
  const planned = traces ? traces.reduce((count, trace) => count + Number(trace.plan?.tasks?.length ?? 0), 0) : null;
  const late = traces ? traces.reduce((count, trace) => count + Number(trace.gather?.lateResults?.length ?? 0), 0) : null;
  const stale = traces ? traces.reduce((count, trace) => count + Number(trace.gather?.staleResultIds?.length ?? 0), 0) : null;
  const fallbacks = traces ? traces.reduce((count, trace) => count + Number(trace.gather?.fallbacksUsed?.length ?? 0), 0) : null;
  const retryCount = taskTraces ? taskTraces.reduce((count, trace) => count + Math.max(0, Number(trace.attempts ?? 1) - 1), 0) : null;
  const quorum = traces ? traces.map((trace) => Number((trace.gather?.closedAt ?? trace.turnEvent?.createdAt ?? 0) - (trace.turnEvent?.createdAt ?? 0))) : null;
  const committed = batchReceipts ? batchReceipts.reduce((count, receipt) => count + Number(receipt.committedUnits ?? 0), 0) : null;
  const durationMs = batchReceipts ? batchReceipts.reduce((count, receipt) => count + Number(receipt.durationMs ?? 0), 0) : null;
  const referenceSavings = artifactBenchmarks ? artifactBenchmarks.map((entry) => entry.serializedBytes?.value?.saved).filter(Number.isFinite) : null;
  const telemetryBytes = telemetryEvents ? utf8ByteLength(JSON.stringify(telemetryEvents)) : null;
  return Object.freeze({
    kind: 'CoprocessorIntegrationBenchmarkSummary',
    metrics: Object.freeze({
      fanOutCount: present(planned),
      zeroWorkerCorrectness: checks(zeroWorkerChecks),
      quorumCloseTimeMs: quorum ? measuredMetric(quorum) : notMeasured('no swarm traces supplied'),
      lateResultCount: present(late),
      structuredValidity: taskTraces ? measuredMetric(ratio(taskTraces.map((trace) => trace.validation === 'PASS'))) : notMeasured('no task traces supplied'),
      malformedRejection: checks(malformedOutputChecks),
      retryCount: present(retryCount),
      fallbackCount: present(fallbacks),
      fallbackCorrectness: checks(fallbackChecks),
      staleRejection: present(stale),
      futureRevisionRejection: checks(futureRevisionChecks),
      providerInterchangeability: checks(providerInterchangeChecks),
      batchThroughput: batchReceipts ? (durationMs > 0 ? measuredMetric(committed / (durationMs / 1000)) : notApplicable('zero measured batch duration')) : notMeasured('no batch receipts supplied'),
      artifactReferenceSavingsBytes: referenceSavings ? measuredMetric(referenceSavings) : notMeasured('no artifact reference benchmark supplied'),
      serializationTransportCost: artifactBenchmarks ? measuredMetric(artifactBenchmarks.map((entry) => ({ serializedBytes: entry.serializedBytes, jsonRoundTripMs: entry.jsonRoundTripMs, structuredCloneMs: entry.structuredCloneMs }))) : notMeasured('no artifact reference benchmark supplied'),
      telemetryVolume: telemetryEvents ? measuredMetric({ events: telemetryEvents.length, bytes: telemetryBytes }) : notMeasured('telemetry events not supplied'),
      cpuMs: optionalMeasured(measured.cpuMs, 'CPU instrumentation unavailable'),
      peakRamMb: optionalMeasured(measured.peakRamMb, 'RAM instrumentation unavailable'),
      llmInputTokens: optionalMeasured(measured.llmInputTokens, 'provider usage unavailable'),
      llmOutputTokens: optionalMeasured(measured.llmOutputTokens, 'provider usage unavailable'),
      estimatedCost: optionalMeasured(measured.estimatedCost, 'provider cost unavailable'),
    }),
  });
}

export function measuredMetric(value) { return Object.freeze({ status: MeasurementStatus.MEASURED, value: structuredClone(value) }); }
export function notMeasured(reason) { return Object.freeze({ status: MeasurementStatus.NOT_MEASURED, value: null, reason }); }
export function notApplicable(reason) { return Object.freeze({ status: MeasurementStatus.NOT_APPLICABLE, value: null, reason }); }

function present(value) { return value == null ? notMeasured('measurement input not supplied') : measuredMetric(value); }
function checks(values) { return values == null ? notMeasured('check set not supplied') : measuredMetric({ passed: values.filter(Boolean).length, total: values.length, ratio: ratio(values) }); }
function optionalMeasured(value, reason) { return value == null ? notMeasured(reason) : measuredMetric(value); }
function ratio(values) { return values.length ? values.filter(Boolean).length / values.length : null; }
