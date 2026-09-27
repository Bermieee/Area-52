import test from 'node:test';
import assert from 'node:assert/strict';

import {Area52NativeBrain} from '../src/native-brain.js';
import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {
  createDevelopmentDeploymentSillyTavernSession,
  extractDevelopmentDeploymentScene,
} from '../src/deployment/sillytavern-live.js';
import {HostActivity} from '../src/scene/lifecycle-contracts.js';

const USER_PROSE="City lights were pinpricks beneath the glass dome. Mira rested her shoulder against Ren's, turning the brass key between their joined hands while both watched for the courier.";
const ASSISTANT_PROSE='A red flare blossomed beyond the glass; the courier was finally approaching, and Mira slipped the brass key into her coat.';

function makeHost(){
  const listeners=new Map();
  const context={
    chatId:'chat:scene-cognition',
    chat:[],
    eventTypes:{
      GENERATION_AFTER_COMMANDS:'generation_after_commands',
      CHAT_COMPLETION_PROMPT_READY:'chat_completion_prompt_ready',
      MESSAGE_SENT:'message_sent',
      MESSAGE_RECEIVED:'message_received',
      MESSAGE_EDITED:'message_edited',
      MESSAGE_DELETED:'message_deleted',
      MESSAGE_UPDATED:'message_updated',
      MESSAGE_SWIPED:'message_swiped',
      MESSAGE_SWIPE_DELETED:'message_swipe_deleted',
      CHAT_CHANGED:'chat_id_changed',
      CHAT_LOADED:'chatLoaded',
      CHAT_CREATED:'chat_created',
      CHAT_RENAMED:'chat_renamed',
      WORLDINFO_UPDATED:'worldinfo_updated',
      WORLDINFO_SETTINGS_UPDATED:'worldinfo_settings_updated',
      GENERATION_STARTED:'generation_started',
      GENERATION_ENDED:'generation_ended',
      GENERATION_STOPPED:'generation_stopped',
    },
    eventSource:{
      on(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
      removeListener(type,fn){listeners.get(type)?.delete(fn);},
    },
    async setExtensionPrompt(){},
  };
  return{sillyTavern:{getContext:()=>context},context,listeners};
}

function pushUser(context,mes,id='user-1'){
  context.chat.push({is_user:true,mes,mesId:id,send_date:Date.now()});
  return context.chat.length-1;
}
function pushAssistant(context,mes,id='assistant-1'){
  context.chat.push({is_user:false,mes,mesId:id,send_date:Date.now()});
  return context.chat.length-1;
}

function scenePayload({phase='FOREGROUND_USER'}={}){
  if(phase==='POST_RESPONSE')return{
    fields:{
      activeThreads:{value:['courier-arrived'],confidence:.96,observationClass:'OBSERVED'},
      activeObjectives:{value:['receive-courier-message'],confidence:.92,observationClass:'INFERRED'},
      immediateObjects:{value:[{objectId:'brass-key',state:'STOWED'}],confidence:.94,observationClass:'OBSERVED'},
    },
    boundarySignals:{objectiveResolution:{strength:.55}},
  };
  return{
    fields:{
      location:{value:{location:'Greyharbor Observatory'},confidence:.98,observationClass:'OBSERVED'},
      activeCast:{value:[
        {characterId:'Mira',state:'PRESENT'},
        {characterId:'Ren',state:'PRESENT'},
      ],confidence:.99,observationClass:'OBSERVED'},
      activeRelationships:{value:[
        {from:'Mira',kind:'ALLY',to:'Ren'},
      ],confidence:.86,observationClass:'INFERRED'},
      immediateObjects:{value:[
        {objectId:'brass-key',state:'PRESENT'},
      ],confidence:.97,observationClass:'OBSERVED'},
      activeThreads:{value:['courier-arrival'],confidence:.93,observationClass:'INFERRED'},
      activeObjectives:{value:['wait-for-courier'],confidence:.9,observationClass:'INFERRED'},
    },
    boundarySignals:{},
  };
}

async function connectSceneResource(brain,{resourceId='scene:test',handler=null}={}){
  brain.optionalResources.actions.addResource({
    resourceId,
    kind:'DETERMINISTIC_LOCAL',
    displayName:'Deterministic Scene cognition fixture',
    providerProfileId:'profile:'+resourceId,
    providerId:'provider:'+resourceId,
    modelId:'scene-semantic-fixture',
    workerId:'resource:'+resourceId,
    capabilities:['STRUCTURED_EXTRACTION'],
    maxConcurrency:1,
    handlers:{
      SCENE_OBSERVATION:handler??(({input})=>scenePayload({phase:input?.data?.phase})),
    },
  });
  await brain.optionalResources.actions.connectResource(resourceId);
  return brain.resourceConnections.readResource(resourceId);
}

function ownerSource(brain,{chatId='chat:direct',messageId='m1',messageRevision=1}={}){
  return brain.scene.narrativeFeed.sourceRevisionIdFor({chatId,messageId,messageRevision});
}

function hostEvent({
  brain,chatId='chat:direct',messageId='m1',messageRevision=1,turnId='turn:direct',
  sourceRevisionId=null,activity=HostActivity.USER_SEND,content=USER_PROSE,role='user',
}={}){
  const sourceRevisionIdResolved=sourceRevisionId??ownerSource(brain,{chatId,messageId,messageRevision});
  return{
    activity,chatId,hostEventId:`host:${chatId}:${messageId}:${messageRevision}:${activity}`,
    messageId,messageRevision,turnId,correlationId:'corr:'+turnId,
    sourceRevisionId:sourceRevisionIdResolved,content,role,
  };
}

async function createDirectWork(brain,{
  chatId='chat:direct',messageId='m1',messageRevision=1,turnId='turn:direct',generationId='gen:direct',
  phase='FOREGROUND_USER',content=USER_PROSE,
}={}){
  const sourceRevisionId=ownerSource(brain,{chatId,messageId,messageRevision});
  const work=await brain.runSceneObservationWork({
    chatId,turnId,generationId,correlationId:'corr:'+turnId,sourceRevisionId,narrative:content,
    phase,parentWorkId:'generation:'+generationId,foregroundBudgetMs:1200,
  });
  return{work,sourceRevisionId,event:hostEvent({brain,chatId,messageId,messageRevision,turnId,sourceRevisionId,activity:phase==='POST_RESPONSE'?HostActivity.ASSISTANT_GENERATION_COMPLETE:HostActivity.USER_SEND,content,role:phase==='POST_RESPONSE'?'assistant':'user'})};
}

test('installed native host semantically observes prose the generic fallback cannot parse before retrieval and seals only owner-admitted Scene state',async()=>{
  const fallback=extractDevelopmentDeploymentScene(USER_PROSE,{revision:2,evidenceRef:'source:fallback'});
  assert.equal(fallback.explicit,false);
  assert.deepEqual(fallback.fields,{});

  const {sillyTavern,context,listeners}=makeHost();
  const nativeBrain=new Area52NativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({
    sillyTavern,document:null,mountUi:false,nativeBrain,
    initialLorebook:{
      id:'scene-cognition-lore',title:'Scene cognition Lore',
      discovery:{kind:'DeploymentLiveFixture',stableId:'scene-cognition-lore',exactAuthoredSource:true},
      entries:[
        {uid:'greyharbor-observatory',content:'Greyharbor Observatory receives courier signals through a red flare above the glass dome.',metadata:{title:'Greyharbor Observatory',at:1,treePath:['Places','Observatory']}},
        {uid:'brass-key',content:'The brass key is carried by Mira during courier meetings.',metadata:{title:'Brass key',at:2,treePath:['Objects','Key']}},
      ],
    },
  });
  await connectSceneResource(session.brain);
  session.start();

  pushUser(context,USER_PROSE);
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));

  const ui=nativeBrain.uiBindings();
  const selection=ui.readSelection({chatId:context.chatId});
  assert.ok(selection?.turnId);
  assert.ok(selection?.generationId);

  const ownerSignal=session.brain.scene.integrationSignal(context.chatId);
  assert.equal(ownerSignal.location.location,'Greyharbor Observatory');
  assert.deepEqual(ownerSignal.activeCast.map(row=>row.characterId).sort(),['Mira','Ren']);
  assert.deepEqual(ownerSignal.activeThreads,['courier-arrival']);
  assert.equal(ownerSignal.objects[0].objectId,'brass-key');

  const ownerScene=session.brain.scene.registry.current(ownerSignal.sceneId);
  assert.equal(ownerScene.fields.activeRelationships.value[0].kind,'ALLY');
  assert.equal(ownerScene.fields.activeObjectives.value[0],'wait-for-courier');

  const turn=nativeBrain.readTurn(selection.turnId);
  const intentKinds=turn.retrievalPolicy.retrievalIntents.map(row=>row.metadata?.sceneIntentKind).filter(Boolean);
  for(const kind of ['DIRECT_QUERY','LOCATION_CONTEXT','ACTIVE_CAST_CONTEXT','OBJECT_PROVENANCE','ACTIVE_THREAD_CONTEXT'])assert.ok(intentKinds.includes(kind),kind);
  assert.ok(turn.published?.candidateEnvelope,'Sensory/Candidate Bus envelope must exist after admitted Scene');
  assert.ok(turn.published?.assessment,'Truth assessment must exist after admitted Scene');
  assert.ok(turn.published?.gatherReceipt,'Gather receipt must exist after admitted Scene');
  assert.ok(turn.published?.sealReceipt?.sealedState,'Context Seal must exist after admitted Scene');
  assert.ok(turn.delivery?.plan?.promptPlanId,'PromptPlan must exist after admitted Scene');
  assert.match(JSON.stringify(turn.delivery.plan.sections),/Greyharbor Observatory/);

  const channelReceipts=turn.published?.candidateEnvelope?.metadata?.channelReceipts??[];
  assert.ok(channelReceipts.reduce((n,row)=>n+Number(row.nominationCount??0),0)>0,'Scene-derived intents plus owner Lore must produce nominations');
  assert.ok(
    (turn.published?.gatherReceipt?.admittedResultIds??[]).length>0,
    'owner-backed retrieval must reach Gather admission: '+JSON.stringify({
      channelReceipts:turn.published?.candidateEnvelope?.metadata?.channelReceipts??[],
      truth:turn.published?.assessment??null,
      routes:(turn.published?.resultRoutes??[]).map(row=>({id:row?.result?.id??null,route:row?.route??null})),
      gather:turn.published?.gatherReceipt??null,
    }),
  );

  const selected=session.uiBindings().readSelectedTurnReceipt(selection);
  const semantic=selected.sceneFlow?.semanticObservation;
  assert.equal(semantic?.execution?.attempted,true);
  assert.equal(semantic?.execution?.returned,true);
  assert.equal(semantic?.execution?.chatId,selection.chatId);
  assert.equal(semantic?.execution?.turnId,selection.turnId);
  assert.equal(semantic?.execution?.generationId,selection.generationId);
  assert.ok(semantic?.execution?.workId);
  assert.ok(semantic?.execution?.parentWorkId);
  assert.equal(semantic?.ownerAdmission?.ownerAdmitted,true);
  assert.equal(semantic?.ownerAdmission?.reasonCode,'SCENE_OWNER_ADMITTED');
  const diagnosticJson=JSON.stringify(session.exportEvidence().nativeBrainIntegration.selectedTurnReceipt);
  assert.doesNotMatch(diagnosticJson,/City lights were pinpricks|joined hands|watched for the courier/i);
  assert.doesNotMatch(diagnosticJson,/hidden reasoning|api[_ -]?key/i);

  const request={chat:[{role:'system',content:'host policy'},{role:'user',content:USER_PROSE}],dryRun:false};
  await Promise.all([...listeners.get('chat_completion_prompt_ready')].map(fn=>fn(request)));
  const assistantIndex=pushAssistant(context,ASSISTANT_PROSE);
  await Promise.all([...listeners.get('message_received')].map(fn=>fn(assistantIndex)));

  const learned=ui.readGeneration({generationId:selection.generationId,...selection});
  assert.equal(learned.state,'LEARNED','Scene nearline work must not break native provider-response/learning');
  const completion=session.exportEvidence().nativeBrainIntegration.last;
  assert.equal(completion.state,'LEARNED');
  assert.equal(completion.postResponseScene?.semanticObservation?.ownerAdmitted,true);
  assert.ok(completion.postResponseScene?.sceneRevision>selection.sceneRevision);
  assert.doesNotMatch(JSON.stringify(completion),/red flare blossomed|slipped the brass key/i);

  session.destroy();
});

test('installed native host with no compatible Scene resource stays truthful and does not fabricate semantic Scene fields',async()=>{
  const {sillyTavern,context,listeners}=makeHost();
  const nativeBrain=new Area52NativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});
  session.start();
  pushUser(context,USER_PROSE);
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));

  const selection=nativeBrain.uiBindings().readSelection({chatId:context.chatId});
  const turn=nativeBrain.readTurn(selection.turnId);
  const intentKinds=turn.retrievalPolicy.retrievalIntents.map(row=>row.metadata?.sceneIntentKind).filter(Boolean);
  assert.equal(intentKinds.includes('LOCATION_CONTEXT'),false);
  assert.equal(intentKinds.includes('ACTIVE_CAST_CONTEXT'),false);
  assert.equal(intentKinds.includes('OBJECT_PROVENANCE'),false);
  assert.equal(intentKinds.includes('ACTIVE_THREAD_CONTEXT'),false);
  assert.doesNotMatch(JSON.stringify(turn.delivery.plan.sections),/Greyharbor Observatory|courier-arrival|brass-key/);

  const selected=session.uiBindings().readSelectedTurnReceipt(selection);
  const semantic=selected.sceneFlow?.semanticObservation?.execution;
  assert.equal(semantic?.status,'SKIPPED');
  assert.equal(semantic?.attempted,false);
  assert.equal(semantic?.returned,false);
  assert.equal(selected.sceneFlow?.semanticObservation?.ownerAdmission??null,null);
  const noProviderOwnerScene=session.brain.scene.registry.current(turn.sceneId);
  assert.equal(noProviderOwnerScene.fields.location.observationClass,'UNKNOWN');
  assert.equal(noProviderOwnerScene.fields.activeCast.value,null);

  session.destroy();
});

test('Scene proposal admission fences malformed output stale revision late foreground chat switch and regeneration without fabricated mutation',async()=>{
  const malformed=new DevelopmentDeploymentBrain();
  await connectSceneResource(malformed,{resourceId:'scene:malformed',handler:()=>({unexpected:true})});
  const malformedSource=ownerSource(malformed,{chatId:'chat:malformed',messageId:'m1'});
  const malformedWork=await malformed.runSceneObservationWork({
    chatId:'chat:malformed',turnId:'turn:malformed',generationId:'gen:malformed',correlationId:'corr:malformed',
    sourceRevisionId:malformedSource,narrative:USER_PROSE,
  });
  assert.equal(malformedWork.status,'DEGRADED');
  assert.equal(malformedWork.executionReceipt.attempted,true);
  assert.equal(malformedWork.executionReceipt.returned,false);
  assert.equal(malformed.scene.integrationSignal('chat:malformed').sceneRevision,1);
  assert.equal(malformed.resourceOwnerReceipts.length,0);

  const stale=new DevelopmentDeploymentBrain();
  await connectSceneResource(stale,{resourceId:'scene:stale'});
  const staleWork=await createDirectWork(stale,{chatId:'chat:stale',turnId:'turn:stale',generationId:'gen:stale'});
  assert.equal(staleWork.work.status,'RETURNED');
  stale.observeScene({chatId:'chat:stale',sourceRevisionId:'source:advance',location:'Owner Advance'});
  const advancedRevision=stale.scene.integrationSignal('chat:stale').sceneRevision;
  const staleAdmission=stale.admitSceneObservationProposal({work:staleWork.work,hostEvent:staleWork.event,currentSelection:true,turnSealed:false});
  assert.equal(staleAdmission.accepted,false);
  assert.equal(staleAdmission.reasonCode,'SCENE_PROPOSAL_STALE_REVISION');
  assert.equal(staleAdmission.receipt.stale,true);
  assert.equal(stale.scene.integrationSignal('chat:stale').sceneRevision,advancedRevision);

  const late=new DevelopmentDeploymentBrain();
  await connectSceneResource(late,{resourceId:'scene:late'});
  const lateWork=await createDirectWork(late,{chatId:'chat:late',turnId:'turn:late',generationId:'gen:late'});
  const lateRevision=late.scene.integrationSignal('chat:late').sceneRevision;
  const lateAdmission=late.admitSceneObservationProposal({work:lateWork.work,hostEvent:lateWork.event,currentSelection:true,turnSealed:true});
  assert.equal(lateAdmission.accepted,false);
  assert.equal(lateAdmission.reasonCode,'SCENE_PROPOSAL_LATE_AFTER_SEAL');
  assert.equal(lateAdmission.receipt.late,true);
  assert.equal(late.scene.integrationSignal('chat:late').sceneRevision,lateRevision);

  const switched=new DevelopmentDeploymentBrain();
  await connectSceneResource(switched,{resourceId:'scene:switch'});
  const switchedWork=await createDirectWork(switched,{chatId:'chat:switch',turnId:'turn:switch',generationId:'gen:switch'});
  const switchRevision=switched.scene.integrationSignal('chat:switch').sceneRevision;
  const switchedAdmission=switched.admitSceneObservationProposal({work:switchedWork.work,hostEvent:switchedWork.event,currentSelection:false,turnSealed:false});
  assert.equal(switchedAdmission.accepted,false);
  assert.equal(switchedAdmission.reasonCode,'SCENE_PROPOSAL_SELECTION_SUPERSEDED');
  assert.equal(switched.scene.integrationSignal('chat:switch').sceneRevision,switchRevision);

  const regenerated=new DevelopmentDeploymentBrain();
  await connectSceneResource(regenerated,{resourceId:'scene:regen'});
  const regenWork=await createDirectWork(regenerated,{chatId:'chat:regen',messageId:'m1',messageRevision:1,turnId:'turn:regen',generationId:'gen:regen'});
  const regenRevision=regenerated.scene.integrationSignal('chat:regen').sceneRevision;
  const replacementSource=ownerSource(regenerated,{chatId:'chat:regen',messageId:'m1',messageRevision:2});
  const replacementEvent={...regenWork.event,messageRevision:2,sourceRevisionId:replacementSource,hostEventId:'host:regen:r2'};
  const regenAdmission=regenerated.admitSceneObservationProposal({work:regenWork.work,hostEvent:replacementEvent,currentSelection:true,turnSealed:false});
  assert.equal(regenAdmission.accepted,false);
  assert.equal(regenAdmission.reasonCode,'SCENE_PROPOSAL_SOURCE_FENCE_MISMATCH');
  assert.equal(regenAdmission.receipt.invalid,true);
  assert.equal(regenerated.scene.integrationSignal('chat:regen').sceneRevision,regenRevision);
});

test('post-response Scene cognition may update next-turn owner state after the parent prompt sealed without bypassing Scene ownership',async()=>{
  const brain=new DevelopmentDeploymentBrain();
  await connectSceneResource(brain,{resourceId:'scene:post'});
  const {work,event}=await createDirectWork(brain,{
    chatId:'chat:post',messageId:'assistant-1',turnId:'turn:post',generationId:'gen:post',
    phase:'POST_RESPONSE',content:ASSISTANT_PROSE,
  });
  assert.equal(work.status,'RETURNED');
  assert.equal(work.executionReceipt.phase,'POST_RESPONSE');
  const before=brain.scene.integrationSignal('chat:post').sceneRevision;
  const admission=brain.admitSceneObservationProposal({work,hostEvent:event,currentSelection:true,turnSealed:true});
  assert.equal(admission.accepted,true);
  assert.equal(admission.reasonCode,'SCENE_OWNER_ADMITTED');
  assert.ok(brain.scene.integrationSignal('chat:post').sceneRevision>before);
  assert.equal(brain.scene.registry.current(admission.ownerReceipt.sceneId).fields.activeThreads.value[0],'courier-arrived');
  assert.equal(admission.receipt.canonicalMutation,false);
  assert.equal(admission.receipt.contextSealAuthority,undefined);
});

test('Scene cognition receipts and Director metadata remain bounded and retain no narrative on repeated no-provider work',async()=>{
  const brain=new DevelopmentDeploymentBrain();
  const secret='SCENE_RAW_STORY_SENTINEL_SHOULD_NEVER_BE_RETAINED';
  for(let i=0;i<140;i++){
    const chatId='chat:bounded',messageId='m'+i,sourceRevisionId=ownerSource(brain,{chatId,messageId,messageRevision:1});
    const result=await brain.runSceneObservationWork({
      chatId,turnId:'turn:'+i,generationId:'gen:'+i,correlationId:'corr:'+i,
      sourceRevisionId,narrative:secret+' '+i,phase:'FOREGROUND_USER',parentWorkId:'parent:'+i,
    });
    assert.equal(result.status,'SKIPPED');
    assert.equal(result.executionReceipt.attempted,false);
  }
  const receipts=brain.readSceneObservationReceipts({limit:128});
  assert.equal(receipts.length,128);
  assert.doesNotMatch(JSON.stringify(receipts),new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(brain.resourceDirector.snapshot()),new RegExp(secret));
  assert.equal(brain.listOptionalResources().resources.length,0);
});
