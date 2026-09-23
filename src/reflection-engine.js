import { createHash } from 'node:crypto';
import { AuthorityClass, KnowledgeStatus, ReflectionStatus, createProvenance, createReflection, createReflectionDecision, createReflectionProposal } from './contracts.js';
const stable=(value)=>createHash('sha256').update(String(value),'utf8').digest('hex').slice(0,16);
const clamp=(v)=>Math.max(0,Math.min(1,v));

export class ReflectionEngine {
  #proposals=new Map(); #reflections=new Map(); #decisions=new Map(); #sequence=0;
  constructor({registry,graph,agent='reflection:reference'}){this.registry=registry;this.graph=graph;this.agent=agent;}

  prepareBatch(requests,{batchSize=8}={}){const batches=[];for(let i=0;i<requests.length;i+=batchSize)batches.push({kind:'ReflectionBatch',id:`reflection-batch:${i/batchSize+1}`,requests:requests.slice(i,i+batchSize)});return batches;}
  executeBatch(batch){return{kind:'ReflectionBatchExecution',batchId:batch.id,proposals:batch.requests.map(r=>this.proposePattern(r))};}

  proposePattern({subjectId,pattern,evidenceClaimIds,reasoningSummary,type='BEHAVIOR_PATTERN'}){
    const evidenceIds=[...new Set(evidenceClaimIds)].sort();if(evidenceIds.length<2)throw new Error('Reflection proposal requires repeated evidence (at least two items)');
    const evidence=evidenceIds.map(id=>this.graph.getClaim(id));if(evidence.some(x=>!x))throw new Error('Reflection evidence must be settled graph claims');
    if(evidenceIds.some(id=>!this.registry.isArtifactValid(id)))throw new Error('Reflection evidence must be valid derived artifacts');
    const sourceRevisionIds=[...new Set(evidence.flatMap(c=>c.provenance?.sourceRevisionIds??[]))].sort();
    const signature=`${subjectId}|${JSON.stringify(pattern)}|${evidenceIds.join('|')}`;const id=`reflection-proposal:${stable(signature)}`;
    const proposal=createReflectionProposal({id,evidenceIds,sourceRevisionIds,worldRevision:this.graph.revision,type,confidence:clamp(.45+.1*evidenceIds.length),reasoningSummary,invalidators:[...sourceRevisionIds,...evidenceIds],authorityClass:AuthorityClass.INFERRED,status:ReflectionStatus.PROPOSED,pattern:{subjectId,...pattern}});
    const stored=this.registry.registerDerivedArtifact({artifactId:id,artifact:proposal,sourceRevisionIds,dependsOnArtifactIds:evidenceIds,activity:'REFLECTION_SYNTHESIS',agent:this.agent});this.#proposals.set(id,stored);return structuredClone(stored);
  }

  settleProposal(proposalId,{contradictionEvidenceIds=[]}={}){
    const proposal=this.#proposals.get(proposalId)??this.registry.getArtifact(proposalId,{includeInvalid:true});if(!proposal)throw new Error(`Unknown reflection proposal: ${proposalId}`);
    const support=proposal.evidenceIds.filter(id=>this.registry.isArtifactValid(id)&&this.graph.getClaim(id));const contradictions=[...new Set(contradictionEvidenceIds)].filter(id=>this.registry.isArtifactValid(id)&&this.graph.getClaim(id));
    let status=ReflectionStatus.SUPPORTED,reason='repeated evidence supports the inferred pattern';
    if(proposal.sourceRevisionIds.some(id=>!this.registry.isActiveRevision(id))&&support.length<2){status=ReflectionStatus.REJECTED;reason='supporting source revisions are stale and insufficient valid evidence remains';}
    else if(support.length<2){status=ReflectionStatus.REJECTED;reason='insufficient repeated evidence remains';}
    else if(contradictions.length>=support.length){status=ReflectionStatus.CONTRADICTED;reason='contradicting evidence meets or exceeds support';}
    else if(support.length>=3&&contradictions.length===0){status=ReflectionStatus.ADMITTED;reason='three or more independent observations support bounded inferred learning';}
    else if(contradictions.length){status=ReflectionStatus.UNRESOLVED;reason='both supporting and contradicting evidence remain';}
    const confidence=clamp(.35+.15*support.length-.2*contradictions.length);
    this.#sequence+=1;const decision=createReflectionDecision({id:`reflection-decision:${this.#sequence}:${proposalId}`,proposalId,status,evidenceIds:support,contradictionIds:contradictions,confidence,reason});this.#decisions.set(decision.id,decision);
    if([ReflectionStatus.ADMITTED,ReflectionStatus.SUPPORTED,ReflectionStatus.UNRESOLVED,ReflectionStatus.CONTRADICTED].includes(status))this.#upsertReflection(proposal,decision);
    return structuredClone(decision);
  }

  #upsertReflection(proposal,decision){
    const id=`reflection:${stable(`${proposal.pattern.subjectId}|${JSON.stringify(proposal.pattern)}`)}`;const sourceRevisionIds=[...new Set(decision.evidenceIds.flatMap(id=>this.graph.getClaim(id)?.provenance?.sourceRevisionIds??[]))].sort();
    const provenance=createProvenance({id:`prov:${id}`,sourceRevisionIds,evidenceIds:[...decision.evidenceIds,...decision.contradictionIds],derivedFromIds:[proposal.id],activity:'REFLECTION_SETTLEMENT',agent:this.agent,invalidators:[...sourceRevisionIds,...decision.evidenceIds,...decision.contradictionIds]});
    const statement=proposal.reasoningSummary;const reflection=createReflection({id,statement,evidenceIds:decision.evidenceIds,confidence:decision.confidence,provenance,status:KnowledgeStatus.INFERRED,owner:'REFLECTION',pattern:proposal.pattern,invalidators:[...sourceRevisionIds,...decision.evidenceIds,...decision.contradictionIds],sourceRevisionIds});
    const artifact=this.registry.registerDerivedArtifact({artifactId:id,artifact:{...reflection,reflectionStatus:decision.status,contradictionIds:decision.contradictionIds},sourceRevisionIds,dependsOnArtifactIds:[...decision.evidenceIds,...decision.contradictionIds],activity:'REFLECTION_SETTLEMENT',agent:this.agent});this.#reflections.set(id,artifact);return artifact;
  }

  applyEvidenceFeedback(reflectionId,{supportEvidenceIds=[],contradictionEvidenceIds=[]}={}){
    const reflection=this.#reflections.get(reflectionId);if(!reflection)throw new Error(`Unknown reflection: ${reflectionId}`);
    const support=[...new Set([...reflection.evidenceIds,...supportEvidenceIds])];const contradictions=[...new Set([...(reflection.contradictionIds??[]),...contradictionEvidenceIds])];
    const synthetic={...this.#proposals.values().next().value,id:`feedback:${reflectionId}`,pattern:reflection.pattern,evidenceIds:support,sourceRevisionIds:[...new Set(support.flatMap(id=>this.graph.getClaim(id)?.provenance?.sourceRevisionIds??[]))],reasoningSummary:reflection.statement};
    this.#proposals.set(synthetic.id,synthetic);return this.settleProposal(synthetic.id,{contradictionEvidenceIds:contradictions});
  }

  refresh(reflectionId){
    const reflection=this.#reflections.get(reflectionId);if(!reflection)return null;const validSupport=reflection.evidenceIds.filter(id=>this.registry.isArtifactValid(id)&&this.graph.getClaim(id));const validContradictions=(reflection.contradictionIds??[]).filter(id=>this.registry.isArtifactValid(id)&&this.graph.getClaim(id));
    let reflectionStatus=reflection.reflectionStatus,confidence=reflection.confidence;if(validSupport.length<2){reflectionStatus=ReflectionStatus.SUPERSEDED;confidence=clamp(confidence*.4);}else if(validContradictions.length>=validSupport.length){reflectionStatus=ReflectionStatus.CONTRADICTED;confidence=clamp(confidence*.5);}else if(validSupport.length<reflection.evidenceIds.length){reflectionStatus=ReflectionStatus.SUPPORTED;confidence=clamp(confidence*.75);}
    const updated={...reflection,evidenceIds:validSupport,contradictionIds:validContradictions,reflectionStatus,confidence};this.#reflections.set(reflectionId,updated);return structuredClone(updated);
  }
  refreshAll(){return[...this.#reflections.keys()].map(id=>this.refresh(id));}
  getReflection(id){const r=this.#reflections.get(id);return r?structuredClone(r):null;}
  reflections(){return[...this.#reflections.values()].map(x=>structuredClone(x));}
  decisions(){return[...this.#decisions.values()].map(x=>structuredClone(x));}
}
