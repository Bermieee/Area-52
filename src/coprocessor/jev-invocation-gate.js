import { deepFreeze } from './contracts.js';
import {
  JevDecisionShape,JevGateRoute,JevOutcome,JevReasonCode,JevServiceStatus,
  createJevDecisionRequest,evaluateJevFreshness,
} from './jev-contracts.js';

export function prefilterJevOptions(requestInput,{currentRevisionState=null}={}){
  const request=requestInput?.kind==='JevDecisionRequest'?requestInput:createJevDecisionRequest(requestInput);
  const freshness=evaluateJevFreshness(request,currentRevisionState??{});
  const evidence=new Map(request.evidenceRefs.map(x=>[x.evidenceId,x]));
  const hardRejected=new Map();
  for(const constraint of request.constraints){
    if(!constraint.hard)continue;
    for(const id of constraint.violatedOptionIds){
      const reasons=hardRejected.get(id)??[];reasons.push(constraint.reasonCode);hardRejected.set(id,reasons);
    }
  }
  const viable=[],rejected=[];
  for(const option of request.options){
    const reasons=[...(hardRejected.get(option.optionId)??[])];
    const optionEvidence=option.evidenceRefs.map(id=>evidence.get(id));
    if(option.requiresEvidence&&optionEvidence.length===0)reasons.push(JevReasonCode.INSUFFICIENT_EVIDENCE);
    if(optionEvidence.some(x=>!x?.available||x?.stale))reasons.push(JevReasonCode.INSUFFICIENT_EVIDENCE);
    const row=deepFreeze({...option,deterministicReasonCodes:[...new Set(reasons)]});
    if(reasons.length)rejected.push(row);else viable.push(row);
  }
  const supported=viable.filter(option=>!option.requiresEvidence||option.evidenceRefs.length>0).length;
  return deepFreeze({
    kind:'JevPrefilterResult',freshness:freshness.freshness,viableOptions:viable,rejectedOptions:rejected,
    viableOptionIds:viable.map(x=>x.optionId),rejectedOptionIds:rejected.map(x=>x.optionId),
    evidenceCompleteness:viable.length?supported/viable.length:0,
    reasonCodes:[...new Set(rejected.flatMap(x=>x.deterministicReasonCodes))],
  });
}

export function evaluateJevInvocationGate(requestInput,{currentRevisionState=null,resourceAvailable=true,deterministicAnswer=null}={}){
  const request=requestInput?.kind==='JevDecisionRequest'?requestInput:createJevDecisionRequest(requestInput);
  const prefilter=prefilterJevOptions(request,{currentRevisionState});
  if(prefilter.freshness!=='FRESH')return gate(JevGateRoute.ABSTAIN,[JevReasonCode.STALE_INPUT],prefilter,{serviceStatus:JevServiceStatus.JEV_STALE,deterministicOutcome:JevOutcome.STALE});
  if(request.operatorApprovalPolicy.required||request.authorityBoundary.operatorOnly||request.authorityBoundary.destructive){
    return gate(JevGateRoute.REQUEST_OPERATOR,[JevReasonCode.OPERATOR_APPROVAL_REQUIRED],prefilter,{serviceStatus:JevServiceStatus.JEV_OPERATOR,deterministicOutcome:JevOutcome.REQUEST_OPERATOR});
  }
  if(request.authorityBoundary.authorityClass!=='ADVISORY'){
    return gate(JevGateRoute.ESCALATE,[JevReasonCode.OWNER_AUTHORITY_REQUIRED],prefilter,{serviceStatus:JevServiceStatus.JEV_ESCALATED,deterministicOutcome:JevOutcome.ESCALATE_OWNER});
  }
  if(deterministicAnswer){
    validateDeterministicAnswer(deterministicAnswer,prefilter,request);
    return gate(JevGateRoute.SKIP_JEV,[JevReasonCode.DETERMINISTIC_RESULT_SUFFICIENT],prefilter,{serviceStatus:JevServiceStatus.JEV_SKIPPED,deterministicAnswer});
  }
  if(prefilter.viableOptions.length===0){
    if(request.allowedOutcomes.includes(JevDecisionShape.REJECT_ALL)&&prefilter.rejectedOptions.length){
      return gate(JevGateRoute.SKIP_JEV,[JevReasonCode.HARD_CONSTRAINT_ELIMINATED,JevReasonCode.DETERMINISTIC_RESULT_SUFFICIENT],prefilter,{serviceStatus:JevServiceStatus.JEV_SKIPPED,
        deterministicAnswer:{outcome:JevOutcome.DECIDED,decisionCode:JevDecisionShape.REJECT_ALL,selectedOptionIds:[],rejectedOptionIds:prefilter.rejectedOptionIds,evidenceUsed:[],confidence:1}});
    }
    return gate(request.abstentionAllowed?JevGateRoute.ABSTAIN:JevGateRoute.ESCALATE,[JevReasonCode.NO_SAFE_DECISION],prefilter,{serviceStatus:request.abstentionAllowed?JevServiceStatus.JEV_ABSTAINED:JevServiceStatus.JEV_ESCALATED,deterministicOutcome:request.abstentionAllowed?JevOutcome.ABSTAINED:JevOutcome.ESCALATE_OWNER});
  }
  if(prefilter.viableOptions.length===1&&[JevDecisionShape.CHOOSE_ONE,JevDecisionShape.CHOOSE_SUBSET,JevDecisionShape.PRESERVE_MULTIPLE,JevDecisionShape.RANK_BOUNDED_OPTIONS].includes(request.decisionShape)){
    const only=prefilter.viableOptions[0];
    return gate(JevGateRoute.SKIP_JEV,[JevReasonCode.ONLY_ONE_VALID_OPTION,JevReasonCode.DETERMINISTIC_RESULT_SUFFICIENT],prefilter,{serviceStatus:JevServiceStatus.JEV_SKIPPED,
      deterministicAnswer:{outcome:JevOutcome.DECIDED,decisionCode:JevDecisionShape.CHOOSE_ONE,selectedOptionIds:[only.optionId],rejectedOptionIds:prefilter.rejectedOptionIds,evidenceUsed:[...only.evidenceRefs],confidence:1}});
  }
  const score=expectedDecisionValue(request);
  if(score<request.routing.minimumInvocationValue){
    return gate(JevGateRoute.SKIP_JEV,[JevReasonCode.LOW_EXPECTED_DECISION_VALUE],prefilter,{serviceStatus:JevServiceStatus.JEV_SKIPPED,
      deterministicAnswer:{outcome:JevOutcome.UNRESOLVED,decisionCode:JevDecisionShape.UNRESOLVED,selectedOptionIds:[],rejectedOptionIds:prefilter.rejectedOptionIds,evidenceUsed:[],confidence:0}});
  }
  if(prefilter.evidenceCompleteness<=0){
    return gate(request.abstentionAllowed?JevGateRoute.ABSTAIN:JevGateRoute.ESCALATE,[JevReasonCode.INSUFFICIENT_EVIDENCE],prefilter,{serviceStatus:request.abstentionAllowed?JevServiceStatus.JEV_ABSTAINED:JevServiceStatus.JEV_ESCALATED,deterministicOutcome:request.abstentionAllowed?JevOutcome.ABSTAINED:JevOutcome.ESCALATE_OWNER});
  }
  if(!resourceAvailable){
    return gate(JevGateRoute.ABSTAIN,[JevReasonCode.PROVIDER_UNAVAILABLE],prefilter,{serviceStatus:JevServiceStatus.JEV_UNAVAILABLE,deterministicOutcome:JevOutcome.UNRESOLVED});
  }
  return gate(JevGateRoute.INVOKE_JEV,[JevReasonCode.BOUNDED_AMBIGUITY,JevReasonCode.MULTIPLE_SUPPORTED_OPTIONS],prefilter,{serviceStatus:null,expectedDecisionValue:score});
}

export function expectedDecisionValue(requestInput){
  const request=requestInput?.kind==='JevDecisionRequest'?requestInput:createJevDecisionRequest(requestInput);
  const r=request.routing;
  return Math.max(0,Math.min(1,r.expectedDecisionValue-r.latencyPenalty-r.costPenalty-r.uncertaintyPenalty-r.authorityRisk));
}

function gate(route,reasonCodes,prefilter,extra={}){return deepFreeze({kind:'JevInvocationGateReceipt',route,reasonCodes:[...new Set(reasonCodes)],prefilter,...extra});}
function validateDeterministicAnswer(value,prefilter,request){
  if(!value||typeof value!=='object')throw new TypeError('deterministicAnswer must be an object');
  const known=new Set(prefilter.viableOptionIds);
  for(const id of value.selectedOptionIds??[])if(!known.has(id))throw new TypeError(`deterministic answer selected non-viable option: ${id}`);
  if(value.decisionCode&&![...request.allowedOutcomes,JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN,JevDecisionShape.ESCALATE,JevDecisionShape.REQUEST_OPERATOR].includes(value.decisionCode))throw new TypeError(`deterministic answer uses unsupported decisionCode: ${value.decisionCode}`);
}