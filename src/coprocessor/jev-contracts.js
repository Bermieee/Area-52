import { ResultClass, ResultDestination } from './constants.js';
import { cloneSerializable, createRevisionSet, deepFreeze } from './contracts.js';
import { classifyFreshness } from './validation.js';
import { sha256Hex, utf8ByteLength } from './browser-compat.js';

export const JEV_CONTRACT_VERSION = '1.0.0';

export const JevDecisionShape = Object.freeze({
  CHOOSE_ONE:'CHOOSE_ONE',
  CHOOSE_SUBSET:'CHOOSE_SUBSET',
  CLASSIFY_RELATIONSHIP:'CLASSIFY_RELATIONSHIP',
  RANK_BOUNDED_OPTIONS:'RANK_BOUNDED_OPTIONS',
  REJECT_ALL:'REJECT_ALL',
  PRESERVE_MULTIPLE:'PRESERVE_MULTIPLE',
  ABSTAIN:'ABSTAIN',
  ESCALATE:'ESCALATE',
  UNRESOLVED:'UNRESOLVED',
  REQUEST_OPERATOR:'REQUEST_OPERATOR',
});

export const JevOutcome = Object.freeze({
  DECIDED:'DECIDED', PARTIAL:'PARTIAL', UNRESOLVED:'UNRESOLVED', ABSTAINED:'ABSTAINED',
  ESCALATE_OWNER:'ESCALATE_OWNER', REQUEST_OPERATOR:'REQUEST_OPERATOR', STALE:'STALE', INVALID:'INVALID',
});

export const JevGateRoute = Object.freeze({
  SKIP_JEV:'SKIP_JEV', INVOKE_JEV:'INVOKE_JEV', ABSTAIN:'ABSTAIN', ESCALATE:'ESCALATE', REQUEST_OPERATOR:'REQUEST_OPERATOR',
});

export const JevServiceStatus = Object.freeze({
  JEV_SKIPPED:'JEV_SKIPPED', JEV_DECIDED:'JEV_DECIDED', JEV_PARTIAL:'JEV_PARTIAL', JEV_UNRESOLVED:'JEV_UNRESOLVED',
  JEV_ABSTAINED:'JEV_ABSTAINED', JEV_ESCALATED:'JEV_ESCALATED', JEV_OPERATOR:'JEV_OPERATOR', JEV_UNAVAILABLE:'JEV_UNAVAILABLE',
  JEV_STALE:'JEV_STALE', JEV_INVALID:'JEV_INVALID',
});

export const JevEscalationTarget = Object.freeze({
  OWNER:'OWNER', OPERATOR:'OPERATOR', DEEP_REVIEW:'DEEP_REVIEW', RETRY_LATER:'RETRY_LATER', UNRESOLVED:'UNRESOLVED',
});

export const JevReasonCode = Object.freeze({
  DETERMINISTIC_RESULT_SUFFICIENT:'DETERMINISTIC_RESULT_SUFFICIENT',
  BOUNDED_AMBIGUITY:'BOUNDED_AMBIGUITY',
  INSUFFICIENT_EVIDENCE:'INSUFFICIENT_EVIDENCE',
  HARD_CONSTRAINT_ELIMINATED:'HARD_CONSTRAINT_ELIMINATED',
  ONLY_ONE_VALID_OPTION:'ONLY_ONE_VALID_OPTION',
  MULTIPLE_SUPPORTED_OPTIONS:'MULTIPLE_SUPPORTED_OPTIONS',
  STALE_INPUT:'STALE_INPUT',
  OWNER_AUTHORITY_REQUIRED:'OWNER_AUTHORITY_REQUIRED',
  OPERATOR_APPROVAL_REQUIRED:'OPERATOR_APPROVAL_REQUIRED',
  PROVIDER_UNAVAILABLE:'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT:'PROVIDER_TIMEOUT',
  INVALID_PROVIDER_OUTPUT:'INVALID_PROVIDER_OUTPUT',
  UNKNOWN_OPTION:'UNKNOWN_OPTION',
  UNKNOWN_EVIDENCE:'UNKNOWN_EVIDENCE',
  UNSUPPORTED_OUTCOME:'UNSUPPORTED_OUTCOME',
  NO_SAFE_DECISION:'NO_SAFE_DECISION',
  LOW_EXPECTED_DECISION_VALUE:'LOW_EXPECTED_DECISION_VALUE',
  CONTEXT_SEALED:'CONTEXT_SEALED',
  REPLAYED_RESULT:'REPLAYED_RESULT',
});

const SHAPES=new Set(Object.values(JevDecisionShape));
const OUTCOMES=new Set(Object.values(JevOutcome));
const ESCALATION_TARGETS=new Set(Object.values(JevEscalationTarget));
const RESULT_CLASSES=new Set(Object.values(ResultClass));
const MAX_OPTIONS=64, MAX_EVIDENCE=128, MAX_CONSTRAINTS=128, MAX_REQUEST_BYTES=96*1024;

export function createJevDecisionRequest(input={}){
  const decisionId=req(input.decisionId,'decisionId');
  const decisionType=req(input.decisionType,'decisionType');
  const decisionShape=input.decisionShape??JevDecisionShape.CHOOSE_ONE;
  if(!SHAPES.has(decisionShape))throw new TypeError(`Unsupported Jev decisionShape: ${decisionShape}`);
  const evidenceRefs=normalizeEvidence(input.evidenceRefs??[]);
  const evidenceIds=new Set(evidenceRefs.map(x=>x.evidenceId));
  const provenanceRefs=uniqueStrings(input.provenanceRefs??[],'provenanceRefs');
  const options=normalizeOptions(input.options??[],evidenceIds);
  if(options.length<1||options.length>MAX_OPTIONS)throw new TypeError(`options must contain 1-${MAX_OPTIONS} entries`);
  const allowedOutcomes=uniqueStrings(input.allowedOutcomes?.length?input.allowedOutcomes:[decisionShape,JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN],'allowedOutcomes');
  for(const value of allowedOutcomes)if(!SHAPES.has(value))throw new TypeError(`Unsupported Jev allowed outcome: ${value}`);
  const constraints=normalizeConstraints(input.constraints??[],new Set(options.map(x=>x.optionId)));
  const revision=createRevisionSet({
    sourceRevisionSet:input.sourceRevisionSet??input.revisionFence?.sourceRevisionSet??[],
    worldRevision:input.worldRevision??input.revisionFence?.worldRevision??0,
    sceneRevision:input.sceneRevision??input.revisionFence?.sceneRevision??0,
    characterStateRevision:input.characterStateRevision??input.revisionFence?.characterStateRevision??0,
  });
  const deadline=finite(input.deadline??Number.MAX_SAFE_INTEGER,'deadline');
  const resultClass=input.resultClass??ResultClass.OPPORTUNISTIC;
  if(!RESULT_CLASSES.has(resultClass))throw new TypeError(`Unsupported resultClass: ${resultClass}`);
  const request=deepFreeze({
    kind:'JevDecisionRequest',contractVersion:JEV_CONTRACT_VERSION,
    decisionId,decisionType,decisionShape,
    turnId:req(input.turnId,'turnId'),taskId:req(input.taskId,'taskId'),correlationId:req(input.correlationId,'correlationId'),causationId:opt(input.causationId),
    options,allowedOutcomes,evidenceRefs,provenanceRefs,constraints,
    authorityBoundary:normalizeAuthorityBoundary(input.authorityBoundary),
    sourceRevisionSet:revision.sourceRevisionSet,worldRevision:revision.worldRevision,sceneRevision:revision.sceneRevision,characterStateRevision:revision.characterStateRevision,
    domainRevisions:normalizeRevisionMap(input.domainRevisions??input.revisionFence?.domainRevisions??{}),
    freshnessToken:req(input.freshnessToken??`fresh:${decisionId}`,'freshnessToken'),
    abstentionAllowed:input.abstentionAllowed!==false,
    escalationPolicy:normalizeEscalationPolicy(input.escalationPolicy),
    operatorApprovalPolicy:normalizeOperatorPolicy(input.operatorApprovalPolicy),
    deadline,softDeadline:finite(input.softDeadline??deadline,'softDeadline'),resourceClass:req(input.resourceClass??'STANDARD','resourceClass'),resultClass,
    cognitiveLayer:req(input.cognitiveLayer??'L1','cognitiveLayer'),
    domainAdapterId:opt(input.domainAdapterId),domainAdapterVersion:opt(input.domainAdapterVersion),
    routing:normalizeRouting(input.routing),
    metadata:boundedObject(input.metadata??{},'metadata',8*1024),
    authorityGranted:false,canonicalMutationAllowed:false,
  });
  if(request.softDeadline>request.deadline)throw new TypeError('softDeadline must not exceed deadline');
  const size=utf8ByteLength(JSON.stringify(request));
  if(size>MAX_REQUEST_BYTES)throw new TypeError(`JevDecisionRequest exceeds ${MAX_REQUEST_BYTES} bytes`);
  return request;
}

export function createJevDecisionReceipt(input={},requestInput){
  const request=requestInput?.kind==='JevDecisionRequest'?requestInput:createJevDecisionRequest(requestInput??{});
  const optionIds=new Set(request.options.map(x=>x.optionId));
  const evidenceIds=new Set(request.evidenceRefs.map(x=>x.evidenceId));
  const selected=validatedRefs(input.selectedOptionIds??[],'selectedOptionIds',optionIds);
  const rejected=validatedRefs(input.rejectedOptionIds??[],'rejectedOptionIds',optionIds);
  if(selected.some(x=>rejected.includes(x)))throw new TypeError('option cannot be both selected and rejected');
  const evidenceUsed=validatedRefs(input.evidenceUsed??[],'evidenceUsed',evidenceIds);
  const outcome=input.outcome??JevOutcome.UNRESOLVED;
  if(!OUTCOMES.has(outcome))throw new TypeError(`Unsupported Jev outcome: ${outcome}`);
  const confidence=finite(input.confidence??0,'confidence');
  if(confidence<0||confidence>1)throw new TypeError('confidence must be between 0 and 1');
  const requiresOwnerSettlement=input.requiresOwnerSettlement??[JevOutcome.DECIDED,JevOutcome.PARTIAL].includes(outcome);
  const receipt=deepFreeze({
    kind:'JevDecisionReceipt',contractVersion:JEV_CONTRACT_VERSION,
    decisionId:request.decisionId,decisionType:request.decisionType,decisionShape:request.decisionShape,
    selectedOptionIds:selected,rejectedOptionIds:rejected,
    decisionCode:req(input.decisionCode??defaultDecisionCode(outcome),'decisionCode'),classification:opt(input.classification),
    reasonCodes:normalizeReasonCodes(input.reasonCodes??[]),evidenceUsed,
    unresolvedFactors:boundedStrings(input.unresolvedFactors??[],'unresolvedFactors',32,600),
    confidence,abstained:Boolean(input.abstained??outcome===JevOutcome.ABSTAINED),outcome,
    serviceStatus:req(input.serviceStatus??serviceStatusForOutcome(outcome),'serviceStatus'),
    escalationTarget:input.escalationTarget==null?null:validatedEscalationTarget(input.escalationTarget),
    requiresOwnerSettlement:Boolean(requiresOwnerSettlement),requiresOperator:Boolean(input.requiresOperator??outcome===JevOutcome.REQUEST_OPERATOR),
    revisionFence:deepFreeze({sourceRevisionSet:[...request.sourceRevisionSet],worldRevision:request.worldRevision,sceneRevision:request.sceneRevision,
      characterStateRevision:request.characterStateRevision,domainRevisions:structuredClone(request.domainRevisions)}),
    freshnessToken:request.freshnessToken,
    providerProvenance:boundedObject(input.providerProvenance??{},'providerProvenance',8*1024),
    validationStatus:boundedObject(input.validationStatus??{schema:'PASS',deterministic:'PASS',freshness:'FRESH'},'validationStatus',8*1024),
    latencyMetadata:normalizeLatency(input.latencyMetadata),
    admission:normalizeAdmission(input.admission),
    explanation:boundedText(input.explanation??'','explanation',800),
    requestFingerprint:req(input.requestFingerprint??jevRequestFingerprint(request),'requestFingerprint'),
    authorityGranted:false,canonicalMutation:false,settlementPerformed:false,
  });
  if([JevOutcome.DECIDED,JevOutcome.PARTIAL].includes(outcome)&&!receipt.requiresOwnerSettlement)throw new TypeError('decided Jev receipts must require owner settlement');
  return receipt;
}

export function jevRequestFingerprint(requestInput){
  const request=requestInput?.kind==='JevDecisionRequest'?requestInput:createJevDecisionRequest(requestInput);
  return `jev:${sha256Hex(stableStringify({
    decisionId:request.decisionId,decisionType:request.decisionType,decisionShape:request.decisionShape,
    options:request.options,allowedOutcomes:request.allowedOutcomes,evidenceRefs:request.evidenceRefs,provenanceRefs:request.provenanceRefs,constraints:request.constraints,
    authorityBoundary:request.authorityBoundary,sourceRevisionSet:request.sourceRevisionSet,worldRevision:request.worldRevision,sceneRevision:request.sceneRevision,
    characterStateRevision:request.characterStateRevision,domainRevisions:request.domainRevisions,freshnessToken:request.freshnessToken,
  }))}`;
}

export function evaluateJevFreshness(requestInput,currentState={}){
  const request=requestInput?.kind==='JevDecisionRequest'?requestInput:createJevDecisionRequest(requestInput);
  const current=createRevisionSet({
    sourceRevisionSet:currentState.sourceRevisionSet??request.sourceRevisionSet,
    worldRevision:currentState.worldRevision??request.worldRevision,
    sceneRevision:currentState.sceneRevision??request.sceneRevision,
    characterStateRevision:currentState.characterStateRevision??request.characterStateRevision,
  });
  const base=classifyFreshness(request,current);
  if(base!=='FRESH')return deepFreeze({freshness:base,reasonCode:JevReasonCode.STALE_INPUT});
  const domain=compareRevisionMap(request.domainRevisions,currentState.domainRevisions??request.domainRevisions);
  if(domain!=='FRESH')return deepFreeze({freshness:domain,reasonCode:JevReasonCode.STALE_INPUT});
  if(currentState.freshnessToken!=null&&currentState.freshnessToken!==request.freshnessToken)return deepFreeze({freshness:'STALE',reasonCode:JevReasonCode.STALE_INPUT});
  return deepFreeze({freshness:'FRESH',reasonCode:null});
}

export function createJevOwnerHandoff(receipt,{authorityImpact=null,dependencyImpact=null,provenanceRefs=[]}={}){
  if(receipt?.kind!=='JevDecisionReceipt')throw new TypeError('JevDecisionReceipt is required');
  return deepFreeze({
    kind:'JevOwnerHandoff',decisionId:receipt.decisionId,decisionType:receipt.decisionType,
    proposedDecision:{outcome:receipt.outcome,decisionCode:receipt.decisionCode,classification:receipt.classification,selectedOptionIds:[...receipt.selectedOptionIds]},
    rejectedOptionIds:[...receipt.rejectedOptionIds],evidenceRefs:[...receipt.evidenceUsed],provenanceRefs:uniqueStrings(provenanceRefs,'provenanceRefs'),
    unresolvedFactors:[...receipt.unresolvedFactors],authorityImpact:cloneSerializable(authorityImpact??{},'authorityImpact'),
    dependencyImpact:cloneSerializable(dependencyImpact??{},'dependencyImpact'),requiresOperator:receipt.requiresOperator,
    requiresOwnerSettlement:receipt.requiresOwnerSettlement,authorityGranted:false,settlementPerformed:false,
  });
}

export function evaluateJevOwnerPolicy(handoff,{accepted=true,requiresOperator=handoff?.requiresOperator??false,reasonCodes=[]}={}){
  if(handoff?.kind!=='JevOwnerHandoff')throw new TypeError('JevOwnerHandoff is required');
  const ownerAccepted=Boolean(accepted);
  return deepFreeze({
    kind:'JevOwnerPolicyReceipt',decisionId:handoff.decisionId,ownerAccepted,requiresOperator:Boolean(requiresOperator),
    settlementEligible:ownerAccepted&&!requiresOperator&&handoff.requiresOwnerSettlement,
    action:!ownerAccepted?'OWNER_REJECTED':requiresOperator?'REQUEST_OPERATOR':handoff.requiresOwnerSettlement?'OWNER_MAY_SETTLE':'NO_OP',
    reasonCodes:normalizeReasonCodes(reasonCodes),canonicalMutation:false,authorityGranted:false,
  });
}

export function lateJevAdmission(receipt,{sealed=false,destination=null}={}){
  if(receipt?.kind!=='JevDecisionReceipt')throw new TypeError('JevDecisionReceipt is required');
  return deepFreeze({
    foregroundEligible:!sealed,
    late:Boolean(sealed),
    destination:destination??(sealed?ResultDestination.NEXT_TURN:ResultDestination.FOREGROUND),
    reasonCode:sealed?JevReasonCode.CONTEXT_SEALED:null,
  });
}

function normalizeOptions(values,evidenceIds){
  if(!Array.isArray(values))throw new TypeError('options must be an array');
  const seen=new Set();
  return deepFreeze(values.map((value,index)=>{
    if(!value||typeof value!=='object')throw new TypeError(`options[${index}] must be an object`);
    const optionId=req(value.optionId??value.id,`options[${index}].optionId`);
    if(seen.has(optionId))throw new TypeError(`duplicate optionId: ${optionId}`);seen.add(optionId);
    const refs=uniqueStrings(value.evidenceRefs??[],`options[${index}].evidenceRefs`);
    for(const ref of refs)if(!evidenceIds.has(ref))throw new TypeError(`options[${index}] references unknown evidence: ${ref}`);
    return deepFreeze({optionId,label:boundedText(value.label??optionId,`options[${index}].label`,240),
      evidenceRefs:refs,provenanceRefs:uniqueStrings(value.provenanceRefs??[],`options[${index}].provenanceRefs`),
      requiresEvidence:value.requiresEvidence!==false,payload:boundedObject(value.payload??{},`options[${index}].payload`,8*1024)});
  }));
}
function normalizeEvidence(values){
  if(!Array.isArray(values)||values.length>MAX_EVIDENCE)throw new TypeError(`evidenceRefs must be an array with at most ${MAX_EVIDENCE} entries`);
  const seen=new Set();
  return deepFreeze(values.map((value,index)=>{
    const raw=typeof value==='string'?{evidenceId:value}:value;
    if(!raw||typeof raw!=='object')throw new TypeError(`evidenceRefs[${index}] must be a string or object`);
    const evidenceId=req(raw.evidenceId??raw.ref,`evidenceRefs[${index}].evidenceId`);
    if(seen.has(evidenceId))throw new TypeError(`duplicate evidenceId: ${evidenceId}`);seen.add(evidenceId);
    return deepFreeze({evidenceId,sourceRef:opt(raw.sourceRef),summary:boundedText(raw.summary??'',`evidenceRefs[${index}].summary`,1200),
      provenanceRefs:uniqueStrings(raw.provenanceRefs??[],`evidenceRefs[${index}].provenanceRefs`),revision:raw.revision??null,
      available:raw.available!==false,stale:Boolean(raw.stale),metadata:boundedObject(raw.metadata??{},`evidenceRefs[${index}].metadata`,6*1024)});
  }));
}
function normalizeConstraints(values,optionIds){
  if(!Array.isArray(values)||values.length>MAX_CONSTRAINTS)throw new TypeError(`constraints must be an array with at most ${MAX_CONSTRAINTS} entries`);
  const seen=new Set();
  return deepFreeze(values.map((value,index)=>{
    if(!value||typeof value!=='object')throw new TypeError(`constraints[${index}] must be an object`);
    const constraintId=req(value.constraintId??`constraint:${index}`,`constraints[${index}].constraintId`);
    if(seen.has(constraintId))throw new TypeError(`duplicate constraintId: ${constraintId}`);seen.add(constraintId);
    const violatedOptionIds=uniqueStrings(value.violatedOptionIds??[],`constraints[${index}].violatedOptionIds`);
    for(const id of violatedOptionIds)if(!optionIds.has(id))throw new TypeError(`constraint references unknown option: ${id}`);
    return deepFreeze({constraintId,type:req(value.type??'DOMAIN_RULE',`constraints[${index}].type`),hard:value.hard!==false,
      violatedOptionIds,reasonCode:req(value.reasonCode??JevReasonCode.HARD_CONSTRAINT_ELIMINATED,`constraints[${index}].reasonCode`),
      description:boundedText(value.description??'',`constraints[${index}].description`,600),metadata:boundedObject(value.metadata??{},`constraints[${index}].metadata`,4*1024)});
  }));
}
function normalizeAuthorityBoundary(value={}){return deepFreeze({authorityClass:req(value?.authorityClass??'ADVISORY','authorityBoundary.authorityClass'),ownerId:req(value?.ownerId??'DOMAIN_OWNER','authorityBoundary.ownerId'),operatorOnly:Boolean(value?.operatorOnly),destructive:Boolean(value?.destructive),notes:boundedText(value?.notes??'','authorityBoundary.notes',600)});}
function normalizeEscalationPolicy(value={}){const targets=uniqueStrings(value?.allowedTargets??Object.values(JevEscalationTarget),'escalationPolicy.allowedTargets');for(const t of targets)if(!ESCALATION_TARGETS.has(t))throw new TypeError(`Unsupported escalation target: ${t}`);const maxRetries=Number(value?.maxRetries??1);if(!Number.isInteger(maxRetries)||maxRetries<0||maxRetries>3)throw new TypeError('escalationPolicy.maxRetries must be 0-3');return deepFreeze({allowedTargets:targets,defaultTarget:validatedEscalationTarget(value?.defaultTarget??JevEscalationTarget.OWNER),maxRetries});}
function normalizeOperatorPolicy(value={}){return deepFreeze({required:Boolean(value?.required),reasonCode:req(value?.reasonCode??JevReasonCode.OPERATOR_APPROVAL_REQUIRED,'operatorApprovalPolicy.reasonCode')});}
function normalizeRouting(value={}){const out={expectedDecisionValue:unit(value?.expectedDecisionValue??0.75,'routing.expectedDecisionValue'),latencyPenalty:unit(value?.latencyPenalty??0.1,'routing.latencyPenalty'),costPenalty:unit(value?.costPenalty??0.05,'routing.costPenalty'),uncertaintyPenalty:unit(value?.uncertaintyPenalty??0.05,'routing.uncertaintyPenalty'),authorityRisk:unit(value?.authorityRisk??0,'routing.authorityRisk'),minimumInvocationValue:unit(value?.minimumInvocationValue??0.2,'routing.minimumInvocationValue'),unresolvedAcceptable:value?.unresolvedAcceptable!==false,currentGenerationDepends:Boolean(value?.currentGenerationDepends)};return deepFreeze(out);}
function normalizeRevisionMap(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('domainRevisions must be an object');const out={};for(const key of Object.keys(value).sort()){const v=value[key];if(!['string','number'].includes(typeof v)||String(v)==='')throw new TypeError(`domainRevisions.${key} must be string/number`);out[key]=v;}return deepFreeze(out);}
function compareRevisionMap(actual,current){const keys=new Set([...Object.keys(actual??{}),...Object.keys(current??{})]);for(const key of keys){if(!(key in actual)||!(key in current))return 'STALE';const a=actual[key],c=current[key];if(typeof a==='number'&&typeof c==='number'){if(a>c)return 'FUTURE_REVISION';if(a<c)return 'STALE';}else if(String(a)!==String(c))return 'STALE';}return 'FRESH';}
function normalizeLatency(value={}){return deepFreeze({providerLatencyMs:Math.max(0,finite(value?.providerLatencyMs??0,'latency.providerLatencyMs')),validationLatencyMs:Math.max(0,finite(value?.validationLatencyMs??0,'latency.validationLatencyMs')),totalLatencyMs:Math.max(0,finite(value?.totalLatencyMs??0,'latency.totalLatencyMs')),attempts:Math.max(0,Math.floor(finite(value?.attempts??0,'latency.attempts')))});}
function normalizeAdmission(value={}){return deepFreeze({foregroundEligible:value?.foregroundEligible!==false,late:Boolean(value?.late),destination:req(value?.destination??ResultDestination.FOREGROUND,'admission.destination'),reasonCode:opt(value?.reasonCode)});}
function validatedEscalationTarget(value){if(!ESCALATION_TARGETS.has(value))throw new TypeError(`Unsupported escalation target: ${value}`);return value;}
function serviceStatusForOutcome(outcome){return ({DECIDED:JevServiceStatus.JEV_DECIDED,PARTIAL:JevServiceStatus.JEV_PARTIAL,UNRESOLVED:JevServiceStatus.JEV_UNRESOLVED,ABSTAINED:JevServiceStatus.JEV_ABSTAINED,ESCALATE_OWNER:JevServiceStatus.JEV_ESCALATED,REQUEST_OPERATOR:JevServiceStatus.JEV_OPERATOR,STALE:JevServiceStatus.JEV_STALE,INVALID:JevServiceStatus.JEV_INVALID})[outcome]??JevServiceStatus.JEV_INVALID;}
function defaultDecisionCode(outcome){return ({DECIDED:'DECIDED',PARTIAL:'PARTIAL',UNRESOLVED:'UNRESOLVED',ABSTAINED:'ABSTAIN',ESCALATE_OWNER:'ESCALATE',REQUEST_OPERATOR:'REQUEST_OPERATOR',STALE:'STALE',INVALID:'INVALID'})[outcome]??'INVALID';}
function normalizeReasonCodes(values){return deepFreeze(uniqueStrings(values,'reasonCodes').map((value)=>{if(!/^[A-Z][A-Z0-9_:-]*$/.test(value))throw new TypeError(`invalid reason code: ${value}`);return value;}));}
function validatedRefs(values,name,known){const out=uniqueStrings(values,name);for(const id of out)if(!known.has(id))throw new TypeError(`${name} contains unknown ref: ${id}`);return out;}
function boundedStrings(values,name,maxItems,maxLength){if(!Array.isArray(values)||values.length>maxItems)throw new TypeError(`${name} must contain at most ${maxItems} items`);return deepFreeze(values.map((x,i)=>boundedText(x,`${name}[${i}]`,maxLength)));}
function boundedObject(value,name,maxBytes){const clone=cloneSerializable(value,name);if(utf8ByteLength(JSON.stringify(clone))>maxBytes)throw new TypeError(`${name} exceeds ${maxBytes} bytes`);return deepFreeze(clone);}
function boundedText(value,name,max){if(typeof value!=='string')value=String(value??'');if(value.length>max)throw new TypeError(`${name} exceeds ${max} characters`);return value;}
function uniqueStrings(value,name){if(!Array.isArray(value)||value.some(x=>typeof x!=='string'||!x.trim()))throw new TypeError(`${name} must be an array of non-empty strings`);return deepFreeze([...new Set(value.map(x=>x.trim()))]);}
function req(value,name){if(typeof value!=='string'||!value.trim())throw new TypeError(`${name} must be a non-empty string`);return value.trim();}
function opt(value){return value==null?null:req(String(value),'optional string');}
function finite(value,name){const n=Number(value);if(!Number.isFinite(n))throw new TypeError(`${name} must be finite`);return n;}
function unit(value,name){const n=finite(value,name);if(n<0||n>1)throw new TypeError(`${name} must be between 0 and 1`);return n;}
function stableStringify(value){if(Array.isArray(value))return `[${value.map(stableStringify).join(',')}]`;if(value&&typeof value==='object'){return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;}return JSON.stringify(value);}