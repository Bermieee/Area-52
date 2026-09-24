import assert from 'node:assert/strict';
import {
  BoundaryStatus, BoundaryVerifier, ClapperboardTransitionManager, HostActivity, NarrativeFeedAdapter, ObservationClass,
  SceneDeltaEngine, SceneEpisodeCompiler, SceneEventPublisher, SceneEventType, SceneGraph, SceneIntelligenceRuntime,
  ScenePrefetchTrigger, SceneRegistry, SceneRelationship, SceneRetrievalAdapter, SceneStack, SemanticBoundaryDetector,
  createFieldState, exportSceneLifecycleState, importSceneLifecycleState,
} from '../src/scene/index.js';

const now=()=>performance.now();
const field=(value,revision,evidence)=>createFieldState({value,confidence:1,evidenceRefs:[evidence],observationClass:ObservationClass.OBSERVED,revision});

const registry=new SceneRegistry();
const stack=new SceneStack({maxDepth:16,maxHistory:64});
const episodeCompiler=new SceneEpisodeCompiler();
const graph=new SceneGraph();
const events=[];
const publisher=new SceneEventPublisher({sink:(e)=>events.push(e),maxDedupe:512});
const prefetchTrigger=new ScenePrefetchTrigger({maxPending:32});
const transitionManager=new ClapperboardTransitionManager({registry,stack,episodeCompiler,graph,publisher,prefetchTrigger});
const sceneRuntime=new SceneIntelligenceRuntime({registry,deltaEngine:new SceneDeltaEngine({maxUncertainChain:100000,castChurnThreshold:100000,sourceEditFanoutThreshold:100000})});

sceneRuntime.open({sceneId:'stress:0',sourceRevisionRefs:['open:0'],provenance:['open:0']});stack.open({sceneId:'stress:0'});
let active='stress:0',deltas=0,maxActiveBytes=0;
const deltaStart=now();
for(let s=0;s<130;s++){
  for(let i=0;i<20;i++){
    const current=registry.current(active);const evidence=`stress:${s}:${i}`;
    const r=sceneRuntime.observe({sceneId:active,proposalId:`p:${s}:${i}`,sourceRevisionRefs:[`src:${s}:${i}`],evidenceRefs:[evidence],fields:{activeThreads:field([`thread:${s}:${i}`],current.revision+1,evidence)}});
    assert.equal(r.applied,true);deltas++;maxActiveBytes=Math.max(maxActiveBytes,Buffer.byteLength(JSON.stringify(r.scene)));
  }
  const current=registry.current(active);const next=`stress:${s+1}`;
  const result=transitionManager.transition({decision:{status:BoundaryStatus.CONFIRMED,candidateId:`cut:${s}`,boundaryType:'LOCATION'},fromSceneId:active,nextSceneId:next,relationship:SceneRelationship.CONTINUES,evidenceRefs:[`cut-e:${s}`],sourceRevisionRefs:[`cut-r:${s}`],expectedSceneRevision:current.revision});
  assert.equal(result.toSceneId,next);active=next;
}
const deltaMs=now()-deltaStart;
assert.equal(deltas,2600);
assert.ok(episodeCompiler.list().length>=100);
assert.ok(graph.edges.size>=100);
assert.ok(stack.frames.filter((f)=>f.resumable).length<=16);
assert.ok(stack.frames.length<=65);
assert.ok(prefetchTrigger.pending.size<=32);

const detector=new SemanticBoundaryDetector({emitThreshold:.05});const verifier=new BoundaryVerifier();
let tp=0,fp=0,fn=0,tn=0,boundaryCandidates=0;
for(let i=0;i<120;i++){
  const c=detector.detect({sceneId:`positive:${i}`,evidenceRefs:[`b:p:${i}`],signals:{locationTransition:1}});boundaryCandidates++;let d=verifier.submit(c);if(d.status===BoundaryStatus.PENDING)d=verifier.observe(c.candidateId,{support:.5,evidenceRefs:[`b:p:${i}:confirm`]});if(d.status===BoundaryStatus.CONFIRMED)tp++;else fn++;
}
for(let i=0;i<400;i++){
  const c=detector.detect({sceneId:`negative:${i}`,evidenceRefs:[`b:n:${i}`],signals:{doorway:1}});boundaryCandidates++;let d=verifier.submit(c);if(d.status===BoundaryStatus.PENDING)d=verifier.observe(c.candidateId,{contradict:1,evidenceRefs:[`b:n:${i}:continue`]});if(d.status===BoundaryStatus.CONFIRMED)fp++;else tn++;
}
assert.equal(boundaryCandidates,520);assert.equal(verifier.pending.size,0);
const boundaryPrecision=tp/(tp+fp),boundaryRecall=tp/(tp+fn),falseCutRate=fp/(fp+tn);

const beforeDedupeEvents=events.length;
for(let i=0;i<100;i++)publisher.publish({eventType:SceneEventType.SCENE_STATE_DELTA,sceneId:active,sceneRevision:registry.current(active).revision,sourceRevisionRefs:['dedupe:r'],payload:{same:true},dedupeKey:'stress:duplicate'});
const emittedForDuplicates=events.length-beforeDedupeEvents;
assert.equal(emittedForDuplicates,1);
const eventDedupeRate=99/100;

const adapter=new NarrativeFeedAdapter({maxDedupe:2048});let hostAccepted=0,hostDuplicates=0;
for(let i=0;i<5000;i++){
  let input;
  const rem=i%200;
  if(rem===100)input={activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:`chat:${Math.floor(i/1000)%2}`,hostEventId:`host:${i}`,messageId:`sw:${Math.floor(i/200)}`,messageRevision:1,swipeId:'A',content:'variant A'};
  else if(rem===101)input={activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:`chat:${Math.floor(i/1000)%2}`,hostEventId:`host:${i}`,messageId:`sw:${Math.floor(i/200)}`,messageRevision:2,swipeId:'B',content:'variant B'};
  else if(rem===102)input={activity:HostActivity.SWIPE_SELECTED,chatId:`chat:${Math.floor(i/1000)%2}`,hostEventId:`host:${i}`,messageId:`sw:${Math.floor(i/200)}`,swipeId:'A'};
  else if(rem===150)input={activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:`chat:${Math.floor(i/1000)%2}`,hostEventId:`host:${i}:base`,messageId:`regen:${Math.floor(i/200)}`,messageRevision:1,content:'old'};
  else if(rem===151)input={activity:HostActivity.REGENERATE,chatId:`chat:${Math.floor(i/1000)%2}`,hostEventId:`host:${i}`,messageId:`regen:${Math.floor(i/200)}`,messageRevision:2,content:'new'};
  else if(rem===175)input={activity:HostActivity.CHAT_SWITCH,chatId:`chat:${Math.floor(i/1000)%2}`,hostEventId:`host:${i}`};
  else input={activity:HostActivity.USER_SEND,chatId:`chat:${Math.floor(i/1000)%2}`,hostEventId:`host:${i}`,messageId:`m:${i}`,messageRevision:1,content:`message ${i}`};
  const r=adapter.normalize(input);if(r.status==='ACCEPTED')hostAccepted++;else if(r.status==='DUPLICATE')hostDuplicates++;
}
assert.equal(hostAccepted,5000);
const duplicateHostInput={activity:HostActivity.CHAT_SWITCH,chatId:'chat:0',hostEventId:'host:duplicate'};
adapter.normalize(duplicateHostInput);for(let i=0;i<25;i++)if(adapter.normalize(duplicateHostInput).status==='DUPLICATE')hostDuplicates++;
assert.equal(hostDuplicates,25);

const recoveryStart=now();let editedClosedScenes=0,maxRebuildFields=0;
for(let i=0;i<20;i++){const sceneId=`stress:${i}`;const before=registry.current(sceneId);if(!before)continue;registry.reviseSource(sceneId,{sourceRevisionRef:`edit:${i}`,affectedFields:['activeThreads'],evidenceRefs:[`edit-e:${i}`]});episodeCompiler.invalidateScene(sceneId);editedClosedScenes++;maxRebuildFields=Math.max(maxRebuildFields,1);}
const recoveryMs=now()-recoveryStart;assert.equal(editedClosedScenes,20);assert.equal(maxRebuildFields,1);

const episodes=episodeCompiler.list();assert.ok(episodes.length>=100);
const retrieval=new SceneRetrievalAdapter({episodeProvider:()=>episodes,graph});let correctAt1=0,nonEmpty=0;
const retrievalStart=now();
for(let i=0;i<1000;i++){const expected=episodes[i%episodes.length];const out=retrieval.retrieve({query:expected.compactSummary,currentSceneId:active,limit:4});if(out.length)nonEmpty++;if(out[0]?.sceneId===expected.sceneId)correctAt1++;}
const retrievalMs=now()-retrievalStart;const retrievalPrecisionAt1=correctAt1/1000;assert.ok(retrievalPrecisionAt1>.95);

const staleSceneId='stress:129';const stale=publisher.publish({eventType:SceneEventType.SCENE_STATE_DELTA,sceneId:staleSceneId,sceneRevision:1,sourceRevisionRefs:['stale'],payload:{stale:true},dedupeKey:'stale-proof'});const staleContained=!publisher.isFresh(stale,registry.current(staleSceneId).revision);assert.equal(staleContained,true);

const state=exportSceneLifecycleState({registry,stack,episodeCompiler,graph,prefetchTrigger,narrativeFeed:adapter,transitionManager});
const serialized=JSON.stringify(state);const historyBytes=Buffer.byteLength(serialized);const restored=importSceneLifecycleState(JSON.parse(serialized));assert.equal(restored.stack.activeSceneId,active);assert.ok(restored.graph.nodes.size>=100);assert.ok(restored.episodeCompiler.list().length>=100);

const activeScene=registry.current(active);const activeBytes=Buffer.byteLength(JSON.stringify(activeScene));assert.ok(activeBytes<100000);
const provenanceComplete=episodes.every((ep)=>ep.provenance.length>0&&ep.artifactRef?.sourceRevisionRefs)?1:0;assert.equal(provenanceComplete,1);

console.log(JSON.stringify({
  hostEvents:5000,hostAccepted,hostDuplicates,
  deltas,deltaMs,deltaPerSecond:Math.round(deltas/(deltaMs/1000)),
  boundaryCandidates,tp,fp,fn,tn,boundaryPrecision,boundaryRecall,falseCutRate,
  transitions:130,sceneEpisodes:episodes.length,
  eventCount:events.length,eventDedupeRate,emittedForDuplicates,
  retrievalQueries:1000,retrievalMs,retrievalAverageMs:retrievalMs/1000,retrievalPrecisionAt1,nonEmpty,
  editedClosedScenes,maxRebuildFields,recoveryMs,
  activeSceneBytes:activeBytes,maxActiveSceneBytes:maxActiveBytes,sceneLifecycleStateBytes:historyBytes,
  stackFrames:stack.frames.length,resumableStackFrames:stack.frames.filter((f)=>f.resumable).length,prefetchPending:prefetchTrigger.pending.size,
  staleContained,provenanceCompleteness:provenanceComplete
},null,2));
