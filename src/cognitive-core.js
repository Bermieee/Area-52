import { EvidenceType, createEvidenceRecord } from './contracts.js';
import { SourceRegistry } from './source-registry.js';
import { LoreStudyEngine } from './lore-study.js';
import { TemporalStateGraph } from './temporal-state-graph.js';
import { SettlementEngine } from './settlement-engine.js';
import { MinimalRetrieval } from './retrieval.js';
import { TruthGate } from './truth-gate.js';
import { ContextCompiler } from './context-compiler.js';
import { ReflectionEngine } from './reflection-engine.js';

export class Area52CognitiveCore {
  constructor(){
    this.registry=new SourceRegistry();this.study=new LoreStudyEngine({registry:this.registry});this.graph=new TemporalStateGraph();
    this.settlement=new SettlementEngine({registry:this.registry,graph:this.graph});this.retrieval=new MinimalRetrieval({graph:this.graph});this.truthGate=new TruthGate({graph:this.graph});this.compiler=new ContextCompiler({graph:this.graph});this.reflection=new ReflectionEngine({registry:this.registry,graph:this.graph});this.studyResults=new Map();
  }
  importAndLearn({id,sourceType,content,at=0,metadata={}}){this.registry.importSource({id,sourceType,content,metadata:{...metadata,at}});return this.learnSource(id);}
  importEvidence({id,evidenceType=EvidenceType.NARRATIVE_EXPERIENCE,content,at=0,metadata={}}){const evidence=createEvidenceRecord({id,evidenceType,at,content,metadata});return{evidence,learning:this.importAndLearn({id,sourceType:'EXPERIENCE',content,at,metadata:{...metadata,evidenceType}})};}
  learnSource(sourceId){
    const result=this.study.studySource(sourceId),receipts=[],decisions=[];
    for(const proposal of result.proposals){const settled=this.settlement.settle(proposal);decisions.push(settled.decision);if(settled.receipt)receipts.push(settled.receipt);if(settled.receipt?.outcome==='SETTLED')for(const claimId of settled.receipt.settledArtifactIds)this.registry.registerDerivedArtifact({artifactId:`world:${claimId}`,artifact:{kind:'SettledWorldClaim',claimId,decisionId:settled.decision.id},dependsOnArtifactIds:[claimId],activity:'SETTLE',agent:'settlement-engine'});}
    this.studyResults.set(result.revision.id,result);return{result,receipts,decisions};
  }
  studyBatch(sourceIds,{batchSize=8}={}){const batches=this.study.prepareBatch(sourceIds,{batchSize}),results=[];for(const batch of batches){const execution=this.study.executeBatch(batch),validation=this.study.validateBatch(execution);if(!validation.valid)throw new Error(`Study batch failed validation: ${validation.errors.join(',')}`);for(const result of this.study.commitBatch(validation)){const receipts=[],decisions=[];for(const proposal of result.proposals){const settled=this.settlement.settle(proposal);decisions.push(settled.decision);if(settled.receipt)receipts.push(settled.receipt);}results.push({result,receipts,decisions});}}return results;}
  editAndRelearn(sourceId,content){const oldRevision=this.registry.getActiveRevision(sourceId),replacement=this.registry.replaceSource(sourceId,content);if(!replacement.changed)return{replacement,relearned:null,invalidatedGraphClaimIds:[],reflectionRefresh:[]};const invalidatedGraphClaimIds=this.graph.invalidateClaimsBySourceRevision(oldRevision.id),relearned=this.learnSource(sourceId),reflectionRefresh=this.reflection.refreshAll();return{replacement,relearned,invalidatedGraphClaimIds,reflectionRefresh};}
  query(query,{intent='CURRENT',anchorEntityIds=[]}={}){const candidates=this.retrieval.retrieve(query,{intent,anchorEntityIds}),truth=this.truthGate.classifyAll(candidates,{intent}),packet=this.compiler.compile({query,intent,truthResults:truth});return{candidates,truth,packet};}
  currentWorldModel(){return{revision:this.graph.revision,current:this.graph.currentProjection(),unresolved:this.graph.unresolvedClaims().map(c=>({subjectId:c.subjectId,predicate:c.predicate,value:c.value,status:c.status,claimId:c.id,sourceRevisionIds:c.provenance?.sourceRevisionIds??[]}))};}
}
