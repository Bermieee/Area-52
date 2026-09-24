import { FailureCode } from './constants.js';
import { CandidateTruthStatus } from './candidate-bus.js';

export const PrecisionReasonCode = Object.freeze({
  QUERY_MATCH: 'QUERY_MATCH',
  INTENT_MATCH: 'INTENT_MATCH',
  TEMPORAL_MATCH: 'TEMPORAL_MATCH',
  SCENE_MATCH: 'SCENE_MATCH',
  MULTI_CHANNEL_SUPPORT: 'MULTI_CHANNEL_SUPPORT',
  LATE_INTERACTION_SELECTED: 'LATE_INTERACTION_SELECTED',
  SEMANTIC_CONFIRMED: 'SEMANTIC_CONFIRMED',
  CONTRADICTION_PRESERVED: 'CONTRADICTION_PRESERVED',
  DETERMINISTIC_FALLBACK: 'DETERMINISTIC_FALLBACK',
  PROVIDER_RERANK: 'PROVIDER_RERANK',
});
const REASONS = new Set(Object.values(PrecisionReasonCode));

export function validatePrecisionProviderOutput(valueOrText, {
  candidates = [], requiredCandidateIds = [], maxResults = candidates.length || 1,
} = {}) {
  const value = typeof valueOrText === 'string' ? parseStrictObject(valueOrText, 'Precision') : structuredClone(valueOrText);
  exactKeys(value, ['results', 'stageSummary'], 'Precision');
  if (!Array.isArray(value.results)) fail(FailureCode.SCHEMA_INVALID, 'Precision.results must be an array');
  if (value.results.length > Math.max(0, Number(maxResults) || 0)) fail(FailureCode.SCHEMA_INVALID, `Precision output exceeds maxResults=${maxResults}`);
  const allowed = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const seen = new Set();
  const normalized = value.results.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(FailureCode.SCHEMA_INVALID, 'Precision result row must be an object');
    exactKeys(row, ['candidateId', 'score', 'reasonCodes', 'sourceRevisionRefs', 'truthStatus', 'authorityClass'], 'Precision.result');
    const candidateId = required(row.candidateId, 'Precision.result.candidateId');
    const candidate = allowed.get(candidateId);
    if (!candidate) fail(FailureCode.UNKNOWN_REFERENCE, `Precision invented or returned unknown candidate: ${candidateId}`);
    if (seen.has(candidateId)) fail(FailureCode.SCHEMA_INVALID, `Duplicate Precision candidate result: ${candidateId}`);
    seen.add(candidateId);
    const score = unit(row.score, 'Precision.result.score');
    if (!Array.isArray(row.reasonCodes)) fail(FailureCode.SCHEMA_INVALID, 'Precision.reasonCodes must be an array');
    const reasonCodes = [...new Set(row.reasonCodes.map((code) => required(code, 'Precision.reasonCode')))];
    for (const code of reasonCodes) if (!REASONS.has(code)) fail(FailureCode.SCHEMA_INVALID, `Unknown Precision reason code: ${code}`);
    const sourceRevisionRefs = uniqueStrings(row.sourceRevisionRefs);
    if (!sameSet(sourceRevisionRefs, candidate.sourceRevisionRefs ?? [])) fail(FailureCode.INVALID_REVISION, `Precision source revision mismatch for ${candidateId}`);
    if (row.authorityClass !== candidate.authorityClass) fail(FailureCode.AUTHORITY_VIOLATION, `Precision cannot change authorityClass for ${candidateId}`);
    if (row.truthStatus !== candidate.truthStatus) {
      if (candidate.truthStatus === CandidateTruthStatus.HISTORICAL && row.truthStatus === CandidateTruthStatus.CURRENT) {
        fail(FailureCode.AUTHORITY_VIOLATION, `Precision cannot synthesize CURRENT from HISTORICAL candidate ${candidateId}`);
      }
      fail(FailureCode.AUTHORITY_VIOLATION, `Precision cannot change truthStatus for ${candidateId}`);
    }
    return Object.freeze({ candidateId, score, reasonCodes: Object.freeze(reasonCodes), sourceRevisionRefs: Object.freeze(sourceRevisionRefs), truthStatus: candidate.truthStatus, authorityClass: candidate.authorityClass });
  });
  for (const id of requiredCandidateIds) if (!seen.has(id)) fail(FailureCode.UNKNOWN_REFERENCE, `Precision omitted required candidate: ${id}`);
  const stageSummary = value.stageSummary == null ? null : boundedString(value.stageSummary, 600, 'stageSummary');
  return Object.freeze({ results: Object.freeze(normalized), stageSummary, authorityGranted: false, settlementAuthority: false });
}

export function normalizeAdapterRanking(rows, candidates, { reasonCode = PrecisionReasonCode.PROVIDER_RERANK, maxResults = candidates.length } = {}) {
  if (!Array.isArray(rows)) fail(FailureCode.SCHEMA_INVALID, 'precision adapter ranking must be an array');
  const allowed = new Map(candidates.map((candidate) => [candidate.candidateId ?? candidate.ref, candidate]));
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const candidateId = required(row?.candidateId ?? row?.ref, 'precision adapter candidateId');
    if (!allowed.has(candidateId)) fail(FailureCode.UNKNOWN_REFERENCE, `precision adapter invented candidate: ${candidateId}`);
    if (seen.has(candidateId)) fail(FailureCode.SCHEMA_INVALID, `precision adapter duplicated candidate: ${candidateId}`);
    seen.add(candidateId);
    const score = unit(row.score, 'precision adapter score');
    out.push(Object.freeze({ candidateId, score, reasonCodes: Object.freeze([reasonCode]) }));
    if (out.length >= maxResults) break;
  }
  return Object.freeze(out);
}

function parseStrictObject(text, name) {
  if (typeof text !== 'string') fail(FailureCode.MALFORMED_OUTPUT, `${name} output must be JSON text`);
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) fail(FailureCode.MALFORMED_OUTPUT, `${name} output must contain only one JSON object`);
  try {
    const value = JSON.parse(trimmed);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(FailureCode.SCHEMA_INVALID, `${name} output must be an object`);
    return value;
  } catch (error) {
    if (error?.code) throw error;
    fail(FailureCode.MALFORMED_OUTPUT, `${name} JSON parse failed: ${error.message}`);
  }
}
function exactKeys(value, keys, name) { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) fail(FailureCode.SCHEMA_INVALID, `${name} has unsupported field: ${key}`); for (const key of keys) if (!(key in value)) fail(FailureCode.SCHEMA_INVALID, `${name} omitted required field: ${key}`); }
function unit(value, name) { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 1) fail(FailureCode.SCHEMA_INVALID, `${name} must be within 0..1`); return n; }
function boundedString(value, max, name) { if (typeof value !== 'string') fail(FailureCode.SCHEMA_INVALID, `${name} must be a string`); return value.slice(0, max); }
function required(value, name) { if (typeof value !== 'string' || !value.trim()) fail(FailureCode.SCHEMA_INVALID, `${name} must be a non-empty string`); return value.trim(); }
function uniqueStrings(values) { if (!Array.isArray(values)) fail(FailureCode.SCHEMA_INVALID, 'sourceRevisionRefs must be an array'); return [...new Set(values.map((v) => required(v, 'sourceRevisionRef')))].sort(); }
function sameSet(a, b) { const aa = [...a].sort(), bb = [...b].sort(); return aa.length === bb.length && aa.every((v, i) => v === bb[i]); }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
