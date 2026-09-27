import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextDeliveryEngine } from '../src/adaptive-context-runtime.js';
import { GenerationContextSeal } from '../src/context-seal.js';
import { Area52NativeBrain } from '../src/native-brain.js';
import { createDevelopmentDeploymentSillyTavernSession } from '../src/deployment/sillytavern-live.js';

function sealedPacket(){
  const packet={
    kind:'GenerationContextPacket',id:'packet:delivery-completion',intent:'TEMPORAL',
    current:[{id:'fact:current',e:'gate',p:'state',v:'closed',a:'SETTLED',t:'CURRENT'}],
    historical:[{id:'fact:history',e:'gate',p:'state',v:'open',a:'OBSERVED',t:'HISTORICAL'}],
    unresolved:[{id:'fact:uncertain',e:'omen',p:'meaning',v:'disputed',a:'UNRESOLVED',t:'UNRESOLVED'}],
    relevantLore:[{id:'fact:rule',e:'gate',p:'exceptionRule',v:'closed during eclipse',a:'SOURCE_CANON',t:'CURRENT',hardRule:true,semantic:{predicate:'EXCEPTION_RULE'}}],
    episodicMemory:[],activeThreads:[],dependencies:['lore:r2','memory:r1','memory:r2'],
    provenanceIndex:{
      'fact:current':['lore:r2'],'fact:history':['memory:r1'],'fact:uncertain':['memory:r2'],'fact:rule':['lore:r2'],
    },
  };
  const seal=new GenerationContextSeal();
  return {packet, sealed:seal.seal({turnId:'turn:delivery',correlationId:'corr:delivery',packet,sourceRevisionIds:packet.dependencies,worldRevision:4,sceneRevision:7})};
}

function deliveryInput(){
  const {sealed}=sealedPacket();
  return {
    sealedPacket:sealed.packet,sealReceipt:sealed.receipt,generationId:'gen:delivery',turnId:'turn:delivery',
    budgetTokens:2048,userInput:'What is true now and what changed?',
  };
}

function scene(sceneId='scene:delivery',sceneRevision=1){
  return {sceneId,sceneRevision,location:'Neutral Hall',narrativeTime:'tick '+sceneRevision,activeCast:[],activeThreads:[],objects:[],sourceRevisionRefs:[],provenance:['worker1:delivery-completion-test']};
}

function makeHost(){
  const listeners=new Map();
  const context={
    chatId:'chat:delivery-host',chat:[],
    eventTypes:{
      GENERATION_AFTER_COMMANDS:'generation_after_commands',
      CHAT_COMPLETION_PROMPT_READY:'chat_completion_prompt_ready',
      MESSAGE_SENT:'message_sent',MESSAGE_RECEIVED:'message_received',
      MESSAGE_EDITED:'message_edited',MESSAGE_DELETED:'message_deleted',MESSAGE_UPDATED:'message_updated',
      MESSAGE_SWIPED:'message_swiped',MESSAGE_SWIPE_DELETED:'message_swipe_deleted',
      CHAT_CHANGED:'chat_changed',CHAT_LOADED:'chat_loaded',CHAT_CREATED:'chat_created',CHAT_RENAMED:'chat_renamed',
      WORLDINFO_UPDATED:'worldinfo_updated',WORLDINFO_SETTINGS_UPDATED:'worldinfo_settings_updated',
      GENERATION_STARTED:'generation_started',GENERATION_ENDED:'generation_ended',GENERATION_STOPPED:'generation_stopped',
    },
    eventSource:{
      on(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
      removeListener(type,fn){listeners.get(type)?.delete(fn);},
    },
    async setExtensionPrompt(){},
  };
  return {context,listeners,sillyTavern:{getContext:()=>context}};
}
function pushUser(context,text){context.chat.push({is_user:true,mes:text,send_date:Date.now()});return context.chat.length-1;}
function pushAssistant(context,text){context.chat.push({is_user:false,mes:text,send_date:Date.now()});return context.chat.length-1;}

test('DETERMINISTIC: delivery receipt separates planned, sealed/compiled, host-observed, and provider-response phases',()=>{
  const engine=new ContextDeliveryEngine();
  const result=engine.deliver({...deliveryInput(),providerId:'OpenRouter',modelId:'provider/model-a',routeId:'route:a'});
  assert.equal(result.ok,true);
  assert.equal(result.receipt.phases.planned.status,'PLANNED');
  assert.equal(result.receipt.phases.sealedCompiled.status,'SEALED_COMPILED');
  assert.equal(result.receipt.phases.hostRequest.status,'NOT_OBSERVED');
  assert.equal(result.receipt.phases.providerResponse.status,'NOT_RECEIVED');
  assert.equal(result.receipt.phases.sealedCompiled.contextSealId,result.plan.contextSealId);
  assert.equal(result.receipt.phases.sealedCompiled.semanticManifestIdentity,result.receipt.semanticManifestIdentity);
  assert.equal(result.receipt.rawPromptIncluded,false);
  assert.equal(result.receipt.storyTextIncluded,false);
});

test('DETERMINISTIC: provider-role rejection is explicit before any host request',()=>{
  const engine=new ContextDeliveryEngine();
  engine.slotRegistry.registerExtensionSlot('EXT_TOOL_ONLY',{owner:'DELIVERY_TEST',allowedSources:['GENERATION_ENVELOPE'],role:'tool',protected:false,semantic:false});
  const result=engine.deliver({...deliveryInput(),contributions:[{
    id:'tool-only',slot:'EXT_TOOL_ONLY',sourceCategory:'GENERATION_ENVELOPE',owner:'DELIVERY_TEST',
    semantic:false,semanticRefs:[],content:'tool payload',sourceRevisionIds:[],role:'tool',required:false,priority:1,metadata:{},
  }]});
  assert.equal(result.ok,false);
  assert.equal(result.failure?.code,'UNSUPPORTED_PROVIDER_MESSAGE_ROLE');
  assert.equal(result.receipt??null,null);
});

test('DETERMINISTIC: OpenRouter route change remains explicitly route-dependent until measured',()=>{
  const engine=new ContextDeliveryEngine();
  const result=engine.deliver({...deliveryInput(),providerId:'OpenRouter',modelId:'provider/model-a',routeId:'route:b',previousRouteId:'route:a'});
  assert.equal(result.ok,true);
  assert.deepEqual(result.receipt.routeOutcome,{
    changed:true,from:'route:a',to:'route:b',cacheAssumption:'ROUTE_DEPENDENT_UNMEASURED',cacheAssumptionInvalidated:true,
  });
});

test('DETERMINISTIC: provider response identity mismatch cannot learn into a sealed generation',async()=>{
  const brain=new Area52NativeBrain();
  await assert.rejects(
    brain.runTurn({
      chatId:'chat:response-fence',turnId:'turn:response-fence',generationId:'gen:response-fence',
      query:'Continue.',scene:scene('scene:response-fence',1),executionLabel:'DETERMINISTIC',
    },{
      generate:async(_rendered,meta)=>({
        text:'This belongs to another generation.',
        chatId:meta.selection.chatId,turnId:meta.selection.turnId,
        generationId:'gen:foreign',correlationId:meta.selection.correlationId,
        contextSealId:meta.contextSealReceipt.id,requestId:'request:foreign',
      }),
    }),
    /PROVIDER_RESPONSE_IDENTITY_MISMATCH:generationId/,
  );
  const record=brain.readTurn('turn:response-fence');
  assert.equal(record.state,'SEALED_FOR_GENERATION');
  assert.equal(record.learningReceipt??null,null);
  assert.equal(record.response??null,null);
});

test('ASSEMBLED_HOST_REQUEST: exact rendered roles, sections, seal identity, response receipt, and bounded payload retention',async()=>{
  const {context,listeners,sillyTavern}=makeHost();
  const nativeBrain=new Area52NativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});
  session.start();
  pushUser(context,'At Neutral Hall, inspect the sealed gate.');
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));

  const ui=nativeBrain.uiBindings();
  const selection=ui.readSelection({chatId:context.chatId});
  const before=ui.readPromptDeliveryReceipt(selection);
  assert.equal(before.phases.hostRequest.status,'NOT_OBSERVED');

  const request={chat:[{role:'system',content:'SillyTavern host policy'},{role:'user',content:'At Neutral Hall, inspect the sealed gate.'}],dryRun:false,requestId:'host-request:1'};
  await Promise.all([...listeners.get('chat_completion_prompt_ready')].map(fn=>fn(request)));

  const observed=ui.readPromptDeliveryReceipt(selection);
  assert.equal(observed.phases.hostRequest.status,'OBSERVED_MATCH');
  assert.equal(observed.phases.hostRequest.contextSealId,before.contextSealId);
  assert.equal(observed.phases.hostRequest.sealedPacketHash,before.sealedPacketHash);
  assert.equal(observed.phases.providerResponse.status,'NOT_RECEIVED');
  const inserted=request.chat.slice(1,1+observed.messageRoleMap.length);
  assert.deepEqual(inserted.map(row=>row.role),observed.messageRoleMap.map(row=>row.providerRole));
  assert.deepEqual(inserted.map(row=>/^\[([^\]]+)\]/.exec(row.content)?.[1]??null),observed.messageRoleMap.map(row=>row.slot));
  assert.equal(session.exportEvidence().nativeBrainIntegration.retainedDeliveryPayloadCount,0);

  const assistantIndex=pushAssistant(context,'The gate remains closed.');
  await Promise.all([...listeners.get('message_received')].map(fn=>fn(assistantIndex)));
  const completed=ui.readPromptDeliveryReceipt(selection);
  assert.equal(completed.phases.providerResponse.status,'RECEIVED');
  assert.equal(completed.phases.providerResponse.chatId,selection.chatId);
  assert.equal(completed.phases.providerResponse.turnId,selection.turnId);
  assert.equal(completed.phases.providerResponse.generationId,selection.generationId);
  assert.equal(completed.phases.providerResponse.contextSealId,before.contextSealId);
  assert.equal(ui.readGeneration({generationId:selection.generationId,...selection}).state,'LEARNED');
  session.destroy();
});


test('DETERMINISTIC: one sealed semantic packet preserves identity across conservative profiles and reports role collisions without merging messages',()=>{
  const engine=new ContextDeliveryEngine();
  const input=deliveryInput();
  const stable=engine.deliver({...input,modelProfileId:'CACHE_STABLE',systemPolicy:'Keep canonical facts unchanged.'});
  const generic=engine.deliver({...input,modelProfileId:'GENERIC_SAFE',systemPolicy:'Keep canonical facts unchanged.'});
  const routed=engine.deliver({...input,providerId:'OpenRouter',modelId:'provider/model-b',routeId:'route:profile'});
  for(const result of [stable,generic,routed]){
    assert.equal(result.ok,true);
    assert.equal(result.receipt.sealedPacketHash,input.sealReceipt.packetHash);
    assert.deepEqual(result.receipt.sourceRevisionRefs,[...result.receipt.sourceRevisionRefs].sort());
    assert.equal(result.receipt.phases.sealedCompiled.semanticManifestIdentity,result.receipt.semanticManifestIdentity);
  }
  assert.equal(stable.receipt.semanticManifestIdentity,generic.receipt.semanticManifestIdentity);
  assert.equal(generic.receipt.semanticManifestIdentity,routed.receipt.semanticManifestIdentity);
  assert.ok(stable.receipt.roleCollisions.some(row=>row.providerRole==='system'&&row.semanticRoles.includes('context')&&row.semanticRoles.includes('system')&&row.outcome==='PRESERVED_AS_SEPARATE_MESSAGES'));
  assert.equal(stable.rendered.messages.length,stable.rendered.messageMap.length);
});

test('DETERMINISTIC: overflow and unknown-profile fallback are explicit inspectable outcomes',()=>{
  const engine=new ContextDeliveryEngine();
  const overflow=engine.deliver({...deliveryInput(),budgetTokens:64});
  assert.equal(overflow.ok,false);
  assert.equal(overflow.failure?.code,'DELIVERY_BUDGET_UNSATISFIABLE');
  assert.equal(overflow.budget?.available,0);

  const fallback=engine.deliver({...deliveryInput(),modelProfileId:'UNKNOWN_PROFILE',fallbackProfileId:'GENERIC_SAFE'});
  assert.equal(fallback.ok,true);
  assert.equal(fallback.presentationRouting.reason,'EXPLICIT_COMPATIBLE_FALLBACK');
  assert.equal(fallback.presentationRouting.fallbackUsed,true);
  assert.equal(fallback.plan.modelProfileId,'GENERIC_SAFE');
  assert.equal(fallback.receipt.presentation.fallbackUsed,true);
});

test('ASSEMBLED_HOST_REQUEST: chat switch invalidates a sealed pending generation before host delivery',async()=>{
  const {context,listeners,sillyTavern}=makeHost();
  const nativeBrain=new Area52NativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});
  session.start();
  pushUser(context,'Inspect the neutral gate.');
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));
  const selection=nativeBrain.uiBindings().readSelection({chatId:context.chatId});
  context.chatId='chat:switched';
  await Promise.all([...listeners.get('chat_changed')].map(fn=>fn()));
  const evidence=session.exportEvidence().nativeBrainIntegration;
  assert.equal(evidence.pendingCount,0);
  assert.ok(evidence.rejections.some(row=>row.code==='HOST_CHAT_CHANGED_INVALIDATED_PENDING_GENERATION'));
  assert.equal(nativeBrain.readTurn(selection.turnId).state,'SEALED_FOR_GENERATION');
  assert.equal(nativeBrain.readTurn(selection.turnId).learningReceipt??null,null);
  session.destroy();
});

test('ASSEMBLED_HOST_REQUEST: edited source invalidates pending sealed delivery and regeneration receives a new generation identity',async()=>{
  const {context,listeners,sillyTavern}=makeHost();
  const nativeBrain=new Area52NativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});
  session.start();
  const firstIndex=pushUser(context,'Inspect the gate before the edit.');
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));
  const first=nativeBrain.uiBindings().readSelection({chatId:context.chatId});
  context.chat[firstIndex].mes='Inspect the gate after the edit.';
  await Promise.all([...listeners.get('message_edited')].map(fn=>fn(firstIndex)));
  assert.equal(session.exportEvidence().nativeBrainIntegration.pendingCount,0);
  assert.ok(session.exportEvidence().nativeBrainIntegration.rejections.some(row=>row.code==='HOST_MESSAGE_EDITED_INVALIDATED_PENDING_GENERATION'));
  assert.equal(nativeBrain.readTurn(first.turnId).learningReceipt??null,null);

  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('regenerate',{},false)));
  const second=nativeBrain.uiBindings().readSelection({chatId:context.chatId});
  assert.notEqual(second.generationId,first.generationId);
  await Promise.all([...listeners.get('generation_stopped')].map(fn=>fn()));
  assert.equal(session.exportEvidence().nativeBrainIntegration.pendingCount,0);
  assert.ok(session.exportEvidence().nativeBrainIntegration.rejections.some(row=>row.code==='GENERATION_STOPPED_WITHOUT_COMPLETION'));
  assert.equal(nativeBrain.readTurn(second.turnId).learningReceipt??null,null);
  session.destroy();
});
