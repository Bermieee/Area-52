import test from 'node:test';
import assert from 'node:assert/strict';
import {Area52NativeBrain} from '../src/native-brain.js';
import {CognitiveChoiceController} from '../src/cognitive-choice-controller.js';
import {CognitiveDisposition,CognitiveJob,CognitiveReason} from '../src/cognitive-choice-contracts.js';
import {ContextDeliveryEngine} from '../src/adaptive-context-runtime.js';
import {GenerationContextSeal} from '../src/context-seal.js';
import {CAPABILITIES,CausalReceiptKind,causalObligationMatchesSelection,CognitiveObligationReconciler,CognitiveRuntimeHost,MemoryPersistenceAdapter,WorkerDirector} from '../src/runtime/index.js';

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
  assert.doesNotMatch(json,/privateBody|story body/i);
  assert.ok(record.causalReceipts.every(row=>row.rawPromptIncluded===false&&row.credentialsIncluded===false&&row.hiddenReasoningIncluded===false));
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
  const first=await brain.prepareTurn({chatId:'chat:a',turnId:'a:1',generationId:'g:a:1',query:'Continue',scene:scene('a'),executionLabel:'DETERMINISTIC'});
  await brain.prepareTurn({chatId:'chat:b',turnId:'b:1',generationId:'g:b:1',query:'Continue',scene:scene('b'),executionLabel:'DETERMINISTIC'});
  const ui=brain.uiBindings(),a=ui.readSelectedTurnReceipt({chatId:'chat:a',turnId:'a:1',generationId:'g:a:1'});
  assert.equal(a.chatId,'chat:a');assert.equal(a.generationId,'g:a:1');
  assert.equal(ui.readSelectedTurnReceipt({chatId:'chat:a',turnId:'a:1',generationId:'g:a:regen'}),null);
  const obligation={cause:{chatId:'chat:a',turnId:'a:1',generationId:'g:a:1',correlationId:first.selection.correlationId,worldRevision:first.selection.worldRevision,sceneRevision:first.selection.sceneRevision}};
  assert.equal(causalObligationMatchesSelection(obligation,first.selection),true);
  assert.equal(causalObligationMatchesSelection(obligation,{...first.selection,generationId:'g:a:regen'}),false);
  assert.equal(causalObligationMatchesSelection(obligation,{...first.selection,chatId:'chat:b'}),false);
});

test('Worker 1 #264 provider chat rendering maps semantic context to supported roles and preserves Seal identity',()=>{
  const seal=new GenerationContextSeal(),sealed=seal.seal({turnId:'turn:role',correlationId:'corr:role',worldRevision:1,sourceRevisionIds:['src:r1'],packet:{id:'packet:role',current:[{id:'fact:1',text:'Fact',sourceRevisionIds:['src:r1']}],historical:[],unresolved:[],activeThreads:[],relevantLore:[],episodicMemory:[],dependencies:['src:r1']}});
  const delivery=new ContextDeliveryEngine().deliver({sealedPacket:sealed.packet,sealReceipt:sealed.receipt,generationId:'gen:role',turnId:'turn:role',budgetTokens:1024,userInput:'Continue',providerId:'OpenRouter'});
  assert.equal(delivery.ok,true);
  assert.ok(delivery.rendered.messages.every(message=>['system','user','assistant'].includes(message.role)));
  assert.ok(delivery.rendered.messageMap.some(row=>row.semanticRole==='context'&&row.providerRole==='system'));
  assert.equal(delivery.rendered.sealedPacketHash,sealed.receipt.packetHash);
  assert.deepEqual(delivery.receipt.unsupportedProviderRoles,[]);
});

test('Worker 1 #262 expected owner declarations survive reload without inventing an executor',()=>{
  const director=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:1}}),reconciler=new CognitiveObligationReconciler({director});
  reconciler.declare({expectedId:'memory:post-turn',owner:'MEMORY',ownerSignalId:'memory:completed-generation',cause:{chatId:'chat:p',turnId:'turn:p',generationId:'gen:p',correlationId:'corr:p',worldRevision:4,sceneRevision:2,sourceRevisionRefs:['narrative:r4']},obligation:{taskType:'MEMORY_POST_TURN',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'memory:post-turn:r4'}});
  const restored=new CognitiveObligationReconciler({director,snapshot:JSON.parse(JSON.stringify(reconciler.snapshot()))});
  const receipt=restored.list()[0];
  assert.equal(receipt.expectedId,'memory:post-turn');assert.equal(receipt.status,'DUE');assert.equal(receipt.reasonCode,'TASK_NOT_ADMITTED');
  assert.equal(receipt.cause.generationId,'gen:p');assert.deepEqual(receipt.cause.sourceRevisionRefs,['narrative:r4']);
});

test('Worker 1 #263 exact host observation and delivery evidence complete the selected-turn causal trace without raw prompt telemetry',async()=>{
  const brain=new Area52NativeBrain();
  const prepared=await brain.prepareTurn({chatId:'chat:trace',turnId:'trace:1',generationId:'gen:trace:1',query:'Continue',scene:scene('trace'),providerId:'OpenRouter',executionLabel:'DETERMINISTIC'});
  brain.recordHostObservationEvidence('trace:1',{eventId:'host:trace:1',chatId:'chat:trace',turnId:'trace:1',generationId:'gen:trace:1',correlationId:prepared.selection.correlationId,worldRevision:prepared.selection.worldRevision,sceneRevision:prepared.selection.sceneRevision,durationMs:3});
  const delivery=brain.recordObservedHostPromptEvidence('trace:1',{host:'SILLYTAVERN',chatId:'chat:trace',turnId:'trace:1',generationId:'gen:trace:1',correlationId:prepared.selection.correlationId,contextSealId:prepared.contextSealReceipt.id,sealedPacketHash:prepared.promptDeliveryReceipt.sealedPacketHash,semanticManifestIdentity:prepared.promptDeliveryReceipt.semanticManifestIdentity,requestId:'request:trace:1',observedRoles:[...new Set(prepared.rendered.messages.map(row=>row.role))],observedSections:prepared.rendered.messageMap.map(row=>row.slot),live:false});
  assert.equal(delivery.status,'OBSERVED_MATCH');assert.equal(delivery.observedHostDelivery.identityCompatible,true);
  await brain.completeTurn({turnId:'trace:1',response:'The scene continues.'});
  const trace=brain.uiBindings().readSelectedTurnReceipt({chatId:'chat:trace',turnId:'trace:1',generationId:'gen:trace:1'});
  assert.equal(trace.producers.hostObservation.status,'PUBLISHED');assert.equal(trace.producers.delivery.status,'OBSERVED');assert.equal(trace.producers.delivery.matching,true);assert.equal(trace.producers.learning.status,'PUBLISHED');
  assert.equal(trace.rawPromptIncluded,false);assert.equal(trace.storyTextIncluded,false);assert.equal(trace.credentialsIncluded,false);assert.equal(trace.hiddenReasoningIncluded,false);
});

test('Worker 1 #263/#264 host delivery evidence rejects cross-generation identity and low-level receipt records mismatch',async()=>{
  const brain=new Area52NativeBrain();
  const prepared=await brain.prepareTurn({chatId:'chat:id',turnId:'id:1',generationId:'gen:id:1',query:'Continue',scene:scene('id'),providerId:'OpenRouter',executionLabel:'DETERMINISTIC'});
  const mismatch=brain.attachObservedHostPromptEvidence(prepared.promptDeliveryReceipt,{chatId:'chat:id',turnId:'id:1',generationId:'gen:wrong',contextSealId:prepared.contextSealReceipt.id,sealedPacketHash:prepared.promptDeliveryReceipt.sealedPacketHash,semanticManifestIdentity:prepared.promptDeliveryReceipt.semanticManifestIdentity,observedRoles:['system','user']});
  assert.equal(mismatch.status,'OBSERVED_MISMATCH');assert.equal(mismatch.observedHostDelivery.identityCompatible,false);
  assert.throws(()=>brain.recordObservedHostPromptEvidence('id:1',{generationId:'gen:wrong'}),/HOST_DELIVERY_IDENTITY_MISMATCH:generationId/);
});

test('Worker 1 #263 Scatter maps physical Runtime evidence only when an exact turn/generation task actually ran',async()=>{
  const brain=new Area52NativeBrain();
  const prepared=await brain.prepareTurn({chatId:'chat:scatter',turnId:'scatter:1',generationId:'gen:scatter:1',query:'Recall where the archive was before this scene.',intent:'TEMPORAL',scene:scene('scatter',2,{relationship:'PRECEDES'}),executionLabel:'DETERMINISTIC'});
  assert.ok(prepared.cognitiveChoice.admittedJobs.includes('RETRIEVAL'));
  const admission=brain.runtimeDirector.submit({taskType:'RETRIEVAL',owner:'COGNITIVE_CORE',producerId:'COGNITIVE_CHOICE',layer:'L1',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'scatter:physical:retrieval',cause:{chatId:'chat:scatter',turnId:'scatter:1',generationId:'gen:scatter:1',correlationId:prepared.selection.correlationId,worldRevision:prepared.selection.worldRevision,sceneRevision:prepared.selection.sceneRevision,sourceRevisionRefs:prepared.selection.sourceRevisionRefs}},{execute:async()=>['ok'],validate:async()=>true,commit:async()=>({output:{receiptId:'retrieval:return:1'},validation:{valid:true}})});
  await brain.runtimeDirector.drain({maxCycles:32});brain.runtimeDirector.recordOwnerAdmission(admission.task.taskId,{accepted:true,receiptId:'retrieval:owner:1'});
  const scatter=brain.uiBindings().readScatter({chatId:'chat:scatter',turnId:'scatter:1',generationId:'gen:scatter:1'}),retrieval=scatter.jobs.find(row=>row.jobId==='RETRIEVAL');
  assert.equal(retrieval.physicalExecutionEvidence,'EVIDENCE');assert.ok(retrieval.taskIds.includes(admission.task.taskId));assert.equal(retrieval.status,'LATE');assert.ok(scatter.resourceCount>=1);
});

test('Worker 1 Scatter load probe measures eager pre-Seal queue pressure without changing routing policy',()=>{
  const director=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:1}}),host=new CognitiveRuntimeHost({director});
  const turn={turnId:'turn:load',eventId:'event:load',correlationId:'corr:load',sourceRevisionSet:['scene:load:r1'],worldRevision:1,sceneRevision:1,characterStateRevision:1,createdAt:1,deadline:9999999999999,cognitiveLayer:'L1',dedupeKey:'turn:load'};
  const mk=(id,resultClass,layer='L1')=>({taskId:'load:'+id,taskType:id.toUpperCase(),turnId:turn.turnId,correlationId:turn.correlationId,requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],resultClass,cognitiveLayer:layer,dedupeKey:'load:'+id});
  const jobs=[mk('retrieval','REQUIRED'),mk('truth','REQUIRED'),mk('historian','OPPORTUNISTIC'),mk('graph','OPPORTUNISTIC'),mk('jev','OPPORTUNISTIC'),mk('precision','OPPORTUNISTIC'),mk('deep-a','DEFERRED','L3'),mk('deep-b','DEFERRED','L3'),mk('deep-c','DEFERRED','L3')];
  const layered=host.native.layeredScatterPlan(jobs),published=host.publishTurn(turn,jobs),snapshot=director.snapshot(),initialQueued=Object.values(snapshot.queueDepth).reduce((sum,n)=>sum+n,0),nonRequired=published.cohort.opportunistic.length+published.cohort.deferred.length;
  assert.equal(initialQueued,jobs.length);assert.equal(nonRequired,7);assert.equal(published.cohort.required.length,2);
  assert.deepEqual(layered.sealCritical.map(row=>row.taskId).sort(),published.cohort.required.slice().sort());assert.equal(layered.counts.sealCritical,2);assert.equal(layered.counts.conditional,4);assert.equal(layered.counts.postSeal,3);assert.equal(layered.jobCountIgnored,true);assert.equal(layered.schedulingActivated,false);
  console.log('WORKER1_SCATTER_LOAD_METRIC '+JSON.stringify({admitted:jobs.length,required:published.cohort.required.length,opportunistic:published.cohort.opportunistic.length,deferred:published.cohort.deferred.length,eagerPreSealQueued:initialQueued,layeredPreSealQueued:layered.counts.sealCritical,projectedPreSealQueueReduction:initialQueued-layered.counts.sealCritical,sealCriticalSetUnchanged:true,policyChanged:false}));
  host.native.close();
});

test('Worker 1 layered Scatter probe cuts pre-Seal queue pressure without adding foreground provider work',async()=>{
  const run=async(label,{layered=false}={})=>{
    const director=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:0}}),host=new CognitiveRuntimeHost({director}),invocations=[];
    host.registerExecutionResource({
      worker:{workerId:'scatter-probe:'+label,capabilities:[CAPABILITIES.CPU_ANALYSIS],supportedLayers:['L1','L3'],resourceProfile:{CPU:1},concurrencyCapacity:1,latencyScore:1,provider:'AREA52_NATIVE',implementationId:'scatter-probe',foregroundEligible:true,backgroundEligible:true},
      adapter:{async invoke({job}){invocations.push({taskId:job.taskId,resultClass:job.resultClass});return{ok:true};}},
    });
    const turn={turnId:'turn:scatter-probe:'+label,eventId:'event:scatter-probe:'+label,correlationId:'corr:scatter-probe:'+label,sourceRevisionSet:['scene:scatter:r1'],worldRevision:1,sceneRevision:1,characterStateRevision:1,createdAt:1,deadline:9999999999999,cognitiveLayer:'L1',dedupeKey:'turn:scatter-probe:'+label};
    const mk=(id,resultClass,layer='L1')=>({taskId:label+':'+id,taskType:id.toUpperCase(),turnId:turn.turnId,correlationId:turn.correlationId,requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],resultClass,cognitiveLayer:layer,dedupeKey:label+':'+id});
    const jobs=[mk('retrieval','REQUIRED'),mk('truth','REQUIRED'),mk('historian','OPPORTUNISTIC'),mk('graph','OPPORTUNISTIC'),mk('jev','OPPORTUNISTIC'),mk('precision','OPPORTUNISTIC'),mk('deep-a','DEFERRED','L3'),mk('deep-b','DEFERRED','L3'),mk('deep-c','DEFERRED','L3')];
    const plan=host.native.layeredScatterPlan(jobs),submitted=layered?jobs.filter(job=>plan.sealCritical.some(row=>row.taskId===job.taskId)):jobs;
    host.publishTurn(turn,submitted);
    const peakQueued=Object.values(director.snapshot().queueDepth).reduce((sum,n)=>sum+n,0);
    const quorum=await host.native.awaitForeground(turn.turnId);
    const invocationsAtSeal=invocations.length,openAtSeal=director.lifecycle.listOpen().length;
    host.native.close();
    return{peakQueued,invocationsAtSeal,openAtSeal,requiredSatisfied:[...(quorum.requiredSatisfied??[])].sort(),plan};
  };
  const eager=await run('eager'),layered=await run('layered',{layered:true});
  assert.equal(eager.peakQueued,9);assert.equal(layered.peakQueued,2);
  assert.equal(eager.invocationsAtSeal,2);assert.equal(layered.invocationsAtSeal,2);
  assert.equal(eager.requiredSatisfied.length,2);assert.equal(layered.requiredSatisfied.length,2);
  assert.equal(layered.plan.counts.conditional,4);assert.equal(layered.plan.counts.postSeal,3);assert.equal(layered.plan.schedulingActivated,false);
  console.log('WORKER1_LAYERED_SCATTER_EXECUTION_METRIC '+JSON.stringify({eagerPeakQueued:eager.peakQueued,layeredPeakQueued:layered.peakQueued,queueReduction:eager.peakQueued-layered.peakQueued,eagerProviderInvocationsAtSeal:eager.invocationsAtSeal,layeredProviderInvocationsAtSeal:layered.invocationsAtSeal,foregroundProviderWorkDelta:layered.invocationsAtSeal-eager.invocationsAtSeal,eagerOpenAtSeal:eager.openAtSeal,layeredOpenAtSeal:layered.openAtSeal,productionRoutingChanged:false}));
});

test('Worker 1 #262 real Scene retrieval need reconciles physical/result evidence but waits for explicit Scene owner admission',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({chatId:'chat:scene-owner',turnId:'scene-owner:1',generationId:'gen:scene-owner:1',query:'Continue',scene:scene('hall',1),executionLabel:'DETERMINISTIC'});
  const prepared=await brain.prepareTurn({chatId:'chat:scene-owner',turnId:'scene-owner:2',generationId:'gen:scene-owner:2',query:'Where are we now?',scene:scene('archive',2,{relationship:'PRECEDES'}),executionLabel:'DETERMINISTIC'});
  const expected=brain.uiBindings().readExpectedWork({chatId:'chat:scene-owner',turnId:'scene-owner:2',generationId:'gen:scene-owner:2'});
  const row=expected.items.find(item=>item.owner==='SCENE');assert.ok(row);assert.equal(row.status,'DUE');assert.ok(row.evidenceStages.some(e=>e.eventKind===CausalReceiptKind.PHYSICAL_EXECUTION_STARTED));assert.ok(row.evidenceStages.some(e=>e.eventKind===CausalReceiptKind.RESULT_RETURNED));assert.ok(row.missingEvidence.includes('OWNER_ADMISSION'));
  assert.ok(prepared.cognitiveChoice.admittedJobs.includes('RETRIEVAL'));
});

test('Worker 1 #262 real Lore revision signal registers its declared study obligation without inventing execution',()=>{
  const brain=new Area52NativeBrain();
  brain.acceptLoreRevisionChange({kind:'LoreSourceRevisionChanged',sourceId:'lore:owner:1',lorebookId:'book:1',uid:'7',sourceRevisionId:'lore:owner:1@2',contentHash:'hash:2',studyObligationId:'study:7',studyTrigger:'SOURCE_REVISION_CHANGED'});
  const row=brain.listExpectedCognitiveWork().find(item=>item.expectedId==='lore-study:study:7');assert.ok(row);assert.equal(row.owner,'LORE');assert.equal(row.status,'DUE');assert.equal(row.reasonCode,'TASK_NOT_ADMITTED');assert.equal(row.evidenceStages.length,0);
});

test('Worker 1 #262 real Memory owner writeback completes only after returned ADMITTED owner receipt',async()=>{
  const memory={contractVersion:'1.0.0',queryHistorian:()=>({nominations:[]}),drillDown:()=>[],admitExternalEvidenceMapping:()=>({kind:'MemoryExternalEvidenceMappingReceipt',status:'ADMITTED',receiptId:'memory:owner:admitted'})};
  const brain=new Area52NativeBrain({memoryInterface:memory});
  await brain.prepareTurn({chatId:'chat:memory-owner',turnId:'memory-owner:1',generationId:'gen:memory-owner:1',query:'Continue',scene:scene('memory'),executionLabel:'DETERMINISTIC'});
  await brain.completeTurn({turnId:'memory-owner:1',response:'The scene continues.'});
  const expected=brain.uiBindings().readExpectedWork({chatId:'chat:memory-owner',turnId:'memory-owner:1',generationId:'gen:memory-owner:1'}),row=expected.items.find(item=>item.owner==='MEMORY');
  assert.ok(row);assert.equal(row.status,'DONE');assert.equal(row.reasonCode,'OWNER_ACCEPTED');assert.ok(row.evidenceStages.some(e=>e.eventKind===CausalReceiptKind.PHYSICAL_EXECUTION_STARTED));assert.ok(row.evidenceStages.some(e=>e.eventKind===CausalReceiptKind.RESULT_RETURNED));assert.ok(row.evidenceStages.some(e=>e.eventKind===CausalReceiptKind.OWNER_ADMISSION&&e.ownerAccepted===true));
});

test('Worker 1 #262 absent optional Memory owner is a finite skip and does not break native learning',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({chatId:'chat:memory-native',turnId:'memory-native:1',generationId:'gen:memory-native:1',query:'Continue',scene:scene('memory-native'),executionLabel:'DETERMINISTIC'});
  const learning=await brain.completeTurn({turnId:'memory-native:1',response:'Native learning remains available.'});assert.ok(learning.experienceId);
  const expected=brain.uiBindings().readExpectedWork({chatId:'chat:memory-native',turnId:'memory-native:1',generationId:'gen:memory-native:1'}),row=expected.items.find(item=>item.owner==='MEMORY');
  assert.ok(row);assert.equal(row.status,'SKIPPED_WITH_REASON');assert.equal(row.reasonCode,'OPTIONAL_RESOURCE_UNAVAILABLE');
});

test('Worker 1 #262 direct owner rejection is durable FAILED evidence rather than owner acceptance',()=>{
  const persistence=new MemoryPersistenceAdapter(),director=new WorkerDirector({persistence,capacity:{CPU:1},foregroundReserve:{CPU:1}}),reconciler=new CognitiveObligationReconciler({director});
  reconciler.declare({expectedId:'scene:reject',owner:'SCENE',ownerSignalId:'scene:signal:reject',cause:{chatId:'chat:reject',turnId:'turn:reject',generationId:'gen:reject',correlationId:'corr:reject',sourceRevisionRefs:['scene:r9'],worldRevision:9,sceneRevision:9},obligation:{taskType:'SCENE_RETRIEVAL_NEED',layer:'L1',requiredCapabilities:['RETRIEVAL'],dedupeKey:'scene:reject'}});
  reconciler.recordEvidence('scene:reject',{kind:CausalReceiptKind.PHYSICAL_EXECUTION_STARTED,producerId:'SENSORY_NET',consumerId:'SCENE'});
  reconciler.recordEvidence('scene:reject',{kind:CausalReceiptKind.RESULT_RETURNED,producerId:'SENSORY_NET',consumerId:'SCENE'});
  reconciler.recordEvidence('scene:reject',{kind:CausalReceiptKind.OWNER_REJECTED,producerId:'SCENE',consumerId:'COGNITIVE_STATE',ownerAccepted:false});
  const failed=reconciler.reconcile('scene:reject',{admit:false});assert.equal(failed.status,'FAILED');assert.equal(failed.reasonCode,'OWNER_REJECTED');
  const restored=new CognitiveObligationReconciler({director,snapshot:JSON.parse(JSON.stringify(reconciler.snapshot()))}),after=restored.reconcile('scene:reject',{admit:false});
  assert.equal(after.status,'FAILED');assert.ok(after.evidenceStages.some(e=>e.eventKind===CausalReceiptKind.OWNER_REJECTED&&e.ownerAccepted===false));
});

test('Worker 1 #262 direct physical/result evidence survives reconciler reload while missing owner admission stays DUE',()=>{
  const director=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:1}}),reconciler=new CognitiveObligationReconciler({director});
  reconciler.declare({expectedId:'lore:direct',owner:'LORE',ownerSignalId:'lore:signal',cause:{sourceRevisionRefs:['lore:r2'],worldRevision:3},obligation:{taskType:'LORE_STUDY',layer:'L2',requiredCapabilities:['LORE_STUDY'],dedupeKey:'lore:direct'}});
  reconciler.recordEvidence('lore:direct',{kind:CausalReceiptKind.PHYSICAL_EXECUTION_STARTED,producerId:'LORE',consumerId:'RUNTIME_CORE'});
  reconciler.recordEvidence('lore:direct',{kind:CausalReceiptKind.RESULT_RETURNED,producerId:'LORE',consumerId:'RUNTIME_CORE'});
  const restored=new CognitiveObligationReconciler({director,snapshot:JSON.parse(JSON.stringify(reconciler.snapshot()))}),row=restored.reconcile('lore:direct',{admit:false});
  assert.equal(row.status,'DUE');assert.equal(row.reasonCode,'NO_EVIDENCE');assert.ok(row.missingEvidence.includes('OWNER_ADMISSION'));assert.equal(row.evidenceStages.length,2);
});

test('Worker 1 #262 Memory cannot infer owner acceptance when adapter returns no owner receipt',async()=>{
  const memory={contractVersion:'1.0.0',queryHistorian:()=>({nominations:[]}),drillDown:()=>[],admitExternalEvidenceMapping:()=>undefined};
  const brain=new Area52NativeBrain({memoryInterface:memory});
  await brain.prepareTurn({chatId:'chat:memory-no-receipt',turnId:'memory-no-receipt:1',generationId:'gen:memory-no-receipt:1',query:'Continue',scene:scene('memory-no-receipt'),executionLabel:'DETERMINISTIC'});
  await brain.completeTurn({turnId:'memory-no-receipt:1',response:'No owner receipt was emitted.'});
  const expected=brain.uiBindings().readExpectedWork({chatId:'chat:memory-no-receipt',turnId:'memory-no-receipt:1',generationId:'gen:memory-no-receipt:1'}),row=expected.items.find(item=>item.owner==='MEMORY');
  assert.ok(row);assert.equal(row.status,'DUE');assert.equal(row.reasonCode,'NO_EVIDENCE');assert.ok(row.evidenceStages.some(e=>e.eventKind===CausalReceiptKind.PHYSICAL_EXECUTION_STARTED));assert.equal(row.evidenceStages.some(e=>e.eventKind===CausalReceiptKind.OWNER_ADMISSION),false);
});

test('Worker 1 #263 Runtime result envelope preserves causal chat/generation/revision fences when obligation fields are absent',async()=>{
  const captured=[];
  const director=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:1},resultSink:(row)=>captured.push(row)});
  director.registerWorker({workerId:'local-fence',capabilities:[CAPABILITIES.CPU_ANALYSIS],supportedLayers:['L1'],resourceProfile:{CPU:1},provider:'AREA52_NATIVE',implementationId:'fence-test',concurrencyCapacity:1,foregroundEligible:true,backgroundEligible:true});
  director.submit({taskType:'FENCE_TEST',owner:'COGNITIVE_CORE',producerId:'COGNITIVE_CHOICE',layer:'L1',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'fence:test',cause:{chatId:'chat:fence',turnId:'turn:fence',generationId:'gen:fence',correlationId:'corr:fence',eventId:'event:fence',sourceRevisionRefs:['scene:fence:r4'],worldRevision:7,sceneRevision:4}},{execute:async()=>['ok'],validate:async()=>true,commit:async()=>({output:{ok:true},validation:{valid:true}})});
  await director.drain({maxCycles:32});
  const result=captured.at(-1);assert.ok(result);assert.equal(result.chatId,'chat:fence');assert.equal(result.turnId,'turn:fence');assert.equal(result.generationId,'gen:fence');assert.equal(result.correlationId,'corr:fence');assert.equal(result.causationId,'event:fence');assert.deepEqual(result.sourceRevisionIds,['scene:fence:r4']);assert.equal(result.worldRevision,7);assert.equal(result.sceneRevision,4);
});

test('Worker 1 #262 direct causal evidence stays bounded with monotonic unique receipt IDs across reload',()=>{
  const director=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:1}}),reconciler=new CognitiveObligationReconciler({director});
  reconciler.declare({expectedId:'memory:bounded',owner:'MEMORY',ownerSignalId:'memory:bounded:signal',cause:{chatId:'chat:bounded',turnId:'turn:bounded',generationId:'gen:bounded',correlationId:'corr:bounded'},obligation:{taskType:'MEMORY_BOUNDED',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'memory:bounded'}});
  for(let i=0;i<70;i++)reconciler.recordEvidence('memory:bounded',{kind:CausalReceiptKind.PHYSICAL_EXECUTION_STARTED,producerId:'MEMORY',consumerId:'RUNTIME_CORE',metadata:{index:i}});
  const snap=reconciler.snapshot(),entry=snap.entries.find(row=>row.declaration.expectedId==='memory:bounded');assert.equal(entry.evidence.length,64);assert.equal(new Set(entry.evidence.map(row=>row.id)).size,64);assert.equal(entry.evidenceSequence,70);
  const restored=new CognitiveObligationReconciler({director,snapshot:JSON.parse(JSON.stringify(snap))});
  const next=restored.recordEvidence('memory:bounded',{kind:CausalReceiptKind.RESULT_RETURNED,producerId:'MEMORY',consumerId:'RUNTIME_CORE'});assert.match(next.id,/:e71:RESULT_RETURNED$/);
  const after=restored.snapshot().entries.find(row=>row.declaration.expectedId==='memory:bounded');assert.equal(after.evidence.length,64);assert.equal(new Set(after.evidence.map(row=>row.id)).size,64);assert.equal(after.evidenceSequence,71);
});
