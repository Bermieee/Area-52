import { TelemetryEvent } from './constants.js';
import { emitTelemetry } from './telemetry.js';

export function emitWarmTelemetry(telemetry, evaluation = {}, metadata = {}) {
  const type = evaluation.state === 'FRESH' ? TelemetryEvent.WARM_HIT : evaluation.state === 'PARTIALLY_STALE' ? TelemetryEvent.WARM_PARTIAL : TelemetryEvent.WARM_MISS;
  return emitTelemetry(telemetry, type, { packetId: evaluation.packetId ?? null, state: evaluation.state ?? null, reason: evaluation.reason ?? 'MISS', salvageableRefCount: evaluation.salvageableRefs?.length ?? 0, ...metadata });
}

export function emitRetrievalTelemetry(telemetry, receipt = {}, metadata = {}) {
  return emitTelemetry(telemetry, TelemetryEvent.RETRIEVAL_QUALITY, { quality: receipt.quality ?? null, reason: receipt.reason ?? null, candidateCount: receipt.candidateCount ?? null, relevantCount: receipt.relevantCount ?? null, corrective: Boolean(receipt.corrective), ...metadata });
}

export function emitResultDestinationTelemetry(telemetry, { taskId = null, turnId = null, destination, resultClass = null } = {}) {
  return emitTelemetry(telemetry, TelemetryEvent.RESULT_ROUTED, { taskId, turnId, destination, resultClass });
}

export function emitStreamClaimTelemetry(telemetry, observation = {}) {
  return emitTelemetry(telemetry, TelemetryEvent.STREAM_CLAIM_CHECKED, { classification: observation.classification ?? null, confidence: observation.confidence ?? null, severity: observation.severity ?? null, temporalContext: observation.temporalContext ?? null, intercepted: Boolean(observation.intercepted), worldRevision: observation.worldRevision ?? null, sceneRevision: observation.sceneRevision ?? null });
}

export function emitConsolidationBacklogTelemetry(telemetry, snapshot = {}) {
  return emitTelemetry(telemetry, TelemetryEvent.CONSOLIDATION_BACKLOG, { pendingUnits: snapshot.pendingUnits ?? null, oldestPendingAge: snapshot.oldestPendingAge ?? null, superseded: snapshot.superseded ?? null, staleDiscarded: snapshot.staleDiscarded ?? null, capacity: snapshot.capacity ?? null });
}
