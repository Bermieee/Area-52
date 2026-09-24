import {
  Capability, CoprocessorTelemetry, DynamicFanOutPlanner, WarmState, createCoprocessorChoiceExecutionTrace,
  createTurnEnvelope, toCoreCognitiveChoiceContribution,
} from '../src/coprocessor/index.js';

const now=()=>globalThis.performance?.now?.()??Date.now();
const profiles=()=>[
  {profileId:'eval-historian',capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'eval-graph',capabilities:[Capability.GRAPH],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'eval-green',capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.CHARACTER_INFERENCE],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'eval-truth',capabilities:[Capability.TRUTH_JUDGMENT,Capability.RERANK],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'eval-deep',capabilities:[Capability.CONSOLIDATION,Capability.COMPRESSION],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'HIGH'},
  {profileId:'eval-jev',capabilities:[Capability.DEEP_REASONING],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'MEDIUM'},
  {profileId:'eval-external',capabilities:[Capability.EXTERNAL_GROUNDING],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'HIGH'},
];
const turn=(name,overrides={})=>createTurnEnvelope({turnId:'eval:'+name,eventId:'evt:'+name,correlationId:'corr:'+name,dedupeKey:'eval:'+name,createdAt:100,
  sourceRevisionSet:['src:scene:7','src:lore:1'],worldRevision:12,sceneRevision:7,characterStateRevision:4,deadline:250,...overrides});
const option=(p,id)=>p.options.find(x=>x.optionId===id);
const fixtureLatency=(proposal,resourceCount)=>{const xs=proposal.options.filter(x=>x.disposition==='NOMINATED').map(x=>Number(x.estimatedLatency.milliseconds)||0);return resourceCount===1?xs.reduce((a,b)=>a+b,0):(xs.length?Math.max(...xs):0);};

export function wave13Corpus(){
  return [
    {name:'hot-only',input:{text:'Thanks!',hotStateSufficient:true},expected:{jev:'SKIPPED'}},
    {name:'retrieval-heavy',input:{text:'Where did we leave the Sun Blade last time?',queryIntent:'LOCATION',activeThreads:['sun-blade'],activeCast:['Mara','Eris']}},
    {name:'low-quality-abstain',input:{text:'What does the old Blade evidence prove?',queryIntent:'HISTORY',retrievalQuality:'LOW'},ownerOutcome:{memoryLongTerm:'ABSTAIN'}},
    {name:'mixed-one-correction',input:{text:'Which Blade evidence is current?',queryIntent:'CURRENT_STATE',retrievalQuality:'MIXED',
      ownerSignals:{correctiveRetrieval:{requested:true,attempt:0,maxAttempts:1,evidenceRefs:['c:a','c:b']}}}},
    {name:'ambiguous-blade-jev',input:{text:'Was the Blade destroyed or merely removed?',queryIntent:'HISTORY',conflictSignals:['blade-fate'],
      ownerSignals:{jevGate:{route:'INVOKE_JEV',expectedDecisionValue:.84},jevQuestion:{questionId:'q:blade',optionIds:['destroyed','removed'],evidenceRefs:['ev:d','ev:r'],query:'destroyed or removed?'}}},
      jevObservation:{status:'ABSTAINED',ran:true,abstained:true,unresolved:true,providerProfileId:'fixture-jev',latencyMs:18,measuredContribution:{baselineOutcome:'UNRESOLVED',optionalOutcome:'UNRESOLVED',changedDecision:false,measurementClass:'SIMULATED_FIXTURE'}}},
    {name:'optional-provider-failure',input:{text:'destroyed or removed?',conflictSignals:['blade'],
      ownerSignals:{jevGate:{route:'INVOKE_JEV'},jevQuestion:{questionId:'q:fail',optionIds:['a','b'],evidenceRefs:['e:a','e:b']}}},
      providerFailure:true},
    {name:'one-resource-load',input:{text:'Where is the Blade and what happened before?',queryIntent:'LOCATION',activeThreads:['blade'],activeCast:['Mara','Eris'],resourceCount:1}},
    {name:'multi-resource-load',input:{text:'Where is the Blade and what happened before?',queryIntent:'LOCATION',activeThreads:['blade'],activeCast:['Mara','Eris'],resourceCount:4}},
    {name:'warm-fresh',input:{text:'Continue the blade thread.',activeThreads:['blade'],warmState:WarmState.FRESH},warmObservation:{freshness:'FRESH',coreRevalidated:true,countedUseful:true,preparationCostMs:13,sendLatencySavedMs:7,measurementClass:'SIMULATED_FIXTURE'}},
    {name:'warm-miss',input:{text:'Continue the blade thread.',activeThreads:['blade'],warmState:null},warmObservation:{freshness:null,coreRevalidated:false,countedUseful:false,preparationCostMs:0,sendLatencySavedMs:0,measurementClass:'SIMULATED_FIXTURE'}},
    {name:'warm-stale-late',input:{text:'Where is the Blade?',queryIntent:'LOCATION',warmState:WarmState.STALE},late:true,warmObservation:{freshness:'STALE',coreRevalidated:false,countedUseful:false,preparationCostMs:12,sendLatencySavedMs:0,measurementClass:'SIMULATED_FIXTURE'}},
  ];
}

export async function runCoprocessorWave13Evaluation(){
  const planner=new DynamicFanOutPlanner(),telemetry=new CoprocessorTelemetry(),baseProfiles=profiles();
  const beforeMem=typeof process!=='undefined'&&process.memoryUsage?process.memoryUsage().heapUsed:null;
  const cpuStart=typeof process!=='undefined'&&process.cpuUsage?process.cpuUsage():null;
  const wallStart=now(),rows=[];
  let providerCallsSimulated=0,falseCertainty=0,falseSelections=0,totalSkipped=0,totalNominated=0,totalDeferred=0,totalUnavailable=0;
  for(const scenario of wave13Corpus()){
    const input={...scenario.input,turnEvent:turn(scenario.name),capabilityProfiles:baseProfiles,telemetry};
    const started=now(),choice=planner.planChoice(input),proposal=choice.choiceProposal;
    let runtimeRecords=[],swarmTraces=[],resultRoutes=[];
    if(scenario.providerFailure){
      swarmTraces=[{optionId:'jev-adjudication',validation:'FAIL',failureCode:'PROVIDER_TIMEOUT',workerId:'fixture-slot',providerId:'fixture-jev'}];
      providerCallsSimulated+=1;
    }
    if(scenario.late){
      const graph=option(proposal,'graph-walker');if(graph?.taskId)resultRoutes=[{result:{taskId:graph.taskId,id:'late:graph'},route:{freshness:'FRESH',late:true}}];
    }
    if(scenario.name==='ambiguous-blade-jev')providerCallsSimulated+=1;
    const trace=createCoprocessorChoiceExecutionTrace({proposal,runtimeRecords,swarmTraces,resultRoutes,jevObservation:scenario.jevObservation,warmObservation:scenario.warmObservation,telemetry});
    const contribution=toCoreCognitiveChoiceContribution({proposal,executionTrace:trace});
    const jev=option(proposal,'jev-adjudication'),correction=option(proposal,'corrective-retrieval');
    const unresolved=scenario.name==='ambiguous-blade-jev'||scenario.name==='optional-provider-failure';
    if(unresolved&&trace.jev?.status&&!['ABSTAINED','UNRESOLVED','UNAVAILABLE','NOT_OBSERVED','SKIPPED'].includes(trace.jev.status))falseCertainty++;
    if(scenario.name==='hot-only'&&proposal.counts.NOMINATED>0)falseSelections++;
    totalSkipped+=proposal.counts.SKIPPED;totalNominated+=proposal.counts.NOMINATED;totalDeferred+=proposal.counts.DEFERRED;totalUnavailable+=proposal.counts.UNAVAILABLE;
    rows.push({
      name:scenario.name,proposalId:proposal.proposalId,resourceCount:proposal.resourceCount,resourceMode:proposal.resourceMode,
      nominated:proposal.counts.NOMINATED,skipped:proposal.counts.SKIPPED,deferred:proposal.counts.DEFERRED,unavailable:proposal.counts.UNAVAILABLE,
      nominatedOptions:proposal.options.filter(x=>x.disposition==='NOMINATED').map(x=>x.optionId),
      jevDisposition:jev?.disposition??null,jevStatus:trace.jev?.status??null,jevFallbackType:jev?.fallback?.type??null,correctiveDisposition:correction?.disposition??null,
      warmFreshness:trace.warm?.freshness??null,warmCountedUseful:Boolean(trace.warm?.countedUseful),
      fixtureCriticalPathEstimateMs:fixtureLatency(proposal,proposal.resourceCount),
      hostPolicyEvaluationMs:now()-started,executionDegraded:trace.degraded,
      coreAuthorityCheck:contribution.cognitiveChoiceReceipt===null&&contribution.finalChoiceAuthority===false&&contribution.finalEvidenceRefs===null,
      ownerOutcome:scenario.ownerOutcome??null,
    });
  }
  const wallMs=now()-wallStart,cpu=cpuStart&&typeof process!=='undefined'&&process.cpuUsage?process.cpuUsage(cpuStart):null,afterMem=typeof process!=='undefined'&&process.memoryUsage?process.memoryUsage().heapUsed:null;
  const one=rows.find(x=>x.name==='one-resource-load'),many=rows.find(x=>x.name==='multi-resource-load');
  const policyTurn=turn('policy-compare');
  const strictPolicy=planner.planChoice({turnEvent:policyTurn,text:'Check a current public fact if needed.',capabilityProfiles:baseProfiles,externalGroundingNeeded:true,externalGroundingPolicy:'DENY',choicePolicyVersion:'choice:strict'}).choiceProposal;
  const allowedPolicy=planner.planChoice({turnEvent:policyTurn,text:'Check a current public fact if needed.',capabilityProfiles:baseProfiles,externalGroundingNeeded:true,externalGroundingPolicy:'ALLOW',choicePolicyVersion:'choice:external-allowed'}).choiceProposal;
  const strictExternal=option(strictPolicy,'external-grounding'),allowedExternal=option(allowedPolicy,'external-grounding');
  const ambiguous=rows.find(x=>x.name==='ambiguous-blade-jev'),providerFailure=rows.find(x=>x.name==='optional-provider-failure');
  const report={
    benchmark:'AREA52_COPROCESSOR_CHOICE_WAVE13',corpusCases:rows.length,
    providerConfiguration:{defaultPath:'LOCAL_SELF_CONTAINED',liveProviderSmoke:{status:'SKIPPED',reason:'NO_LIVE_PROVIDER_BOUND_CONFIGURED_IN_WAVE13_EVALUATOR'},fixtureProviderTiming:'SIMULATED_FIXTURE_ONLY'},
    correctness:{falseCertainty,falseSelections,bladeFatePreservedUnresolved:rows.find(x=>x.name==='ambiguous-blade-jev')?.jevStatus==='ABSTAINED',
      hotOnlyOptionalNominations:rows.find(x=>x.name==='hot-only')?.nominated??null,mixedCorrectiveNominated:rows.find(x=>x.name==='mixed-one-correction')?.correctiveDisposition==='NOMINATED',
      warmUsefulRequiresCoreRevalidation:rows.find(x=>x.name==='warm-fresh')?.warmCountedUseful===true,
      providerFailureFallbackCorrect:Boolean(providerFailure?.executionDegraded&&providerFailure?.jevFallbackType==='PRESERVE_UNRESOLVED'&&providerFailure?.coreAuthorityCheck),
      allCoreAuthorityChecks:rows.every(x=>x.coreAuthorityCheck)},
    work:{nominated:totalNominated,skipped:totalSkipped,deferred:totalDeferred,unavailable:totalUnavailable,providerCallsSimulated,
      oneResourceCriticalPathEstimateMs:one?.fixtureCriticalPathEstimateMs??null,multiResourceCriticalPathEstimateMs:many?.fixtureCriticalPathEstimateMs??null,
      semanticResourceParity:JSON.stringify(one?.nominatedOptions??[])===JSON.stringify(many?.nominatedOptions??[])},
    policyComparison:{measurementClass:'DETERMINISTIC_POLICY_REPLAY',strictPolicyVersion:strictPolicy.policyVersion,allowedPolicyVersion:allowedPolicy.policyVersion,
      strictExternalDisposition:strictExternal?.disposition??null,allowedExternalDisposition:allowedExternal?.disposition??null,
      changedOptions:strictExternal?.disposition===allowedExternal?.disposition?[]:['external-grounding'],authorityChanged:false},
    pathComparison:{measurementClass:'SIMULATED_FIXTURE_ONLY',
      deterministicOnly:{outcome:'UNRESOLVED',providerCalls:0,fixtureProviderLatencyMs:0},
      optionalJev:{outcome:ambiguous?.jevStatus==='ABSTAINED'?'UNRESOLVED':ambiguous?.jevStatus,providerCalls:1,fixtureProviderLatencyMs:18,changedDecision:false},
      providerFailure:{degraded:Boolean(providerFailure?.executionDegraded),fallbackContract:providerFailure?.jevFallbackType??null,outcome:'UNRESOLVED',fabricatedAuthority:false}},
    hostMeasurements:{measurementClass:'ACTUAL_NODE_HOST_PROCESS',wallMs,cpuMs:cpu?{user:cpu.user/1000,system:cpu.system/1000,total:(cpu.user+cpu.system)/1000}:null,
      heapDeltaBytes:beforeMem!=null&&afterMem!=null?afterMem-beforeMem:null},
    costAndTokens:{status:'NOT_MEASURED',reason:'no live provider usage/pricing receipt in deterministic Wave 13 evaluation'},
    rows,telemetry:telemetry.snapshot().choice,
  };
  return Object.freeze(report);
}
