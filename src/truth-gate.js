import { KnowledgeStatus, createTruthGateResult } from './contracts.js';
const unresolved=new Set([KnowledgeStatus.CONTRADICTED,KnowledgeStatus.UNRESOLVED,KnowledgeStatus.UNCERTAIN]);
export class TruthGate {
  constructor({graph}){this.graph=graph;}
  classify(candidate,{intent='CURRENT'}={}){
    const claims=candidate.claimIds.map(id=>this.graph.getClaim(id)).filter(Boolean);
    if(!claims.length)return createTruthGateResult({candidateId:candidate.candidateId,classification:KnowledgeStatus.UNRESOLVED,usableForIntent:false,reasons:['claim-missing-or-invalid'],claimIds:candidate.claimIds,provenance:candidate.provenance});
    const claim=claims[0],classification=claim.status??KnowledgeStatus.UNRESOLVED;
    let usableForIntent=false;
    if(intent==='CURRENT')usableForIntent=classification===KnowledgeStatus.CURRENT||unresolved.has(classification);
    else if(intent==='HISTORICAL')usableForIntent=[KnowledgeStatus.CURRENT,KnowledgeStatus.HISTORICAL,KnowledgeStatus.SUPERSEDED].includes(classification);
    else if(intent==='TEMPORAL')usableForIntent=[KnowledgeStatus.CURRENT,KnowledgeStatus.HISTORICAL,KnowledgeStatus.SUPERSEDED,KnowledgeStatus.CONTRADICTED,KnowledgeStatus.UNRESOLVED,KnowledgeStatus.UNCERTAIN].includes(classification);
    else if(intent==='CONTRADICTION')usableForIntent=unresolved.has(classification);
    else usableForIntent=classification===KnowledgeStatus.CURRENT;
    return createTruthGateResult({candidateId:candidate.candidateId,classification,usableForIntent,reasons:[usableForIntent?`${classification.toLowerCase()}-usable-for-${intent.toLowerCase()}`:`${classification.toLowerCase()}-not-usable-for-${intent.toLowerCase()}`],claimIds:[claim.id],provenance:claim.provenance});
  }
  classifyAll(candidates,options={}){return candidates.map(c=>this.classify(c,options));}
}
