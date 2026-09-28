import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentDeploymentBrain } from '../src/deployment/brain.js';
import { extractDevelopmentDeploymentScene } from '../src/deployment/sillytavern-live.js';
import { HostActivity, ObservationClass, SceneEventType } from '../src/scene/index.js';

const hostEvent=(activity,id,content,extra={})=>({
  activity,
  chatId:extra.chatId??'advanced-scanner',
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

test('advanced scanner production receipt recovers a missed character and object through revisioned rescan',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const initial=ingest(brain,hostEvent(HostActivity.USER_SEND,'recover-1','At North Gallery, Mara waits.'));
  const beforeRevision=initial.sceneRevision;
  const receipt=brain.runSceneOperatorAction({
    action:'RECOVER_MISSED_ENTITIES',
    chatId:initial.chatId,
    sceneId:initial.sceneId,
    expectedSceneRevision:beforeRevision,
    sourceRevisionRefs:[initial.evidence.sourceRevisionId],
    evidenceRefs:['operator:recover:1'],
    characters:['Eris'],
    objects:['brass-key'],
  });

  assert.equal(receipt.kind,'DeploymentSceneOwnerReceipt');
  assert.equal(receipt.status,'OBSERVED');
  assert.equal(receipt.operator.action,'RECOVER_MISSED_ENTITIES');
  assert.equal(receipt.changeSummary.fromRevision,beforeRevision);
  assert.equal(receipt.changeSummary.toRevision,beforeRevision+1);
  assert.deepEqual(receipt.changedFields,['activeCast','immediateObjects']);
  assert.ok(receipt.changeSummary.why.evidenceRefs.includes('operator:recover:1'));
  assert.ok(receipt.eventTypes.includes(SceneEventType.ACTIVE_CAST_CHANGED));
  assert.ok(receipt.eventTypes.includes(SceneEventType.OBJECT_TRANSITION));
  assert.ok(receipt.eventTypes.includes(SceneEventType.PREFETCH_RECOMMENDED));
  assert.ok(receipt.operatorResult.publication.sourceRevisionRefs.includes(initial.evidence.sourceRevisionId));
  assert.equal(receipt.operatorResult.publication.sourceRevisionRefs.includes('operator:recover:1'),false);
  assert.ok(receipt.operatorResult.publication.evidenceRefs.includes('operator:recover:1'));
  assert.ok(receipt.signal.activeCast.some(row=>row.characterId==='Eris'&&row.state==='PRESENT'));
  assert.ok(receipt.signal.objects.some(row=>row.objectId==='brass-key'));
  assert.equal(receipt.authorityGranted,false);
  assert.equal(receipt.settlementAuthority,false);
});

test('advanced scanner correction preserves prior location/time evidence and exposes what changed and why',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const initial=ingest(brain,hostEvent(HostActivity.USER_SEND,'correct-1','At East Room, Mara waits. Three hours later.'));
  const sourceRevisionId=initial.evidence.sourceRevisionId;

  const location=brain.runSceneOperatorAction({
    action:'CORRECT',chatId:initial.chatId,sceneId:initial.sceneId,
    expectedSceneRevision:initial.sceneRevision,sourceRevisionRefs:[sourceRevisionId],
    fieldName:'location',value:{location:'West Room'},evidenceRefs:['operator:location:correction'],
    observationClass:ObservationClass.OBSERVED,reason:'OPERATOR_LOCATION_CORRECTION',
  });
  assert.equal(location.status,'OBSERVED');
  assert.deepEqual(location.changedFields,['location']);
  assert.equal(location.changeSummary.changes.location.before.location,'East Room');
  assert.equal(location.changeSummary.changes.location.after.location,'West Room');
  assert.ok(location.operatorResult.reconciliation.priorFieldHistory.evidenceRefs.includes(sourceRevisionId));
  assert.equal(location.operatorResult.reconciliation.historyPreserved,true);
  assert.ok(location.eventTypes.includes(SceneEventType.LOCATION_CHANGED));
  assert.ok(location.eventTypes.includes(SceneEventType.PREFETCH_RECOMMENDED));

  const time=brain.runSceneOperatorAction({
    action:'CORRECT',chatId:initial.chatId,sceneId:initial.sceneId,
    expectedSceneRevision:location.sceneRevision,sourceRevisionRefs:[sourceRevisionId],
    fieldName:'narrativeTime',value:{anchor:'dawn',mode:'CONTINUOUS'},evidenceRefs:['operator:time:correction'],
    observationClass:ObservationClass.OBSERVED,reason:'OPERATOR_TIME_CORRECTION',
  });
  assert.equal(time.status,'OBSERVED');
  assert.deepEqual(time.changedFields,['narrativeTime']);
  assert.match(String(time.changeSummary.changes.narrativeTime.before.anchor),/3 hours later/i);
  assert.equal(time.changeSummary.changes.narrativeTime.after.anchor,'dawn');
  assert.ok(time.eventTypes.includes(SceneEventType.TIME_SHIFT_DETECTED));

  const current=brain.scene.registry.current(initial.sceneId);
  assert.equal(current.fields.location.value.location,'West Room');
  assert.equal(current.fields.narrativeTime.value.anchor,'dawn');
  assert.equal(current.fields.location.metadata.correctionHistory.at(-1).value.location,'East Room');
  assert.match(String(current.fields.narrativeTime.metadata.correctionHistory.at(-1).value.anchor),/3 hours later/i);
});

test('advanced scanner carries unresolved threads and relationship state into a new Scene and nominates prefetch',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const first=ingest(brain,hostEvent(HostActivity.USER_SEND,'carry-1','At Ember Tavern, Mara waits.'));
  const seeded=brain.runSceneOperatorAction({
    action:'RESCAN',chatId:first.chatId,sceneId:first.sceneId,
    expectedSceneRevision:first.sceneRevision,sourceRevisionRefs:[first.evidence.sourceRevisionId],
    evidenceRefs:['operator:continuity:1'],
    fields:{
      activeThreads:['find the Sun Blade'],
      activeRelationships:[{relationshipId:'mara-eris-allies',from:'Mara',to:'Eris',kind:'ALLY'}],
    },
    reason:'CONTINUITY_RECOVERY',
  });
  assert.equal(seeded.status,'OBSERVED');

  const travel=ingest(brain,hostEvent(HostActivity.USER_SEND,'carry-2','We arrive at Moonlit Vault.',{chatId:first.chatId}));
  assert.notEqual(travel.sceneId,first.sceneId);
  const destinationBefore=travel.sceneRevision;
  const carried=brain.runSceneOperatorAction({
    action:'CARRYOVER',chatId:first.chatId,
    fromSceneId:first.sceneId,toSceneId:travel.sceneId,
    expectedSceneRevision:destinationBefore,
    sourceRevisionRefs:[travel.evidence.sourceRevisionId],
    evidenceRefs:['operator:carryover:1'],
  });

  assert.equal(carried.status,'OBSERVED');
  assert.ok(carried.changedFields.includes('activeThreads'));
  assert.ok(carried.changedFields.includes('activeRelationships'));
  assert.ok(carried.signal.activeThreads.some(row=>(typeof row==='string'?row:row.threadId)==='find the Sun Blade'));
  assert.ok(brain.scene.registry.current(travel.sceneId).fields.activeRelationships.value.some(row=>row.relationshipId==='mara-eris-allies'));
  assert.ok(carried.eventTypes.includes(SceneEventType.RELATIONSHIP_SIGNAL));
  assert.ok(carried.eventTypes.includes(SceneEventType.PREFETCH_RECOMMENDED));
  assert.equal(brain.scene.registry.current(travel.sceneId).fields.activeThreads.observationClass,ObservationClass.INFERRED);
  assert.equal(carried.settlementAuthority,false);
});

test('merge/split remains an explicit revision-fenced owner review and never auto-rewrites Scenes',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const first=ingest(brain,hostEvent(HostActivity.USER_SEND,'review-1','At Hall, Mara waits.'));
  const second=ingest(brain,hostEvent(HostActivity.USER_SEND,'review-2','We arrive at Courtyard.',{chatId:first.chatId}));
  assert.notEqual(second.sceneId,first.sceneId);

  const firstRevision=brain.scene.registry.current(first.sceneId).revision;
  const secondRevision=brain.scene.registry.current(second.sceneId).revision;
  const proposed=brain.runSceneOperatorAction({
    action:'MERGE_SPLIT_PROPOSE',chatId:first.chatId,
    sceneIds:[first.sceneId,second.sceneId],mode:'MERGE',evidenceRefs:['operator:merge-review'],
  });
  assert.equal(proposed.status,'NO_WORK');
  assert.equal(proposed.operatorResult.reviewRequired,true);
  assert.equal(proposed.operatorResult.automaticSimilarityDecision,false);
  assert.equal(proposed.operatorResult.mutationApplied,false);

  const reviewed=brain.runSceneOperatorAction({
    action:'MERGE_SPLIT_REVIEW',chatId:first.chatId,
    proposalId:proposed.operatorResult.proposalId,decision:'APPROVE',evidenceRefs:['operator:merge-approve'],
  });
  assert.equal(reviewed.operatorResult.ownerDecision,'APPROVE');
  assert.equal(reviewed.operatorResult.requiresExplicitApply,true);
  assert.equal(reviewed.operatorResult.mutationApplied,false);
  assert.equal(reviewed.operatorResult.automaticSimilarityDecision,false);
  assert.equal(brain.scene.registry.current(first.sceneId).revision,firstRevision);
  assert.equal(brain.scene.registry.current(second.sceneId).revision,secondRevision);
});

test('episode repair is revision-fenced, preserves prior derived refs, and publishes a Scene owner event',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const first=ingest(brain,hostEvent(HostActivity.USER_SEND,'episode-1','At Hall, Mara waits.'));
  ingest(brain,hostEvent(HostActivity.USER_SEND,'episode-2','We arrive at Courtyard.',{chatId:first.chatId}));
  const closed=brain.scene.registry.current(first.sceneId);
  const prior=brain.scene.episodeCompiler.list().filter(row=>row.sceneId===first.sceneId);
  assert.ok(prior.length>=1);

  const repaired=brain.runSceneOperatorAction({
    action:'EPISODE_REPAIR',chatId:first.chatId,sceneId:first.sceneId,
    expectedSceneRevision:closed.revision,sourceRevisionRefs:[first.evidence.sourceRevisionId],
    evidenceRefs:['operator:episode-repair'],events:[{eventId:'repair:event'}],
  });
  assert.equal(repaired.status,'OBSERVED');
  assert.equal(repaired.operator.operationStatus,'REPAIRED');
  assert.equal(repaired.operatorResult.status,'REPAIRED');
  assert.ok(repaired.operatorResult.replacesEpisodeRefs.length>=1);
  assert.ok(repaired.eventTypes.includes(SceneEventType.SCENE_EPISODE_READY));
  assert.equal(repaired.operatorResult.rawNarrativeDeleted,false);
  assert.equal(repaired.settlementAuthority,false);
});

test('source edit invalidates dependent observations and stale rescan cannot present the old source as current',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const original=ingest(brain,hostEvent(HostActivity.USER_SEND,'edit-1','At East Room, Mara waits.',{
    messageId:'edited-message',messageRevision:1,
  }));
  const oldSource=original.evidence.sourceRevisionId;
  const edit=ingest(brain,hostEvent(HostActivity.EDIT,'edit-2','At West Room, Mara waits.',{
    chatId:original.chatId,messageId:'edited-message',messageRevision:2,
  }));
  assert.ok(edit.invalidatedSourceRevisionRefs.includes(oldSource));
  assert.equal(edit.signal.location.location,'West Room');

  const before=brain.scene.registry.current(edit.sceneId);
  const stale=brain.runSceneOperatorAction({
    action:'RESCAN',chatId:edit.chatId,sceneId:edit.sceneId,
    expectedSceneRevision:before.revision,sourceRevisionRefs:[oldSource],
    evidenceRefs:['operator:stale-rescan'],
    fields:{location:{location:'East Room'}},
  });
  assert.equal(stale.status,'STALE');
  assert.equal(stale.operator.operationStatus,'STALE');
  assert.equal(stale.operatorResult.reason,'SOURCE_REVISION_STALE');
  assert.deepEqual(stale.changedFields,[]);
  assert.equal(stale.eventIds.length,0);
  assert.equal(brain.scene.registry.current(edit.sceneId).revision,before.revision);
  assert.equal(brain.scene.registry.current(edit.sceneId).fields.location.value.location,'West Room');

  const wrongChat=brain.runSceneOperatorAction({
    action:'RESCAN',chatId:'other-chat',sceneId:edit.sceneId,
    expectedSceneRevision:before.revision,sourceRevisionRefs:[edit.evidence.sourceRevisionId],
    fields:{location:{location:'Nowhere'}},
  });
  assert.equal(wrongChat.status,'UNAVAILABLE');
  assert.equal(brain.scene.registry.current(edit.sceneId).fields.location.value.location,'West Room');
});


test('regeneration invalidates prior source evidence and a chat switch fences stale operator work',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const original=ingest(brain,hostEvent(HostActivity.USER_SEND,'regen-1','At East Room, Mara waits.',{
    chatId:'regen-chat',messageId:'regen-message',messageRevision:1,
  }));
  const regenerated=ingest(brain,hostEvent(HostActivity.REGENERATE,'regen-2','At North Room, Mara waits.',{
    chatId:'regen-chat',messageId:'regen-message',messageRevision:2,
  }));
  assert.ok(regenerated.invalidatedSourceRevisionRefs.includes(original.evidence.sourceRevisionId));
  assert.equal(regenerated.signal.location.location,'North Room');

  const current=brain.scene.registry.current(regenerated.sceneId);
  const stale=brain.runSceneOperatorAction({
    action:'RESCAN',chatId:'regen-chat',sceneId:regenerated.sceneId,
    expectedSceneRevision:current.revision,
    sourceRevisionRefs:[original.evidence.sourceRevisionId],
    evidenceRefs:['operator:regen-stale'],
    fields:{location:{location:'East Room'}},
  });
  assert.equal(stale.status,'STALE');
  assert.equal(stale.operatorResult.reason,'SOURCE_REVISION_STALE');
  assert.equal(brain.scene.registry.current(regenerated.sceneId).fields.location.value.location,'North Room');

  ingest(brain,hostEvent(HostActivity.CHAT_SWITCH,'switch-1','',{chatId:'other-chat'}));
  const afterSwitchRevision=brain.scene.registry.current(regenerated.sceneId).revision;
  const switched=brain.runSceneOperatorAction({
    action:'CORRECT',chatId:'regen-chat',sceneId:regenerated.sceneId,
    expectedSceneRevision:afterSwitchRevision,
    sourceRevisionRefs:[regenerated.evidence.sourceRevisionId],
    fieldName:'location',value:{location:'Stale Room'},evidenceRefs:['operator:after-switch'],
  });
  assert.equal(switched.status,'UNAVAILABLE');
  assert.equal(switched.operatorResult.reason,'CHAT_SELECTION_STALE');
  assert.equal(brain.scene.registry.current(regenerated.sceneId).revision,afterSwitchRevision);
  assert.equal(brain.scene.registry.current(regenerated.sceneId).fields.location.value.location,'North Room');
});
