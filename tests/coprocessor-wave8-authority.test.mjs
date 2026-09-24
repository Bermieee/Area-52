import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JevDecisionShape,JevOutcome,createJevDecisionReceipt,createJevDecisionRequest,createJevOwnerHandoff,evaluateJevOwnerPolicy,
} from '../src/coprocessor/index.js';

function request(){return createJevDecisionRequest({decisionId:'auth',decisionType:'TRUTH_AMBIGUITY',decisionShape:JevDecisionShape.CHOOSE_ONE,turnId:'t',taskId:'j',correlationId:'c',
  options:[{optionId:'A',evidenceRefs:['eA']},{optionId:'B',evidenceRefs:['eB']}],evidenceRefs:[{evidenceId:'eA',summary:'A'},{evidenceId:'eB',summary:'B'}],allowedOutcomes:[JevDecisionShape.CHOOSE_ONE,JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN],
  authorityBoundary:{authorityClass:'ADVISORY',ownerId:'TRUTH'},sourceRevisionSet:['s'],worldRevision:1,sceneRevision:1,characterStateRevision:1,freshnessToken:'f',deadline:100});}
function receipt(extra={}){return createJevDecisionReceipt({outcome:JevOutcome.DECIDED,decisionCode:JevDecisionShape.CHOOSE_ONE,selectedOptionIds:['A'],rejectedOptionIds:['B'],reasonCodes:['SUPPORTED'],evidenceUsed:['eA'],unresolvedFactors:[],confidence:.999,abstained:false,providerProvenance:{providerId:'jev-provider',modelId:'model-x'},...extra},request());}

test('confidence does not become authority',()=>{const r=receipt();assert.equal(r.confidence,.999);assert.equal(r.authorityGranted,false);assert.equal(r.canonicalMutation,false);assert.equal(r.requiresOwnerSettlement,true);});
test('provider/model identity does not become authority',()=>{const r=receipt();assert.equal(r.providerProvenance.providerId,'jev-provider');assert.equal(r.authorityGranted,false);});
test('a Jev decision is an audit recommendation, not Settlement',()=>{const r=receipt();assert.equal(r.settlementPerformed,false);assert.equal('commit' in r,false);assert.equal('mutate' in r,false);});
test('owner policy may reject high-confidence recommendation',()=>{const h=createJevOwnerHandoff(receipt());const o=evaluateJevOwnerPolicy(h,{accepted:false,reasonCodes:['DOMAIN_POLICY_CONFLICT']});assert.equal(o.action,'OWNER_REJECTED');assert.equal(o.settlementEligible,false);});
test('owner approval still only makes result settlement-eligible; it does not settle',()=>{const h=createJevOwnerHandoff(receipt());const o=evaluateJevOwnerPolicy(h,{accepted:true});assert.equal(o.action,'OWNER_MAY_SETTLE');assert.equal(o.settlementEligible,true);assert.equal(o.canonicalMutation,false);});
test('operator requirement blocks settlement eligibility until owner/operator path resolves',()=>{const h=createJevOwnerHandoff(receipt({outcome:JevOutcome.REQUEST_OPERATOR,decisionCode:JevDecisionShape.REQUEST_OPERATOR,selectedOptionIds:[],rejectedOptionIds:['B'],requiresOwnerSettlement:false,requiresOperator:true}));const o=evaluateJevOwnerPolicy(h,{accepted:true,requiresOperator:true});assert.equal(o.action,'REQUEST_OPERATOR');assert.equal(o.settlementEligible,false);});
test('receipt cannot claim DECIDED while suppressing owner settlement',()=>{assert.throws(()=>createJevDecisionReceipt({outcome:JevOutcome.DECIDED,decisionCode:JevDecisionShape.CHOOSE_ONE,selectedOptionIds:['A'],rejectedOptionIds:['B'],evidenceUsed:['eA'],confidence:1,requiresOwnerSettlement:false},request()),/must require owner settlement/);});