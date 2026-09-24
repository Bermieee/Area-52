import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Capability, CoprocessorChoiceHistory, DynamicFanOutPlanner, createTurnEnvelope,
  createCoprocessorChoiceExecutionTrace,
} from '../src/coprocessor/index.js';

const profileSet=()=>[
  {profileId:'stress-historian',capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'stress-graph',capabilities:[Capability.GRAPH],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'stress-green',capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.CHARACTER_INFERENCE],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'stress-truth',capabilities:[Capability.TRUTH_JUDGMENT,Capability.RERANK],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'LOW'},
  {profileId:'stress-deep',capabilities:[Capability.CONSOLIDATION,Capability.COMPRESSION],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'HIGH'},
  {profileId:'stress-jev',capabilities:[Capability.DEEP_REASONING],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'MEDIUM'},
  {profileId:'stress-external',capabilities:[Capability.EXTERNAL_GROUNDING],providerHealth:'HEALTHY',available:true,currentLoad:0,concurrencyCapacity:1,latencyClass:'HIGH'},
];
const event=(i,rev=7)=>{const n=Number.isFinite(Number(i))?Number(i):0;return createTurnEnvelope({turnId:'stress:'+i,eventId:'evt:stress:'+i,correlationId:'corr:stress:'+i,dedupeKey:'stress:'+i,createdAt:100+n,
  sourceRevisionSet:['src:scene:'+rev,'src:lore:'+(n%5)],worldRevision:12+Math.floor(n/200),sceneRevision:rev,characterStateRevision:4+(n%3),deadline:260+n});};
const semantic=p=>p.options.map(x=>[x.optionId,x.disposition,x.reasonCodes,x.logicalCapability]);

test('Wave 13 replay stress remains deterministic and bounded over mixed choice classes',()=>{
  const planner=new DynamicFanOutPlanner(),profiles=profileSet(),history=new CoprocessorChoiceHistory({maxHistory:64});
  const totals={turns:0,hot:0,retrieval:0,mixed:0,ambiguous:0,nominated:0,skipped:0,deferred:0,unavailable:0};
  for(let i=0;i<600;i++){
    const mode=i%4;
    const input=mode===0?{text:'Thanks!',hotStateSufficient:true}
      :mode===1?{text:'Where did we leave the Sun Blade last time?',queryIntent:'LOCATION',activeThreads:['blade']}
      :mode===2?{text:'Which Blade evidence is current?',queryIntent:'CURRENT_STATE',retrievalQuality:'MIXED',ownerSignals:{correctiveRetrieval:{requested:true,attempt:0,maxAttempts:1}}}
      :{text:'Was the Blade destroyed or removed?',queryIntent:'HISTORY',conflictSignals:['blade'],ownerSignals:{jevGate:{route:'INVOKE_JEV',expectedDecisionValue:.8},jevQuestion:{questionId:'q:'+i,optionIds:['destroyed','removed'],evidenceRefs:['e:d','e:r']}}};
    const args={turnEvent:event(i),capabilityProfiles:profiles,resourceCount:(i%3)+1,...input};
    const a=planner.planChoice(args).choiceProposal,b=planner.planChoice(args).choiceProposal;
    assert.equal(a.proposalId,b.proposalId);assert.deepEqual(semantic(a),semantic(b));
    assert.ok(a.options.length<=32);assert.ok(new TextEncoder().encode(JSON.stringify(a)).length<=32768);
    history.record({proposal:a});assert.ok(history.metrics().size<=64);
    totals.turns++;totals.nominated+=a.counts.NOMINATED;totals.skipped+=a.counts.SKIPPED;totals.deferred+=a.counts.DEFERRED;totals.unavailable+=a.counts.UNAVAILABLE;
    if(mode===0)totals.hot++;else if(mode===1)totals.retrieval++;else if(mode===2)totals.mixed++;else totals.ambiguous++;
  }
  assert.deepEqual({turns:totals.turns,hot:totals.hot,retrieval:totals.retrieval,mixed:totals.mixed,ambiguous:totals.ambiguous},{turns:600,hot:150,retrieval:150,mixed:150,ambiguous:150});
  assert.ok(totals.nominated>0);assert.ok(totals.skipped>0);assert.equal(history.metrics().size,64);
});

test('Wave 13 one-resource and multi-resource stress preserve semantic choice across 300 paired turns',()=>{
  const planner=new DynamicFanOutPlanner(),profiles=profileSet();
  for(let i=0;i<300;i++){
    const base={turnEvent:event('resource-'+i),text:i%2?'Where is the Blade now?':'What did Mara promise last time?',queryIntent:i%2?'LOCATION':'HISTORY',
      activeThreads:['blade'],activeCast:['Mara','Eris'],capabilityProfiles:profiles};
    const one=planner.planChoice({...base,resourceCount:1}).choiceProposal,many=planner.planChoice({...base,resourceCount:4}).choiceProposal;
    assert.deepEqual(one.options.map(x=>[x.optionId,x.disposition,x.reasonCodes]),many.options.map(x=>[x.optionId,x.disposition,x.reasonCodes]));
    assert.equal(one.options.filter(x=>x.disposition==='NOMINATED').every(x=>x.physicalExecutionHint==='SERIALIZE_ON_AVAILABLE_RESOURCE'),true);
    assert.equal(many.options.filter(x=>x.disposition==='NOMINATED').every(x=>x.physicalExecutionHint==='PARALLEL_ELIGIBLE'),true);
  }
});

test('Wave 13 provider-health pressure never fabricates successful execution',()=>{
  const planner=new DynamicFanOutPlanner(),baseProfiles=profileSet();
  for(let i=0;i<300;i++){
    const mode=i%3,profiles=baseProfiles.map(p=>p.profileId==='stress-jev'
      ? mode===0?{...p,available:false}:mode===1?{...p,providerHealth:'UNHEALTHY'}:{...p,currentLoad:1,concurrencyCapacity:1}
      :p);
    const proposal=planner.planChoice({turnEvent:event('provider-'+i),text:'destroyed or removed?',conflictSignals:['blade'],capabilityProfiles:profiles,
      ownerSignals:{jevGate:{route:'INVOKE_JEV'},jevQuestion:{questionId:'q:pressure:'+i,optionIds:['a','b'],evidenceRefs:['e:a','e:b']}}}).choiceProposal;
    const jev=proposal.options.find(x=>x.optionId==='jev-adjudication');assert.equal(jev.disposition,'UNAVAILABLE');
    const trace=createCoprocessorChoiceExecutionTrace({proposal});
    const fact=trace.facts.find(x=>x.optionId==='jev-adjudication');assert.equal(fact.state,'UNAVAILABLE');assert.notEqual(fact.state,'COMPLETED');
  }
});

test('Wave 13 stale/late execution trace stress remains bounded and authority-free',()=>{
  const planner=new DynamicFanOutPlanner(),profiles=profileSet();
  for(let i=0;i<300;i++){
    const proposal=planner.planChoice({turnEvent:event('route-'+i),text:'Where is the Blade?',queryIntent:'LOCATION',capabilityProfiles:profiles}).choiceProposal;
    const graph=proposal.options.find(x=>x.optionId==='graph-walker');
    const route=i%3===0?{freshness:'STALE',late:false}:i%3===1?{freshness:'INVALID',late:false}:{freshness:'FRESH',late:true};
    const trace=createCoprocessorChoiceExecutionTrace({proposal,resultRoutes:[{result:{taskId:graph.taskId,id:'r:'+i},route}]});
    const fact=trace.facts.find(x=>x.optionId==='graph-walker');
    assert.equal(fact.state,i%3===0?'STALE':i%3===1?'INVALID':'LATE');
    assert.equal(trace.finalChoiceAuthority,false);assert.equal(trace.truthAuthority,false);assert.equal(trace.contextSealAuthority,false);
    assert.ok(new TextEncoder().encode(JSON.stringify(trace)).length<=32768);
  }
});
