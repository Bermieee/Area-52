import { AuthorityClass, KnowledgeStatus, MutationType, SettlementDecisionType, createSettlementDecision } from './contracts.js';

const authorityRank={
  [AuthorityClass.OPERATOR]:6,[AuthorityClass.SOURCE_CANON]:5,[AuthorityClass.OBSERVED]:4,[AuthorityClass.SETTLED]:3,[AuthorityClass.INFERRED]:2,[AuthorityClass.UNRESOLVED]:1,
};
const timeOf=(claim)=>Number(claim.temporal?.validFrom??0);
const sameValue=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export class SettlementEngine {
  #decisions=new Map(); #sequence=0;
  constructor({registry,graph,entityRegistry=null}){this.registry=registry;this.graph=graph;this.entityRegistry=entityRegistry;}

  settle(proposal){
    const validation=this.#validate(proposal);if(!validation.ok)return this.#record(proposal,SettlementDecisionType.REJECT,validation.reason,[],null,{validation});
    if(proposal.mutationType===MutationType.CLOSE_SLOT){const receipt=this.graph.settleProposal(proposal,this.registry);const decision=receipt.outcome==='SETTLED'?SettlementDecisionType.SUPERSEDE:SettlementDecisionType.REJECT;return this.#record(proposal,decision,receipt.outcome==='SETTLED'?'explicit slot closure settled':`closure settlement failed: ${receipt.outcome}`,[],receipt,{closure:proposal.payload});}
    const claim=proposal.payload.claim;
    const existing=this.graph.slotClaims(claim.subjectId,claim.predicate).filter(c=>c.id!==claim.id);
    const equivalent=existing.filter(c=>sameValue(c.value,claim.value));
    const conflicts=existing.filter(c=>!sameValue(c.value,claim.value)&&timeOf(c)===timeOf(claim));
    const latestTime=existing.length?Math.max(...existing.map(timeOf)):null;
    const unresolvedCandidate=claim.temporal.kind==='UNRESOLVED'||claim.temporal.kind==='UNCERTAIN'||claim.authorityClass===AuthorityClass.UNRESOLVED;

    if(conflicts.length){
      const strongest=Math.max(...conflicts.map(c=>authorityRank[c.authorityClass]??0));
      const candidateRank=authorityRank[claim.authorityClass]??0;
      if(claim.authorityClass===AuthorityClass.INFERRED&&strongest>candidateRank){
        return this.#record(proposal,SettlementDecisionType.CONTRADICT,'inferred candidate conflicts with stronger admitted evidence; inference preserved outside canonical world state',conflicts.map(c=>c.id),null,{candidateAuthority:claim.authorityClass,strongerAuthorities:[...new Set(conflicts.map(c=>c.authorityClass))]});
      }
      const receipt=this.graph.settleProposal(proposal,this.registry);
      return this.#record(proposal,SettlementDecisionType.UNRESOLVED,'conflicting admitted evidence shares the same temporal position and no authority rule resolves it',[...conflicts.map(c=>c.id),claim.id],receipt,{candidateAuthority:claim.authorityClass,conflictingAuthorities:[...new Set(conflicts.map(c=>c.authorityClass))],unresolvedCandidate});
    }

    if(unresolvedCandidate){
      const receipt=this.graph.settleProposal(proposal,this.registry);
      const considered=[...existing.filter(c=>!sameValue(c.value,claim.value)).map(c=>c.id),claim.id];
      return this.#record(proposal,SettlementDecisionType.UNRESOLVED,'candidate is explicitly uncertain/unresolved; evidence is retained without invented certainty',considered,receipt,{temporalKind:claim.temporal.kind,authorityClass:claim.authorityClass});
    }

    const receipt=this.graph.settleProposal(proposal,this.registry);
    if(receipt.outcome!=='SETTLED')return this.#record(proposal,SettlementDecisionType.REJECT,`canonical owner rejected settlement: ${receipt.outcome}`,existing.map(c=>c.id),receipt,{receiptOutcome:receipt.outcome});

    if(equivalent.length){
      const latestEquivalent=Math.max(...equivalent.map(timeOf),timeOf(claim));
      const decision=latestTime!==null&&latestEquivalent<latestTime?SettlementDecisionType.ACCEPT_HISTORICAL:(claim.temporal.kind==='HISTORICAL'?SettlementDecisionType.ACCEPT_HISTORICAL:SettlementDecisionType.ACCEPT_CURRENT);
      return this.#record(proposal,decision,'compatible evidence corroborates an existing semantic fact; provenance remains multi-source',[...equivalent.map(c=>c.id),claim.id],receipt,{corroborationCount:equivalent.length+1});
    }

    if(claim.temporal.kind==='HISTORICAL'||(latestTime!==null&&timeOf(claim)<latestTime))return this.#record(proposal,SettlementDecisionType.ACCEPT_HISTORICAL,'claim is temporally earlier than the latest settled state and is retained as history',existing.map(c=>c.id),receipt,{claimTime:timeOf(claim),latestTime});
    if(latestTime!==null&&timeOf(claim)>latestTime&&existing.some(c=>c.status===KnowledgeStatus.CURRENT&&!sameValue(c.value,claim.value)))return this.#record(proposal,SettlementDecisionType.SUPERSEDE,'newer explicit evidence changes the active single-valued state while preserving prior history',existing.map(c=>c.id),receipt,{claimTime:timeOf(claim),latestTime});
    return this.#record(proposal,SettlementDecisionType.ACCEPT_CURRENT,'explicit fresh evidence is admissible as current state',existing.map(c=>c.id),receipt,{claimTime:timeOf(claim)});
  }

  #validate(proposal){
    if(!proposal||proposal.owner!=='WORLD_STATE')return{ok:false,reason:'proposal canonical owner is not WORLD_STATE'};
    if(![MutationType.SET_CLAIM,MutationType.CLOSE_SLOT].includes(proposal.mutationType))return{ok:false,reason:'unsupported mutation type'};
    if(proposal.freshnessRevisionIds.some(id=>!this.registry.isActiveRevision(id)))return{ok:false,reason:'proposal source revision is stale'};
    if(proposal.evidenceIds.some(id=>!this.registry.isArtifactValid(id)))return{ok:false,reason:'proposal evidence is missing or invalid'};
    if(proposal.mutationType===MutationType.SET_CLAIM&&!proposal.payload?.claim?.id)return{ok:false,reason:'SET_CLAIM payload is invalid'};
    const claim=proposal.payload?.claim??null;
    if(claim?.authorityClass===AuthorityClass.INFERRED)return{ok:false,reason:'inferred claim cannot mutate canonical temporal state'};
    if(this.entityRegistry&&(claim?.identityRevisionRefs??[]).some(ref=>!this.entityRegistry.isCurrentRevisionRef(ref)))return{ok:false,reason:'claim identity revision is stale'};
    return{ok:true};
  }

  #record(proposal,decision,reason,consideredClaimIds,receipt,diagnostics){
    this.#sequence+=1;const row=createSettlementDecision({id:`settlement-decision:${this.#sequence}:${proposal.id}`,proposalId:proposal.id,decision,owner:proposal.owner,evidenceIds:[...proposal.evidenceIds],sourceRevisionIds:[...proposal.sourceRevisionIds],worldRevision:this.graph.revision,reason,consideredClaimIds:[...new Set(consideredClaimIds)].sort(),receiptId:receipt?.id??null,diagnostics});this.#decisions.set(row.id,row);return{decision:structuredClone(row),receipt:receipt?structuredClone(receipt):null};
  }
  explain(decisionId){const d=this.#decisions.get(decisionId);return d?structuredClone(d):null;}
  decisions(){return[...this.#decisions.values()].map(x=>structuredClone(x));}
}
