import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Capability,CapabilityProfileRegistry,DeterministicProviderAdapter,ProviderAdapterRegistry,JevDecisionCore,JevDecisionShape,JevOutcome,JevProviderExecutor,createJevDecisionRequest,
} from '../src/coprocessor/index.js';

function r(i,extra={}){return createJevDecisionRequest({decisionId:'stress:'+i,decisionType:'STRESS',decisionShape:JevDecisionShape.CHOOSE_ONE,turnId:'t:'+i,taskId:'j:'+i,correlationId:'c:'+i,
  options:[{optionId:'A',evidenceRefs:['eA']},{optionId:'B',evidenceRefs:['eB']}],evidenceRefs:[{evidenceId:'eA',summary:'A'},{evidenceId:'eB',summary:'B'}],
  allowedOutcomes:[JevDecisionShape.CHOOSE_ONE,JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN],authorityBoundary:{authorityClass:'ADVISORY',ownerId:'OWNER'},
  sourceRevisionSet:['s:'+i],worldRevision:1,sceneRevision:i%23,characterStateRevision:1,domainRevisions:{d:1},freshnessToken:'f:'+i,deadline:100000,
  escalationPolicy:{maxRetries:0},routing:{expectedDecisionValue:.9,latencyPenalty:0,costPenalty:0,uncertaintyPenalty:0,authorityRisk:0,minimumInvocationValue:.2},...extra});}
function state(i,extra={}){return {sourceRevisionSet:['s:'+i],worldRevision:1,sceneRevision:i%23,characterStateRevision:1,domainRevisions:{d:1},freshnessToken:'f:'+i,...extra};}
function payload(){return {outcome:JevOutcome.DECIDED,decisionCode:JevDecisionShape.CHOOSE_ONE,selectedOptionIds:['A'],rejectedOptionIds:['B'],classification:null,reasonCodes:['SUPPORTED'],evidenceUsed:['eA'],unresolvedFactors:[],confidence:.8,abstained:false,escalationTarget:null,requiresOperator:false,explanation:'bounded'};}
function ex(resources=1){const profiles=new CapabilityProfileRegistry(),adapters=new ProviderAdapterRegistry();for(let i=0;i<resources;i++){const providerId='p'+i;profiles.register({profileId:'profile:'+i,workerId:'slot:'+i,providerId,capabilities:[Capability.SEMANTIC_JUDGMENT],placements:['HOT'],supportedLayers:['L1'],concurrencyCapacity:4,maxContextTokens:100000,maxOutputTokens:2000});adapters.register(new DeterministicProviderAdapter({providerId,capabilities:[Capability.SEMANTIC_JUDGMENT],handlers:{JEV_DECISION:()=>({payload:payload()})}}));}return new JevProviderExecutor({profiles,adapters});}

test('Wave 8 focused stress stays bounded, idempotent, revision-safe and non-authoritative',async()=>{
  const core=new JevDecisionCore({providerExecutor:ex(2)});let decided=0,skipped=0,abstained=0,stale=0,late=0,authorityViolations=0,replayMismatch=0;
  for(let i=0;i<600;i++){const x=await core.decide(r(i),{currentRevisionState:state(i)});if(x.outcome==='DECIDED')decided++;if(x.authorityGranted||x.canonicalMutation)authorityViolations++;}
  for(let i=600;i<1000;i++){const q=r(i,{options:[{optionId:'A',evidenceRefs:['eA']} ]});const x=await core.decide(q,{currentRevisionState:state(i)});if(x.serviceStatus==='JEV_SKIPPED')skipped++;}
  for(let i=1000;i<1200;i++){const q=r(i,{options:[{optionId:'A',evidenceRefs:[]},{optionId:'B',evidenceRefs:[]}],evidenceRefs:[]});const x=await core.decide(q,{currentRevisionState:state(i)});if(x.outcome==='ABSTAINED')abstained++;}
  for(let i=1200;i<1400;i++){const x=await core.decide(r(i),{currentRevisionState:state(i,{worldRevision:2})});if(x.outcome==='STALE')stale++;}
  for(let i=1400;i<1500;i++){const x=await core.decide(r(i),{currentRevisionState:state(i),sealed:true});if(!x.admission.foregroundEligible)late++;}
  for(let i=0;i<250;i++){const a=await core.decide(r(i),{currentRevisionState:state(i)});const b=await core.decide(r(i),{currentRevisionState:state(i)});if(a!==b)replayMismatch++;}
  const m=core.metricsSnapshot();assert.equal(decided,600);assert.equal(skipped,400);assert.equal(abstained,200);assert.equal(stale,200);assert.equal(late,100);assert.equal(authorityViolations,0);assert.equal(replayMismatch,0);
  assert.equal(m.providerCalls,700);assert.equal(m.invocations,700);assert.equal(m.skips,400);assert.equal(m.abstentions,200);assert.equal(m.stale,200);assert.equal(m.late,100);assert.ok(m.averageDecisionPayloadBytes>0);
  console.log(JSON.stringify({stress:'wave8-jev',decisions:m.decisions,providerCalls:m.providerCalls,invocationRate:m.invocationRate,skipRate:m.skipRate,abstentionRate:m.abstentionRate,
    retries:m.retries,timeouts:m.timeouts,late:m.late,stale:m.stale,authorityViolations,replayMismatch,averageDecisionPayloadBytes:m.averageDecisionPayloadBytes}));
});

test('single cognitive execution resource still supports Jev architecture',async()=>{const core=new JevDecisionCore({providerExecutor:ex(1)});for(let i=2000;i<2050;i++){const x=await core.decide(r(i),{currentRevisionState:state(i)});assert.equal(x.outcome,'DECIDED');assert.equal(x.providerProvenance.workerId,'slot:0');}});

test('parallel bounded decisions do not cross-contaminate identity or revisions',async()=>{const core=new JevDecisionCore({providerExecutor:ex(2)});const results=await Promise.all(Array.from({length:100},(_,k)=>{const i=3000+k;return core.decide(r(i),{currentRevisionState:state(i)});}));assert.equal(new Set(results.map(x=>x.decisionId)).size,100);assert.equal(results.every(x=>x.outcome==='DECIDED'&&!x.authorityGranted),true);});