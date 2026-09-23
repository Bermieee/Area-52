import { KnowledgeStatus, createTruthGateResult } from './contracts.js';

export class TruthGate {
  constructor({ graph }) { this.graph = graph; }

  classify(candidate, { intent = 'CURRENT' } = {}) {
    const claims = candidate.claimIds.map((id) => this.graph.getClaim(id)).filter(Boolean);
    if (claims.length === 0) {
      return createTruthGateResult({ candidateId:candidate.candidateId, classification:KnowledgeStatus.UNRESOLVED, usableForIntent:false, reasons:['claim-missing-or-invalid'], claimIds:candidate.claimIds, provenance:candidate.provenance });
    }
    const claim = claims[0];
    const classification = claim.status ?? KnowledgeStatus.UNRESOLVED;
    const historicalLike = [KnowledgeStatus.HISTORICAL, KnowledgeStatus.SUPERSEDED].includes(classification);
    const currentLike = classification === KnowledgeStatus.CURRENT;
    const usableForIntent = intent === 'HISTORICAL' ? (historicalLike || currentLike) : currentLike;
    const reasons = usableForIntent ? [`${classification.toLowerCase()}-matches-${intent.toLowerCase()}-intent`] : [`${classification.toLowerCase()}-does-not-match-${intent.toLowerCase()}-intent`];
    return createTruthGateResult({ candidateId:candidate.candidateId, classification, usableForIntent, reasons, claimIds:[claim.id], provenance:claim.provenance });
  }

  classifyAll(candidates, options = {}) { return candidates.map((candidate) => this.classify(candidate, options)); }
}
