import test from 'node:test';
import assert from 'node:assert/strict';
import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {extractDevelopmentDeploymentScene} from '../src/deployment/sillytavern-live.js';
import {CastPresence, HostActivity, SceneEventType, SceneRelationship} from '../src/scene/index.js';

const event=(activity,id,content,extra={})=>({
  activity,
  chatId:extra.chatId??'ft002-host',
  hostEventId:extra.hostEventId??`host:${id}:${activity}:r${extra.messageRevision??1}`,
  messageId:extra.messageId??id,
  messageRevision:extra.messageRevision??1,
  turnId:extra.turnId??`turn:${id}`,
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

test('FT002 host seam: explicit location/cast/time evidence uses Scene lifecycle and publishes bounded owner receipt',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const receipt=ingest(brain,event(HostActivity.USER_SEND,'a1','At North Gallery, Mara enters. Someone mentions Eris. Three hours later.'));
  assert.equal(receipt.kind,'DeploymentSceneOwnerReceipt');
  assert.equal(receipt.status,'OBSERVED');
  assert.equal(receipt.authorityGranted,false);
  assert.equal(receipt.canonicalMutationAuthority,false);
  assert.equal(receipt.settlementAuthority,false);
  assert.equal(receipt.contextSealAuthority,false);
  assert.deepEqual(receipt.changedFields,['activeCast','location','narrativeTime']);
  assert.ok(receipt.eventTypes.includes(SceneEventType.LOCATION_CHANGED));
  assert.ok(receipt.eventTypes.includes(SceneEventType.ACTIVE_CAST_CHANGED));
  assert.ok(receipt.eventTypes.includes(SceneEventType.TIME_SHIFT_DETECTED));
  assert.ok(receipt.eventTypes.includes(SceneEventType.PREFETCH_RECOMMENDED));
  assert.equal(receipt.signal.location.location,'North Gallery');
  assert.equal(receipt.signal.narrativeTime.anchor,'3 hours later');
  assert.equal(receipt.signal.castObservations.find(row=>row.characterId==='Mara').state,CastPresence.PRESENT);
  assert.equal(receipt.signal.castObservations.find(row=>row.characterId==='Eris').state,CastPresence.MENTIONED_ONLY);
  assert.deepEqual(receipt.signal.activeCast.map(row=>row.characterId),['Mara']);
  assert.ok(receipt.sourceRevisionRefs.includes(receipt.evidence.sourceRevisionId));
});

test('FT002 host seam: doorway is honest no-cut while explicit travel creates a transition',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const first=ingest(brain,event(HostActivity.USER_SEND,'b1','At North Gallery, Mara waits.'));
  const sceneId=first.sceneId;
  const doorway=ingest(brain,event(HostActivity.USER_SEND,'b2','Mara pauses in the doorway.'));
  assert.equal(doorway.sceneId,sceneId);
  assert.equal(doorway.transition,null);
  assert.equal(doorway.boundary?.decision?.status??doorway.boundary?.status??'NO_WORK','NO_WORK');
  assert.equal(doorway.noWorkReason,'BOUNDARY_NOT_CONFIRMED');
  const travel=ingest(brain,event(HostActivity.USER_SEND,'b3','We arrive at South Courtyard.'));
  assert.notEqual(travel.sceneId,sceneId);
  assert.equal(travel.transition?.status,'COMPLETE');
  assert.ok(travel.eventTypes.includes(SceneEventType.SCENE_CLOSED));
  assert.ok(travel.eventTypes.includes(SceneEventType.SCENE_OPENED));
  assert.equal(travel.signal.location.location,'South Courtyard');
});

test('FT002 host seam: flashback and resume preserve Scene identity semantics without canonical authority',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const present=ingest(brain,event(HostActivity.USER_SEND,'c1','At Present Hall, Mara waits.'));
  const presentId=present.sceneId;
  const flashback=ingest(brain,event(HostActivity.USER_SEND,'c2','Years earlier, at Old Hall, Mara waited.'));
  assert.notEqual(flashback.sceneId,presentId);
  assert.equal(flashback.signal.sceneRelationship,SceneRelationship.FLASHBACK_OF);
  const resumed=ingest(brain,event(HostActivity.USER_SEND,'c3','Back in the present, Mara resumes in Present Hall.'));
  assert.equal(resumed.sceneId,presentId);
  assert.equal(resumed.signal.sceneRelationship,SceneRelationship.RESUMES);
  assert.equal(resumed.signal.resumedSceneRef.sceneId,presentId);
  assert.equal(resumed.authorityGranted,false);
});

test('FT002 host seam: source edit invalidates only dependent Scene evidence and reports the fence',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const original=ingest(brain,event(HostActivity.USER_SEND,'d1','At East Room, Mara waits.',{messageId:'m-edit',messageRevision:1}));
  const edit=ingest(brain,event(HostActivity.EDIT,'d2','At West Room, Mara waits.',{messageId:'m-edit',messageRevision:2}));
  assert.notEqual(edit.evidence.sourceRevisionId,original.evidence.sourceRevisionId);
  assert.equal(edit.evidence.replacesRevisionId,original.evidence.sourceRevisionId);
  assert.ok(edit.invalidatedSourceRevisionRefs.includes(original.evidence.sourceRevisionId));
  assert.ok(edit.sourceRevisionRefs.includes(edit.evidence.sourceRevisionId));
  assert.equal(edit.signal.location.location,'West Room');
  assert.equal(edit.authorityGranted,false);
});
