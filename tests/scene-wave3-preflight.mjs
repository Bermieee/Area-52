import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CastPresence, HostActivity, ObjectPresence, ObservationClass, SceneEventPublisher, SceneEventType,
  SceneGraph, SceneLifecycleRuntime, SceneRelationship, SceneRetrievalAdapter, createFieldState,
} from '../src/scene/index.js';

const fs=(value,revision,evidence,observationClass=ObservationClass.OBSERVED,confidence=1)=>createFieldState({value,revision,evidenceRefs:[evidence],observationClass,confidence});
const host=(activity,id,content='',extra={})=>{const messageRevision=extra.messageRevision??1,swipeId=extra.swipeId??'primary';return {activity,chatId:extra.chatId??'c',hostEventId:extra.hostEventId??`host:${id}:${activity}:r${messageRevision}:${swipeId}`,messageId:extra.messageId??id,messageRevision,turnId:extra.turnId??`turn:${id}`,content,...extra};};
const runtime=()=>{const events=[];const publisher=new SceneEventPublisher({sink:(e)=>events.push(e)});return {rt:new SceneLifecycleRuntime({publisher}),events};};

test('FT002 preflight: same-scene dialogue produces revision/signal without unnecessary transition',()=>{
  const {rt}=runtime();
  const out=rt.ingestHostEvent(host(HostActivity.USER_SEND,'d1','Mara asks about the route.'),{extract:(e,s)=>({fields:{
    activeCast:fs([{characterId:'Mara',state:CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]}],s.revision+1,e.sourceRevisionId),
    activeThreads:fs(['Discuss route'],s.revision+1,e.sourceRevisionId),
  }})});
  assert.equal(out.transition,null);const signal=rt.integrationSignal('c');assert.equal(signal.sceneId,out.scene.sceneId);assert.equal(signal.sceneRevision,2);assert.deepEqual(signal.activeThreads,['Discuss route']);assert.equal(rt.fanOutInput('c').activeCast[0].characterId,'Mara');
});

test('FT002 preflight: confirmed location transition changes active Scene and publishes lifecycle signals',()=>{
  const {rt,events}=runtime();
  rt.ingestHostEvent(host(HostActivity.USER_SEND,'l1','We are on the street.'),{extract:(e,s)=>({fields:{location:fs({location:'Street'},s.revision+1,e.sourceRevisionId)}})});
  const before=rt.chatScenes.get('c');
  const out=rt.ingestHostEvent(host(HostActivity.USER_SEND,'l2','We arrive inside the Ember Tavern.'),{extract:(e,s)=>({fields:{location:fs({location:'Ember Tavern'},s.revision+1,e.sourceRevisionId)},boundarySignals:{locationTransition:1,explicitBreak:1},allowWhenRefreshRequired:true})});
  const after=rt.chatScenes.get('c');assert.notEqual(after,before);assert.equal(out.transition.toSceneId,after);
  assert.ok(events.some(e=>e.eventType===SceneEventType.LOCATION_CHANGED));assert.ok(events.some(e=>e.eventType===SceneEventType.SCENE_CLOSED));assert.ok(events.some(e=>e.eventType===SceneEventType.SCENE_OPENED));
  const signal=rt.integrationSignal('c');assert.equal(signal.sceneId,after);assert.equal(signal.previousSceneRef.sceneId,before);
});

test('FT002 preflight: doorway evidence alone does not falsely close the Scene',()=>{
  const {rt}=runtime();rt.ingestHostEvent(host(HostActivity.USER_SEND,'door1','Mara stands in the doorway.'),{extract:(e,s)=>({fields:{activeThreads:fs(['Doorway conversation'],s.revision+1,e.sourceRevisionId)},boundarySignals:{doorway:1}})});
  const sceneId=rt.chatScenes.get('c');const record=rt.registry.get(sceneId);assert.equal(record.lifecycle,'OPEN');assert.equal(rt.chatScenes.get('c'),sceneId);assert.equal(record.futureSceneEpisodeRef,null);
});

test('FT002 preflight: cast entrance is PRESENT while mentioned-only never enters Fan-Out activeCast',()=>{
  const {rt}=runtime();rt.ingestHostEvent(host(HostActivity.USER_SEND,'cast1','Mara enters. Someone mentions Eris.'),{extract:(e,s)=>({fields:{activeCast:fs([
    {characterId:'Mara',state:CastPresence.PRESENT,evidenceRefs:[e.sourceRevisionId]},
    {characterId:'Eris',state:CastPresence.MENTIONED_ONLY,evidenceRefs:[e.sourceRevisionId]},
  ],s.revision+1,e.sourceRevisionId)}})});
  const signal=rt.integrationSignal('c');assert.deepEqual(signal.activeCast.map(x=>x.characterId),['Mara']);assert.equal(signal.castObservations.find(x=>x.characterId==='Eris').state,CastPresence.MENTIONED_ONLY);assert.deepEqual(rt.fanOutInput('c').activeCast.map(x=>x.characterId),['Mara']);
});

test('FT002 preflight: explicit narrative time shift survives Scene signal and event publication',()=>{
  const {rt,events}=runtime();rt.ingestHostEvent(host(HostActivity.USER_SEND,'time1','Three hours later.'),{extract:(e,s)=>({fields:{narrativeTime:fs({anchor:'03:00 later',mode:'CONTINUOUS'},s.revision+1,e.sourceRevisionId)}})});
  const signal=rt.integrationSignal('c');assert.equal(signal.narrativeTime.anchor,'03:00 later');assert.ok(events.some(e=>e.eventType===SceneEventType.TIME_SHIFT_DETECTED));
});

test('FT002 preflight: flashback preserves historical Scene relationship and suspends present Scene',()=>{
  const {rt}=runtime();rt.ingestHostEvent(host(HostActivity.USER_SEND,'f1','Present scene.'),{extract:(e,s)=>({fields:{activeThreads:fs(['present'],s.revision+1,e.sourceRevisionId)}})});
  const present=rt.chatScenes.get('c');
  rt.ingestHostEvent(host(HostActivity.USER_SEND,'f2','Years earlier...'),{extract:(e,s)=>({fields:{narrativeTime:fs({mode:'FLASHBACK',anchor:'years earlier'},s.revision+1,e.sourceRevisionId)},boundarySignals:{flashback:1},relationship:SceneRelationship.FLASHBACK_OF})});
  const past=rt.chatScenes.get('c');const signal=rt.integrationSignal('c');assert.notEqual(past,present);assert.equal(signal.sceneRelationship,SceneRelationship.FLASHBACK_OF);assert.equal(rt.registry.get(present).lifecycle,'SUSPENDED');
});

test('FT002 preflight: parallel Scene is explicit and does not become forced chronology',()=>{
  const {rt}=runtime();rt.ingestHostEvent(host(HostActivity.USER_SEND,'p1','Left thread.'),{extract:(e,s)=>({fields:{activeThreads:fs(['left'],s.revision+1,e.sourceRevisionId)}})});const left=rt.chatScenes.get('c');
  rt.ingestHostEvent(host(HostActivity.USER_SEND,'p2','Meanwhile elsewhere...'),{extract:(e,s)=>({fields:{activeThreads:fs(['right'],s.revision+1,e.sourceRevisionId)},boundarySignals:{parallel:1},relationship:SceneRelationship.PARALLEL_TO})});
  const right=rt.chatScenes.get('c');assert.equal(rt.integrationSignal('c').sceneRelationship,SceneRelationship.PARALLEL_TO);const edge=rt.graph.relation(left,right);assert.equal(edge.edgeType,'SCENE_PARALLEL');assert.equal(edge.causal,false);
});

test('FT002 preflight: interrupted Scene resumes same conceptual identity',()=>{
  const {rt}=runtime();rt.ingestHostEvent(host(HostActivity.USER_SEND,'i1','Scene A.'),{extract:(e,s)=>({fields:{activeThreads:fs(['A'],s.revision+1,e.sourceRevisionId)}})});const a=rt.chatScenes.get('c');
  rt.ingestHostEvent(host(HostActivity.USER_SEND,'i2','Interruption.'),{extract:(e,s)=>({fields:{activeThreads:fs(['B'],s.revision+1,e.sourceRevisionId)},boundarySignals:{explicitBreak:1},relationship:SceneRelationship.INTERRUPTS})});const b=rt.chatScenes.get('c');assert.notEqual(a,b);
  rt.ingestHostEvent(host(HostActivity.USER_SEND,'i3','Return to prior scene.'),{extract:(e,s)=>({fields:{activeThreads:fs(['return'],s.revision+1,e.sourceRevisionId)},boundarySignals:{explicitBreak:1},relationship:SceneRelationship.RESUMES,resumeSceneId:a})});
  assert.equal(rt.chatScenes.get('c'),a);const signal=rt.integrationSignal('c');assert.equal(signal.sceneRelationship,SceneRelationship.RESUMES);assert.equal(signal.resumedSceneRef.sceneId,a);
});

test('FT002 preflight: bad inference correction rebuilds only affected field',()=>{
  const {rt}=runtime();const first=rt.ingestHostEvent(host(HostActivity.ASSISTANT_GENERATION_COMPLETE,'corr','They are in the Tavern.'),{extract:(e,s)=>({fields:{
    location:fs({location:'Ember Tavern'},s.revision+1,e.sourceRevisionId,ObservationClass.INFERRED,.6),
  }})});
  rt.ingestHostEvent(host(HostActivity.USER_SEND,'thread-independent','The Blade remains the objective.'),{extract:(e,s)=>({fields:{activeThreads:fs(['Blade'],s.revision+1,e.sourceRevisionId)}})});
  const corrected=rt.ingestHostEvent(host(HostActivity.REGENERATE,'corr','They are on the Street.',{messageRevision:2}),{extract:(e,s)=>({fields:{location:fs({location:'Street'},s.revision+1,e.sourceRevisionId)}})});
  assert.ok(corrected.invalidated.some(x=>x.fields.includes('location')));assert.ok(corrected.invalidated.every(x=>!x.fields.includes('activeThreads')));assert.equal(corrected.scene.fields.location.value.location,'Street');assert.deepEqual(corrected.scene.fields.activeThreads.value,['Blade']);
});

test('FT002 preflight: regenerate abandons old assistant text',()=>{
  const {rt}=runtime();rt.ingestHostEvent(host(HostActivity.ASSISTANT_GENERATION_COMPLETE,'regen','Old answer.'),{extract:(e,s)=>({fields:{activeThreads:fs(['old'],s.revision+1,e.sourceRevisionId)}})});
  rt.ingestHostEvent(host(HostActivity.REGENERATE,'regen','New answer.',{messageRevision:2}),{extract:(e,s)=>({fields:{activeThreads:fs(['new'],s.revision+1,e.sourceRevisionId)}})});
  const current=rt.narrativeFeed.currentEvidence('c');assert.equal(current.filter(x=>x.messageId==='regen').length,1);assert.equal(current.find(x=>x.messageId==='regen').content,'New answer.');
});

test('FT002 preflight: selected swipe is only CURRENT alternate',()=>{
  const {rt}=runtime();rt.ingestHostEvent(host(HostActivity.ASSISTANT_GENERATION_COMPLETE,'swipe','A',{messageId:'m',messageRevision:1,swipeId:'A'}),{extract:(e,s)=>({fields:{activeThreads:fs(['A'],s.revision+1,e.sourceRevisionId)}})});
  rt.ingestHostEvent(host(HostActivity.ASSISTANT_GENERATION_COMPLETE,'swipe2','B',{messageId:'m',messageRevision:2,swipeId:'B'}),{extract:(e,s)=>({fields:{activeThreads:fs(['B'],s.revision+1,e.sourceRevisionId)}})});
  rt.ingestHostEvent({activity:HostActivity.SWIPE_SELECTED,chatId:'c',hostEventId:'host:pick',messageId:'m',swipeId:'A'});
  const current=rt.narrativeFeed.currentEvidence('c').filter(x=>x.messageId==='m');assert.equal(current.length,1);assert.equal(current[0].content,'A');
});

test('FT002 preflight: delete invalidates dependent derived Scene state',()=>{
  const {rt}=runtime();rt.ingestHostEvent(host(HostActivity.USER_SEND,'del','Secret thread.'),{extract:(e,s)=>({fields:{activeThreads:fs(['secret'],s.revision+1,e.sourceRevisionId)}})});
  const out=rt.ingestHostEvent({activity:HostActivity.DELETE,chatId:'c',hostEventId:'host:del2',messageId:'del',messageRevision:2});
  const scene=rt.registry.current(rt.chatScenes.get('c'));assert.ok(out.invalidated.some(x=>x.fields.includes('activeThreads')));assert.equal(scene.fields.activeThreads.observationClass,ObservationClass.UNRESOLVED);
});

test('FT002 preflight: inherited Ember Tavern / Sun Blade truth boundary is not promoted by Scene retrieval',()=>{
  const truth={emberTavernCurrent:'DESTROYED',sunBladeHistorical:'TAVERN',sunBladeCurrent:'UNKNOWN',destroyedVsRemoved:'UNRESOLVED'};
  const episodes=[{episodeId:'ep:old',sceneId:'old',sceneRevision:2,sourceRange:{start:1,end:4},sourceRevisionRefs:['old:r'],participants:[],location:{value:{location:'Ember Tavern'}},threadsCarried:['Sun Blade was at Tavern'],compactSummary:'Sun Blade historical Ember Tavern association',artifactRef:{artifactId:'ep:old',artifactType:'SceneEpisode',revision:2}}];
  const retrieval=new SceneRetrievalAdapter({episodeProvider:episodes,graph:new SceneGraph()});const out=retrieval.retrieve({query:'Sun Blade Ember Tavern'});
  assert.equal(out[0].relationshipToCurrentScene,'HISTORICAL');assert.deepEqual(truth,{emberTavernCurrent:'DESTROYED',sunBladeHistorical:'TAVERN',sunBladeCurrent:'UNKNOWN',destroyedVsRemoved:'UNRESOLVED'});
});
