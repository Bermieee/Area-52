import { FailureCode } from './constants.js';
import { CorrectiveRetrievalAction, RetrievalQuality } from './retrieval-control-policy.js';
import { createConsolidationProviderInput, validateConsolidationProviderOutput } from './continuous-consolidation.js';
import { validateTruthMonitorReceipt } from './streaming-truth-observer.js';

export const Wave3Specialists = Object.freeze({
  RETRIEVAL_QUALITY: Object.freeze({ taskType: 'RETRIEVAL_QUALITY', buildInput: buildRetrievalQualityInput, normalize: normalizeRetrievalQuality }),
  CONSOLIDATION: Object.freeze({ taskType: 'CONSOLIDATION', buildInput: buildConsolidationInput, normalize: normalizeConsolidation }),
  STREAM_VERIFY: Object.freeze({ taskType: 'STREAM_VERIFY', buildInput: buildStreamVerifyInput, normalize: normalizeStreamVerify }),
});

export function wave3SpecialistForTask(taskType) { return Wave3Specialists[taskType] ?? null; }

export function buildRetrievalQualityInput(task, input = {}) {
  return promptEnvelope('Adaptive Retrieval Quality', 'Classify evidence usefulness as HIGH, MIXED, or LOW. Relevance is not canonical truth. At most one corrective action may be proposed.', {
    query: input.query ?? null,
    candidateRefs: boundedRefs(input.candidateRefs ?? input.refs ?? [], 64),
    signals: structuredClone(input.signals ?? {}),
    worldRevision: task.worldRevision,
    sceneRevision: task.sceneRevision,
  });
}
export function normalizeRetrievalQuality(text) {
  const value = parseStrictObject(text, 'Retrieval Quality');
  exactKeys(value, ['quality', 'confidence', 'reasoningSummary', 'correctiveAction'], 'Retrieval Quality');
  if (!Object.values(RetrievalQuality).includes(value.quality)) fail(FailureCode.SCHEMA_INVALID, `Unknown retrieval quality: ${value.quality}`);
  if (value.correctiveAction != null && !Object.values(CorrectiveRetrievalAction).includes(value.correctiveAction)) fail(FailureCode.SCHEMA_INVALID, `Unknown corrective action: ${value.correctiveAction}`);
  if (value.quality !== RetrievalQuality.MIXED && value.correctiveAction != null) fail(FailureCode.SCHEMA_INVALID, 'Corrective action is only legal for MIXED retrieval');
  return Object.freeze({ lane: 'retrievalQuality', quality: value.quality, confidence: unit(value.confidence, 'confidence'), reasoningSummary: textField(value.reasoningSummary, 600, 'reasoningSummary'), correctiveAction: value.correctiveAction, canonicalTruthGranted: false });
}

export function buildConsolidationInput(task, input = {}) {
  const bounded=createConsolidationProviderInput(task,input);
  return promptEnvelope('Continuous Consolidation',
    'Produce a bounded proposal-only bundle when evidence supports multiple derived artifacts. Preserve provenance, chronology, ambiguity, unique source facts and per-proposal confidence. Never delete source turns, mutate Memory, promote historical evidence to current canon, or claim Settlement authority.',
    bounded);
}
export function normalizeConsolidation(text, { task, input }) {
  const unit=input?.unit??{};
  const knownArtifactRefs=unit.artifactRefs??task.metadata?.batchSlice?.artifactRefs??[];
  return validateConsolidationProviderOutput(text, {
    unitId:unit.unitId??task.metadata?.batchSlice?.unitId,
    sourceArtifactRefs:knownArtifactRefs,
    knownArtifactRefs,
    sourceRevisionSet: task.sourceRevisionSet,
    worldRevision: task.worldRevision,
    sceneRevision: task.sceneRevision,
    characterStateRevision: task.characterStateRevision,
    policyVersion:unit.policyVersion??task.metadata?.policyVersion,
    provenance:unit.provenance??{},
    currentRevisionSet: task.inputRevisionSet,
  });
}

export function buildStreamVerifyInput(task, input = {}) {
  return promptEnvelope('Streaming Truth Verifier', 'Assess the supplied complete claim span. Historical, figurative, hypothetical, and ambiguous language must not be treated as current-canon violations.', {
    claim: String(input.claim ?? ''),
    claimSpan: structuredClone(input.claimSpan ?? null),
    evidenceRefs: boundedRefs(input.evidenceRefs ?? [], 32),
    worldRevision: task.worldRevision,
    sceneRevision: task.sceneRevision,
  });
}
export function normalizeStreamVerify(text, { input, task }) {
  const value = parseStrictObject(text, 'Streaming Truth Verifier');
  exactKeys(value, ['claimSpan', 'classification', 'confidence', 'severity', 'temporalContext', 'deterministic', 'currentCanonViolation', 'creativeAmbiguity', 'reason'], 'Streaming Truth Verifier');
  return validateTruthMonitorReceipt(value, { claim: String(input.claim ?? ''), context: { worldRevision: task.worldRevision, sceneRevision: task.sceneRevision } });
}

function promptEnvelope(role, instructions, data) {
  return { messages: [
    { role: 'system', content: `Area-52 ${role}. ${instructions} Provider output is advisory and never canonical by itself. Return strict JSON only.` },
    { role: 'user', content: `UNTRUSTED_DATA_JSON\n${JSON.stringify({ data })}` },
  ], data: structuredClone(data) };
}
function parseStrictObject(text, name) {
  if (typeof text !== 'string') fail(FailureCode.MALFORMED_OUTPUT, `${name} output must be JSON text`);
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) fail(FailureCode.MALFORMED_OUTPUT, `${name} output must contain only one JSON object`);
  try { const value = JSON.parse(trimmed); if (!value || typeof value !== 'object' || Array.isArray(value)) fail(FailureCode.SCHEMA_INVALID, `${name} output must be an object`); return value; }
  catch (error) { if (error?.code) throw error; fail(FailureCode.MALFORMED_OUTPUT, `${name} JSON parse failed: ${error.message}`); }
}
function exactKeys(value, keys, name) { const expected = new Set(keys); for (const key of Object.keys(value)) if (!expected.has(key)) fail(FailureCode.SCHEMA_INVALID, `${name} has unsupported field: ${key}`); for (const key of keys) if (!(key in value)) fail(FailureCode.SCHEMA_INVALID, `${name} omitted required field: ${key}`); }
function boundedRefs(values, max) { if (!Array.isArray(values)) fail(FailureCode.SCHEMA_INVALID, 'references must be an array'); const refs = [...new Set(values.map((value) => { if (typeof value !== 'string' || !value) fail(FailureCode.SCHEMA_INVALID, 'reference must be non-empty'); return value; }))]; if (refs.length > max) fail(FailureCode.SCHEMA_INVALID, `reference count exceeds ${max}`); return refs; }
function unit(value, name) { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 1) fail(FailureCode.SCHEMA_INVALID, `${name} must be within 0..1`); return n; }
function textField(value, max, name) { if (typeof value !== 'string') fail(FailureCode.SCHEMA_INVALID, `${name} must be a string`); return value.slice(0, max); }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
