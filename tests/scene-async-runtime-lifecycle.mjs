import test from 'node:test';
import assert from 'node:assert/strict';

import {Area52NativeBrain} from '../src/native-brain.js';
import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {createDevelopmentDeploymentSillyTavernSession} from '../src/deployment/sillytavern-live.js';
import {HostActivity} from '../src/scene/lifecycle-contracts.js';

const USER_PROSE="City lights blur beyond the glass while Mira quietly studies the courier's sealed note.";
const VALID_PAYLOAD={
  fields:{
    location:{value:{location:'Greyharbor Observatory'},confidence:.98,observationClass:'OBSERVED'},
    activeThreads:{value:['courier-note'],confidence:.91,observationClass:'INFERRED'},
  },
  boundarySignals:{},
};

function makeHost(){
  const listeners=new Map();
  const context={
    chatId:'chat:scene-async',chat:[],
    eventTypes:{
      GENERATION_AFTER_COMMANDS:'generation_after_commands',CHAT_COMPLETION_PROMPT_READY:'chat_completion_prompt_ready',
      MESSAGE_SENT:'message_sent',MESSAGE_RECEIVED:'message_received',MESSAGE_EDITED:'message_edited',MESSAGE_DELETED:'message_deleted',
      MESSAGE_UPDATED:'message_updated',MESSAGE_SWIPED:'message_swiped',MESSAGE_SWIPE_DELETED:'message_swipe_deleted',
      CHAT_CHANGED:'chat_id_changed',CHAT_LOADED:'chatLoaded',CHAT_CREATED:'chat_created',CHAT_RENAMED:'chat_renamed',
      WORLDINFO_UPDATED:'worldinfo_updated',WORLDINFO_SETTINGS_UPDATED:'worldinfo_settings_updated',
      GENERATION_STARTED:'generation_started',GENERATION_ENDED:'generation_ended',GENERATION_STOPPED:'generation_stopped',
    },
    eventSource:{
      on(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
      removeListener(type,fn){listeners.get(type)?.delete(fn);},
    },
    async setExtensionPrompt(){},
  };
  return{sillyTavern:{getContext:()=>context},context,listeners};
}
function pushUser(context,mes,id='user-1'){context.chat.push({is_user:true,mes,mesId:id,send_date:Date.now()});return context.chat.length-1;}
function deferred(){
  let resolve,reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return{promise,resolve,reject};
}
async function waitFor(fn,{timeout=2500,step=10}={}){
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,step));}
  throw new Error('condition not observed before timeout');
}
async function connectScene(brain,handler,{id='scene:async'}={}){
  brain.optionalResources.actions.addResource({
    resourceId:id,kind:'DETERMINISTIC_LOCAL',displayName:'Async Scene fixture',
    providerProfileId:'profile:'+id,providerId:'provider:'+id,modelId:'scene-fixture',workerId:'resource:'+id,
    capabilities:['STRUCTURED_EXTRACTION'],maxConcurrency:1,
    handlers:{SCENE_OBSERVATION:handler},
  });
  await brain.optionalResources.actions.connectResource(id);
}
function sceneEvent(brain,{chatId='chat:direct',messageId='m1',messageRevision=1,turnId='turn:direct',generationId='gen:direct',content=USER_PROSE,activity=HostActivity.USER_SEND}={}){
  const sourceRevisionId=brain.scene.narrativeFeed.sourceRevisionIdFor({chatId,messageId,messageRevision});
  return{
    activity,chatId,hostEventId:`host:${chatId}:${messageId}:r${messageRevision}:${activity}`,messageId,messageRevision,
    turnId,generationId,correlationId:'corr:'+turnId,causationId:'cause:'+turnId,sourceRevisionId,content,
    role:activity===HostActivity.ASSISTANT_GENERATION_COMPLETE?'assistant':'user',
  };
}

test('production host does not wait for Scene provider; late fresh result routes NEXT_TURN, owner-admits, and cannot change sealed packet',async()=>{
  const gate=deferred(),{sillyTavern,context,listeners}=makeHost(),nativeBrain=new Area52NativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});
  await connectScene(session.brain,()=>gate.promise);
  session.start();pushUser(context,USER_PROSE);

  const begin=Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));
  const responsive=await Promise.race([begin.then(()=> 'READY'),new Promise(resolve=>setTimeout(()=>resolve('BLOCKED'),250))]);
  assert.equal(responsive,'READY','Scene semantic extraction must not hold host generation preparation open');

  const selection=nativeBrain.uiBindings().readSelection({chatId:context.chatId});
  const sealedBefore=nativeBrain.readTurn(selection.turnId).published.sealReceipt;
  const sealedJson=JSON.stringify(sealedBefore);
  assert.equal(sealedBefore.sealedState,true);
  assert.doesNotMatch(JSON.stringify(nativeBrain.readTurn(selection.turnId).delivery.plan.sections),/Greyharbor Observatory/);

  const queued=session.brain.readSceneObservationReceipts({limit:128}).find(row=>row.status==='QUEUED'&&row.turnId===selection.turnId);
  assert.ok(queued);assert.equal(queued.foregroundDisposition,'DETERMINISTIC_FALLBACK_AND_FORWARD_RESULT');
  const originalNow=Date.now,base=originalNow();
  try{
    Date.now=()=>base+12050;
    gate.resolve(VALID_PAYLOAD);
    const admitted=await waitFor(()=>session.brain.readSceneObservationReceipts({limit:128}).find(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.turnId===selection.turnId&&row.status==='ADMITTED'));
    assert.equal(admitted.ownerAdmitted,true);
  }finally{Date.now=originalNow;}

  const receipts=session.brain.readSceneObservationReceipts({limit:128});
  const physical=receipts.find(row=>row.reasonCode==='SCENE_OBSERVATION_PHYSICAL_COMPLETION'&&row.turnId===selection.turnId);
  const route=receipts.find(row=>row.kind==='DeploymentSceneObservationRouteReceipt'&&row.turnId===selection.turnId);
  assert.ok(physical?.completedAfterForegroundDeadline,'physical completion must survive beyond the former foreground cancellation window');
  assert.equal(physical.generationBudget?.policy,'ADAPTIVE_SCENE');
  assert.equal(route?.freshness,'FRESH');assert.equal(route?.effectiveDestination,'NEXT_TURN');
  assert.equal(session.brain.scene.integrationSignal(context.chatId).location.location,'Greyharbor Observatory');

  const sealedAfter=nativeBrain.readTurn(selection.turnId).published.sealReceipt;
  assert.equal(JSON.stringify(sealedAfter),sealedJson,'late owner mutation must not reopen or rewrite an already sealed generation');

  const envelope=session.brain.resourceDirectorResults.find(row=>row.taskId===queued.workId&&row.executionOutcome==='COMPLETED');
  assert.ok(envelope);
  const revisionBeforeDuplicate=session.brain.scene.integrationSignal(context.chatId).sceneRevision;
  const admittedCountBefore=receipts.filter(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.turnId===selection.turnId&&row.status==='ADMITTED').length;
  session.brain.resourceDirector.resultSink(envelope);
  await new Promise(resolve=>setTimeout(resolve,30));
  const afterDuplicate=session.brain.readSceneObservationReceipts({limit:128});
  assert.equal(session.brain.scene.integrationSignal(context.chatId).sceneRevision,revisionBeforeDuplicate);
  assert.equal(afterDuplicate.filter(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.turnId===selection.turnId&&row.status==='ADMITTED').length,admittedCountBefore);
  assert.ok(afterDuplicate.some(row=>row.kind==='DeploymentSceneObservationRouteReceipt'&&row.workId===queued.workId&&row.duplicate===true));

  const diag=session.brain.diagnostics().sceneObservation;
  assert.ok(diag.counts.QUEUED>=1);assert.ok(diag.counts.RETURNED>=1);assert.ok(diag.counts.ROUTED>=1);assert.ok(diag.counts.ADMITTED>=1);
  assert.ok(diag.runtimeStates.some(row=>row.taskId===queued.workId));
  session.destroy();
});

test('post-response Scene work is DEFERRED, remains valid beyond the former ten-second window, and routes BACKGROUND',async()=>{
  const brain=new DevelopmentDeploymentBrain(),gate=deferred();
  await connectScene(brain,()=>gate.promise,{id:'scene:post'});
  const event=sceneEvent(brain,{chatId:'chat:post',messageId:'a1',turnId:'turn:post',generationId:'gen:post',activity:HostActivity.ASSISTANT_GENERATION_COMPLETE});
  brain.ingestSceneHostEvent(event,{extract:()=>({})});
  const work=await brain.runSceneObservationWork({
    chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,correlationId:event.correlationId,
    sourceRevisionId:event.sourceRevisionId,narrative:event.content,phase:'POST_RESPONSE',parentWorkId:'generation:'+event.generationId,hostEvent:event,
  });
  assert.equal(work.status,'QUEUED');
  const ledger=brain.resourceDirector.ledger.get(work.executionReceipt.workId);
  const task=ledger.obligation.payload.cognitiveTask;
  assert.equal(task.resultClass,'DEFERRED');assert.equal(task.hardDeadline,task.softDeadline);
  const originalNow=Date.now,base=originalNow();
  try{Date.now=()=>base+12050;gate.resolve(VALID_PAYLOAD);await waitFor(()=>brain.readSceneObservationReceipts({limit:128}).some(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.workId===work.executionReceipt.workId));}
  finally{Date.now=originalNow;}
  const receipts=brain.readSceneObservationReceipts({limit:128}),route=receipts.find(row=>row.kind==='DeploymentSceneObservationRouteReceipt'&&row.workId===work.executionReceipt.workId);
  assert.equal(route?.effectiveDestination,'BACKGROUND');assert.equal(route?.freshness,'FRESH');
  assert.ok(receipts.some(row=>row.reasonCode==='SCENE_OBSERVATION_PHYSICAL_COMPLETION'&&row.completedAfterForegroundDeadline===true));
});

test('source edit cancels exact in-flight Scene work and obsolete output cannot mutate current Scene',async()=>{
  const brain=new DevelopmentDeploymentBrain(),gate=deferred();
  await connectScene(brain,()=>gate.promise,{id:'scene:edit'});
  const first=sceneEvent(brain,{chatId:'chat:edit',messageId:'m1',messageRevision:1,turnId:'turn:edit',generationId:'gen:edit'});
  brain.ingestSceneHostEvent(first,{extract:()=>({})});
  const work=await brain.runSceneObservationWork({
    chatId:first.chatId,turnId:first.turnId,generationId:first.generationId,correlationId:first.correlationId,
    sourceRevisionId:first.sourceRevisionId,narrative:first.content,hostEvent:first,parentWorkId:'generation:'+first.generationId,
  });
  await waitFor(()=>brain.resourceConnections.taskControllers.has(work.executionReceipt.workId));
  const edited=sceneEvent(brain,{chatId:first.chatId,messageId:'m1',messageRevision:2,turnId:'turn:edit2',generationId:'gen:edit2',content:'Mira leaves the sealed note untouched.'});
  const editReceipt=brain.ingestSceneHostEvent(edited,{extract:()=>({})});
  assert.ok(editReceipt.invalidatedSourceRevisionRefs.includes(first.sourceRevisionId));
  assert.ok(brain.readSceneObservationReceipts({limit:128}).some(row=>row.status==='CANCELLED'&&row.workId===work.executionReceipt.workId&&row.reasonCode==='SCENE_OBSERVATION_SOURCE_INVALIDATED'));
  gate.resolve(VALID_PAYLOAD);
  await new Promise(resolve=>setTimeout(resolve,40));
  const signal=brain.scene.integrationSignal(first.chatId);
  assert.notEqual(signal.location?.location,'Greyharbor Observatory');
  assert.equal(brain.readSceneObservationReceipts({limit:128}).some(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.workId===work.executionReceipt.workId&&row.status==='ADMITTED'),false);
});

test('explicit operator cancellation is truthful and does not fabricate owner acceptance',async()=>{
  const brain=new DevelopmentDeploymentBrain(),gate=deferred();
  await connectScene(brain,()=>gate.promise,{id:'scene:cancel'});
  const event=sceneEvent(brain,{chatId:'chat:cancel',turnId:'turn:cancel',generationId:'gen:cancel'});
  brain.ingestSceneHostEvent(event,{extract:()=>({})});
  const work=await brain.runSceneObservationWork({
    chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,correlationId:event.correlationId,
    sourceRevisionId:event.sourceRevisionId,narrative:event.content,hostEvent:event,parentWorkId:'generation:'+event.generationId,
  });
  await waitFor(()=>brain.resourceConnections.taskControllers.has(work.executionReceipt.workId));
  const cancelled=brain.cancelSceneObservationWork({taskId:work.executionReceipt.workId});
  assert.equal(cancelled.length,1);assert.equal(cancelled[0].physicalCancellationRequested,true);
  gate.resolve(VALID_PAYLOAD);await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(brain.readSceneObservationReceipts({limit:128}).some(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.workId===work.executionReceipt.workId&&row.status==='ADMITTED'),false);
});
