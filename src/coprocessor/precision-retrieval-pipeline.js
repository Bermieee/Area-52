import { AdaptiveRetrievalController, evaluateRetrievalQuality, RetrievalQuality } from './retrieval-control-policy.js';
import { createCandidateBusEnvelope } from './candidate-bus.js';

export class PrecisionRetrievalPipeline {
  constructor({ precisionGateway, maxCorrectiveAttempts = 1 } = {}) {
    if (!precisionGateway || typeof precisionGateway.run !== 'function') throw new TypeError('PrecisionRetrievalPipeline requires precisionGateway.run');
    this.precisionGateway = precisionGateway;
    this.controller = new AdaptiveRetrievalController({ maxCorrectiveAttempts: Math.min(1, Math.max(0, Number(maxCorrectiveAttempts) || 0)) });
  }

  async run({
    query,
    initialCandidateSet,
    correctiveRetrieve = null,
    qualityEvaluator = evaluateCandidateSetQuality,
    simpleTurn = false,
    currentRevisionSet = null,
    conflictSets = [],
    deadline = {},
  } = {}) {
    if (simpleTurn) return frozen({ action: 'SKIP', retrievalQuality: null, correctivePasses: 0, precision: null, allowLongTermMemory: false, authorityGranted: false });
    const initial = asEnvelope(initialCandidateSet, query);
    let delivered = initial;
    const result = await this.controller.run({
      query,
      context: {},
      retrieve: async ({ attempt, correctiveAction }) => {
        if (attempt === 0) return delivered;
        if (typeof correctiveRetrieve !== 'function') return delivered;
        delivered = asEnvelope(await correctiveRetrieve({ query, correctiveAction, priorCandidateSet: delivered, attempt }), query);
        return delivered;
      },
      evaluate: async (candidateSet, meta) => qualityEvaluator(candidateSet, meta),
    });
    if (result.action !== 'PROCEED') {
      return frozen({
        action: result.action,
        retrievalQuality: result.quality?.quality ?? result.quality ?? null,
        qualityReceipt: structuredClone(result.quality),
        correctivePasses: result.correctivePasses,
        candidateSet: structuredClone(result.result),
        precision: null,
        allowLongTermMemory: false,
        authorityGranted: false,
      });
    }
    const precision = await this.precisionGateway.run({ candidateSet: result.result, query, currentRevisionSet, conflictSets, deadline });
    return frozen({
      action: 'PRECISION_COMPLETE', retrievalQuality: result.quality?.quality ?? RetrievalQuality.HIGH,
      qualityReceipt: structuredClone(result.quality), correctivePasses: result.correctivePasses,
      candidateSet: structuredClone(result.result), precision, allowLongTermMemory: true, authorityGranted: false,
    });
  }
}

export function evaluateCandidateSetQuality(candidateSet = {}) {
  const candidates = candidateSet.candidates ?? [];
  const relevantCount = candidates.filter((candidate) => bestRankSignal(candidate) >= 0.5 || candidate.sceneRelevance >= 0.5).length;
  const contradictoryCount = candidates.filter((candidate) => ['CONTRADICTED', 'UNRESOLVED'].includes(candidate.truthStatus)).length;
  const staleCount = candidates.filter((candidate) => candidate.freshness === 'STALE').length;
  const unresolvedCount = candidates.filter((candidate) => ['UNCERTAIN', 'UNRESOLVED'].includes(candidate.truthStatus)).length;
  const confidence = candidates.length ? Math.min(1, relevantCount / candidates.length + 0.25) : 0;
  return evaluateRetrievalQuality({ candidateCount: candidates.length, relevantCount, contradictoryCount, staleCount, unresolvedCount, requiredCoverage: 0.4, confidence });
}

function asEnvelope(candidateSet, query) {
  return candidateSet?.kind === 'CandidateBusEnvelope' ? candidateSet : createCandidateBusEnvelope({ ...(candidateSet ?? {}), query: query ?? candidateSet?.query });
}
function bestRankSignal(candidate) { const values = Object.values(candidate.rankSignals ?? {}).map(Number).filter(Number.isFinite); return values.length ? Math.max(...values) : 0; }
function frozen(value) { return Object.freeze(value); }
