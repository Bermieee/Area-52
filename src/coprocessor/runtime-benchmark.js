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

export function summarizeBackendRuntimeClosureBenchmarks({
  routingReceipts=[],
  placementReceipts=[],
  fallbackReceipts=[],
  staleChecks=[],
  resourceUse={},
  measurementClass='LOCAL_DETERMINISTIC',
}={}){
  const routes=Array.isArray(routingReceipts)?routingReceipts:[];
  const placements=Array.isArray(placementReceipts)?placementReceipts:[];
  const fallbacks=Array.isArray(fallbackReceipts)?fallbackReceipts:[];
  const stale=Array.isArray(staleChecks)?staleChecks:[];
  const routeStable=routes.map(row=>Boolean(row?.meaningPreserved));
  const interchangeable=routes.map(row=>Boolean(row?.interchangeable));
  const foregroundBlocked=placements.map(row=>Number(row?.foregroundBlockedMs??0)).filter(Number.isFinite);
  const yieldLatency=placements.map(row=>Number(row?.yieldLatencyMs)).filter(Number.isFinite);
  const queueLatency=placements.map(row=>Number(row?.queueMs)).filter(Number.isFinite);
  const boundedFallback=fallbacks.map(row=>{
    const attempts=Number(row?.attempts??row?.attemptCount??0),max=Number(row?.maxProviders??row?.maxAttempts??0);
    return Number.isFinite(attempts)&&Number.isFinite(max)&&max>0&&attempts<=max;
  });
  const staleRejected=stale.map(row=>typeof row==='boolean'?row:Boolean(row?.rejected));
  return Object.freeze({
    kind:'BackendRuntimeClosureBenchmarkSummary',
    measurementClass,
    deterministic:measurementClass!=='MEASURED_LIVE',
    liveProviderLatencyMeasured:measurementClass==='MEASURED_LIVE'&&Boolean(resourceUse?.providerLatencyMs),
    liveProviderCostMeasured:measurementClass==='MEASURED_LIVE'&&Boolean(resourceUse?.providerCost),
    metrics:Object.freeze({
      routingStability:measuredMetric({passed:routeStable.filter(Boolean).length,total:routeStable.length,ratio:ratio(routeStable)}),
      providerInterchangeability:measuredMetric({passed:interchangeable.filter(Boolean).length,total:interchangeable.length,ratio:ratio(interchangeable)}),
      foregroundBlockingMs:measuredMetric(distribution(foregroundBlocked)),
      queueLatencyMs:measuredMetric(distribution(queueLatency)),
      deepYieldLatencyMs:yieldLatency.length?measuredMetric(distribution(yieldLatency)):notMeasured('no yield latency receipts supplied'),
      boundedFallback:measuredMetric({passed:boundedFallback.filter(Boolean).length,total:boundedFallback.length,ratio:ratio(boundedFallback)}),
      staleRejection:measuredMetric({passed:staleRejected.filter(Boolean).length,total:staleRejected.length,ratio:ratio(staleRejected)}),
      deferredByBackpressure:measuredMetric(placements.filter(row=>row?.decision==='DEFER'||row?.reason==='DEEP_QUEUE_BACKPRESSURE').length),
      skippedByPolicy:measuredMetric(placements.filter(row=>row?.decision==='SKIP').length),
      cpuMs:optionalMeasured(resourceUse?.cpuMs,'CPU instrumentation unavailable'),
      peakRamMb:optionalMeasured(resourceUse?.peakRamMb,'RAM instrumentation unavailable'),
      llmInputTokens:measurementClass==='MEASURED_LIVE'?optionalMeasured(resourceUse?.llmInputTokens,'live provider usage unavailable'):notMeasured('deterministic benchmark does not claim live provider tokens'),
      llmOutputTokens:measurementClass==='MEASURED_LIVE'?optionalMeasured(resourceUse?.llmOutputTokens,'live provider usage unavailable'):notMeasured('deterministic benchmark does not claim live provider tokens'),
      estimatedCost:measurementClass==='MEASURED_LIVE'?optionalMeasured(resourceUse?.estimatedCost,'live provider cost unavailable'):notMeasured('deterministic benchmark does not claim live provider cost'),
    }),
  });
}

function distribution(values){
  if(!values.length)return{count:0,min:null,max:null,average:null};
  return{count:values.length,min:Math.min(...values),max:Math.max(...values),average:values.reduce((a,b)=>a+b,0)/values.length};
}
