import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Capability,CoprocessorResourceConnections,DynamicFanOutPlanner,GatherCoordinator,JevDecisionShape,NativeSidecarSwarm,
  NativeSwarmResultState,ResourceKind,admitNativeSwarmContributionToOwner,createJevDecisionRequest,createTurnEnvelope,
} from '../src/coprocessor/index.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function turn(id,{worldRevision=3,sceneRevision=4}={}){
  const now=Date.now();
  return createTurnEnvelope({
    turnId:'turn:'+id,eventId:'event:'+id,correlationId:'corr:'+id,sourceRevisionSet:['source:'+id+'@1'],
    worldRevision,sceneRevision,characterStateRevision:2,createdAt:now,deadline:now+5000,cognitiveLayer:'L1',
  });
}
function graphInput(setting='wave17'){
  return{nodes:[{ref:setting+':location',type:'LOCATION'}],edges:[],states:[{ref:setting+':state',entityRef:setting+':sensor',temporalStatus:'CURRENT',summary:'Sensor is at the bounded current location.'}],conflicts:[]};
}
function truthInput(setting='wave17'){
  return{intent:'CURRENT_STATE',evidence:[{ref:setting+':e1',statement:'The bounded system is online.',semanticKey:setting+':system',temporalStatus:'CURRENT',authority:'OBSERVED'}],conflictSets:[],requiredRefs:[setting+':e1']};
}
function graphOutput(setting='wave17'){
  return{nodes:[setting+':location'],edges:[],currentStateRefs:[setting+':state'],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'Current bounded state selected.'};
}
function truthOutput(setting='wave17'){
  return{assessments:[{refs:[setting+':e1'],classification:'SUPPORTED',confidence:.95,reasoningSummary:'Bounded evidence is consistent.'}],ranking:[{ref:setting+':e1',score:.94}],rejectedRefs:[],uncertaintyPreserved:true};
}
function resolver(setting='wave17'){
  return task=>task.taskType==='GRAPH_WALK'?graphInput(setting):task.taskType==='TRUTH_PRECISION'?truthInput(setting):{};
}
function plannerInput(){
  return{text:'Where is the instrument, and is its current physical state ambiguous?',queryIntent:'CURRENT_STATE',conflictSignals:['state-conflict'],activeCast:[]};
}
function graphPlannerInput(){return{text:'Where is the field instrument?',queryIntent:'LOCATION',activeCast:[]};}
function addResource(registry,{id,profileId=id,capabilities,handlers,maxConcurrency=1}){
  registry.addResource({
    resourceId:id,providerProfileId:'profile:'+profileId,providerId:'provider:'+id,workerId:'worker:'+id,
    kind:ResourceKind.DETERMINISTIC_LOCAL,modelId:'model:'+id,capabilities,handlers,maxConcurrency,latencyClass:'LOW',local:true,
  });
}
async function prepareExecute(swarm,t,input,{inputResolver=resolver(),currentRevisionState=t,sealed=false,signal=null,ownerSignals={},jevRequest=null}={}){
  const prepared=swarm.prepareTurn({turnEvent:t,plannerInput:input,ownerSignals});
  const result=await swarm.executeCheckpoint(prepared.checkpoint,{inputResolver,currentRevisionState,sealed,signal,ownerSignals,jevRequest});
  return{prepared,result};
}
async function ownerAdmit(prepared,result,{currentRevisionState=prepared.checkpoint.revisionFence,sealed=false}={}){
  const gather=new GatherCoordinator({turnEvent:{
    turnId:prepared.checkpoint.turnId,correlationId:prepared.checkpoint.correlationId,eventId:'event:owner',
  },plan:prepared.fanOutPlan,currentRevisionSet:currentRevisionState});
  if(sealed)gather.markSealed({kind:'ContextSealReceipt',sealedState:true});
  const receipt=await admitNativeSwarmContributionToOwner({contribution:result.contribution,gather});
  return{gather,receipt};
}
function jevRequest(id){
  const now=Date.now();
  return createJevDecisionRequest({
    decisionId:'decision:'+id,decisionType:'GENERIC_BOUNDED_AMBIGUITY',decisionShape:JevDecisionShape.CHOOSE_ONE,
    turnId:'turn:'+id,taskId:'jev-task:'+id,correlationId:'corr:'+id,
    options:[{optionId:'option-a',label:'A',evidenceRefs:['ev:a']},{optionId:'option-b',label:'B',evidenceRefs:['ev:b']}],
    evidenceRefs:[{evidenceId:'ev:a',summary:'Evidence A.'},{evidenceId:'ev:b',summary:'Evidence B.'}],
    sourceRevisionSet:['source:'+id+'@1'],worldRevision:3,sceneRevision:4,characterStateRevision:2,domainRevisions:{generic:1},freshnessToken:'fresh:'+id,
    authorityBoundary:{authorityClass:'ADVISORY',ownerId:'brain-core'},
    routing:{expectedDecisionValue:.9,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2,currentGenerationDepends:true},
    escalationPolicy:{maxRetries:0},deadline:now+5000,softDeadline:now+3000,
  });
}
function freshJev(r){return{sourceRevisionSet:r.sourceRevisionSet,worldRevision:r.worldRevision,sceneRevision:r.sceneRevision,characterStateRevision:r.characterStateRevision,domainRevisions:r.domainRevisions,freshnessToken:r.freshnessToken};}
function jevAbstain(){return{outcome:'ABSTAINED',decisionCode:'ABSTAIN',selectedOptionIds:[],rejectedOptionIds:[],classification:null,reasonCodes:['INSUFFICIENT_EVIDENCE'],evidenceUsed:[],unresolvedFactors:['Both alternatives remain viable.'],confidence:0,abstained:true,escalationTarget:null,requiresOperator:false,explanation:'Owner evidence remains unresolved.'};}

test('Wave17 zero-resource plan executes safely and owner admits nothing',async()=>{
  const registry=new CoprocessorResourceConnections(),swarm=new NativeSidecarSwarm({connections:registry});
  const t=turn('zero'),{prepared,result}=await prepareExecute(swarm,t,graphPlannerInput(),{inputResolver:resolver('zero')});
  const {receipt}=await ownerAdmit(prepared,result);
  assert.equal(registry.readModel().nativePathRequired,true);
  assert.equal(result.contribution.resultsForOwner.length,0);
  assert.equal(receipt.eligibleResultIds.length,0);assert.equal(receipt.acceptedResultIds.length,0);
  assert.equal(receipt.ownerAdmissionPerformed,true);assert.equal(receipt.finalChoiceAuthority,false);assert.equal(receipt.contextSealAuthority,false);
});

test('Wave17 one resource serializes logical jobs and owner Gather explicitly admits both',async()=>{
  const registry=new CoprocessorResourceConnections();let active=0,maxActive=0;
  const guard=fn=>async()=>{active++;maxActive=Math.max(maxActive,active);await sleep(8);try{return fn();}finally{active--;}};
  addResource(registry,{id:'one',capabilities:[Capability.GRAPH,Capability.TRUTH_JUDGMENT,Capability.RERANK],handlers:{GRAPH_WALK:guard(()=>graphOutput('one')),TRUTH_PRECISION:guard(()=>truthOutput('one'))},maxConcurrency:1});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500})});
  const t=turn('one'),{prepared,result}=await prepareExecute(swarm,t,plannerInput(),{inputResolver:resolver('one')});
  const {receipt}=await ownerAdmit(prepared,result);
  assert.equal(maxActive,1);
  assert.equal(result.contribution.resultSummary.filter(x=>x.state===NativeSwarmResultState.READY_FOR_CORE).length,2);
  assert.equal(receipt.executedResults.filter(x=>x.state===NativeSwarmResultState.READY_FOR_CORE).length,2);
  assert.equal(receipt.eligibleResultIds.length,2);assert.equal(receipt.acceptedResultIds.length,2);
  assert.ok(receipt.admissions.every(x=>x.executed&&x.eligibleForOwner&&x.acceptedByOwner));
  assert.equal(receipt.ownerCompilerInput.graphResults.length,1);assert.equal(receipt.ownerCompilerInput.truthClassifications.length,1);
});

test('Wave17 capability matching scatters graph/truth to different physical resources but owner contract is unchanged',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{id:'graph',profileId:'a-graph',capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>graphOutput('multi')}});
  addResource(registry,{id:'truth',profileId:'b-truth',capabilities:[Capability.TRUTH_JUDGMENT,Capability.RERANK],handlers:{TRUTH_PRECISION:()=>truthOutput('multi')}});
  addResource(registry,{id:'extra',profileId:'c-extra',capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>graphOutput('multi')}});
  for(const id of ['graph','truth','extra'])await registry.connectResource(id);
  const swarm=new NativeSidecarSwarm({connections:registry});
  const t=turn('multi'),{prepared,result}=await prepareExecute(swarm,t,plannerInput(),{inputResolver:resolver('multi')});
  const {receipt}=await ownerAdmit(prepared,result);
  const ready=result.contribution.resultSummary.filter(x=>x.state===NativeSwarmResultState.READY_FOR_CORE);
  const graph=ready.find(x=>x.taskType==='GRAPH_WALK'),truth=ready.find(x=>x.taskType==='TRUTH_PRECISION');
  assert.equal(graph.resourceId,'graph');assert.equal(truth.resourceId,'truth');
  assert.equal(registry.readModel().readyResourceCount,3);assert.equal(receipt.acceptedResultIds.length,2);
});

test('Wave17 fallback execution can be owner-admitted while failed physical attempt stays telemetry-only',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{id:'bad',profileId:'a-bad',capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>({bad:true})}});
  addResource(registry,{id:'good',profileId:'z-good',capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>graphOutput('fallback')}});
  await registry.connectResource('bad');await registry.connectResource('good');
  const swarm=new NativeSidecarSwarm({connections:registry});
  const t=turn('fallback'),{prepared,result}=await prepareExecute(swarm,t,graphPlannerInput(),{inputResolver:resolver('fallback')});
  const {receipt}=await ownerAdmit(prepared,result);
  const graph=result.contribution.resultSummary.find(x=>x.taskType==='GRAPH_WALK');
  assert.equal(graph.state,NativeSwarmResultState.READY_FOR_CORE);assert.equal(graph.resourceId,'good');assert.equal(graph.attempt,2);assert.equal(graph.fallbackUsed,true);
  assert.deepEqual(receipt.acceptedResultIds,[graph.resultId]);assert.equal(receipt.admissions[0].resourceId,'good');
});

test('Wave17 cancellation and deadline misses execute but cannot become owner evidence',async()=>{
  const cancelling=new CoprocessorResourceConnections();
  addResource(cancelling,{id:'cancel',capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:({signal})=>new Promise((resolve,reject)=>{
    const fail=()=>{const e=new Error('cancelled');e.code='PROVIDER_ABORTED';reject(e);};
    if(signal?.aborted)fail();else signal?.addEventListener('abort',fail,{once:true});
  })}});
  await cancelling.connectResource('cancel');
  const cancelSwarm=new NativeSidecarSwarm({connections:cancelling});
  const ct=turn('cancel'),prepared=cancelSwarm.prepareTurn({turnEvent:ct,plannerInput:graphPlannerInput()});
  const controller=new AbortController();
  const running=cancelSwarm.executeCheckpoint(prepared.checkpoint,{inputResolver:resolver('cancel'),currentRevisionState:ct,signal:controller.signal});
  await sleep(10);controller.abort('operator-cancel');
  const cancelled=await running,{receipt:cancelReceipt}=await ownerAdmit(prepared,cancelled);
  assert.equal(cancelled.contribution.resultsForOwner.length,0);assert.equal(cancelReceipt.acceptedResultIds.length,0);
  assert.ok(cancelled.contribution.resultSummary.some(x=>x.failureCode==='PROVIDER_ABORTED'));

  const timing=new CoprocessorResourceConnections();
  addResource(timing,{id:'slow',capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:async()=>{await sleep(70);return graphOutput('slow');}}});
  await timing.connectResource('slow');
  const timeoutSwarm=new NativeSidecarSwarm({connections:timing,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:10,defaultHardBudgetMs:25})});
  const tt=turn('timeout'),timed=timeoutSwarm.prepareTurn({turnEvent:tt,plannerInput:graphPlannerInput()});
  const late=await timeoutSwarm.executeCheckpoint(timed.checkpoint,{inputResolver:resolver('slow'),currentRevisionState:tt});
  const {receipt:lateReceipt}=await ownerAdmit(timed,late);
  assert.equal(late.contribution.resultsForOwner.length,0);assert.equal(lateReceipt.acceptedResultIds.length,0);
  assert.ok(late.contribution.resultSummary.some(x=>x.state===NativeSwarmResultState.REJECTED_LATE||x.failureCode==='DEADLINE_MISS'));
});

test('Wave17 owner revalidation rejects stale and post-seal results even after successful physical execution',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{id:'one',capabilities:[Capability.GRAPH],handlers:{GRAPH_WALK:()=>graphOutput('fence')}});
  await registry.connectResource('one');
  const swarm=new NativeSidecarSwarm({connections:registry});

  const staleTurn=turn('owner-stale'),staleRun=await prepareExecute(swarm,staleTurn,graphPlannerInput(),{inputResolver:resolver('fence')});
  assert.equal(staleRun.result.contribution.resultsForOwner.length,1);
  const staleOwner=await ownerAdmit(staleRun.prepared,staleRun.result,{currentRevisionState:{...staleTurn,worldRevision:staleTurn.worldRevision+1}});
  assert.equal(staleOwner.receipt.acceptedResultIds.length,0);assert.equal(staleOwner.receipt.admissions[0].stale,true);

  const sealTurn=turn('owner-sealed'),sealRun=await prepareExecute(swarm,sealTurn,graphPlannerInput(),{inputResolver:resolver('fence')});
  assert.equal(sealRun.result.contribution.resultsForOwner.length,1);
  const sealedOwner=await ownerAdmit(sealRun.prepared,sealRun.result,{sealed:true});
  assert.equal(sealedOwner.receipt.acceptedResultIds.length,0);assert.equal(sealedOwner.receipt.admissions[0].late,true);
  assert.equal(sealedOwner.receipt.contextSealAuthority,false);
});

test('Wave17 Jev receipt remains outside generic swarm owner admission and never writes canon/seal',async()=>{
  const registry=new CoprocessorResourceConnections();
  addResource(registry,{id:'jev',capabilities:[Capability.SEMANTIC_JUDGMENT],handlers:{JEV_DECISION:()=>jevAbstain()}});
  await registry.connectResource('jev');
  const swarm=new NativeSidecarSwarm({connections:registry});
  const request=jevRequest('jev-owner'),t=turn('jev-owner');
  const ownerSignals={jevGate:{route:'INVOKE_JEV',expectedDecisionValue:.9},jevQuestion:{questionId:request.decisionId,decisionShape:request.decisionShape,optionIds:['option-a','option-b'],evidenceRefs:['ev:a','ev:b']}};
  const run=await prepareExecute(swarm,t,{text:'Which bounded interpretation?',conflictSignals:['unresolved']},{ownerSignals,jevRequest:request,currentRevisionState:()=>freshJev(request)});
  const {receipt}=await ownerAdmit(run.prepared,run.result);
  assert.equal(run.result.contribution.jevReceipt.outcome,'ABSTAINED');
  assert.equal(receipt.jev.present,true);assert.equal(receipt.jev.admittedByBridge,false);assert.equal(receipt.jev.ownerAdapterRequired,true);
  assert.equal(receipt.jev.authorityGranted,false);assert.equal(receipt.jev.settlementPerformed,false);
  assert.equal(receipt.settlementAuthority,false);assert.equal(receipt.canonicalMutationAuthority,false);assert.equal(receipt.contextSealAuthority,false);
});
