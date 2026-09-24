import { EvidenceType, createEvidenceRecord } from './contracts.js';
import { SourceRegistry } from './source-registry.js';
import { LoreStudyEngine } from './lore-study.js';
import { TemporalStateGraph } from './temporal-state-graph.js';
import { SettlementEngine } from './settlement-engine.js';
import { SettlementBoundary } from './settlement-boundary.js';
import { MinimalRetrieval } from './retrieval.js';
import { TruthGate } from './truth-gate.js';
import { ContextCompiler } from './context-compiler.js';
import { ReflectionEngine } from './reflection-engine.js';
import { GenerationPublicationPipeline } from './generation-publication.js';
import { AdaptiveContextRuntime } from './adaptive-context-runtime.js';
import { DeliveryLearningEngine } from './delivery-learning.js';
import { FrameworkKernel } from './framework-kernel.js';
import { CognitiveAuditPlane } from './cognitive-audit-plane.js';
import { CoreObservationSpine } from './core-ui-read-models.js';
import { KnowledgeIntegrationSpine } from './knowledge-integration-spine.js';

export class Area52CognitiveCore {
  constructor(){
    this.registry=new SourceRegistry();this.study=new LoreStudyEngine({registry:this.registry});this.graph=new TemporalStateGraph();
    this.settlementCore=new SettlementEngine({registry:this.registry,graph:this.graph});
    this.settlement=new SettlementBoundary({registry:this.registry,graph:this.graph,worldStateSettlement:this.settlementCore});
    this.retrieval=new MinimalRetrieval({graph:this.graph});this.truthGate=new TruthGate({graph:this.graph});this.compiler=new ContextCompiler({graph:this.graph,isCurrentRevision:(revisionId)=>this.registry.isActiveRevision(revisionId)});this.reflection=new ReflectionEngine({registry:this.registry,graph:this.graph});this.studyResults=new Map();
    this.framework=new FrameworkKernel({isCurrentRevision:(revisionId)=>this.registry.isActiveRevision(revisionId)});
    this.audit=new CognitiveAuditPlane({core:this,framework:this.framework,settlement:this.settlement});this.observation=new CoreObservationSpine();
    this.publication=new GenerationPublicationPipeline({core:this});this.audit.bindPublication(this.publication);const receiveResult=this.publication.receiveResult.bind(this.publication);this.publication.receiveResult=(result)=>{const received=receiveResult(result);this.audit.recordResultRoute(received);return received;};
    this.deliveryLearning=new DeliveryLearningEngine();this.delivery=new AdaptiveContextRuntime({deliveryLearning:this.deliveryLearning});
    this.knowledge=new KnowledgeIntegrationSpine({core:this});
  }
  importAndLearn({id,sourceType,content,at=0,metadata={}}){const imported=this.registry.importSource({id,sourceType,content,metadata:{...metadata,at}});const sourceTx=this.audit.recordSourceAdmission({sourceId:id,revision:imported.revision,correlationId:`source:${imported.revision.id}`});return this.learnSource(id,{correlationId:sourceTx.correlationId,causationId:sourceTx.transactionId});}
  importEvidence({id,evidenceType=EvidenceType.NARRATIVE_EXPERIENCE,content,at=0,metadata={}}){const evidence=createEvidenceRecord({id,evidenceType,at,content,metadata});return{evidence,learning:this.importAndLearn({id,sourceType:'EXPERIENCE',content,at,metadata:{...metadata,evidenceType}})};}
  learnSource(sourceId,{correlationId=null,causationId=null}={}){
    const result=this.study.studySource(sourceId),receipts=[],decisions=[];const corr=correlationId??`study:${result.revision.id}`;
    for(const proposal of result.proposals){const proposalTx=this.audit.recordProposal(proposal,{correlationId:corr,causationId});const before=this.graph.revision;const settled=this.settlement.settle(proposal);const after=this.graph.revision;this.audit.recordSettlement(proposal,settled,{correlationId:corr,causationId:proposalTx.transactionId,beforeRevision:before,afterRevision:after});decisions.push(settled.decision);if(settled.receipt)receipts.push(settled.receipt);if(settled.receipt?.outcome==='SETTLED')for(const claimId of settled.receipt.settledArtifactIds)this.registry.registerDerivedArtifact({artifactId:`world:${claimId}`,artifact:{kind:'SettledWorldClaim',claimId,decisionId:settled.decision.id},dependsOnArtifactIds:[claimId],activity:'SETTLE',agent:'settlement-engine'});}
    this.studyResults.set(result.revision.id,result);return{result,receipts,decisions};
  }
  studyBatch(sourceIds,{batchSize=8}={}){const batches=this.study.prepareBatch(sourceIds,{batchSize}),results=[];for(const batch of batches){const execution=this.study.executeBatch(batch),validation=this.study.validateBatch(execution);if(!validation.valid)throw new Error(`Study batch failed validation: ${validation.errors.join(',')}`);for(const result of this.study.commitBatch(validation)){const receipts=[],decisions=[],corr=`study:${result.revision.id}`;for(const proposal of result.proposals){const proposalTx=this.audit.recordProposal(proposal,{correlationId:corr});const before=this.graph.revision;const settled=this.settlement.settle(proposal);this.audit.recordSettlement(proposal,settled,{correlationId:corr,causationId:proposalTx.transactionId,beforeRevision:before,afterRevision:this.graph.revision});decisions.push(settled.decision);if(settled.receipt)receipts.push(settled.receipt);}results.push({result,receipts,decisions});}}return results;}
  editAndRelearn(sourceId,content){const oldRevision=this.registry.getActiveRevision(sourceId),replacement=this.registry.replaceSource(sourceId,content);if(!replacement.changed)return{replacement,relearned:null,invalidatedGraphClaimIds:[],reflectionRefresh:[]};const corr=`source:${replacement.revision.id}`,sourceTx=this.audit.recordSourceAdmission({sourceId,revision:replacement.revision,correlationId:corr,beforeRevision:oldRevision.revision,reasonCode:'SOURCE_REVISION_REPLACED'});const invalidatedGraphClaimIds=this.graph.invalidateClaimsBySourceRevision(oldRevision.id),allInvalidated=[...new Set([...(replacement.invalidatedArtifactIds??[]),...invalidatedGraphClaimIds])].sort(),invalidTx=this.audit.recordInvalidation({artifactIds:allInvalidated,sourceRevisionIds:[oldRevision.id,replacement.revision.id],correlationId:corr,causationId:sourceTx.transactionId,reasonCode:'SOURCE_EDIT_INVALIDATED_DEPENDENCY_CONE'});const relearned=this.learnSource(sourceId,{correlationId:corr,causationId:invalidTx?.transactionId??sourceTx.transactionId}),reflectionRefresh=this.reflection.refreshAll();return{replacement,relearned,invalidatedGraphClaimIds,reflectionRefresh};}
  query(query,{intent='CURRENT',anchorEntityIds=[]}={}){const candidates=this.retrieval.retrieve(query,{intent,anchorEntityIds}),truth=this.truthGate.classifyAll(candidates,{intent}),packet=this.compiler.compile({query,intent,truthResults:truth});return{candidates,truth,packet};}
  publishGenerationContext(options){const published=this.publication.publish(options);this.audit.recordContextPublished(published,{turnId:options.turnId,correlationId:options.correlationId,generationId:options.generationId??null});return published;}
  deliverGenerationContext({published,...deliveryOptions}){
    if(!published?.packet||!published?.sealReceipt)throw new TypeError('deliverGenerationContext requires a published sealed context result');
    const delivered=this.delivery.deliver({sealedPacket:published.packet,sealReceipt:published.sealReceipt,turnId:published.sealReceipt.turnId,...deliveryOptions});if(delivered?.plan)this.audit.recordPromptPlan(delivered);return delivered;
  }
  currentWorldModel(){return{revision:this.graph.revision,current:this.graph.currentProjection(),unresolved:this.graph.unresolvedClaims().map(c=>({subjectId:c.subjectId,predicate:c.predicate,value:c.value,status:c.status,claimId:c.id,sourceRevisionIds:c.provenance?.sourceRevisionIds??[]}))};}
}
