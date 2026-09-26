import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Capability,CoprocessorResourceConnections,DynamicFanOutPlanner,JevDecisionShape,NativeSidecarSwarm,NativeSwarmResultState,
  ResourceKind,ScatterLayer,createJevDecisionRequest,createJevTurnCognitiveReceipt,createLayeredScatterPlan,createTurnEnvelope,
  summarizeJevUsefulnessCorpus,summarizeOptionalResourceStates,
} from '../src/coprocessor/index.js';

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

function turn(id,{worldRevision=3,sceneRevision=4}={}){
  const now=Date.now();
  return createTurnEnvelope({
    turnId:'turn:'+id,eventId:'event:'+id,correlationId:'corr:'+id,sourceRevisionSet:['source:'+id+'@1'],
    worldRevision,sceneRevision,characterStateRevision:2,createdAt:now,deadline:now+5000,cognitiveLayer:'L1',
  });
}
function graphInput(id='site',{conflict=false}={}){return{nodes:[{ref:id+':location',type:'LOCATION'}],edges:[],states:[
  {ref:id+':state',entityRef:id+':sensor',temporalStatus:'CURRENT',summary:'bounded-state'},
  ...(conflict?[{ref:id+':unresolved',entityRef:id+':sensor',temporalStatus:'UNRESOLVED',summary:'bounded-conflict'}]:[]),
],conflicts:conflict?[{ref:id+':conflict'}]:[]};}
function truthInput(id='site'){return{intent:'CURRENT_STATE',evidence:[{ref:id+':e1',statement:'bounded-evidence',semanticKey:id+':loop',temporalStatus:'CURRENT',authority:'OBSERVED'}],conflictSets:[],requiredRefs:[id+':e1']};}
function graphOutput(id='site',{conflict=false}={}){return{nodes:[id+':location'],edges:[],currentStateRefs:[id+':state'],historicalRefs:[],unresolvedRefs:conflict?[id+':unresolved']:[],conflicts:conflict?[id+':conflict']:[],reasoningSummary:'bounded'};}
function truthOutput(id='site'){return{assessments:[{refs:[id+':e1'],classification:'SUPPORTED',confidence:.9,reasoningSummary:'bounded'}],ranking:[{ref:id+':e1',score:.9}],rejectedRefs:[],uncertaintyPreserved:true};}
function resolver(task,id='site'){if(task.taskType==='GRAPH_WALK')return graphInput(id);if(task.taskType==='TRUTH_PRECISION')return truthInput(id);return{};}
function addResource(registry,{id='one',profileId='a-one',capabilities=[Capability.GRAPH,Capability.TRUTH_JUDGMENT,Capability.RERANK],handlers={},maxConcurrency=1}={}){
  registry.addResource({resourceId:id,providerProfileId:profileId,providerId:'provider:'+id,workerId:'worker:'+id,kind:ResourceKind.DETERMINISTIC_LOCAL,
    modelId:'model:'+id,capabilities,handlers,maxConcurrency,latencyClass:'LOW',local:true});
}
function planner({conflict=false,sceneTransitionType=null}={}){
  return{text:'Where is the instrument and what is its current physical state?',queryIntent:'CURRENT_STATE',
    conflictSignals:conflict?['state-conflict']:[],activeCast:[],sceneTransitionType};
}

test('quiet turn keeps zero-optional path at zero physical attempts',async()=>{
  const registry=new CoprocessorResourceConnections();
  const swarm=new NativeSidecarSwarm({connections:registry});
  const t=turn('quiet');
  const result=await swarm.runTurn({turnEvent:t,chatId:'chat:q',generationId:'gen:q',plannerInput:{text:'Thanks.'},currentRevisionState:t});
  assert.equal(result.contribution.layeredScatterReceipt.metrics.physicalAttemptCount,0);
  assert.equal(result.contribution.layeredScatterReceipt.metrics.logicalJobCount,0);
  assert.equal(result.contribution.resultsForOwner.length,0);
  assert.equal(result.contribution.gatherBundle.missingRequired.length,0);
  assert.equal(result.contribution.contextSealAuthority,false);
});

test('clean physical-state turn stages graph before precision and avoids a needless physical Truth attempt',async()=>{
  const registry=new CoprocessorResourceConnections();let graphCalls=0,truthCalls=0;
  const handlers={GRAPH_WALK:async()=>{graphCalls++;await sleep(8);return graphOutput('clean');},TRUTH_PRECISION:async()=>{truthCalls++;await sleep(8);return truthOutput('clean');}};
  addResource(registry,{id:'alpha',profileId:'a-alpha',handlers});addResource(registry,{id:'beta',profileId:'b-beta',handlers});
  await registry.connectResource('alpha');await registry.connectResource('beta');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const t=turn('clean');
  const result=await swarm.runTurn({turnEvent:t,chatId:'chat:clean',generationId:'gen:clean',plannerInput:planner(),inputResolver:task=>resolver(task,'clean'),currentRevisionState:t});
  const rows=result.contribution.resultSummary;
  assert.equal(graphCalls,1);assert.equal(truthCalls,0);
  assert.equal(rows.find(x=>x.taskType==='GRAPH_WALK').state,NativeSwarmResultState.READY_FOR_CORE);
  assert.equal(rows.find(x=>x.taskType==='TRUTH_PRECISION').state,NativeSwarmResultState.FALLBACK);
  assert.equal(result.contribution.gatherBundle.missingRequired.length,0);
  assert.equal(result.contribution.layeredScatterReceipt.metrics.physicalAttemptCount,1);
  assert.equal(result.contribution.layeredScatterReceipt.metrics.workAvoidedCount,1);
  assert.equal(result.contribution.layeredScatterReceipt.metrics.quorumSatisfied,true);
  assert.equal(result.contribution.resultsForOwner.length,1);
});

test('explicit ambiguity keeps independent graph and precision jobs concurrent within the same layer',async()=>{
  const registry=new CoprocessorResourceConnections();let active=0,maxActive=0;
  const guarded=fn=>async()=>{active++;maxActive=Math.max(maxActive,active);await sleep(15);try{return fn();}finally{active--;}};
  const handlers={GRAPH_WALK:guarded(()=>graphOutput('amb',{conflict:true})),TRUTH_PRECISION:guarded(()=>truthOutput('amb'))};
  addResource(registry,{id:'alpha',profileId:'a-alpha',handlers});addResource(registry,{id:'beta',profileId:'b-beta',handlers});
  await registry.connectResource('alpha');await registry.connectResource('beta');
  const swarm=new NativeSidecarSwarm({connections:registry});
  const t=turn('amb');
  const result=await swarm.runTurn({turnEvent:t,plannerInput:planner({conflict:true}),inputResolver:task=>task.taskType==='GRAPH_WALK'?graphInput('amb',{conflict:true}):resolver(task,'amb'),currentRevisionState:t});
  assert.equal(result.contribution.layeredScatterReceipt.metrics.physicalAttemptCount,2);
  assert.ok(maxActive>=2);
  assert.ok(result.contribution.layeredScatterReceipt.metrics.peakLayerConcurrency>=2);
  assert.equal(result.contribution.resultSummary.filter(x=>x.state===NativeSwarmResultState.READY_FOR_CORE).length,2);
});

test('retrieval-heavy turn stages Historian before later expansion without changing the fan-out contract',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT,Capability.GRAPH,Capability.TRUTH_JUDGMENT,Capability.RERANK],handlers:{}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry});
  const t=turn('history');
  const prepared=swarm.prepareTurn({turnEvent:t,plannerInput:{text:'What happened last time before the gate closed?',queryIntent:'HISTORY',activeThreads:['gate-thread']}});
  const layered=createLayeredScatterPlan({fanOutPlan:prepared.fanOutPlan,plannerInput:prepared.checkpoint.plannerSignals,choiceProposal:prepared.choiceProposal});
  assert.ok(prepared.fanOutPlan.tasks.some(x=>x.taskType==='HISTORIAN_RETRIEVAL'));
  assert.ok(layered.layers.find(x=>x.layer===ScatterLayer.RETRIEVAL).tasks.some(x=>x.taskType==='HISTORIAN_RETRIEVAL'));
  const historianIndex=layered.layers.findIndex(x=>x.layer===ScatterLayer.RETRIEVAL);
  const expansionIndex=layered.layers.findIndex(x=>x.layer===ScatterLayer.EXPANSION);
  assert.ok(historianIndex>=0&&expansionIndex>historianIndex);
});

test('Scene transition keeps graph expansion in foreground and deep consolidation outside the Seal deadline',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{capabilities:[Capability.GRAPH,Capability.TRUTH_JUDGMENT,Capability.RERANK,Capability.CONSOLIDATION,Capability.COMPRESSION],handlers:{}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry});
  const t=turn('transition');
  const prepared=swarm.prepareTurn({turnEvent:t,plannerInput:{text:'They arrive at the vault.',queryIntent:'CURRENT_STATE',sceneTransitionType:'ENTER',
    backgroundSignals:{consolidationPending:true,pendingUnits:2,expectedValue:.9}}});
  const layered=createLayeredScatterPlan({fanOutPlan:prepared.fanOutPlan,plannerInput:prepared.checkpoint.plannerSignals,choiceProposal:prepared.choiceProposal});
  assert.ok(layered.layers.find(x=>x.layer===ScatterLayer.EXPANSION).tasks.some(x=>x.taskType==='GRAPH_WALK'));
  assert.ok(layered.layers.find(x=>x.layer===ScatterLayer.DEEP).tasks.every(x=>x.resultClass==='DEFERRED'));
  assert.ok(layered.layers.find(x=>x.layer===ScatterLayer.DEEP).tasks.some(x=>x.taskType==='CONSOLIDATION'));
});

test('provider unavailable and timeout preserve declared fallback without manufacturing owner-side provider success',async()=>{
  for(const [name,code] of [['unavailable','PROVIDER_UNAVAILABLE'],['timeout','PROVIDER_TIMEOUT']]){
    const registry=new CoprocessorResourceConnections();
    addResource(registry,{capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>{const error=new Error(name);error.code=code;throw error;}}});
    await registry.connectResource('one');
    const swarm=new NativeSidecarSwarm({connections:registry,maxProvidersPerTask:1});
    const t=turn(name);
    const result=await swarm.runTurn({turnEvent:t,plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION'},inputResolver:()=>graphInput(name),currentRevisionState:t});
    assert.equal(result.contribution.layeredScatterReceipt.metrics.physicalAttemptCount,1,name);
    assert.ok(result.contribution.resultSummary.some(x=>x.state===NativeSwarmResultState.FALLBACK),name);
    assert.equal(result.contribution.gatherBundle.missingRequired.length,0,name);
    assert.equal(result.contribution.resultsForOwner.length,0,name);
    assert.ok(result.contribution.layeredScatterReceipt.resourceStates.sidecar.failed>=1,name);
  }
});

test('late physical result is never owner-admitted and required work falls back while the fence is fresh',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:async()=>{await sleep(35);return graphOutput('late');}}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:5,defaultHardBudgetMs:15})});
  const t=turn('late');
  const result=await swarm.runTurn({turnEvent:t,plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION'},inputResolver:()=>graphInput('late'),currentRevisionState:t});
  assert.equal(result.contribution.resultsForOwner.length,0);
  assert.ok(result.contribution.resultSummary.some(x=>x.state===NativeSwarmResultState.REJECTED_LATE));
  assert.ok(result.contribution.resultSummary.some(x=>x.state===NativeSwarmResultState.FALLBACK));
  assert.equal(result.contribution.gatherBundle.missingRequired.length,0);
  assert.ok(result.contribution.layeredScatterReceipt.metrics.lateAdmissionCount>=1);
});

test('revision drift rejects late work and cannot be converted into a fallback against the stale turn',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:async()=>{await sleep(5);return graphOutput('stale');}}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry});
  const t=turn('stale');let reads=0;
  const current=()=>{reads++;return reads===1?t:{...t,worldRevision:t.worldRevision+1};};
  const result=await swarm.runTurn({turnEvent:t,plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION'},inputResolver:()=>graphInput('stale'),currentRevisionState:current});
  assert.equal(result.contribution.resultsForOwner.length,0);
  assert.ok(result.contribution.resultSummary.some(x=>x.state===NativeSwarmResultState.REJECTED_STALE));
  assert.equal(result.contribution.resultSummary.some(x=>x.state===NativeSwarmResultState.FALLBACK),false);
  assert.ok(result.contribution.gatherBundle.missingRequired.length>=1);
});

test('completed checkpoint replays without duplicate physical execution and post-Seal replay admits no prior result',async()=>{
  const registry=new CoprocessorResourceConnections();let calls=0;
  addResource(registry,{capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>{calls++;return graphOutput('replay');}}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry});
  const t=turn('replay');
  const prepared=swarm.prepareTurn({turnEvent:t,chatId:'chat:replay',generationId:'gen:1',plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION'}});
  const first=await swarm.executeCheckpoint(JSON.parse(JSON.stringify(prepared.checkpoint)),{inputResolver:()=>graphInput('replay'),currentRevisionState:t});
  const replay=await swarm.executeCheckpoint(JSON.parse(JSON.stringify(prepared.checkpoint)),{inputResolver:()=>graphInput('replay'),currentRevisionState:t});
  const sealedReplay=await swarm.executeCheckpoint(JSON.parse(JSON.stringify(prepared.checkpoint)),{inputResolver:()=>graphInput('replay'),currentRevisionState:t,sealed:true});
  assert.equal(calls,1);
  assert.equal(replay.contribution.replayed,true);
  assert.equal(replay.contribution.replayPhysicalAttempts,0);
  assert.equal(sealedReplay.contribution.resumeStatus,'REPLAY_REJECTED_POST_SEAL');
  assert.equal(sealedReplay.contribution.resultsForOwner.length,0);
  assert.equal(sealedReplay.contribution.jevReceipt,null);
});

test('serialized checkpoint survives runtime reload and repeated resume does not duplicate its physical execution',async()=>{
  const registry=new CoprocessorResourceConnections();let calls=0;
  addResource(registry,{capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>{calls++;return graphOutput('reload');}}});
  await registry.connectResource('one');
  const original=new NativeSidecarSwarm({connections:registry});
  const t=turn('reload');
  const prepared=original.prepareTurn({turnEvent:t,chatId:'chat:reload',generationId:'gen:reload',plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION'}});
  const persisted=JSON.parse(JSON.stringify(prepared.checkpoint));
  const reloaded=new NativeSidecarSwarm({connections:registry});
  const first=await reloaded.executeCheckpoint(persisted,{inputResolver:()=>graphInput('reload'),currentRevisionState:t});
  const repeated=await reloaded.executeCheckpoint(JSON.parse(JSON.stringify(persisted)),{inputResolver:()=>graphInput('reload'),currentRevisionState:t});
  assert.equal(calls,1);
  assert.equal(first.contribution.resumeStatus,'EXECUTED');
  assert.equal(repeated.contribution.resumeStatus,'REPLAY');
  assert.equal(repeated.contribution.replayPhysicalAttempts,0);
});

test('chat/generation identity participates in checkpoint identity for regeneration isolation',()=>{
  const registry=new CoprocessorResourceConnections();
  const swarm=new NativeSidecarSwarm({connections:registry});
  const t=turn('regen');
  const a=swarm.prepareTurn({turnEvent:t,chatId:'chat:a',generationId:'gen:1',plannerInput:{text:'Thanks.'}});
  const b=swarm.prepareTurn({turnEvent:t,chatId:'chat:a',generationId:'gen:2',plannerInput:{text:'Thanks.'}});
  const c=swarm.prepareTurn({turnEvent:t,chatId:'chat:b',generationId:'gen:1',plannerInput:{text:'Thanks.'}});
  assert.notEqual(a.checkpoint.checkpointId,b.checkpoint.checkpointId);
  assert.notEqual(a.checkpoint.checkpointId,c.checkpoint.checkpointId);
});

test('wave telemetry separates configured, qualified, physical, returned, owner acceptance, skipped and failed states',()=>{
  const states=summarizeOptionalResourceStates({
    resources:[
      {callable:true,qualification:{qualified:true},activeCapabilities:['GRAPH','TRUTH_JUDGMENT']},
      {callable:true,qualification:{qualified:true},activeCapabilities:['SEMANTIC_JUDGMENT']},
      {callable:false,qualification:{qualified:false},activeCapabilities:['EMBED']},
    ],
    records:[
      {taskId:'s1',taskType:'GRAPH_WALK',providerProfileId:'p1',state:'READY_FOR_CORE'},
      {taskId:'s2',taskType:'TRUTH_PRECISION',providerProfileId:'p1',state:'FAILED'},
      {taskId:'s3',taskType:'GREEN_ROOM',state:'SKIPPED'},
    ],
    ownerReceipts:[{taskId:'s1',accepted:true}],
    jevExecution:{physicalAttempts:1,returned:1,ownerAccepted:0,ownerAcceptanceKnown:0,skipped:0,failed:0},
  });
  assert.equal(states.sidecar.physicalAttempts,2);
  assert.equal(states.sidecar.returned,1);
  assert.equal(states.sidecar.ownerAccepted,1);
  assert.equal(states.sidecar.skipped,1);
  assert.equal(states.sidecar.failed,1);
  assert.equal(states.jev.physicalAttempts,1);
  assert.equal(states.jev.ownerAcceptanceKnown,0);
  assert.equal(states.vectoring.configured,1);
  assert.equal(states.vectoring.qualified,0);
});

test('Jev corpus reports deterministic-vs-assisted usefulness separately from fixture physical execution',()=>{
  const report=summarizeJevUsefulnessCorpus({measurementClass:'LOCAL_DETERMINISTIC',cases:[
    {id:'clear',ambiguous:false,deterministic:{correct:true,abstained:false,confidence:1,latencyMs:1},jevAssisted:{correct:true,abstained:false,confidence:1,latencyMs:1,physicalExecution:false}},
    {id:'amb-a',ambiguous:true,deterministic:{correct:false,abstained:true,confidence:.2,latencyMs:1},jevAssisted:{correct:true,abstained:false,confidence:.8,latencyMs:12,physicalExecution:true,ownerAccepted:true}},
    {id:'amb-b',ambiguous:true,deterministic:{correct:false,abstained:false,confidence:.9,latencyMs:1},jevAssisted:{correct:false,abstained:true,confidence:.2,latencyMs:10,physicalExecution:true,ownerAccepted:false}},
  ]});
  assert.ok(report.jevAssisted.correctnessRate>report.deterministic.correctnessRate);
  assert.ok(report.jevAssisted.falseCertaintyRate<report.deterministic.falseCertaintyRate);
  assert.equal(report.physicalProviderExecutions,2);
  assert.equal(report.fixtureExecutions,2);
  assert.equal(report.liveProviderExecutions,0);
  assert.equal(report.cost.status,'NOT_MEASURED');
});

test('Jev owner receipt distinguishes physical attempt from owner acceptance without exposing authority',()=>{
  const receipt=createJevTurnCognitiveReceipt({
    input:{chatId:'chat:j',turnId:'turn:j',generationId:'gen:j',correlationId:'corr:j',taskId:'task:j',decisionId:'decision:j',domain:'SCENE',decisionKind:'SCENE_BOUNDARY'},
    proposal:{domain:'SCENE',decisionKind:'SCENE_BOUNDARY',path:'JEV',status:'JEV_DECIDED',proposedOutcome:'RESUME',reasonCodes:['AMBIGUOUS'],
      providerProvenance:{providerProfileId:'profile:j',providerId:'provider:j',resourceId:'resource:j',workerId:'worker:j',modelId:'model:j',measurementClass:'LOCAL_DETERMINISTIC',costClass:'LOW'}},
    delta:{jevInvoked:1,providerAttempts:1,physicalSuccesses:1,totalLatencyMs:7},ownerReviewInvoked:true,ownerDecision:'REJECTED',ownerAccepted:false,
  });
  assert.equal(receipt.physicalExecutionAttempted,true);
  assert.equal(receipt.physicalExecutionSucceeded,true);
  assert.equal(receipt.ownerAccepted,false);
  assert.equal(receipt.mutationAuthority,false);
  assert.equal(receipt.contextSealAuthority,false);
  assert.equal(JSON.stringify(receipt).includes('rawPrompt'),false);
});
