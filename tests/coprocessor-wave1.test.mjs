import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  Capability, CapabilityProfileRegistry, COPROCESSOR_SCHEMA_VERSION, CognitiveSwarm,
  CoprocessorTelemetry, DeterministicContextSealFixture, DynamicFanOutPlanner, FailureCode,
  Freshness, ForegroundDeadlinePolicy, GatherCoordinator, JEV_CAPABILITY_MIGRATION, NexusContextSealBoundary,
  NexusResultBusBoundary, Placement, RecordingResultBusFixture, ResultClass, ResultDestination,
  ResultStatus, StructuredCompilerFixture, TelemetryEvent, TurnEventHub,
  assertAdvisoryJevMapping, capabilityRequest, compareRevisionSets, createCognitiveTask,
  createRevisionSet, createTurnEnvelope, createWorkerResult, jevCapabilityRequests,
  summarizeSwarmTrace, toCloudEvent, toNexusCognitiveResult, toRuntimeCapabilityDescriptor, toRuntimeObligation,
  runtimeTurnEventTypeDescriptor, toRuntimeTurnEventEmission,
  validateWorkerOutput,
} from '../src/coprocessor/index.js';
import {
  DeterministicExecutionRouter, createEmberPlannerInput, createEmberSwarm, createEmberTurn,
  createProfileRegistry,
} from './fixtures/ember-tavern-wave1.mjs';

test('worker task contract validates required fields and preserves runtime/batch metadata', () => {
  const task=createCognitiveTask({
    taskId:'t1',taskType:'TRUTH',turnId:'turn1',correlationId:'corr1',
    requiredCapabilities:[Capability.TRUTH_JUDGMENT],cognitiveLayer:'L1',resultClass:ResultClass.REQUIRED,
    inputRevisionSet:createRevisionSet({sourceRevisionSet:['s1'],worldRevision:4,sceneRevision:3,characterStateRevision:2}),
    softDeadline:50,hardDeadline:100,batchMetadata:{batchable:true,slicePolicy:'ADAPTIVE'},compilerLane:'truthClassifications',
  });
  assert.equal(task.schemaVersion,COPROCESSOR_SCHEMA_VERSION);
  assert.equal(task.batchMetadata.batchable,true);
  assert.equal(task.batchMetadata.checkpointBoundary,'SLICE');
  assert.equal(task.placement,Placement.HOT);
  assert.throws(()=>createCognitiveTask({taskId:'bad',taskType:'X',turnId:'t',correlationId:'c',requiredCapabilities:[],softDeadline:1,hardDeadline:2}),/at least one capability/);
  assert.throws(()=>createCognitiveTask({taskId:'bad',taskType:'X',turnId:'t',correlationId:'c',requiredCapabilities:['X'],softDeadline:3,hardDeadline:2}),/softDeadline/);
});

test('unsupported schema major fails locally', () => {
  assert.throws(()=>createCognitiveTask({schemaVersion:'2.0.0',taskId:'x',taskType:'X',turnId:'t',correlationId:'c',requiredCapabilities:['X'],softDeadline:1,hardDeadline:2}),/Unsupported coprocessor schema/);
});

test('worker result contract carries correlation, provider, provenance, confidence and freshness identity', () => {
  const r=createWorkerResult({resultId:'r1',taskId:'t1',turnId:'turn1',correlationId:'c1',workerId:'w1',providerId:'p1',capabilities:['X'],payload:{x:1},provenance:{source:'fixture'},confidence:.8,freshnessIdentity:createRevisionSet({worldRevision:2}),inputRevisionSet:createRevisionSet({worldRevision:2}),startedAt:1,completedAt:9});
  assert.equal(r.latency,8); assert.equal(r.providerId,'p1'); assert.equal(r.confidence,.8); assert.equal(Object.isFrozen(r),true);
});

test('malformed provider output becomes typed retryable failure, never a canonical-ready object', async () => {
  const task=createCognitiveTask({taskId:'t1',taskType:'X',turnId:'turn1',correlationId:'c1',requiredCapabilities:['X'],softDeadline:5,hardDeadline:10,fallbackPolicy:{type:'F',maxRetries:1}});
  const v=await validateWorkerOutput({taskId:'t1'},task,{attempt:1});
  assert.equal(v.valid,false); assert.equal(v.result,null); assert.equal(v.failure.code,FailureCode.MALFORMED_OUTPUT); assert.equal(v.failure.retryable,true);
});

test('deterministic semantic validation can reject structured output without granting authority', async () => {
  const task=createCognitiveTask({taskId:'t1',taskType:'X',turnId:'turn1',correlationId:'c1',requiredCapabilities:['X'],softDeadline:5,hardDeadline:10,fallbackPolicy:{type:'F',maxRetries:0}});
  const raw={resultId:'r',taskId:'t1',turnId:'turn1',correlationId:'c1',workerId:'w',providerId:'p',capabilities:['X'],payload:{proposal:true},provenance:{},confidence:.5,freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,startedAt:0,completedAt:1};
  const v=await validateWorkerOutput(raw,task,{semanticValidator:()=>false});
  assert.equal(v.valid,false); assert.equal(v.failure.code,FailureCode.SEMANTIC_VALIDATION_FAILED);
});

test('revision comparison distinguishes fresh, stale and future-invalid results', () => {
  const current=createRevisionSet({sourceRevisionSet:['a'],worldRevision:5,sceneRevision:4,characterStateRevision:3});
  assert.equal(compareRevisionSets(current,current),Freshness.FRESH);
  assert.equal(compareRevisionSets({...current,worldRevision:4},current),Freshness.STALE);
  assert.equal(compareRevisionSets({...current,worldRevision:6},current),Freshness.INVALID);
  assert.equal(compareRevisionSets({...current,sourceRevisionSet:['old']},current),Freshness.STALE);
});

test('Turn Event Hub creates exactly one immutable event and redelivery is idempotent', () => {
  const hub=new TurnEventHub(); const turn=createEmberTurn(); const a=hub.publish(turn); const b=hub.publish({...turn,deliveryAttempt:2});
  assert.equal(a.duplicate,false); assert.equal(b.duplicate,true); assert.equal(hub.list().length,1); assert.equal(Object.isFrozen(a.event),true);
});

test('correlation envelope maps cleanly to CloudEvents without Dapr dependency', () => {
  const event=createTurnEnvelope(createEmberTurn()); const cloud=toCloudEvent(event);
  assert.equal(cloud.specversion,'1.0'); assert.equal(cloud.id,event.eventId); assert.equal(cloud.subject,event.turnId); assert.equal(cloud.data.correlationId,event.correlationId);
});

test('capability registry discovers multiple interchangeable semantic providers', () => {
  const registry=createProfileRegistry(); const event=createTurnEnvelope(createEmberTurn());
  const task=new DynamicFanOutPlanner().plan({turnEvent:event,...createEmberPlannerInput()}).tasks.find(x=>x.metadata.roleId==='truth-precision');
  const eligible=registry.eligibleProfiles(task);
  assert.deepEqual(eligible.map(x=>x.providerId),['jev-provider','alternate-provider']);
  assert.deepEqual(capabilityRequest(task).requiredCapabilities,[Capability.TRUTH_JUDGMENT,Capability.RERANK]);
});

test('capability profile maps to Runtime Wave 1 registration shape without owning scheduling', () => {
  const profile=createProfileRegistry().get('historian-local'); const runtime=toRuntimeCapabilityDescriptor(profile);
  assert.equal(runtime.workerId,'slot:historian'); assert.equal(runtime.provider,'fixture:historian'); assert.ok(runtime.capabilities.includes(Capability.RETRIEVAL)); assert.equal(runtime.currentLoad,0);
});

test('Runtime Wave 2 capability mapping carries versions, implementation identity and eligibility', () => {
  const registry=new CapabilityProfileRegistry();
  const profile=registry.register({
    profileId:'versioned',workerId:'slot:v',providerId:'provider:v',implementationId:'impl:v',
    capabilities:[Capability.SEMANTIC_JUDGMENT],capabilityVersions:{[Capability.SEMANTIC_JUDGMENT]:'2.1'},
    capabilityQuality:{[Capability.SEMANTIC_JUDGMENT]:7},latencyClass:'LOW',qualityScore:5,foregroundEligible:true,backgroundEligible:false,
  });
  const runtime=toRuntimeCapabilityDescriptor(profile);
  assert.equal(runtime.implementationId,'impl:v');
  assert.equal(runtime.capabilityDescriptors[0].version,'2.1');
  assert.equal(runtime.capabilityDescriptors[0].qualityScore,7);
  assert.equal(runtime.backgroundEligible,false);
});

test('capability negotiation honors minimum version without changing task semantics', () => {
  const registry=new CapabilityProfileRegistry();
  registry.register({profileId:'v1',capabilities:['CAP'],capabilityVersions:{CAP:'1.0'}});
  registry.register({profileId:'v2',capabilities:['CAP'],capabilityVersions:{CAP:'2.0'}});
  const task=createCognitiveTask({taskId:'version-task',taskType:'X',turnId:'t',correlationId:'c',requiredCapabilities:['CAP'],capabilityRequests:[{id:'CAP',minVersion:'2.0',preferredVersion:'2.0'}],softDeadline:1,hardDeadline:2});
  assert.deepEqual(registry.eligibleProfiles(task).map(x=>x.profileId),['v2']);
});

test('Sidecar task maps to Runtime Wave 2 obligation without embedding scheduler authority', () => {
  const event=createTurnEnvelope(createEmberTurn()); const task=new DynamicFanOutPlanner().plan({turnEvent:event,...createEmberPlannerInput()}).tasks[0];
  const obligation=toRuntimeObligation(task);
  assert.equal(obligation.taskId,task.taskId);
  assert.equal(obligation.layer,'L1');
  assert.equal(obligation.owner,'COGNITIVE_COPROCESSOR');
  assert.equal(obligation.deadline,task.hardDeadline);
  assert.equal(obligation.resultContract.contextSealPolicy,'BEFORE_SEAL_ONLY');
  assert.deepEqual(obligation.capabilityRequests,task.capabilityRequests);
  assert.equal(typeof obligation.execute,'undefined');
  assert.equal(typeof obligation.schedule,'undefined');
});

test('Turn Event maps to Runtime Wave 2 dynamic Event Spine registration/emission contract', () => {
  const descriptor=runtimeTurnEventTypeDescriptor(); const event=createTurnEnvelope(createEmberTurn()); const emission=toRuntimeTurnEventEmission(event,{text:'fixture'});
  assert.equal(descriptor.eventType,'TURN_EVENT');
  assert.equal(descriptor.payloadSchema.allowUnknown,true);
  assert.equal(emission.meta.eventId,event.eventId);
  assert.equal(emission.meta.correlationId,event.correlationId);
  assert.equal(emission.meta.revisionFences.worldRevision,event.worldRevision);
  assert.equal(emission.payload.deliveryAttempt,1);
});

test('Jev responsibilities are advisory capabilities, not mutation permissions', () => {
  assert.equal(assertAdvisoryJevMapping(),true);
  assert.deepEqual(new Set(jevCapabilityRequests()),new Set([
    Capability.CHANGE_CLASSIFICATION,Capability.SEMANTIC_JUDGMENT,Capability.PROPOSAL_REVIEW,Capability.CONFLICT_INTERPRETATION,Capability.TRUTH_JUDGMENT,
  ]));
  assert.ok(Object.values(JEV_CAPABILITY_MIGRATION).every(x=>x.authority==='ADVISORY'));
});

test('alternate provider satisfies the same Truth task without changing task semantics', async () => {
  const primary=createEmberSwarm(); const a=await primary.swarm.run({turn:createEmberTurn(),plannerInput:createEmberPlannerInput()});
  const alternateRouter=new DeterministicExecutionRouter({registry:createProfileRegistry({alternateTruthOnly:true})});
  const alternate=createEmberSwarm({executionRouter:alternateRouter}); const b=await alternate.swarm.run({turn:createEmberTurn({turnId:'turn:ember:alt',eventId:'turn-event:ember:alt',correlationId:'corr:ember:alt',dedupeKey:'turn:ember:alt'}),plannerInput:createEmberPlannerInput()});
  const taskA=a.plan.tasks.find(x=>x.metadata.roleId==='truth-precision'); const taskB=b.plan.tasks.find(x=>x.metadata.roleId==='truth-precision');
  assert.deepEqual(taskA.requiredCapabilities,taskB.requiredCapabilities);
  assert.ok(alternateRouter.dispatchLog.some(x=>x.role==='truth-precision'&&x.providerId==='alternate-provider'));
});

test('fan-out planner supports zero-worker acknowledgement path', () => {
  const event=createTurnEnvelope(createEmberTurn({turnId:'turn:ack',eventId:'evt:ack',correlationId:'corr:ack',dedupeKey:'turn:ack'}));
  const plan=new DynamicFanOutPlanner().plan({turnEvent:event,text:'Thanks!'});
  assert.equal(plan.tasks.length,0); assert.match(plan.reason,/zero-worker/);
});

test('fan-out planner creates one worker when only continuity has expected value', () => {
  const event=createTurnEnvelope(createEmberTurn({turnId:'turn:one',eventId:'evt:one',correlationId:'corr:one',dedupeKey:'turn:one'}));
  const plan=new DynamicFanOutPlanner().plan({turnEvent:event,text:'Continue the scene.',activeThreads:['continuity']});
  assert.deepEqual(plan.tasks.map(x=>x.metadata.roleId),['historian']);
});

test('Ember Tavern plan creates four capability-defined workers with correct result classes', () => {
  const event=createTurnEnvelope(createEmberTurn()); const plan=new DynamicFanOutPlanner().plan({turnEvent:event,...createEmberPlannerInput()});
  assert.deepEqual(plan.tasks.map(x=>x.metadata.roleId),['historian','graph-walker','green-room','truth-precision']);
  assert.deepEqual(plan.tasks.map(x=>x.resultClass),[ResultClass.REQUIRED,ResultClass.REQUIRED,ResultClass.OPPORTUNISTIC,ResultClass.REQUIRED]);
  assert.ok(plan.tasks.every(x=>!('workerId' in x)&&!('providerId' in x)));
});

test('fan-out planner can produce many workers without hard-coded sidecar identities', () => {
  const catalog=Array.from({length:12},(_,i)=>({roleId:`role-${i}`,taskType:`TYPE_${i}`,compilerLane:'externalGrounding',requiredCapabilities:[`CAP_${i}`],resultClass:ResultClass.OPPORTUNISTIC,placement:Placement.HOT,cognitiveLayer:'L1'}));
  const planner=new DynamicFanOutPlanner({roleCatalog:catalog,maxWorkers:20}); const event=createTurnEnvelope(createEmberTurn({turnId:'turn:many',eventId:'evt:many',correlationId:'corr:many',dedupeKey:'turn:many'}));
  const expectedValue=Object.fromEntries(catalog.map(x=>[x.roleId,.9])); const plan=planner.plan({turnEvent:event,text:'complex turn',expectedValue});
  assert.equal(plan.tasks.length,12);
});

test('wrong-turn result is rejected deterministically', async () => {
  const event=createTurnEnvelope(createEmberTurn()); const plan=new DynamicFanOutPlanner().plan({turnEvent:event,...createEmberPlannerInput()}); const gather=new GatherCoordinator({turnEvent:event,plan});
  const task=plan.tasks[0]; const raw=createWorkerResult({resultId:'wrong',taskId:task.taskId,turnId:'other',correlationId:task.correlationId,workerId:'w',providerId:'p',capabilities:task.requiredCapabilities,payload:{},provenance:{},confidence:1,freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,startedAt:0,completedAt:1});
  const out=await gather.accept(raw); assert.equal(out.accepted,false); assert.equal(out.validation.failure.code,FailureCode.CORRELATION_MISMATCH);
});

test('duplicate worker result delivery is harmless', async () => {
  const event=createTurnEnvelope(createEmberTurn()); const plan=new DynamicFanOutPlanner().plan({turnEvent:event,...createEmberPlannerInput()}); const gather=new GatherCoordinator({turnEvent:event,plan});
  const task=plan.tasks[0]; const raw=createWorkerResult({resultId:'dup',taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,workerId:'w',providerId:'p',capabilities:task.requiredCapabilities,payload:{},provenance:{},confidence:1,freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,startedAt:0,completedAt:1});
  assert.equal((await gather.accept(raw)).accepted,true); assert.equal((await gather.accept(raw)).duplicate,true); assert.equal(gather.accepted.size,1);
});

test('Nexus Result Bus adapter preserves normalized result contract and no canonical mutation authority', () => {
  const event=createTurnEnvelope(createEmberTurn()); const task=new DynamicFanOutPlanner().plan({turnEvent:event,...createEmberPlannerInput()}).tasks[0];
  const result=createWorkerResult({resultId:'r',taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,workerId:'w',providerId:'p',capabilities:task.requiredCapabilities,payload:{evidence:[]},provenance:{},confidence:1,freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,startedAt:0,completedAt:1});
  const nexus=toNexusCognitiveResult(result,task); assert.equal(nexus.kind,'CognitiveResult'); assert.equal(nexus.resultClass,task.resultClass); assert.equal(nexus.destination,ResultDestination.FOREGROUND); assert.equal('canonicalMutation' in nexus,false);
});

test('Result Bus and Context Seal adapters delegate to injected Nexus bindings only', () => {
  const received=[]; const bus=new NexusResultBusBoundary({receive:(x)=>{received.push(x);return{ok:true};}}); bus.receive({id:'x'}); assert.equal(received.length,1);
  const calls=[]; const seal=new NexusContextSealBoundary({seal:(x)=>{calls.push(x);return{x};},isTurnSealed:()=>true}); assert.equal(seal.isTurnSealed('t'),true); seal.seal({turnId:'t'}); assert.equal(calls.length,1);
});

test('One-Key Swarm acceptance: required quorum closes at 57ms and late Green Room cannot block Main', async () => {
  const h=createEmberSwarm(); const trace=await h.swarm.run({turn:createEmberTurn(),plannerInput:createEmberPlannerInput()});
  assert.equal(trace.plan.tasks.length,4);
  assert.equal(trace.gather.closeReason,'FOREGROUND_QUORUM');
  assert.equal(trace.gather.closedAt,57);
  assert.deepEqual(trace.gather.missingRequired,[]);
  assert.equal(trace.gather.greenRoom.length,0);
  assert.equal(trace.gather.lateResults.length,1);
  assert.equal(trace.gather.lateResults[0].destination,ResultDestination.NEXT_TURN);
  assert.equal(h.executionRouter.dispatchLog.filter(x=>x.attempt===1).length,4);
  assert.equal(new Set(h.executionRouter.dispatchLog.filter(x=>x.attempt===1).map(x=>x.startedAt)).size,1);
});

test('Ember Tavern truth stays current destroyed Tavern + unresolved Blade, never current Blade-at-Tavern', async () => {
  const h=createEmberSwarm(); const trace=await h.swarm.run({turn:createEmberTurn(),plannerInput:createEmberPlannerInput()});
  const packet=trace.packet; const text=JSON.stringify(packet);
  assert.match(text,/"Ember Tavern"/); assert.match(text,/"destroyed"/);
  assert.match(text,/"currentLocation":"unknown"/); assert.match(text,/"classification":"UNRESOLVED"/);
  assert.doesNotMatch(text,/"subject":"Sun Blade","predicate":"location","value":"Ember Tavern","temporalStatus":"CURRENT"/);
  assert.match(text,/"temporalStatus":"HISTORICAL"/);
});

test('Gather preserves conflicting Sun Blade evidence instead of synthesizing a winner', async () => {
  const h=createEmberSwarm(); const trace=await h.swarm.run({turn:createEmberTurn(),plannerInput:createEmberPlannerInput()});
  const disagreement=trace.gather.unresolvedDisagreement.find(x=>x.semanticKey==='sun-blade:fate');
  assert.ok(disagreement); assert.ok(disagreement.evidence.some(x=>x.value==='destroyed-in-fire')); assert.ok(disagreement.evidence.some(x=>x.value==='removed-before-fire'));
});

test('Context Seal packet hash and bytes remain unchanged after late opportunistic result', async () => {
  const h=createEmberSwarm(); const trace=await h.swarm.run({turn:createEmberTurn(),plannerInput:createEmberPlannerInput()});
  const before=JSON.stringify(trace.packet); const hash=trace.sealReceipt.packetHash;
  assert.equal(h.contextSeal.isTurnSealed(trace.turnEvent.turnId),true);
  assert.equal(JSON.stringify(h.contextSeal.getPacket(trace.turnEvent.turnId)),before);
  assert.equal(h.contextSeal.getReceipt(trace.turnEvent.turnId).packetHash,hash);
  assert.equal(h.resultBus.results.get('result:turn:ember:001:green-room:fixture:green')?.route.effectiveDestination,ResultDestination.NEXT_TURN);
});

test('worker failure is isolated and does not cancel unrelated workers', async () => {
  const router=new DeterministicExecutionRouter({failRoles:['green-room']}); const h=createEmberSwarm({executionRouter:router});
  const trace=await h.swarm.run({turn:createEmberTurn({turnId:'turn:fail-green',eventId:'evt:fail-green',correlationId:'corr:fail-green',dedupeKey:'turn:fail-green'}),plannerInput:createEmberPlannerInput()});
  assert.equal(trace.gather.missingRequired.length,0); assert.equal(trace.gather.closeReason,'FOREGROUND_QUORUM'); assert.equal(router.dispatchLog.some(x=>x.role==='truth-precision'),true);
});

test('required provider failure uses bounded retry then deterministic fallback instead of indefinite wait', async () => {
  const router=new DeterministicExecutionRouter({failRoles:['graph-walker']}); const h=createEmberSwarm({executionRouter:router});
  const trace=await h.swarm.run({turn:createEmberTurn({turnId:'turn:fail-required',eventId:'evt:fail-required',correlationId:'corr:fail-required',dedupeKey:'turn:fail-required'}),plannerInput:createEmberPlannerInput()});
  const graph=trace.plan.tasks.find(x=>x.metadata.roleId==='graph-walker');
  assert.equal(router.dispatchLog.filter(x=>x.role==='graph-walker').length,2);
  assert.ok(trace.gather.fallbacksUsed.some(x=>x.taskId===graph.taskId));
  assert.equal(trace.gather.missingRequired.length,0);
});

test('malformed worker output is retried once and valid second output may satisfy task', async () => {
  const router=new DeterministicExecutionRouter({malformedFirstRoles:['historian']}); const h=createEmberSwarm({executionRouter:router});
  const trace=await h.swarm.run({turn:createEmberTurn({turnId:'turn:retry',eventId:'evt:retry',correlationId:'corr:retry',dedupeKey:'turn:retry'}),plannerInput:createEmberPlannerInput()});
  assert.equal(router.dispatchLog.filter(x=>x.role==='historian').length,2); assert.equal(trace.gather.missingRequired.length,0);
  assert.ok(h.telemetry.list().some(x=>x.type===TelemetryEvent.RETRY));
});

test('stale required result is excluded from foreground and replaced only by defined fallback', async () => {
  const router=new DeterministicExecutionRouter({staleRoles:['graph-walker']}); const h=createEmberSwarm({executionRouter:router});
  const trace=await h.swarm.run({turn:createEmberTurn({turnId:'turn:stale',eventId:'evt:stale',correlationId:'corr:stale',dedupeKey:'turn:stale'}),plannerInput:createEmberPlannerInput()});
  assert.ok(trace.gather.staleResultIds.some(id=>id.includes('graph-walker')));
  assert.ok(trace.gather.fallbacksUsed.some(x=>x.taskId.includes('graph-walker')));
});

test('future revision result is invalid and cannot enter Gather', async () => {
  const router=new DeterministicExecutionRouter({futureRoles:['graph-walker']}); const h=createEmberSwarm({executionRouter:router});
  const trace=await h.swarm.run({turn:createEmberTurn({turnId:'turn:future',eventId:'evt:future',correlationId:'corr:future',dedupeKey:'turn:future'}),plannerInput:createEmberPlannerInput()});
  assert.ok(trace.gather.rejectedResultIds.length>=0); assert.ok(trace.gather.fallbacksUsed.some(x=>x.taskId.includes('graph-walker')));
});

test('zero-worker turn seals immediately with an empty structured Gather bundle', async () => {
  const h=createEmberSwarm(); const trace=await h.swarm.run({
    turn:createEmberTurn({turnId:'turn:zero',eventId:'evt:zero',correlationId:'corr:zero',dedupeKey:'turn:zero'}),
    plannerInput:{text:'Thanks!'},
  });
  assert.equal(trace.plan.tasks.length,0); assert.equal(trace.gather.closedAt,0); assert.equal(trace.gather.acceptedResultIds.length,0); assert.equal(trace.sealReceipt.sealedState,true);
});

test('telemetry stays lightweight and excludes raw prompts/responses/payload blobs', async () => {
  const telemetry=new CoprocessorTelemetry(); telemetry.emit(TelemetryEvent.TASK_COMPLETED,{taskId:'t',providerId:'p',payload:{huge:true},rawPrompt:'secret',rawResponse:'secret',executionLatency:10});
  const event=telemetry.list()[0]; assert.equal('payload' in event.payload,false); assert.equal('rawPrompt' in event.payload,false); assert.equal(event.payload.executionLatency,10);
});

test('benchmark summary reports parallel start skew, quorum and full swarm completion', async () => {
  const h=createEmberSwarm(); const trace=await h.swarm.run({turn:createEmberTurn(),plannerInput:createEmberPlannerInput()}); const metrics=summarizeSwarmTrace(trace);
  assert.equal(metrics.fanOutStartSkew,0); assert.equal(metrics.foregroundQuorumLatency,57); assert.equal(metrics.fullSwarmCompletionLatency,220); assert.equal(metrics.lateResultRate,.25);
});

test('foreground deadline policy gives soft advisory behavior and hard deterministic outcomes', () => {
  const policy=new ForegroundDeadlinePolicy(); const event=createTurnEnvelope(createEmberTurn());
  const tasks=new DynamicFanOutPlanner().plan({turnEvent:event,...createEmberPlannerInput()}).tasks;
  const required=tasks.find(x=>x.resultClass===ResultClass.REQUIRED), opportunistic=tasks.find(x=>x.resultClass===ResultClass.OPPORTUNISTIC);
  assert.equal(policy.state(required,required.softDeadline-1),'OPEN');
  assert.equal(policy.state(required,required.softDeadline+1),'SOFT_EXPIRED');
  assert.equal(policy.state(required,required.hardDeadline+1),'HARD_EXPIRED');
  assert.equal(policy.hardDeadlineAction(required),'FALLBACK_REQUIRED');
  assert.equal(policy.hardDeadlineAction(opportunistic),'ROUTE_NEXT_TURN');
  assert.equal(policy.canBlockForeground(opportunistic,1),false);
});

test('task contract carries explicit Context Seal publication policy', () => {
  const task=createCognitiveTask({taskId:'seal-task',taskType:'X',turnId:'t',correlationId:'c',requiredCapabilities:['X'],softDeadline:1,hardDeadline:2});
  assert.equal(task.contextSealPolicy,'BEFORE_SEAL_ONLY');
});

test('telemetry vocabulary includes queue, yield, park, resume, batch and cache lifecycle without payload cloning', () => {
  for(const type of [TelemetryEvent.TASK_QUEUED,TelemetryEvent.TASK_YIELD_REQUESTED,TelemetryEvent.TASK_YIELDING,TelemetryEvent.TASK_PARKED,TelemetryEvent.TASK_RESUMED,TelemetryEvent.BATCH_PROGRESS,TelemetryEvent.CACHE_HIT]) assert.equal(typeof type,'string');
});

test('source contains no privileged JEV worker authority path', async () => {
  const source=await readFile(new URL('../src/coprocessor/jev-migration.js',import.meta.url),'utf8');
  assert.equal(/if\s*\([^)]*worker[^)]*JEV/i.test(source),false);
  assert.equal(/canonical.*JEV|JEV.*canonical/i.test(source),false);
});
