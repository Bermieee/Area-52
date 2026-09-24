import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Capability,CapabilityProfileRegistry,DeterministicProviderAdapter,ProviderAdapterRegistry,
  JevDecisionCore,JevDecisionShape,JevOutcome,JevProviderExecutor,JevServiceStatus,createJevDecisionRequest,
} from '../src/coprocessor/index.js';

function request(extra={}){
  return createJevDecisionRequest({decisionId:extra.decisionId??'g',decisionType:extra.decisionType??'GENERIC',decisionShape:extra.decisionShape??JevDecisionShape.CHOOSE_ONE,
    turnId:'t',taskId:'task:'+ (extra.decisionId??'g'),correlationId:'c',options:extra.options??[{optionId:'A',evidenceRefs:['eA']},{optionId:'B',evidenceRefs:['eB']}],
    evidenceRefs:extra.evidenceRefs??[{evidenceId:'eA',summary:'evidence for A'},{evidenceId:'eB',summary:'evidence for B'}],provenanceRefs:['p'],constraints:extra.constraints??[],
    allowedOutcomes:extra.allowedOutcomes??[JevDecisionShape.CHOOSE_ONE,JevDecisionShape.CHOOSE_SUBSET,JevDecisionShape.REJECT_ALL,JevDecisionShape.PRESERVE_MULTIPLE,JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN,JevDecisionShape.ESCALATE,JevDecisionShape.REQUEST_OPERATOR],
    authorityBoundary:extra.authorityBoundary??{authorityClass:'ADVISORY',ownerId:'OWNER'},operatorApprovalPolicy:extra.operatorApprovalPolicy,
    sourceRevisionSet:['s'],worldRevision:1,sceneRevision:1,characterStateRevision:1,domainRevisions:{domain:1},freshnessToken:'f',deadline:10000,softDeadline:9000,
    routing:extra.routing??{expectedDecisionValue:.9,latencyPenalty:0,costPenalty:0,uncertaintyPenalty:0,authorityRisk:0,minimumInvocationValue:.2},
    abstentionAllowed:extra.abstentionAllowed??true,escalationPolicy:extra.escalationPolicy,...extra.omit?{}:{},
  });
}
const current={sourceRevisionSet:['s'],worldRevision:1,sceneRevision:1,characterStateRevision:1,domainRevisions:{domain:1},freshnessToken:'f'};
function out(overrides={}){return {outcome:JevOutcome.DECIDED,decisionCode:JevDecisionShape.CHOOSE_ONE,selectedOptionIds:['A'],rejectedOptionIds:['B'],classification:null,reasonCodes:['SUPPORTED'],evidenceUsed:['eA'],unresolvedFactors:[],confidence:.9,abstained:false,escalationTarget:null,requiresOperator:false,explanation:'bounded',...overrides};}
function provider(fn){const profiles=new CapabilityProfileRegistry();profiles.register({profileId:'p',workerId:'shared-slot',providerId:'dp',capabilities:[Capability.SEMANTIC_JUDGMENT],placements:['HOT','DEEP'],supportedLayers:['L1','L2','L3','L4'],maxContextTokens:200000,maxOutputTokens:4000});const adapters=new ProviderAdapterRegistry();adapters.register(new DeterministicProviderAdapter({providerId:'dp',capabilities:[Capability.SEMANTIC_JUDGMENT],handlers:{JEV_DECISION:fn}}));return new JevProviderExecutor({profiles,adapters});}

// A
test('GOLDEN A — deterministic skip leaves one valid option and makes no provider call',async()=>{
  let calls=0;const core=new JevDecisionCore({providerExecutor:provider(()=>{calls++;return{payload:out()};})});const r=request({decisionId:'A',constraints:[{constraintId:'hard',hard:true,violatedOptionIds:['B'],reasonCode:'HARD_CONSTRAINT_ELIMINATED'}]});const x=await core.decide(r,{currentRevisionState:current});assert.equal(x.serviceStatus,JevServiceStatus.JEV_SKIPPED);assert.deepEqual(x.selectedOptionIds,['A']);assert.equal(calls,0);
});
// B
test('GOLDEN B — clear bounded winner produces evidence-linked decision receipt',async()=>{const core=new JevDecisionCore({providerExecutor:provider(()=>({payload:out()}))});const x=await core.decide(request({decisionId:'B'}),{currentRevisionState:current});assert.equal(x.outcome,'DECIDED');assert.deepEqual(x.evidenceUsed,['eA']);assert.deepEqual(x.rejectedOptionIds,['B']);});
// C
test('GOLDEN C — valid subset preserves two jointly surviving options',async()=>{const options=['A','B','C','D'].map(id=>({optionId:id,evidenceRefs:['e'+id]}));const evidence=['A','B','C','D'].map(id=>({evidenceId:'e'+id,summary:id}));const core=new JevDecisionCore({providerExecutor:provider(()=>({payload:out({decisionCode:JevDecisionShape.CHOOSE_SUBSET,selectedOptionIds:['A','B'],rejectedOptionIds:['C','D'],evidenceUsed:['eA','eB']})}))});const x=await core.decide(request({decisionId:'C',decisionShape:JevDecisionShape.CHOOSE_SUBSET,options,evidenceRefs:evidence}),{currentRevisionState:current});assert.deepEqual(x.selectedOptionIds,['A','B']);});
// D
test('GOLDEN D — contradictory evidence may remain UNRESOLVED',async()=>{const core=new JevDecisionCore({providerExecutor:provider(()=>({payload:out({outcome:JevOutcome.UNRESOLVED,decisionCode:JevDecisionShape.UNRESOLVED,selectedOptionIds:[],rejectedOptionIds:[],evidenceUsed:['eA','eB'],unresolvedFactors:['A and B remain incompatibly supported'],confidence:.35})}))});const x=await core.decide(request({decisionId:'D'}),{currentRevisionState:current});assert.equal(x.outcome,'UNRESOLVED');});
// E
test('GOLDEN E — insufficient evidence abstains rather than guessing',async()=>{const r=request({decisionId:'E',options:[{optionId:'A',evidenceRefs:[]},{optionId:'B',evidenceRefs:[]}],evidenceRefs:[],allowedOutcomes:[JevDecisionShape.CHOOSE_ONE,JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN]});const x=await new JevDecisionCore().decide(r,{currentRevisionState:current});assert.equal(x.outcome,'ABSTAINED');});
// F
test('GOLDEN F — all options eliminated deterministically produces REJECT_ALL without provider',async()=>{const r=request({decisionId:'F',constraints:[{constraintId:'all',hard:true,violatedOptionIds:['A','B'],reasonCode:'HARD_CONSTRAINT_ELIMINATED'}]});const x=await new JevDecisionCore().decide(r,{currentRevisionState:current});assert.equal(x.decisionCode,JevDecisionShape.REJECT_ALL);assert.equal(x.serviceStatus,JevServiceStatus.JEV_SKIPPED);});
// G
test('GOLDEN G — owner-only authority escalates to owner',async()=>{const x=await new JevDecisionCore().decide(request({decisionId:'G',authorityBoundary:{authorityClass:'OWNER_ONLY',ownerId:'TRUTH'}}),{currentRevisionState:current});assert.equal(x.outcome,'ESCALATE_OWNER');assert.equal(x.escalationTarget,'OWNER');});
// H
test('GOLDEN H — destructive/high-authority operation requests operator',async()=>{const x=await new JevDecisionCore().decide(request({decisionId:'H',operatorApprovalPolicy:{required:true}}),{currentRevisionState:current});assert.equal(x.outcome,'REQUEST_OPERATOR');assert.equal(x.requiresOperator,true);});
// I
test('GOLDEN I — stale result is rejected with no selected option',async()=>{let w=1;const core=new JevDecisionCore({providerExecutor:provider(()=>{w=2;return{payload:out()};})});const x=await core.decide(request({decisionId:'I'}),{currentRevisionState:()=>({...current,worldRevision:w})});assert.equal(x.outcome,'STALE');assert.equal(x.selectedOptionIds.length,0);});
// J
test('GOLDEN J — unknown provider option ID fails closed INVALID',async()=>{const core=new JevDecisionCore({providerExecutor:provider(()=>({payload:out({selectedOptionIds:['D']})}))});const x=await core.decide(request({decisionId:'J',escalationPolicy:{maxRetries:0}}),{currentRevisionState:current});assert.equal(x.outcome,'INVALID');});
// K
test('GOLDEN K — malformed output retries only within bounds then succeeds/fails safely',async()=>{let calls=0;const core=new JevDecisionCore({providerExecutor:provider(()=>{calls++;return calls===1?{text:'{"bad":'}:{payload:out()};})});const x=await core.decide(request({decisionId:'K',escalationPolicy:{maxRetries:1}}),{currentRevisionState:current});assert.equal(x.outcome,'DECIDED');assert.equal(calls,2);assert.equal(core.metricsSnapshot().retries,1);});
// L
test('GOLDEN L — post-Seal result cannot enter active generation',async()=>{let sealed=false;const core=new JevDecisionCore({providerExecutor:provider(()=>{sealed=true;return{payload:out()};})});const x=await core.decide(request({decisionId:'L'}),{currentRevisionState:current,sealed:()=>sealed});assert.equal(x.admission.foregroundEligible,false);assert.equal(x.admission.destination,'NEXT_TURN');});

test('multi-domain proof — Lore, Scene and Temporal/Truth use the same Jev kernel contract',async()=>{
  const ex=provider(({input})=>{
    const map={LORE_RELATIONSHIP:'A',SCENE_BOUNDARY:'B',TEMPORAL_TRUTH:'A'};const selected=map[input.data.decisionType];const other=input.data.options.map(x=>x.optionId).filter(x=>x!==selected);
    return {payload:out({selectedOptionIds:[selected],rejectedOptionIds:other,evidenceUsed:[selected==='A'?'eA':'eB'],classification:selected==='A'?'PRIMARY':'SECONDARY'})};
  });const core=new JevDecisionCore({providerExecutor:ex});
  for(const [id,type] of [['M1','LORE_RELATIONSHIP'],['M2','SCENE_BOUNDARY'],['M3','TEMPORAL_TRUTH']]){const x=await core.decide(request({decisionId:id,decisionType:type}),{currentRevisionState:current});assert.equal(x.kind,'JevDecisionReceipt');assert.equal(x.decisionType,type);assert.equal(x.outcome,'DECIDED');}
});