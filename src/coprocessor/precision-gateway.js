import { FailureCode, ResultClass } from './constants.js';
import { createCognitiveTask, createRevisionSet } from './contracts.js';
import { CandidateFreshness, createCandidateBusEnvelope, filterFreshCandidates } from './candidate-bus.js';
import { PrecisionReasonCode, normalizeAdapterRanking } from './precision-validation.js';
import { deterministicPrecisionScore } from './precision-benchmark.js';

export const PRECISION_GATEWAY_CONTRACT_VERSION = '1.0.0';
export const PrecisionStage = Object.freeze({
  DETERMINISTIC_FILTER: 'DETERMINISTIC_FILTER', LATE_INTERACTION: 'LATE_INTERACTION', SEMANTIC_JUDGE: 'SEMANTIC_JUDGE', DETERMINISTIC_FALLBACK: 'DETERMINISTIC_FALLBACK',
});
export const PrecisionFallbackStage = Object.freeze({ NONE: 'NONE', FALLBACK_CAPABILITY: 'FALLBACK_CAPABILITY', DETERMINISTIC_BASELINE: 'DETERMINISTIC_BASELINE', FIRST_STAGE_DEADLINE_CUTOFF: 'FIRST_STAGE_DEADLINE_CUTOFF' });

const DEFAULT_CAPS = Object.freeze({ input: 256, lateInteraction: 64, semanticJudge: 24, final: 12 });

export class PrecisionGateway {
  constructor({ caps = {}, lateInteractionAdapter = null, semanticJudgeAdapter = null, deterministicScore = deterministicPrecisionScore } = {}) {
    this.caps = normalizeCaps({ ...DEFAULT_CAPS, ...caps });
    this.lateInteractionAdapter = lateInteractionAdapter;
    this.semanticJudgeAdapter = semanticJudgeAdapter;
    this.deterministicScore = deterministicScore;
  }

  async run({ candidateSet, query = null, currentRevisionSet = null, conflictSets = [], deadline = {}, requiredCandidateIds = [] } = {}) {
    const envelope = candidateSet?.kind === 'CandidateBusEnvelope'
      ? candidateSet
      : createCandidateBusEnvelope({ ...(candidateSet ?? {}), query: query ?? candidateSet?.query, maxCandidates: this.caps.input });
    if (envelope.inputCandidateCount > this.caps.input) fail(FailureCode.SCHEMA_INVALID, `Precision input exceeds cap=${this.caps.input}`);
    const effectiveQuery = String(query ?? envelope.query ?? '');
    const freshness = currentRevisionSet ? filterFreshCandidates(envelope.candidates, currentRevisionSet) : { fresh: envelope.candidates, stale: [], invalid: [] };
    const freshCandidates = freshness.fresh.map((candidate, index) => ({ ...candidate, inputRank: candidate.inputRank ?? index + 1 }));
    const deterministic = rankDeterministically(freshCandidates, effectiveQuery, this.deterministicScore);
    const lateInput = preserveCredibleConflicts(deterministic.slice(0, this.caps.lateInteraction), deterministic, conflictSets, this.caps.lateInteraction);

    let lateRanking = lateInput.map((entry) => Object.freeze({ candidateId: entry.candidate.candidateId, score: entry.score, reasonCodes: entry.reasonCodes }));
    const stagesUsed = [PrecisionStage.DETERMINISTIC_FILTER];
    const stageProvenance = [];
    let fallbackStage = PrecisionFallbackStage.NONE;
    let degradedQuality = false;

    if (this.lateInteractionAdapter) {
      try {
        const raw = await this.lateInteractionAdapter.rank({ query: effectiveQuery, candidates: lateInput.map(adapterCandidate) });
        lateRanking = normalizeAdapterRanking(raw, lateInput.map((entry) => entry.candidate), { reasonCode: PrecisionReasonCode.LATE_INTERACTION_SELECTED, maxResults: this.caps.lateInteraction });
        stagesUsed.push(PrecisionStage.LATE_INTERACTION);
        stageProvenance.push(adapterProvenance(this.lateInteractionAdapter, PrecisionStage.LATE_INTERACTION));
      } catch (error) {
        degradedQuality = true;
        fallbackStage = PrecisionFallbackStage.DETERMINISTIC_BASELINE;
        stagesUsed.push(PrecisionStage.DETERMINISTIC_FALLBACK);
      }
    } else {
      fallbackStage = PrecisionFallbackStage.DETERMINISTIC_BASELINE;
      stagesUsed.push(PrecisionStage.DETERMINISTIC_FALLBACK);
    }

    let ranked = mergeRanking(lateRanking, lateInput);
    const semanticEligible = this.semanticJudgeAdapter && !deadlineExceeded(deadline);
    if (semanticEligible) {
      const semanticInput = preserveCredibleConflicts(ranked.slice(0, this.caps.semanticJudge), ranked, conflictSets, this.caps.semanticJudge);
      try {
        const raw = await this.semanticJudgeAdapter.rank({ query: effectiveQuery, candidates: semanticInput.map(adapterCandidate) });
        const semanticRanking = normalizeAdapterRanking(raw, semanticInput.map((entry) => entry.candidate), { reasonCode: PrecisionReasonCode.SEMANTIC_CONFIRMED, maxResults: this.caps.semanticJudge });
        ranked = mergeRanking(semanticRanking, semanticInput);
        stagesUsed.push(PrecisionStage.SEMANTIC_JUDGE);
        stageProvenance.push(adapterProvenance(this.semanticJudgeAdapter, PrecisionStage.SEMANTIC_JUDGE));
      } catch (error) {
        degradedQuality = true;
        if (fallbackStage === PrecisionFallbackStage.NONE) fallbackStage = PrecisionFallbackStage.FALLBACK_CAPABILITY;
      }
    } else if (this.semanticJudgeAdapter && deadlineExceeded(deadline)) {
      degradedQuality = true;
      fallbackStage = PrecisionFallbackStage.FIRST_STAGE_DEADLINE_CUTOFF;
    }

    const conflictPreserved = preserveCredibleConflicts(ranked.slice(0, this.caps.final), ranked, conflictSets, this.caps.final);
    const selected = preserveRequiredCandidates(conflictPreserved, ranked, requiredCandidateIds, this.caps.final, conflictSets);
    const byId = new Map(selected.map((entry) => [entry.candidate.candidateId, entry]));
    for (const id of requiredCandidateIds) if (!byId.has(id) && freshCandidates.some((candidate) => candidate.candidateId === id)) fail(FailureCode.UNKNOWN_REFERENCE, `Precision omitted required candidate: ${id}`);

    const results = selected.map((entry, outputIndex) => precisionResult(entry, outputIndex + 1, conflictSets));
    const preservedConflicts = conflictSets.filter((set) => {
      const refs = [...new Set(set.refs ?? [])];
      return refs.length > 1 && refs.every((ref) => byId.has(ref));
    }).map((set) => set.id ?? (set.refs ?? []).join('+'));

    return deepFreeze({
      kind: 'PrecisionResultSet', contractVersion: PRECISION_GATEWAY_CONTRACT_VERSION,
      candidateSetId: envelope.candidateSetId,
      query: effectiveQuery,
      intentFingerprint: envelope.intentFingerprint,
      sourceRevisionSet: [...envelope.sourceRevisionSet], worldRevision: envelope.worldRevision, sceneRevision: envelope.sceneRevision,
      inputCandidateCount: envelope.inputCandidateCount,
      normalizedCandidateCount: envelope.candidateCount,
      duplicateNominations: envelope.duplicateNominations,
      staleRejectedCount: freshness.stale.length,
      invalidRejectedCount: freshness.invalid.length,
      lateInteractionCandidateCount: lateInput.length,
      semanticJudgeCandidateCount: stagesUsed.includes(PrecisionStage.SEMANTIC_JUDGE) ? Math.min(ranked.length, this.caps.semanticJudge) : 0,
      finalCandidateCount: results.length,
      caps: { ...this.caps }, stagesUsed: Object.freeze(stagesUsed), fallbackStage, degradedQuality,
      stageProvenance: Object.freeze(stageProvenance), conflictSetsPreserved: Object.freeze(preservedConflicts),
      results: Object.freeze(results),
      authorityGranted: false, settlementAuthority: false, canonicalMutation: false,
    });
  }
}

export function createPrecisionTask({
  taskId = 'precision', turnId, correlationId, inputRevisionSet = {}, intentFingerprint, resultClass = ResultClass.REQUIRED,
  softDeadline = 60, hardDeadline = 120, includeSemanticJudge = true, expectedOutputTokens = 800,
} = {}) {
  const primary = includeSemanticJudge
    ? [{ id: 'LATE_INTERACTION', minVersion: 1, preferredVersion: 1 }, { id: 'CROSS_ENCODER_RERANK', minVersion: 1, preferredVersion: 1 }]
    : [{ id: 'LATE_INTERACTION', minVersion: 1, preferredVersion: 1 }];
  return createCognitiveTask({
    taskId, taskType: 'PRECISION_RERANK', turnId, correlationId,
    requiredCapabilities: primary.map((request) => request.id), capabilityRequests: primary,
    fallbackCapabilitySets: [
      [{ id: 'RERANK', minVersion: 1, preferredVersion: 1 }],
      [{ id: 'SEMANTIC_JUDGMENT', minVersion: 1, preferredVersion: 1 }],
    ],
    cognitiveLayer: 'L1', resultClass, placement: 'HOT', compilerLane: 'precisionResults',
    inputRevisionSet: createRevisionSet(inputRevisionSet), softDeadline, hardDeadline,
    fallbackPolicy: { type: 'PRECISION_LADDER', maxRetries: 1, stages: ['PREFERRED_PRECISION', 'FALLBACK_PRECISION', 'DETERMINISTIC_BASELINE'] },
    intentFingerprint,
    metadata: { expectedOutputTokens, qualityWeight: resultClass === ResultClass.REQUIRED ? 1 : 0.5, deterministicFallback: 'DETERMINISTIC_BASELINE', maxLatencyMs: hardDeadline },
  });
}

export function precisionDeadlineDecision({ now = 0, softDeadline = 0, hardDeadline = 0, firstStageReady = false, secondStageReady = false, secondStageRequired = false } = {}) {
  const t = Number(now) || 0, soft = Number(softDeadline) || 0, hard = Number(hardDeadline) || 0;
  if (t > hard) {
    if (firstStageReady) return Object.freeze({ action: 'USE_FIRST_STAGE', reason: 'HARD_DEADLINE_SECOND_STAGE_MISSED', canBlockSeal: false });
    return Object.freeze({ action: 'DETERMINISTIC_FALLBACK', reason: 'HARD_DEADLINE_NO_PRECISION_RESULT', canBlockSeal: false });
  }
  if (secondStageReady) return Object.freeze({ action: 'USE_SECOND_STAGE', reason: 'BEST_AVAILABLE', canBlockSeal: false });
  if (t > soft && firstStageReady && !secondStageRequired) return Object.freeze({ action: 'USE_FIRST_STAGE', reason: 'SOFT_DEADLINE_CUTOFF', canBlockSeal: false });
  return Object.freeze({ action: 'WAIT_WITHIN_BUDGET', reason: 'WITHIN_DEADLINE', canBlockSeal: Boolean(secondStageRequired) });
}

function rankDeterministically(candidates, query, scoreFn) {
  const scored = candidates.map((candidate, index) => {
    const raw = Number(scoreFn(query, candidate.representationText ?? candidate.candidateId));
    const relevance = normalizeScore(raw);
    const reasonCodes = [PrecisionReasonCode.QUERY_MATCH];
    if (candidate.temporalHints?.length || candidate.truthStatus !== 'UNKNOWN') reasonCodes.push(PrecisionReasonCode.TEMPORAL_MATCH);
    if (candidate.sceneRelevance != null) reasonCodes.push(PrecisionReasonCode.SCENE_MATCH);
    if ((candidate.nominatedBy?.length ?? 0) > 1) reasonCodes.push(PrecisionReasonCode.MULTI_CHANNEL_SUPPORT);
    return { candidate, score: relevance, reasonCodes, inputOrder: index };
  });
  return scored.sort((a, b) => b.score - a.score || a.inputOrder - b.inputOrder || a.candidate.candidateId.localeCompare(b.candidate.candidateId));
}
function normalizeScore(value) { if (!Number.isFinite(value)) return 0; return Math.max(0, Math.min(1, (value + 8) / 16)); }
function adapterCandidate(entry) { return { ref: entry.candidate.candidateId, candidateId: entry.candidate.candidateId, text: entry.candidate.representationText ?? entry.candidate.candidateId, truthStatus: entry.candidate.truthStatus, temporalHints: [...entry.candidate.temporalHints] }; }
function mergeRanking(ranking, entries) {
  const byId = new Map(entries.map((entry) => [entry.candidate.candidateId, entry]));
  const output = [];
  for (const row of ranking) {
    const source = byId.get(row.candidateId);
    if (!source) continue;
    output.push({ candidate: source.candidate, score: row.score, reasonCodes: [...new Set([...(source.reasonCodes ?? []), ...(row.reasonCodes ?? [])])] });
  }
  for (const entry of entries) if (!output.some((row) => row.candidate.candidateId === entry.candidate.candidateId)) output.push(entry);
  return output;
}
function preserveCredibleConflicts(selected, fullRanking, conflictSets, cap) {
  const out = [...selected];
  const chosen = new Set(out.map((entry) => entry.candidate.candidateId));
  const byId = new Map(fullRanking.map((entry) => [entry.candidate.candidateId, entry]));
  for (const set of conflictSets ?? []) {
    if (set?.credible === false) continue;
    const refs = [...new Set(set?.refs ?? [])].filter((ref) => byId.has(ref));
    if (refs.length < 2 || !refs.some((ref) => chosen.has(ref))) continue;
    for (const ref of refs) {
      if (chosen.has(ref)) continue;
      if (out.length >= cap) {
        const replaceIndex = findReplaceableIndex(out, refs, conflictSets);
        if (replaceIndex >= 0) { chosen.delete(out[replaceIndex].candidate.candidateId); out.splice(replaceIndex, 1); }
        else continue;
      }
      out.push(byId.get(ref)); chosen.add(ref);
    }
  }
  return out.slice(0, cap).sort((a, b) => b.score - a.score || a.candidate.candidateId.localeCompare(b.candidate.candidateId));
}
function preserveRequiredCandidates(selected, fullRanking, requiredCandidateIds, cap, conflictSets) {
  const out = [...selected];
  const chosen = new Set(out.map((entry) => entry.candidate.candidateId));
  const byId = new Map(fullRanking.map((entry) => [entry.candidate.candidateId, entry]));
  const required = [...new Set(requiredCandidateIds ?? [])].filter((id) => byId.has(id));
  if (required.length > cap) fail(FailureCode.SCHEMA_INVALID, `required precision candidates exceed final cap=${cap}`);
  for (const id of required) {
    if (chosen.has(id)) continue;
    if (out.length >= cap) {
      const replaceIndex = findReplaceableIndex(out, required, conflictSets);
      if (replaceIndex < 0) fail(FailureCode.SCHEMA_INVALID, `cannot preserve required precision candidate within final cap: ${id}`);
      chosen.delete(out[replaceIndex].candidate.candidateId);
      out.splice(replaceIndex, 1);
    }
    out.push(byId.get(id)); chosen.add(id);
  }
  return out.slice(0, cap).sort((a, b) => b.score - a.score || a.candidate.candidateId.localeCompare(b.candidate.candidateId));
}

function findReplaceableIndex(entries, protectedRefs, conflictSets) {
  const globallyProtected = new Set(protectedRefs);
  for (const set of conflictSets ?? []) if (set?.credible !== false) for (const ref of set?.refs ?? []) globallyProtected.add(ref);
  for (let i = entries.length - 1; i >= 0; i--) if (!globallyProtected.has(entries[i].candidate.candidateId)) return i;
  return -1;
}
function precisionResult(entry, outputRank, conflictSets) {
  const candidate = entry.candidate;
  const conflict = (conflictSets ?? []).some((set) => set?.credible !== false && (set.refs ?? []).includes(candidate.candidateId) && (set.refs ?? []).length > 1);
  const reasonCodes = [...new Set([...(entry.reasonCodes ?? []), ...(conflict ? [PrecisionReasonCode.CONTRADICTION_PRESERVED] : [])])];
  return Object.freeze({
    kind: 'PrecisionResult', candidateRef: candidate.candidateId, inputRank: candidate.inputRank, outputRank,
    relevanceScore: entry.score, semanticScore: reasonCodes.includes(PrecisionReasonCode.SEMANTIC_CONFIRMED) ? entry.score : null,
    temporalCompatibility: temporalCompatibility(candidate), sceneCompatibility: candidate.sceneRelevance,
    reasonCodes: Object.freeze(reasonCodes), evidenceRefs: Object.freeze([...candidate.evidenceRefs]), sourceRevisionRefs: Object.freeze([...candidate.sourceRevisionRefs]),
    artifactRef: structuredClone(candidate.artifactRef), provenance: structuredClone(candidate.provenance), nominatedBy: Object.freeze([...candidate.nominatedBy]),
    authorityClass: candidate.authorityClass, truthStatus: candidate.truthStatus,
    authorityGranted: false, settlementAuthority: false,
  });
}
function temporalCompatibility(candidate) {
  if (candidate.truthStatus === 'CURRENT') return 1;
  if (candidate.truthStatus === 'HISTORICAL' || candidate.truthStatus === 'SUPERSEDED') return 0.75;
  if (candidate.truthStatus === 'CONTRADICTED' || candidate.truthStatus === 'UNRESOLVED' || candidate.truthStatus === 'UNCERTAIN') return 0.5;
  return null;
}
function adapterProvenance(adapter, stage) { return Object.freeze({ stage, adapterId: adapter.adapterId ?? null, providerId: adapter.providerId ?? null, modelId: adapter.modelId ?? null, authorityGranted: false }); }
function deadlineExceeded(deadline) { if (deadline?.hardDeadline == null || deadline?.now == null) return false; return Number(deadline.now) > Number(deadline.hardDeadline); }
function normalizeCaps(caps) {
  const input = boundedCap(caps.input, 1, 4096, 'input');
  const lateInteraction = Math.min(input, boundedCap(caps.lateInteraction, 1, input, 'lateInteraction'));
  const semanticJudge = Math.min(lateInteraction, boundedCap(caps.semanticJudge, 1, lateInteraction, 'semanticJudge'));
  const final = Math.min(semanticJudge, boundedCap(caps.final, 1, semanticJudge, 'final'));
  return Object.freeze({ input, lateInteraction, semanticJudge, final });
}
function boundedCap(value, min, max, name) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) fail(FailureCode.SCHEMA_INVALID, `precision cap ${name} must be ${min}..${max}`); return n; }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
