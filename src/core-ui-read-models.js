import {createHotCognitionReadModel} from './hot-cognition-read-model.js';
const clone=(v)=>structuredClone(v);
function deepFreeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))deepFreeze(x);Object.freeze(v);}return v;}
const frozen=(v)=>deepFreeze(clone(v));
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean))].sort();
export const CoreWidgetHealth=Object.freeze({READY:'READY',WORKING:'WORKING',DEGRADED:'DEGRADED',STALE:'STALE',BLOCKED:'BLOCKED',ERROR:'ERROR'});
export const AuthorityLabel=Object.freeze({SOURCE_CANON:'SOURCE_CANON',OBSERVED:'OBSERVED',SETTLED:'SETTLED',INFERRED:'INFERRED',UNRESOLVED:'UNRESOLVED'});
function healthFrom({blocked=false,stale=false,error=false,working=false,degraded=false,reasons=[]}={}){return frozen({state:error?CoreWidgetHealth.ERROR:blocked?CoreWidgetHealth.BLOCKED:stale?CoreWidgetHealth.STALE:working?CoreWidgetHealth.WORKING:degraded?CoreWidgetHealth.DEGRADED:CoreWidgetHealth.READY,reasons:uniq(reasons)});}
function unresolvedRows(packet){return(packet?.unresolved??[]).map(f=>({artifactId:f.id??null,subjectId:f.e??f.subjectId??null,predicate:f.p??f.predicate??null,value:clone(f.v??f.value??null),authority:f.a??f.authorityClass??AuthorityLabel.UNRESOLVED,status:f.t?.[2]??'UNRESOLVED',provenanceRefs:uniq(packet?.provenanceIndex?.[f.id]??[])}));}

export function createPromptPlanReadModel(plan,{integrityReceipt=null}={}){
  if(!plan?.promptPlanId)throw new TypeError('PromptPlan is required');
  const reused=(plan.segments??[]).filter(x=>['NO_CHANGE','PATCH'].includes(x.reuseState)).map(x=>({segmentId:x.segmentId,slot:x.slot,reuseState:x.reuseState,cacheEligible:Boolean(x.cacheEligible)}));
  const rebuilt=(plan.segments??[]).filter(x=>!['NO_CHANGE','PATCH'].includes(x.reuseState)).map(x=>({segmentId:x.segmentId,slot:x.slot,reuseState:x.reuseState??'REBUILD',cacheEligible:Boolean(x.cacheEligible)}));
  return frozen({kind:'PromptPlanReadModel',contractVersion:'1.0.0',promptPlanId:plan.promptPlanId,generationId:plan.generationId,turnId:plan.turnId,contextSealId:plan.contextSealId,sealedPacketHash:plan.sealedPacketHash,modelProfileId:plan.modelProfileId,modelProfileRevision:plan.modelProfileRevision,deliveryPolicyRevision:plan.deliveryPolicyRevision,worldRevision:plan.worldRevision,sceneId:plan.diagnosticReceipt?.sceneIntegration?.sceneId??null,sceneRevision:plan.sceneRevision,sceneIntegration:clone(plan.diagnosticReceipt?.sceneIntegration??null),sourceRevisionRefs:uniq(plan.sourceRevisionDependencies),
    slotAllocation:(plan.sections??[]).map(s=>({slot:s.slot,representation:s.representation??null,estimatedTokens:s.estimatedTokens??s.tokenEstimate??null,required:Boolean(s.required),protected:Boolean(s.protected)})),sectionOrder:[...(plan.ordering??[])],reuseDecisions:clone(plan.reuseDecisions??[]),cacheDecisions:clone(plan.cacheDecisions??[]),reusedSegments:reused,rebuiltSegments:rebuilt,dropped:clone(plan.dropped??[]),deferred:clone(plan.deferred??[]),fallbackDecisions:clone(plan.fallbackDecisions??[]),representationDensity:(plan.sections??[]).map(s=>({slot:s.slot,representation:s.representation??null})),budget:clone(plan.budget??{}),estimatedTokens:plan.budget?.estimatedTokens??plan.budget?.usedTokens??plan.budget?.allocated??null,integrityStatus:integrityReceipt?.valid===false?'ERROR':plan.status==='READY'?'READY':plan.status,health:healthFrom({error:integrityReceipt?.valid===false,degraded:(plan.dropped?.length??0)>0||(plan.deferred?.length??0)>0,reasons:[...((plan.dropped?.length??0)?['CONTENT_DROPPED']:[]),...((plan.deferred?.length??0)?['CONTENT_DEFERRED']:[])]}),authority:'READ_ONLY',mutationAuthority:false});
}
export function createContextReceiptReadModel({published,delivery}={}){
  const seal=published?.sealReceipt,packet=published?.packet,plan=delivery?.plan;if(!seal||!packet||!plan)throw new TypeError('published seal and delivery plan are required');
  const prompt=createPromptPlanReadModel(plan,{integrityReceipt:delivery?.integrityReceipt});
  return frozen({kind:'ContextReceiptReadModel',contractVersion:'1.0.0',turnId:seal.turnId,generationId:plan.generationId,contextSealId:seal.id,promptPlanId:plan.promptPlanId,packetId:seal.packetId,packetHash:seal.packetHash,modelProfileId:plan.modelProfileId,worldRevision:seal.worldRevision,sceneId:packet.sceneIntegration?.sceneId??plan.diagnosticReceipt?.sceneIntegration?.sceneId??null,sceneRevision:seal.sceneRevision,sceneIntegration:clone(packet.sceneIntegration??plan.diagnosticReceipt?.sceneIntegration??null),sourceRevisionRefs:uniq(seal.sourceRevisionIds),includedSections:(plan.sections??[]).map(x=>x.slot),omittedSections:clone(plan.dropped??[]),deferredSections:clone(plan.deferred??[]),unresolvedEvidence:unresolvedRows(packet),reusedSegments:prompt.reusedSegments,rebuiltSegments:prompt.rebuiltSegments,budget:clone(plan.budget??{}),estimatedTokens:prompt.estimatedTokens,fallbackState:seal.fallbackState,provenanceRefs:uniq(Object.values(packet.provenanceIndex??{}).flat()),health:prompt.health,authority:'READ_ONLY',mutationAuthority:false});
}
export function createForensicReadModel(bundle,{diagnosticReasons=[]}={}){
  if(!bundle?.bundleId)throw new TypeError('ForensicBundle is required');
  return frozen({kind:'ForensicReadModel',contractVersion:'1.0.0',bundleId:bundle.bundleId,turnId:bundle.turnId,generationId:bundle.generationId,worldRevision:bundle.worldRevision,sceneRevision:bundle.sceneRevision,sourceRevisionRefs:uniq(bundle.sourceRevisionRefs),turnEventRef:bundle.turnEventRef,runtimeWorkRefs:uniq(bundle.runtimeWorkRefs),workerResultRefs:uniq(bundle.workerResultRefs),truthDecisionRefs:uniq(bundle.truthDecisionRefs),precisionRefs:uniq(bundle.precisionRefs),gatherRef:bundle.gatherRef,transactionRefs:[...(bundle.transactionRefs??[])],settlementRefs:uniq(bundle.settlementRefs),contextSealRef:bundle.contextSealRef,promptPlanRef:bundle.promptPlanRef,lateResultRefs:uniq(bundle.lateResultRefs),staleResultRefs:uniq(bundle.staleResultRefs),diagnosticRefs:uniq(bundle.diagnosticRefs),diagnosticReasons:clone(diagnosticReasons),assemblyProvenanceRefs:uniq(bundle.assemblyProvenanceRefs),complete:Boolean(bundle.complete),health:healthFrom({degraded:!bundle.complete,reasons:bundle.complete?[]:['FORENSIC_BUNDLE_INCOMPLETE']}),authority:'READ_ONLY',mutationAuthority:false});
}
export function createKnowledgeTraceReadModel({
  contextItemId,authority,temporalStatus,immediateArtifact=null,sourceRevisionRefs=[],derivationChain=[],
  retrievalChannels=[],precisionReasons=[],truthClassification=null,unresolvedLinks=[],freshness='FRESH',
}={}){
  if(!contextItemId)throw new TypeError('contextItemId is required');
  const stale=freshness==='STALE',blocked=freshness==='INVALID';
  return frozen({kind:'KnowledgeTraceReadModel',contractVersion:'1.0.0',contextItemId:String(contextItemId),
    authority:authority??AuthorityLabel.UNRESOLVED,temporalStatus:temporalStatus??'UNRESOLVED',
    immediateArtifact:clone(immediateArtifact),sourceRevisionRefs:uniq(sourceRevisionRefs),derivationChain:clone(derivationChain),
    retrievalChannels:uniq(retrievalChannels),precisionReasons:uniq(precisionReasons),truthClassification:truthClassification??null,
    unresolvedLinks:uniq(unresolvedLinks),freshness,health:healthFrom({stale,blocked,reasons:stale?['KNOWLEDGE_STALE']:blocked?['KNOWLEDGE_INVALID']:[]}),
    readOnly:true,mutationAuthority:false});
}
export function createWidgetHealth(input={}){return healthFrom(input);}
export function isCoreReadModelFresh(model,{turnId=model?.turnId,generationId=model?.generationId,worldRevision=model?.worldRevision,sceneRevision=model?.sceneRevision,contextSealId=model?.contextSealId,promptPlanId=model?.promptPlanId}={}){
  if(!model)return false;return(turnId==null||model.turnId===turnId)&&(generationId==null||model.generationId===generationId)&&(worldRevision==null||Number(model.worldRevision)===Number(worldRevision))&&(sceneRevision==null||Number(model.sceneRevision)===Number(sceneRevision))&&(contextSealId==null||model.contextSealId===contextSealId)&&(promptPlanId==null||model.promptPlanId===promptPlanId);
}
export class CoreObservationSpine{
  contextReceipt(input){return createContextReceiptReadModel(input);}
  promptPlan(plan,options){return createPromptPlanReadModel(plan,options);}
  forensic(bundle,options){return createForensicReadModel(bundle,options);}
  knowledgeTrace(input){return createKnowledgeTraceReadModel(input);}
  hotCognition(snapshot){return createHotCognitionReadModel(snapshot);}
  widgetHealth(input){return createWidgetHealth(input);}
  isFresh(model,expected){return isCoreReadModelFresh(model,expected);}
}
