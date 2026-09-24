import {
  AuthorityClass,
  KnowledgeStatus,
  MEMORY_LIMITS,
  MutationType,
  SettlementDecisionType,
  deepClone,
  requiredString,
  slotKey,
  stableHash,
  stableStringify,
  uniqStrings,
} from './memory-contracts.js';

const ACCEPTED_MUTATIONS = new Set([
  SettlementDecisionType.ACCEPT_CURRENT,
  SettlementDecisionType.ACCEPT_HISTORICAL,
  SettlementDecisionType.SUPERSEDE,
  SettlementDecisionType.UNRESOLVED,
]);
const KNOWN_DECISIONS = new Set(Object.values(SettlementDecisionType));

function temporalTime(claim) {
  return Number(claim?.temporal?.validFrom ?? claim?.temporal?.at ?? 0);
}

function normalizeClaim(claim, envelope, sequence) {
  if (!claim || typeof claim !== 'object') throw new TypeError('Settlement claim is required');
  const authority = claim.authorityClass ?? AuthorityClass.SETTLED;
  if (authority === AuthorityClass.INFERRED || authority === AuthorityClass.DERIVED || authority === AuthorityClass.UNKNOWN) {
    throw new Error('MEMORY_CANONICAL_AUTHORITY_REJECTED');
  }
  const id = requiredString(claim.id,'claim.id');
  return {
    kind:'MemorySettledClaim',
    id,
    subjectId:requiredString(claim.subjectId,'claim.subjectId'),
    predicate:requiredString(claim.predicate,'claim.predicate'),
    value:deepClone(claim.value),
    temporal:deepClone(claim.temporal ?? {kind:'CURRENT',validFrom:0}),
    authorityClass:authority,
    confidence:Number.isFinite(Number(claim.confidence)) ? Number(claim.confidence) : 1,
    owner:claim.owner ?? envelope.proposal.owner,
    sourceRevisionIds:uniqStrings(envelope.proposal.sourceRevisionIds ?? [],MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact),
    evidenceIds:uniqStrings(envelope.proposal.evidenceIds ?? [],MEMORY_LIMITS.maxEvidenceRefsPerArtifact),
    settlementDecisionId:envelope.decision.id,
    settlementReceiptId:envelope.receipt?.id ?? null,
    settlementSequence:sequence,
    settledWorldRevision:Number(envelope.decision.worldRevision ?? 0),
    semanticKey:claim.semanticKey ?? slotKey(claim.subjectId,claim.predicate) + '|' + stableHash(stableStringify(claim.value)),
    explicitness:claim.explicitness ?? 'EXPLICIT',
    provenance:deepClone(claim.provenance ?? null),
  };
}

export class TemporalStateGraph {
  constructor(snapshot = null) {
    this.evidence = new Map();
    this.evidenceOrder = [];
    this.sourceRevisionState = new Map();
    this.claims = new Map();
    this.claimOrder = [];
    this.settlementJournal = [];
    this.transitionJournal = [];
    this.sequence = 0;
    this.evidenceSequence = 0;
    this.worldRevision = 0;
    if (snapshot) this.restore(snapshot);
  }

  appendEvidence({
    id=null,
    sourceId,
    sourceRevisionId,
    exactContent,
    kind='EXPERIENCE',
    occurredAt=0,
    worldRevision=0,
    sceneRevision=null,
    participants=[],
    knownBy=[],
    perspective='WORLD',
    metadata={},
    provenance=[],
  }={}) {
    requiredString(sourceId,'sourceId');
    requiredString(sourceRevisionId,'sourceRevisionId');
    if (typeof exactContent !== 'string') throw new TypeError('exactContent must be a string');
    const evidenceId = id || 'memory-evidence:' + stableHash(sourceRevisionId + '|' + kind + '|' + exactContent);
    if (this.evidence.has(evidenceId)) {
      const existing = this.evidence.get(evidenceId);
      if (existing.contentHash !== stableHash(exactContent) || existing.sourceRevisionId !== sourceRevisionId) {
        throw new Error('MEMORY_EVIDENCE_ID_COLLISION');
      }
      return deepClone(existing);
    }
    const record = {
      kind:'MemoryEvidenceRecord',
      id:evidenceId,
      sourceId,
      sourceRevisionId,
      evidenceKind:String(kind),
      exactContent,
      contentHash:stableHash(exactContent),
      occurredAt:Number(occurredAt),
      worldRevision:Number(worldRevision),
      sceneRevision:sceneRevision == null ? null : Number(sceneRevision),
      participants:uniqStrings(participants,64),
      knownBy:uniqStrings(knownBy,64),
      perspective:String(perspective || 'WORLD'),
      metadata:deepClone(metadata),
      provenance:deepClone(provenance),
      appendSequence:++this.evidenceSequence,
      authorityClass:kind === 'SOURCE' ? AuthorityClass.SOURCE_CANON : AuthorityClass.OBSERVED,
      state:'ACTIVE',
    };
    this.evidence.set(record.id,record);
    this.evidenceOrder.push(record.id);
    this.sourceRevisionState.set(sourceRevisionId,{state:'ACTIVE',replacedBy:null,removed:false});
    this.worldRevision = Math.max(this.worldRevision,record.worldRevision);
    return deepClone(record);
  }

  evidenceRecord(id) {
    const row=this.evidence.get(id);
    return row?deepClone(row):null;
  }

  exactEvidence(id) {
    return this.evidenceRecord(id);
  }

  invalidateSourceRevision(sourceRevisionId,{replacedBy=null,removed=false,reason='SOURCE_REVISION_INVALIDATED'}={}) {
    const previous=this.sourceRevisionState.get(sourceRevisionId) || {state:'UNKNOWN',replacedBy:null,removed:false};
    this.sourceRevisionState.set(sourceRevisionId,{state:'STALE',replacedBy,removed:Boolean(removed),reason});
    const event={
      kind:'MemorySourceRevisionInvalidation',
      id:'memory-source-invalidation:' + stableHash(sourceRevisionId+'|'+String(replacedBy)+'|'+reason+'|'+(this.sequence+1)),
      sourceRevisionId,
      replacedBy,
      removed:Boolean(removed),
      reason,
      sequence:++this.sequence,
    };
    this.transitionJournal.push(event);
    return {previous:deepClone(previous),event:deepClone(event)};
  }

  isSourceRevisionActive(sourceRevisionId) {
    return this.sourceRevisionState.get(sourceRevisionId)?.state === 'ACTIVE';
  }

  evidenceFresh(evidenceId) {
    const row=this.evidence.get(evidenceId);
    return Boolean(row && row.state==='ACTIVE' && this.isSourceRevisionActive(row.sourceRevisionId));
  }

  applySettlement(envelope) {
    const validation=this.validateSettlement(envelope);
    const journalEntry={
      kind:'MemorySettlementJournalEntry',
      id:'memory-settlement:' + stableHash(envelope.proposal.id+'|'+envelope.decision.id+'|'+(this.sequence+1)),
      sequence:++this.sequence,
      proposalId:envelope.proposal.id,
      mutationType:envelope.proposal.mutationType,
      owner:envelope.proposal.owner,
      decision:envelope.decision.decision,
      decisionId:envelope.decision.id,
      receiptId:envelope.receipt?.id ?? null,
      worldRevision:Number(envelope.decision.worldRevision ?? 0),
      evidenceIds:[...envelope.proposal.evidenceIds],
      sourceRevisionIds:[...envelope.proposal.sourceRevisionIds],
      reason:envelope.decision.reason ?? null,
      validation,
      canonicalMutation:false,
      claimId:null,
    };
    this.worldRevision=Math.max(this.worldRevision,journalEntry.worldRevision);

    if (envelope.proposal.mutationType === MutationType.CLOSE_SLOT) {
      if (ACCEPTED_MUTATIONS.has(envelope.decision.decision) && envelope.receipt?.outcome === 'SETTLED') {
        journalEntry.canonicalMutation=true;
        this.transitionJournal.push({
          kind:'MemorySlotClosure',
          id:'memory-slot-close:' + stableHash(journalEntry.id),
          sequence:journalEntry.sequence,
          subjectId:envelope.proposal.payload?.subjectId ?? null,
          predicate:envelope.proposal.payload?.predicate ?? null,
          worldRevision:journalEntry.worldRevision,
          reason:journalEntry.reason,
          decisionId:journalEntry.decisionId,
        });
      }
      this.settlementJournal.push(journalEntry);
      return deepClone(journalEntry);
    }

    const claim=normalizeClaim(envelope.proposal.payload.claim,envelope,journalEntry.sequence);
    journalEntry.claimId=claim.id;

    if (!ACCEPTED_MUTATIONS.has(envelope.decision.decision)) {
      this.settlementJournal.push(journalEntry);
      return deepClone(journalEntry);
    }

    if (!envelope.receipt || envelope.receipt.outcome !== 'SETTLED') throw new Error('MEMORY_SETTLEMENT_RECEIPT_REQUIRED');
    if (this.claims.has(claim.id)) {
      const existing=this.claims.get(claim.id);
      if (stableStringify(existing) !== stableStringify(claim)) throw new Error('MEMORY_CLAIM_ID_COLLISION');
      this.settlementJournal.push({...journalEntry,canonicalMutation:false,replay:true});
      return deepClone(existing);
    }

    this.claims.set(claim.id,claim);
    this.claimOrder.push(claim.id);
    journalEntry.canonicalMutation=true;
    this.settlementJournal.push(journalEntry);

    const key=slotKey(claim.subjectId,claim.predicate);
    if ([SettlementDecisionType.ACCEPT_CURRENT,SettlementDecisionType.SUPERSEDE].includes(envelope.decision.decision)) {
      const previous=this.currentClaimForSlot(key,{asOfSequence:journalEntry.sequence-1,includeStale:true});
      if (previous && previous.id !== claim.id) {
        this.transitionJournal.push({
          kind:'MemoryClaimTransition',
          id:'memory-transition:' + stableHash(previous.id+'>'+claim.id+'|'+journalEntry.sequence),
          sequence:journalEntry.sequence,
          transition:'SUPERSEDED_BY',
          claimId:previous.id,
          relatedClaimId:claim.id,
          worldRevision:journalEntry.worldRevision,
          reason:journalEntry.reason,
          decisionId:journalEntry.decisionId,
        });
      }
      this.transitionJournal.push({
        kind:'MemoryClaimTransition',
        id:'memory-transition:' + stableHash(claim.id+'|CURRENT|'+journalEntry.sequence),
        sequence:journalEntry.sequence,
        transition:'BECAME_CURRENT',
        claimId:claim.id,
        relatedClaimId:previous?.id ?? null,
        worldRevision:journalEntry.worldRevision,
        reason:journalEntry.reason,
        decisionId:journalEntry.decisionId,
      });
    } else if (envelope.decision.decision === SettlementDecisionType.ACCEPT_HISTORICAL) {
      this.transitionJournal.push({
        kind:'MemoryClaimTransition',
        id:'memory-transition:' + stableHash(claim.id+'|HISTORICAL|'+journalEntry.sequence),
        sequence:journalEntry.sequence,
        transition:'ACCEPTED_HISTORICAL',
        claimId:claim.id,
        relatedClaimId:null,
        worldRevision:journalEntry.worldRevision,
        reason:journalEntry.reason,
        decisionId:journalEntry.decisionId,
      });
    } else if (envelope.decision.decision === SettlementDecisionType.UNRESOLVED) {
      this.transitionJournal.push({
        kind:'MemoryClaimTransition',
        id:'memory-transition:' + stableHash(claim.id+'|UNRESOLVED|'+journalEntry.sequence),
        sequence:journalEntry.sequence,
        transition:'ACCEPTED_UNRESOLVED',
        claimId:claim.id,
        relatedClaimId:null,
        worldRevision:journalEntry.worldRevision,
        reason:journalEntry.reason,
        decisionId:journalEntry.decisionId,
      });
    }
    return deepClone(claim);
  }

  validateSettlement(envelope) {
    if (!envelope || typeof envelope!=='object') throw new TypeError('Settlement envelope required');
    const {proposal,decision,receipt}=envelope;
    if (!proposal || !decision) throw new TypeError('Settlement envelope requires proposal and decision');
    if (proposal.owner !== 'WORLD_STATE' || decision.owner !== 'WORLD_STATE') throw new Error('MEMORY_OWNER_SETTLEMENT_REQUIRED');
    if (decision.proposalId !== proposal.id) throw new Error('MEMORY_SETTLEMENT_PROPOSAL_MISMATCH');
    if (!KNOWN_DECISIONS.has(decision.decision)) throw new Error('MEMORY_SETTLEMENT_DECISION_INVALID');
    if (![MutationType.SET_CLAIM,MutationType.CLOSE_SLOT].includes(proposal.mutationType)) throw new Error('MEMORY_SETTLEMENT_MUTATION_INVALID');
    const evidenceIds=uniqStrings(proposal.evidenceIds ?? [],MEMORY_LIMITS.maxEvidenceRefsPerArtifact);
    const sourceRevisionIds=uniqStrings(proposal.sourceRevisionIds ?? [],MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact);
    const freshnessIds=uniqStrings(proposal.freshnessRevisionIds ?? sourceRevisionIds,MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact);
    for (const id of evidenceIds) if (!this.evidence.has(id)) throw new Error('MEMORY_SETTLEMENT_EVIDENCE_UNKNOWN:'+id);
    for (const id of freshnessIds) if (!this.isSourceRevisionActive(id)) throw new Error('MEMORY_SETTLEMENT_SOURCE_STALE:'+id);
    if (ACCEPTED_MUTATIONS.has(decision.decision) && (!receipt || receipt.outcome!=='SETTLED')) throw new Error('MEMORY_SETTLEMENT_RECEIPT_REQUIRED');
    if (proposal.mutationType===MutationType.SET_CLAIM && !proposal.payload?.claim?.id) throw new Error('MEMORY_SETTLEMENT_CLAIM_REQUIRED');
    return {
      kind:'MemorySettlementValidation',
      ok:true,
      evidenceIds,
      sourceRevisionIds,
      freshnessRevisionIds:freshnessIds,
      receiptId:receipt?.id ?? null,
      authorityFence:'OWNER_SETTLEMENT_ONLY',
    };
  }

  currentClaimForSlot(key,{asOfSequence=Infinity,asOfWorldRevision=Infinity,includeStale=false}={}) {
    let current=null;
    const bounded=this.settlementJournal.filter((entry)=>entry.sequence<=asOfSequence && entry.worldRevision<=asOfWorldRevision).slice(-MEMORY_LIMITS.maxJournalTraversal);
    for (const entry of bounded) {
      if (!entry.canonicalMutation || !entry.claimId) continue;
      const claim=this.claims.get(entry.claimId);
      if (!claim || slotKey(claim.subjectId,claim.predicate)!==key) continue;
      if ([SettlementDecisionType.ACCEPT_CURRENT,SettlementDecisionType.SUPERSEDE].includes(entry.decision)) current=claim;
    }
    if (!current) return null;
    const freshness=this.claimFreshness(current);
    if (!includeStale && freshness!=='FRESH') return null;
    return {...deepClone(current),freshness,status:KnowledgeStatus.CURRENT};
  }

  claimFreshness(claim) {
    if (!claim) return 'INVALID';
    if (claim.sourceRevisionIds.some((id)=>!this.isSourceRevisionActive(id))) return 'STALE';
    if (claim.evidenceIds.some((id)=>!this.evidenceFresh(id))) return 'STALE';
    return 'FRESH';
  }

  currentProjection({asOfWorldRevision=Infinity,includeStale=true}={}) {
    const slots=new Map();
    const bounded=this.settlementJournal.filter((entry)=>entry.worldRevision<=asOfWorldRevision).slice(-MEMORY_LIMITS.maxJournalTraversal);
    for (const entry of bounded) {
      if (!entry.canonicalMutation || !entry.claimId) continue;
      if (![SettlementDecisionType.ACCEPT_CURRENT,SettlementDecisionType.SUPERSEDE].includes(entry.decision)) continue;
      const claim=this.claims.get(entry.claimId);
      if (!claim) continue;
      slots.set(slotKey(claim.subjectId,claim.predicate),claim);
      if (slots.size>MEMORY_LIMITS.maxProjectionSlots) throw new Error('MEMORY_PROJECTION_SLOT_LIMIT_EXCEEDED');
    }
    return [...slots.values()].map((claim)=>({
      ...deepClone(claim),
      status:KnowledgeStatus.CURRENT,
      freshness:this.claimFreshness(claim),
    })).filter((claim)=>includeStale || claim.freshness==='FRESH').sort((a,b)=>slotKey(a.subjectId,a.predicate).localeCompare(slotKey(b.subjectId,b.predicate)));
  }

  historicalClaims({subjectId=null,predicate=null,asOfWorldRevision=Infinity,includeUnresolved=true,includeStale=true}={}) {
    const currentIds=new Set(this.currentProjection({asOfWorldRevision,includeStale:true}).map((row)=>row.id));
    const rows=[];
    for (const entry of this.settlementJournal.slice(-MEMORY_LIMITS.maxJournalTraversal)) {
      if (entry.worldRevision>asOfWorldRevision || !entry.claimId || !entry.canonicalMutation) continue;
      const claim=this.claims.get(entry.claimId);
      if (!claim) continue;
      if (subjectId && claim.subjectId!==subjectId) continue;
      if (predicate && claim.predicate!==predicate) continue;
      if (entry.decision===SettlementDecisionType.UNRESOLVED && !includeUnresolved) continue;
      let status;
      if (entry.decision===SettlementDecisionType.UNRESOLVED) status=KnowledgeStatus.UNRESOLVED;
      else if (currentIds.has(claim.id)) status=KnowledgeStatus.CURRENT;
      else status=KnowledgeStatus.HISTORICAL;
      const freshness=this.claimFreshness(claim);
      if (!includeStale && freshness!=='FRESH') continue;
      rows.push({...deepClone(claim),status,freshness,decision:entry.decision,decisionReason:entry.reason});
    }
    return rows.sort((a,b)=>a.settlementSequence-b.settlementSequence);
  }

  unresolvedSets({subjectId=null,predicate=null}={}) {
    const groups=new Map();
    for (const row of this.historicalClaims({subjectId,predicate,includeUnresolved:true})) {
      if (row.status!==KnowledgeStatus.UNRESOLVED) continue;
      const key=slotKey(row.subjectId,row.predicate)+'|'+temporalTime(row);
      const group=groups.get(key)||[];
      group.push(row);
      groups.set(key,group);
    }
    return [...groups.entries()].map(([key,claims])=>({
      kind:'MemoryUnresolvedSet',
      id:'memory-unresolved:' + stableHash(key+'|'+claims.map((c)=>c.id).sort().join('|')),
      slotKey:key.split('|').slice(0,2).join('|'),
      temporalPosition:Number(key.split('|').at(-1)),
      claims:claims.map(deepClone),
      status:KnowledgeStatus.UNRESOLVED,
      authorityClass:AuthorityClass.UNRESOLVED,
    }));
  }

  asOf(worldRevision) {
    return {
      kind:'MemoryAsOfProjection',
      worldRevision:Number(worldRevision),
      current:this.currentProjection({asOfWorldRevision:Number(worldRevision),includeStale:true}),
      historical:this.historicalClaims({asOfWorldRevision:Number(worldRevision),includeUnresolved:false,includeStale:true}).filter((row)=>row.status===KnowledgeStatus.HISTORICAL),
      unresolved:this.historicalClaims({asOfWorldRevision:Number(worldRevision),includeUnresolved:true,includeStale:true}).filter((row)=>row.status===KnowledgeStatus.UNRESOLVED),
    };
  }

  traverseEntity(entityId,{includeHistorical=true,includeUnresolved=true,maxClaims=MEMORY_LIMITS.maxGraphTraversalClaims}={}) {
    const rows=this.historicalClaims({includeUnresolved,includeStale:true})
      .filter((claim)=>claim.subjectId===entityId || claim.value===entityId || claim.value?.entityId===entityId)
      .filter((claim)=>includeHistorical || claim.status===KnowledgeStatus.CURRENT)
      .slice(0,maxClaims);
    return {
      kind:'MemoryEntityTraversal',
      entityId,
      claims:rows,
      bounded:rows.length>=maxClaims,
      authorityGranted:false,
    };
  }

  explainClaim(claimId) {
    const claim=this.claims.get(claimId);
    if (!claim) return null;
    return {
      claim:deepClone(claim),
      freshness:this.claimFreshness(claim),
      evidence:claim.evidenceIds.map((id)=>this.evidenceRecord(id)).filter(Boolean),
      transitions:this.transitionJournal.filter((row)=>row.claimId===claimId || row.relatedClaimId===claimId).map(deepClone),
      settlement:this.settlementJournal.find((row)=>row.claimId===claimId) ? deepClone(this.settlementJournal.find((row)=>row.claimId===claimId)) : null,
    };
  }

  revisionRef() {
    return 'memory-temporal:' + stableHash(stableStringify({
      sequence:this.sequence,
      evidenceSequence:this.evidenceSequence,
      worldRevision:this.worldRevision,
      latestSettlement:this.settlementJournal.at(-1)?.id ?? null,
      latestTransition:this.transitionJournal.at(-1)?.id ?? null,
    }));
  }

  snapshot() {
    return {
      kind:'TemporalStateGraphSnapshot',
      evidence:[...this.evidence.values()].map(deepClone),
      evidenceOrder:[...this.evidenceOrder],
      sourceRevisionState:[...this.sourceRevisionState.entries()].map(([k,v])=>[k,deepClone(v)]),
      claims:[...this.claims.values()].map(deepClone),
      claimOrder:[...this.claimOrder],
      settlementJournal:this.settlementJournal.map(deepClone),
      transitionJournal:this.transitionJournal.map(deepClone),
      sequence:this.sequence,
      evidenceSequence:this.evidenceSequence,
      worldRevision:this.worldRevision,
    };
  }

  restore(snapshot) {
    this.evidence=new Map((snapshot?.evidence||[]).map((row)=>[row.id,deepClone(row)]));
    this.evidenceOrder=[...(snapshot?.evidenceOrder||[])];
    this.sourceRevisionState=new Map((snapshot?.sourceRevisionState||[]).map(([k,v])=>[k,deepClone(v)]));
    this.claims=new Map((snapshot?.claims||[]).map((row)=>[row.id,deepClone(row)]));
    this.claimOrder=[...(snapshot?.claimOrder||[])];
    this.settlementJournal=(snapshot?.settlementJournal||[]).map(deepClone);
    this.transitionJournal=(snapshot?.transitionJournal||[]).map(deepClone);
    this.sequence=Number(snapshot?.sequence||0);
    this.evidenceSequence=Number(snapshot?.evidenceSequence||0);
    this.worldRevision=Number(snapshot?.worldRevision||0);
  }

  static fromSnapshot(snapshot) {
    return new TemporalStateGraph(snapshot);
  }
}
