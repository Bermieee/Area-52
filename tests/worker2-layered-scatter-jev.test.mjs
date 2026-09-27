import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Capability,CapabilityProfileRegistry,CoprocessorResourceConnections,CoprocessorTelemetry,DynamicFanOutPlanner,GatherCoordinator,
  NativeSidecarSwarm,NativeSwarmResultState,ResourceKind,ResourceMeasurementClass,ScatterLayer,TelemetryEvent,
  classifyScatterLayer,createCognitiveTask,createRevisionSet,createTurnEnvelope,createWorker2WaveTelemetryReader,
  createWorkerResult,evaluateScatterAdmission,summarizeJevValueBenchmark,
} from '../src/coprocessor/index.js';

const ALL_CAPS=[
  Capability.RETRIEVAL,Capability.LONG_CONTEXT,Capability.GRAPH,Capability.SEMANTIC_JUDGMENT,
  Capability.CHARACTER_INFERENCE,Capability.TRUTH_JUDGMENT,Capability.RERANK,Capability.CONSOLIDATION,Capability.COMPRESSION,
];

function turn(id='wave'){
  const now=Date.now();
  return createTurnEnvelope({
    turnId:'turn:'+id,correlationId:'corr:'+id,eventId:'evt:'+id,eventType:'GENERATION_REQUESTED',
    sourceRevisionSet:['story@1'],worldRevision:2,sceneRevision:3,characterStateRevision:4,createdAt:now,deadline:now+1200,
  });
}
function fakeConnections({delayMs=8}={}){
  const profiles=new CapabilityProfileRegistry();
  profiles.register({
    profileId:'profile:worker2',workerId:'worker:worker2',providerId:'provider:worker2',modelId:'fixture',
    capabilities:ALL_CAPS,capabilityVersions:Object.fromEntries(ALL_CAPS.map(cap=>[cap,1])),
    supportedLayers:['L0','L1','L2','L3','L4'],placements:['HOT','DEEP'],latencyClass:'LOW',estimatedCostClass:'LOW',
    maxConcurrency:4,currentLoad:0,health:'HEALTHY',availability:'AVAILABLE',structuredOutputSupport:true,
    foregroundEligible:true,backgroundEligible:true,profileMetadata:{resourceId:'resource:worker2'},
  });
  const starts=[],finishes=[];let active=0,maxActive=0,physical=0;
  const api={
    profiles,adapters:{get:()=>({})},
    readModel:()=>({activeCapabilities:[...ALL_CAPS],readyResourceCount:1}),
    createJevProviderExecutor:()=>({hasEligibleProvider:()=>false,execute:async()=>{throw new Error('not used');}}),
    async executeTask(task,{signal=null,attempt=1}={}){
      physical+=1;active+=1;maxActive=Math.max(maxActive,active);starts.push({taskId:task.taskId,taskType:task.taskType,layer:classifyScatterLayer(task),attempt});
      try{
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(resolve,delayMs);
          const abort=()=>{clearTimeout(timer);const e=new Error('aborted');e.code='PROVIDER_ABORTED';reject(e);};
          if(signal?.aborted)abort();else signal?.addEventListener?.('abort',abort,{once:true});
        });
        finishes.push(task.taskId);
        return createWorkerResult({
          resultId:`result:${task.taskId}:${attempt}`,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,
          workerId:'worker:worker2',providerId:'provider:worker2',modelId:'fixture',capabilities:[...task.requiredCapabilities],
          payload:{evidence:[],currentStateRefs:[],historicalRefs:[],unresolvedRefs:[],reasoningSummary:'bounded fixture'},
          freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,intentFingerprint:task.intentFingerprint,
          startedAt:Date.now()-delayMs,completedAt:Date.now(),latency:delayMs,authorityClass:task.taskType==='GREEN_ROOM'?'INFERRED':'UNRESOLVED',
        });
      }finally{active=Math.max(0,active-1);}
    },
    stats:()=>({starts:[...starts],finishes:[...finishes],maxActive,physical}),
  };
  return api;
}
function planner(){
  return new DynamicFanOutPlanner({defaultSoftBudgetMs:500,defaultHardBudgetMs:1000,maxWorkers:8,maxForegroundWorkers:6,maxBackgroundNominations:2,maxCostUnits:16,maxDeadlineExposureMs:6000});
}
function workloadInput(){
  return {
    text:'Where are they talking, what is the current physical state, and which truth is current?',
    activeCast:['A','B'],activeThreads:['thread:1'],uncertainSceneFields:['location'],retrievalQuality:'MIXED',
    backgroundSignals:{consolidationPending:true,expectedValue:.8},latencyBudgetMs:1000,
    selection:{chatId:'chat:wave',generationId:'gen:wave'},trigger:'TURN_GENERATION',
  };
}

test('layered Scatter keeps cheap/signal work first, expansion before precision, and Deep outside foreground',()=>{
  const base={kind:'CognitiveTask',placement:'HOT',resultClass:'REQUIRED',cognitiveLayer:'L1',metadata:{}};
  assert.equal(classifyScatterLayer({...base,taskType:'EXACT_LOOKUP'}),ScatterLayer.SIGNAL);
  assert.equal(classifyScatterLayer({...base,taskType:'GRAPH_WALK'}),ScatterLayer.EXPANSION);
  assert.equal(classifyScatterLayer({...base,taskType:'TRUTH_PRECISION'}),ScatterLayer.PRECISION);
  assert.equal(classifyScatterLayer({...base,taskType:'CONSOLIDATION',placement:'DEEP',resultClass:'DEFERRED'}),ScatterLayer.BACKGROUND);
  const task=createCognitiveTask({
    taskId:'optional',taskType:'GREEN_ROOM',turnId:'turn:x',correlationId:'corr:x',requiredCapabilities:[Capability.SEMANTIC_JUDGMENT],
    resultClass:'OPPORTUNISTIC',placement:'HOT',softDeadline:100,hardDeadline:120,inputRevisionSet:createRevisionSet(),
  });
  assert.equal(evaluateScatterAdmission(task,{now:101}).decision,'SKIP');
  assert.equal(evaluateScatterAdmission({...task,resultClass:'REQUIRED'},{now:119}).decision,'ADMIT');
});

test('layered NativeSidecarSwarm caps per-layer concurrency, admits Gather continuously, and leaves Deep checkpointed',async()=>{
  const connections=fakeConnections(),telemetry=new CoprocessorTelemetry(),swarm=new NativeSidecarSwarm({
    connections,planner:planner(),telemetry,maxLayerConcurrency:2,minFreshWindowMs:5,hostYield:async()=>{},
  });
  const t=turn('layered');
  const prepared=swarm.prepareTurn({turnEvent:t,plannerInput:{...workloadInput(),selection:{chatId:'chat:layered',generationId:'gen:layered'}}});
  assert.ok(prepared.fanOutPlan.tasks.some(row=>row.taskType==='GRAPH_WALK'));
  assert.ok(prepared.fanOutPlan.tasks.some(row=>row.taskType==='TRUTH_PRECISION'));
  assert.ok(prepared.fanOutPlan.tasks.some(row=>row.resultClass==='DEFERRED'));
  const gather=new GatherCoordinator({turnEvent:t,plan:prepared.fanOutPlan,currentRevisionSet:t});
  const result=await swarm.executeCheckpoint(prepared.checkpoint,{currentRevisionState:t,gather,inputResolver:()=>({})});
  const stats=connections.stats();
  assert.ok(stats.maxActive<=2,JSON.stringify(stats));
  const firstPrecision=stats.starts.findIndex(row=>row.layer===ScatterLayer.PRECISION);
  const lastExpansion=stats.starts.map(row=>row.layer).lastIndexOf(ScatterLayer.EXPANSION);
  assert.ok(firstPrecision>lastExpansion,`precision index ${firstPrecision}, expansion index ${lastExpansion}`);
  assert.equal(result.contribution.resultsForOwner.length,0);
  assert.equal(result.contribution.ownerAdmissionRequired,false);
  assert.ok(result.contribution.continuousOwnerAdmissions.some(row=>row.acceptedByOwner));
  assert.ok(result.checkpoint?.pendingTasks.every(row=>row.resultClass==='DEFERRED'));
  assert.equal(stats.starts.some(row=>row.taskType==='CONSOLIDATION'),false);
  const layers=telemetry.list().filter(row=>row.type===TelemetryEvent.SCATTER_LAYER&&row.payload.phase==='COMPLETED');
  assert.ok(layers.some(row=>row.payload.layer===ScatterLayer.EXPANSION));
  assert.ok(layers.some(row=>row.payload.layer===ScatterLayer.PRECISION));
  assert.ok(telemetry.list().some(row=>row.type===TelemetryEvent.GATHER_ADMISSION&&row.payload.accepted===true));
});

test('required Sidecar work takes declared deterministic fallback when provider becomes unavailable; optional work is not fabricated',async()=>{
  const connections=fakeConnections(),swarm=new NativeSidecarSwarm({connections,planner:planner(),maxLayerConcurrency:2,hostYield:async()=>{}});
  const t=turn('fallback');
  const prepared=swarm.prepareTurn({turnEvent:t,plannerInput:workloadInput()});
  connections.profiles.setAvailability('profile:worker2',false);
  const result=await swarm.executeCheckpoint(prepared.checkpoint,{currentRevisionState:t,inputResolver:()=>({})});
  const required=prepared.fanOutPlan.tasks.filter(row=>row.resultClass==='REQUIRED');
  const requiredRows=result.contribution.resultSummary.filter(row=>required.some(task=>task.taskId===row.taskId));
  assert.equal(requiredRows.length,required.length);
  assert.ok(requiredRows.every(row=>row.state===NativeSwarmResultState.READY_FOR_CORE&&row.fallbackUsed));
  const optional=result.contribution.resultSummary.find(row=>row.resultClass==='OPPORTUNISTIC');
  if(optional)assert.notEqual(optional.state,NativeSwarmResultState.READY_FOR_CORE);
  assert.equal(connections.stats().physical,0);
});

test('stale checkpoint is rejected before physical execution and resumed checkpoint contains no foreground work',async()=>{
  const connections=fakeConnections(),swarm=new NativeSidecarSwarm({connections,planner:planner(),hostYield:async()=>{}});
  const t=turn('stale');
  const prepared=swarm.prepareTurn({turnEvent:t,plannerInput:workloadInput()});
  const stale={...t,sceneRevision:t.sceneRevision+1};
  const rejected=await swarm.executeCheckpoint(prepared.checkpoint,{currentRevisionState:stale});
  assert.equal(connections.stats().physical,0);
  assert.ok(rejected.contribution.resultSummary.every(row=>row.state===NativeSwarmResultState.REJECTED_STALE));

  const freshConnections=fakeConnections(),freshSwarm=new NativeSidecarSwarm({connections:freshConnections,planner:planner(),hostYield:async()=>{}});
  const freshPrepared=freshSwarm.prepareTurn({turnEvent:t,plannerInput:workloadInput()});
  const first=await freshSwarm.executeCheckpoint(freshPrepared.checkpoint,{currentRevisionState:t,inputResolver:()=>({})});
  const foregroundAttempts=freshConnections.stats().physical;
  if(first.checkpoint){
    const resumed=await freshSwarm.executeCheckpoint(first.checkpoint,{currentRevisionState:t,inputResolver:()=>({})});
    assert.equal(freshConnections.stats().physical,foregroundAttempts);
    assert.ok(resumed.contribution.resultSummary.every(row=>row.state===NativeSwarmResultState.PARKED));
  }
});

test('resource telemetry records physical attempt before return instead of equating qualification with execution',async()=>{
  const telemetry=new CoprocessorTelemetry(),connections=new CoprocessorResourceConnections({telemetry});
  connections.addResource({
    resourceId:'graph',providerProfileId:'profile:graph',providerId:'provider:graph',workerId:'worker:graph',modelId:'fixture',
    kind:ResourceKind.DETERMINISTIC_LOCAL,measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC,capabilities:[Capability.GRAPH],
    maxConcurrency:1,handlers:{GRAPH_WALK:async()=>({nodes:[],edges:[],currentStateRefs:[],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'ok'})},
  });
  await connections.connectResource('graph');
  const now=Date.now();
  const task=createCognitiveTask({taskId:'task:physical',taskType:'GRAPH_WALK',turnId:'turn:physical',correlationId:'corr:physical',
    requiredCapabilities:[Capability.GRAPH],softDeadline:now+500,hardDeadline:now+1000,inputRevisionSet:createRevisionSet({sourceRevisionSet:['a'],worldRevision:1})});
  await connections.executeTask(task,{input:{nodes:[],edges:[],states:[],conflicts:[]}});
  const events=telemetry.list();
  const attempt=events.findIndex(row=>row.type===TelemetryEvent.RESOURCE_EXECUTION_ATTEMPT&&row.payload.taskId===task.taskId);
  const returned=events.findIndex(row=>row.type===TelemetryEvent.RESOURCE_EXECUTION&&row.payload.taskId===task.taskId&&row.payload.status==='SUCCESS');
  assert.ok(attempt>=0);assert.ok(returned>attempt);
  assert.equal(events[attempt].payload.executionKind,'SIDECAR');
  assert.equal(events[attempt].payload.qualified,true);
});

test('Worker2 read model separates configured, qualified, physical, returned, accepted and skipped/failed states without private bodies',()=>{
  const telemetry=new CoprocessorTelemetry();
  const identity={chatId:'chat:r',turnId:'turn:r',generationId:'gen:r',correlationId:'corr:r'};
  telemetry.emit(TelemetryEvent.RESOURCE_EXECUTION_ATTEMPT,{...identity,executionKind:'SIDECAR',taskId:'s1',rawPrompt:'SECRET'});
  telemetry.emit(TelemetryEvent.RESOURCE_EXECUTION,{...identity,executionKind:'SIDECAR',taskId:'s1',status:'SUCCESS'});
  telemetry.emit(TelemetryEvent.RESOURCE_EXECUTION_ATTEMPT,{...identity,executionKind:'JEV',taskId:'j1'});
  telemetry.emit(TelemetryEvent.RESOURCE_EXECUTION,{...identity,executionKind:'JEV',taskId:'j1',status:'FAIL'});
  telemetry.emit(TelemetryEvent.RESOURCE_EXECUTION_ATTEMPT,{...identity,executionKind:'VECTORING',taskId:'v1'});
  telemetry.emit(TelemetryEvent.RESOURCE_EXECUTION,{...identity,executionKind:'VECTORING',taskId:'v1',status:'SUCCESS'});
  telemetry.emit(TelemetryEvent.SCATTER_TASK_STATE,{...identity,executionKind:'SIDECAR',taskId:'s2',decision:'SKIP',reason:'OPPORTUNISTIC_SOFT_DEADLINE'});
  telemetry.emit(TelemetryEvent.SCATTER_LAYER,{...identity,phase:'COMPLETED',layer:'EXPANSION',trigger:'SCENE',queueDepth:0,concurrency:2,durationMs:20,physicalAttempts:1,retainedBytes:100});
  const resources=[
    {configured:true,selectedModelQualified:true,activeCapabilities:[Capability.GRAPH]},
    {configured:true,selectedModelQualified:true,activeCapabilities:[Capability.SEMANTIC_JUDGMENT]},
    {configured:true,selectedModelQualified:true,activeCapabilities:[Capability.EMBED]},
  ];
  const ownerReceipts=[
    {kind:'NativeSidecarSwarmOwnerHandoffReceipt',turnId:identity.turnId,correlationId:identity.correlationId,admissions:[{taskId:'s1',acceptedByOwner:true}]},
    {kind:'JevOwnerAdmissionReceipt',turnId:identity.turnId,correlationId:identity.correlationId,accepted:true},
  ];
  const read=createWorker2WaveTelemetryReader({telemetry,resourceConnections:{listResources:()=>resources},ownerReceipts:()=>ownerReceipts}).read(identity);
  assert.equal(read.lifecycle.SIDECAR.physicalAttempts,1);assert.equal(read.lifecycle.SIDECAR.returned,1);assert.equal(read.lifecycle.SIDECAR.ownerAccepted,1);assert.equal(read.lifecycle.SIDECAR.skipped,1);
  assert.equal(read.lifecycle.JEV.physicalAttempts,1);assert.equal(read.lifecycle.JEV.failed,1);assert.equal(read.lifecycle.JEV.ownerAccepted,1);
  assert.equal(read.lifecycle.VECTORING.physicalAttempts,1);assert.equal(read.lifecycle.VECTORING.returned,1);
  assert.equal(read.waves[0].concurrency,2);
  assert.equal(read.waves[0].chatId,identity.chatId);assert.equal(read.waves[0].turnId,identity.turnId);assert.equal(read.waves[0].generationId,identity.generationId);assert.equal(read.waves[0].correlationId,identity.correlationId);
  assert.equal(JSON.stringify({read,events:telemetry.list()}).includes('SECRET'),false);
});

test('Jev usefulness benchmark reports correctness/abstention/false-certainty deltas and never counts fixtures as live physical decisions',()=>{
  const summary=summarizeJevValueBenchmark({cases:[
    {caseId:'ambiguous-a',measurementClass:'LOCAL_DETERMINISTIC',physicalProviderExecution:true,deterministic:{correct:false,abstained:false,falseCertain:true,latencyMs:1,costUnits:0},jev:{correct:true,abstained:false,falseCertain:false,latencyMs:20,costUnits:1}},
    {caseId:'ambiguous-b',measurementClass:'LOCAL_DETERMINISTIC',physicalProviderExecution:false,deterministic:{correct:true,abstained:true,falseCertain:false,latencyMs:1,costUnits:0},jev:{correct:true,abstained:true,falseCertain:false,latencyMs:18,costUnits:1}},
    {caseId:'live-proof',measurementClass:'MEASURED_LIVE',physicalProviderExecution:true,deterministic:{correct:true,abstained:false,falseCertain:false,latencyMs:1,costUnits:0},jev:{correct:true,abstained:false,falseCertain:false,latencyMs:30,costUnits:2}},
  ]});
  assert.ok(summary.delta.correctness>0);
  assert.ok(summary.delta.falseCertainty<0);
  assert.equal(summary.physicalProviderExecutions,1);
  assert.equal(summary.fixtureExecutions,2);
});


test('quiet turn preserves zero-optional-provider execution path with zero physical attempts',async()=>{
  const connections=fakeConnections(),swarm=new NativeSidecarSwarm({connections,planner:planner(),hostYield:async()=>{}});
  const t=turn('quiet');
  const result=await swarm.runTurn({turnEvent:t,plannerInput:{text:'ok',hotStateSufficient:true,selection:{chatId:'chat:quiet',generationId:'gen:quiet'}},currentRevisionState:t});
  assert.equal(result.contribution.resultSummary.length,0);
  assert.equal(connections.stats().physical,0);
  assert.equal(result.contribution.finalChoiceAuthority,false);
});

test('scene transition signal warrants expansion while Deep work remains outside foreground execution',async()=>{
  const connections=fakeConnections(),swarm=new NativeSidecarSwarm({connections,planner:planner(),hostYield:async()=>{}});
  const t=turn('transition');
  const prepared=swarm.prepareTurn({turnEvent:t,plannerInput:{text:'The scene changes.',sceneTransitionType:'LOCATION_CHANGE',activeThreads:['thread:transition'],backgroundSignals:{consolidationPending:true}}});
  assert.ok(prepared.fanOutPlan.tasks.some(row=>row.taskType==='GRAPH_WALK'&&classifyScatterLayer(row)===ScatterLayer.EXPANSION));
  assert.ok(prepared.fanOutPlan.tasks.some(row=>row.taskType==='CONSOLIDATION'&&classifyScatterLayer(row)===ScatterLayer.BACKGROUND));
  await swarm.executeCheckpoint(prepared.checkpoint,{currentRevisionState:t,inputResolver:()=>({})});
  assert.equal(connections.stats().starts.some(row=>row.taskType==='CONSOLIDATION'),false);
});

test('provider timeout takes bounded required fallback and does not admit the late provider result',async()=>{
  const connections=fakeConnections({delayMs:120});
  const shortPlanner=new DynamicFanOutPlanner({defaultSoftBudgetMs:20,defaultHardBudgetMs:35,maxWorkers:4,maxForegroundWorkers:4,maxCostUnits:10,maxDeadlineExposureMs:200});
  const swarm=new NativeSidecarSwarm({connections,planner:shortPlanner,maxLayerConcurrency:2,minFreshWindowMs:0,hostYield:async()=>{}});
  const t=turn('timeout');
  const result=await swarm.runTurn({turnEvent:t,plannerInput:{text:'Where is the current instrument?',queryIntent:'LOCATION',latencyBudgetMs:35},currentRevisionState:t,inputResolver:()=>({})});
  const required=result.contribution.resultSummary.filter(row=>row.resultClass==='REQUIRED');
  assert.ok(required.length>=1);
  assert.ok(required.every(row=>row.state===NativeSwarmResultState.READY_FOR_CORE&&row.fallbackUsed));
  assert.ok(connections.stats().physical>=1);
  assert.ok(required.every(row=>row.providerId==='area52:deterministic-fallback'));
  assert.ok(required.every(row=>row.ownerAdmissible===false));
  assert.equal(result.contribution.resultsForOwner.length,0);
});

test('sealed foreground rejects returned provider work without fallback or late owner admission',async()=>{
  const connections=fakeConnections(),swarm=new NativeSidecarSwarm({connections,planner:planner(),hostYield:async()=>{}});
  const t=turn('sealed-worker2');
  const result=await swarm.runTurn({turnEvent:t,plannerInput:{text:'Where is the current instrument?',queryIntent:'LOCATION'},currentRevisionState:t,sealed:true,inputResolver:()=>({})});
  assert.ok(connections.stats().physical>=1);
  assert.ok(result.contribution.resultSummary.filter(row=>row.resultClass==='REQUIRED').every(row=>row.state===NativeSwarmResultState.REJECTED_LATE));
  assert.equal(result.contribution.resultsForOwner.length,0);
});

test('chat switch and regeneration selection fences reject old checkpoints before execution',async()=>{
  const connections=fakeConnections(),swarm=new NativeSidecarSwarm({connections,planner:planner(),hostYield:async()=>{}});
  const t=turn('selection');
  const prepared=swarm.prepareTurn({turnEvent:t,plannerInput:{...workloadInput(),selection:{chatId:'chat:a',generationId:'gen:1'}}});
  const switched=await swarm.executeCheckpoint(prepared.checkpoint,{currentRevisionState:t,selection:{chatId:'chat:b',generationId:'gen:1'}});
  assert.equal(connections.stats().physical,0);
  assert.ok(switched.contribution.resultSummary.every(row=>row.state===NativeSwarmResultState.REJECTED_STALE));
  const regenerated=await swarm.executeCheckpoint(prepared.checkpoint,{currentRevisionState:t,selection:{chatId:'chat:a',generationId:'gen:2'}});
  assert.equal(connections.stats().physical,0);
  assert.ok(regenerated.contribution.resultSummary.every(row=>row.state===NativeSwarmResultState.REJECTED_STALE));
});

test('checkpoint execution ledger suppresses duplicate physical work across replay and rehydrated reload',async()=>{
  const ledger=new Map(),firstConnections=fakeConnections();
  const firstSwarm=new NativeSidecarSwarm({connections:firstConnections,planner:planner(),executionLedger:ledger,hostYield:async()=>{}});
  const t=turn('replay');
  const prepared=firstSwarm.prepareTurn({turnEvent:t,plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION',selection:{chatId:'chat:replay',generationId:'gen:1'}}});
  const first=await firstSwarm.executeCheckpoint(prepared.checkpoint,{currentRevisionState:t,selection:prepared.checkpoint.selection,inputResolver:()=>({})});
  const firstAttempts=firstConnections.stats().physical;
  assert.ok(firstAttempts>=1);
  const repeated=await firstSwarm.executeCheckpoint(prepared.checkpoint,{currentRevisionState:t,selection:prepared.checkpoint.selection,inputResolver:()=>({})});
  assert.equal(firstConnections.stats().physical,firstAttempts);
  assert.equal(repeated.contribution.proposalId,first.contribution.proposalId);

  const reloadConnections=fakeConnections();
  const reloaded=new NativeSidecarSwarm({connections:reloadConnections,planner:planner(),executionLedger:ledger,hostYield:async()=>{}});
  const replayed=await reloaded.executeCheckpoint(JSON.parse(JSON.stringify(prepared.checkpoint)),{currentRevisionState:t,selection:prepared.checkpoint.selection,inputResolver:()=>({})});
  assert.equal(reloadConnections.stats().physical,0);
  assert.equal(replayed.contribution.proposalId,first.contribution.proposalId);
  const wrongSelection=await reloaded.executeCheckpoint(JSON.parse(JSON.stringify(prepared.checkpoint)),{currentRevisionState:t,selection:{...prepared.checkpoint.selection,chatId:'chat:other'},inputResolver:()=>({})});
  assert.equal(reloadConnections.stats().physical,0);
  assert.equal(wrongSelection.contribution.resumeStatus,'SELECTION_REJECTED');
  assert.ok(wrongSelection.contribution.resultSummary.every(row=>row.state===NativeSwarmResultState.REJECTED_STALE));

  const nextTurn=turn('replay-next');
  await reloaded.runTurn({turnEvent:nextTurn,plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION',selection:{chatId:'chat:replay',generationId:'gen:2'}},currentRevisionState:nextTurn,inputResolver:()=>({})});
  assert.ok(reloadConnections.stats().physical>=1);
});
