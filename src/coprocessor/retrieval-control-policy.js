export const RetrievalQuality = Object.freeze({ HIGH: 'HIGH', MIXED: 'MIXED', LOW: 'LOW' });
export const CorrectiveRetrievalAction = Object.freeze({
  QUERY_REFORMULATION: 'QUERY_REFORMULATION',
  SPARSE_RETRY: 'SPARSE_RETRY',
  DENSE_RETRY: 'DENSE_RETRY',
  GRAPH_EXPANSION: 'GRAPH_EXPANSION',
  ENTITY_CONSTRAINED_SEARCH: 'ENTITY_CONSTRAINED_SEARCH',
  TEMPORAL_NARROWING: 'TEMPORAL_NARROWING',
});

export function retrievalControlDecision({
  quality,
  simpleTurn = false,
  correctiveAttempt = 0,
  maxCorrectiveAttempts = 1,
  recommendedAction = CorrectiveRetrievalAction.QUERY_REFORMULATION,
} = {}) {
  const max = Math.min(1, Math.max(0, Number(maxCorrectiveAttempts) || 0));
  if (simpleTurn) return receipt({ action: 'SKIP', reason: 'HOT_COGNITION_SUFFICIENT', allowLongTermMemory: false, corrective: false, quality: quality ?? null });
  if (quality === RetrievalQuality.HIGH) return receipt({ action: 'PROCEED', reason: 'HIGH_QUALITY', allowLongTermMemory: true, corrective: false, quality });
  if (quality === RetrievalQuality.MIXED && Number(correctiveAttempt) < max) {
    if (!Object.values(CorrectiveRetrievalAction).includes(recommendedAction)) throw new TypeError(`unsupported corrective retrieval action: ${recommendedAction}`);
    return receipt({ action: 'CORRECTIVE_RETRIEVAL', reason: 'MIXED_QUALITY', allowLongTermMemory: false, corrective: true, nextAttempt: Number(correctiveAttempt) + 1, quality, correctiveAction: recommendedAction });
  }
  if (quality === RetrievalQuality.MIXED) return receipt({ action: 'NO_LONG_TERM_MEMORY', reason: 'CORRECTIVE_BUDGET_EXHAUSTED', allowLongTermMemory: false, corrective: false, quality });
  if (quality === RetrievalQuality.LOW) return receipt({ action: 'NO_LONG_TERM_MEMORY', reason: 'LOW_QUALITY', allowLongTermMemory: false, corrective: false, quality });
  throw new TypeError('quality must be HIGH, MIXED or LOW');
}

export function evaluateRetrievalQuality({
  candidateCount = 0,
  relevantCount = 0,
  contradictoryCount = 0,
  staleCount = 0,
  unresolvedCount = 0,
  requiredCoverage = 1,
  confidence = 0,
} = {}) {
  const total = Math.max(0, Number(candidateCount) || 0);
  const relevant = Math.max(0, Math.min(total, Number(relevantCount) || 0));
  const contradictions = Math.max(0, Number(contradictoryCount) || 0);
  const stale = Math.max(0, Number(staleCount) || 0);
  const unresolved = Math.max(0, Number(unresolvedCount) || 0);
  const coverage = total ? relevant / total : 0;
  const required = clamp(requiredCoverage);
  const cf = clamp(confidence);
  let quality;
  let reason;
  if (!total || !relevant || coverage < Math.min(0.25, required)) { quality = RetrievalQuality.LOW; reason = 'INSUFFICIENT_RELEVANT_EVIDENCE'; }
  else if (contradictions || stale || unresolved || coverage < required || cf < 0.65) { quality = RetrievalQuality.MIXED; reason = 'USEFUL_WITH_UNCERTAINTY'; }
  else { quality = RetrievalQuality.HIGH; reason = 'USEFUL_AND_WELL_COVERED'; }
  return Object.freeze({ kind: 'RetrievalQualityReceipt', quality, reason, candidateCount: total, relevantCount: relevant, contradictoryCount: contradictions, staleCount: stale, unresolvedCount: unresolved, coverage, confidence: cf, canonicalTruthGranted: false });
}

export class AdaptiveRetrievalController {
  constructor({ maxCorrectiveAttempts = 1, chooseCorrectiveAction = null } = {}) {
    this.maxCorrectiveAttempts = Math.min(1, Math.max(0, Number(maxCorrectiveAttempts) || 0));
    this.chooseCorrectiveAction = chooseCorrectiveAction;
  }

  async run({ retrieve, evaluate = evaluateRetrievalQuality, query, context = {}, simpleTurn = false } = {}) {
    if (typeof retrieve !== 'function') throw new TypeError('retrieve is required');
    if (typeof evaluate !== 'function') throw new TypeError('evaluate is required');
    if (simpleTurn) return Object.freeze({ action: 'SKIP', attempts: 0, result: null, quality: null, allowLongTermMemory: false, correctivePasses: 0, canonicalTruthGranted: false });
    let attempt = 0;
    let result = await retrieve({ query, context, attempt, correctiveAction: null });
    let quality = await evaluate(result, { query, context, attempt });
    let decision = retrievalControlDecision({ quality: quality.quality ?? quality, correctiveAttempt: attempt, maxCorrectiveAttempts: this.maxCorrectiveAttempts, recommendedAction: this.#action(result, quality, context) });
    while (decision.action === 'CORRECTIVE_RETRIEVAL') {
      attempt += 1;
      result = await retrieve({ query, context, attempt, correctiveAction: decision.correctiveAction });
      quality = await evaluate(result, { query, context, attempt });
      decision = retrievalControlDecision({ quality: quality.quality ?? quality, correctiveAttempt: attempt, maxCorrectiveAttempts: this.maxCorrectiveAttempts, recommendedAction: this.#action(result, quality, context) });
    }
    return Object.freeze({ action: decision.action, attempts: attempt + 1, correctivePasses: attempt, result: structuredClone(result), quality: structuredClone(quality), allowLongTermMemory: decision.allowLongTermMemory, reason: decision.reason, canonicalTruthGranted: false });
  }

  #action(result, quality, context) {
    const proposed = typeof this.chooseCorrectiveAction === 'function' ? this.chooseCorrectiveAction({ result, quality, context }) : null;
    return proposed ?? CorrectiveRetrievalAction.QUERY_REFORMULATION;
  }
}

function receipt(value) { return Object.freeze({ ...value, canonicalTruthGranted: false }); }
function clamp(value) { const n = Number(value); if (!Number.isFinite(n)) return 0; return Math.max(0, Math.min(1, n)); }
