import { EvidenceType, createEvidenceRecord } from './contracts.js';
import { SourceRegistry } from './source-registry.js';
import { LoreStudyEngine } from './lore-study.js';
import { TemporalStateGraph } from './temporal-state-graph.js';
import { SettlementEngine } from './settlement-engine.js';
import { SettlementBoundary } from './settlement-boundary.js';
import { SensoryNetBackbone } from './sensory-net-backbone.js';
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
import { HotCognitionRuntime } from './hot-cognition-runtime.js';
import { CognitiveChoiceController } from './cognitive-choice-controller.js';
import { SceneCoreIntegrationBridge,SUPPORTED_SCENE_EVENT_TYPES } from './scene-core-integration.js';

export class Area52CognitiveCore {
  constructor(){
    this.registry=new SourceRegistry();this.study=new LoreStudyEngine({registry:this.registry});this.graph=new TemporalStateGraph();
    this.settlementCore=new SettlementEngine({registry:this.registry,graph:this.graph});
    this.settlement=new SettlementBoundary({registry:this.registry,graph:this.graph,worldStateSettlement:this.settlementCore});
    this.externalKnowledgeResolver=null;this.externalCurrentSourceRevisionRefs=new Set();
    this.truthGate=new TruthGate({graph:this.graph});this.compiler=new ContextCompiler({graph:this.graph,isCurrentRevision:(revisionId)=>this.isSourceRevisionCurrent(revisionId)});this.reflection=new ReflectionEngine({registry:this.registry,graph:this.graph});this.studyResults=new Map();
    this.framework=new FrameworkKernel({isCurrentRevision:(revisionId)=>this.registry.isActiveRevision(revisionId)});
    this.hotCognition=new HotCognitionRuntime({sourceRegistry:this.registry,getWorldRevision:()=>this.graph.revision});
    this.retrieval=new SensoryNetBackbone({graph:this.graph,sourceRegistry:this.registry,hotCognition:this.hotCognition,isSourceRevisionCurrent:(revisionId)=>this.isSourceRevisionCurrent(revisionId),externalRevisionSink:(refs)=>this.setExternalCurrentSourceRevisionRefs(refs)});
    this.cognitiveChoice=new CognitiveChoiceController();
    this.sceneIntegration=new SceneCoreIntegrationBridge({core:this});
    this.audit=new CognitiveAuditPlane({core:this,framework:this.framework,settlement:this.settlement});this.observation=new CoreObservationSpine();
    this.publication=new GenerationPublicationPipeline({core:this,cognitiveChoice:this.cognitiveChoice});this.audit.bindPublication(this.publication);const receiveResult=this.publication.receiveResult.bind(this.publication);this.publication.receiveResult=(result)=>{const received=receiveResult(result);this.audit.recordResultRoute(received);this.hotCognition.consumeResultRoute(received);return received;};
    this.deliveryLearning=new DeliveryLearningEngine();this.delivery=new AdaptiveContextRuntime({deliveryLearning:this.deliveryLearning});
    this.knowledge=new KnowledgeIntegrationSpine({core:this});
  }
  importAndLearn({id,sourceType,content,at=0,metadata={}}){const imported=this.registry.importSource({id,sourceType,content,metadata:{...metadata,at}});const sourceTx=this.audit.recordSourceAdmission({sourceId:id,revision:imported.revision,correlationId:`source:${imported.revision.id}`});return this.learnSource(id,{correlationId:sourceTx.correlationId,causationId:sourceTx.transactionId});}
  importEvidence({id,evidenceType=EvidenceType.NARRATIVE_EXPERIENCE,content,at=0,metadata={}}){const evidence=createEvidenceRecord({id,evidenceType,at,content,metadata});return{evidence,learning:this.importAndLearn({id,sourceType:'EXPERIENCE',content,at,metadata:{...metadata,evidenceType}})};}
  learnSource(sourceId,{correlationId=null,causationId=null}={}){
    const result=this.study.studySource(sourceId),receipts=[],decisions=[];const corr=correlationId??`study:${result.revision.id}`;
    for(const proposal of result.proposals){const proposalTx=this.audit.recordProposal(proposal,{correlationId:corr,causationId});const before=this.graph.revision;const settled=this.settlement.settle(proposal);const after=this.graph.revision;this.audit.recordSettlement(proposal,settled,{correlationId:corr,causationId:proposalTx.transactionId,beforeRevision:before,afterRevision:after});decisions.push(settled.decision);if(settled.receipt)receipts.push(settled.receipt);if(settled.receipt?.outcome==='SETTLED')for(const claimId of settled.receipt.settledArtifactIds)this.registry.registerDerivedArtifact({artifactId:`world:${claimId}`,artifact:{kind:'SettledWorldClaim',claimId,decisionId:settled.decision.id},dependsOnArtifactIds:[claimId],activity:'SETTLE',agent:'settlement-engine'});}
    this.studyResults.set(result.revision.id,result);const settledRefs=receipts.filter(x=>x?.outcome==='SETTLED').flatMap(x=>x.settledArtifactIds??[]);if(settledRefs.length&&this.hotCognition.hasActiveChat)this.hotCognition.consumeOwnerWorldChange({updateId:`world:${this.graph.revision}:${result.revision.id}`,worldRevision:this.graph.revision,sourceRevisionRefs:[result.revision.id],artifactRefs:settledRefs,provenanceRefs:[result.revision.id],eventType:'STATE_SETTLED'});return{result,receipts,decisions};
  }
  studyBatch(sourceIds,{batchSize=8}={}){const batches=this.study.prepareBatch(sourceIds,{batchSize}),results=[];for(const batch of batches){const execution=this.study.executeBatch(batch),validation=this.study.validateBatch(execution);if(!validation.valid)throw new Error(`Study batch failed validation: ${validation.errors.join(',')}`);for(const result of this.study.commitBatch(validation)){const receipts=[],decisions=[],corr=`study:${result.revision.id}`;for(const proposal of result.proposals){const proposalTx=this.audit.recordProposal(proposal,{correlationId:corr});const before=this.graph.revision;const settled=this.settlement.settle(proposal);this.audit.recordSettlement(proposal,settled,{correlationId:corr,causationId:proposalTx.transactionId,beforeRevision:before,afterRevision:this.graph.revision});decisions.push(settled.decision);if(settled.receipt)receipts.push(settled.receipt);}const settledRefs=receipts.filter(x=>x?.outcome==='SETTLED').flatMap(x=>x.settledArtifactIds??[]);if(settledRefs.length&&this.hotCognition.hasActiveChat)this.hotCognition.consumeOwnerWorldChange({updateId:`world:${this.graph.revision}:${result.revision.id}`,worldRevision:this.graph.revision,sourceRevisionRefs:[result.revision.id],artifactRefs:settledRefs,provenanceRefs:[result.revision.id],eventType:'STATE_SETTLED'});results.push({result,receipts,decisions});}}return results;}
  editAndRelearn(sourceId,content){const oldRevision=this.registry.getActiveRevision(sourceId),replacement=this.registry.replaceSource(sourceId,content);if(!replacement.changed)return{replacement,relearned:null,invalidatedGraphClaimIds:[],reflectionRefresh:[]};const corr=`source:${replacement.revision.id}`,sourceTx=this.audit.recordSourceAdmission({sourceId,revision:replacement.revision,correlationId:corr,beforeRevision:oldRevision.revision,reasonCode:'SOURCE_REVISION_REPLACED'});const invalidatedGraphClaimIds=this.graph.invalidateClaimsBySourceRevision(oldRevision.id),allInvalidated=[...new Set([...(replacement.invalidatedArtifactIds??[]),...invalidatedGraphClaimIds])].sort(),invalidTx=this.audit.recordInvalidation({artifactIds:allInvalidated,sourceRevisionIds:[oldRevision.id,replacement.revision.id],correlationId:corr,causationId:sourceTx.transactionId,reasonCode:'SOURCE_EDIT_INVALIDATED_DEPENDENCY_CONE'});if(this.hotCognition.hasActiveChat)this.hotCognition.invalidateKnowledge({updateId:`knowledge-invalidated:${oldRevision.id}->${replacement.revision.id}`,invalidatedSourceRevisionRefs:[oldRevision.id],reason:'SOURCE_EDIT_INVALIDATED_DEPENDENCY_CONE'});this.retrieval?.indexLifecycle?.invalidateBySourceRevision?.(oldRevision.id,{reason:'SOURCE_EDIT_INVALIDATED_DEPENDENCY_CONE'});const relearned=this.learnSource(sourceId,{correlationId:corr,causationId:invalidTx?.transactionId??sourceTx.transactionId}),reflectionRefresh=this.reflection.refreshAll();return{replacement,relearned,invalidatedGraphClaimIds,reflectionRefresh};}
  query(query,{intent='CURRENT',anchorEntityIds=[]}={}){const candidates=this.retrieval.retrieve(query,{intent,anchorEntityIds}),truth=this.truthGate.classifyAll(candidates,{intent}),packet=this.compiler.compile({query,intent,truthResults:truth});return{candidates,truth,packet};}
  publishGenerationContext(options){const published=this.publication.publish(options);if(!published.duplicate)this.audit.recordContextPublished(published,{turnId:options.turnId,correlationId:options.correlationId,generationId:options.generationId??null});return published;}
  deliverGenerationContext({published,...deliveryOptions}){
    if(!published?.packet||!published?.sealReceipt)throw new TypeError('deliverGenerationContext requires a published sealed context result');
    const contributions=[...(published.hotContributions??[]),...(deliveryOptions.contributions??[])];
    const delivered=this.delivery.deliver({sealedPacket:published.packet,sealReceipt:published.sealReceipt,turnId:published.sealReceipt.turnId,...deliveryOptions,contributions});if(delivered?.plan)this.audit.recordPromptPlan(delivered);return delivered;
  }
  activateHotCognitionChat(chatNamespace,options){const snapshot=this.hotCognition.activateChat(chatNamespace,options);this.sceneIntegration.activateChat(chatNamespace);return snapshot;}
  consumeSceneSignal(signal,options={}){const receipt=this.sceneIntegration.consumeSignal(signal,options);const trace=this.sceneIntegration.publicationTrace(options.chatNamespace??this.hotCognition.activeChatNamespace);if(trace)this.publication.setSceneRevision(trace.sceneRevision,{sceneId:trace.sceneId});return receipt;}
  consumeSceneContextInvalidation(signal,options={}){const receipt=this.sceneIntegration.consumeInvalidation(signal,options);const trace=this.sceneIntegration.publicationTrace(options.chatNamespace??this.hotCognition.activeChatNamespace);if(trace)this.publication.setSceneRevision(trace.sceneRevision,{sceneId:trace.sceneId});return receipt;}
  consumeCognitiveEvent(event,options={}){
    if(SUPPORTED_SCENE_EVENT_TYPES.includes(String(event?.eventType??''))){
      const receipt=this.sceneIntegration.consumeEvent(event,options),trace=this.sceneIntegration.publicationTrace(options.chatNamespace??this.hotCognition.activeChatNamespace);
      if(trace)this.publication.setSceneRevision(trace.sceneRevision,{sceneId:trace.sceneId});return receipt;
    }
    const receipt=this.hotCognition.consumeEvent(event,options);const revision=Number(event?.sceneRevision??event?.revisionFences?.sceneRevision??event?.payload?.sceneRevision);if(Number.isInteger(revision)&&revision>=0)this.publication.setSceneRevision(revision);return receipt;
  }
  consumeNarrativeEvidence(evidence,options={}){return this.hotCognition.consumeNarrativeEvidence(evidence,options);}
  hotCognitionSnapshot(chatNamespace){return this.hotCognition.snapshot(chatNamespace);}
  sceneIntegrationSnapshot(chatNamespace){return this.sceneIntegration.snapshot(chatNamespace);}
  sceneIntegrationDiagnostics(chatNamespace){return this.sceneIntegration.diagnostics(chatNamespace);}
  setExternalCurrentSourceRevisionRefs(refs=[]){this.externalCurrentSourceRevisionRefs=new Set((refs??[]).filter(Boolean).map(String));return this.externalCurrentSourceRevisionIds();}
  externalCurrentSourceRevisionIds(){return [...this.externalCurrentSourceRevisionRefs].sort();}
  currentSourceRevisionIds(){return [...new Set([...this.registry.activeRevisionIds(),...this.externalCurrentSourceRevisionIds()])].sort();}
  isSourceRevisionCurrent(revisionId){const id=String(revisionId);return this.registry.getRevision(id)?this.registry.isActiveRevision(id):this.externalCurrentSourceRevisionRefs.has(id);}
  registerExternalKnowledgeResolver(resolver=null){
    if(resolver!==null&&typeof resolver!=='function')throw new TypeError('external knowledge resolver must be a function');
    this.externalKnowledgeResolver=resolver;
    this.truthGate.setExternalEvidenceResolver(resolver);
    return{registered:Boolean(resolver),authorityGranted:false,settlementAuthority:false};
  }
  resolveExternalKnowledge(candidate){return this.externalKnowledgeResolver?.(candidate)??null;}
  registerJevAdapter(adapter){return this.cognitiveChoice.registerJevAdapter(adapter);}
  cognitiveChoiceReceipt(turnId){return this.cognitiveChoice.getReceipt(turnId);}
  sensoryEnvelope(query,options={}){return this.retrieval.retrieveEnvelope(query,options);}
  sensoryManifest(){return this.retrieval.manifest();}
  sensoryDiagnostics(){return this.retrieval.diagnostics();}
  registerRetrievalChannel(provider){return this.retrieval.registerChannel(provider);}
  registerRetrievalIndexChannel(options){return this.retrieval.registerIndexChannel(options);}
  indexRetrievalArtifact(artifact,options={}){return this.retrieval.indexLifecycle.indexArtifact(artifact,options);}
  currentWorldModel(){return{revision:this.graph.revision,current:this.graph.currentProjection(),unresolved:this.graph.unresolvedClaims().map(c=>({subjectId:c.subjectId,predicate:c.predicate,value:c.value,status:c.status,claimId:c.id,sourceRevisionIds:c.provenance?.sourceRevisionIds??[]}))};}
}
