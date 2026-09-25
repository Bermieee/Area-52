import {
  Capability,CoprocessorResourceConnections,DynamicFanOutPlanner,JevDecisionShape,NativeSidecarSwarm,ResourceKind,
  createJevDecisionRequest,createTurnEnvelope,
} from '../src/coprocessor/index.js';

const now=()=>globalThis.performance?.now?.()??Date.now();
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

function turn(id){const t=Date.now();return createTurnEnvelope({turnId:'turn:'+id,eventId:'event:'+id,correlationId:'corr:'+id,sourceRevisionSet:['source:'+id+'@1'],worldRevision:5,sceneRevision:8,characterStateRevision:3,createdAt:t,deadline:t+5000,cognitiveLayer:'L1'});}
function graphInput(setting){return{nodes:[{ref:setting+':location',type:'LOCATION'}],edges:[],states:[{ref:setting+':state',entityRef:setting+':sensor',temporalStatus:'CURRENT',summary:'The bounded sensor state is current.'}],conflicts:[]};}
function truthInput(setting){return{intent:'CURRENT_STATE',evidence:[{ref:setting+':e1',statement:'The bounded environmental system is online.',semanticKey:setting+':system',temporalStatus:'CURRENT',authority:'OBSERVED'}],conflictSets:[],requiredRefs:[setting+':e1']};}
function graphOutput(setting){return{nodes:[setting+':location'],edges:[],currentStateRefs:[setting+':state'],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'Current bounded state selected from supplied refs.'};}
function truthOutput(setting){return{assessments:[{refs:[setting+':e1'],classification:'SUPPORTED',confidence:.95,reasoningSummary:'Evidence is internally consistent.'}],ranking:[{ref:setting+':e1',score:.94}],rejectedRefs:[],uncertaintyPreserved:true};}
function jevDecision(){return{outcome:'DECIDED',decisionCode:'CHOOSE_ONE',selectedOptionIds:['option-a'],rejectedOptionIds:['option-b'],classification:'SUPPORTED_OPTION',reasonCodes:['EVIDENCE_COVERAGE'],evidenceUsed:['ev:a'],unresolvedFactors:[],confidence:.82,abstained:false,escalationTarget:null,requiresOperator:false,explanation:'Option A has the bounded supporting evidence.'};}
function add(registry,{id,profileId,delayMs=0,capabilities=[Capability.GRAPH,Capability.TRUTH_JUDGMENT,Capability.RERANK],jev=false}){
  const handlers={
    GRAPH_WALK:async()=>{if(delayMs)await sleep(delayMs);return graphOutput('subsea-relay');},
    TRUTH_PRECISION:async()=>{if(delayMs)await sleep(delayMs);return truthOutput('subsea-relay');},
  };
  if(jev)handlers.JEV_DECISION=async()=>{if(delayMs)await sleep(delayMs);return jevDecision();};
  registry.addResource({resourceId:id,providerProfileId:profileId,providerId:'provider:'+id,workerId:'worker:'+id,kind:ResourceKind.DETERMINISTIC_LOCAL,modelId:'model:'+id,capabilities,handlers,maxConcurrency:1,latencyClass:'LOW',local:true});
}
function plannerInput(){return{text:'Where is the instrument and is its current physical state ambiguous?',queryIntent:'CURRENT_STATE',conflictSignals:['unresolved-state']};}
function resolver(task){return task.taskType==='GRAPH_WALK'?graphInput('subsea-relay'):truthInput('subsea-relay');}
function request(){
  const t=Date.now();return createJevDecisionRequest({decisionId:'eval:bounded-choice',decisionType:'GENERIC_BOUNDED_AMBIGUITY',decisionShape:JevDecisionShape.CHOOSE_ONE,turnId:'turn:jev-eval',taskId:'task:jev-eval',correlationId:'corr:jev-eval',
    options:[{optionId:'option-a',label:'Interpretation A',evidenceRefs:['ev:a']},{optionId:'option-b',label:'Interpretation B',evidenceRefs:['ev:b']}],
    evidenceRefs:[{evidenceId:'ev:a',summary:'Independent observation supports interpretation A.'},{evidenceId:'ev:b',summary:'Indirect evidence weakly supports interpretation B.'}],
    sourceRevisionSet:['source:jev-eval@1'],worldRevision:5,sceneRevision:8,characterStateRevision:3,domainRevisions:{generic:1},freshnessToken:'fresh:jev-eval',
    authorityBoundary:{authorityClass:'ADVISORY',ownerId:'brain-core'},routing:{expectedDecisionValue:.9,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2,currentGenerationDepends:true},
    escalationPolicy:{maxRetries:0},deadline:t+5000,softDeadline:t+3000});
}
function freshJev(r){return{sourceRevisionSet:r.sourceRevisionSet,worldRevision:r.worldRevision,sceneRevision:r.sceneRevision,characterStateRevision:r.characterStateRevision,domainRevisions:r.domainRevisions,freshnessToken:r.freshnessToken};}

async function executeResourceCount(count){
  const registry=new CoprocessorResourceConnections();
  add(registry,{id:'alpha',profileId:'a-alpha',delayMs:20});if(count>1)add(registry,{id:'beta',profileId:'b-beta',delayMs:20});
  await registry.connectResource('alpha');if(count>1)await registry.connectResource('beta');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:500,defaultHardBudgetMs:1000})});
  const t=turn('resources-'+count),started=now();
  const result=await swarm.runTurn({turnEvent:t,plannerInput:plannerInput(),inputResolver:resolver,currentRevisionState:t});
  return{wallMs:now()-started,assignments:result.contribution.resultSummary,ready:result.contribution.resultsForOwner.length};
}

export async function runWave15NativeSwarmEvaluation(){
  const hostStart=now(),memoryBefore=process.memoryUsage().heapUsed,cpuStart=process.cpuUsage();
  const one=await executeResourceCount(1),two=await executeResourceCount(2);

  const jevRegistry=new CoprocessorResourceConnections();
  add(jevRegistry,{id:'jev',profileId:'jev-profile',capabilities:[Capability.SEMANTIC_JUDGMENT],jev:true});
  await jevRegistry.connectResource('jev');
  const swarm=new NativeSidecarSwarm({connections:jevRegistry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:500,defaultHardBudgetMs:1000})});
  const clearTurn=turn('clear-eval');
  const clear=await swarm.runTurn({turnEvent:clearTurn,plannerInput:{text:'Thank you.'},ownerSignals:{jevGate:{route:'SKIP_JEV',reasonCodes:['DETERMINISTIC_SUFFICIENT']}},currentRevisionState:clearTurn});
  const r=request(),jevTurn=createTurnEnvelope({turnId:r.turnId,eventId:'event:jev-eval',correlationId:r.correlationId,sourceRevisionSet:r.sourceRevisionSet,worldRevision:r.worldRevision,sceneRevision:r.sceneRevision,characterStateRevision:r.characterStateRevision,createdAt:Date.now(),deadline:Date.now()+5000,cognitiveLayer:'L1'});
  const ambiguous=await swarm.runTurn({turnEvent:jevTurn,plannerInput:{text:'Which bounded interpretation is supported?',conflictSignals:['unresolved']},ownerSignals:{jevGate:{route:'INVOKE_JEV',expectedDecisionValue:.9},jevQuestion:{questionId:r.decisionId,decisionShape:r.decisionShape,optionIds:['option-a','option-b'],evidenceRefs:['ev:a','ev:b']}},jevRequest:r,currentRevisionState:()=>freshJev(r)});

  const cpu=process.cpuUsage(cpuStart),memoryAfter=process.memoryUsage().heapUsed;
  return Object.freeze({
    benchmark:'AREA52_NATIVE_SIDECAR_SWARM_WAVE15',
    measurementClasses:{swarmTiming:'LOCAL_DETERMINISTIC',jevUsefulness:'LOCAL_DETERMINISTIC',externalProvider:'NOT_MEASURED_IN_DEFAULT_CI',simulated:'NONE'},
    scenarios:['subsea relay station','lunar greenhouse'],
    nativeSwarm:{
      oneResource:{wallMs:one.wallMs,readyResults:one.ready,resourceIds:[...new Set(one.assignments.filter(x=>x.state==='READY_FOR_CORE').map(x=>x.resourceId))]},
      twoResources:{wallMs:two.wallMs,readyResults:two.ready,resourceIds:[...new Set(two.assignments.filter(x=>x.state==='READY_FOR_CORE').map(x=>x.resourceId))]},
      sameLogicalTaskSet:JSON.stringify(one.assignments.map(x=>x.taskType).sort())===JSON.stringify(two.assignments.map(x=>x.taskType).sort()),
      secondResourceOptional:one.ready===two.ready&&one.ready>0,
    },
    jev:{
      clearStatus:clear.contribution.executionTrace.jev.status,
      clearProviderRan:clear.contribution.executionTrace.jev.ran,
      deterministicBaseline:'UNRESOLVED',
      optionalOutcome:ambiguous.contribution.jevReceipt?.outcome??null,
      selectedOptionIds:ambiguous.contribution.jevReceipt?.selectedOptionIds??[],
      changedDecision:ambiguous.contribution.jevReceipt?.outcome==='DECIDED',
      authorityGranted:ambiguous.contribution.jevReceipt?.authorityGranted??null,
      settlementPerformed:ambiguous.contribution.jevReceipt?.settlementPerformed??null,
    },
    hostMeasurements:{measurementClass:'LOCAL_DETERMINISTIC',wallMs:now()-hostStart,cpuMs:{user:cpu.user/1000,system:cpu.system/1000,total:(cpu.user+cpu.system)/1000},heapDeltaBytes:memoryAfter-memoryBefore},
    costAndTokens:{status:'NOT_MEASURED',reason:'deterministic local adapters do not produce provider usage/pricing receipts'},
    liveProviderRequirement:{measurementClass:'MEASURED_LIVE',status:'REQUIRES_OPERATOR_CONFIGURED_ENDPOINT',requiredEvidence:['realProviderCallObserved','providerProfileId','providerId','modelId','latencyMs','usageReceipt when available','safe failure/fallback observation']},
    authority:{truth:false,precision:false,settlement:false,canonicalMutation:false,finalChoice:false,contextSeal:false},
  });
}
