import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  Capability,CapabilityProfileRegistry,DeterministicProviderAdapter,ProviderAdapterRegistry,
  JevDecisionCore,JevDecisionShape,JevGateRoute,JevOutcome,JevProviderExecutor,JevReasonCode,JevServiceStatus,
  createJevDecisionRequest,createJevDecisionReceipt,createJevOwnerHandoff,evaluateJevInvocationGate,evaluateJevOwnerPolicy,
  evaluateJevFreshness,jevRequestFingerprint,prefilterJevOptions,validateJevProviderOutput,
} from '../src/coprocessor/index.js';

function req(overrides={}){
  return createJevDecisionRequest({
    decisionId:'decision:1',decisionType:'LORE_OVERLAP',decisionShape:JevDecisionShape.CHOOSE_ONE,
    turnId:'turn:1',taskId:'jev:1',correlationId:'corr:1',causationId:'task:caller',
    evidenceRefs:[{evidenceId:'e:A',summary:'A is supported by source alpha'},{evidenceId:'e:B',summary:'B is supported by source beta'}],
    provenanceRefs:['prov:1'],
    options:[{optionId:'A',evidenceRefs:['e:A'],payload:{meaning:'duplicate'}},{optionId:'B',evidenceRefs:['e:B'],payload:{meaning:'complementary'}}],
    allowedOutcomes:[JevDecisionShape.CHOOSE_ONE,JevDecisionShape.REJECT_ALL,JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN,JevDecisionShape.ESCALATE,JevDecisionShape.REQUEST_OPERATOR],
    constraints:[],authorityBoundary:{authorityClass:'ADVISORY',ownerId:'LORE'},sourceRevisionSet:['src:1'],worldRevision:11,sceneRevision:4,characterStateRevision:2,
    domainRevisions:{lore:7},freshnessToken:'fresh:1',abstentionAllowed:true,deadline:10000,softDeadline:9000,resourceClass:'STANDARD',
    routing:{expectedDecisionValue:.9,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2},
    ...overrides,
  });
}
function current(overrides={}){return {sourceRevisionSet:['src:1'],worldRevision:11,sceneRevision:4,characterStateRevision:2,domainRevisions:{lore:7},freshnessToken:'fresh:1',...overrides};}
function output(overrides={}){return {
  outcome:JevOutcome.DECIDED,decisionCode:JevDecisionShape.CHOOSE_ONE,selectedOptionIds:['A'],rejectedOptionIds:['B'],classification:null,
  reasonCodes:['EVIDENCE_SUPPORTS_A'],evidenceUsed:['e:A'],unresolvedFactors:[],confidence:.92,abstained:false,escalationTarget:null,requiresOperator:false,
  explanation:'Evidence e:A supports A within the supplied bounded options.',...overrides,
};}
function executor(handler,{workerId='slot:shared-cognition',providerId='fixture:jev'}={}){
  const profiles=new CapabilityProfileRegistry();profiles.register({profileId:'jev-profile',workerId,providerId,modelId:'fixture-model',
    capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.PROPOSAL_REVIEW,Capability.CONFLICT_INTERPRETATION],foregroundEligible:true,backgroundEligible:true,
    placements:['HOT','DEEP'],supportedLayers:['L1','L2','L3','L4'],maxContextTokens:200000,maxOutputTokens:4000});
  const adapters=new ProviderAdapterRegistry();adapters.register(new DeterministicProviderAdapter({providerId,modelId:'fixture-model',capabilities:[Capability.SEMANTIC_JUDGMENT],handlers:{JEV_DECISION:handler}}));
  return new JevProviderExecutor({profiles,adapters});
}

test('canonical Jev request is bounded, typed, revision-fenced and non-authoritative',()=>{
  const r=req();assert.equal(r.kind,'JevDecisionRequest');assert.equal(r.options.length,2);assert.equal(r.options[0].optionId,'A');
  assert.deepEqual(r.sourceRevisionSet,['src:1']);assert.equal(r.domainRevisions.lore,7);assert.equal(r.authorityGranted,false);assert.equal(r.canonicalMutationAllowed,false);
  assert.ok(jevRequestFingerprint(r).startsWith('jev:'));
});

test('request rejects duplicate/unknown option evidence identity and unbounded option sets',()=>{
  assert.throws(()=>req({options:[{optionId:'A',evidenceRefs:['missing']}]}),/unknown evidence/);
  assert.throws(()=>req({options:[{optionId:'A',evidenceRefs:['e:A']},{optionId:'A',evidenceRefs:['e:B']}]}),/duplicate optionId/);
  assert.throws(()=>req({options:Array.from({length:65},(_,i)=>({optionId:'x'+i,evidenceRefs:['e:A']}))}),/1-64/);
});

test('receipt preserves audit metadata but never grants canonical authority',()=>{
  const r=req();const receipt=createJevDecisionReceipt({...output(),providerProvenance:{providerId:'p',modelId:'m'}},r);
  assert.equal(receipt.outcome,'DECIDED');assert.equal(receipt.requiresOwnerSettlement,true);assert.equal(receipt.authorityGranted,false);
  assert.equal(receipt.canonicalMutation,false);assert.equal(receipt.settlementPerformed,false);assert.equal(receipt.providerProvenance.modelId,'m');
});

test('freshness fences source/world/scene/domain revisions and freshness token',()=>{
  const r=req();assert.equal(evaluateJevFreshness(r,current()).freshness,'FRESH');
  for(const patch of [{worldRevision:12},{sceneRevision:5},{sourceRevisionSet:['src:2']},{domainRevisions:{lore:8}},{freshnessToken:'other'}]){
    assert.notEqual(evaluateJevFreshness(r,current(patch)).freshness,'FRESH');
  }
});

test('deterministic prefilter removes hard-constraint and stale-evidence options before Jev',()=>{
  const r=req({constraints:[{constraintId:'c1',hard:true,violatedOptionIds:['A'],reasonCode:'OWNER_RULE'}],evidenceRefs:[{evidenceId:'e:A',summary:'a'},{evidenceId:'e:B',summary:'b',stale:true}],allowedOutcomes:[JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN]});
  const p=prefilterJevOptions(r,{currentRevisionState:current()});assert.equal(p.viableOptions.length,0);assert.deepEqual(new Set(p.rejectedOptionIds),new Set(['A','B']));
});

test('invocation gate is deterministic-first and never calls Jev to decide whether Jev should run',()=>{
  const single=req({options:[{optionId:'A',evidenceRefs:['e:A']}],allowedOutcomes:[JevDecisionShape.CHOOSE_ONE,JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN]});
  const g=evaluateJevInvocationGate(single,{currentRevisionState:current(),resourceAvailable:true});assert.equal(g.route,JevGateRoute.SKIP_JEV);assert.deepEqual(g.deterministicAnswer.selectedOptionIds,['A']);
  const ambiguous=evaluateJevInvocationGate(req(),{currentRevisionState:current(),resourceAvailable:true});assert.equal(ambiguous.route,JevGateRoute.INVOKE_JEV);
});

test('expected-value routing skips trivial semantic work while preserving unresolved',()=>{
  const r=req({routing:{expectedDecisionValue:.1,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2}});
  const g=evaluateJevInvocationGate(r,{currentRevisionState:current(),resourceAvailable:true});assert.equal(g.route,JevGateRoute.SKIP_JEV);assert.ok(g.reasonCodes.includes(JevReasonCode.LOW_EXPECTED_DECISION_VALUE));
});

test('operator-only and owner-only authority never invoke semantic provider',()=>{
  const op=evaluateJevInvocationGate(req({operatorApprovalPolicy:{required:true}}),{currentRevisionState:current(),resourceAvailable:true});assert.equal(op.route,JevGateRoute.REQUEST_OPERATOR);
  const owner=evaluateJevInvocationGate(req({authorityBoundary:{authorityClass:'OWNER_ONLY',ownerId:'LORE'}}),{currentRevisionState:current(),resourceAvailable:true});assert.equal(owner.route,JevGateRoute.ESCALATE);
});

test('provider output is strict evidence-bound structured data with no hidden-reasoning field',()=>{
  const r=req(),p=prefilterJevOptions(r,{currentRevisionState:current()});const valid=validateJevProviderOutput(output(),{request:r,prefilter:p});assert.equal(valid.selectedOptionIds[0],'A');
  assert.throws(()=>validateJevProviderOutput({...output(),reasoning:'secret'}, {request:r,prefilter:p}),e=>e.code==='SCHEMA_INVALID');
  assert.throws(()=>validateJevProviderOutput({...output(),selectedOptionIds:['D']},{request:r,prefilter:p}),e=>e.code==='UNKNOWN_REFERENCE');
  assert.throws(()=>validateJevProviderOutput({...output(),evidenceUsed:['unknown']},{request:r,prefilter:p}),e=>e.code==='UNKNOWN_REFERENCE');
});

test('provider-neutral Jev execution uses capability/profile routing rather than a Jev sidecar identity',async()=>{
  const ex=executor(({input})=>({payload:output({selectedOptionIds:[input.data.options[0].optionId],rejectedOptionIds:[input.data.options[1].optionId],evidenceUsed:[input.data.options[0].evidenceRefs[0]]})}));
  const core=new JevDecisionCore({providerExecutor:ex});const result=await core.decide(req(),{currentRevisionState:current()});
  assert.equal(result.outcome,JevOutcome.DECIDED);assert.equal(result.providerProvenance.workerId,'slot:shared-cognition');assert.equal(result.authorityGranted,false);
});

test('same resource can be described as shared cognition and Jev does not encode physical identity in request',()=>{
  const r=req();assert.equal('workerId' in r,false);assert.equal('providerId' in r,false);assert.equal('modelId' in r,false);
});

test('replay with identical decision/revision/options/evidence is idempotent and does not re-call provider',async()=>{
  let calls=0;const core=new JevDecisionCore({providerExecutor:executor(()=>{calls++;return{payload:output()};})});const r=req();
  const a=await core.decide(r,{currentRevisionState:current()});const b=await core.decide(r,{currentRevisionState:current()});assert.equal(a,b);assert.equal(calls,1);
});

test('late provider result after Context Seal is retained as audit/background result but excluded from foreground',async()=>{
  let sealed=false;const core=new JevDecisionCore({providerExecutor:executor(()=>{sealed=true;return{payload:output()};})});
  const result=await core.decide(req(),{currentRevisionState:current(),sealed:()=>sealed});assert.equal(result.outcome,'DECIDED');assert.equal(result.admission.foregroundEligible,false);assert.equal(result.admission.destination,'NEXT_TURN');
});

test('stale revision after provider returns fails closed as STALE',async()=>{
  let rev=11;const core=new JevDecisionCore({providerExecutor:executor(()=>{rev=12;return{payload:output()};})});
  const result=await core.decide(req(),{currentRevisionState:()=>current({worldRevision:rev})});assert.equal(result.outcome,'STALE');assert.equal(result.serviceStatus,JevServiceStatus.JEV_STALE);assert.equal(result.selectedOptionIds.length,0);
});

test('owner may reject a valid Jev recommendation without mutation',()=>{
  const receipt=createJevDecisionReceipt(output(),req());const handoff=createJevOwnerHandoff(receipt,{authorityImpact:{domain:'LORE'}});const owner=evaluateJevOwnerPolicy(handoff,{accepted:false,reasonCodes:['OWNER_POLICY_REJECTED']});
  assert.equal(owner.ownerAccepted,false);assert.equal(owner.settlementEligible,false);assert.equal(owner.canonicalMutation,false);assert.equal(owner.action,'OWNER_REJECTED');
});

test('operator handoff exposes structured decision/evidence/alternatives/impact data',()=>{
  const receipt=createJevDecisionReceipt({...output(),outcome:JevOutcome.REQUEST_OPERATOR,decisionCode:JevDecisionShape.REQUEST_OPERATOR,selectedOptionIds:[],rejectedOptionIds:['B'],requiresOwnerSettlement:false,requiresOperator:true,escalationTarget:'OPERATOR'},req());
  const h=createJevOwnerHandoff(receipt,{authorityImpact:{destructive:true},dependencyImpact:{invalidates:['x']},provenanceRefs:['prov:1']});
  assert.equal(h.requiresOperator,true);assert.deepEqual(h.evidenceRefs,['e:A']);assert.equal(h.authorityImpact.destructive,true);assert.deepEqual(h.dependencyImpact.invalidates,['x']);
});

test('Wave 8 Jev production modules are browser-safe and avoid Node-only globals',async()=>{
  for(const path of ['../src/coprocessor/jev-contracts.js','../src/coprocessor/jev-invocation-gate.js','../src/coprocessor/jev-decision-core.js']){
    const text=await readFile(new URL(path,import.meta.url),'utf8');assert.doesNotMatch(text,/\bBuffer\b|\brequire\s*\(|\bprocess\./);
  }
});