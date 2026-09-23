import {
  AuthorityClass, KnowledgeStatus, MutationType, SettlementOutcome,
  createClaim, createProvenance, createSettlementReceipt,
} from './contracts.js';

const slotKey = (subjectId, predicate) => `${subjectId}::${predicate}`;

export class TemporalStateGraph {
  #claims = new Map();
  #slotClaims = new Map();
  #closures = new Map();
  #invalidClaims = new Set();
  #receipts = [];
  #revision = 0;

  settleProposal(proposal, registry) {
    this.#revision += 1;
    const stale = proposal.freshnessRevisionIds.some((id) => !registry.isActiveRevision(id));
    if (stale) return this.#receipt(proposal, SettlementOutcome.STALE, [], [], 'source-revision-not-current');
    try {
      if (proposal.mutationType === MutationType.SET_CLAIM) return this.#settleClaimProposal(proposal);
      if (proposal.mutationType === MutationType.CLOSE_SLOT) return this.#settleClosureProposal(proposal);
      return this.#receipt(proposal, SettlementOutcome.REJECTED, [], [], 'unsupported-mutation');
    } catch (error) {
      return this.#receipt(proposal, SettlementOutcome.FAILED, [], [], error.message);
    }
  }

  #settleClaimProposal(proposal) {
    const claim = structuredClone(proposal.payload.claim);
    if (!claim?.id) throw new Error('SET_CLAIM proposal lacks claim');
    this.#claims.set(claim.id, claim);
    const key = slotKey(claim.subjectId, claim.predicate);
    const ids = this.#slotClaims.get(key) ?? [];
    if (!ids.includes(claim.id)) ids.push(claim.id);
    this.#slotClaims.set(key, ids);

    if (claim.predicate === 'state' && claim.value === 'destroyed' && !this.#hasEarlierState(claim)) {
      const inferred = this.#makeInferredPreState(claim);
      this.#claims.set(inferred.id, inferred);
      const stateIds = this.#slotClaims.get(key) ?? [];
      if (!stateIds.includes(inferred.id)) stateIds.push(inferred.id);
      this.#slotClaims.set(key, stateIds);
    }

    const superseded = this.#recomputeSlot(key);
    return this.#receipt(proposal, SettlementOutcome.SETTLED, [claim.id], superseded, null);
  }

  #hasEarlierState(claim) {
    const key = slotKey(claim.subjectId, claim.predicate);
    return (this.#slotClaims.get(key) ?? []).some((id) => {
      if (id === claim.id || this.#invalidClaims.has(id)) return false;
      const other = this.#claims.get(id);
      return other && Number(other.temporal.validFrom) < Number(claim.temporal.validFrom);
    });
  }

  #makeInferredPreState(claim) {
    const id = `inferred:${claim.id}:prestate`;
    const sourceRevisionIds = claim.provenance?.sourceRevisionIds ?? [];
    const provenance = createProvenance({
      id:`prov:${id}`, sourceRevisionIds, evidenceIds:[claim.id], derivedFromIds:[claim.id], activity:'TEMPORAL_PRECONDITION', agent:'temporal-state-graph', invalidators:[...sourceRevisionIds, claim.id],
    });
    return createClaim({
      id, subjectId:claim.subjectId, predicate:'state', value:'intact',
      temporal:{kind:'HISTORICAL', validFrom:Math.max(0, Number(claim.temporal.validFrom) - 0.001), validUntil:Number(claim.temporal.validFrom)},
      authorityClass:AuthorityClass.INFERRED, confidence:.7, status:KnowledgeStatus.HISTORICAL, provenance,
    });
  }

  #settleClosureProposal(proposal) {
    const closure = structuredClone(proposal.payload);
    if (!closure?.subjectId || !closure?.predicate || !Number.isFinite(closure.at)) throw new Error('CLOSE_SLOT proposal is invalid');
    const key = slotKey(closure.subjectId, closure.predicate);
    const list = this.#closures.get(key) ?? [];
    list.push({ ...closure, proposalId:proposal.id, sourceRevisionIds:[...proposal.sourceRevisionIds] });
    list.sort((a,b) => a.at - b.at || a.proposalId.localeCompare(b.proposalId));
    this.#closures.set(key, list);
    const superseded = this.#recomputeSlot(key);
    return this.#receipt(proposal, SettlementOutcome.SETTLED, [], superseded, null);
  }

  #recomputeSlot(key) {
    const ids = (this.#slotClaims.get(key) ?? []).filter((id) => !this.#invalidClaims.has(id));
    const claims = ids.map((id) => this.#claims.get(id)).filter(Boolean).sort((a,b) => Number(a.temporal.validFrom) - Number(b.temporal.validFrom) || a.id.localeCompare(b.id));
    const closures = this.#closures.get(key) ?? [];
    const superseded = [];

    for (let i = 0; i < claims.length; i += 1) {
      const claim = claims[i];
      const nextClaim = claims[i + 1];
      const from = Number(claim.temporal.validFrom);
      const closure = closures.find((item) => item.at > from && (!nextClaim || item.at <= Number(nextClaim.temporal.validFrom)));
      const until = closure ? closure.at : nextClaim ? Number(nextClaim.temporal.validFrom) : null;
      const explicitHistorical = claim.temporal.kind === 'HISTORICAL';
      const status = explicitHistorical ? KnowledgeStatus.HISTORICAL : until === null ? KnowledgeStatus.CURRENT : KnowledgeStatus.SUPERSEDED;
      if (status === KnowledgeStatus.SUPERSEDED) superseded.push(claim.id);
      this.#claims.set(claim.id, { ...claim, status, temporal:{...claim.temporal, validUntil:until}, supersededBy: nextClaim && !closure ? nextClaim.id : null });
    }
    return [...new Set(superseded)].sort();
  }

  invalidateClaimsBySourceRevision(revisionId) {
    const affectedSlots = new Set();
    const invalidated = [];
    for (const [id, claim] of this.#claims) {
      if ((claim.provenance?.sourceRevisionIds ?? []).includes(revisionId)) {
        this.#invalidClaims.add(id);
        invalidated.push(id);
        affectedSlots.add(slotKey(claim.subjectId, claim.predicate));
      }
    }
    for (const [key, closures] of this.#closures) {
      const kept = closures.filter((item) => !item.sourceRevisionIds.includes(revisionId));
      if (kept.length !== closures.length) {
        this.#closures.set(key, kept);
        affectedSlots.add(key);
      }
    }
    for (const key of affectedSlots) this.#recomputeSlot(key);
    return invalidated.sort();
  }

  #receipt(proposal, outcome, settledArtifactIds, supersededArtifactIds, reason) {
    const receipt = createSettlementReceipt({
      id:`receipt:${this.#revision}:${proposal.id}`, proposalId:proposal.id, owner:'WORLD_STATE', outcome, settledArtifactIds, supersededArtifactIds, revision:this.#revision, reason,
    });
    this.#receipts.push(receipt);
    return structuredClone(receipt);
  }

  getClaim(claimId) {
    if (this.#invalidClaims.has(claimId)) return null;
    const claim = this.#claims.get(claimId);
    return claim ? structuredClone(claim) : null;
  }

  allClaims({ includeInvalid = false } = {}) {
    return [...this.#claims.entries()]
      .filter(([id]) => includeInvalid || !this.#invalidClaims.has(id))
      .map(([,claim]) => structuredClone(claim));
  }

  currentClaims(filter = {}) {
    return this.allClaims().filter((claim) => claim.status === KnowledgeStatus.CURRENT && this.#matches(claim, filter));
  }

  historicalClaims(filter = {}) {
    return this.allClaims().filter((claim) => [KnowledgeStatus.HISTORICAL, KnowledgeStatus.SUPERSEDED].includes(claim.status) && this.#matches(claim, filter));
  }

  #matches(claim, filter) {
    return (!filter.subjectId || claim.subjectId === filter.subjectId) && (!filter.predicate || claim.predicate === filter.predicate);
  }

  neighbors(entityId, { limit = 16 } = {}) {
    const results = [];
    for (const claim of this.allClaims()) {
      if (claim.subjectId === entityId || claim.value === entityId) results.push(claim);
      if (results.length >= limit) break;
    }
    return results;
  }
}
