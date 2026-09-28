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
  const edited=sceneEvent(brain,{chatId:first.chatId,messageId:'m1',messageRevision:2,turnId:'turn:edit2',generationId:'gen:edit2',content:'Mira leaves the sealed note untouched.',activity:HostActivity.EDIT});
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


test('newer same-lane Scene work supersedes older work without oversubscribing a still-occupied provider slot',async()=>{
  const brain=new DevelopmentDeploymentBrain(),firstGate=deferred(),secondGate=deferred();let calls=0;
  await connectScene(brain,()=>++calls===1?firstGate.promise:secondGate.promise,{id:'scene:supersede'});
  const first=sceneEvent(brain,{chatId:'chat:supersede',messageId:'m1',turnId:'turn:supersede:1',generationId:'gen:supersede:1'});
  brain.ingestSceneHostEvent(first,{extract:()=>({})});
  const firstWork=await brain.runSceneObservationWork({
    chatId:first.chatId,turnId:first.turnId,generationId:first.generationId,correlationId:first.correlationId,
    sourceRevisionId:first.sourceRevisionId,narrative:first.content,hostEvent:first,parentWorkId:'generation:'+first.generationId,
  });
  await waitFor(()=>brain.resourceConnections.taskControllers.has(firstWork.executionReceipt.workId));

  const second=sceneEvent(brain,{chatId:first.chatId,messageId:'m2',turnId:'turn:supersede:2',generationId:'gen:supersede:2',content:'Mira studies a second sealed note.'});
  brain.ingestSceneHostEvent(second,{extract:()=>({})});
  const secondWork=await brain.runSceneObservationWork({
    chatId:second.chatId,turnId:second.turnId,generationId:second.generationId,correlationId:second.correlationId,
    sourceRevisionId:second.sourceRevisionId,narrative:second.content,hostEvent:second,parentWorkId:'generation:'+second.generationId,
  });
  assert.equal(secondWork.status,'SKIPPED','provider capacity must remain truthful until the cancelled physical call actually exits');
  assert.match(secondWork.executionReceipt.reasonCode,/SCENE_OBSERVATION_/);
  assert.ok(brain.readSceneObservationReceipts({limit:128}).some(row=>row.status==='CANCELLED'&&row.workId===firstWork.executionReceipt.workId&&row.reasonCode==='SCENE_OBSERVATION_SUPERSEDED'));

  firstGate.resolve(VALID_PAYLOAD);secondGate.resolve({fields:{activeThreads:{value:['second-note'],confidence:.9,observationClass:'OBSERVED'}},boundarySignals:{}});
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(brain.readSceneObservationReceipts({limit:128}).some(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.workId===firstWork.executionReceipt.workId&&row.status==='ADMITTED'),false);
  assert.equal(brain.readSceneObservationReceipts({limit:128}).some(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.workId===secondWork.executionReceipt.workId&&row.status==='ADMITTED'),false);
});

test('chat change cancels foreign in-flight Scene work before it can mutate the new active chat',async()=>{
  const brain=new DevelopmentDeploymentBrain(),gate=deferred();
  await connectScene(brain,()=>gate.promise,{id:'scene:foreign'});
  const a=sceneEvent(brain,{chatId:'chat:a',messageId:'m1',turnId:'turn:a',generationId:'gen:a'});
  brain.ingestSceneHostEvent(a,{extract:()=>({})});
  const work=await brain.runSceneObservationWork({
    chatId:a.chatId,turnId:a.turnId,generationId:a.generationId,correlationId:a.correlationId,
    sourceRevisionId:a.sourceRevisionId,narrative:a.content,hostEvent:a,parentWorkId:'generation:'+a.generationId,
  });
  await waitFor(()=>brain.resourceConnections.taskControllers.has(work.executionReceipt.workId));
  const b=sceneEvent(brain,{chatId:'chat:b',messageId:'m1',turnId:'turn:b',generationId:'gen:b',content:'Ren waits quietly.'});
  brain.ingestSceneHostEvent(b,{extract:()=>({})});
  assert.ok(brain.readSceneObservationReceipts({limit:128}).some(row=>row.status==='CANCELLED'&&row.workId===work.executionReceipt.workId&&row.reasonCode==='SCENE_OBSERVATION_CHAT_SUPERSEDED'));
  gate.resolve(VALID_PAYLOAD);await new Promise(resolve=>setTimeout(resolve,40));
  assert.notEqual(brain.scene.integrationSignal('chat:b').location?.location,'Greyharbor Observatory');
  assert.equal(brain.readSceneObservationReceipts({limit:128}).some(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.workId===work.executionReceipt.workId&&row.status==='ADMITTED'),false);
});

test('provider/network failure is retained as physical execution failure and never fabricated as owner rejection or acceptance',async()=>{
  const brain=new DevelopmentDeploymentBrain();
  await connectScene(brain,()=>{const error=new Error('provider unavailable');error.code='PROVIDER_UNAVAILABLE';throw error;},{id:'scene:failure'});
  const event=sceneEvent(brain,{chatId:'chat:failure',turnId:'turn:failure',generationId:'gen:failure'});
  brain.ingestSceneHostEvent(event,{extract:()=>({})});
  const work=await brain.runSceneObservationWork({
    chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,correlationId:event.correlationId,
    sourceRevisionId:event.sourceRevisionId,narrative:event.content,hostEvent:event,parentWorkId:'generation:'+event.generationId,
  });
  const failed=await waitFor(()=>brain.readSceneObservationReceipts({limit:128}).find(row=>row.status==='FAILED'&&row.workId===work.executionReceipt.workId));
  assert.equal(failed.reasonCode,'PROVIDER_UNAVAILABLE');
  assert.equal(failed.returned,false);
  assert.equal(brain.readSceneObservationReceipts({limit:128}).some(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.workId===work.executionReceipt.workId),false);
});


test('configured HTTP Sidecar JSON observation reaches the actual Scene owner',async()=>{
  const brain=new DevelopmentDeploymentBrain();let request=null;
  brain.resourceConnections.fetchImpl=async(url,init)=>{
    if(String(url).endsWith('/models'))return{ok:true,status:200,json:async()=>({data:[{id:'fixture-json'}]})};
    request=JSON.parse(init.body);
    return{ok:true,status:200,headers:{get:()=>null},json:async()=>({model:'fixture-json',choices:[{message:{content:JSON.stringify(VALID_PAYLOAD)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:80,total_tokens:180}})};
  };
  brain.optionalResources.actions.addResource({resourceId:'scene:http',kind:'OPENAI_COMPATIBLE',endpoint:'https://fixture.invalid',modelId:'fixture-json',apiKey:'fixture',capabilities:['STRUCTURED_EXTRACTION']});
  await brain.optionalResources.actions.connectResource('scene:http');
  const event=sceneEvent(brain,{chatId:'chat:http',content:'Mira studies the courier note at Greyharbor Observatory.'});
  brain.ingestSceneHostEvent(event,{extract:()=>({})});
  const work=await brain.runSceneObservationWork({chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,correlationId:event.correlationId,sourceRevisionId:event.sourceRevisionId,narrative:event.content,hostEvent:event});
  await waitFor(()=>brain.readSceneObservationReceipts({limit:128}).some(row=>row.kind==='DeploymentSceneObservationOwnerReceipt'&&row.workId===work.executionReceipt.workId&&row.status==='ADMITTED'));
  assert.deepEqual(request.response_format,{type:'json_object'});
  assert.match(request.messages[0].content,/observationClass/);
  const scene=brain.scene.registry.current(brain.scene.integrationSignal(event.chatId).sceneId);
  assert.equal(scene.fields.location.value.location,'Greyharbor Observatory');
  assert.ok(scene.fields.activeThreads.value.includes('courier-note'));
});

test('generation completion wakes Scene work blocked by the foreground reserve',async()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1});let calls=0;
  await connectScene(brain,()=>{calls++;return VALID_PAYLOAD;},{id:'scene:resume'});
  const event=sceneEvent(brain,{chatId:'chat:resume',turnId:'turn:resume',generationId:'gen:resume'});
  brain.ingestSceneHostEvent(event,{extract:()=>({})});
  const bindings=brain.hostBindings();
  bindings.beginOptionalResourceGeneration(event);
  const work=await brain.runSceneObservationWork({...event,narrative:event.content,phase:'POST_RESPONSE'});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(brain.resourceDirector.ledger.get(work.executionReceipt.workId).executionStatus,'BLOCKED');
  assert.equal(calls,0);
  bindings.completeOptionalResourceGeneration(event);
  await waitFor(()=>calls===1,{timeout:250});
  await waitFor(()=>brain.readSceneObservationReceipts({limit:128}).some(row=>row.workId===work.executionReceipt.workId&&row.status==='ADMITTED'));
  assert.equal(calls,1);
});

test('owner-admitted Scene cast supplies Graph Walker anchors on the next turn',async()=>{
  const brain=new DevelopmentDeploymentBrain();
  await connectScene(brain,()=>({fields:{activeCast:{value:[{characterId:'entity:mira',state:'PRESENT'}],confidence:.98,observationClass:'OBSERVED'}},boundarySignals:{}}),{id:'scene:anchors'});
  const event=sceneEvent(brain,{chatId:'chat:anchors',turnId:'turn:anchors',generationId:'gen:anchors'});
  brain.ingestSceneHostEvent(event,{extract:()=>({})});
  const work=await brain.runSceneObservationWork({...event,narrative:event.content});
  await waitFor(()=>brain.readSceneObservationReceipts({limit:128}).some(row=>row.workId===work.executionReceipt.workId&&row.status==='ADMITTED'));
  const nativeBrain=new Area52NativeBrain();
  const prepared=await nativeBrain.prepareTurn({chatId:event.chatId,turnId:'turn:anchors:next',generationId:'gen:anchors:next',query:'What is Mira doing?',sceneSignal:brain.scene.integrationSignal(event.chatId)});
  const graph=nativeBrain.uiBindings().readGraphTraversal(prepared.selection);
  assert.ok(graph.anchorEntityIds.includes('entity:mira'));
  assert.notEqual(graph.noWorkReason,'NO_ENTITY_ANCHORS');
});
