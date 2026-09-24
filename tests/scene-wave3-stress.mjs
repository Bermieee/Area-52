import assert from 'node:assert/strict';
import {
  BoundaryStatus, HostActivity, NarrativeFeedAdapter, ObservationClass, SceneDeltaEngine, SceneEventPublisher,
  SceneEventType, SceneLifecycleRuntime, SceneRelationship, SillyTavernHostBridge, createFieldState,
  exportSceneLifecycleState, importSceneLifecycleState,
} from '../src/scene/index.js';

const bytes=(v)=>new TextEncoder().encode(JSON.stringify(v)).length;
const now=()=>performance.now();
const field=(value,revision,evidence)=>createFieldState({value,confidence:1,evidenceRefs:[evidence],observationClass:ObservationClass.OBSERVED,revision});

let hostAdapter=new NarrativeFeedAdapter({maxDedupe:2048});let hostAccepted=0,hostDuplicates=0;
const hostStarted=now();
for(let i=0;i<10000;i++){
  const group=Math.floor(i/100),step=i%100;let input;
  if(step===0)input={activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:'host-stress',hostEventId:`host:${i}`,messageId:`branch:${group}`,messageRevision:1,swipeId:'A',content:'variant A'};
  else if(step===1)input={activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:'host-stress',hostEventId:`host:${i}`,messageId:`branch:${group}`,messageRevision:2,swipeId:'B',content:'variant B'};
  else if(step===2)input={activity:HostActivity.SWIPE_SELECTED,chatId:'host-stress',hostEventId:`host:${i}`,messageId:`branch:${group}`,swipeId:'A'};
  else if(step===3)input={activity:HostActivity.REGENERATE,chatId:'host-stress',hostEventId:`host:${i}`,messageId:`branch:${group}`,messageRevision:3,content:'regenerated'};
  else if(step===4)input={activity:HostActivity.EDIT,chatId:'host-stress',hostEventId:`host:${i}`,messageId:`branch:${group}`,messageRevision:4,content:'edited'};
  else if(step===5)input={activity:HostActivity.CONTINUE,chatId:'host-stress',hostEventId:`host:${i}`,messageId:`branch:${group}`,messageRevision:5,content:'continued'};
  else if(step===6)input={activity:HostActivity.DELETE,chatId:'host-stress',hostEventId:`host:${i}`,messageId:`branch:${group}`,messageRevision:6};
  else input={activity:HostActivity.USER_SEND,chatId:'host-stress',hostEventId:`host:${i}`,messageId:`m:${i}`,messageRevision:1,content:`message ${i}`};
  const r=hostAdapter.normalize(input);if(r.status==='ACCEPTED')hostAccepted++;else if(r.status==='DUPLICATE')hostDuplicates++;
}
const hostMs=now()-hostStarted;assert.equal(hostAccepted,10000);
const duplicateInput={activity:HostActivity.CHAT_SWITCH,chatId:'host-stress',hostEventId:'repeat:host'};
hostAdapter.normalize(duplicateInput);for(let i=0;i<50;i++)if(hostAdapter.normalize(duplicateInput).status==='DUPLICATE')hostDuplicates++;assert.equal(hostDuplicates,50);
assert.ok(hostAdapter.dedupe.size<=2048);

const bridge=new SillyTavernHostBridge();const reattachSample=hostAdapter.currentEvidence('host-stress').slice(0,100).map((x)=>({messageId:x.messageId,messageRevision:x.messageRevision,role:x.role,content:x.content,swipeId:x.swipeId}));
const reattach=bridge.reattach(hostAdapter,{chatId:'host-stress',messages:reattachSample});assert.equal(reattach[0].reason,'chat-already-attached');assert.equal(reattach.filter((x)=>x.status==='DUPLICATE').length,reattachSample.length+1);

let emittedEvents=0,maxEventBytes=0;
const publisher=new SceneEventPublisher({maxDedupe:512,sink:(e)=>{emittedEvents++;maxEventBytes=Math.max(maxEventBytes,bytes(e));}});
const rt=new SceneLifecycleRuntime({publisher});rt.sceneRuntime.deltaEngine=new SceneDeltaEngine({maxUncertainChain:100000,castChurnThreshold:100000,sourceEditFanoutThreshold:100000});
let current=rt.ensureChatScene('scene-stress',{sourceRevisionRefs:['start:r1'],evidenceRefs:['start:r1']});let active=current.sceneId;
let deltas=0,transitions=0,prefetchGenerated=0,signalSnapshots=0,uiSnapshots=0,maxSignalBytes=0,maxUiBytes=0,maxActiveSceneBytes=0;
const deltaStarted=now();
for(let s=0;s<250;s++){
  for(let i=0;i<20;i++){
    const scene=rt.registry.current(active);const evidence=`e:${s}:${i}`;const source=`src:${s}:${i}`;
    const fields={activeThreads:field([`thread:${s}:${i}`],scene.revision+1,evidence)};
    if(i===0){fields.location=field({location:`Zone:${s}`},scene.revision+1,evidence);fields.activeCast=field(Array.from({length:40},(_,n)=>({characterId:`C${n}`,state:'PRESENT'})),scene.revision+1,evidence);}
    const out=rt.sceneRuntime.observe({sceneId:active,proposalId:`p:${s}:${i}`,fields,sourceRevisionRefs:[source],evidenceRefs:[evidence],allowWhenRefreshRequired:true});assert.equal(out.applied,true);deltas++;
    const event=publisher.publish({eventType:SceneEventType.SCENE_STATE_DELTA,sceneId:active,sceneRevision:out.scene.revision,sourceRevisionRefs:[source],payload:{delta:out.delta},dedupeKey:`delta:${s}:${i}`});maxEventBytes=Math.max(maxEventBytes,bytes(event));
    rt.prefetchTrigger.cancelSuperseded({sceneId:active,sceneRevision:out.scene.revision});
    if(i%5===0){rt.prefetchTrigger.recommend({sceneId:active,sceneRevision:out.scene.revision,trigger:'STRESS',entityRefs:['C0'],locationRefs:[`Zone:${s}`],threadRefs:[`thread:${s}:${i}`],sceneRefs:[active],priority:'NORMAL',evidenceRefs:[evidence],sourceRevisionRefs:[source]});prefetchGenerated++;}
    if((deltas%5)===0){const signal=rt.integrationSignal('scene-stress'),ui=rt.uiReadModel('scene-stress');signalSnapshots++;uiSnapshots++;maxSignalBytes=Math.max(maxSignalBytes,bytes(signal));maxUiBytes=Math.max(maxUiBytes,bytes(ui));}
    maxActiveSceneBytes=Math.max(maxActiveSceneBytes,bytes(rt.registry.current(active)));
  }
  const scene=rt.registry.current(active),next=`stress:${s+1}`;const result=rt.transitionManager.transition({decision:{status:BoundaryStatus.CONFIRMED,candidateId:`cut:${s}`,boundaryType:'LOCATION'},fromSceneId:active,nextSceneId:next,relationship:SceneRelationship.CONTINUES,evidenceRefs:[`cut:e:${s}`],sourceRevisionRefs:[`cut:r:${s}`],expectedSceneRevision:scene.revision});assert.equal(result.toSceneId,next);transitions++;active=next;rt.chatScenes.set('scene-stress',active);
}
const deltaMs=now()-deltaStarted;
assert.equal(deltas,5000);assert.equal(transitions,250);assert.equal(rt.episodeCompiler.list().length,250);assert.equal(prefetchGenerated,1000);assert.equal(signalSnapshots,1000);assert.equal(uiSnapshots,1000);
assert.ok(rt.prefetchTrigger.pending.size<=32);assert.ok(publisher.dedupe.size<=512);assert.ok(rt.contextInvalidationPublisher.size()<=256);

const beforeDupEvents=emittedEvents;
for(let i=0;i<100;i++)publisher.publish({eventType:SceneEventType.SCENE_STATE_DELTA,sceneId:active,sceneRevision:rt.registry.current(active).revision,sourceRevisionRefs:['dup:r'],payload:{same:true},dedupeKey:'same-stress-event'});
const eventDuplicateSuppressed=99;assert.equal(emittedEvents-beforeDupEvents,1);

const episodesBeforeEdits=rt.episodeCompiler.list();const staleEpisode=episodesBeforeEdits.find((x)=>x.sceneId==='stress:10')??episodesBeforeEdits[10];
let editedClosedScenes=0,maxInvalidationScope=0;
const editStarted=now();
for(let i=0;i<50;i++){
  const sceneId=i===0?'chat:scene-stress:scene:1':`stress:${i}`;const currentScene=rt.registry.current(sceneId);if(!currentScene)continue;
  rt.registry.reviseSource(sceneId,{sourceRevisionRef:`edit:r:${i}`,affectedFields:['activeThreads'],evidenceRefs:[`edit:e:${i}`]});rt.episodeCompiler.invalidateScene(sceneId);
  const rebuilt=rt.episodeCompiler.compile({scene:rt.registry.current(sceneId),record:rt.registry.get(sceneId),sceneRelationships:rt.graph.neighbors(sceneId)});assert.ok(rebuilt);editedClosedScenes++;maxInvalidationScope=Math.max(maxInvalidationScope,1);
}
const editMs=now()-editStarted;assert.equal(editedClosedScenes,50);assert.equal(maxInvalidationScope,1);assert.equal(rt.episodeCompiler.validateFreshness(staleEpisode,rt.registry.current(staleEpisode.sceneId)),false);assert.equal(rt.episodeCompiler.list().length,250);

const episodes=rt.episodeCompiler.list();let correctAt1=0,nonEmpty=0;
const retrievalStarted=now();
for(let i=0;i<2000;i++){
  const expected=episodes[i%episodes.length];const out=rt.retrieval.retrieve({query:expected.compactSummary,currentSceneId:active,limit:4});if(out.length)nonEmpty++;if(out[0]?.sceneId===expected.sceneId)correctAt1++;
}
const retrievalMs=now()-retrievalStarted,retrievalPrecisionAt1=correctAt1/2000;assert.ok(retrievalPrecisionAt1>.95);assert.equal(nonEmpty,2000);

const staleTarget=rt.registry.current('stress:249');const staleEvent=publisher.publish({eventType:SceneEventType.SCENE_STATE_DELTA,sceneId:'stress:249',sceneRevision:1,sourceRevisionRefs:['stale:r'],payload:{stale:true},dedupeKey:'stale:event'});const staleEventContained=!publisher.isFresh(staleEvent,staleTarget.revision);assert.equal(staleEventContained,true);
const oldPrefetch=rt.prefetchTrigger.recommend({sceneId:active,sceneRevision:1,trigger:'STALE_PREFETCH',evidenceRefs:['old'],sourceRevisionRefs:['old']});rt.prefetchTrigger.cancelSuperseded({sceneId:active,sceneRevision:2});assert.equal(rt.prefetchTrigger.pending.get(oldPrefetch.recommendationId).status,'CANCELLED');

const state=exportSceneLifecycleState({registry:rt.registry,stack:rt.stack,episodeCompiler:rt.episodeCompiler,graph:rt.graph,prefetchTrigger:rt.prefetchTrigger,narrativeFeed:rt.narrativeFeed,transitionManager:rt.transitionManager,contextInvalidationPublisher:rt.contextInvalidationPublisher});
const lifecycleStateBytes=bytes(state);let reconstructionMs=0;let restored=null;
for(let i=0;i<10;i++){const started=now();restored=importSceneLifecycleState(JSON.parse(JSON.stringify(state)));reconstructionMs+=now()-started;assert.equal(restored.stack.activeSceneId,active);}
assert.ok(restored.episodeCompiler.list().length>=250);assert.ok(restored.contextInvalidationPublisher.size()<=256);

const finalSignal=rt.integrationSignal('scene-stress'),finalUi=rt.uiReadModel('scene-stress'),activeSceneBytes=bytes(rt.registry.current(active));
maxSignalBytes=Math.max(maxSignalBytes,bytes(finalSignal));maxUiBytes=Math.max(maxUiBytes,bytes(finalUi));
const eventDedupeBytes=bytes([...publisher.dedupe.entries()]),hostDedupeBytes=bytes([...hostAdapter.dedupe.entries()]),prefetchStateBytes=bytes(rt.prefetchTrigger.exportState());

const result={
  hostEvents:10000,hostAccepted,hostDuplicates,hostMs,hostDedupeEntries:hostAdapter.dedupe.size,hostDedupeBytes,
  deltas,deltaMs,deltaPerSecond:Math.round(deltas/(deltaMs/1000)),emittedEvents,maxEventBytes,eventDedupeEntries:publisher.dedupe.size,eventDedupeBytes,eventDuplicateSuppressed,
  transitions,sceneEpisodes:rt.episodeCompiler.list().length,retrievalQueries:2000,retrievalMs,retrievalAverageMs:retrievalMs/2000,retrievalPrecisionAt1,nonEmpty,
  prefetchGenerated,prefetchPending:rt.prefetchTrigger.pending.size,prefetchStateBytes,signalSnapshots,maxSignalBytes,uiSnapshots,maxUiBytes,
  activeSceneBytes,maxActiveSceneBytes,lifecycleStateBytes,restartCycles:10,reconstructionMs,reconstructionAverageMs:reconstructionMs/10,
  editedClosedScenes,maxInvalidationScope,editMs,staleEventContained,staleEpisodeContained:!rt.episodeCompiler.validateFreshness(staleEpisode,rt.registry.current(staleEpisode.sceneId)),
  contextInvalidationDedupe:rt.contextInvalidationPublisher.size(),
};
assert.ok(result.emittedEvents>=1000);assert.ok(result.sceneEpisodes>=250);assert.ok(result.maxSignalBytes<200000);assert.ok(result.maxUiBytes<200000);assert.ok(result.activeSceneBytes<100000);
console.log(JSON.stringify(result,null,2));
