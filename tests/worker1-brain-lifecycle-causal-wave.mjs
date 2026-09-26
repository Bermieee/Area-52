import test from 'node:test';
import assert from 'node:assert/strict';
import {Area52NativeBrain} from '../src/native-brain.js';
import {CognitiveChoiceController} from '../src/cognitive-choice-controller.js';
import {CognitiveDisposition,CognitiveJob,CognitiveReason} from '../src/cognitive-choice-contracts.js';
import {ContextDeliveryEngine} from '../src/adaptive-context-runtime.js';
import {GenerationContextSeal} from '../src/context-seal.js';
import {CAPABILITIES,CausalReceiptKind,CognitiveObligationReconciler,MemoryPersistenceAdapter,WorkerDirector} from '../src/runtime/index.js';

const scene=(id,revision=1,extra={})=>({sceneId:id,sceneRevision:revision,sourceRevisionRefs:['scene:'+id+':r'+revision],activeCast:['Mara'],location:id,...extra});

test('Worker 1 #225 complete Cognitive Choice matrix is source-fenced and does not claim physical execution',()=>{
  const controller=new CognitiveChoiceController();
  const session=controller.begin({turnId:'t:matrix',turnRevision:4,correlationId:'c:matrix',query:'Find the archive truth',intent:'TEMPORAL',worldRevision:9,sceneRevision:3,channelIds:['NATIVE_MEMORY'],sceneContext:{sceneId:'s:matrix',sceneRevision:3,sourceRevisionRefs:['scene:r3'],cognitiveNeeds:[{needId:'need:retrieval',kind:'TEMPORAL_CONTEXT',required:true,requiredCapabilities:['RETRIEVAL'],reason:'scene transition'}],retrievalRequired:true}});
  const envelope={candidates:[],sourceRevisionSet:['memory:r7'],retrievalIntentIds:['intent:1'],unavailableChannels:[],freshness:'FRESH',fusionReceipt:{inputNominationCount:0,invalidNominationCount:0,staleNominationCount:0,diagnostics:{effectiveCandidateLimit:64}},metadata:{retrievalBudgetReceipt:{elapsedMs:2,skippedChannels:[]}}};
  controller.observeRetrieval(session,envelope);controller.observeQuality(session,'HIGH');controller.evaluateJev(session,[]);controller.decidePrecision(session,{candidateCount:0,quality:'HIGH'});
  const receipt=controller.finalize(session,{assessment:{confidence:'HIGH',truthResults:[],admittedCandidateIds:[],supportCandidateIds:[]},publicationAssessment:{admittedCandidateIds:[],supportCandidateIds:[]},packet:{dependencies:['memory:r7']},sealReceipt:{sealedState:true,id:'seal:1',sequence:1,packetId:'packet:1',packetHash:'hash:1'},finishedAt:session.startedAt+5});
  assert.equal(receipt.functionDecisions.length,Object.values(CognitiveJob).length);
  assert.deepEqual(new Set(receipt.functionDecisions.map(row=>row.capability)),new Set(Object.values(CognitiveJob)));
  const retrieval=receipt.functionDecisions.find(row=>row.capability===CognitiveJob.RETRIEVAL),truth=receipt.functionDecisions.find(row=>row.capability===CognitiveJob.TRUTH);
  assert.equal(retrieval.disposition,CognitiveDisposition.ADMITTED);assert.equal(truth.disposition,CognitiveDisposition.ADMITTED);
  assert.ok(retrieval.metadata.sourceFence.sourceRevisionRefs.includes('memory:r7'));
  assert.equal(retrieval.metadata.physicalExecutionClaimed,false);
  assert.equal(receipt.executionPlan.physicalExecutionClaimed,false);
  assert.ok(receipt.executionPlan.ownerNeeds.some(row=>row.needId==='need:retrieval'));
});

test('Worker 1 #225 quiet continuation records bounded skips rather than waking every worker',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({chatId:'chat:q',turnId:'q:1',generationId:'g:q:1',query:'Continue',scene:scene('quiet'),executionLabel:'DETERMINISTIC'});
  const choice=brain.uiBindings().readCognitiveChoice({chatId:'chat:q',turnId:'q:1',generationId:'g:q:1'});
  assert.ok(choice.functionDecisions.length===Object.values(CognitiveJob).length);
  assert.ok(choice.skippedJobs.includes(CognitiveJob.RETRIEVAL));
  assert.ok(choice.reasonCodes.includes(CognitiveReason.HOT_SUFFICIENT));
  assert.equal(choice.executionPlan.physicalExecutionClaimed,false);
});

test('Worker 1 #262 scheduled work is not execution and DONE requires explicit owner admission',async()=>{
  const persistence=new MemoryPersistenceAdapter(),director=new WorkerDirector({persistence,capacity:{CPU:1},foregroundReserve:{CPU:1}});
  director.registerWorker({workerId:'local',capabilities:[CAPABILITIES.CPU_ANALYSIS],supportedLayers:['L2'],resourceProfile:{CPU:1},provider:'AREA52_NATIVE',implementationId:'test',concurrencyCapacity:1,foregroundEligible:true,backgroundEligible:true});
  const reconciler=new CognitiveObligationReconciler({director});
  reconciler.declare({expectedId:'scene:episode',owner:'SCENE',ownerSignalId:'scene-signal:r2',cause:{chatId:'chat:l',turnId:'turn:l',generationId:'gen:l',correlationId:'corr:l',sceneRevision:2,worldRevision:8,sourceRevisionRefs:['scene:r2']},obligation:{taskType:'SCENE_EPISODE',layer:'L2',runtimeClass:'NEARLINE',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'scene:episode:r2'}},{execute:async()=>[{ok:true}],validate:async()=>true,commit:async()=>({output:{receiptId:'scene-result:1'},validation:{valid:true}})});
  const admitted=reconciler.reconcile('scene:episode');
  assert.equal(admitted.status,'DUE');assert.equal(admitted.reasonCode,'LOGICAL_ADMISSION_ONLY');
  const task=director.ledger.get(admitted.taskId);assert.ok(task.causalReceipts.some(row=>row.eventKind===CausalReceiptKind.OBLIGATION_ADMITTED));assert.ok(!task.causalReceipts.some(row=>row.eventKind===CausalReceiptKind.PHYSICAL_EXECUTION_STARTED));
  await director.drain({maxCycles:32});
  const returned=reconciler.reconcile('scene:episode',{admit:false});
  assert.equal(returned.status,'DUE');assert.ok(returned.evidenceStages.some(row=>row.eventKind===CausalReceiptKind.RESULT_RETURNED));
  director.recordOwnerAdmission(task.taskId,{accepted:true,receiptId:'scene-owner:accepted'});
  const done=reconciler.reconcile('scene:episode',{admit:false});
  assert.equal(done.status,'DONE');assert.equal(done.reasonCode,'OWNER_ACCEPTED');
});

test('Worker 1 #262 owner-declared skip/defer/block are finite and do not invent work',()=>{
  const director=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:1}}),reconciler=new CognitiveObligationReconciler({director});
  reconciler.declare({expectedId:'lore:none',owner:'LORE',ownerSignalId:'lore:r1',disposition:'SKIP',reasonCode:'OWNER_DECLARED_NO_WORK'});
  reconciler.declare({expectedId:'memory:later',owner:'MEMORY',ownerSignalId:'memory:r1',disposition:'DEFER',reasonCode:'OWNER_DEFERRED'});
  reconciler.declare({expectedId:'scene:blocked',owner:'SCENE',ownerSignalId:'scene:r1',prerequisites:['memory:later'],obligation:{taskType:'SCENE_TASK',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS]}});
  assert.equal(reconciler.reconcile('lore:none').status,'SKIPPED_WITH_REASON');
  assert.equal(reconciler.reconcile('memory:later').status,'DEFERRED');
  assert.equal(reconciler.reconcile('scene:blocked').status,'BLOCKED');
  assert.equal(director.ledger.list().length,0);
});

test('Worker 1 #262 causal execution evidence survives Runtime ledger reload without prompt or story payloads',async()=>{
  const persistence=new MemoryPersistenceAdapter(),director=new WorkerDirector({persistence,capacity:{CPU:1},foregroundReserve:{CPU:1}});
  director.registerWorker({workerId:'local',capabilities:[CAPABILITIES.CPU_ANALYSIS],supportedLayers:['L2'],resourceProfile:{CPU:1},provider:'AREA52_NATIVE',implementationId:'test',concurrencyCapacity:1,foregroundEligible:true,backgroundEligible:true});
  const admission=director.submit({taskType:'MEMORY_LEARN',owner:'MEMORY',producerId:'MEMORY',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'memory:learn:1',cause:{chatId:'chat:r',turnId:'turn:r',generationId:'gen:r',correlationId:'corr:r',sourceRevisionRefs:['narrative:r1'],worldRevision:2,sceneRevision:1}},{execute:async()=>['ok'],validate:async()=>true,commit:async()=>({output:{privateBody:'not-copied-to-causal'},validation:{valid:true}})});
  await director.drain({maxCycles:32});director.recordOwnerAdmission(admission.task.taskId,{accepted:true,receiptId:'memory-owner:1'});
  const restored=new WorkerDirector({persistence,capacity:{CPU:1},foregroundReserve:{CPU:1}});
  const record=restored.ledger.get(admission.task.taskId),json=JSON.stringify(record.causalReceipts);
  assert.ok(record.causalReceipts.some(row=>row.eventKind===CausalReceiptKind.PHYSICAL_EXECUTION_STARTED));
  assert.ok(record.causalReceipts.some(row=>row.eventKind===CausalReceiptKind.OWNER_ADMISSION&&row.ownerAccepted===true));
  assert.doesNotMatch(json,/privateBody|rawPrompt|story body|credential/i);
  assert.equal(record.obligation.cause.generationId,'gen:r');
});

test('Worker 1 #263 selected-turn receipt publishes explicit NO_EVIDENCE and never fabricates Scatter execution',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({chatId:'chat:c',turnId:'c:1',generationId:'g:c:1',query:'Continue',scene:scene('causal'),executionLabel:'DETERMINISTIC'});
  const binding=brain.uiBindings(),selection=binding.readSelection({chatId:'chat:c'}),receipt=binding.readSelectedTurnReceipt(selection),scatter=binding.readScatter(selection);
  assert.equal(receipt.contractVersion,2);
  assert.equal(receipt.producers.hostObservation.status,'NO_EVIDENCE');
  assert.equal(receipt.producers.delivery.status,'NO_EVIDENCE');
  assert.ok(receipt.causalOwnerEvents.some(row=>row.stage==='hostObservation'&&row.status==='NO_EVIDENCE'));
  assert.ok(scatter.jobs.every(row=>row.status==='ADMITTED_LOGICAL'&&row.physicalExecutionEvidence==='NO_EVIDENCE'));
  assert.equal(scatter.resourceCount,0);
  assert.equal(receipt.rawPromptIncluded,false);assert.equal(receipt.credentialsIncluded,false);assert.equal(receipt.hiddenReasoningIncluded,false);
});

test('Worker 1 #263 chat switch and regeneration fences do not cross-fill selected-turn evidence',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({chatId:'chat:a',turnId:'a:1',generationId:'g:a:1',query:'Continue',scene:scene('a'),executionLabel:'DETERMINISTIC'});
  await brain.prepareTurn({chatId:'chat:b',turnId:'b:1',generationId:'g:b:1',query:'Continue',scene:scene('b'),executionLabel:'DETERMINISTIC'});
  const ui=brain.uiBindings(),a=ui.readSelectedTurnReceipt({chatId:'chat:a',turnId:'a:1',generationId:'g:a:1'});
  assert.equal(a.chatId,'chat:a');assert.equal(a.generationId,'g:a:1');
  assert.equal(ui.readSelectedTurnReceipt({chatId:'chat:a',turnId:'a:1',generationId:'g:a:regen'}),null);
});

test('Worker 1 #264 provider chat rendering maps semantic context to supported roles and preserves Seal identity',()=>{
  const seal=new GenerationContextSeal(),sealed=seal.seal({turnId:'turn:role',worldRevision:1,sourceRevisionIds:['src:r1'],packet:{current:[{id:'fact:1',text:'Fact',sourceRevisionIds:['src:r1']}],historical:[],unresolved:[],activeThreads:[],relevantLore:[],episodicMemory:[],dependencies:['src:r1']}});
  const delivery=new ContextDeliveryEngine().deliver({sealedPacket:sealed.packet,sealReceipt:sealed.receipt,generationId:'gen:role',turnId:'turn:role',budgetTokens:1024,userInput:'Continue',providerId:'OpenRouter'});
  assert.equal(delivery.ok,true);
  assert.ok(delivery.rendered.messages.every(message=>['system','user','assistant'].includes(message.role)));
  assert.ok(delivery.rendered.messageMap.some(row=>row.semanticRole==='context'&&row.providerRole==='system'));
  assert.equal(delivery.rendered.sealedPacketHash,sealed.receipt.packetHash);
  assert.deepEqual(delivery.receipt.unsupportedProviderRoles,[]);
});
