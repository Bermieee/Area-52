import {
  AdaptiveRetrievalController, CorrectiveRetrievalDispatcher, evaluateRetrievalQuality, RetrievalQuality,
} from './retrieval-control-policy.js';
import { createCandidateBusEnvelope } from './candidate-bus.js';

export class PrecisionRetrievalPipeline {
  constructor({ precisionGateway, maxCorrectiveAttempts = 1, correctiveDispatcher = null } = {}) {
    if (!precisionGateway || typeof precisionGateway.run !== 'function') throw new TypeError('PrecisionRetrievalPipeline requires precisionGateway.run');
    this.precisionGateway = precisionGateway;
    this.controller = new AdaptiveRetrievalController({
      maxCorrectiveAttempts: Math.min(1, Math.max(0, Number(maxCorrectiveAttempts) || 0)),
      dispatcher: correctiveDispatcher instanceof CorrectiveRetrievalDispatcher ? correctiveDispatcher : correctiveDispatcher,
    });
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
    retrievalIntents = [],
    retrievalIntentIds = [],
    intentFingerprint = null,
    entityConstraints = [],
    temporalConstraint = null,
    maxCandidates = 64,
    maxCorrectiveCandidates = 24,
    maxCorrectiveEvidenceBytes = 32768,
  } = {}) {
    if (simpleTurn) return frozen({ action:'SKIP',retrievalQuality:null,correctivePasses:0,precision:null,allowLongTermMemory:false,authorityGranted:false });
    const initial = asEnvelope(initialCandidateSet, query);
    const requiredIntents = retrievalIntents.length ? retrievalIntents : retrievalIntentIds;
    const controllerContext = {
      turnId: initial.metadata?.turnId ?? 'turn',
      intentFingerprint: intentFingerprint ?? initial.intentFingerprint ?? 'intent:retrieval',
      retrievalIntentIds: requiredIntents.map((x)=>typeof x==='string'?x:x.intentId??x.id).filter(Boolean),
      sourceRevisionSet: currentRevisionSet?.sourceRevisionSet ?? initial.sourceRevisionSet ?? [],
      worldRevision: currentRevisionSet?.worldRevision ?? initial.worldRevision ?? 0,
      sceneRevision: currentRevisionSet?.sceneRevision ?? initial.sceneRevision ?? 0,
      entityConstraints, temporalConstraint, maxCandidates, maxCorrectiveCandidates, maxCorrectiveEvidenceBytes,
      softDeadline: deadline.softDeadline ?? 0, hardDeadline: deadline.hardDeadline ?? 0,
      attemptedChannels: [...new Set((initial.candidates ?? []).map((c)=>c.channel).filter(Boolean))],
    };
    const result = await this.controller.run({
      query,
      context: controllerContext,
      retrieve: async ({ attempt, correctiveAction, correctivePlan, priorResult }) => {
        if (attempt === 0) return initial;
        if (typeof correctiveRetrieve !== 'function') return priorResult ?? initial;
        return asEnvelope(await correctiveRetrieve({
          query, correctiveAction, correctivePlan, priorCandidateSet: priorResult ?? initial, attempt,
        }), query);
      },
      evaluate: async (candidateSet, meta) => qualityEvaluator(candidateSet, {
        ...meta, requiredIntents, retrievalIntentIds: controllerContext.retrievalIntentIds,
      }),
    });

    if (result.action !== 'PROCEED') {
      return frozen({
        action: result.action,
        retrievalQuality: result.quality?.quality ?? result.quality ?? null,
        qualityReceipt: structuredClone(result.quality),
        correctivePasses: result.correctivePasses,
        correctivePlan: structuredClone(result.correctivePlan),
        abstention: structuredClone(result.abstention),
        candidateSet: structuredClone(result.result),
        precision: null,
        allowLongTermMemory: false,
        authorityGranted: false,
      });
    }

    const precision = await this.precisionGateway.run({
      candidateSet: result.result, query, currentRevisionSet, conflictSets, deadline,
    });
    return frozen({
      action:'PRECISION_COMPLETE',
      retrievalQuality:result.quality?.quality ?? RetrievalQuality.HIGH,
      qualityReceipt:structuredClone(result.quality),
      correctivePasses:result.correctivePasses,
      correctivePlan:structuredClone(result.correctivePlan),
      candidateSet:structuredClone(result.result),
      precision,
      allowLongTermMemory:true,
      authorityGranted:false,
    });
  }
}

export function evaluateCandidateSetQuality(candidateSet = {}, meta = {}) {
  const candidates = candidateSet.candidates ?? [];
  const requiredIntents = meta.requiredIntents ?? meta.retrievalIntentIds ?? [];
  if (requiredIntents.length) {
    return evaluateRetrievalQuality({
      requiredIntents,
      candidateSet,
      candidates,
      contradictoryCount:candidates.filter((candidate)=>candidate.truthStatus==='CONTRADICTED').length,
      staleCount:candidates.filter((candidate)=>candidate.freshness==='STALE').length,
      unresolvedCount:candidates.filter((candidate)=>['UNCERTAIN','UNRESOLVED'].includes(candidate.truthStatus)).length,
      temporalMismatchCount:candidates.filter((candidate)=>candidate.metadata?.temporalMismatch===true).length,
      perspectiveMismatchCount:candidates.filter((candidate)=>candidate.metadata?.perspectiveMismatch===true).length,
      provenanceIncompleteCount:candidates.filter((candidate)=>!(candidate.provenance??[]).length).length,
      unavailableChannels:candidateSet.unavailableChannels ?? [],
      confidence:candidates.length ? Math.min(1, candidates.filter((candidate)=>bestRankSignal(candidate)>=0.5||candidate.sceneRelevance>=0.5).length/Math.max(1,candidates.length)+0.25) : 0,
    });
  }
  const relevantCount = candidates.filter((candidate) => bestRankSignal(candidate) >= 0.5 || candidate.sceneRelevance >= 0.5).length;
  const contradictoryCount = candidates.filter((candidate) => ['CONTRADICTED','UNRESOLVED'].includes(candidate.truthStatus)).length;
  const staleCount = candidates.filter((candidate) => candidate.freshness === 'STALE').length;
  const unresolvedCount = candidates.filter((candidate) => ['UNCERTAIN','UNRESOLVED'].includes(candidate.truthStatus)).length;
  const confidence = candidates.length ? Math.min(1, relevantCount / candidates.length + 0.25) : 0;
  return evaluateRetrievalQuality({ candidateCount:candidates.length,relevantCount,contradictoryCount,staleCount,unresolvedCount,requiredCoverage:0.4,confidence });
}

function asEnvelope(candidateSet, query) {
  return candidateSet?.kind === 'CandidateBusEnvelope' ? candidateSet : createCandidateBusEnvelope({
    ...(candidateSet ?? {}), query: query ?? candidateSet?.query,
    maxCandidates: Math.max(1, Math.min(256, candidateSet?.maxCandidates ?? candidateSet?.candidates?.length ?? 256)),
  });
}
function bestRankSignal(candidate) {
  const values = Object.values(candidate.rankSignals ?? {}).map(Number).filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}
function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) frozen(child);
  return value;
}
