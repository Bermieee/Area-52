import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Capability, CoprocessorChoiceDisposition, CoprocessorChoiceExecutionState, CoprocessorChoiceHistory,
  CoprocessorTelemetry, DynamicFanOutPlanner, WarmState, createCoprocessorChoiceExecutionTrace,
  createTurnEnvelope, toCoreCognitiveChoiceContribution,
} from '../src/coprocessor/index.js';

const turn=(id='t1',overrides={})=>createTurnEnvelope({
  turnId:id,eventId:'evt:'+id,correlationId:'corr:'+id,dedupeKey:'turn:'+id,createdAt:100,
  sourceRevisionSet:['src:scene:7','src:lore:1'],worldRevision:12,sceneRevision:7,characterStateRevision:4,
  deadline:220,...overrides,
});
const profiles=()=>[
  {profileId:'p-historian',capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'p-graph',capabilities:[Capability.GRAPH],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'p-green',capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.CHARACTER_INFERENCE],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'p-truth',capabilities:[Capability.TRUTH_JUDGMENT,Capability.RERANK],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'p-deep',capabilities:[Capability.CONSOLIDATION,Capability.COMPRESSION],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'HIGH'},
  {profileId:'p-jev',capabilities:[Capability.DEEP_REASONING],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'MEDIUM'},
  {profileId:'p-external',capabilities:[Capability.EXTERNAL_GROUNDING],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'HIGH'},
];

function byId(proposal,id){return proposal.options.find(x=>x.optionId===id);}
function semantic(proposal){return proposal.options.map(x=>[x.optionId,x.disposition,x.reasonCodes,x.taskType]);}

test('Wave 13 hot-only thanks turn records every skipped option and nominates no optional work',()=>{
  const telemetry=new CoprocessorTelemetry();
  const planner=new DynamicFanOutPlanner();
  const out=planner.planChoice({turnEvent:turn('thanks'),text:'Thanks!',hotStateSufficient:true,capabilityProfiles:profiles(),telemetry});
  assert.equal(out.fanOutPlan.tasks.length,0);
  assert.equal(out.choiceProposal.counts.NOMINATED,0);
  assert.equal(out.choiceProposal.counts.DEFERRED,0);
  assert.equal(out.choiceProposal.options.length,8);
  assert.equal(out.choiceProposal.options.every(x=>x.disposition===CoprocessorChoiceDisposition.SKIPPED),true);
  assert.equal(out.choiceProposal.options.some(x=>x.optionId==='historian'&&x.reasonCodes.includes('HOT_STATE_SUFFICIENT')),true);
  assert.equal(out.choiceProposal.finalChoiceAuthority,false);
  assert.equal(telemetry.snapshot().choice.proposals,1);
  assert.equal(telemetry.snapshot().choice.skipped,8);
});

test('current-location/history turn nominates Historian and Graph with exact fences and deterministic replay',()=>{
  const planner=new DynamicFanOutPlanner();
  const input={turnEvent:turn('blade'),text:'Where did we leave the Sun Blade last time?',queryIntent:'LOCATION',activeThreads:['sun-blade'],
    capabilityProfiles:profiles(),evidenceRefs:['ev:blade-history'],resourceCount:1};
  const a=planner.planChoice(input),b=planner.planChoice(input);
  assert.equal(a.choiceProposal.proposalId,b.choiceProposal.proposalId);
  assert.deepEqual(semantic(a.choiceProposal),semantic(b.choiceProposal));
  for(const id of ['historian','graph-walker']){
    const option=byId(a.choiceProposal,id);
    assert.equal(option.disposition,CoprocessorChoiceDisposition.NOMINATED);
    assert.equal(option.revisionFence.sceneRevision,7);
    assert.equal(option.revisionFence.worldRevision,12);
    assert.deepEqual(option.revisionFence.sourceRevisionSet,['src:lore:1','src:scene:7']);
    assert.equal(option.physicalExecutionHint,'SERIALIZE_ON_AVAILABLE_RESOURCE');
  }
  assert.equal(JSON.stringify(a.choiceProposal).includes('Blade is at'),false);
});

test('one versus several resources preserve semantic choices while only physical hints change',()=>{
  const planner=new DynamicFanOutPlanner();
  const base={turnEvent:turn('resource'),text:'Where is the Blade and what happened before?',queryIntent:'LOCATION',activeThreads:['blade'],activeCast:['Mara','Eris'],capabilityProfiles:profiles()};
  const one=planner.planChoice({...base,resourceCount:1}).choiceProposal;
  const many=planner.planChoice({...base,resourceCount:4}).choiceProposal;
  assert.deepEqual(one.options.map(x=>[x.optionId,x.disposition,x.reasonCodes]),many.options.map(x=>[x.optionId,x.disposition,x.reasonCodes]));
  assert.equal(one.options.filter(x=>x.disposition==='NOMINATED').every(x=>x.physicalExecutionHint==='SERIALIZE_ON_AVAILABLE_RESOURCE'),true);
  assert.equal(many.options.filter(x=>x.disposition==='NOMINATED').every(x=>x.physicalExecutionHint==='PARALLEL_ELIGIBLE'),true);
});

test('MIXED retrieval exposes at most one owner-gated corrective nomination and never executes it itself',()=>{
  const planner=new DynamicFanOutPlanner();
  const first=planner.planChoice({turnEvent:turn('mixed'),text:'Which Blade evidence is current?',queryIntent:'CURRENT_STATE',retrievalQuality:'MIXED',capabilityProfiles:profiles(),
    ownerSignals:{correctiveRetrieval:{requested:true,attempt:0,maxAttempts:1,evidenceRefs:['candidate:a','candidate:b']}}}).choiceProposal;
  const correction=byId(first,'corrective-retrieval');
  assert.equal(correction.disposition,CoprocessorChoiceDisposition.NOMINATED);
  assert.equal(correction.ownerActionRequired,true);
  assert.equal(first.ownerStageRequests.correctiveRetrieval,true);

  const second=planner.planChoice({turnEvent:turn('mixed-2'),text:'Which Blade evidence is current?',queryIntent:'CURRENT_STATE',retrievalQuality:'MIXED',capabilityProfiles:profiles(),
    ownerSignals:{correctiveRetrieval:{requested:true,attempt:1,maxAttempts:1}}}).choiceProposal;
  assert.equal(byId(second,'corrective-retrieval').disposition,CoprocessorChoiceDisposition.SKIPPED);
  assert.ok(byId(second,'corrective-retrieval').reasonCodes.includes('CORRECTION_LIMIT_REACHED'));

  const core=toCoreCognitiveChoiceContribution({proposal:first});
  assert.equal(core.correctiveExecutionAuthority,false);
  assert.equal(core.cognitiveChoiceReceipt,null);
  assert.equal(core.truthClass,null);
  assert.equal(core.finalEvidenceRefs,null);
});

test('ambiguous Blade fate may nominate Jev only from bounded owner ambiguity and preserves raw-question privacy',()=>{
  const planner=new DynamicFanOutPlanner();
  const proposal=planner.planChoice({turnEvent:turn('jev'),text:'Was the Sun Blade destroyed or merely removed?',queryIntent:'HISTORY',conflictSignals:['blade-fate'],
    capabilityProfiles:profiles(),ownerSignals:{jevGate:{route:'INVOKE_JEV',expectedDecisionValue:.86,reasonCodes:['BOUNDED_AMBIGUITY']},
      jevQuestion:{questionId:'q:blade-fate',decisionShape:'PRESERVE_MULTIPLE',optionIds:['destroyed','removed'],evidenceRefs:['ev:destroyed','ev:removed'],query:'Was it destroyed or removed?'}}}).choiceProposal;
  const jev=byId(proposal,'jev-adjudication');
  assert.equal(jev.disposition,CoprocessorChoiceDisposition.NOMINATED);
  assert.equal(jev.ownerActionRequired,true);
  assert.equal(proposal.jev.boundedQuestion.questionId,'q:blade-fate');
  assert.equal(proposal.jev.boundedQuestion.rawQuestionRetained,false);
  assert.equal('query' in proposal.jev.boundedQuestion,false);
  assert.ok(proposal.jev.boundedQuestion.questionHash);
  assert.equal(proposal.jev.settlementAuthority,false);

  const trace=createCoprocessorChoiceExecutionTrace({proposal,jevObservation:{status:'ABSTAINED',ran:true,abstained:true,unresolved:true,providerProfileId:'p-jev',latencyMs:42,
    measuredContribution:{baselineOutcome:'UNRESOLVED',optionalOutcome:'UNRESOLVED',changedDecision:false,measurementClass:'FIXTURE'}}});
  assert.equal(trace.jev.abstained,true);
  assert.equal(trace.jev.unresolved,true);
  assert.equal(trace.jev.measuredContribution.changedDecision,false);
  assert.equal(trace.jev.settlementAuthority,false);
});

test('Jev deterministic skip and unavailable provider are explicit rather than fabricated success',()=>{
  const planner=new DynamicFanOutPlanner();
  const skip=planner.planChoice({turnEvent:turn('jev-skip'),text:'Thanks!',hotStateSufficient:true,capabilityProfiles:profiles(),
    ownerSignals:{jevGate:{route:'SKIP_JEV',reasonCodes:['DETERMINISTIC_RESULT_SUFFICIENT']}}}).choiceProposal;
  assert.equal(byId(skip,'jev-adjudication').disposition,CoprocessorChoiceDisposition.SKIPPED);

  const unavailableProfiles=profiles().map(x=>x.profileId==='p-jev'?{...x,available:false,availability:'UNAVAILABLE'}:x);
  const unavailable=planner.planChoice({turnEvent:turn('jev-down'),text:'destroyed or removed?',conflictSignals:['blade'],capabilityProfiles:unavailableProfiles,
    ownerSignals:{jevGate:{route:'INVOKE_JEV'},jevQuestion:{questionId:'q:down',optionIds:['a','b'],evidenceRefs:['e:a','e:b']}}}).choiceProposal;
  assert.equal(byId(unavailable,'jev-adjudication').disposition,CoprocessorChoiceDisposition.UNAVAILABLE);
  assert.ok(byId(unavailable,'jev-adjudication').reasonCodes.includes('PROVIDER_UNAVAILABLE'));
});

test('capability absent unhealthy and overloaded are typed inventory outcomes',()=>{
  const planner=new DynamicFanOutPlanner();
  const absent=planner.planChoice({turnEvent:turn('absent'),text:'Where is the Blade?',queryIntent:'LOCATION',capabilityProfiles:profiles().filter(x=>x.profileId!=='p-graph')}).choiceProposal;
  assert.equal(byId(absent,'graph-walker').disposition,CoprocessorChoiceDisposition.UNAVAILABLE);
  assert.ok(byId(absent,'graph-walker').reasonCodes.includes('CAPABILITY_ABSENT'));

  const unhealthy=planner.planChoice({turnEvent:turn('unhealthy'),text:'What happened before?',queryIntent:'HISTORY',capabilityProfiles:profiles(),
    providerHealth:{historian:'unhealthy'}}).choiceProposal;
  assert.equal(byId(unhealthy,'historian').disposition,CoprocessorChoiceDisposition.UNAVAILABLE);

  const overloaded=planner.planChoice({turnEvent:turn('overload'),text:'What happened before?',queryIntent:'HISTORY',capabilityProfiles:profiles(),
    providerLoad:{historian:1}}).choiceProposal;
  assert.equal(byId(overloaded,'historian').disposition,CoprocessorChoiceDisposition.UNAVAILABLE);
  assert.ok(byId(overloaded,'historian').reasonCodes.includes('PROVIDER_OVERLOADED'));
});

test('execution trace joins Runtime/native swarm reality without confusing logical roles with physical slots',()=>{
  const planner=new DynamicFanOutPlanner();
  const proposal=planner.planChoice({turnEvent:turn('exec'),text:'Where did we leave the Blade?',queryIntent:'LOCATION',activeThreads:['blade'],capabilityProfiles:profiles()}).choiceProposal;
  const historian=byId(proposal,'historian'),graph=byId(proposal,'graph-walker');
  const trace=createCoprocessorChoiceExecutionTrace({
    proposal,
    runtimeRecords:[
      {taskId:historian.taskId,lifecycleStatus:'ELIGIBLE',executionStatus:'COMPLETE',workerId:'slot:local-1'},
      {taskId:graph.taskId,lifecycleStatus:'ELIGIBLE',executionStatus:'FAILED',executionReason:'provider-timeout',workerId:'slot:local-1'},
    ],
    swarmTraces:[
      {taskId:historian.taskId,startedAt:110,completedAt:130,workerId:'slot:local-1',providerId:'local-provider',validation:'PASS',fallbackUsed:false},
      {taskId:graph.taskId,workerId:'slot:local-1',providerId:'graph-provider',validation:'FAIL',failureCode:'PROVIDER_TIMEOUT'},
    ],
  });
  const h=trace.facts.find(x=>x.optionId==='historian'),g=trace.facts.find(x=>x.optionId==='graph-walker');
  assert.equal(h.state,CoprocessorChoiceExecutionState.COMPLETED);
  assert.equal(h.logicalCapability,'HISTORIAN');
  assert.equal(h.executionResourceId,'slot:local-1');
  assert.equal(g.state,CoprocessorChoiceExecutionState.TIMED_OUT);
  assert.equal(trace.degraded,true);
  const core=toCoreCognitiveChoiceContribution({proposal,executionTrace:trace});
  assert.equal(core.executionFacts.find(x=>x.optionId==='graph-walker').failureCode,'PROVIDER_TIMEOUT');
  assert.equal(core.finalChoiceAuthority,false);
});

test('stale invalid and late results become typed execution facts and cannot imply admission',()=>{
  const planner=new DynamicFanOutPlanner();
  const proposal=planner.planChoice({turnEvent:turn('late'),text:'Where is the Blade?',queryIntent:'LOCATION',capabilityProfiles:profiles()}).choiceProposal;
  const graph=byId(proposal,'graph-walker');
  const stale=createCoprocessorChoiceExecutionTrace({proposal,resultRoutes:[{result:{taskId:graph.taskId,id:'r1'},route:{freshness:'STALE',late:false}}]});
  assert.equal(stale.facts.find(x=>x.optionId==='graph-walker').state,CoprocessorChoiceExecutionState.STALE);
  const invalid=createCoprocessorChoiceExecutionTrace({proposal,resultRoutes:[{result:{taskId:graph.taskId,id:'r2'},route:{freshness:'INVALID',late:false}}]});
  assert.equal(invalid.facts.find(x=>x.optionId==='graph-walker').state,CoprocessorChoiceExecutionState.INVALID);
  const late=createCoprocessorChoiceExecutionTrace({proposal,resultRoutes:[{result:{taskId:graph.taskId,id:'r3'},route:{freshness:'FRESH',late:true}}]});
  assert.equal(late.facts.find(x=>x.optionId==='graph-walker').state,CoprocessorChoiceExecutionState.LATE);
});

test('warm freshness is only a hint and useful-hit accounting requires explicit Core revalidation',()=>{
  const planner=new DynamicFanOutPlanner();
  const proposal=planner.planChoice({turnEvent:turn('warm'),text:'Continue this thread.',activeThreads:['blade'],warmState:WarmState.FRESH,capabilityProfiles:profiles()}).choiceProposal;
  assert.equal(proposal.warmHint.admissionResult,false);
  assert.equal(proposal.warmHint.countedUseful,false);
  const before=createCoprocessorChoiceExecutionTrace({proposal,warmObservation:{freshness:'FRESH',countedUseful:true,coreRevalidated:false,preparationCostMs:12,sendLatencySavedMs:7,measurementClass:'FIXTURE'}});
  assert.equal(before.warm.countedUseful,false);
  const after=createCoprocessorChoiceExecutionTrace({proposal,warmObservation:{freshness:'FRESH',countedUseful:true,coreRevalidated:true,preparationCostMs:12,sendLatencySavedMs:7,measurementClass:'FIXTURE'}});
  assert.equal(after.warm.countedUseful,true);
});

test('changed revision or policy yields a different deterministic proposal identity',()=>{
  const planner=new DynamicFanOutPlanner(),base={text:'Where is the Blade?',queryIntent:'LOCATION',capabilityProfiles:profiles()};
  const a=planner.planChoice({turnEvent:turn('rev'),...base,choicePolicyVersion:'choice:1'}).choiceProposal;
  const b=planner.planChoice({turnEvent:turn('rev',{sceneRevision:8,sourceRevisionSet:['src:scene:8','src:lore:1']}),...base,choicePolicyVersion:'choice:1'}).choiceProposal;
  const c=planner.planChoice({turnEvent:turn('rev'),...base,choicePolicyVersion:'choice:2'}).choiceProposal;
  assert.notEqual(a.proposalId,b.proposalId);
  assert.notEqual(a.proposalId,c.proposalId);
  assert.equal(a.revisionFence.sceneRevision,7);
  assert.equal(b.revisionFence.sceneRevision,8);
});

test('choice history is bounded and rejects mismatched execution trace identity',()=>{
  const planner=new DynamicFanOutPlanner(),history=new CoprocessorChoiceHistory({maxHistory:3});
  let first;
  for(let i=0;i<6;i++){
    const proposal=planner.planChoice({turnEvent:turn('hist-'+i),text:'Thanks!',hotStateSufficient:true,capabilityProfiles:profiles()}).choiceProposal;
    if(i===0)first=proposal;
    history.record({proposal});
  }
  assert.equal(history.metrics().size,3);
  assert.equal(history.get(first.proposalId),null);
  const current=planner.planChoice({turnEvent:turn('hist-current'),text:'Thanks!',hotStateSufficient:true,capabilityProfiles:profiles()}).choiceProposal;
  assert.throws(()=>history.record({proposal:current,executionTrace:{proposalId:'wrong'}}));
});
