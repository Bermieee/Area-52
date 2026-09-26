import test from 'node:test';
import assert from 'node:assert/strict';
import {Area52NativeBrain} from '../src/native-brain.js';
import {createWave11LiveReceiptBinding} from '../src/ui-core/wave11-live-bindings.js';
import {AdaptiveBudgetAllocator,ModelProfileRegistry} from '../src/adaptive-context-runtime.js';
import {createPromptPlanReadModel,createContextReceiptReadModel} from '../src/core-ui-read-models.js';
import {ResultClass,ResultDestination,ResultFreshness,ResultPayloadClass,createCognitiveResult} from '../src/publication-contracts.js';

const LIVE_CHAT='Akira Kagenou - 2026-09-16@18h19m27s303ms imported';
const LIVE_REF='sillytavern:'+LIVE_CHAT+':message:389:1f2b3f0b@1';
const MESSAGE_389_FENCE_FIXTURE=Object.freeze({
  selectedTurn:'native-live:'+LIVE_CHAT+':389:1f2b3f0b:1',
  expectedSceneRevisionRefs:Object.freeze([LIVE_REF]),
  observedPreFixSelectedRevisionRefs:Object.freeze([]),
});

function liveScene({chatId=LIVE_CHAT,sceneRevision=1,sourceRevisionRef=LIVE_REF,sceneId='chat:'+chatId+':scene:1'}={}){
  return{
    kind:'SceneIntegrationSignal',contractVersion:'1.0.0',
    chatNamespace:chatId,chatId,
    sceneId,sceneRevision,
    sourceRevisionRefs:[sourceRevisionRef],provenance:['host-message:389'],
    location:null,narrativeTime:null,activeCast:[],castObservations:[],activeThreads:[],
    objects:[],objectObservations:[],uncertainFields:[],conflictSignals:[],
    boundaryState:{status:'STABLE'},sceneRelationship:'CONTINUES',transitionType:'CONTINUES',
    previousSceneRef:null,resumedSceneRef:null,episodeRefs:[],prefetchRecommendations:[],
    objectTransitionRefs:[],health:{status:'ready',reasons:[]},diagnosticRefs:{},
    authority:'DESCRIPTIVE',authorityGranted:false,settlementAuthority:false,
    canonicalMutationAuthority:false,contextSealBypass:false,runtimeSchedulingAuthority:false,
  };
}

test('REPRO: selected native turn fence includes the host message revision used by Scene/Choice/Hot/Seal',async()=>{
  const brain=new Area52NativeBrain();
  const prepared=await brain.prepareTurn({
    chatId:LIVE_CHAT,
    turnId:'native-live:'+LIVE_CHAT+':389:1f2b3f0b:1',
    generationId:'native-live-gen:'+LIVE_CHAT+':389:1f2b3f0b:1',
    query:'*Akira looked to nanahoshi* "Kinda scary huh"',
    sceneSignal:liveScene(),
    executionLabel:'LIVE_SILLYTAVERN',
    budgetTokens:4096,
  });

  assert.deepEqual(MESSAGE_389_FENCE_FIXTURE.observedPreFixSelectedRevisionRefs,[]);
  assert.deepEqual(
    prepared.selection.sourceRevisionRefs.filter(ref=>ref===LIVE_REF),
    MESSAGE_389_FENCE_FIXTURE.expectedSceneRevisionRefs,
    'selected source fence must carry the exact host message revision retained by Scene/Hot Cognition',
  );
  assert.equal(prepared.selection.ownerSourceRevisionRefs.includes(LIVE_REF),false,'Scene evidence must not be mislabeled as owner-knowledge evidence');

  const live=createWave11LiveReceiptBinding(brain.uiBindings());
  const selected=live.selection();
  assert.equal(selected.turnId,prepared.selection.turnId);
  assert.doesNotThrow(()=>live.bridges.scene.readModel());
  assert.doesNotThrow(()=>live.bridges.cognition.readHotCognitionReadModel(selected));
  assert.doesNotThrow(()=>live.bridges.cognition.readCognitiveChoiceReceipt(selected));
  assert.doesNotThrow(()=>live.bridges.cognition.readContextSealReceipt(selected));
});


test('current scene revision replaces stale external source evidence while chat/generation mismatches and late results remain fenced',async()=>{
  const brain=new Area52NativeBrain();
  const r1='sillytavern:'+LIVE_CHAT+':message:389:oldrev@1';
  const r2='sillytavern:'+LIVE_CHAT+':message:389:newrev@2';
  const first=await brain.prepareTurn({
    chatId:LIVE_CHAT,turnId:'native-live:'+LIVE_CHAT+':389:oldrev:1',generationId:'native-live-gen:'+LIVE_CHAT+':389:oldrev:1',
    query:'Continue.',sceneSignal:liveScene({sceneRevision:1,sourceRevisionRef:r1}),executionLabel:'LIVE_SILLYTAVERN',
  });
  assert.ok(first.selection.sourceRevisionRefs.includes(r1));

  const second=await brain.prepareTurn({
    chatId:LIVE_CHAT,turnId:'native-live:'+LIVE_CHAT+':389:newrev:2',generationId:'native-live-gen:'+LIVE_CHAT+':389:newrev:2',
    query:'Continue after edit.',sceneSignal:liveScene({sceneRevision:2,sourceRevisionRef:r2}),executionLabel:'LIVE_SILLYTAVERN',
  });
  assert.ok(second.selection.sourceRevisionRefs.includes(r2));
  assert.equal(second.selection.sourceRevisionRefs.includes(r1),false,'changed host revision must leave the current selected source fence');

  const bindings=brain.uiBindings();
  assert.equal(bindings.readPromptPlan({...second.selection,generationId:first.selection.generationId}),null,'regeneration identity mismatch must not reuse a plan');
  assert.equal(bindings.readContextSeal({...second.selection,chatId:'foreign-chat'}),null,'chat switch must not reuse a seal');
  assert.equal(
    bindings.readContextSeal({...second.selection,sourceRevisionRefs:[...second.selection.sourceRevisionRefs,r1]}),
    null,
    'a selected-turn read that reintroduces a retired source revision must be rejected',
  );
  const historicalFirst=bindings.readSelectedTurnReceipt(first.selection);
  assert.ok(historicalFirst,'the exact prior turn remains inspectable by its own immutable identity');
  assert.equal(historicalFirst.producers.scene.sceneRevision,1,'historical selected-turn diagnostics must retain that turn Scene revision');
  assert.deepEqual(historicalFirst.producers.scene.sourceRevisionRefs,[r1],'historical selected-turn diagnostics must retain that turn Scene fence');
  assert.equal(historicalFirst.producers.scene.sourceRevisionRefs.includes(r2),false,'a later Scene revision must not fill an older selected turn');

  const late=createCognitiveResult({
    id:'late:worker1-wave1',taskId:'late-task',turnId:second.selection.turnId,correlationId:second.selection.correlationId,
    sourceSubsystem:'TEST_LATE',destinationOwner:'CONTEXT',resultType:'TEST_LATE',
    resultClass:ResultClass.OPPORTUNISTIC,payloadClass:ResultPayloadClass.DERIVED_DATA,
    evidenceIds:[],provenance:{},sourceRevisionIds:[r2],worldRevision:second.selection.worldRevision,sceneRevision:second.selection.sceneRevision,
    authorityClass:'UNRESOLVED',destination:ResultDestination.FOREGROUND,payload:{value:'late'},
    freshness:ResultFreshness.FRESH,
  });
  const routed=brain.receiveCognitiveResult(late);
  assert.equal(routed.route.late,true);
  assert.notEqual(routed.route.effectiveDestination,ResultDestination.FOREGROUND);

  const otherChat='chat:worker1-switch';
  const r3='sillytavern:'+otherChat+':message:1:other@1';
  const switched=await brain.prepareTurn({
    chatId:otherChat,turnId:'native-live:'+otherChat+':1:other:1',generationId:'native-live-gen:'+otherChat+':1:other:1',
    query:'New story.',sceneSignal:liveScene({chatId:otherChat,sceneRevision:1,sourceRevisionRef:r3,sceneId:'chat:'+otherChat+':scene:1'}),executionLabel:'LIVE_SILLYTAVERN',
  });
  assert.ok(switched.selection.sourceRevisionRefs.includes(r3));
  assert.equal(switched.selection.sourceRevisionRefs.includes(r2),false,'chat switch must reset external selected-source revisions');
});

test('4096-token allocator explains oversized optional Lore without calling already-used capacity exhausted',()=>{
  const profile=new ModelProfileRegistry().get('CACHE_STABLE'),allocator=new AdaptiveBudgetAllocator();
  const make=(slot,{tokens,protected:protectedFlag,priority})=>({
    slot,compactText:'x'.repeat(tokens*4),richText:'x'.repeat(tokens*4),protected:protectedFlag,priority,
    required:false,semantic:true,sourceRevisionIds:slot==='RELEVANT_LORE'?['lore:test@r1']:[LIVE_REF],
  });
  const sections=[
    make('CURRENT_SCENE',{tokens:400,protected:true,priority:10}),
    make('USER_INPUT',{tokens:20,protected:true,priority:10}),
    make('RELEVANT_LORE',{tokens:3500,protected:false,priority:8}),
  ];
  const allocation=allocator.allocate({sections,profile,budgetTokens:4096,intent:'CURRENT',userInput:'Continue.'});
  assert.equal(allocation.ok,true);
  assert.equal(allocation.budget.total,4096);
  assert.equal(allocation.budget.available,3840);
  assert.equal(allocation.budget.allocated,420);
  assert.equal(allocation.budget.remaining,3420);
  const lore=allocation.sections.find(row=>row.slot==='RELEVANT_LORE'),deferred=allocation.deferred.find(row=>row.slot==='RELEVANT_LORE');
  assert.equal(lore.representation,'OMITTED');
  assert.equal(deferred.reason,'OPTIONAL_SECTION_MINIMUM_EXCEEDS_REMAINING_BUDGET');
  assert.equal(deferred.requiredTokens,3500);
  assert.equal(deferred.remainingTokensAtDecision,3420);
  assert.equal(deferred.shortfallTokens,80);

  const plan={
    promptPlanId:'prompt-plan:worker1-4096',generationId:'gen:worker1-4096',turnId:'turn:worker1-4096',
    contextSealId:'context-seal:worker1-4096',sealedPacketHash:'hash:worker1-4096',modelProfileId:'CACHE_STABLE',
    modelProfileRevision:'1',deliveryPolicyRevision:'1',worldRevision:0,sceneRevision:1,status:'READY',
    sourceRevisionDependencies:[LIVE_REF,'lore:test@r1'],segments:[],sections:allocation.sections,
    ordering:allocation.sections.filter(row=>row.representation!=='OMITTED').map(row=>row.slot),
    dropped:allocation.dropped,deferred:allocation.deferred,fallbackDecisions:allocation.fallbackDecisions,
    reuseDecisions:[],cacheDecisions:[],budget:allocation.budget,
  };
  const promptRead=createPromptPlanReadModel(plan),loreDecision=promptRead.slotAllocation.find(row=>row.slot==='RELEVANT_LORE');
  assert.equal(loreDecision.state,'DEFERRED');
  assert.equal(loreDecision.included,false);
  assert.equal(loreDecision.allocatedTokens,0);
  assert.equal(loreDecision.requiredTokens,3500);
  assert.equal(loreDecision.reason,'OPTIONAL_SECTION_MINIMUM_EXCEEDS_REMAINING_BUDGET');

  const published={
    sealReceipt:{id:plan.contextSealId,turnId:plan.turnId,correlationId:'corr:worker1-4096',packetId:'packet:worker1-4096',packetHash:plan.sealedPacketHash,sourceRevisionIds:[LIVE_REF,'lore:test@r1'],worldRevision:0,sceneRevision:1,fallbackState:'RECORDED'},
    packet:{id:'packet:worker1-4096',sceneIntegration:{sceneId:'scene:worker1'},unresolved:[],provenanceIndex:{}},
  };
  const context=createContextReceiptReadModel({published,delivery:{plan,integrityReceipt:{valid:true}}});
  assert.deepEqual(context.includedSections,['CURRENT_SCENE','USER_INPUT']);
  assert.equal(context.includedSections.includes('RELEVANT_LORE'),false);
  assert.equal(context.deferredSections[0].reason,'OPTIONAL_SECTION_MINIMUM_EXCEEDS_REMAINING_BUDGET');

  const smaller=allocator.allocate({sections:[
    make('CURRENT_SCENE',{tokens:400,protected:true,priority:10}),
    make('USER_INPUT',{tokens:20,protected:true,priority:10}),
    make('RELEVANT_LORE',{tokens:3000,protected:false,priority:8}),
  ],profile,budgetTokens:4096,intent:'CURRENT',userInput:'Continue.'});
  assert.equal(smaller.sections.find(row=>row.slot==='RELEVANT_LORE').representation==='OMITTED',false,'Lore that fits the remaining budget must remain eligible for delivery');
  assert.equal(smaller.deferred.some(row=>row.slot==='RELEVANT_LORE'),false);
});
