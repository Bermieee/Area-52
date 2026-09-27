import test from 'node:test';
import assert from 'node:assert/strict';

import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {extractDevelopmentDeploymentScene} from '../src/deployment/sillytavern-live.js';
import {ObservationClass,createFieldState} from '../src/scene/contracts.js';
import {HostActivity,SceneEventType} from '../src/scene/lifecycle-contracts.js';
import {CAPABILITIES} from '../src/runtime/index.js';

const REQUIRED_EVENTS=[
  SceneEventType.SCENE_STATE_DELTA,
  SceneEventType.LOCATION_CHANGED,
  SceneEventType.TIME_SHIFT_DETECTED,
  SceneEventType.ACTIVE_CAST_CHANGED,
  SceneEventType.RELATIONSHIP_SIGNAL,
  SceneEventType.SCENE_BOUNDARY_CANDIDATE,
  SceneEventType.SCENE_CLOSED,
  SceneEventType.SCENE_OPENED,
  SceneEventType.VIBE_CHANGED,
  SceneEventType.SCENE_EPISODE_READY,
  SceneEventType.PREFETCH_RECOMMENDED,
];

function hostEvent({
  chatId='event-spine-chat',id='m1',revision=1,activity=HostActivity.USER_SEND,content='',
  turnId='turn:event-spine',generationId='gen:event-spine',role='user',
}={}){
  return{
    activity,chatId,hostEventId:`host:${chatId}:${id}:r${revision}:${activity}`,
    messageId:id,messageRevision:revision,turnId,generationId,correlationId:'corr:'+turnId,
    causationId:'host-cause:'+turnId,content,role,
  };
}

function ingestDeterministic(brain,input){
  return brain.ingestSceneHostEvent(input,{
    extract:(e,scene)=>extractDevelopmentDeploymentScene(e.content,{
      revision:scene.revision+1,evidenceRef:e.sourceRevisionId,currentScene:scene,sceneRuntime:brain.scene,
    }),
  });
}

function state(value,revision,evidenceRef,observationClass=ObservationClass.OBSERVED,confidence=1){
  return createFieldState({
    value,revision,evidenceRefs:[evidenceRef],observationClass,confidence,provenance:[evidenceRef],
  });
}

function ownerExecutor(){
  return{
    execute:async()=>({value:'SCENE_EVENT_OWNER_HANDLED'}),
    validate:()=>true,
    commit:({output}={})=>({value:output?.value??'SCENE_EVENT_OWNER_HANDLED',authorityGranted:false,canonicalMutation:false}),
  };
}

test('#113 registers every Scene event contract on the actual Runtime Event Spine registry',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  for(const eventType of REQUIRED_EVENTS){
    const descriptor=brain.runtimeDirector.eventTypes.resolve(eventType,'1.0');
    assert.ok(descriptor,`missing Runtime descriptor for ${eventType}`);
    assert.equal(descriptor.producer,'SCENE_INTELLIGENCE');
    assert.equal(descriptor.schemaVersion,'1.0');
  }
});

test('#113 production Scene publication reaches Event Spine and preserves the retained Core timeline',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const receipt=ingestDeterministic(brain,hostEvent({
    id:'loc',content:'At North Gallery, Mara enters.',
    turnId:'turn:identity',generationId:'gen:identity',
  }));

  const locationSpine=brain.runtimeDirector.events.events.find(row=>row.eventType===SceneEventType.LOCATION_CHANGED);
  assert.ok(locationSpine);
  assert.equal(locationSpine.producer,'SCENE_INTELLIGENCE');
  assert.equal(locationSpine.chatId,'event-spine-chat');
  assert.equal(locationSpine.turnId,'turn:identity');
  assert.equal(locationSpine.generationId,'gen:identity');
  assert.equal(locationSpine.correlationId,'corr:turn:identity');
  assert.equal(locationSpine.causationId,'host-cause:turn:identity');
  assert.equal(locationSpine.sceneId,receipt.sceneId);
  assert.equal(locationSpine.sceneRevision,receipt.sceneRevision);
  assert.ok(Object.isFrozen(locationSpine));
  assert.ok(Object.isFrozen(locationSpine.payload));
  assert.ok(Object.keys(locationSpine.sourceRevisions??{}).length>0);
  assert.deepEqual(locationSpine.sourceRevisionSet,receipt.eventSpineReceipts.find(row=>row.eventId===locationSpine.eventId)?.sourceRevisionRefs);
  assert.ok(locationSpine.dedupeKey);

  assert.ok(receipt.dispatchTimeline.some(row=>row.type==='EVENT'&&row.value?.eventType===SceneEventType.LOCATION_CHANGED));
  assert.ok(receipt.coreReceipts.some(row=>row.eventType===SceneEventType.LOCATION_CHANGED));
  assert.ok(receipt.eventSpineReceipts.some(row=>row.eventType===SceneEventType.LOCATION_CHANGED&&row.status==='ACCEPTED'));
  assert.equal(receipt.evidence.generationId,'gen:identity');
  const diagnostics=brain.diagnostics();
  assert.ok(diagnostics.sceneEvents.publishedAccepted>=1);
  assert.equal(diagnostics.sceneEvents.publishedRejected,0);
  assert.equal(diagnostics.sceneEvents.authorityGranted,false);
  assert.equal(diagnostics.sceneEvents.canonicalMutationAuthority,false);
});

test('#113 all card events publish through the real production Event Spine',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});

  ingestDeterministic(brain,hostEvent({
    id:'start',content:'At North Gallery, Mara enters.',
    turnId:'turn:start',generationId:'gen:start',
  }));

  brain.ingestSceneHostEvent(hostEvent({
    id:'state',content:'Two hours later, Mara and Eris reassess the plan.',
    turnId:'turn:state',generationId:'gen:state',
  }),{
    extract:(e,scene)=>({
      fields:{
        narrativeTime:state({anchor:'2 hours later',mode:'CONTINUOUS'},scene.revision+1,e.sourceRevisionId),
        activeRelationships:state([{from:'Mara',to:'Eris',relationship:'TRUST'}],scene.revision+1,e.sourceRevisionId),
        atmosphere:state({tension:0.7,urgency:0.5},scene.revision+1,e.sourceRevisionId,ObservationClass.INFERRED,0.7),
      },
    }),
  });

  ingestDeterministic(brain,hostEvent({
    id:'move',content:'We arrive at South Courtyard.',
    turnId:'turn:move',generationId:'gen:move',
  }));

  const seen=new Set(brain.runtimeDirector.events.events.map(row=>row.eventType));
  for(const eventType of REQUIRED_EVENTS)assert.equal(seen.has(eventType),true,`Event Spine did not receive ${eventType}`);

  const accepted=brain.readSceneEventSpineReceipts({limit:256}).filter(row=>REQUIRED_EVENTS.includes(row.eventType));
  for(const eventType of REQUIRED_EVENTS)assert.ok(accepted.some(row=>row.eventType===eventType&&row.status==='ACCEPTED'),`no accepted #113 receipt for ${eventType}`);
});

test('#113 owner-declared Scene obligation executes once and duplicate event does not reschedule it',async()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  brain.bindSceneEventObligationOwner({
    producer:{
      producerId:'TEST_SCENE_OWNER',obligationType:'SCENE_EVENT_REACTION',requestedLayer:'L2',
      requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],
    },
    eventTypes:[SceneEventType.LOCATION_CHANGED],
    mapEvent:(event)=>({
      payload:{sceneEventId:event.eventId},
      units:[{id:'unit:'+event.eventId,payload:null}],
    }),
    executorFactory:()=>ownerExecutor(),
  });

  const receipt=ingestDeterministic(brain,hostEvent({
    id:'owner-loc',content:'At North Gallery, Mara waits.',
    turnId:'turn:owner',generationId:'gen:owner',
  }));
  const location=receipt.dispatchTimeline.find(row=>row.type==='EVENT'&&row.value?.eventType===SceneEventType.LOCATION_CHANGED)?.value;
  assert.ok(location);
  const admittedBefore=brain.readSceneEventObligationReceipts({limit:64}).filter(row=>row.eventId===location.eventId&&row.status==='ADMITTED');
  assert.equal(admittedBefore.length,1);
  const admittedTaskId=admittedBefore[0].taskId;
  assert.ok(admittedTaskId);
  await brain.runtimeDirector.drain();
  const executed=brain.runtimeDirector.ledger.get(admittedTaskId);
  assert.equal(executed.lifecycleStatus,'SATISFIED');
  assert.equal(executed.executionStatus,'COMPLETE');
  const ledgerBefore=brain.runtimeDirector.ledger.list().filter(row=>row.obligation?.producerId==='TEST_SCENE_OWNER').length;

  brain.scene.publisher.publish({
    eventType:location.eventType,sceneId:location.sceneId,sceneRevision:location.sceneRevision,
    sourceRevisionRefs:location.sourceRevisionSet,payload:location.payload,chatId:location.chatId,turnId:location.turnId,
    generationId:location.generationId,correlationId:location.correlationId,causationId:location.causationId,
    dedupeKey:location.dedupeKey,eventId:'duplicate-should-not-publish',
  });
  const runtimeArgs=brain.scene.publisher.runtimeEmitArgs(location);
  const runtimeDuplicate=brain.runtimeDirector.events.emit(runtimeArgs.eventType,runtimeArgs.payload,runtimeArgs.meta);
  assert.equal(runtimeDuplicate.eventId,location.eventId,'Event Spine duplicate delivery returns the originally accepted event');
  assert.equal(brain.runtimeDirector.events.events.filter(row=>row.eventType===location.eventType&&row.dedupeKey===location.dedupeKey).length,1);

  const ledgerAfter=brain.runtimeDirector.ledger.list().filter(row=>row.obligation?.producerId==='TEST_SCENE_OWNER').length;
  assert.equal(ledgerAfter,ledgerBefore);
  assert.equal(brain.readSceneEventObligationReceipts({limit:64}).filter(row=>row.eventId===location.eventId&&row.status==='ADMITTED').length,1);
});

test('#113 owner obligation guard rejects foreign-chat, stale revision/source, and post-seal events',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  brain.bindSceneEventObligationOwner({
    producer:{
      producerId:'GUARDED_SCENE_OWNER',obligationType:'SCENE_EVENT_REACTION',requestedLayer:'L2',
      requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],
    },
    eventTypes:[SceneEventType.LOCATION_CHANGED],
    mapEvent:(event)=>({payload:{sceneEventId:event.eventId},units:[{id:'unit:'+event.eventId,payload:null}]}),
    executorFactory:()=>ownerExecutor(),
  });

  const a=ingestDeterministic(brain,hostEvent({
    chatId:'chat:a',id:'a1',content:'At North Gallery, Mara waits.',
    turnId:'turn:a',generationId:'gen:a',
  }));
  const aSource=a.evidence.sourceRevisionId;
  const aScene=brain.scene.registry.current(a.sceneId);

  brain.ingestSceneHostEvent(hostEvent({
    chatId:'chat:b',id:'switch',activity:HostActivity.CHAT_SWITCH,content:'',
    turnId:'turn:switch',generationId:'gen:switch',
  }),{extract:()=>({fields:{}})});
  const b=ingestDeterministic(brain,hostEvent({
    chatId:'chat:b',id:'b1',content:'At East Hall, Eris waits.',
    turnId:'turn:b',generationId:'gen:b',
  }));
  const bSource=b.evidence.sourceRevisionId;
  const bScene=brain.scene.registry.current(b.sceneId);

  const before=brain.runtimeDirector.ledger.list().filter(row=>row.obligation?.producerId==='GUARDED_SCENE_OWNER').length;

  brain.scene.publisher.publish({
    eventType:SceneEventType.LOCATION_CHANGED,sceneId:aScene.sceneId,sceneRevision:aScene.revision,
    sourceRevisionRefs:[aSource],payload:{field:'location',change:{}},chatId:'chat:a',
    turnId:'turn:foreign',generationId:'gen:foreign',correlationId:'corr:turn:foreign',
    dedupeKey:'foreign-chat-event',
  });

  brain.scene.publisher.publish({
    eventType:SceneEventType.LOCATION_CHANGED,sceneId:bScene.sceneId,sceneRevision:Math.max(1,bScene.revision-1),
    sourceRevisionRefs:[bSource],payload:{field:'location',change:{}},chatId:'chat:b',
    turnId:'turn:stale-revision',generationId:'gen:stale-revision',correlationId:'corr:turn:stale-revision',
    dedupeKey:'stale-revision-event',
  });

  const edit=ingestDeterministic(brain,hostEvent({
    chatId:'chat:b',id:'b1',revision:2,activity:HostActivity.EDIT,content:'At Crystal Harbor, Eris waits.',
    turnId:'turn:b-edit',generationId:'gen:b-edit',
  }));
  const currentB=brain.scene.registry.current(edit.sceneId);
  brain.scene.publisher.publish({
    eventType:SceneEventType.LOCATION_CHANGED,sceneId:currentB.sceneId,sceneRevision:currentB.revision,
    sourceRevisionRefs:[bSource],payload:{field:'location',change:{}},chatId:'chat:b',
    turnId:'turn:stale-source',generationId:'gen:stale-source',correlationId:'corr:turn:stale-source',
    dedupeKey:'stale-source-event',
  });

  brain.core.publication.seal.seal({
    turnId:'turn:sealed',correlationId:'corr:turn:sealed',
    packet:{id:'packet:sealed',dependencies:[]},sourceRevisionIds:[edit.evidence.sourceRevisionId],
    worldRevision:brain.core.graph.revision,sceneRevision:currentB.revision,
  });
  brain.scene.publisher.publish({
    eventType:SceneEventType.LOCATION_CHANGED,sceneId:currentB.sceneId,sceneRevision:currentB.revision,
    sourceRevisionRefs:[edit.evidence.sourceRevisionId],payload:{field:'location',change:{}},chatId:'chat:b',
    turnId:'turn:sealed',generationId:'gen:sealed',correlationId:'corr:turn:sealed',
    dedupeKey:'post-seal-event',
  });

  const after=brain.runtimeDirector.ledger.list().filter(row=>row.obligation?.producerId==='GUARDED_SCENE_OWNER').length;
  const rejections=brain.readSceneEventObligationReceipts({limit:256}).filter(row=>row.producerId==='GUARDED_SCENE_OWNER'&&row.status==='REJECTED');
  assert.equal(after,before+1,'the real EDIT location change may admit once; injected invalid events must not add work');
  assert.ok(rejections.some(row=>row.reasonCode==='SCENE_EVENT_FOREIGN_CHAT'));
  assert.ok(rejections.some(row=>row.reasonCode==='SCENE_EVENT_STALE_SCENE_REVISION'));
  assert.ok(rejections.some(row=>row.reasonCode==='SCENE_EVENT_STALE_SOURCE'));
  assert.ok(rejections.some(row=>row.reasonCode==='SCENE_EVENT_POST_SEAL'));
  const diagnostics=brain.diagnostics();
  assert.ok(diagnostics.sceneEvents.obligationsRejected>=4);
  assert.equal(diagnostics.sceneEvents.authorityGranted,false);
});

test('#113 owner can explicitly declare no work without scheduling an obligation',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  brain.bindSceneEventObligationOwner({
    producer:{
      producerId:'QUIET_SCENE_OWNER',obligationType:'SCENE_EVENT_REACTION',requestedLayer:'L2',
      requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],
    },
    eventTypes:[SceneEventType.ACTIVE_CAST_CHANGED],
    mapEvent:()=>null,
    executorFactory:()=>ownerExecutor(),
  });
  ingestDeterministic(brain,hostEvent({
    id:'quiet-owner',content:'Mara enters.',turnId:'turn:quiet-owner',generationId:'gen:quiet-owner',
  }));
  assert.equal(brain.runtimeDirector.ledger.list().some(row=>row.obligation?.producerId==='QUIET_SCENE_OWNER'),false);
  assert.ok(brain.readSceneEventObligationReceipts({limit:64}).some(row=>row.producerId==='QUIET_SCENE_OWNER'&&row.status==='SKIPPED'&&row.reasonCode==='SCENE_EVENT_OWNER_DECLARED_NO_WORK'));
});
