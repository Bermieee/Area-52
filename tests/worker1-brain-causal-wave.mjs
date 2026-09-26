import test from 'node:test';
import assert from 'node:assert/strict';
import {Area52NativeBrain} from '../src/native-brain.js';
import {CognitiveReason} from '../src/cognitive-choice-contracts.js';
import {CausalOwnerReason,createCausalOwnerEvent} from '../src/causal-owner-receipts.js';
import {CAPABILITIES,MemoryPersistenceAdapter,WorkerDirector,CognitiveObligationReconciler} from '../src/runtime/index.js';

function scene(sceneId,sceneRevision,{location=null,activeCast=[]}={}){
  return{sceneId,sceneRevision,location,narrativeTime:'t'+sceneRevision,activeCast,activeThreads:[],objects:[],sourceRevisionRefs:[],provenance:['scene:'+sceneId+':'+sceneRevision]};
}

test('#225 complete finite decision matrix is source-fenced and query-safe',async()=>{
  const brain=new Area52NativeBrain();
  const lore=brain.acceptLore({
    sourceId:'lore:choice:gate',sourceType:'LORE_ENTRY',
    exactContent:'The Ash Gate remains closed at dusk.',
    semantic:{subjectId:'Ash Gate',predicate:'stateAtDusk',value:'CLOSED'},
    metadata:{representationText:'Ash Gate remains closed at dusk.'},
  });
  const query='What is the Ash Gate rule at dusk?';
  const prepared=await brain.prepareTurn({
    chatId:'chat:choice',turnId:'choice:1',generationId:'gen:choice:1',query,
    scene:scene('ash-gate',1,{location:'Ash Gate',activeCast:['Mara']}),executionLabel:'DETERMINISTIC',
  });
  const receipt=prepared.cognitiveChoice;
  assert.equal(receipt.functionDecisions.length,receipt.consideredCognitionOptions.length);
  assert.deepEqual(new Set(receipt.functionDecisions.map(row=>row.capability)),new Set(receipt.consideredCognitionOptions));
  const finiteReasons=new Set(Object.values(CognitiveReason));
  assert.ok(receipt.functionDecisions.every(row=>finiteReasons.has(row.reasonCode)));
  assert.ok(receipt.functionDecisions.every(row=>Array.isArray(row.sourceRevisionRefs)&&Array.isArray(row.parentReceiptIds)&&row.metadata.physicalExecutionInferred===false));
  assert.ok(receipt.executionPlan.sensory.sourceRevisionRefs.includes(lore.sourceRevisionId));
  assert.equal(receipt.chatId,'chat:choice');
  assert.equal(receipt.generationId,'gen:choice:1');
  assert.equal(JSON.stringify(receipt).includes(query),false);
  assert.match(receipt.metadata.queryFingerprint,/^[a-f0-9]+$/);
});

test('#225 layered Scatter keeps quiet continuation cheap without using job count as routing policy',async()=>{
  const brain=new Area52NativeBrain();
  const first=await brain.prepareTurn({
    chatId:'chat:load',turnId:'load:1',generationId:'gen:load:1',query:'What happened before Aya reached this room?',intent:'HISTORICAL',
    scene:scene('quiet-room',1,{location:'Quiet Room',activeCast:['Aya']}),executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({turnId:'load:1',response:'Aya watches the rain.',knownBy:['Aya']});
  const quiet=await brain.prepareTurn({chatId:'chat:load',turnId:'load:2',generationId:'gen:load:2',query:'Continue.',executionLabel:'DETERMINISTIC'});
  assert.ok(quiet.cognitiveChoice.paths.includes('HOT_ONLY'));
  assert.ok(first.cognitiveChoice.measurements.retrievalEnvelopeCount>0);
  assert.equal(quiet.cognitiveChoice.measurements.retrievalEnvelopeCount,0);
  assert.equal(quiet.cognitiveChoice.executionPlan.layers[1].chosen.length,0);
  assert.equal(quiet.cognitiveChoice.measurements.remoteProviderExecutionInferred,false);
  const scatter=brain.uiBindings().readScatter({chatId:'chat:load',turnId:'load:2',generationId:'gen:load:2'});
  assert.equal(scatter.jobCountIsNotRoutingPolicy,true);
  assert.equal(scatter.jobs.some(row=>row.status==='EXECUTED'),false);
  console.log('WORKER1_LOAD_METRIC '+JSON.stringify({
    firstRetrievalEnvelopes:first.cognitiveChoice.measurements.retrievalEnvelopeCount,
    quietRetrievalEnvelopes:quiet.cognitiveChoice.measurements.retrievalEnvelopeCount,
    firstRetrievalMs:first.cognitiveChoice.measurements.retrievalElapsedMs,
    quietRetrievalMs:quiet.cognitiveChoice.measurements.retrievalElapsedMs,
    firstChannels:first.cognitiveChoice.measurements.usedChannelCount,
    quietChannels:quiet.cognitiveChoice.measurements.usedChannelCount,
    configuredResources:quiet.cognitiveChoice.measurements.configuredNativeResources,
  }));
});

test('#262 Lifecycle requires physical completion and explicit owner admission before DONE',async()=>{
  const persistence=new MemoryPersistenceAdapter();
  const director=new WorkerDirector({persistence,foregroundReserve:{CPU:0}});
  director.registerWorker({workerId:'native',capabilities:[CAPABILITIES.CPU_ANALYSIS],supportedLayers:['L2'],resourceProfile:{CPU:1},concurrencyCapacity:1,health:'healthy'});
  const reconciler=new CognitiveObligationReconciler({director});
  const expected=[{
    stepId:'memory-study',chainId:'turn:1',requiresOwnerAcceptance:true,
    obligation:{taskType:'MEMORY_STUDY',owner:'MEMORY',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'turn:1:memory',payload:{turnId:'turn:1'},sourceRevisionIds:['memory:r1']},
    cause:{eventType:'TURN_COMPLETED',eventId:'evt:1',chatId:'chat:1',turnId:'turn:1',generationId:'gen:1',correlationId:'corr:1',producerId:'MEMORY',consumerId:'RUNTIME',sourceRevisionRefs:['memory:r1']},
    executor:{execute:async()=>['candidate'],validate:async()=>true,commit:async()=>({output:['candidate'],validation:{valid:true}})},
  }];
  assert.equal(reconciler.reconcile(expected).steps[0].state,'DUE');
  await director.drain();
  const awaiting=reconciler.inspect(expected).steps[0];
  assert.equal(awaiting.state,'BLOCKED');
  assert.equal(awaiting.reasonCode,'OWNER_ACCEPTANCE_PENDING');
  assert.equal(awaiting.physicalExecutionAttempted,true);
  assert.equal(awaiting.physicalExecutionReturned,true);
  director.recordOwnerAdmission(awaiting.taskId,{accepted:true,receiptId:'memory-owner:1',reasonCode:'OWNER_ACCEPTED'});
  const done=reconciler.inspect(expected).steps[0];
  assert.equal(done.state,'DONE');
  assert.equal(done.ownerAccepted,true);
  const restored=new WorkerDirector({persistence,foregroundReserve:{CPU:0}});
  assert.equal(new CognitiveObligationReconciler({director:restored}).inspect(expected).steps[0].state,'DONE');
});

test('#262 Lifecycle distinguishes explicit no-work from missing work and settlement pending',async()=>{
  const director=new WorkerDirector({foregroundReserve:{CPU:0}});
  director.registerWorker({workerId:'native',capabilities:[CAPABILITIES.CPU_ANALYSIS],supportedLayers:['L2'],resourceProfile:{CPU:1},concurrencyCapacity:1,health:'healthy'});
  const reconciler=new CognitiveObligationReconciler({director});
  const skipped=reconciler.reconcile([{
    stepId:'lore-none',skipReason:'NO_WORK_WARRANTED',
    obligation:{taskType:'LORE_STUDY',owner:'LORE',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'lore:none'},
  }]);
  assert.equal(skipped.steps[0].state,'SKIPPED_WITH_REASON');
  assert.equal(director.ledger.list().length,0);

  const expected=[{
    stepId:'scene-settle',requiresOwnerAcceptance:true,requiresSettlement:true,
    obligation:{taskType:'SCENE_SETTLE',owner:'SCENE',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'scene:settle'},
    executor:{execute:async()=>['result'],validate:async()=>true,commit:async()=>({output:['result'],validation:{valid:true}})},
  }];
  reconciler.reconcile(expected);await director.drain();
  const taskId=director.ledger.list()[0].taskId;
  director.recordOwnerAdmission(taskId,{accepted:true,receiptId:'scene-owner:1'});
  assert.equal(reconciler.inspect(expected).steps[0].reasonCode,'SETTLEMENT_PENDING');
  director.recordOwnerAdmission(taskId,{accepted:true,receiptId:'scene-owner:1',settlementReceiptId:'settlement:1'});
  assert.equal(reconciler.inspect(expected).steps[0].state,'DONE');
});

test('#263 selected-turn causal journal publishes evidence and explicit NO_EVIDENCE without sensitive bodies',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({
    chatId:'chat:causal',turnId:'causal:1',generationId:'gen:causal:1',query:'Continue.',
    scene:scene('causal-room',1,{location:'Causal Room',activeCast:['Nara']}),providerId:'openrouter',executionLabel:'DETERMINISTIC',
  });
  let receipt=brain.uiBindings().readCausalTurnReceipt({chatId:'chat:causal',turnId:'causal:1',generationId:'gen:causal:1'});
  assert.equal(receipt.contractVersion,2);
  assert.ok(receipt.causalEvents.every(row=>row.chatId==='chat:causal'&&row.turnId==='causal:1'&&row.generationId==='gen:causal:1'));
  assert.ok(receipt.causalEvents.some(row=>row.stage==='delivery'&&row.lifecycleState==='NO_EVIDENCE'&&row.reasonCode==='HOST_OBSERVATION_NOT_PUBLISHED'));
  assert.ok(receipt.causalEvents.some(row=>row.stage==='sidecar'&&row.lifecycleState==='NO_EVIDENCE'));
  assert.equal(receipt.causalEvents.every(row=>row.rawPromptIncluded===false&&row.storyTextIncluded===false&&row.loreBodiesIncluded===false&&row.credentialsIncluded===false&&row.hiddenReasoningIncluded===false),true);
  assert.equal(JSON.stringify(receipt).includes('Continue.'),false);
  await brain.completeTurn({turnId:'causal:1',response:'Nara stays by the window.',knownBy:['Nara']});
  receipt=brain.uiBindings().readOwnerTurnReceipt({chatId:'chat:causal',turnId:'causal:1',generationId:'gen:causal:1'});
  assert.ok(receipt.causalEvents.some(row=>row.stage==='learning'&&row.lifecycleState==='DONE'&&row.ownerAccepted===true));
  assert.equal(receipt.obligationReconciliation.steps.find(row=>row.stepId==='POST_TURN_LEARNING').state,'DONE');

  const restored=Area52NativeBrain.fromSnapshot(brain.snapshot());
  const replay=restored.uiBindings().readSelectedTurnReceipt({chatId:'chat:causal',turnId:'causal:1',generationId:'gen:causal:1'});
  assert.equal(replay.turnId,'causal:1');
  assert.equal(replay.obligationReconciliation.steps.find(row=>row.stepId==='POST_TURN_LEARNING').state,'DONE');
  assert.equal(restored.uiBindings().readSelectedTurnReceipt({chatId:'chat:causal',turnId:'causal:1',generationId:'wrong'}),null);
});

test('#263 causal selection survives true scene transition and chat switch while regeneration invalidates the old generation fence',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({
    chatId:'chat:A',turnId:'A:1',generationId:'gen:A:1',query:'Enter.',
    scene:scene('room-A',1,{location:'Room A',activeCast:['Ari']}),executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({turnId:'A:1',response:'Ari enters Room A.',knownBy:['Ari']});
  await brain.prepareTurn({
    chatId:'chat:A',turnId:'A:2',generationId:'gen:A:2',query:'Move on.',
    scene:scene('room-B',2,{location:'Room B',activeCast:['Ari']}),executionLabel:'DETERMINISTIC',
  });
  const transitioned=brain.uiBindings().readCausalTurnReceipt({chatId:'chat:A',turnId:'A:2',generationId:'gen:A:2'});
  assert.equal(transitioned.sceneId,'room-B');
  assert.equal(transitioned.sceneRevision,2);
  assert.ok(transitioned.causalEvents.some(row=>row.stage==='scene'&&row.lifecycleState==='RETURNED'));

  await brain.prepareTurn({
    chatId:'chat:B',turnId:'B:1',generationId:'gen:B:1',query:'Continue elsewhere.',
    scene:scene('room-C',1,{location:'Room C',activeCast:['Bea']}),executionLabel:'DETERMINISTIC',
  });
  assert.equal(brain.uiBindings().readSelectedTurnReceipt({chatId:'chat:A',turnId:'A:2',generationId:'gen:A:2'}).sceneId,'room-B');
  assert.equal(brain.uiBindings().readSelectedTurnReceipt({chatId:'chat:B',turnId:'A:2',generationId:'gen:A:2'}),null);

  await brain.prepareTurn({
    chatId:'chat:A',turnId:'A:2:regen',generationId:'gen:A:2:regen',query:'Move on.',
    executionLabel:'REGENERATION',
  });
  const original=brain.uiBindings().readSelectedTurnReceipt({chatId:'chat:A',turnId:'A:2',generationId:'gen:A:2'});
  assert.equal(original.generationId,'gen:A:2');
  const regenerated=brain.uiBindings().readSelectedTurnReceipt({chatId:'chat:A',turnId:'A:2:regen',generationId:'gen:A:2:regen'});
  assert.equal(regenerated.generationId,'gen:A:2:regen');
  assert.equal(regenerated.sceneId,'room-B');
  assert.equal(brain.uiBindings().readSelectedTurnReceipt({chatId:'chat:A',turnId:'A:2:regen',generationId:'gen:A:2'}),null);
});

test('#264 OpenRouter outbound roles are provider-supported while semantic context identity is retained',async()=>{
  const brain=new Area52NativeBrain();
  const prepared=await brain.prepareTurn({
    chatId:'chat:roles',turnId:'roles:1',generationId:'gen:roles:1',query:'Continue.',
    scene:scene('roles-room',1,{location:'Roles Room',activeCast:['Lia']}),
    providerId:'openrouter',modelProfileId:'AUTO',executionLabel:'DETERMINISTIC',
  });
  assert.equal(prepared.rendered.adapterId,'messages-v1');
  assert.ok(prepared.rendered.messages.length>0);
  assert.equal(prepared.rendered.messages.some(row=>row.role==='context'),false);
  assert.ok(prepared.rendered.messages.every(row=>['system','user','assistant','tool'].includes(row.role)));
  const mapped=prepared.rendered.messageManifest.filter(row=>row.semanticRole==='context');
  assert.ok(mapped.length>0);
  assert.ok(mapped.every(row=>row.outboundRole==='system'&&row.sectionIdentity));
  assert.equal(prepared.rendered.contextSealId,prepared.contextSealReceipt.id);
  assert.equal(prepared.rendered.promptPlanId,prepared.promptPlan.promptPlanId);
  assert.deepEqual(prepared.promptDeliveryReceipt.outboundRoles,[...new Set(prepared.rendered.messages.map(row=>row.role))].sort());
  assert.ok(prepared.promptDeliveryReceipt.semanticRoles.includes('context'));
});

test('causal owner event contract rejects unbounded lifecycle/reason vocabulary',()=>{
  assert.throws(()=>createCausalOwnerEvent({selection:{turnId:'t'},stage:'x',producer:'A',consumer:'B',lifecycleState:'MAYBE',reasonCode:CausalOwnerReason.EVIDENCE_PUBLISHED}));
  assert.throws(()=>createCausalOwnerEvent({selection:{turnId:'t'},stage:'x',producer:'A',consumer:'B',lifecycleState:'DONE',reasonCode:'because'}));
});
