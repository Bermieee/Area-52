import { FailureCode } from './constants.js';
import { validatePrecisionProviderOutput } from './precision-validation.js';

export const PrecisionSpecialists = Object.freeze({
  PRECISION_RERANK: Object.freeze({ taskType: 'PRECISION_RERANK', buildInput: buildPrecisionInput, normalize: normalizePrecisionOutput }),
  PRECISION_SEMANTIC_JUDGE: Object.freeze({ taskType: 'PRECISION_SEMANTIC_JUDGE', buildInput: buildPrecisionInput, normalize: normalizePrecisionOutput }),
});

export function precisionSpecialistForTask(taskType) { return PrecisionSpecialists[taskType] ?? null; }

export function buildPrecisionInput(task, input = {}) {
  const candidates = normalizeInputCandidates(input.candidates ?? input.candidateSet?.candidates ?? []);
  const maxResults = Math.max(1, Math.min(candidates.length || 1, Number(input.maxResults ?? task.metadata?.maxResults ?? 12)));
  return {
    messages: [
      { role: 'system', content: 'Area-52 Precision worker. Rank only supplied candidate IDs. Ranking metadata is not truth confidence or authority. Preserve supplied temporal/authority status exactly. Return strict JSON only.' },
      { role: 'user', content: `UNTRUSTED_DATA_JSON\n${JSON.stringify({ data: { query: input.query ?? null, candidates, maxResults, requiredCandidateIds: input.requiredCandidateIds ?? [], sourceRevisionSet: task.sourceRevisionSet, worldRevision: task.worldRevision, sceneRevision: task.sceneRevision } })}` },
    ],
    data: { query: input.query ?? null, candidates, maxResults, requiredCandidateIds: [...(input.requiredCandidateIds ?? [])] },
  };
}

export function normalizePrecisionOutput(text, { input, task }) {
  const candidates = normalizeInputCandidates(input.candidates ?? input.candidateSet?.candidates ?? []);
  const normalized = validatePrecisionProviderOutput(text, {
    candidates,
    requiredCandidateIds: input.requiredCandidateIds ?? [],
    maxResults: Math.max(1, Math.min(candidates.length || 1, Number(input.maxResults ?? task.metadata?.maxResults ?? 12))),
  });
  return Object.freeze({
    lane: 'precisionResults',
    results: normalized.results,
    stageSummary: normalized.stageSummary,
    evidence: normalized.results.map((row) => ({
      id: row.candidateId,
      semanticKey: `precision:${row.candidateId}`,
      value: { score: row.score, reasonCodes: row.reasonCodes },
      authority: row.authorityClass,
      temporalStatus: row.truthStatus,
    })),
    authorityGranted: false,
    settlementAuthority: false,
  });
}

function normalizeInputCandidates(values) {
  if (!Array.isArray(values)) fail(FailureCode.SCHEMA_INVALID, 'Precision input candidates must be an array');
  const seen = new Set();
  return values.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') fail(FailureCode.SCHEMA_INVALID, 'Precision input candidate must be an object');
    const candidateId = required(candidate.candidateId ?? candidate.ref, 'candidateId');
    if (seen.has(candidateId)) fail(FailureCode.SCHEMA_INVALID, `Duplicate Precision input candidate: ${candidateId}`);
    seen.add(candidateId);
    return {
      candidateId,
      representationText: String(candidate.representationText ?? candidate.text ?? candidate.statement ?? candidate.summary ?? ''),
      sourceRevisionRefs: uniqueStrings(candidate.sourceRevisionRefs ?? candidate.sourceRevisionSet ?? []),
      truthStatus: candidate.truthStatus ?? 'UNKNOWN',
      authorityClass: candidate.authorityClass ?? 'UNKNOWN',
      temporalHints: uniqueStrings(candidate.temporalHints ?? []),
      entityRefs: uniqueStrings(candidate.entityRefs ?? []),
      relationshipRefs: uniqueStrings(candidate.relationshipRefs ?? []),
    };
  });
}
function required(value, name) { if (typeof value !== 'string' || !value.trim()) fail(FailureCode.SCHEMA_INVALID, `${name} must be a non-empty string`); return value.trim(); }
function uniqueStrings(values) { if (!Array.isArray(values)) fail(FailureCode.SCHEMA_INVALID, 'expected array'); return [...new Set(values.map((value) => required(value, 'reference')))]; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
