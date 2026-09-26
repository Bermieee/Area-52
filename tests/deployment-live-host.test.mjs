import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyDevelopmentDeploymentTurn,
  createDevelopmentDeploymentSillyTavernSession,
  extractDevelopmentDeploymentScene,
} from '../src/deployment/sillytavern-live.js';
import { Area52NativeBrain } from '../src/native-brain.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

class DeploymentHostNode extends FakeNode{
  constructor(tag,doc){super(tag,doc);this.id='';this.value='';}
  setAttribute(name,value){super.setAttribute(name,value);if(name==='id')this.id=String(value);if(name==='value')this.value=String(value);}
  getAttribute(name){return this.attributes?.[name]??null;}
  get nextSibling(){const rows=this.parentNode?.children??[],i=rows.indexOf(this);return i>=0?rows[i+1]??null:null;}
  insertBefore(node,before){const i=this.children.indexOf(before);if(i<0){this.append(node);return node;}this.children.splice(i,0,node);node.parentNode=this;return node;}
  remove(){const p=this.parentNode;if(!p)return;const i=p.children.indexOf(this);if(i>=0)p.children.splice(i,1);this.parentNode=null;}
}
class DeploymentHostDocument extends FakeDocument{
  constructor(){super();this.body=new DeploymentHostNode('body',this);this.documentElement=new DeploymentHostNode('html',this);this.documentElement.append(this.body);}
  createElement(tag){return new DeploymentHostNode(tag,this);}
  createDocumentFragment(){return new DeploymentHostNode('fragment',this);}
  querySelector(selector){if(selector?.startsWith('#'))return this.getElementById(selector.slice(1));if(selector==='[data-area52-ui-host]')return walkDeployment(this.body).find(x=>x.attributes?.['data-area52-ui-host']!=null)??null;return null;}
  getElementById(id){return walkDeployment(this.body).find(x=>x.id===id||x.attributes?.id===id)??null;}
}
const walkDeployment=node=>[node,...(node?.children??[]).flatMap(walkDeployment)];
function deploymentDocument(){const document=new DeploymentHostDocument(),sheld=document.createElement('div'),chat=document.createElement('div'),form=document.createElement('div');sheld.id='sheld';chat.id='chat';form.id='form_sheld';sheld.append(chat,form);document.body.append(sheld);return document;}

function makeHost({connectionProfile=null,activeOpenRouter=false}={}) {
  const listeners = new Map();
  const promptCalls = [];
  const connectionRequests=[],chatCompletionRequests=[];
  const context = {
    chatId: 'chat:observatory',
    chat: [],
    eventTypes: { GENERATION_AFTER_COMMANDS: 'generation_after_commands', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED:'message_edited', MESSAGE_DELETED:'message_deleted', MESSAGE_UPDATED:'message_updated', MESSAGE_SWIPED:'message_swiped', MESSAGE_SWIPE_DELETED:'message_swipe_deleted', CHAT_CHANGED:'chat_id_changed', CHAT_LOADED:'chatLoaded', CHAT_CREATED:'chat_created', CHAT_RENAMED:'chat_renamed', WORLDINFO_UPDATED:'worldinfo_updated', WORLDINFO_SETTINGS_UPDATED:'worldinfo_settings_updated', GENERATION_STARTED:'generation_started', GENERATION_ENDED:'generation_ended', GENERATION_STOPPED: 'generation_stopped' },
    eventSource: {
      on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeListener(type, fn) { listeners.get(type)?.delete(fn); },
    },
    async setExtensionPrompt(...args) { promptCalls.push(args); },
  };
  if(activeOpenRouter){
    context.ChatCompletionService={
      async processRequest(data,options,extractData,signal){
        chatCompletionRequests.push({source:data?.chat_completion_source,model:data?.model,maxTokens:data?.max_tokens,temperature:data?.temperature,roles:Array.isArray(data?.messages)?data.messages.map(row=>row.role):[]});
        return{content:'OK'};
      },
    };
  }
  if(connectionProfile){
    context.extensionSettings={disabledExtensions:[],connectionManager:{profiles:[connectionProfile],selectedProfile:connectionProfile.id}};
    context.ConnectionManagerRequestService={
      getSupportedProfiles:()=>[connectionProfile],
      getProfile:(id)=>id===connectionProfile.id?connectionProfile:null,
      async sendRequest(profileId,prompt,maxTokens,custom,overridePayload){
        connectionRequests.push({profileId,maxTokens,stream:custom?.stream,extractData:custom?.extractData,model:overridePayload?.model,temperature:overridePayload?.temperature,promptRoles:Array.isArray(prompt)?prompt.map(row=>row.role):[]});
        return{content:'OK'};
      },
    };
  }
  return { sillyTavern: { getContext: () => context }, context, promptCalls, listeners, connectionRequests, chatCompletionRequests };
}

function operatorLore() {
  return {
    id: 'operator-unrelated-worlds',
    title: 'Operator Unrelated Worlds',
    discovery: { kind: 'DeploymentLiveFixture', stableId: 'operator-unrelated-worlds', exactAuthoredSource: true },
    entries: [
      { uid: 'observatory', content: 'The Moonlit Observatory is maintained by Ilya.', metadata: { title: 'Moonlit Observatory', at: 1, treePath: ['Places', 'Observatory'] } },
      { uid: 'compass-a', content: 'The Glass Compass was stored inside the Moonlit Observatory.', metadata: { title: 'Glass Compass Storage', at: 2, treePath: ['Objects', 'Glass Compass'] } },
      { uid: 'compass-b', content: 'A damaged log claims the Glass Compass was shattered during the storm.', metadata: { title: 'Glass Compass Report A', at: 3, treePath: ['Reports', 'Compass'] } },
      { uid: 'harbor', content: 'The Harbor Archive keeps navigation records for Tidewatch.', metadata: { title: 'Harbor Archive', at: 4, treePath: ['Places', 'Harbor'] } },
      { uid: 'ledger-a', content: 'The Tide Ledger was sealed in the Harbor Archive.', metadata: { title: 'Tide Ledger Report A', at: 5, treePath: ['Objects', 'Tide Ledger'] } },
      { uid: 'ledger-b', content: 'A witness report claims the Tide Ledger was removed before the flood.', metadata: { title: 'Tide Ledger Report B', at: 6, treePath: ['Reports', 'Ledger'] } },
    ],
  };
}

function pushUser(context, mes) {
  context.chat.push({ is_user: true, mes, send_date: Date.now() });
}

function pushAssistant(context, mes) {
  context.chat.push({ is_user: false, mes, send_date: Date.now() });
  return context.chat.length - 1;
}

function fakeNativeBrain(){
  const calls={prepare:[],complete:[],subscriptions:0};
  const listeners=new Set();
  return{
    calls,
    async prepareTurn(input){
      calls.prepare.push(structuredClone(input));
      const selection={chatId:input.chatId,turnId:input.turnId,generationId:input.generationId,correlationId:'corr:'+input.turnId,worldRevision:9,sceneRevision:input.sceneSignal?.sceneRevision??1,sourceRevisionRefs:[...(input.sceneSignal?.sourceRevisionRefs??[])]};
      const prepared={
        kind:'NativeBrainPreparedTurn',selection,
        promptPlan:{promptPlanId:'native-plan:'+input.turnId,generationId:input.generationId,contextSealId:'native-seal:'+input.turnId,sections:[
          {slot:'CURRENT_WORLD_STATE',representation:'RICH',text:'The sealed owner state says the harbor lantern is lit.'},
          {slot:'USER_INPUT',representation:'RICH',text:input.query},
        ]},
        contextSealReceipt:{id:'native-seal:'+input.turnId,sealedState:true},
        rendered:{kind:'RenderedModelInput',format:'messages',messages:[
          {role:'system',content:'[CURRENT_WORLD_STATE]\nThe sealed owner state says the harbor lantern is lit.'},
          {role:'user',content:'[USER_INPUT]\n'+input.query},
        ]},
      };
      for(const fn of listeners)fn({kind:'NativeBrainReceiptUpdate',stage:'TURN_PREPARED',selection,rawPromptIncluded:false,rawResponseIncluded:false});
      return prepared;
    },
    async completeTurn(input){
      calls.complete.push(structuredClone(input));
      const receipt={kind:'NativeBrainLearningReceipt',turnId:input.turnId,sourceRevisionId:'narrative:'+input.turnId+'@r1',rawExperienceRecoverable:true,settlements:[]};
      for(const fn of listeners)fn({kind:'NativeBrainReceiptUpdate',stage:'TURN_LEARNED',selection:{turnId:input.turnId},rawPromptIncluded:false,rawResponseIncluded:false});
      return receipt;
    },
    async runTurn(input,{generate,completeOptions={}}={}){
      const prepared=await this.prepareTurn(input);
      const response=await generate(prepared.rendered,{selection:prepared.selection,promptPlan:prepared.promptPlan,contextSealReceipt:prepared.contextSealReceipt});
      const learning=await this.completeTurn({turnId:input.turnId,response,...completeOptions});
      return{prepared,response,learning};
    },
    snapshot(){return{kind:'FakeNativeBrainSnapshot',turns:calls.complete.length};},
    uiBindings(){
      const empty=()=>null;
      return{
        subscribe(fn){listeners.add(fn);calls.subscriptions+=1;return()=>listeners.delete(fn);},
        readSelection:()=>({}),readScene:empty,readHotCognition:empty,readCognitiveChoice:empty,readScatter:empty,readSensoryTrace:empty,readCandidateBusEnvelope:empty,readCandidateFusionReceipt:empty,
        readIdentityResolution:empty,readGraphTraversal:empty,readRetrievalBudget:empty,readRejectedEvidence:empty,readTruth:empty,readCorrectiveRetrieval:empty,readJev:empty,readPrecision:empty,readGather:empty,readContextSeal:empty,
        readLoreStatus:empty,readMemoryStatus:empty,readRuntimeStatus:()=>({lifecycle:[],queueDepth:{},resources:{},workers:{},dependencies:{},eventTypes:[],telemetry:{retainedSignals:0,sinkFailures:0,latestSequence:0}}),
        readPromptPlan:empty,readContextReceipt:empty,listGenerations:()=>[],readGeneration:empty,
      };
    },
  };
}

test('live adapter source contains no Ember fixture names or fixed-scenario rejection', () => {
  const source = readFileSync(new URL('../src/deployment/sillytavern-live.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Ember Tavern|Sun Blade|\bMara\b|\bEris\b/);
  assert.doesNotMatch(source, /first live demo turn must/i);
});

test('classifier and scene extraction are story-independent', () => {
  assert.equal(classifyDevelopmentDeploymentTurn('Where are we?'), 'simple');
  assert.equal(classifyDevelopmentDeploymentTurn('Tell me about the Glass Compass history.'), 'retrieval');
  assert.equal(classifyDevelopmentDeploymentTurn('The reports conflict. Which account is current?'), 'ambiguous');

  const parsed = extractDevelopmentDeploymentScene(
    'At Moonlit Observatory, the storm shutters are closed.',
    { revision: 2, evidenceRef: 'source:host@1' },
  );
  assert.equal(parsed.explicit, true);
  assert.equal(parsed.fields.location.value.location, 'Moonlit Observatory');
  assert.equal(parsed.extractionPolicy, 'GENERIC_HOST_EVIDENCE_ONLY');

  const unknown = extractDevelopmentDeploymentScene(
    'I examine the sealed letter without saying where I am.',
    { revision: 1, evidenceRef: 'source:host@2' },
  );
  assert.equal(unknown.explicit, false);
  assert.deepEqual(unknown.fields, {});
});

test('first ordinary turn initializes a Scene without inventing a location', async () => {
  const { sillyTavern, context } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({ sillyTavern, document: null, mountUi: false });
  pushUser(context, 'I examine the sealed letter on the desk. Where are we?');
  const row = await session.processCurrentTurn();
  assert.equal(row.mode, 'simple');
  assert.equal(row.scene.initializedFromHostMessage, true);
  assert.equal(row.scene.observedFromHostMessage, false);
  assert.equal(row.scene.reason, 'SCENE_INITIALIZED_WITH_UNKNOWN_FIELDS');
  assert.ok(row.scene.sceneId);
  assert.equal(row.delivery.ok, true);
  assert.equal(row.delivery.promptInjection.succeeded, true);
  session.destroy();
});

test('armed session processes MESSAGE_SENT and records operator-visible failures', async () => {
  const { sillyTavern, context, listeners } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({ sillyTavern, document: null, mountUi: false });
  session.start();
  assert.equal(listeners.get('message_sent')?.size, 1);
  assert.equal(listeners.get('generation_after_commands')?.size ?? 0, 0);
  pushUser(context, 'At Moonlit Observatory, where are we?');
  await Promise.all([...listeners.get('message_sent')].map(fn => fn()));
  const evidence = session.exportEvidence();
  assert.equal(evidence.checks.anyReadyTurn, true);
  assert.equal(evidence.checks.twoUnrelatedStories, false);
  assert.equal(evidence.modeCoverage.simple, true);
  context.chatId = null;
  await assert.rejects(session.processCurrentTurn(), /chatId is unavailable/);
  assert.match(session.exportEvidence().errors.at(-1).message, /chatId is unavailable/);
  session.destroy();
});

test('Primary Jev automatically uses SillyTavern active OpenRouter secret when no Connection Manager profile is configured',async()=>{
  const{sillyTavern,chatCompletionRequests}=makeHost({activeOpenRouter:true}),document=deploymentDocument();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document,mountUi:true});
  const ui=session.uiHost.ui;
  assert.deepEqual(ui.operator.resources.connectionProfiles(),[]);

  const connected=await ui.actionRouter.route({type:'wave13.resource.connect',payload:{
    role:'JEV',displayName:'Primary Jev',endpoint:'https://openrouter.ai/api/v1',modelId:'provider/jev-model',
    capabilities:['SEMANTIC_JUDGMENT'],local:false,
  }});
  assert.equal(connected.ok,true);
  const row=ui.operator.resources.read().data.resources.find(item=>item.kind==='JEV');
  assert.ok(row);assert.equal(row.callable,true);assert.equal(row.selectedModelQualified,true);
  assert.equal(row.reasonCode,'HEALTH_CHECK_PASSED');assert.notEqual(row.reasonCode,'CREDENTIAL_REQUIRED');
  assert.equal(row.credentialManagedByHost,true);assert.equal(row.hostCredentialSource,'SILLYTAVERN_ACTIVE_SECRET');
  assert.equal(row.connectionProfileId,null);assert.equal(row.connectionProfileName,'SillyTavern active OpenRouter secret');
  assert.equal(row.credentialConfigured,false);
  assert.ok(chatCompletionRequests.length>=1);assert.equal(chatCompletionRequests[0].source,'openrouter');assert.equal(chatCompletionRequests[0].model,'provider/jev-model');

  const saved=ui.operator.resources.savedProfiles().find(item=>item.role==='JEV');
  assert.equal(saved.credentialManagedByHost,true);assert.equal(saved.connectionProfileId,null);
  assert.doesNotMatch(JSON.stringify({row,saved,requests:chatCompletionRequests}),/apiKey|secret[_-]?id|credential.*value/i);
  session.destroy();
});

test('live Jev can qualify through a SillyTavern Connection Manager profile without exposing its secret',async()=>{
  const profile={id:'st-openrouter-jev',name:'OpenRouter Jev',api:'openrouter',model:'provider/jev-model','api-url':'https://openrouter.ai/api/v1','secret-id':'server-secret-reference'};
  const{sillyTavern,connectionRequests}=makeHost({connectionProfile:profile}),document=deploymentDocument();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document,mountUi:true});
  const ui=session.uiHost.ui;
  assert.deepEqual(ui.operator.resources.connectionProfiles().map(row=>({id:row.id,name:row.name,model:row.model})),[{id:'st-openrouter-jev',name:'OpenRouter Jev',model:'provider/jev-model'}]);

  const connected=await ui.actionRouter.route({type:'wave13.resource.connect',payload:{
    role:'JEV',displayName:'Primary Jev',endpoint:'https://openrouter.ai/api/v1',modelId:'provider/jev-model',
    capabilities:['SEMANTIC_JUDGMENT'],connectionProfileId:'st-openrouter-jev',connectionProfileName:'OpenRouter Jev',local:false,
  }});
  assert.equal(connected.ok,true);
  const row=ui.operator.resources.read().data.resources.find(item=>item.kind==='JEV');
  assert.ok(row);assert.equal(row.callable,true);assert.equal(row.selectedModelQualified,true);
  assert.equal(row.reasonCode,'HEALTH_CHECK_PASSED');assert.notEqual(row.reasonCode,'CREDENTIAL_REQUIRED');
  assert.equal(row.credentialManagedByHost,true);assert.equal(row.hostCredentialSource,'SILLYTAVERN_CONNECTION_MANAGER');
  assert.equal(row.connectionProfileId,'st-openrouter-jev');assert.equal(row.connectionProfileName,'OpenRouter Jev');
  assert.equal(row.credentialConfigured,false,'Area-52 must not pretend the host-owned secret is stored in Worker 2');
  assert.ok(connectionRequests.length>=1);assert.equal(connectionRequests[0].profileId,'st-openrouter-jev');assert.equal(connectionRequests[0].model,'provider/jev-model');

  const saved=ui.operator.resources.savedProfiles().find(item=>item.role==='JEV');
  assert.equal(saved.connectionProfileId,'st-openrouter-jev');assert.equal(saved.credentialManagedByHost,true);
  const publicEvidence=JSON.stringify({row,saved,profiles:ui.operator.resources.connectionProfiles(),requests:connectionRequests});
  assert.doesNotMatch(publicEvidence,/server-secret-reference/);assert.doesNotMatch(publicEvidence,/"secret-id"|"apiKey"/i);
  session.destroy();
});

test('real native Brain host event publishes Scene and sealed Context Delivery for the same chat and turn with zero optional resources',async()=>{
  const {sillyTavern,context,listeners}=makeHost();
  const nativeBrain=new Area52NativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});
  session.start();

  assert.equal(session.running,true);
  assert.equal(session.brain.listOptionalResources().resources.length,0,'native turn path must not require Jev, Sidecar, or Vectoring');

  pushUser(context,'At Moonlit Observatory, I inspect the sealed compass beside the lantern.');
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));

  const ui=nativeBrain.uiBindings();
  const selection=ui.readSelection({chatId:context.chatId});
  assert.equal(selection.chatId,'chat:observatory');
  assert.ok(selection.turnId);
  assert.ok(selection.generationId);

  const scene=ui.readScene(selection);
  const generation=ui.readGeneration({generationId:selection.generationId,...selection});
  const promptPlan=ui.readPromptPlan(selection);
  const contextSeal=ui.readContextSeal(selection);
  const runtime=ui.readRuntimeStatus();

  assert.ok(scene?.sceneId,'Scene owner receipt must exist for the host turn');
  assert.equal(scene.sceneId,selection.sceneId);
  assert.ok(generation,'Generation read model must exist for the selected host turn');
  assert.equal(generation.chatId,selection.chatId);
  assert.equal(generation.turnId,selection.turnId);
  assert.equal(generation.generationId,selection.generationId);
  assert.ok(generation.promptPlan,'Context Delivery PromptPlan must be published before provider response');
  assert.ok(generation.contextSeal?.sealedState,'Context Seal must be sealed before provider response');
  assert.equal(generation.promptPlan.turnId,selection.turnId);
  assert.equal(generation.promptPlan.generationId,selection.generationId);
  assert.equal(promptPlan.turnId,selection.turnId);
  assert.equal(promptPlan.generationId,selection.generationId);
  assert.equal(contextSeal.turnId,selection.turnId);
  assert.ok(runtime,'Runtime owner snapshot must be readable for the same native path');

  const actualRequest={chat:[
    {role:'system',content:'SillyTavern host policy'},
    {role:'user',content:'At Moonlit Observatory, I inspect the sealed compass beside the lantern.'},
  ],dryRun:false};
  await Promise.all([...listeners.get('chat_completion_prompt_ready')].map(fn=>fn(actualRequest)));

  const assistantIndex=pushAssistant(context,'The lantern reflects from the sealed compass while the observatory remains quiet.');
  await Promise.all([...listeners.get('message_received')].map(fn=>fn(assistantIndex)));

  const learned=ui.readGeneration({generationId:selection.generationId,...selection});
  assert.equal(learned.state,'LEARNED');
  assert.equal(learned.learningReceipt?.kind,'NativeBrainLearningReceipt');
  assert.equal(learned.learningReceipt?.turnId,selection.turnId);
  assert.ok(learned.learningReceipt?.sourceRevisionId);

  const evidence=session.exportEvidence();
  assert.equal(evidence.nativeBrainIntegration.ownerAvailable,true);
  assert.ok(evidence.nativeBrainIntegration.learnedCount>=1);
  assert.equal(evidence.errors.some(row=>['NATIVE_PREPARE','NATIVE_MODEL_REQUEST','NATIVE_COMPLETE'].includes(row.stage)),false);

  session.stop();
});

test('native Brain host lifecycle seals before model request and learns completed assistant response',async()=>{
  const {sillyTavern,context,promptCalls,listeners}=makeHost(),nativeBrain=fakeNativeBrain(),persisted=[];
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain,persistNativeBrain:async row=>persisted.push({chatId:row.chatId,kind:row.snapshot.kind})});
  session.start();
  assert.equal(listeners.get('generation_after_commands')?.size,1);assert.equal(listeners.get('chat_completion_prompt_ready')?.size,1);assert.equal(listeners.get('message_received')?.size,1);assert.equal(listeners.get('message_sent')?.size,1);
  pushUser(context,'At Moonlit Observatory, tell me what the lantern shows.');
  await Promise.all([...listeners.get('message_sent')].map(fn=>fn()));
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));
  assert.equal(session.exportEvidence().hostNarrativeFeed.events.some(row=>row.type==='MESSAGE_SENT'&&row.chatId==='chat:observatory'),true);
  assert.equal(nativeBrain.calls.prepare.length,1);assert.equal(promptCalls.length,0);
  const actualRequest={chat:[{role:'system',content:'SillyTavern host policy'},{role:'user',content:'At Moonlit Observatory, tell me what the lantern shows.'}],dryRun:false};
  await Promise.all([...listeners.get('chat_completion_prompt_ready')].map(fn=>fn(actualRequest)));
  assert.deepEqual(actualRequest.chat.slice(1,3),[
    {role:'system',content:'[CURRENT_WORLD_STATE]\nThe sealed owner state says the harbor lantern is lit.'},
    {role:'user',content:'[USER_INPUT]\nAt Moonlit Observatory, tell me what the lantern shows.'},
  ]);
  assert.equal(session.exportEvidence().nativeBrainIntegration.exactPreparedRenderedObserved,true);
  assert.equal(session.exportEvidence().nativeBrainIntegration.pendingCount,1);
  const assistantIndex=pushAssistant(context,'The lantern throws a steady blue light across the observatory floor.');
  await Promise.all([...listeners.get('message_received')].map(fn=>fn(assistantIndex)));
  assert.equal(nativeBrain.calls.complete.length,1);assert.match(nativeBrain.calls.complete[0].response,/steady blue light/);
  const evidence=session.exportEvidence();
  assert.equal(evidence.nativeBrainIntegration.endToEndObserved,true);
  assert.equal(evidence.nativeBrainIntegration.pendingCount,0);
  assert.equal(evidence.nativeBrainIntegration.persistence.persistedCount,1);assert.deepEqual(persisted,[{chatId:'chat:observatory',kind:'FakeNativeBrainSnapshot'}]);
  assert.equal(evidence.nativeBrainIntegration.rawPromptCaptured,false);assert.equal(evidence.nativeBrainIntegration.rawResponseCaptured,false);
  assert.doesNotMatch(JSON.stringify(evidence.nativeBrainIntegration),/steady blue light|tell me what the lantern shows/i);
  session.destroy();
});

test('installed native host exposes provenance/runtime/memory readers through the UI binding seam',()=>{
  const {sillyTavern}=makeHost(),nativeBrain=fakeNativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});
  const native=session.exportEvidence().nativeBrainIntegration,names=native.installedUiReaderNames;
  for(const name of ['readIdentityResolution','readGraphTraversal','readRetrievalBudget','readRejectedEvidence','readLoreStatus','readMemoryStatus','readRuntimeStatus','readGeneration'])assert.ok(names.includes(name),name);
  assert.equal(names.includes('listResources'),true);assert.deepEqual(native.installedOptionalOwners,{resources:true,loreStudy:true,loreAuthoring:true,memory:true});
  session.destroy();
});

test('live narrative feed journals revision events without raw text and invalidates a pending native generation',async()=>{
  const {sillyTavern,context,listeners}=makeHost(),nativeBrain=fakeNativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});session.start();
  pushUser(context,'I inspect the sealed compass.');
  await [...listeners.get('generation_after_commands')][0]('normal',{},false);
  assert.equal(session.exportEvidence().nativeBrainIntegration.pendingCount,1);
  await [...listeners.get('message_edited')][0](0);
  await Promise.resolve();
  const evidence=session.exportEvidence();
  assert.equal(evidence.nativeBrainIntegration.pendingCount,0);assert.ok(evidence.nativeBrainIntegration.rejections.some(row=>row.code==='HOST_MESSAGE_EDITED_INVALIDATED_PENDING_GENERATION'));
  const event=evidence.hostNarrativeFeed.events.find(row=>row.type==='MESSAGE_EDITED');assert.ok(event);assert.equal(event.messageIndex,0);assert.equal(event.revisionAffecting,true);assert.equal(event.rawTextIncluded,false);assert.equal(event.rawPayloadIncluded,false);
  assert.equal(event.chatId,'chat:observatory');assert.equal(event.messageId,'0');assert.match(event.messageDigest,/^[0-9a-f]{8}$/);assert.match(event.messageRevisionId,/^0:[0-9a-f]{8}$/);assert.match(event.eventId,/^st-host:/);assert.ok(event.turnId);assert.ok(event.generationId);
  assert.equal(evidence.hostNarrativeFeed.rawTextCaptured,false);assert.doesNotMatch(JSON.stringify(evidence.hostNarrativeFeed),/sealed compass/i);
  session.destroy();
});

test('live narrative feed records generation boundaries without retaining host payloads',async()=>{
  const {sillyTavern,context,listeners}=makeHost(),nativeBrain=fakeNativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});session.start();
  pushUser(context,'At Moonlit Observatory, continue.');
  await [...listeners.get('generation_after_commands')][0]('continue',{},false);
  await [...listeners.get('generation_started')][0]({type:'continue',prompt:'must not retain'});
  await [...listeners.get('generation_ended')][0]({raw:'must not retain'});
  const rows=session.exportEvidence().hostNarrativeFeed.events.filter(row=>row.generationBoundary);
  assert.deepEqual(rows.map(row=>row.type),['GENERATION_STARTED','GENERATION_ENDED']);assert.ok(rows.every(row=>row.rawPayloadIncluded===false&&row.rawTextIncluded===false));
  assert.doesNotMatch(JSON.stringify(rows),/must not retain/);session.destroy();
});

test('native Brain completion rejects cross-chat response instead of learning into the wrong story',async()=>{
  const {sillyTavern,context,listeners}=makeHost(),nativeBrain=fakeNativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});session.start();
  pushUser(context,'At Moonlit Observatory, continue.');
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));
  const request={chat:[{role:'user',content:'At Moonlit Observatory, continue.'}],dryRun:false};
  await Promise.all([...listeners.get('chat_completion_prompt_ready')].map(fn=>fn(request)));
  context.chatId='chat:harbor';context.chat=[];const assistantIndex=pushAssistant(context,'A harbor reply appears in another story.');
  await Promise.all([...listeners.get('message_received')].map(fn=>fn(assistantIndex)));
  assert.equal(nativeBrain.calls.complete.length,0);
  const evidence=session.exportEvidence();
  assert.equal(evidence.nativeBrainIntegration.staleOrForeignCompletionRejected,1);assert.equal(evidence.nativeBrainIntegration.pendingCount,1);
  session.destroy();
});

test('operator lore records accepted, processed, and retrievable states separately', () => {
  const { sillyTavern } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({ sillyTavern, document: null, mountUi: false });
  const receipt = session.ingestLorebook(operatorLore());
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.processed, true);
  assert.equal(typeof receipt.retrievable, 'boolean');
  assert.equal(receipt.entryCount, 6);
  assert.equal(session.exportEvidence().loreIngestion.length, 1);
  session.destroy();
});

test('two unrelated chats run Scene -> retrieval/Truth -> optional Jev -> Gather -> Seal -> PromptPlan without fixed names', async () => {
  const { sillyTavern, context, promptCalls } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({
    sillyTavern,
    document: null,
    mountUi: false,
    initialLorebook: operatorLore(),
  });

  pushUser(context, 'At Moonlit Observatory, where are we?');
  const simple = await session.processCurrentTurn();
  assert.equal(simple.mode, 'simple');
  assert.equal(simple.runtime.jobCount, 0);
  assert.equal(simple.delivery.ok, true);

  pushUser(context, 'Tell me about the Glass Compass and the Moonlit Observatory history.');
  const retrieval = await session.processCurrentTurn();
  assert.equal(retrieval.mode, 'retrieval');
  assert.equal(retrieval.runtime.resourceCount, 1);
  assert.ok(retrieval.runtime.jobCount >= 2);
  assert.equal(retrieval.delivery.ok, true);

  context.chatId = 'chat:harbor';
  context.chat = [];
  pushUser(context, 'At Harbor Archive, conflicting reports disagree about the Tide Ledger. Which report is current?');
  const ambiguous = await session.processCurrentTurn();
  assert.equal(ambiguous.mode, 'ambiguous');
  assert.equal(ambiguous.scene.observedFromHostMessage, true);
  assert.ok(ambiguous.scene.changedFields.includes('location'));
  assert.ok(ambiguous.cognition.jev);
  assert.equal(ambiguous.cognition.jev.mutationAuthority, false);
  assert.equal(ambiguous.delivery.ok, true);

  const beforeReview = session.exportEvidence();
  assert.deepEqual(beforeReview.checks, {
    anyReadyTurn: true,
    twoUnrelatedStories: true,
    promptDeliveryObserved: true,
    sealedContextObserved: true,
    genericScenePolicyObserved: true,
  });
  assert.deepEqual(beforeReview.modeCoverage, { simple: true, retrieval: true, ambiguous: true });
  assert.equal(beforeReview.deterministicFixtureEvidence.acceptanceAuthority, false);
  assert.equal(beforeReview.deterministicFixtureEvidence.simulatedJevFailureSafe, true);
  assert.equal(beforeReview.degraded.evidenceClass, 'SIMULATED_FAILURE_PROBE');
  assert.equal(beforeReview.degraded.safe, true);
  assert.equal(beforeReview.twoStoryCoverage, true);
  assert.deepEqual(beforeReview.storyChatIds, ['chat:harbor', 'chat:observatory']);
  assert.equal(beforeReview.providerEvidence.jev, 'DETERMINISTIC_LOCAL_FIXTURE');
  assert.equal(beforeReview.providerEvidence.realProviderCallObserved, false);
  assert.equal(beforeReview.providerEvidence.ft005LivePass, false);
  assert.equal(beforeReview.liveEvidenceComplete, false);
  assert.equal(beforeReview.issue224AutomaticPass, false);
  assert.equal(promptCalls.length, 3);

  const afterReview = session.confirmOperatorReview({
    promptInspectorConfirmed: true,
    uiTraceReviewed: true,
    liveSillyTavernConfirmed: true,
  });
  assert.equal(afterReview.operatorReview.liveSillyTavernConfirmed, true);
  assert.equal(afterReview.liveEvidenceComplete, false);
  assert.equal(afterReview.issue224AutomaticPass, false);
  assert.equal(afterReview.directorApprovalRequired, true);
  session.destroy();
});


test('two unrelated live stories satisfy the live gate without scripted mode coverage', async () => {
  const { sillyTavern, context } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({
    sillyTavern,
    document: null,
    mountUi: false,
    initialLorebook: operatorLore(),
  });

  pushUser(context, 'At Moonlit Observatory, I study the Glass Compass on the central table.');
  const first = await session.processCurrentTurn();
  assert.equal(first.mode, 'retrieval');

  context.chatId = 'chat:harbor';
  context.chat = [];
  pushUser(context, 'At Harbor Archive, I inspect the Tide Ledger beside the flood records.');
  const second = await session.processCurrentTurn();
  assert.equal(second.mode, 'retrieval');

  const evidence = session.exportEvidence();
  assert.deepEqual(evidence.modeCoverage, { simple: false, retrieval: true, ambiguous: false });
  assert.deepEqual(evidence.checks, {
    anyReadyTurn: true,
    twoUnrelatedStories: true,
    promptDeliveryObserved: true,
    sealedContextObserved: true,
    genericScenePolicyObserved: true,
  });
  assert.equal(evidence.status, 'OPERATOR_CONFIRMATION_PENDING');
  assert.equal(evidence.deterministicFixtureEvidence.acceptanceAuthority, false);
  assert.equal(evidence.issue224AutomaticPass, false);
  assert.equal(evidence.liveEvidenceComplete, false);
  session.destroy();
});
