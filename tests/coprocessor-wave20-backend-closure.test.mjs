import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Capability,CapabilityProfileRegistry,CoprocessorResourceConnections,DeterministicProviderAdapter,JevDecisionCore,JevProviderExecutor,NativeHotDeepScheduler,
  Placement,ProviderAdapterRegistry,ResourceKind,ResourceMeasurementClass,ResultClass,RuntimeDirectorAdmissionBridge,
  adjudicateJevForOwner,createCognitiveTask,createJevDomainAdapterMatrix,createResourceDirectorExecutor,createRevisionSet,
  createRuntimeCapabilityAdmission,summarizeBackendRuntimeClosureBenchmarks,toWorkerDirectorObligation,toWorkerDirectorWorker,
} from '../src/coprocessor/index.js';
import { WorkerDirector } from '../src/runtime/index.js';

function task(id,{placement=Placement.HOT,resultClass=ResultClass.REQUIRED,contextTokens=12000,latencyBudgetMs=120,resourceLimits={CPU:1},resourceClass='STANDARD'}={}){
  const now=Date.now();
  return createCognitiveTask({
    taskId:'task:'+id,taskType:'GRAPH_WALK',turnId:'turn:'+id,correlationId:'corr:'+id,
    capabilityRequests:[{id:Capability.GRAPH,minVersion:2,preferredVersion:2}],requiredCapabilities:[Capability.GRAPH],
    fallbackCapabilitySets:[[{id:Capability.STRUCTURED_EXTRACTION,minVersion:1,preferredVersion:1}]],
    cognitiveLayer:placement===Placement.DEEP?'L3':'L1',resultClass,placement,softDeadline:now+5000,hardDeadline:now+10000,
    inputRevisionSet:createRevisionSet({sourceRevisionSet:['src:'+id],worldRevision:1,sceneRevision:2,characterStateRevision:3}),
    metadata:{contextTokens,expectedOutputTokens:512,latencyBudgetMs,resourceLimits,resourceClass,maxCostClass:'MEDIUM',contractMarker:'meaning-stable'},
  });
}
function graphInput(){return{nodes:[{ref:'story:station',type:'LOCATION'}],edges:[],states:[{ref:'story:state',entityRef:'story:station',temporalStatus:'CURRENT',summary:'Current station state.'}],conflicts:[]};}
function taskMeaning(value){return{
  taskType:value.taskType,requiredCapabilities:value.requiredCapabilities,optionalCapabilities:value.optionalCapabilities,
  fallbackCapabilities:value.fallbackCapabilities,capabilityRequests:value.capabilityRequests,fallbackCapabilitySets:value.fallbackCapabilitySets,
  cognitiveLayer:value.cognitiveLayer,resultClass:value.resultClass,batchMetadata:value.batchMetadata,outputSchema:value.outputSchema,
  fallbackPolicy:value.fallbackPolicy,placement:value.placement,contextSealPolicy:value.contextSealPolicy,compilerLane:value.compilerLane,
  metadata:value.metadata,
};}
function registry(){
  const r=new CapabilityProfileRegistry();
  for(const [id,extra] of [['alpha',{}],['beta',{}],['oversized',{resourceProfile:{CPU:2}}],['slow',{latencyClass:'HIGH'}],['wrong-class',{resourceClass:'HEAVY'}]]){
    r.register({
      profileId:'profile:'+id,workerId:'worker:'+id,providerId:'provider:'+id,modelId:'model:'+id,
      capabilities:[Capability.GRAPH,Capability.STRUCTURED_EXTRACTION],capabilityVersions:{[Capability.GRAPH]:2,[Capability.STRUCTURED_EXTRACTION]:1},
      resourceProfile:extra.resourceProfile??{CPU:1},resourceClass:extra.resourceClass??'STANDARD',
      latencyClass:extra.latencyClass??'LOW',reliability:.99,structuredOutputSupport:true,
      maxContextTokens:65536,maxOutputTokens:4096,maxConcurrency:1,currentLoad:0,health:'HEALTHY',availability:'AVAILABLE',
      foregroundEligible:true,backgroundEligible:true,supportedLayers:['L1','L3'],placements:[Placement.HOT,Placement.DEEP],estimatedCostClass:'LOW',
    });
  }
  return r;
}

test('#124 capability negotiation enforces version, resource, health, latency, context, concurrency, foreground/background and fallback without provider authority',()=>{
  const r=registry(),t=task('capability');
  let admission=createRuntimeCapabilityAdmission(r,t);
  assert.equal(admission.status,'SATISFIED');
  assert.deepEqual(admission.candidates.map(x=>x.profileId),['profile:alpha','profile:beta']);
  assert.equal(admission.candidates[0].providerId,'provider:alpha');assert.equal(admission.candidates[0].modelId,'model:alpha');
  assert.deepEqual(admission.taskContract,t);
  assert.equal(JSON.stringify(admission.taskContract).includes('provider:alpha'),false);
  assert.equal(JSON.stringify(admission.taskContract).includes('model:alpha'),false);
  assert.equal(admission.authority.runtimeScheduling,false);assert.equal(admission.authority.truth,false);

  r.setLoad('profile:alpha',1);
  const rerouted=createRuntimeCapabilityAdmission(r,t);
  assert.equal(rerouted.candidates[0].profileId,'profile:beta');
  assert.deepEqual(rerouted.taskContract,admission.taskContract);

  r.setHealth('profile:beta','UNAVAILABLE');
  const blocked=createRuntimeCapabilityAdmission(r,t);
  assert.equal(blocked.candidates.length,0);
  assert.ok(blocked.constraintFailures.some(x=>x.failures.includes('CONCURRENCY_FULL')));
  assert.ok(blocked.constraintFailures.some(x=>x.failures.includes('UNHEALTHY')));

  const tooLarge=createRuntimeCapabilityAdmission(registry(),task('large',{contextTokens:70000}));
  assert.equal(tooLarge.candidates.length,0);
  assert.ok(tooLarge.constraintFailures.some(x=>x.failures.includes('CONTEXT_TOO_LARGE')));

  const fallbackTask=createCognitiveTask({
    ...task('fallback'),
    taskId:'task:fallback2',requiredCapabilities:[Capability.DEEP_REASONING],
    capabilityRequests:[{id:Capability.DEEP_REASONING,minVersion:9,preferredVersion:9}],
    fallbackCapabilitySets:[[{id:Capability.GRAPH,minVersion:2,preferredVersion:2}]],
  });
  const fallback=createRuntimeCapabilityAdmission(registry(),fallbackTask);
  assert.equal(fallback.status,'DEGRADED');assert.equal(fallback.fallbackSetUsed,0);assert.equal(fallback.candidates.length,2);
});

test('#124 WorkerDirector descriptors keep provider identity in routing/worker metadata, not the cognitive task contract',()=>{
  const r=registry(),t=task('descriptor'),profile=r.get('profile:alpha');
  const worker=toWorkerDirectorWorker(profile),obligation=toWorkerDirectorObligation(t);
  assert.equal(worker.workerId,'profile:alpha');assert.equal(worker.provider,'provider:alpha');assert.equal(worker.model,'model:alpha');
  assert.equal(obligation.requiredCapabilities[0],Capability.GRAPH);
  assert.equal(obligation.payload.providerIdentityInTask,false);
  const cognitive=JSON.stringify(obligation.payload.cognitiveTask);
  assert.equal(cognitive.includes('provider:alpha'),false);assert.equal(cognitive.includes('model:alpha'),false);
  assert.equal(obligation.foreground,true);assert.equal(obligation.runtimeClass,'NATIVE_COGNITIVE');
});

class DirectorHarness{
  constructor({maxOutstanding=4}={}){this.maxOutstanding=maxOutstanding;this.registered=[];this.submissions=[];this.generation=false;this.yielded=[];}
  registerWorker(worker){this.registered.push(structuredClone(worker));return worker;}
  setWorkerAvailability(){} setWorkerHealth(){}
  submit(obligation,executor){
    if(this.submissions.length>=this.maxOutstanding)return{accepted:false,reason:'backpressure'};
    this.submissions.push({obligation:structuredClone(obligation),executor});return{accepted:true,task:structuredClone(obligation)};
  }
  beginGeneration(){this.generation=true;this.yielded=this.submissions.filter(x=>x.obligation.runtimeClass==='DEEP').map(x=>x.obligation.taskId);return[...this.yielded];}
  completeGeneration(){this.generation=false;return null;}
  snapshot(){return{generationActive:this.generation,submissions:this.submissions.map(x=>x.obligation.taskId),yielded:[...this.yielded]};}
}

test('#88 production admission bridge delegates Hot/Deep execution authority to WorkerDirector contract and fails closed on unqualified assignment',async()=>{
  const r=registry(),scheduler=new NativeHotDeepScheduler({resourceSlots:2,foregroundReserve:1,maxDeepQueue:2}),director=new DirectorHarness();
  const bridge=new RuntimeDirectorAdmissionBridge({director,capabilityRegistry:r,placementScheduler:scheduler});
  const registered=bridge.registerProfiles();assert.equal(registered.length,5);

  const hot=task('hot');
  const hotReceipt=bridge.admit(hot,{executor:{execute:async()=>({ok:true})}});
  assert.equal(hotReceipt.status,'ADMITTED');assert.equal(hotReceipt.obligation.foreground,true);assert.equal(hotReceipt.obligation.runtimeClass,'NATIVE_COGNITIVE');

  const deep=task('deep',{placement:Placement.DEEP,resultClass:ResultClass.DEFERRED});
  const deepReceipt=bridge.admit(deep,{executor:{execute:async()=>({ok:true})}});
  assert.equal(deepReceipt.status,'ADMITTED');assert.equal(deepReceipt.obligation.foreground,false);assert.equal(deepReceipt.obligation.runtimeClass,'DEEP');
  assert.equal(deepReceipt.obligation.yieldPolicy.mode,'SAFE_BOUNDARY');assert.equal(deepReceipt.obligation.checkpointPolicy.maxUnitsPerCheckpoint,1);
  assert.deepEqual(bridge.beginGeneration({turnId:'turn:hot'}),['task:deep']);bridge.completeGeneration({turnId:'turn:hot'});
  assert.equal(bridge.snapshot().generationActive,false);

  const wrapped=director.submissions[0].executor;
  await assert.rejects(()=>wrapped.execute({worker:{workerId:'profile:slow'}}),e=>e?.code==='RUNTIME_ASSIGNMENT_NOT_QUALIFIED');
});

test('#124 actual WorkerDirector executes through two interchangeable qualified Worker2 resources without task/provider authority coupling',async()=>{
  const connections=new CoprocessorResourceConnections();
  const graphOutput=()=>({nodes:['story:station'],edges:[],currentStateRefs:['story:state'],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'bounded'});
  for(const id of ['alpha','beta']){
    connections.addResource({
      resourceId:id,providerProfileId:'profile:'+id,providerId:'provider:'+id,workerId:'worker:'+id,modelId:'model:'+id,
      kind:ResourceKind.DETERMINISTIC_LOCAL,measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC,
      capabilities:[Capability.GRAPH,Capability.STRUCTURED_EXTRACTION],capabilityVersions:{[Capability.GRAPH]:2,[Capability.STRUCTURED_EXTRACTION]:1},
      resourceProfile:{CPU:1},resourceClass:'STANDARD',latencyClass:'LOW',maxContextTokens:65536,maxOutputTokens:4096,maxConcurrency:1,
      handlers:{GRAPH_WALK:async()=>graphOutput()},
    });
    const connected=await connections.connectResource(id);assert.equal(connected.callable,true);
  }

  const director=new WorkerDirector({capacity:{CPU:2},foregroundReserve:{CPU:1},maxRetries:0});
  const scheduler=new NativeHotDeepScheduler({resourceSlots:2,foregroundReserve:1});
  const bridge=new RuntimeDirectorAdmissionBridge({director,capabilityRegistry:connections.profiles,placementScheduler:scheduler});
  bridge.registerProfiles();

  const firstTask=task('runtime-alpha');
  const firstPlan=bridge.plan(firstTask);assert.deepEqual(firstPlan.capabilityAdmission.candidates.map(x=>x.profileId),['profile:alpha','profile:beta']);
  const firstExecutor=createResourceDirectorExecutor({connections,task:firstTask,input:graphInput()});
  const first=bridge.admit(firstTask,{executor:firstExecutor});assert.equal(first.status,'ADMITTED');
  await director.drain();
  assert.equal(director.ledger.get(firstTask.taskId).executionStatus,'COMPLETE');
  assert.equal(connections.readResource('alpha').physicalExecutionSucceeded,true);
  assert.equal(connections.readResource('beta').physicalExecutionAttempted,false);

  connections.disconnectResource('alpha');bridge.syncProfileState('profile:alpha');
  const secondTask=task('runtime-beta');
  const secondPlan=bridge.plan(secondTask);assert.deepEqual(secondPlan.capabilityAdmission.candidates.map(x=>x.profileId),['profile:beta']);
  assert.deepEqual(taskMeaning(firstPlan.taskContract),taskMeaning(secondPlan.taskContract));
  const secondExecutor=createResourceDirectorExecutor({connections,task:secondTask,input:graphInput()});
  const second=bridge.admit(secondTask,{executor:secondExecutor});assert.equal(second.status,'ADMITTED');
  await director.drain();
  assert.equal(director.ledger.get(secondTask.taskId).executionStatus,'COMPLETE');
  assert.equal(connections.readResource('beta').physicalExecutionSucceeded,true);
  const ready=director.telemetry.list({type:'RUNTIME_RESULT_READY'}).filter(x=>[firstTask.taskId,secondTask.taskId].includes(x.taskId));
  assert.equal(ready.length,2);assert.ok(ready.every(x=>x.authorityGranted===false&&x.canonicalMutation===false&&x.settlementPerformed===false));
});

test('#88 actual WorkerDirector preserves foreground reserve and performs Deep safe-yield checkpoint park/resume under generation contention',async()=>{
  const r=registry(),director=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:1},maxRetries:0});
  const scheduler=new NativeHotDeepScheduler({resourceSlots:1,foregroundReserve:1,maxDeepQueue:4});
  const bridge=new RuntimeDirectorAdmissionBridge({director,capabilityRegistry:r,placementScheduler:scheduler});
  bridge.registerProfiles({profiles:[r.get('profile:alpha')]});

  let releaseFirst,signalStarted;let slices=0;
  const started=new Promise(resolve=>{signalStarted=resolve;});
  const firstBlock=new Promise(resolve=>{releaseFirst=resolve;});
  const deepTask=task('director-deep',{placement:Placement.DEEP,resultClass:ResultClass.DEFERRED});
  const deepExecutor={
    async execute({units}){slices+=1;if(slices===1){signalStarted();await firstBlock;}return{unitId:units[0].id,slice:slices};},
    validate:()=>true,commit:({output})=>({slice:output.slice}),
  };
  const deep=bridge.admit(deepTask,{executor:deepExecutor,units:[{id:'deep:u1'},{id:'deep:u2'}]});assert.equal(deep.status,'ADMITTED');
  const firstCycle=director.runCycle({waitForTaskIds:[deepTask.taskId]});
  await started;
  const yields=bridge.beginGeneration({turnId:'foreground-turn'});assert.deepEqual(yields,[deepTask.taskId]);
  releaseFirst();await firstCycle;
  const parked=director.ledger.get(deepTask.taskId);
  assert.equal(parked.executionStatus,'PARKED');assert.equal(parked.batch.completedUnitIds.length,1);
  assert.equal(director.governor.snapshot().generationActive,true);
  assert.equal(director.telemetry.list({type:'WORK_YIELD_REQUESTED'}).some(x=>x.taskId===deepTask.taskId),true);
  assert.equal(director.telemetry.list({type:'WORK_PARKED'}).some(x=>x.taskId===deepTask.taskId),true);

  const hotTask=task('director-hot');
  const hot=bridge.admit(hotTask,{executor:{execute:async()=>({ok:true}),validate:()=>true,commit:()=>({})}});assert.equal(hot.status,'ADMITTED');
  await director.runCycle({waitForTaskIds:[hotTask.taskId]});
  assert.equal(director.ledger.get(hotTask.taskId).executionStatus,'COMPLETE');
  assert.equal(director.governor.snapshot().generationActive,true);

  bridge.completeGeneration({turnId:'foreground-turn'});
  await director.runCycle({waitForTaskIds:[deepTask.taskId]});
  const completed=director.ledger.get(deepTask.taskId);
  assert.equal(completed.executionStatus,'COMPLETE');assert.equal(completed.batch.completedUnitIds.length,2);assert.equal(slices,2);
  assert.equal(director.telemetry.list({type:'WORK_RESUMED'}).some(x=>x.taskId===deepTask.taskId),true);
  assert.equal(director.snapshot().resources.foregroundReserve.CPU,1);
});

test('#88 native admission queue is bounded and preserves yield/checkpoint/resume under contention',async()=>{
  let now=100;const scheduler=new NativeHotDeepScheduler({resourceSlots:1,foregroundReserve:1,maxDeepQueue:1,now:()=>now});
  scheduler.enqueueDeep({workId:'deep:1',metadata:{taskId:'deep:1'},runSlice:async({slice})=>slice===1?({checkpoint:{cursor:1}}):({done:true,ownerAccepted:true})});
  const deferred=scheduler.classify({placement:Placement.DEEP,resultClass:ResultClass.DEFERRED},{expectedValue:1,minimumExpectedValue:.5});
  assert.equal(deferred.decision,'DEFER');assert.equal(deferred.reason,'DEEP_QUEUE_BACKPRESSURE');
  assert.throws(()=>scheduler.enqueueDeep({workId:'deep:2',runSlice:async()=>({done:true})}),/capacity exhausted/);

  scheduler.beginForeground({workId:'hot'});now+=3;
  const yielded=await scheduler.runDeepSlice('deep:1');assert.equal(yielded.status,'YIELDED');assert.equal(yielded.yields,1);
  scheduler.endForeground({workId:'hot'});now+=5;
  const checkpoint=await scheduler.runDeepSlice('deep:1');assert.equal(checkpoint.status,'CHECKPOINTED');assert.equal(checkpoint.resumes,1);assert.equal(checkpoint.checkpointPresent,true);
  now+=4;const done=await scheduler.runDeepSlice('deep:1');assert.equal(done.status,'COMPLETED');assert.equal(done.ownerAccepted,true);
  const read=scheduler.readModel();assert.equal(read.maxDeepQueue,1);assert.equal(read.metrics.deepDeferred,1);assert.equal(read.metrics.deepBackpressureRejected,1);
});

function localJevProvider(){
  const profiles=new CapabilityProfileRegistry(),adapters=new ProviderAdapterRegistry();
  profiles.register({profileId:'jev-local',workerId:'jev-local',providerId:'jev-provider',modelId:'fixture',capabilities:[Capability.SEMANTIC_JUDGMENT],
    local:true,costClass:'FREE',latencyClass:'LOW',structuredOutput:true,foregroundEligible:true,backgroundEligible:true,maxConcurrency:1,health:'HEALTHY',availability:'AVAILABLE'});
  adapters.register(new DeterministicProviderAdapter({providerId:'jev-provider',modelId:'fixture',capabilities:[Capability.SEMANTIC_JUDGMENT],handlers:{JEV_DECISION:({input})=>{
    if(input.data.decisionType==='MEMORY_KNOWLEDGE_BELIEF_CLASSIFICATION')return{payload:jevOutput({selected:['UNCERTAIN'],rejected:['KNOWN','UNRESOLVED'],evidenceUsed:['mem:a','mem:b']})};
    return{payload:jevOutput({selected:['TEMPORALLY_DISTINCT'],rejected:['TRANSITION','CONTRADICTION','UNRESOLVED'],evidenceUsed:['time:a','time:b']})};
  }}}));
  return new JevProviderExecutor({profiles,adapters});
}
function memoryInput(id){return{domain:'MEMORY',decisionKind:'MEMORY_KNOWLEDGE_BELIEF_CLASSIFICATION',decisionId:id,turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,
  owner:'MEMORY_OWNER',characterRef:'Nia',sourceRevisionSet:['mem:1'],worldRevision:1,sceneRevision:2,characterStateRevision:3,memoryRevision:4,ownerRevision:5,freshnessToken:'fresh:'+id,
  deadline:Date.now()+10000,softDeadline:Date.now()+5000,options:[{optionId:'KNOWN',evidenceRefs:['mem:a']},{optionId:'UNCERTAIN',evidenceRefs:['mem:a','mem:b']},{optionId:'UNRESOLVED',evidenceRefs:['mem:b']}],
  evidence:[{evidenceId:'mem:a',summary:'direct evidence',metadata:{knownBy:['Nia']}},{evidenceId:'mem:b',summary:'conflicting hearsay',metadata:{knownBy:['Nia']}}],provenanceRefs:['mem:p1','mem:p2'],
  routing:{expectedDecisionValue:.9,latencyPenalty:0,costPenalty:0,uncertaintyPenalty:0,authorityRisk:0,minimumInvocationValue:.2}};}
function temporalInput(id){return{domain:'TEMPORAL',decisionKind:'TEMPORAL_TRANSITION_CONTRADICTION',decisionId:id,turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,
  owner:'TEMPORAL_OWNER',sourceRevisionSet:['time:1'],worldRevision:1,sceneRevision:2,characterStateRevision:3,temporalRevision:4,ownerRevision:5,freshnessToken:'fresh:'+id,
  deadline:Date.now()+10000,softDeadline:Date.now()+5000,options:[{optionId:'TRANSITION',evidenceRefs:['time:a']},{optionId:'CONTRADICTION',evidenceRefs:['time:a','time:b']},{optionId:'TEMPORALLY_DISTINCT',evidenceRefs:['time:a','time:b']},{optionId:'UNRESOLVED',evidenceRefs:['time:b']}],
  evidence:[{evidenceId:'time:a',summary:'state before'},{evidenceId:'time:b',summary:'state after'}],provenanceRefs:['time:p1','time:p2'],
  routing:{expectedDecisionValue:.9,latencyPenalty:0,costPenalty:0,uncertaintyPenalty:0,authorityRisk:0,minimumInvocationValue:.2}};}
function currentFor(input,patch={}){return{sourceRevisionSet:[...input.sourceRevisionSet],worldRevision:input.worldRevision,sceneRevision:input.sceneRevision,characterStateRevision:input.characterStateRevision,freshnessToken:input.freshnessToken,
  domainRevisions:input.domain==='MEMORY'?{memory:patch.memoryRevision??input.memoryRevision,owner:input.ownerRevision}:{temporal:patch.temporalRevision??input.temporalRevision,owner:input.ownerRevision}};}
function jevOutput({selected=[],rejected=[],evidenceUsed=[]}={}){return{outcome:'DECIDED',decisionCode:'CHOOSE_ONE',selectedOptionIds:selected,rejectedOptionIds:rejected,classification:null,reasonCodes:['LOCAL_DETERMINISTIC'],evidenceUsed,unresolvedFactors:[],confidence:.8,abstained:false,escalationTarget:null,requiresOperator:false,explanation:'bounded fixture'};}

test('#211 Memory and Temporal proposals reach owners only while fresh/pre-seal; Jev never performs Settlement',async()=>{
  const matrix=createJevDomainAdapterMatrix({core:new JevDecisionCore({providerExecutor:localJevProvider()})});
  let memoryReviews=0,temporalReviews=0;
  const mem=memoryInput('owner-memory');
  const mr=await adjudicateJevForOwner({service:matrix.service,input:mem,currentRevisionState:currentFor(mem),ownerReview:async proposal=>{memoryReviews+=1;assert.equal(proposal.mutationAuthority,false);return{decision:'ACCEPTED',settlementPerformed:true,canonicalMutation:true};}});
  assert.equal(mr.accepted,true);assert.equal(mr.ownerReviewInvoked,true);assert.equal(mr.settlementPerformed,true);assert.equal(mr.jevSettlementPerformed,false);

  const temporal=temporalInput('owner-temporal');
  const tr=await adjudicateJevForOwner({service:matrix.service,input:temporal,currentRevisionState:currentFor(temporal),ownerReview:async proposal=>{temporalReviews+=1;assert.equal(proposal.requiresOwnerPolicy,true);return{decision:'ACCEPTED',settlementPerformed:true,canonicalMutation:true};}});
  assert.equal(tr.accepted,true);assert.equal(tr.jevSettlementPerformed,false);

  const staleInput=memoryInput('stale-memory');
  const stale=await adjudicateJevForOwner({service:matrix.service,input:staleInput,currentRevisionState:currentFor(staleInput,{memoryRevision:99}),ownerReview:async()=>{memoryReviews+=100;return{decision:'ACCEPTED'};}});
  assert.equal(stale.status,'REJECTED_STALE');assert.equal(stale.ownerReviewInvoked,false);assert.equal(stale.settlementPerformed,false);

  const lateInput=temporalInput('sealed-temporal');
  const late=await adjudicateJevForOwner({service:matrix.service,input:lateInput,currentRevisionState:currentFor(lateInput),sealed:true,ownerReview:async()=>{temporalReviews+=100;return{decision:'ACCEPTED'};}});
  assert.equal(late.status,'REJECTED_POST_SEAL');assert.equal(late.ownerReviewInvoked,false);assert.equal(late.settlementPerformed,false);
  assert.equal(memoryReviews,1);assert.equal(temporalReviews,1);
});

test('#87 backend closure benchmark labels deterministic routing/placement/fallback evidence and does not claim live provider cost',()=>{
  const summary=summarizeBackendRuntimeClosureBenchmarks({
    measurementClass:'LOCAL_DETERMINISTIC',
    routingReceipts:[{meaningPreserved:true,interchangeable:true},{meaningPreserved:true,interchangeable:true}],
    placementReceipts:[{decision:'ADMIT',queueMs:4,yieldLatencyMs:3,foregroundBlockedMs:0},{decision:'DEFER',reason:'DEEP_QUEUE_BACKPRESSURE',queueMs:8,foregroundBlockedMs:0},{decision:'SKIP',queueMs:0,foregroundBlockedMs:0}],
    fallbackReceipts:[{attempts:2,maxProviders:2,status:'FALLBACK'},{attempts:1,maxProviders:2,status:'SUCCESS'}],
    staleChecks:[true,{rejected:true}],resourceUse:{cpuMs:6,peakRamMb:18},
  });
  assert.equal(summary.measurementClass,'LOCAL_DETERMINISTIC');assert.equal(summary.deterministic,true);
  assert.equal(summary.liveProviderLatencyMeasured,false);assert.equal(summary.liveProviderCostMeasured,false);
  assert.equal(summary.metrics.routingStability.value.ratio,1);assert.equal(summary.metrics.providerInterchangeability.value.ratio,1);
  assert.equal(summary.metrics.foregroundBlockingMs.value.max,0);assert.equal(summary.metrics.deepYieldLatencyMs.value.max,3);
  assert.equal(summary.metrics.boundedFallback.value.ratio,1);assert.equal(summary.metrics.staleRejection.value.ratio,1);
  assert.equal(summary.metrics.deferredByBackpressure.value,1);assert.equal(summary.metrics.skippedByPolicy.value,1);
  assert.equal(summary.metrics.estimatedCost.status,'NOT_MEASURED');
});
