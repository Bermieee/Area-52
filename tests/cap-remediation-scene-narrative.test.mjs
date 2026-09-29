// Cap remediation, cap ledger row 28 (owner handoff "Scene Observation"). A long reply used to be cut to its first 6,000
// characters before the Scene Sidecar call, so the ending (where the scene changes) was never observed. Contract: one
// call per observation, input within the same 6,000-character window, the reply's opening plus its whole ending, and the
// task records the coverage truthfully (complete only when the whole reply was read).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {HostActivity} from '../src/scene/lifecycle-contracts.js';
import {boundSceneNarrative,SCENE_NARRATIVE_WINDOW,buildSceneObservationInput,createSceneObservationTask} from '../src/coprocessor/scene-observation-specialist.js';

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

async function observe(narrative,id){
  const brain=new DevelopmentDeploymentBrain(),seen=[];
  await connectScene(brain,(...args)=>{seen.push(args);return VALID_PAYLOAD;},{id:'scene:'+id});
  const event=sceneEvent(brain,{chatId:'chat:'+id,messageId:'a1',turnId:'turn:'+id,generationId:'gen:'+id,content:narrative,activity:HostActivity.ASSISTANT_GENERATION_COMPLETE});
  brain.ingestSceneHostEvent(event,{extract:()=>({})});
  const work=await brain.runSceneObservationWork({chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,correlationId:event.correlationId,
    sourceRevisionId:event.sourceRevisionId,narrative,phase:'FOREGROUND_USER',hostEvent:event});
  await waitFor(()=>seen.length>0);
  return{brain,work,seen};
}
const ending=' At last Mira left the observatory and stepped onto the Lantern Bridge.';
const filler=(n)=>'The courier waited while the rain went on over the harbor. '.repeat(Math.ceil(n/60)).slice(0,n);

for(const n of [SCENE_NARRATIVE_WINDOW.characters-1,SCENE_NARRATIVE_WINDOW.characters,SCENE_NARRATIVE_WINDOW.characters+1,2*SCENE_NARRATIVE_WINDOW.characters,40000]){
  test(`a ${n}-character reply: one Scene call, within the window, ending observed, coverage truthful`,async()=>{
    const narrative=(filler(n)+ending).slice(-n).trim();
    const bounded=boundSceneNarrative(narrative);
    assert.ok(bounded.text.length<=SCENE_NARRATIVE_WINDOW.characters);
    assert.ok(bounded.text.endsWith(narrative.slice(-ending.trim().length)),'the ending is in the observed text');
    assert.equal(bounded.coverage.complete,narrative.length<=SCENE_NARRATIVE_WINDOW.characters);
    if(!bounded.coverage.complete){
      assert.equal(bounded.coverage.observedCharacters+(bounded.coverage.omittedRange[1]-bounded.coverage.omittedRange[0]),narrative.length,'observed + omitted = whole reply');
      assert.ok(bounded.text.startsWith(narrative.slice(0,SCENE_NARRATIVE_WINDOW.head)),'the opening is kept');
    }else assert.equal(bounded.text,narrative,'a reply within the window is sent unchanged');
    const {seen}=await observe(narrative,'n'+n);
    assert.equal(seen.length,1,'exactly one provider call');
    const sent=JSON.stringify(seen[0]);
    assert.ok(sent.includes('Lantern Bridge'),'the Sidecar saw the ending');
  });
}

test('the task records narrative coverage against the whole reply',()=>{
  const narrative=filler(15000)+ending;
  const input=buildSceneObservationInput({metadata:{phase:'FOREGROUND_USER'},sceneRevision:1},{narrative,sceneId:'s',baseRevision:1,evidenceRef:'e',sourceRevisionId:'r'});
  assert.ok(input.data.narrative.length<=SCENE_NARRATIVE_WINDOW.characters);
  assert.ok(input.data.narrative.includes('Lantern Bridge'));
  assert.equal(boundSceneNarrative(input.data.narrative).coverage.complete,true,'bounding is idempotent');
});

test('createSceneObservationTask records coverage of the whole reply in its metadata',()=>{
  const narrative=filler(15000)+ending;
  const task=createSceneObservationTask({chatId:'c',turnId:'t',generationId:'g',correlationId:'x',sourceRevisionId:'r',sceneRevision:1,narrative});
  assert.equal(task.metadata.narrativeCoverage.complete,false);
  assert.equal(task.metadata.narrativeCoverage.sourceCharacters,narrative.trim().length);
  assert.equal(createSceneObservationTask({chatId:'c',turnId:'t',generationId:'g',correlationId:'x',sourceRevisionId:'r',sceneRevision:1,narrative:'short'}).metadata.narrativeCoverage.complete,true);
});
