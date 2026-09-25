import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {hashPacket} from '../src/context-seal.js';
import {EMBER_TAVERN_WAVE3} from './fixtures/ember-tavern-wave3.js';

const host=(S,activity,id,content='',extra={})=>{const messageRevision=extra.messageRevision??1,swipeId=extra.swipeId??'primary';return{activity,chatId:extra.chatId??'native',hostEventId:extra.hostEventId??`host:${id}:${activity}:r${messageRevision}:${swipeId}`,messageId:extra.messageId??id,messageRevision,turnId:extra.turnId??`turn:${id}`,content,...extra};};
const fs=(S,value,revision,evidence,observationClass=S.ObservationClass.OBSERVED,confidence=1)=>S.createFieldState({value,revision,evidenceRefs:[evidence],observationClass,confidence});

async function loadScene(){
 const root=process.env.AREA52_SCENE_REF_ROOT;if(!root)throw new Error('AREA52_SCENE_REF_ROOT must point to accepted Scene checkout');
 return import(pathToFileURL(path.join(root,'src/scene/index.js')).href);
}
function nativeRuntime(S){
 const timeline=[];let seq=0;
 const publisher=new S.SceneEventPublisher({sink:event=>timeline.push({seq:++seq,type:'event',value:event})});
 const invalidationPublisher=new S.SceneContextInvalidationPublisher({sink:value=>timeline.push({seq:++seq,type:'invalidation',value})});
 const rt=new S.SceneLifecycleRuntime({publisher,contextInvalidationPublisher:invalidationPublisher});
 return{rt,timeline,cursor:0};
}
function newCore(){const core=new Area52CognitiveCore();core.activateHotCognitionChat('native');return core;}
function emberCore(){const core=newCore();for(const row of EMBER_TAVERN_WAVE3.sources)core.importAndLearn(row);for(const row of EMBER_TAVERN_WAVE3.experiences)core.importAndLearn(row);return core;}
function feedNative(core,native,{consumeSignal=true}={}){
 const receipts=[];for(;native.cursor<native.timeline.length;native.cursor++){const row=native.timeline[native.cursor];receipts.push(row.type==='event'?core.consumeCognitiveEvent(row.value):core.consumeSceneContextInvalidation(row.value));}
 const signal=consumeSignal?native.rt.integrationSignal('native'):null;if(signal)receipts.push(core.consumeSceneSignal(signal));return{signal,receipts};
}
function publish(core,id,query='Continue the current scene.',extra={}){return core.publishGenerationContext({turnId:`turn:core:${id}`,correlationId:`corr:core:${id}`,query,intent:'CURRENT',anchorEntityIds:[],sealedAt:100,...extra});}
function deliver(core,published,id,previousPlan=null){return core.deliverGenerationContext({published,generationId:`gen:${id}`,modelProfileId:'RECENCY_WEIGHTED',userInput:published.packet.query,previousPlan});}

export async function runFt002Wave10NativeSceneAcceptance(){
 const S=await loadScene(),metrics={},evidence={};

 {
  const n=nativeRuntime(S),core=newCore();
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'a1','Mara discusses the route.'),{extract:(e,s)=>({fields:{location:fs(S,{location:'Ember Tavern'},s.revision+1,e.sourceRevisionId),activeCast:fs(S,[{characterId:'Mara',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]},{characterId:'Eris',state:S.CastPresence.MENTIONED_ONLY,evidenceRefs:[e.sourceRevisionId]}],s.revision+1,e.sourceRevisionId),activeThreads:fs(S,['route'],s.revision+1,e.sourceRevisionId)}})});
  const f1=feedNative(core,n),p1=publish(core,'a1'),d1=deliver(core,p1,'a1');const sceneId=f1.signal.sceneId;
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'a2','Mara continues speaking in the doorway.'),{extract:(e,s)=>({fields:{activeThreads:fs(S,['route'],s.revision+1,e.sourceRevisionId)},boundarySignals:{doorway:1}})});
  const f2=feedNative(core,n),p2=publish(core,'a2'),d2=deliver(core,p2,'a2',d1.plan);
  metrics.stableSameScene=f2.signal.sceneId===sceneId&&p2.cognitiveChoiceReceipt.paths.includes('HOT_ONLY');
  metrics.doorwayNoCut=n.rt.chatScenes.get('native')===sceneId&&!n.timeline.some(x=>x.type==='event'&&x.value.eventType==='SCENE_CLOSED');
  metrics.mentionedOnlyExcluded=f2.signal.castObservations.some(x=>x.characterId==='Eris'&&x.state==='MENTIONED_ONLY')&&!core.sceneIntegrationSnapshot().activeAnchorIds.includes('Eris')&&!core.sceneIntegrationSnapshot().cognitiveNeeds.some(x=>x.anchorEntityIds?.includes('Eris'));
  metrics.nativeSignalUsed=f2.signal.kind==='SceneIntegrationSignal'&&p2.packet.sceneIntegration?.sceneId===sceneId;
  evidence.stable={signal:f2.signal,choice:p2.cognitiveChoiceReceipt,plan:d2.plan};
 }

 {
  const n=nativeRuntime(S),core=newCore();
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'b1','Mara waits outside.'),{extract:(e,s)=>({fields:{location:fs(S,{location:'Street'},s.revision+1,e.sourceRevisionId),activeCast:fs(S,[{characterId:'Mara',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]}],s.revision+1,e.sourceRevisionId)}})});feedNative(core,n);publish(core,'b-prime');
  const oldScene=n.rt.chatScenes.get('native');
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'b2','We arrive inside the Ember Tavern.',{turnId:'turn:transition'}),{extract:(e,s)=>({fields:{location:fs(S,{location:'Ember Tavern'},s.revision+1,e.sourceRevisionId)},boundarySignals:{locationTransition:1,explicitBreak:1},allowWhenRefreshRequired:true})});
  const transitionFeed=feedNative(core,n),transitionOut=publish(core,'b2-transition');const newScene=n.rt.chatScenes.get('native');
  metrics.realLocationTransition=newScene!==oldScene&&transitionOut.cognitiveChoiceReceipt.admittedJobs.includes('RETRIEVAL')&&transitionOut.sceneIntegration.contextInvalidationEpoch>0&&transitionFeed.signal.sceneId===newScene;
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'b2state','Inside now, Eris enters. Three hours later.'),{extract:(e,s)=>({fields:{location:fs(S,{location:'Ember Tavern'},s.revision+1,e.sourceRevisionId),activeCast:fs(S,[{characterId:'Mara',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]},{characterId:'Eris',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]}],s.revision+1,e.sourceRevisionId),narrativeTime:fs(S,{anchor:'03:00 later',mode:'CONTINUOUS'},s.revision+1,e.sourceRevisionId)}})});
  const f=feedNative(core,n),out=publish(core,'b2'),del=deliver(core,out,'b2');
  metrics.newLocationCurrent=f.signal.location.location==='Ember Tavern'&&core.sceneIntegrationSnapshot().location.location==='Ember Tavern';
  metrics.castEntrance=core.sceneIntegrationSnapshot().activeAnchorIds.includes('Eris');
  metrics.timeShift=f.signal.narrativeTime.anchor==='03:00 later'&&out.packet.sceneIntegration.narrativeTime.anchor==='03:00 later'&&del.plan.diagnosticReceipt.sceneIntegration.sceneRevision===f.signal.sceneRevision;
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'b3','Mara leaves; Eris remains.'),{extract:(e,s)=>({fields:{activeCast:fs(S,[{characterId:'Eris',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]}],s.revision+1,e.sourceRevisionId)}})});feedNative(core,n);
  metrics.castExit=core.sceneIntegrationSnapshot().activeAnchorIds.length===1&&core.sceneIntegrationSnapshot().activeAnchorIds[0]==='Eris';evidence.transition={signal:f.signal,published:out,plan:del.plan};
 }

 {
  const n=nativeRuntime(S),core=emberCore(),before=JSON.stringify(core.currentWorldModel());
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'h1','Present scene.'),{extract:(e,s)=>({fields:{activeThreads:fs(S,['present'],s.revision+1,e.sourceRevisionId)}})});feedNative(core,n);publish(core,'h-prime');
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'h2','Years earlier...'),{extract:(e,s)=>({fields:{narrativeTime:fs(S,{mode:'FLASHBACK',anchor:'years earlier'},s.revision+1,e.sourceRevisionId)},boundarySignals:{flashback:1},relationship:S.SceneRelationship.FLASHBACK_OF})});const f=feedNative(core,n),out=publish(core,'h2');
  metrics.flashbackPreserved=f.signal.sceneRelationship===S.SceneRelationship.FLASHBACK_OF&&out.packet.sceneIntegration.sceneRelationship===S.SceneRelationship.FLASHBACK_OF&&JSON.stringify(core.currentWorldModel())===before;
 }

 {
  const n=nativeRuntime(S),core=newCore();n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'i1','Left scene.'),{extract:(e,s)=>({fields:{activeThreads:fs(S,['left'],s.revision+1,e.sourceRevisionId)}})});feedNative(core,n);publish(core,'i-prime');
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'i2','Meanwhile elsewhere...'),{extract:(e,s)=>({fields:{activeThreads:fs(S,['right'],s.revision+1,e.sourceRevisionId)},boundarySignals:{parallel:1},relationship:S.SceneRelationship.PARALLEL_TO})});const f=feedNative(core,n),out=publish(core,'i2');metrics.parallelPreserved=f.signal.sceneRelationship===S.SceneRelationship.PARALLEL_TO&&out.packet.sceneIntegration.sceneRelationship===S.SceneRelationship.PARALLEL_TO;
 }

 {
  const n=nativeRuntime(S),core=newCore();n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'j1','Scene A.'),{extract:(e,s)=>({fields:{activeThreads:fs(S,['A'],s.revision+1,e.sourceRevisionId)}})});feedNative(core,n);publish(core,'j1');const a=n.rt.chatScenes.get('native'),aRev=n.rt.integrationSignal('native').sceneRevision;
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'j2','Interrupt.'),{extract:(e,s)=>({fields:{activeThreads:fs(S,['B'],s.revision+1,e.sourceRevisionId)},boundarySignals:{explicitBreak:1},relationship:S.SceneRelationship.INTERRUPTS})});feedNative(core,n);publish(core,'j2');
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'j3','Return.'),{extract:(e,s)=>({fields:{activeThreads:fs(S,['return'],s.revision+1,e.sourceRevisionId)},boundarySignals:{explicitBreak:1},relationship:S.SceneRelationship.RESUMES,resumeSceneId:a})});const f=feedNative(core,n),out=publish(core,'j3');metrics.resumeIdentity=f.signal.sceneId===a&&f.signal.sceneRevision>aRev&&f.signal.sceneRelationship===S.SceneRelationship.RESUMES&&out.sceneIntegration.sceneId===a;
 }

 {
  const n=nativeRuntime(S),core=newCore();n.rt.ingestHostEvent(host(S,S.HostActivity.ASSISTANT_GENERATION_COMPLETE,'k','They are in the Tavern.'),{extract:(e,s)=>({fields:{location:fs(S,{location:'Ember Tavern'},s.revision+1,e.sourceRevisionId,S.ObservationClass.INFERRED,.6)}})});const old=feedNative(core,n).signal;publish(core,'k-prime');
  n.rt.ingestHostEvent(host(S,S.HostActivity.REGENERATE,'k','They are on the Street.',{messageRevision:2}),{extract:(e,s)=>({fields:{location:fs(S,{location:'Street'},s.revision+1,e.sourceRevisionId)}})});const corrected=feedNative(core,n).signal;const stale=core.consumeSceneSignal(old);
  metrics.correctionFencesOld=corrected.location.location==='Street'&&core.sceneIntegrationSnapshot().location.location==='Street'&&stale.status==='STALE';metrics.staleSceneExcluded=stale.coreHandling==='EXCLUDED_CURRENT';
 }

 {
  const n=nativeRuntime(S),core=newCore();n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'m1','Stable.'),{extract:(e,s)=>({fields:{activeThreads:fs(S,['x'],s.revision+1,e.sourceRevisionId)}})});feedNative(core,n);const oldEvent=n.timeline.find(x=>x.type==='event'&&x.value.eventType==='SCENE_STATE_DELTA').value;
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'m2','Advance.'),{extract:(e,s)=>({fields:{activeThreads:fs(S,['y'],s.revision+1,e.sourceRevisionId)}})});feedNative(core,n);const out=publish(core,'m-seal'),hash=out.sealReceipt.packetHash,packet=JSON.stringify(out.packet);const lateNative=n.rt.publisher.publish({eventType:S.SceneEventType.SCENE_STATE_DELTA,sceneId:oldEvent.sceneId,sceneRevision:oldEvent.sceneRevision,sourceRevisionRefs:oldEvent.sourceRevisionSet,payload:oldEvent.payload,correlationId:'corr:late-native',causationId:oldEvent.eventId,turnId:'turn:core:m-seal',dedupeKey:'late-old-distinct'});const late=core.consumeCognitiveEvent(lateNative);
  metrics.lateStaleAfterSeal=late.status==='STALE'&&core.publication.seal.getReceipt('turn:core:m-seal').packetHash===hash&&JSON.stringify(core.publication.seal.getPacket('turn:core:m-seal'))===packet&&hashPacket(core.publication.seal.getPacket('turn:core:m-seal'))===hash;
 }

 {
  const n=nativeRuntime(S),core=emberCore();n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'n1','At the ruins.'),{extract:(e,s)=>({fields:{location:fs(S,{location:'Ember Tavern ruins'},s.revision+1,e.sourceRevisionId),activeCast:fs(S,[{characterId:'Eris',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]}],s.revision+1,e.sourceRevisionId)}})});feedNative(core,n);
  const out=core.publishGenerationContext({turnId:'turn:n',correlationId:'corr:n',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:900});
  const currentTavern=out.packet.current.some(f=>f.e==='ember-tavern'&&f.p==='state'&&f.v==='destroyed'),historical=out.packet.historical.some(f=>f.e==='sun-blade'&&f.p==='location'&&f.v==='ember-tavern'),unknown=out.packet.unresolved.some(f=>f.e==='sun-blade'&&f.p==='location'&&f.v==='unknown'),destroyed=out.packet.unresolved.some(f=>f.e==='sun-blade'&&f.p==='state'&&f.v==='destroyed'),survived=out.packet.unresolved.some(f=>f.e==='sun-blade'&&f.p==='state'&&f.v==='survived'),falseCurrent=out.packet.current.some(f=>f.e==='sun-blade'&&f.p==='location'&&f.v==='ember-tavern');
  metrics.emberTruthInvariant=currentTavern&&historical&&unknown&&destroyed&&survived&&!falseCurrent;
  metrics.gatherSealProvenance=out.gatherReceipt.sceneId===out.sceneIntegration.sceneId&&out.gatherReceipt.sceneRevision===out.sealReceipt.sceneRevision&&out.sceneIntegration.sourceRevisionRefs.every(x=>out.sealReceipt.sourceRevisionIds.includes(x))&&out.sceneIntegration.provenanceRefs.length>0;
 }

 {
  const n=nativeRuntime(S),core=newCore();core.importAndLearn({id:'relic',sourceType:'LORE',content:'The Relic is intact.',at:0});
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'r1','Mara watches the Relic.'),{extract:(e,s)=>({fields:{location:fs(S,{location:'Vault'},s.revision+1,e.sourceRevisionId),activeCast:fs(S,[{characterId:'Mara',state:S.CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]}],s.revision+1,e.sourceRevisionId)}})});feedNative(core,n);const p1=core.publishGenerationContext({turnId:'turn:r1',correlationId:'corr:r1',query:'What is the Relic state?',intent:'CURRENT',anchorEntityIds:['relic'],sealedAt:1000}),d1=core.deliverGenerationContext({published:p1,generationId:'gen:r1',modelProfileId:'RECENCY_WEIGHTED',userInput:'What is the Relic state?'});
  n.rt.ingestHostEvent(host(S,S.HostActivity.USER_SEND,'r2','Mara keeps watching.'),{extract:(e,s)=>({fields:{activeThreads:fs(S,['watch'],s.revision+1,e.sourceRevisionId)}})});feedNative(core,n);const p2=core.publishGenerationContext({turnId:'turn:r2',correlationId:'corr:r2',query:'What is the Relic state?',intent:'CURRENT',anchorEntityIds:['relic'],sealedAt:1001}),d2=core.deliverGenerationContext({published:p2,generationId:'gen:r2',modelProfileId:'RECENCY_WEIGHTED',userInput:'What is the Relic state?',previousPlan:d1.plan});
  const world=d2.plan.reuseDecisions.find(x=>x.segmentKey==='slot:CURRENT_WORLD_STATE'),scene=d2.plan.reuseDecisions.find(x=>x.segmentKey==='slot:CURRENT_SCENE');metrics.targetedReuse=world?.state==='NO_CHANGE'&&['REBUILD','PATCH'].includes(scene?.state);
 }

 metrics.authorityBoundary=evidence.transition.signal.authority==='DESCRIPTIVE'&&evidence.transition.published.packet.sceneIntegration.truthAuthority===false&&evidence.transition.published.packet.sceneIntegration.settlementAuthority===false&&evidence.transition.published.cognitiveChoiceReceipt.canonicalMutationAuthority===false;
 const pass=Object.values(metrics).every(Boolean);return{pass,metrics,evidence,sceneCheckpoint:path.basename(process.env.AREA52_SCENE_REF_ROOT??''),nativeContractVersion:'1.0.0'};
}
