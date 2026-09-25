import { TelemetryEvent } from './constants.js';
import { emitTelemetry } from './telemetry.js';

export function emitPrecisionRequest(telemetry, { taskId = null, inputCandidateCount = 0, qualityClass = null, correctivePass = false, destination = 'FOREGROUND' } = {}) {
  return emitTelemetry(telemetry, TelemetryEvent.PRECISION_REQUEST, { taskId, inputCandidateCount, qualityClass, correctivePass, destination });
}
export function emitPrecisionStage(telemetry, { taskId = null, stage, inputCandidateCount = 0, outputCandidateCount = 0, latencyMs = null, providerId = null, capability = null } = {}) {
  return emitTelemetry(telemetry, TelemetryEvent.PRECISION_STAGE, { taskId, stage, inputCandidateCount, outputCandidateCount, latencyMs, providerId, capability });
}
export function emitPrecisionFallback(telemetry, { taskId = null, fallbackStage, reason, destination = 'FOREGROUND' } = {}) {
  return emitTelemetry(telemetry, TelemetryEvent.PRECISION_FALLBACK, { taskId, fallbackStage, reason, destination });
}
export function emitCandidateRejected(telemetry, { taskId = null, candidateRef = null, reason, stale = false, authorityViolation = false } = {}) {
  return emitTelemetry(telemetry, TelemetryEvent.CANDIDATE_REJECTED, { taskId, candidateRef, reason, stale, authorityViolation });
}
export function emitCandidateDeduped(telemetry, { taskId = null, evidenceIdentity = null, nominatedBy = [], duplicateCount = 0 } = {}) {
  return emitTelemetry(telemetry, TelemetryEvent.CANDIDATE_DEDUPED, { taskId, evidenceIdentity, nominatedBy, duplicateCount });
}

export function summarizePrecisionTelemetry(events = []) {
  const summary = { requests: 0, inputCandidates: 0, outputCandidates: 0, correctivePasses: 0, staleRejected: 0, authorityRejected: 0, deduped: 0, fallbacks: {}, stages: {}, destinations: {} };
  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === TelemetryEvent.PRECISION_REQUEST) {
      summary.requests += 1; summary.inputCandidates += Number(payload.inputCandidateCount ?? 0); if (payload.correctivePass) summary.correctivePasses += 1;
      if (payload.destination) summary.destinations[payload.destination] = (summary.destinations[payload.destination] ?? 0) + 1;
    }
    if (event.type === TelemetryEvent.PRECISION_STAGE) {
      summary.outputCandidates += Number(payload.outputCandidateCount ?? 0); if (payload.stage) summary.stages[payload.stage] = (summary.stages[payload.stage] ?? 0) + 1;
    }
    if (event.type === TelemetryEvent.PRECISION_FALLBACK && payload.fallbackStage) summary.fallbacks[payload.fallbackStage] = (summary.fallbacks[payload.fallbackStage] ?? 0) + 1;
    if (event.type === TelemetryEvent.CANDIDATE_REJECTED) { if (payload.stale) summary.staleRejected += 1; if (payload.authorityViolation) summary.authorityRejected += 1; }
    if (event.type === TelemetryEvent.CANDIDATE_DEDUPED) summary.deduped += Number(payload.duplicateCount ?? 1);
  }
  return Object.freeze({ ...summary, fallbacks: Object.freeze(summary.fallbacks), stages: Object.freeze(summary.stages), destinations: Object.freeze(summary.destinations) });
}
