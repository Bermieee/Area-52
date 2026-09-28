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
async function waitFor(fn,{timeout=2500,step=10}={}){
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,step));}
  throw new Error('condition not observed before timeout');
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
  phase='FOREGROUND_USER',content=USER_PROSE,payload=null,
}={}){
  const sourceRevisionId=ownerSource(brain,{chatId,messageId,messageRevision});
  const current=brain.scene.ensureChatScene(chatId,{sourceRevisionRefs:[sourceRevisionId],evidenceRefs:[sourceRevisionId]});
  const workerPayload=payload??scenePayload({phase}),fields={};
  for(const [name,row] of Object.entries(workerPayload.fields??{})){
    const observationClass=row?.observationClass??'UNKNOWN';
    fields[name]={
      value:structuredClone(row?.value??null),confidence:Number(row?.confidence??0),observationClass,
      evidenceRefs:observationClass==='UNKNOWN'?[]:[sourceRevisionId],
      provenance:observationClass==='UNKNOWN'?[]:['area52-cognitive-resource:'+sourceRevisionId],
    };
  }
  const proposal=brain.sceneObservationExtractor.propose({
    scene:current,evidence:{id:sourceRevisionId,sourceRevisionId},fields,provider:'owner-contract-fixture',
  });
  const executionReceipt={
    kind:'DeploymentSceneObservationExecutionReceipt',contractVersion:1,status:'RETURNED',
    reasonCode:'OWNER_CONTRACT_FIXTURE',workId:'scene-owner-fixture:'+generationId,parentWorkId:'generation:'+generationId,
    chatId,turnId,generationId,correlationId:'corr:'+turnId,sourceRevisionId,sourceRevisionRefs:[sourceRevisionId],
    sceneRevision:current.revision,phase,attempted:true,returned:true,ownerAdmitted:null,invalid:false,stale:false,late:false,
    degraded:false,skipped:false,resultId:'fixture-result:'+generationId,providerId:'owner-contract-fixture',workerId:'owner-contract-fixture',
    latencyMs:0,fieldNames:Object.keys(fields).sort(),ambiguityCount:(workerPayload.ambiguities??[]).length,
    rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
    authorityGranted:false,canonicalMutation:false,settlementPerformed:false,contextSealAuthority:false,
  };
  const work={
    kind:'SceneObservationWorkResult',status:'RETURNED',proposal,
    boundarySignals:structuredClone(workerPayload.boundarySignals??{}),ambiguities:structuredClone(workerPayload.ambiguities??[]),
    executionReceipt,
  };
  return{work,sourceRevisionId,event:hostEvent({brain,chatId,messageId,messageRevision,turnId,sourceRevisionId,activity:phase==='POST_RESPONSE'?HostActivity.ASSISTANT_GENERATION_COMPLETE:HostActivity.USER_SEND,content,role:phase==='POST_RESPONSE'?'assistant':'user'})};
}

test('installed native host queues semantic Scene work without blocking the sealed turn and admits it only for future Scene state',async()=>{
  const fallback=extractDevelopmentDeploymentScene(USER_PROSE,{revision:2,evidenceRef:'source:fallback'});
  assert.equal(fallback.explicit,false);
  assert.deepEqual(fallback.fields,{});

  const {sillyTavern,context,listeners}=makeHost();
  const nativeBrain=new Area52NativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({
    sillyTavern,document:null,mountUi:false,nativeBrain,
  });
  await connectSceneResource(session.brain);
  session.start();

  pushUser(context,USER_PROSE);
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));

  const ui=nativeBrain.uiBindings();
  const selection=ui.readSelection({chatId:context.chatId});
  assert.ok(selection?.turnId);
  assert.ok(selection?.generationId);

  const turn=nativeBrain.readTurn(selection.turnId);
  assert.ok(turn.published?.candidateEnvelope,'Sensory/Candidate Bus envelope must exist for the sealed turn');
  assert.ok(turn.published?.assessment,'Truth assessment must exist for the sealed turn');
  assert.ok(turn.published?.gatherReceipt,'Gather receipt must exist for the sealed turn');
  assert.ok(turn.published?.sealReceipt?.sealedState,'Context Seal must exist before model request');
  assert.ok(turn.delivery?.plan?.promptPlanId,'PromptPlan must exist before model request');
  assert.doesNotMatch(JSON.stringify(turn.delivery.plan.sections),/Greyharbor Observatory|courier-arrival|brass-key/,'OPPORTUNISTIC Scene work must not rewrite the current sealed generation');

  const selected=session.uiBindings().readSelectedTurnReceipt(selection);
  const semantic=selected.sceneFlow?.semanticObservation;
  assert.ok(['QUEUED','DEDUPED'].includes(semantic?.execution?.status));
  assert.equal(semantic?.execution?.returned,false);
  assert.equal(semantic?.execution?.chatId,selection.chatId);
  assert.equal(semantic?.execution?.turnId,selection.turnId);
  assert.equal(semantic?.execution?.generationId,selection.generationId);
  assert.ok(semantic?.execution?.workId);
  assert.equal(semantic?.ownerAdmission??null,null);

  const lateAdmission=await waitFor(()=>session.brain.readSceneObservationReceipts({limit:128}).find(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.turnId===selection.turnId&&row.status==='ADMITTED'));
  assert.equal(lateAdmission.ownerAdmitted,true);
  const ownerSignal=session.brain.scene.integrationSignal(context.chatId);
  assert.equal(ownerSignal.location.location,'Greyharbor Observatory');
  assert.deepEqual(ownerSignal.activeCast.map(row=>row.characterId).sort(),['Mira','Ren']);
  assert.deepEqual(ownerSignal.activeThreads,['courier-arrival']);
  assert.equal(ownerSignal.objects[0].objectId,'brass-key');
  const diagnosticJson=JSON.stringify(session.exportEvidence().nativeBrainIntegration.selectedTurnReceipt);
  assert.doesNotMatch(diagnosticJson,/City lights were pinpricks|joined hands|watched for the courier/i);
  assert.doesNotMatch(diagnosticJson,/hidden reasoning|api[_ -]?key/i);

  const request={chat:[{role:'system',content:'host policy'},{role:'user',content:USER_PROSE}],dryRun:false};
  await Promise.all([...listeners.get('chat_completion_prompt_ready')].map(fn=>fn(request)));
  const assistantIndex=pushAssistant(context,ASSISTANT_PROSE);
  await Promise.all([...listeners.get('message_received')].map(fn=>fn(assistantIndex)));

  const learned=ui.readGeneration({generationId:selection.generationId,...selection});
  assert.ok(['RESPONSE_COMPLETED','LEARNED'].includes(learned.state),'Scene nearline work must not break native provider-response completion');
  assert.equal(learned.responseCompletion?.status,'COMPLETED');
  const completion=session.exportEvidence().nativeBrainIntegration.last;
  assert.equal(completion.state,'RESPONSE_COMPLETED');
  assert.equal(completion.responseCompletion?.status,'COMPLETED');
  assert.ok(['QUEUED','DEDUPED'].includes(completion.postResponseScene?.semanticObservation?.status));
  await waitFor(()=>session.brain.readSceneObservationReceipts({limit:128}).find(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.phase==='POST_RESPONSE'&&row.status==='ADMITTED'));
  assert.ok(session.brain.scene.integrationSignal(context.chatId).sceneRevision>selection.sceneRevision);
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
  const malformedEvent=hostEvent({brain:malformed,chatId:'chat:malformed',messageId:'m1',turnId:'turn:malformed',content:USER_PROSE});
  malformed.ingestSceneHostEvent(malformedEvent,{extract:()=>({})});
  const malformedWork=await malformed.runSceneObservationWork({
    chatId:'chat:malformed',turnId:'turn:malformed',generationId:'gen:malformed',correlationId:'corr:malformed',
    sourceRevisionId:malformedEvent.sourceRevisionId,narrative:USER_PROSE,hostEvent:malformedEvent,
  });
  assert.equal(malformedWork.status,'QUEUED');
  const malformedFailure=await waitFor(()=>malformed.readSceneObservationReceipts({limit:128}).find(row=>row.status==='FAILED'&&row.workId===malformedWork.executionReceipt.workId));
  assert.ok(malformedFailure.reasonCode);
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

function ambiguousScenePayload(){
  return{
    fields:{},
    boundarySignals:{},
    ambiguities:[{
      ambiguityId:'location-reading',
      decisionKind:'SCENE_CAST_LOCATION_CONFLICT',
      field:'location',
      alternatives:[
        {optionId:'OBSERVATORY',label:'Greyharbor Observatory',value:{location:'Greyharbor Observatory'},confidence:.72},
        {optionId:'ANNEX',label:'Greyharbor Annex',value:{location:'Greyharbor Annex'},confidence:.68},
      ],
    }],
  };
}

test('clear deterministic Scene observation stays on the Scene owner path and does not invoke the Sidecar',async()=>{
  let sidecarCalls=0;
  const {sillyTavern,context,listeners}=makeHost();
  const nativeBrain=new Area52NativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});
  await connectSceneResource(session.brain,{
    resourceId:'scene:deterministic-skip',
    handler:()=>{sidecarCalls++;return scenePayload();},
  });
  session.start();

  pushUser(context,'At Ember Tavern, Mira waits by the hearth.');
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));

  const signal=session.brain.scene.integrationSignal(context.chatId);
  assert.equal(signal.location.location,'Ember Tavern');
  assert.equal(sidecarCalls,0,'deterministic supported evidence must not schedule external Scene extraction');
  const selection=nativeBrain.uiBindings().readSelection({chatId:context.chatId});
  const selected=session.uiBindings().readSelectedTurnReceipt(selection);
  assert.equal(selected.sceneFlow?.semanticObservation??null,null);
  assert.equal(session.brain.readSceneObservationReceipts({limit:16}).length,0);
  session.destroy();
});

test('deterministic meaningful location transition is revisioned through the Scene owner and confirms a boundary',()=>{
  const brain=new DevelopmentDeploymentBrain();
  const chatId='chat:transition';
  const firstSource=ownerSource(brain,{chatId,messageId:'m1'});
  const firstEvent=hostEvent({brain,chatId,messageId:'m1',turnId:'turn:transition:1',sourceRevisionId:firstSource,content:'At Old Docks, Mira waits.'});
  const first=brain.ingestSceneHostEvent(firstEvent,{extract:(e,scene)=>extractDevelopmentDeploymentScene(e.content,{
    revision:scene.revision+1,evidenceRef:e.sourceRevisionId,currentScene:scene,sceneRuntime:brain.scene,
  })});
  assert.equal(first.status,'OBSERVED');
  const firstScene=brain.scene.registry.current(first.sceneId);
  assert.equal(firstScene.fields.location.value.location,'Old Docks');

  const secondSource=ownerSource(brain,{chatId,messageId:'m2'});
  const secondEvent=hostEvent({brain,chatId,messageId:'m2',turnId:'turn:transition:2',sourceRevisionId:secondSource,content:'Mira travels to Sunken Archive. Scene break.'});
  const second=brain.ingestSceneHostEvent(secondEvent,{extract:(e,scene)=>extractDevelopmentDeploymentScene(e.content,{
    revision:scene.revision+1,evidenceRef:e.sourceRevisionId,currentScene:scene,sceneRuntime:brain.scene,
  })});
  assert.equal(second.status,'OBSERVED');
  assert.ok(second.changedFields.includes('location'));
  assert.equal(second.boundarySignals.locationTransition,1);
  assert.equal(second.boundarySignals.explicitBreak,1);
  assert.equal(second.boundary?.decision?.status,'CONFIRMED');
  assert.ok(second.transition,'confirmed meaningful transition must flow through Clapperboard rather than direct mutation');
});

test('bounded Sidecar ambiguity is advisory until Scene owner accepts Jev guidance',async()=>{
  const brain=new DevelopmentDeploymentBrain();
  await connectSceneResource(brain,{resourceId:'scene:ambiguous',handler:()=>ambiguousScenePayload()});
  const {work,event}=await createDirectWork(brain,{chatId:'chat:ambiguous',turnId:'turn:ambiguous',generationId:'gen:ambiguous',payload:ambiguousScenePayload()});
  assert.equal(work.status,'RETURNED');
  assert.equal(work.ambiguities.length,1);
  assert.equal(work.executionReceipt.ambiguityCount,1);
  const before=brain.scene.integrationSignal('chat:ambiguous').sceneRevision;

  brain.sceneJevOwner.service={
    async adjudicate(){
      return{proposedOutcome:'OBSERVATORY',staleState:'FRESH',abstained:false};
    },
  };
  const advice=await brain.adjudicateSceneObservationAmbiguity({
    work,hostEvent:event,currentSelection:()=>true,turnSealed:()=>false,
  });
  assert.equal(advice.status,'ADVISED');
  assert.equal(advice.accepted,true);
  assert.equal(advice.selectedOptionId,'OBSERVATORY');
  assert.equal(brain.scene.integrationSignal('chat:ambiguous').sceneRevision,before,'Jev advice itself must not revise Scene');

  const admission=brain.admitSceneObservationProposal({
    work,hostEvent:event,currentSelection:true,turnSealed:false,jevAdvice:advice,
  });
  assert.equal(admission.accepted,true);
  assert.equal(admission.ownerReceipt.jevAdvisory.selectedOptionId,'OBSERVATORY');
  const current=brain.scene.registry.current(admission.ownerReceipt.sceneId);
  assert.equal(current.fields.location.value.location,'Greyharbor Observatory');
  assert.equal(current.fields.location.observationClass,'INFERRED');
  assert.deepEqual(current.fields.location.evidenceRefs,[event.sourceRevisionId]);
  assert.equal(advice.canonicalMutation,false);
  assert.equal(advice.settlementPerformed,false);
});

test('Jev unavailable or late after selection change preserves unresolved Scene state',async()=>{
  const unavailable=new DevelopmentDeploymentBrain({jevAvailable:false});
  await connectSceneResource(unavailable,{resourceId:'scene:ambiguous-unavailable',handler:()=>ambiguousScenePayload()});
  const unavailableWork=await createDirectWork(unavailable,{chatId:'chat:jev-unavailable',turnId:'turn:jev-unavailable',generationId:'gen:jev-unavailable',payload:ambiguousScenePayload()});
  const unavailableBefore=unavailable.scene.integrationSignal('chat:jev-unavailable').sceneRevision;
  const unavailableAdvice=await unavailable.adjudicateSceneObservationAmbiguity({
    work:unavailableWork.work,hostEvent:unavailableWork.event,currentSelection:()=>true,turnSealed:()=>false,
  });
  assert.equal(unavailableAdvice.status,'UNRESOLVED');
  assert.equal(unavailableAdvice.reasonCode,'JEV_SERVICE_UNAVAILABLE');
  assert.equal(unavailable.scene.integrationSignal('chat:jev-unavailable').sceneRevision,unavailableBefore);

  const late=new DevelopmentDeploymentBrain();
  await connectSceneResource(late,{resourceId:'scene:ambiguous-late',handler:()=>ambiguousScenePayload()});
  const lateWork=await createDirectWork(late,{chatId:'chat:jev-late',turnId:'turn:jev-late',generationId:'gen:jev-late',payload:ambiguousScenePayload()});
  const lateBefore=late.scene.integrationSignal('chat:jev-late').sceneRevision;
  let selected=true;
  late.sceneJevOwner.service={
    async adjudicate(){
      selected=false;
      return{proposedOutcome:'OBSERVATORY',staleState:'FRESH',abstained:false};
    },
  };
  const lateAdvice=await late.adjudicateSceneObservationAmbiguity({
    work:lateWork.work,hostEvent:lateWork.event,currentSelection:()=>selected,turnSealed:()=>false,
  });
  assert.equal(lateAdvice.status,'UNRESOLVED');
  assert.equal(lateAdvice.reasonCode,'SCENE_JEV_SELECTION_SUPERSEDED');
  assert.equal(lateAdvice.stale,true);
  assert.equal(late.scene.integrationSignal('chat:jev-late').sceneRevision,lateBefore);
});

test('source edit invalidates dependent Scene observation and fences the old Sidecar proposal',async()=>{
  const brain=new DevelopmentDeploymentBrain();
  await connectSceneResource(brain,{resourceId:'scene:source-edit'});
  const original=await createDirectWork(brain,{chatId:'chat:edit',messageId:'m1',messageRevision:1,turnId:'turn:edit',generationId:'gen:edit'});
  const admitted=brain.admitSceneObservationProposal({work:original.work,hostEvent:original.event,currentSelection:true,turnSealed:false});
  assert.equal(admitted.accepted,true);
  const oldRevision=admitted.ownerReceipt.sceneRevision;

  const replacementSource=ownerSource(brain,{chatId:'chat:edit',messageId:'m1',messageRevision:2});
  const edit=hostEvent({
    brain,chatId:'chat:edit',messageId:'m1',messageRevision:2,turnId:'turn:edit:replacement',
    sourceRevisionId:replacementSource,activity:HostActivity.EDIT,content:'The earlier location description was corrected.',
  });
  const editReceipt=brain.ingestSceneHostEvent(edit,{extract:()=>({fields:{},boundarySignals:{}})});
  assert.ok(editReceipt.invalidatedSourceRevisionRefs.includes(original.sourceRevisionId));
  assert.ok(editReceipt.sceneRevision>oldRevision);
  const current=brain.scene.registry.current(editReceipt.sceneId);
  assert.equal(current.fields.location.observationClass,'UNRESOLVED');

  const oldAgain=brain.admitSceneObservationProposal({work:original.work,hostEvent:original.event,currentSelection:true,turnSealed:false});
  assert.equal(oldAgain.accepted,false);
  assert.equal(oldAgain.reasonCode,'SCENE_PROPOSAL_STALE_REVISION');
  assert.equal(oldAgain.receipt.stale,true);
});

