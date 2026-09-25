import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CapabilityProfileRegistry, CognitiveSwarm, CoprocessorTelemetry, DeterministicContextSealFixture,
  DynamicFanOutPlanner, ExecutionAdmissionGuard, NativeEventSpineBaseline, Placement, ProviderHealthModel,
  ProviderHealthState, RecordingResultBusFixture, RepresentativeTurnClass, ResultClass, ResultDestination,
  StructuredCompilerFixture, TelemetryEvent, TurnEventHub, Wave5MeasurementState, WidgetHealth,
  buildFt006CoprocessorMetrics, createCognitiveTask, createDeepCheckpoint, createForegroundQuorumPlan,
  createProviderExecutionRequest, createRevisionSet, createTurnEnvelope, createWorkerResult,
  daprBenchmarkStatus, evaluateDeepResume, evaluateForegroundQuorum, executionPlacementPolicy,
  hardDeadlineDisposition, lateResultDestination, negotiateCapabilities, normalizeProviderTransportResult,
  normalizeProviderUsageReceipt, projectCognitionUiState, qualifyDataPlaneTransports,
  summarizeRepresentativeSwarm, toRuntimeCapabilityDescriptor,
} from '../src/coprocessor/index.js';

function revision(worldRevision=3){
  return createRevisionSet({sourceRevisionSet:['src:r3'],worldRevision,sceneRevision:2,characterStateRevision:1});
}
function makeTask(overrides={}){
  return createCognitiveTask({
    taskId:overrides.taskId??'task:wave5',taskType:overrides.taskType??'TEST',turnId:'turn:wave5',correlationId:'corr:wave5',
    requiredCapabilities:overrides.requiredCapabilities??['CAP'],optionalCapabilities:overrides.optionalCapabilities??[],
    fallbackCapabilities:overrides.fallbackCapabilities??[],cognitiveLayer:overrides.cognitiveLayer??'L1',
    resultClass:overrides.resultClass??ResultClass.REQUIRED,inputRevisionSet:overrides.inputRevisionSet??revision(),
    softDeadline:overrides.softDeadline??40,hardDeadline:overrides.hardDeadline??80,placement:overrides.placement??Placement.HOT,
    compilerLane:'externalGrounding',intentFingerprint:'intent:wave5',
    batchMetadata:overrides.batchMetadata??{},metadata:overrides.metadata??{},
  });
}
function workerResult(t,{resultId='result:wave5',completedAt=10}={}){
  return createWorkerResult({
    resultId,taskId:t.taskId,turnId:t.turnId,correlationId:t.correlationId,workerId:'worker',providerId:'provider',
    capabilities:[...t.requiredCapabilities],payload:{ok:true},provenance:{fixture:'wave5'},confidence:1,
    freshnessIdentity:t.inputRevisionSet,inputRevisionSet:t.inputRevisionSet,intentFingerprint:t.intentFingerprint,
    startedAt:0,completedAt,authorityClass:'UNRESOLVED',
  });
}

test('Wave 5 capability profile exposes provider-neutral production fields',()=>{
  const registry=new CapabilityProfileRegistry();
  const profile=registry.register({
    providerProfileId:'profile:a',workerId:'slot:a',providerId:'provider:a',capabilities:['CAP'],
    capabilityVersions:{CAP:'2.1'},resourceClass:'GPU',latencyClass:'LOW',foregroundEligible:true,backgroundEligible:false,
    maxConcurrency:3,maxContext:32768,maxOutput:2048,structuredOutputSupport:true,estimatedCostClass:'LOW',local:true,
  });
  const runtime=toRuntimeCapabilityDescriptor(profile);
  assert.equal(profile.profileId,'profile:a');assert.equal(profile.providerProfileId,'profile:a');
  assert.equal(runtime.maxConcurrency,3);assert.equal(runtime.maxContext,32768);assert.equal(runtime.maxOutput,2048);
  assert.equal(runtime.resourceClass,'GPU');assert.equal(runtime.structuredOutputSupport,true);assert.equal(runtime.providerHealth,'HEALTHY');
  assert.equal(runtime.foregroundEligible,true);assert.equal(runtime.backgroundEligible,false);
});

test('capability negotiation returns interchangeable providers without scheduling',()=>{
  const registry=new CapabilityProfileRegistry();
  for(const id of ['a','b'])registry.register({profileId:id,providerId:'provider:'+id,capabilities:['CAP'],capabilityVersions:{CAP:2}});
  const result=negotiateCapabilities(registry,makeTask());
  assert.equal(result.status,'SATISFIED');assert.deepEqual(result.eligibleProfiles.map(x=>x.profileId),['a','b']);
  assert.equal(result.schedulingDecision,null);assert.equal(result.authorityGranted,false);
});

test('unavailable provider A leaves provider B eligible',()=>{
  const registry=new CapabilityProfileRegistry();
  registry.register({profileId:'a',capabilities:['CAP']});registry.register({profileId:'b',capabilities:['CAP']});
  registry.setAvailability('a',false);
  assert.deepEqual(negotiateCapabilities(registry,makeTask()).eligibleProfiles.map(x=>x.profileId),['b']);
});

test('fallback capability produces a DEGRADED eligible set',()=>{
  const registry=new CapabilityProfileRegistry();registry.register({profileId:'fallback',capabilities:['ALT']});
  const t=makeTask({requiredCapabilities:['PRIMARY'],fallbackCapabilities:['ALT']});
  const result=negotiateCapabilities(registry,t);
  assert.equal(result.status,'DEGRADED');assert.equal(result.degraded,true);
  assert.deepEqual(result.eligibleProfiles.map(x=>x.profileId),['fallback']);assert.deepEqual(t.requiredCapabilities,['PRIMARY']);
});

test('missing required capability blocks while missing optional capability does not',()=>{
  const registry=new CapabilityProfileRegistry();registry.register({profileId:'a',capabilities:['CAP']});
  const good=negotiateCapabilities(registry,makeTask({optionalCapabilities:['OPTIONAL']}));
  assert.equal(good.status,'SATISFIED');assert.deepEqual(good.missingRequirements.optionalCapabilities,['OPTIONAL']);
  const blocked=negotiateCapabilities(registry,makeTask({requiredCapabilities:['MISSING']}));
  assert.equal(blocked.status,'UNSATISFIED');assert.deepEqual(blocked.missingRequirements.requiredCapabilities,['MISSING']);
});

test('provider health models degrade, cooldown, probe, recovery and saturation',()=>{
  const telemetry=new CoprocessorTelemetry();
  const health=new ProviderHealthModel({windowSize:4,degradedFailureRate:.25,cooldownFailureRate:.5,cooldownMs:10,telemetry});
  health.register('p',{maxConcurrency:2});
  for(let i=0;i<3;i++)health.observe('p',{outcome:'SUCCESS',now:i});
  assert.equal(health.observe('p',{outcome:'FAILED',now:3}).health,ProviderHealthState.DEGRADED);
  assert.equal(health.observe('p',{outcome:'FAILED',now:4}).health,ProviderHealthState.COOLDOWN);
  assert.equal(health.beginProbe('p',{now:20}).health,ProviderHealthState.PROBE);
  assert.equal(health.completeProbe('p',{success:true,now:21}).health,ProviderHealthState.HEALTHY);
  assert.equal(health.setConcurrency('p',2,{now:22}).health,ProviderHealthState.SATURATED);
  assert.equal(telemetry.snapshot().providerHealth.p,'SATURATED');
});

test('provider execution request is minimum-necessary and reference-first',()=>{
  const request=createProviderExecutionRequest(makeTask(),{
    providerProfileId:'p',input:{query:'where',conversation:'DO_NOT_SEND'},
    sourceReferences:[{artifactId:'a',revision:2}],selectedContext:[{ref:'a',excerpt:'bounded evidence'}],
    diagnosticMetadata:{attempt:1,privateDiagnostics:'DO_NOT_SEND'},
  });
  const text=JSON.stringify(request);
  assert.equal(request.payload.minimumNecessary,true);assert.equal(request.payload.referenceFirst,true);
  assert.doesNotMatch(text,/DO_NOT_SEND/);assert.equal(request.authorityGranted,false);assert.equal(request.schedulingDecision,null);
});

test('provider transport normalization produces a normalized usage receipt',()=>{
  const normalized=normalizeProviderTransportResult({
    text:'{}',providerId:'p',modelId:'m',startedAt:1,completedAt:6,
    usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:40}},
  },{providerProfileId:'profile:p',capability:'CAP'});
  assert.equal(normalized.kind,'ProviderTransportResult');assert.equal(normalized.latencyMs,5);
  assert.deepEqual([normalized.usageReceipt.inputUnits,normalized.usageReceipt.outputUnits,normalized.usageReceipt.cacheHitUnits],[100,20,40]);
  assert.equal(normalized.usageReceipt.cost.status,'NOT_MEASURED');assert.equal(normalized.authorityGranted,false);
});

test('usage receipt measures cost only with deterministic pricing',()=>{
  const receipt=normalizeProviderUsageReceipt({usage:{input_tokens:1_000_000,output_tokens:500_000},pricing:{inputPerMillion:2,outputPerMillion:4}});
  assert.equal(receipt.cost.status,'MEASURED');assert.equal(receipt.cost.value,4);
});

test('TURN_EVENT preserves eventVersion and duplicate delivery remains idempotent',()=>{
  const hub=new TurnEventHub();
  const turn=createTurnEnvelope({turnId:'t',eventId:'e',eventVersion:'1.2.0',correlationId:'c',dedupeKey:'d',sourceRevisionSet:['s'],worldRevision:1,sceneRevision:1,characterStateRevision:1});
  assert.equal(turn.eventVersion,'1.2.0');
  assert.equal(hub.publish(turn).duplicate,false);assert.equal(hub.publish({...turn,deliveryAttempt:2}).duplicate,true);
  assert.equal(hub.list().length,1);assert.equal(Object.isFrozen(hub.list()[0]),true);
});

test('Dynamic Fan-Out permits zero LLM workers for simple hot-satisfied turn',()=>{
  const turn=createTurnEnvelope({turnId:'zero',eventId:'zero:e',correlationId:'zero:c',dedupeKey:'zero'});
  assert.equal(new DynamicFanOutPlanner().plan({turnEvent:turn,text:'thanks',hotStateSufficient:true}).plannedWorkerCount,0);
});

test('foreground quorum separates required, opportunistic and deferred work',()=>{
  const tasks=[
    makeTask({taskId:'r'}),
    makeTask({taskId:'o',resultClass:ResultClass.OPPORTUNISTIC}),
    makeTask({taskId:'d',resultClass:ResultClass.DEFERRED,placement:Placement.DEEP,cognitiveLayer:'L3'}),
  ];
  const plan=createForegroundQuorumPlan(tasks);
  assert.deepEqual(plan.requiredTaskIds,['r']);assert.deepEqual(plan.optionalTaskIds,['o']);assert.deepEqual(plan.deferredTaskIds,['d']);
  assert.equal(evaluateForegroundQuorum(plan,{completedTaskIds:['r'],now:20}).satisfied,true);
  assert.equal(evaluateForegroundQuorum(plan,{completedTaskIds:[],now:100}).closeReason,'HARD_DEADLINE');
});

test('deadline dispositions are bounded',()=>{
  assert.equal(hardDeadlineDisposition(makeTask()).action,'BOUNDED_FALLBACK');
  assert.equal(hardDeadlineDisposition(makeTask({resultClass:ResultClass.OPPORTUNISTIC})).action,'CONTINUE_AND_ROUTE_LATE');
  assert.equal(hardDeadlineDisposition(makeTask({resultClass:ResultClass.DEFERRED,placement:Placement.DEEP,cognitiveLayer:'L3'})).action,'BACKGROUND_ACCOUNTING');
});

test('late-result routing fences cancelled and stale results',()=>{
  const required=makeTask(),opportunistic=makeTask({resultClass:ResultClass.OPPORTUNISTIC}),deferred=makeTask({resultClass:ResultClass.DEFERRED,placement:Placement.DEEP,cognitiveLayer:'L3'});
  assert.equal(lateResultDestination(required,{cancelled:true}),ResultDestination.DROP);
  assert.equal(lateResultDestination(required,{stale:true}),ResultDestination.DROP);
  assert.equal(lateResultDestination(required,{warmReusable:true}),ResultDestination.WARM_CACHE);
  assert.equal(lateResultDestination(opportunistic),ResultDestination.NEXT_TURN);
  assert.equal(lateResultDestination(deferred,{nearlineEligible:true}),ResultDestination.NEARLINE);
  assert.equal(lateResultDestination(deferred),ResultDestination.BACKGROUND);
});

test('HOT/DEEP placement is policy only, not Resource Governor authority',()=>{
  const hot=executionPlacementPolicy(makeTask());
  const deep=executionPlacementPolicy(makeTask({resultClass:ResultClass.DEFERRED,placement:Placement.DEEP,cognitiveLayer:'L3',batchMetadata:{batchable:true,yieldSafety:'CHECKPOINT_ONLY'}}));
  assert.equal(hot.executionClass,'HOT');assert.equal(hot.foregroundReserveEligibility,true);assert.equal(hot.runtimeDecisionAuthority,false);
  assert.equal(deep.executionClass,'DEEP');assert.equal(deep.preemptionPolicy,'YIELD_TO_FOREGROUND');assert.equal(deep.resumeRequired,true);assert.equal(deep.runtimeDecisionAuthority,false);
});

test('DEEP checkpoint resumes only against the same revision fence',()=>{
  const deep=makeTask({resultClass:ResultClass.DEFERRED,placement:Placement.DEEP,cognitiveLayer:'L3',batchMetadata:{batchable:true,yieldSafety:'CHECKPOINT_ONLY'}});
  const checkpoint=createDeepCheckpoint(deep,{completedUnits:4,remainingUnits:6});
  assert.equal(evaluateDeepResume(checkpoint,revision()).action,'RESUME_FROM_CHECKPOINT');
  assert.equal(evaluateDeepResume(checkpoint,revision(4)).action,'INVALIDATE_AND_REPLAN');
});

test('cancellation and duplicate execution cannot enter active foreground',()=>{
  const t=makeTask();const guard=new ExecutionAdmissionGuard();
  assert.equal(guard.register(t).accepted,true);assert.equal(guard.register(t).duplicate,true);
  guard.cancel(t.taskId);const r=workerResult(t);
  assert.equal(guard.admit(r,{currentRevisionSet:revision()}).destination,ResultDestination.DROP);
  assert.equal(guard.admit(r,{currentRevisionSet:revision()}).duplicate,true);
});

test('execution guard restart preserves at-least-once dedupe identity',()=>{
  const t=makeTask();const a=new ExecutionAdmissionGuard();a.register(t);
  const b=new ExecutionAdmissionGuard().importState(a.exportState());assert.equal(b.register(t).duplicate,true);
});

test('native Event Spine baseline isolates failure and dedupes replay across restart',()=>{
  const spine=new NativeEventSpineBaseline();let delivered=0;
  spine.subscribe('TURN_EVENT',()=>{delivered+=1;});spine.subscribe('TURN_EVENT',()=>{throw new Error('isolated');});
  const event={eventId:'e',eventType:'TURN_EVENT',dedupeKey:'d'};
  assert.equal(spine.publish(event).duplicate,false);assert.equal(delivered,1);assert.equal(spine.failures.length,1);
  assert.equal(spine.replay(event).duplicate,true);assert.equal(delivered,1);
  const restarted=new NativeEventSpineBaseline({state:spine.snapshot()});assert.equal(restarted.replay(event).duplicate,true);
});

test('Coprocessor UI read model is read-only and uses UI.Core health vocabulary',()=>{
  const events=[
    {type:TelemetryEvent.TASK_STARTED,payload:{turnId:'t',taskId:'r',placement:'HOT',resultClass:'REQUIRED'}},
    {type:TelemetryEvent.WARM_HIT,payload:{turnId:'t'}},{type:TelemetryEvent.FALLBACK_USED,payload:{turnId:'t',taskId:'r'}},
  ];
  const ui=projectCognitionUiState({turnId:'t',events,providerHealth:[{providerProfileId:'p',health:'DEGRADED'}],queuePressure:{queued:2}});
  assert.equal(ui.activeTasks,1);assert.equal(ui.hotTasks,1);assert.equal(ui.requiredPending,1);assert.equal(ui.warmHits,1);assert.equal(ui.fallbackCount,1);
  assert.equal(ui.health,WidgetHealth.DEGRADED);assert.equal(ui.mutationAuthority,false);assert.deepEqual(ui.queuePressure,{queued:2});
});

test('Data Plane qualification uses honest measurement states',()=>{
  const rows=qualifyDataPlaneTransports({measurements:{STRUCTURED_CLONE_JSON:{latencyMs:.1}}});
  assert.equal(rows.find(x=>x.transport==='STRUCTURED_CLONE_JSON').measurement.status,Wave5MeasurementState.MEASURED);
  assert.equal(rows.find(x=>x.transport==='IN_PROCESS_ARTIFACT_REFERENCE').measurement.status,Wave5MeasurementState.REPLAYED);
  assert.equal(rows.find(x=>x.transport==='ZEROMQ').measurement.status,Wave5MeasurementState.NOT_MEASURED);
  assert.equal(daprBenchmarkStatus().status,Wave5MeasurementState.NOT_MEASURED);
});

test('representative workload metrics distinguish trivial, foreground and DEEP turns',()=>{
  const rows=[
    {turnClass:RepresentativeTurnClass.SIMPLE_ACKNOWLEDGEMENT,plannedWorkers:0,hotWorkers:0,deepWorkers:0,foregroundDelayMs:0},
    {turnClass:RepresentativeTurnClass.HISTORICAL_CALLBACK,plannedWorkers:4,hotWorkers:4,deepWorkers:0,precisionInput:64,precisionOutput:8,foregroundDelayMs:60},
    {turnClass:RepresentativeTurnClass.BACKGROUND_MAINTENANCE,plannedWorkers:1,hotWorkers:0,deepWorkers:1,foregroundDelayMs:0},
  ];
  const report=summarizeRepresentativeSwarm(rows),metrics=buildFt006CoprocessorMetrics(rows);
  assert.equal(report.rows[0].zeroWorker,true);assert.equal(report.rows[1].zeroWorker,false);
  assert.equal(metrics.zeroWorkerTurns,1);assert.equal(metrics.workersWoken,5);assert.equal(metrics.hotWorkers,4);assert.equal(metrics.deepWorkers,1);
});

test('CognitiveSwarm foreground return does not await slow opportunistic work',async()=>{
  const event=createTurnEnvelope({turnId:'nonblocking',eventId:'nonblocking:e',correlationId:'nonblocking:c',dedupeKey:'nonblocking',sourceRevisionSet:['src:r3'],worldRevision:3,sceneRevision:2,characterStateRevision:1,createdAt:0,deadline:80});
  const required=makeTask({taskId:'required',hardDeadline:80});
  const optional=makeTask({taskId:'optional',resultClass:ResultClass.OPPORTUNISTIC,hardDeadline:80});
  const planner={plan(){return {turnId:event.turnId,correlationId:event.correlationId,tasks:[required,optional]};}};
  const router={dispatch(t){if(t.taskId==='optional')return new Promise((resolve)=>setTimeout(()=>resolve(workerResult(t,{resultId:'slow',completedAt:160})),150));return Promise.resolve(workerResult(t,{resultId:'fast',completedAt:10}));}};
  const contextSeal=new DeterministicContextSealFixture();
  const resultBus=new RecordingResultBusFixture({isTurnSealed:(turnId)=>contextSeal.isTurnSealed(turnId)});
  const swarm=new CognitiveSwarm({eventHub:new TurnEventHub(),planner,executionRouter:router,resultBus,compiler:new StructuredCompilerFixture(),contextSeal,telemetry:new CoprocessorTelemetry()});
  const started=Date.now();const trace=await swarm.run({turn:event});const elapsed=Date.now()-started;
  assert.ok(elapsed<100,'foreground should not wait 150ms opportunistic worker');assert.equal(trace.gather.closedAt,10);assert.equal(trace.gather.missingRequired.length,0);
});

test('all Wave 5 production modules remain browser-safe',async()=>{
  for(const rel of [
    '../src/coprocessor/provider-health.js','../src/coprocessor/foreground-quorum-policy.js','../src/coprocessor/placement-runtime-policy.js',
    '../src/coprocessor/execution-safety.js','../src/coprocessor/provider-payload-boundary.js','../src/coprocessor/provider-execution-contract.js',
    '../src/coprocessor/usage-receipt.js','../src/coprocessor/coprocessor-ui-read-model.js','../src/coprocessor/native-event-spine-baseline.js',
    '../src/coprocessor/wave5-benchmark.js','../src/coprocessor/swarm.js',
  ]){
    const source=await readFile(new URL(rel,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\bBuffer\b/);assert.doesNotMatch(source,/from\s+['"]node:/);assert.doesNotMatch(source,/\brequire\s*\(/);
    assert.doesNotMatch(source,/\bprocess\./);assert.doesNotMatch(source,/from\s+['"](?:fs|path|worker_threads)['"]/);
  }
});
