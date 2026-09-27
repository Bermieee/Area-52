import test from 'node:test';
import assert from 'node:assert/strict';

import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {extractDevelopmentDeploymentScene} from '../src/deployment/sillytavern-live.js';
import {
  HostActivity,ObservationClass,SceneEventType,createFieldState,scenePrefetchIntentsFromNarrative,
} from '../src/scene/index.js';
import {
  Capability,DynamicFanOutPlanner,ResultClass,createTurnEnvelope,plannerInputFromScene,
} from '../src/coprocessor/index.js';

const event=(activity,id,content,extra={})=>({
  activity,
  chatId:extra.chatId??'prefetch-chat',
  hostEventId:extra.hostEventId??`host:${id}:${activity}:r${extra.messageRevision??1}`,
  messageId:extra.messageId??id,
  messageRevision:extra.messageRevision??1,
  turnId:extra.turnId??`turn:${id}`,
  correlationId:extra.correlationId??`corr:${id}`,
  content,
  role:extra.role??'user',
  ...extra,
});

const ingest=(brain,input)=>brain.ingestSceneHostEvent(input,{
  extract:(e,scene)=>extractDevelopmentDeploymentScene(e.content,{
    revision:scene.revision+1,
    evidenceRef:e.sourceRevisionId,
    currentScene:scene,
    sceneRuntime:brain.scene,
  }),
});

const recs=(brain,chatId='prefetch-chat')=>brain.scene.integrationSignal(chatId)?.prefetchRecommendations??[];
const triggers=(brain,chatId='prefetch-chat')=>recs(brain,chatId).map(row=>row.trigger);

function turnFor(input,id='prefetch-plan',sourceRevisionSet=input.sourceRevisionSet){
  return createTurnEnvelope({
    turnId:id,eventId:'evt:'+id,correlationId:'corr:'+id,dedupeKey:'turn:'+id,
    sourceRevisionSet:[...(sourceRevisionSet??[])],
    worldRevision:1,sceneRevision:input.sceneRevision,characterStateRevision:1,createdAt:0,
  });
}

test('#112 confirmed location change publishes a high-priority speculative recommendation',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  ingest(brain,event(HostActivity.USER_SEND,'loc1','At North Gallery, Mara waits.'));
  const receipt=ingest(brain,event(HostActivity.USER_SEND,'loc2','At East Hall, Mara waits.'));
  const recommendation=recs(brain).find(row=>row.trigger==='LOCATION_CHANGED');
  assert.ok(recommendation);
  assert.equal(recommendation.priority,'HIGH');
  assert.deepEqual(recommendation.locationRefs,['East Hall']);
  assert.deepEqual(recommendation.sourceRevisionSet,[receipt.evidence.sourceRevisionId]);
  assert.equal(recommendation.authority,'NONE');
  assert.equal(recommendation.runtimeSchedulingAuthority,false);
  assert.equal(recommendation.retrievalAuthority,false);
  assert.equal(recommendation.truthAuthority,false);
  assert.equal(recommendation.contextSealAuthority,false);
});

test('#112 cast change publishes speculative character-context intent',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const receipt=ingest(brain,event(HostActivity.USER_SEND,'cast1','Mara enters.'));
  const recommendation=recs(brain).find(row=>row.trigger==='ACTIVE_CAST_CHANGED');
  assert.ok(recommendation);
  assert.deepEqual(recommendation.entityRefs,['Mara']);
  assert.deepEqual(recommendation.sourceRevisionSet,[receipt.evidence.sourceRevisionId]);
});

test('#112 thread activation publishes only newly activated threads',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const receipt=brain.ingestSceneHostEvent(event(HostActivity.USER_SEND,'thread1','The sealed-gate problem becomes active.'),{
    extract:(e,scene)=>({
      fields:{
        activeThreads:createFieldState({
          value:['thread:sealed-gate'],revision:scene.revision+1,
          evidenceRefs:[e.sourceRevisionId],observationClass:ObservationClass.OBSERVED,
          confidence:1,provenance:[e.sourceRevisionId],
        }),
      },
    }),
  });
  const recommendation=recs(brain).find(row=>row.trigger==='THREAD_ACTIVATED');
  assert.ok(recommendation);
  assert.deepEqual(recommendation.threadRefs,['thread:sealed-gate']);
  assert.deepEqual(recommendation.sourceRevisionSet,[receipt.evidence.sourceRevisionId]);
});

test('#112 explicit travel destination is intent-only and does not mutate current location',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const initial=ingest(brain,event(HostActivity.USER_SEND,'travel0','At North Gallery, Mara waits.'));
  const beforeRevision=initial.sceneRevision;
  const beforeLocation=initial.signal.location.location;
  const receipt=ingest(brain,event(HostActivity.USER_SEND,'travel1','We should head to Sunken Archive next.'));
  const recommendation=recs(brain).find(row=>row.trigger==='LIKELY_NEXT:EXPLICIT_TRAVEL_DESTINATION');
  assert.ok(recommendation);
  assert.deepEqual(recommendation.locationRefs,['Sunken Archive']);
  assert.equal(recommendation.priority,'HIGH');
  assert.equal(receipt.sceneRevision,beforeRevision,'likely-next intent must not revise CurrentScene by itself');
  assert.equal(receipt.signal.location.location,beforeLocation);
  assert.equal(receipt.status,'NO_WORK');
  assert.equal(receipt.eventTypes.includes(SceneEventType.PREFETCH_RECOMMENDED),true);
  assert.deepEqual(scenePrefetchIntentsFromNarrative('We should head to Sunken Archive next.')[0].locationRefs,['Sunken Archive']);
});

test('#112 confirmed strong boundary transition publishes destination warming on the new Scene',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const initial=ingest(brain,event(HostActivity.USER_SEND,'boundary0','At North Gallery, Mara waits.'));
  const receipt=ingest(brain,event(HostActivity.USER_SEND,'boundary1','We arrive at South Courtyard.'));
  assert.notEqual(receipt.sceneId,initial.sceneId);
  assert.equal(receipt.transition?.status,'COMPLETE');
  const recommendation=recs(brain).find(row=>row.trigger.startsWith('STRONG_BOUNDARY_TRANSITION:'));
  assert.ok(recommendation);
  assert.equal(recommendation.priority,'HIGH');
  assert.deepEqual(recommendation.locationRefs,['South Courtyard']);
  assert.equal(recommendation.sceneId,receipt.sceneId);
  assert.equal(recommendation.sceneRevision,receipt.sceneRevision);
});

test('#112 duplicate recommendation publication coalesces by semantic identity',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const scene=brain.scene.ensureChatScene('dedupe-chat',{sourceRevisionRefs:['src:dedupe'],evidenceRefs:['src:dedupe']});
  const input={
    sceneId:scene.sceneId,sceneRevision:scene.revision,trigger:'LIKELY_NEXT:EXPLICIT_TRAVEL_DESTINATION',
    locationRefs:['Sunken Archive'],priority:'HIGH',evidenceRefs:['src:dedupe'],sourceRevisionRefs:['src:dedupe'],
  };
  const a=brain.scene.prefetchTrigger.recommend(input);
  const b=brain.scene.prefetchTrigger.recommend(input);
  assert.equal(a.recommendationId,b.recommendationId);
  assert.equal(brain.scene.prefetchTrigger.active({sceneId:scene.sceneId,sceneRevision:scene.revision}).length,1);
});

test('#112 source correction cancels the old recommendation and publishes a replacement-fenced intent',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  ingest(brain,event(HostActivity.USER_SEND,'edit0','At North Gallery, Mara waits.'));
  const first=ingest(brain,event(HostActivity.USER_SEND,'edit1','We should head to Sunken Archive next.',{messageId:'travel-edit',messageRevision:1}));
  const old=recs(brain).find(row=>row.trigger==='LIKELY_NEXT:EXPLICIT_TRAVEL_DESTINATION');
  assert.ok(old);
  const edited=ingest(brain,event(HostActivity.EDIT,'edit2','We should head to Crystal Harbor next.',{messageId:'travel-edit',messageRevision:2}));
  assert.ok(edited.invalidatedSourceRevisionRefs.includes(first.evidence.sourceRevisionId));
  const state=brain.scene.prefetchTrigger.exportState().pending;
  assert.equal(state.find(row=>row.recommendationId===old.recommendationId)?.status,'CANCELLED');
  const replacement=recs(brain).find(row=>row.trigger==='LIKELY_NEXT:EXPLICIT_TRAVEL_DESTINATION');
  assert.deepEqual(replacement.locationRefs,['Crystal Harbor']);
  assert.deepEqual(replacement.sourceRevisionSet,[edited.evidence.sourceRevisionId]);
});

test('#112 chat change cancels warming intent from the previously selected Scene',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  ingest(brain,event(HostActivity.USER_SEND,'chat0','At North Gallery, Mara waits.',{chatId:'chat:a'}));
  ingest(brain,event(HostActivity.USER_SEND,'chat1','We should head to Sunken Archive next.',{chatId:'chat:a'}));
  const old=recs(brain,'chat:a').find(row=>row.trigger==='LIKELY_NEXT:EXPLICIT_TRAVEL_DESTINATION');
  assert.ok(old);
  brain.ingestSceneHostEvent(event(HostActivity.CHAT_SWITCH,'chat-switch','',{chatId:'chat:b'}),{extract:()=>({fields:{}})});
  const row=brain.scene.prefetchTrigger.exportState().pending.find(item=>item.recommendationId===old.recommendationId);
  assert.equal(row.status,'CANCELLED');
  assert.ok(row.invalidators.some(value=>String(value).startsWith('CHAT_CHANGE:')));
});

test('#112 quiet continuation publishes no new prefetch work',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  ingest(brain,event(HostActivity.USER_SEND,'quiet0','At North Gallery, Mara waits.'));
  const receipt=ingest(brain,event(HostActivity.USER_SEND,'quiet1','Mara waits quietly.'));
  assert.equal(receipt.status,'NO_WORK');
  assert.equal(receipt.eventTypes.includes(SceneEventType.PREFETCH_RECOMMENDED),false);
});

test('#112 production contract route reaches Dynamic Fan-Out consideration without Scene execution authority',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  ingest(brain,event(HostActivity.USER_SEND,'route0','At North Gallery, Mara waits.'));
  ingest(brain,event(HostActivity.USER_SEND,'route1','We should head to Sunken Archive next.'));

  const sceneInput=brain.scene.fanOutInput('prefetch-chat');
  const plannerInput=plannerInputFromScene({publicSignals:sceneInput});
  assert.equal(plannerInput.prefetchRecommendations.length,1);
  assert.deepEqual(plannerInput.prefetchRecommendations[0].locationRefs,['Sunken Archive']);
  assert.deepEqual(plannerInput.prefetchRecommendations[0].sourceRevisionSet,sceneInput.sourceRevisionSet.filter(ref=>plannerInput.prefetchRecommendations[0].sourceRevisionSet.includes(ref)));

  const turn=turnFor(sceneInput,'prefetch-route');
  const planner=new DynamicFanOutPlanner();
  const accepted=planner.plan({turnEvent:turn,...plannerInput,text:'Okay.'});
  assert.equal(accepted.inputSignals.freshPrefetchRecommendationCount,1);
  const historian=accepted.nominations.find(row=>row.roleId==='historian');
  assert.ok(historian);
  assert.equal(historian.resultClass,ResultClass.OPPORTUNISTIC);
  assert.ok(historian.reasonCodes.includes('SCENE_PREFETCH_RECOMMENDATION'));
  assert.equal(historian.canonicalAuthority,false);

  const denied=planner.plan({
    turnEvent:turn,...plannerInput,text:'Okay.',
    availableCapabilities:[Capability.GRAPH],
  });
  assert.equal(denied.inputSignals.freshPrefetchRecommendationCount,1);
  assert.equal(denied.tasks.some(task=>task.metadata.roleId==='historian'),false,'Dynamic Fan-Out retains execution choice');

  const staleTurn=turnFor(sceneInput,'prefetch-stale',['src:not-current']);
  const stale=planner.plan({turnEvent:staleTurn,...plannerInput,text:'Okay.'});
  assert.equal(stale.inputSignals.freshPrefetchRecommendationCount,0);
  assert.equal(stale.tasks.length,0);
});
