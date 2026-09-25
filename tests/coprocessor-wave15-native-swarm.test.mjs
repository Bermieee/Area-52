import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Capability, CoprocessorResourceConnections, CoprocessorTelemetry, DynamicFanOutPlanner, JevDecisionShape, NativeSidecarSwarm,
  NativeSwarmResultState, ResourceKind, createCoprocessorResourceHost, createJevDecisionRequest, createTurnEnvelope,
} from '../src/coprocessor/index.js';

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

function turn(id,{worldRevision=3,sceneRevision=4}={}){
  const now=Date.now();
  return createTurnEnvelope({
    turnId:'turn:'+id,eventId:'event:'+id,correlationId:'corr:'+id,sourceRevisionSet:['source:'+id+'@1'],
    worldRevision,sceneRevision,characterStateRevision:2,createdAt:now,deadline:now+5000,cognitiveLayer:'L1',
  });
}
function graphInput(setting='orbital-greenhouse'){
  return{nodes:[{ref:setting+':location',type:'LOCATION'}],edges:[],states:[{ref:setting+':state',entityRef:setting+':sensor',temporalStatus:'CURRENT',summary:'The sensor remains mounted at the current location.'}],conflicts:[]};
}
function truthInput(setting='orbital-greenhouse'){
  return{intent:'CURRENT_STATE',evidence:[{ref:setting+':e1',statement:'The environmental loop is online.',semanticKey:setting+':loop',temporalStatus:'CURRENT',authority:'OBSERVED'}],conflictSets:[],requiredRefs:[setting+':e1']};
}
function graphOutput(setting='orbital-greenhouse'){
  return{nodes:[setting+':location'],edges:[],currentStateRefs:[setting+':state'],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'Current bounded state selected from supplied refs.'};
}
function truthOutput(setting='orbital-greenhouse'){
  return{assessments:[{refs:[setting+':e1'],classification:'SUPPORTED',confidence:.96,reasoningSummary:'Supplied evidence is internally consistent.'}],ranking:[{ref:setting+':e1',score:.95}],rejectedRefs:[],uncertaintyPreserved:true};
}
function jevAbstain(){
  return{outcome:'ABSTAINED',decisionCode:'ABSTAIN',selectedOptionIds:[],rejectedOptionIds:[],classification:null,reasonCodes:['INSUFFICIENT_EVIDENCE'],evidenceUsed:[],unresolvedFactors:['Both bounded alternatives remain supported.'],confidence:0,abstained:true,escalationTarget:null,requiresOperator:false,explanation:'The bounded evidence does not resolve the ambiguity.'};
}
function resolver(task){
  if(task.taskType==='GRAPH_WALK')return graphInput('orbital-greenhouse');
  if(task.taskType==='TRUTH_PRECISION')return truthInput('orbital-greenhouse');
  return{};
}
function addResource(registry,{id='one',profileId='a-one',capabilities=[Capability.GRAPH,Capability.TRUTH_JUDGMENT,Capability.RERANK],handlers={},maxConcurrency=1}={}){
  registry.addResource({
    resourceId:id,providerProfileId:profileId,providerId:'provider:'+id,workerId:'worker:'+id,kind:ResourceKind.DETERMINISTIC_LOCAL,
    modelId:'model:'+id,capabilities,handlers,maxConcurrency,latencyClass:'LOW',local:true,
  });
}
function plannerInput(){
  return{text:'Where is the instrument, and is its current physical state ambiguous?',queryIntent:'CURRENT_STATE',conflictSignals:['state-conflict'],activeCast:[]};
}
function jevRequest(id='ambiguous'){
  const now=Date.now();
  return createJevDecisionRequest({
    decisionId:'decision:'+id,decisionType:'GENERIC_BOUNDED_AMBIGUITY',decisionShape:JevDecisionShape.CHOOSE_ONE,
    turnId:'turn:'+id,taskId:'jev-task:'+id,correlationId:'corr:'+id,
    options:[{optionId:'option-a',label:'Interpretation A',evidenceRefs:['ev:a']},{optionId:'option-b',label:'Interpretation B',evidenceRefs:['ev:b']}],
    evidenceRefs:[{evidenceId:'ev:a',summary:'Evidence A supports interpretation A.'},{evidenceId:'ev:b',summary:'Evidence B independently supports interpretation B.'}],
    sourceRevisionSet:['source:'+id+'@1'],worldRevision:3,sceneRevision:4,characterStateRevision:2,domainRevisions:{generic:1},freshnessToken:'fresh:'+id,
    authorityBoundary:{authorityClass:'ADVISORY',ownerId:'brain-core'},
    routing:{expectedDecisionValue:.9,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2,currentGenerationDepends:true},
    escalationPolicy:{maxRetries:1},deadline:now+5000,softDeadline:now+3000,
  });
}
function freshJev(request){return{sourceRevisionSet:request.sourceRevisionSet,worldRevision:request.worldRevision,sceneRevision:request.sceneRevision,characterStateRevision:request.characterStateRevision,domainRevisions:request.domainRevisions,freshnessToken:request.freshnessToken};}

test('one physical resource serializes multiple logical jobs and returns only owner-admissible contributions',async()=>{
  const registry=new CoprocessorResourceConnections();
  let active=0,maxActive=0,graphCalls=0,truthCalls=0;
  const guarded=fn=>async()=>{active++;maxActive=Math.max(maxActive,active);await sleep(8);try{return fn();}finally{active--;}};
  addResource(registry,{handlers:{
    GRAPH_WALK:guarded(()=>{graphCalls++;return graphOutput();}),
    TRUTH_PRECISION:guarded(()=>{truthCalls++;return truthOutput();}),
  }});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const t=turn('serial');
  const result=await swarm.runTurn({turnEvent:t,plannerInput:plannerInput(),inputResolver:resolver,currentRevisionState:t});
  const ready=result.contribution.resultSummary.filter(x=>x.state===NativeSwarmResultState.READY_FOR_CORE);
  assert.equal(ready.length,2);
  assert.equal(new Set(ready.map(x=>x.resourceId)).size,1);
  assert.equal(maxActive,1);
  assert.equal(graphCalls,1);assert.equal(truthCalls,1);
  assert.equal(result.contribution.resultsForOwner.length,2);
  assert.ok(result.contribution.executionTrace.facts.filter(x=>x.state==='COMPLETED').every(x=>x.executionResourceId==='one'));
  assert.equal(result.contribution.ownerAdmissionRequired,true);
  assert.equal(result.contribution.finalChoiceAuthority,false);
  assert.equal(result.contribution.contextSealAuthority,false);
});

test('a second optional resource changes physical placement without changing logical task set',async()=>{
  const registry=new CoprocessorResourceConnections();
  const handlers={GRAPH_WALK:async()=>{await sleep(10);return graphOutput('deep-sea-lab');},TRUTH_PRECISION:async()=>{await sleep(10);return truthOutput('deep-sea-lab');}};
  addResource(registry,{id:'alpha',profileId:'a-alpha',handlers});addResource(registry,{id:'beta',profileId:'b-beta',handlers});
  await registry.connectResource('alpha');await registry.connectResource('beta');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const t=turn('parallel');
  const result=await swarm.runTurn({turnEvent:t,plannerInput:plannerInput(),inputResolver:(task)=>task.taskType==='GRAPH_WALK'?graphInput('deep-sea-lab'):truthInput('deep-sea-lab'),currentRevisionState:t});
  const ready=result.contribution.resultSummary.filter(x=>x.state===NativeSwarmResultState.READY_FOR_CORE);
  assert.deepEqual(ready.map(x=>x.taskType).sort(),['GRAPH_WALK','TRUTH_PRECISION']);
  assert.equal(new Set(ready.map(x=>x.resourceId)).size,2);
});

test('malformed first provider falls back to a second connected resource without granting authority',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{id:'bad',profileId:'a-bad',capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>({bad:true})}});
  addResource(registry,{id:'good',profileId:'z-good',capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>graphOutput('desert-array')}});
  await registry.connectResource('bad');await registry.connectResource('good');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const t=turn('fallback');
  const result=await swarm.runTurn({turnEvent:t,plannerInput:{text:'Where is the field instrument?',queryIntent:'LOCATION'},inputResolver:()=>graphInput('desert-array'),currentRevisionState:t});
  const graph=result.contribution.resultSummary.find(x=>x.taskType==='GRAPH_WALK');
  assert.equal(graph.state,NativeSwarmResultState.READY_FOR_CORE);
  assert.equal(graph.providerProfileId,'z-good');
  assert.equal(graph.attempt,2);
  assert.equal(graph.fallbackUsed,true);
  assert.equal(result.contribution.authority,'NONE');
});

test('serialized checkpoint survives JSON round-trip and stale resume fails closed without provider execution',async()=>{
  const registry=new CoprocessorResourceConnections();let calls=0;
  addResource(registry,{capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>{calls++;return graphOutput('polar-station');}}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const t=turn('checkpoint',{worldRevision:7});
  const prepared=swarm.prepareTurn({turnEvent:t,plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION'}});
  const restored=JSON.parse(JSON.stringify(prepared.checkpoint));
  const stale={...t,worldRevision:8};
  const result=await swarm.executeCheckpoint(restored,{inputResolver:()=>graphInput('polar-station'),currentRevisionState:stale});
  assert.equal(calls,0);
  assert.ok(result.contribution.resultSummary.some(x=>x.state===NativeSwarmResultState.REJECTED_STALE));
  assert.equal(result.contribution.resultsForOwner.length,0);
});

test('sealed turn rejects otherwise valid late sidecar result from owner handoff',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>graphOutput('coastal-observatory')}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const t=turn('sealed');
  const result=await swarm.runTurn({turnEvent:t,plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION'},inputResolver:()=>graphInput('coastal-observatory'),currentRevisionState:t,sealed:true});
  const graph=result.contribution.resultSummary.find(x=>x.taskType==='GRAPH_WALK');
  assert.equal(graph.state,NativeSwarmResultState.REJECTED_LATE);
  assert.equal(result.contribution.resultsForOwner.length,0);
  assert.equal(result.contribution.executionTrace.degraded,true);
});

test('Jev skips deterministic owner-routed case, invokes bounded ambiguity, and preserves abstention',async()=>{
  const registry=new CoprocessorResourceConnections();let jevCalls=0;
  addResource(registry,{capabilities:[Capability.SEMANTIC_JUDGMENT],handlers:{JEV_DECISION:()=>{jevCalls++;return jevAbstain();}}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const clearTurn=turn('clear');
  const clear=await swarm.runTurn({turnEvent:clearTurn,plannerInput:{text:'Thanks!'},ownerSignals:{jevGate:{route:'SKIP_JEV',reasonCodes:['DETERMINISTIC_SUFFICIENT']}},currentRevisionState:clearTurn});
  assert.equal(jevCalls,0);
  assert.equal(clear.contribution.executionTrace.jev.status,'SKIPPED');

  const request=jevRequest('ambiguous'),ambiguousTurn=turn('ambiguous');
  const ambiguous=await swarm.runTurn({
    turnEvent:ambiguousTurn,plannerInput:{text:'Which bounded interpretation is supported?',conflictSignals:['unresolved']},
    ownerSignals:{jevGate:{route:'INVOKE_JEV',expectedDecisionValue:.9},jevQuestion:{questionId:request.decisionId,decisionShape:request.decisionShape,optionIds:['option-a','option-b'],evidenceRefs:['ev:a','ev:b']}},
    jevRequest:request,currentRevisionState:()=>freshJev(request),
  });
  assert.equal(jevCalls,1);
  assert.equal(ambiguous.contribution.jevReceipt.outcome,'ABSTAINED');
  assert.equal(ambiguous.contribution.jevReceipt.abstained,true);
  assert.equal(ambiguous.contribution.jevReceipt.authorityGranted,false);
  assert.equal(ambiguous.contribution.jevReceipt.settlementPerformed,false);
  assert.equal(ambiguous.contribution.finalChoiceAuthority,false);
});

test('host contract exposes swarm actions, read model and checkpoint validation without UI ownership',async()=>{
  const host=createCoprocessorResourceHost();
  assert.equal(typeof host.actions.prepareSwarmTurn,'function');
  assert.equal(typeof host.execution.runSwarmTurn,'function');
  assert.equal(typeof host.execution.executeSwarmCheckpoint,'function');
  assert.equal(typeof host.read.swarm,'function');
  assert.equal(typeof host.read.swarmTurn,'function');
  assert.equal(typeof host.durability.validateCheckpoint,'function');
  assert.equal(host.read.swarm().authority.finalChoice,false);
  assert.equal(host.authority.contextSeal,false);
});

test('swarm telemetry reports placement/result/provider measurement without raw private prompt content',async()=>{
  const telemetry=new CoprocessorTelemetry({limit:200});
  const registry=new CoprocessorResourceConnections({telemetry});
  addResource(registry,{capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>graphOutput('forest-monitor')}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry,telemetry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const t=turn('telemetry');
  await swarm.runTurn({turnEvent:t,plannerInput:{text:'Where is the monitoring instrument?',queryIntent:'LOCATION'},inputResolver:()=>graphInput('forest-monitor'),currentRevisionState:t});
  const snapshot=telemetry.snapshot();
  assert.equal(snapshot.swarm.turnsPlanned,1);
  assert.equal(snapshot.swarm.assignments,1);
  assert.equal(snapshot.swarm.results,1);
  assert.equal(snapshot.providerCalls.invoked,1);
  assert.equal(snapshot.providerCalls.usageReceipts,1);
  const serialized=JSON.stringify(telemetry.list());
  assert.equal(serialized.includes('The sensor remains mounted at the current location.'),false);
});

test('zero optional resources preserves native Brain path and reports optional work unavailable without throwing',async()=>{
  const registry=new CoprocessorResourceConnections();
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const t=turn('native-only');
  const result=await swarm.runTurn({turnEvent:t,plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION'},currentRevisionState:t});
  assert.equal(registry.readModel().readyResourceCount,0);
  assert.equal(registry.readModel().nativePathRequired,true);
  assert.equal(result.contribution.resultsForOwner.length,0);
  assert.equal(result.contribution.ownerAdmissionRequired,true);
  assert.ok(result.contribution.choiceContribution.consideredOptions.some(x=>x.disposition==='UNAVAILABLE'));
  assert.equal(result.contribution.finalChoiceAuthority,false);
});

test('disconnecting a Jev resource mid-decision preserves UNRESOLVED instead of manufacturing an invalid decision',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{capabilities:[Capability.SEMANTIC_JUDGMENT],handlers:{JEV_DECISION:({signal})=>new Promise((resolve,reject)=>{
    const fail=()=>{const error=new Error('resource disconnected');error.code='PROVIDER_ABORTED';reject(error);};
    if(signal?.aborted)fail();else signal?.addEventListener('abort',fail,{once:true});
  })}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const request=jevRequest('disconnect'),t=turn('disconnect');
  const running=swarm.runTurn({turnEvent:t,plannerInput:{text:'Which bounded interpretation is supported?',conflictSignals:['unresolved']},
    ownerSignals:{jevGate:{route:'INVOKE_JEV',expectedDecisionValue:.9},jevQuestion:{questionId:request.decisionId,decisionShape:request.decisionShape,optionIds:['option-a','option-b'],evidenceRefs:['ev:a','ev:b']}},
    jevRequest:request,currentRevisionState:()=>freshJev(request)});
  await sleep(10);registry.disconnectResource('one');
  const result=await running;
  assert.equal(result.contribution.jevReceipt.outcome,'UNRESOLVED');
  assert.equal(result.contribution.jevReceipt.serviceStatus,'JEV_UNAVAILABLE');
  assert.equal(result.contribution.jevReceipt.authorityGranted,false);
  assert.equal(result.contribution.resultsForOwner.length,0);
});

test('tampered durable checkpoint identity is rejected before optional execution',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>graphOutput('ridge-array')}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const t=turn('tamper');
  const prepared=swarm.prepareTurn({turnEvent:t,plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION'}});
  const bad=JSON.parse(JSON.stringify(prepared.checkpoint));bad.pendingTasks[0].correlationId='corr:other';
  await assert.rejects(()=>swarm.executeCheckpoint(bad,{currentRevisionState:t}),/checkpoint task identity mismatch/);
});

test('cross-turn Jev request is rejected before provider execution',async()=>{
  const registry=new CoprocessorResourceConnections();let calls=0;
  addResource(registry,{capabilities:[Capability.SEMANTIC_JUDGMENT],handlers:{JEV_DECISION:()=>{calls++;return jevAbstain();}}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const t=turn('jev-fence'),request=jevRequest('different-turn');
  await assert.rejects(()=>swarm.runTurn({turnEvent:t,plannerInput:{text:'Which bounded interpretation is supported?',conflictSignals:['unresolved']},
    ownerSignals:{jevGate:{route:'INVOKE_JEV',expectedDecisionValue:.9},jevQuestion:{questionId:request.decisionId,decisionShape:request.decisionShape,optionIds:['option-a','option-b'],evidenceRefs:['ev:a','ev:b']}},
    jevRequest:request,currentRevisionState:t}),/Jev request turn identity does not match swarm checkpoint/);
  assert.equal(calls,0);
});
