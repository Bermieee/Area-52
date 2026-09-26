import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Capability,CoprocessorChoiceDisposition,CoprocessorTelemetry,DynamicFanOutPlanner,NativeSidecarSwarm,NativeSwarmResultState,
  Placement,ResultClass,ScatterLayer,TelemetryEvent,createCognitiveTask,createCoprocessorChoiceProposal,createTurnEnvelope,createWorkerResult,
  evaluateScatterAdmission,isBoundedJevChoice,projectLayeredScatterReadModel,
} from '../src/coprocessor/index.js';

function turn(id='layered'){
  const now=Date.now();
  return createTurnEnvelope({
    turnId:'turn:'+id,correlationId:'corr:'+id,eventId:'event:'+id,createdAt:now,deadline:now+5000,
    sourceRevisionSet:['src:'+id],worldRevision:1,sceneRevision:2,characterStateRevision:3,
  });
}

function task(t,{roleId,layer,resultClass=ResultClass.REQUIRED,expectedValue=.9,hardDeadline=null}={}){
  const deadline=hardDeadline??Date.now()+5000;
  return createCognitiveTask({
    taskId:t.turnId+':'+roleId,taskType:roleId==='green-room'?'GREEN_ROOM':roleId==='graph-walker'?'GRAPH_WALK':roleId==='truth-precision'?'TRUTH_PRECISION':'CONSOLIDATION',
    turnId:t.turnId,correlationId:t.correlationId,causationId:t.eventId,requiredCapabilities:[Capability.GRAPH],
    cognitiveLayer:layer===ScatterLayer.DEEP?'L3':'L1',resultClass,inputRevisionSet:t,softDeadline:deadline-1000,hardDeadline:deadline,
    placement:layer===ScatterLayer.DEEP?Placement.DEEP:Placement.HOT,compilerLane:'graphResults',intentFingerprint:'intent:'+t.turnId,
    metadata:{roleId,scatterLayer:layer,scatterTrigger:'TEST_TRIGGER',expectedValue,costEstimate:{units:1,class:'LOW'}},
  });
}

function proposal(t,tasks,{jev=false}={}){
  const options=tasks.map(row=>({
    optionId:row.metadata.roleId,roleId:row.metadata.roleId,taskType:row.taskType,logicalCapability:row.taskType,requiredCapabilities:row.requiredCapabilities,
    revisionFence:{...t,intentFingerprint:'intent:'+t.turnId,policyRevision:'test'},expectedValue:row.metadata.expectedValue,
    estimatedCost:{units:1,class:'LOW'},resultClass:row.resultClass,disposition:row.resultClass===ResultClass.DEFERRED?CoprocessorChoiceDisposition.DEFERRED:CoprocessorChoiceDisposition.NOMINATED,
    reasonCodes:['TEST_TRIGGER'],taskId:row.taskId,
  }));
  options.push({
    optionId:'jev-adjudication',roleId:'jev-adjudication',taskType:'JEV_ADJUDICATION',logicalCapability:'BOUNDED_JEV_ADJUDICATION',
    requiredCapabilities:[Capability.SEMANTIC_JUDGMENT],revisionFence:{...t,intentFingerprint:'intent:'+t.turnId,policyRevision:'test'},
    expectedValue:jev?.9:0,estimatedCost:{units:2,class:'MEDIUM'},resultClass:ResultClass.OPPORTUNISTIC,
    disposition:jev?CoprocessorChoiceDisposition.NOMINATED:CoprocessorChoiceDisposition.SKIPPED,reasonCodes:[jev?'JEV_BOUNDED_AMBIGUITY':'JEV_DETERMINISTIC_SUFFICIENT'],
  });
  return createCoprocessorChoiceProposal({
    turnId:t.turnId,correlationId:t.correlationId,policyVersion:'test',revisionFence:{...t,intentFingerprint:'intent:'+t.turnId,policyRevision:'test'},
    resourceCount:1,options,ownerStageRequests:{jevAdjudication:jev},jev:{considered:jev,gateRoute:jev?'INVOKE_JEV':'SKIP_JEV'},
  });
}

function plannerFor(t,tasks,{jev=false}={}){
  const choiceProposal=proposal(t,tasks,{jev});
  return {
    planChoice(){
      return {
        fanOutPlan:{kind:'FanOutPlan',turnId:t.turnId,correlationId:t.correlationId,tasks,nominations:[],plannedWorkerCount:tasks.length,boundedFanOut:tasks.length,budget:{}},
        choiceProposal,
      };
    },
  };
}

function fakeConnections({unresolved=false,unavailable=false,late=false}={}){
  const attempts=[];
  const capabilities=[Capability.GRAPH,Capability.SEMANTIC_JUDGMENT];
  const profile={
    profileId:'profile:one',workerId:'worker:one',providerId:'provider:one',modelId:'model:one',capabilities,
    structuredOutput:true,supportedLayers:['L1','L3'],placements:[Placement.HOT,Placement.DEEP],foregroundEligible:true,backgroundEligible:true,
    available:!unavailable,availability:unavailable?'UNAVAILABLE':'AVAILABLE',health:unavailable?'UNAVAILABLE':'HEALTHY',providerHealth:unavailable?'UNAVAILABLE':'HEALTHY',
    currentLoad:0,concurrencyCapacity:4,maxConcurrency:4,profileMetadata:{resourceId:'resource:one'},maxContextTokens:65536,maxOutputTokens:4096,
  };
  const profiles={
    list:()=>[profile],
    eligibleProfiles:(task)=>unavailable?[]:task.requiredCapabilities.every(cap=>capabilities.includes(cap))?[profile]:[],
  };
  const adapters={get:(providerId)=>providerId===profile.providerId?{}:null};
  const connections={
    attempts,profiles,adapters,
    readModel:()=>({
      activeCapabilities:unavailable?[]:capabilities,readyResourceCount:unavailable?0:1,
      resources:[{resourceId:'resource:one',providerProfileId:profile.profileId,configured:true,selectedModelQualified:!unavailable,callable:!unavailable,
        activeCapabilities:unavailable?[]:capabilities,maxConcurrency:4,activeExecutions:0,measurementClass:'LOCAL_DETERMINISTIC'}],
    }),
    createJevProviderExecutor:()=>({hasEligibleProvider:()=>false,execute:async()=>{throw Object.assign(new Error('no Jev fixture'),{code:'PROVIDER_UNAVAILABLE'});}}),
    executeTask:async(task)=>{
      attempts.push(task.taskId);
      const now=Date.now();
      const isGraph=task.metadata.roleId==='graph-walker';
      return createWorkerResult({
        resultId:'result:'+task.taskId,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,
        workerId:profile.workerId,providerId:profile.providerId,modelId:profile.modelId,capabilities,
        payload:isGraph?{unresolvedRefs:unresolved?['evidence:ambiguous']:[],conflicts:[]}:{ok:true},
        freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,intentFingerprint:task.intentFingerprint,
        startedAt:now,completedAt:late?task.hardDeadline+1:now,latency:0,authorityClass:task.metadata.roleId==='green-room'?'INFERRED':'UNRESOLVED',
      });
    },
  };
  return connections;
}

function layeredTasks(t){
  return [
    task(t,{roleId:'green-room',layer:ScatterLayer.HOT_EXACT,resultClass:ResultClass.OPPORTUNISTIC,expectedValue:.75}),
    task(t,{roleId:'graph-walker',layer:ScatterLayer.EVIDENCE_EXPANSION}),
    task(t,{roleId:'truth-precision',layer:ScatterLayer.PRECISION}),
    task(t,{roleId:'consolidation',layer:ScatterLayer.DEEP,resultClass:ResultClass.DEFERRED,expectedValue:.7}),
  ];
}

test('layered Scatter executes independent work within a layer, skips resolved precision, parks deep work, and replays checkpoint without duplicate execution',async()=>{
  const t=turn('resolved'),tasks=layeredTasks(t),connections=fakeConnections(),telemetry=new CoprocessorTelemetry();
  let yields=0;
  const swarm=new NativeSidecarSwarm({connections,planner:plannerFor(t,tasks),telemetry,cooperativeYield:async()=>{yields+=1;}});
  const prepared=swarm.prepareTurn({turnEvent:t,selection:{chatId:'chat:a',turnId:t.turnId,generationId:'gen:1',correlationId:t.correlationId}});
  const first=await swarm.executeCheckpoint(prepared.checkpoint,{currentRevisionState:t});
  assert.equal(connections.attempts.length,2,'only HOT + evidence execute physically when evidence resolves ambiguity');
  assert.ok(connections.attempts.some(id=>id.endsWith(':green-room')));
  assert.ok(connections.attempts.some(id=>id.endsWith(':graph-walker')));
  assert.equal(first.contribution.resultSummary.find(x=>x.optionId==='truth-precision').state,NativeSwarmResultState.SKIPPED);
  assert.equal(first.contribution.resultSummary.find(x=>x.optionId==='consolidation').state,NativeSwarmResultState.PARKED);
  assert.equal(first.contribution.executionTrace.facts.find(x=>x.optionId==='truth-precision').state,'SKIPPED');
  assert.ok(yields>=2,'layer boundaries cooperatively yield before later work');

  const second=await swarm.executeCheckpoint(prepared.checkpoint,{currentRevisionState:t});
  assert.equal(connections.attempts.length,2,'same checkpoint/generation is single-flight/replay safe');
  assert.equal(second.contribution.proposalId,first.contribution.proposalId);
  assert.equal(telemetry.list().filter(x=>x.type===TelemetryEvent.SCATTER_CHECKPOINT_REPLAYED).length,1);

  const waves=telemetry.list().filter(x=>x.type===TelemetryEvent.SCATTER_LAYER_STARTED&&x.payload.waveId?.includes('cop-swarm'));
  assert.deepEqual(waves.filter(x=>x.payload.taskCount>0).map(x=>x.payload.layer).slice(0,3),[
    ScatterLayer.HOT_EXACT,ScatterLayer.EVIDENCE_EXPANSION,ScatterLayer.PRECISION,
  ]);
});

test('unresolved evidence admits bounded precision instead of serializing the same work blindly',async()=>{
  const t=turn('ambiguous'),tasks=layeredTasks(t),connections=fakeConnections({unresolved:true}),telemetry=new CoprocessorTelemetry();
  const swarm=new NativeSidecarSwarm({connections,planner:plannerFor(t,tasks),telemetry,cooperativeYield:async()=>{}});
  const result=await swarm.runTurn({turnEvent:t,currentRevisionState:t});
  assert.equal(connections.attempts.length,3);
  assert.equal(result.contribution.resultSummary.find(x=>x.optionId==='truth-precision').state,NativeSwarmResultState.READY_FOR_CORE);
  const precision=telemetry.list().find(x=>x.type===TelemetryEvent.SCATTER_TASK_DECISION&&x.payload.taskId?.endsWith(':truth-precision'));
  assert.equal(precision.payload.decision,'ADMITTED');
  assert.equal(precision.payload.reason,'UNRESOLVED_HIGH_VALUE_CHOICE');
});

test('provider unavailable, stale fence, late result, and pre-sealed execution fail closed without owner-ready late mutation',async()=>{
  {
    const t=turn('unavailable'),tasks=layeredTasks(t),connections=fakeConnections({unavailable:true});
    const swarm=new NativeSidecarSwarm({connections,planner:plannerFor(t,tasks),cooperativeYield:async()=>{}});
    const result=await swarm.runTurn({turnEvent:t,currentRevisionState:t});
    assert.equal(connections.attempts.length,0);
    assert.equal(result.contribution.resultsForOwner.length,0);
    assert.ok(result.contribution.resultSummary.some(x=>x.state===NativeSwarmResultState.UNAVAILABLE));
  }
  {
    const t=turn('stale'),tasks=layeredTasks(t),connections=fakeConnections();
    const swarm=new NativeSidecarSwarm({connections,planner:plannerFor(t,tasks),cooperativeYield:async()=>{}});
    const stale={...t,worldRevision:t.worldRevision+1};
    const result=await swarm.runTurn({turnEvent:t,currentRevisionState:stale});
    assert.equal(connections.attempts.length,0);
    assert.equal(result.contribution.resultsForOwner.length,0);
    assert.ok(result.contribution.resultSummary.every(x=>x.state===NativeSwarmResultState.REJECTED_STALE));
  }
  {
    const t=turn('late'),tasks=[task(turn('late'),{roleId:'green-room',layer:ScatterLayer.HOT_EXACT})];
    const connections=fakeConnections({late:true});
    const swarm=new NativeSidecarSwarm({connections,planner:plannerFor(t,tasks),cooperativeYield:async()=>{}});
    const result=await swarm.runTurn({turnEvent:t,currentRevisionState:t});
    assert.equal(connections.attempts.length,1);
    assert.equal(result.contribution.resultsForOwner.length,0);
    assert.equal(result.contribution.resultSummary[0].state,NativeSwarmResultState.REJECTED_LATE);
  }
  {
    const t=turn('sealed'),tasks=layeredTasks(t),connections=fakeConnections();
    const swarm=new NativeSidecarSwarm({connections,planner:plannerFor(t,tasks),cooperativeYield:async()=>{}});
    const result=await swarm.runTurn({turnEvent:t,currentRevisionState:t,sealed:true});
    assert.equal(connections.attempts.length,0);
    assert.equal(result.contribution.resultsForOwner.length,0);
    assert.ok(result.contribution.resultSummary.filter(x=>x.resultClass!==ResultClass.DEFERRED).every(x=>x.state===NativeSwarmResultState.REJECTED_LATE));
  }
});

test('Jev remains an owner-requested finite ambiguous advisor and never becomes a generic scene approval gate',async()=>{
  assert.deepEqual(isBoundedJevChoice({options:[{optionId:'A'}],routing:{expectedDecisionValue:1,minimumInvocationValue:.1}}),{
    eligible:false,reason:'NOT_FINITE_AMBIGUOUS_CHOICE',
  });
  assert.equal(isBoundedJevChoice({options:[{optionId:'A'},{optionId:'B'}],routing:{expectedDecisionValue:.9,minimumInvocationValue:.4}}).eligible,true);

  const t=turn('jev-gated'),tasks=[task(t,{roleId:'graph-walker',layer:ScatterLayer.EVIDENCE_EXPANSION})],connections=fakeConnections(),telemetry=new CoprocessorTelemetry();
  const swarm=new NativeSidecarSwarm({connections,planner:plannerFor(t,tasks,{jev:true}),telemetry,cooperativeYield:async()=>{}});
  const result=await swarm.runTurn({turnEvent:t,currentRevisionState:t,jevRequest:null});
  assert.equal(result.contribution.jevReceipt,null);
  assert.equal(result.contribution.executionTrace.jev.status,'SKIPPED');
  const gate=telemetry.list().find(x=>x.type===TelemetryEvent.SCATTER_TASK_DECISION&&x.payload.taskId?.endsWith(':jev-adjudication'));
  assert.equal(gate.payload.decision,'SKIPPED');
  assert.equal(gate.payload.reason,'OWNER_REQUESTED_WITHOUT_BOUNDED_REQUEST');
});

test('Worker 3 read-only telemetry contract is selection-scoped and separates configured/qualified/attempted/returned/accepted states without private payloads',async()=>{
  const t=turn('telemetry'),tasks=layeredTasks(t),connections=fakeConnections(),telemetry=new CoprocessorTelemetry();
  const selection={chatId:'chat:telemetry',turnId:t.turnId,generationId:'gen:telemetry',correlationId:t.correlationId};
  const swarm=new NativeSidecarSwarm({connections,planner:plannerFor(t,tasks),telemetry,cooperativeYield:async()=>{}});
  await swarm.runTurn({turnEvent:t,currentRevisionState:t,selection});
  telemetry.emit(TelemetryEvent.SCATTER_TASK_DECISION,{...selection,waveId:'other',taskId:'other',layer:'HOT_EXACT',decision:'ADMITTED',reason:'OTHER',chatId:'chat:other'});
  const model=projectLayeredScatterReadModel({
    events:telemetry.list(),resources:connections.readModel().resources,selection,
    ownerReceipts:[{...selection,admissions:[{taskId:t.turnId+':graph-walker',resourceId:'resource:one',acceptedByOwner:true}]}],
  });
  assert.equal(model.selection.generationId,'gen:telemetry');
  assert.equal(model.tasks.some(x=>x.taskId==='other'),false);
  assert.equal(model.lifecycle[0].configured,true);
  assert.equal(model.lifecycle[0].qualified,true);
  assert.equal(model.lifecycle[0].physicalAttempted,true);
  assert.equal(model.lifecycle[0].returned,true);
  assert.equal(model.lifecycle[0].ownerAccepted,true);
  assert.equal(model.rawPromptIncluded,false);
  assert.equal(model.rawStoryIncluded,false);
  assert.equal(model.rawLoreIncluded,false);
  assert.equal(model.credentialIncluded,false);
  assert.equal(model.hiddenReasoningIncluded,false);
});

test('zero optional-provider path keeps native hot-state path valid and plans no provider work',()=>{
  const planner=new DynamicFanOutPlanner();
  const t=turn('quiet');
  const plan=planner.plan({turnEvent:t,text:'ok',hotStateSufficient:true,availableCapabilities:[]});
  assert.equal(plan.plannedWorkerCount,0);
  assert.equal(plan.tasks.length,0);
  assert.ok(plan.reasonCodes.includes('HOT_STATE_SUFFICIENT'));
});

test('precision admission uses preceding evidence, not unconditional serialization',()=>{
  const t=turn('policy'),precision=task(t,{roleId:'truth-precision',layer:ScatterLayer.PRECISION});
  const resolved=evaluateScatterAdmission(precision,{priorRecords:[{state:'READY_FOR_CORE',result:{payload:{unresolvedRefs:[],conflicts:[]}}}]});
  const unresolved=evaluateScatterAdmission(precision,{priorRecords:[{state:'READY_FOR_CORE',result:{payload:{unresolvedRefs:['u1']}}}]});
  assert.equal(resolved.admitted,false);
  assert.equal(resolved.reason,'PRECEDING_EVIDENCE_RESOLVED');
  assert.equal(unresolved.admitted,true);
});
