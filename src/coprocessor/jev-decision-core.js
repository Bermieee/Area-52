import { Capability, FailureCode, Placement, ResultClass, ResultDestination } from './constants.js';
import { createCognitiveTask, deepFreeze } from './contracts.js';
import { ProviderInvocationError } from './provider-adapters.js';
import { utf8ByteLength } from './browser-compat.js';
import { normalizeProviderUsageReceipt } from './usage-receipt.js';
import {
  JevDecisionShape,JevEscalationTarget,JevGateRoute,JevOutcome,JevReasonCode,JevServiceStatus,
  createJevDecisionReceipt,createJevDecisionRequest,evaluateJevFreshness,jevRequestFingerprint,lateJevAdmission,
} from './jev-contracts.js';
import { evaluateJevInvocationGate } from './jev-invocation-gate.js';

const PROVIDER_KEYS=['outcome','decisionCode','selectedOptionIds','rejectedOptionIds','classification','reasonCodes','evidenceUsed','unresolvedFactors','confidence','abstained','escalationTarget','requiresOperator','explanation'];

export function createJevCognitiveTask(requestInput,{prefilter=null}={}){
  const request=requestInput?.kind==='JevDecisionRequest'?requestInput:createJevDecisionRequest(requestInput);
  return createCognitiveTask({
    taskId:request.taskId,taskType:'JEV_DECISION',turnId:request.turnId,correlationId:request.correlationId,causationId:request.causationId,
    requiredCapabilities:[Capability.SEMANTIC_JUDGMENT],optionalCapabilities:[Capability.PROPOSAL_REVIEW,Capability.CONFLICT_INTERPRETATION],
    cognitiveLayer:request.cognitiveLayer,resultClass:request.resultClass,placement:request.cognitiveLayer==='L4'?Placement.DEEP:Placement.HOT,
    sourceRevisionSet:request.sourceRevisionSet,worldRevision:request.worldRevision,sceneRevision:request.sceneRevision,characterStateRevision:request.characterStateRevision,
    softDeadline:request.softDeadline,hardDeadline:request.deadline,dedupeKey:jevRequestFingerprint(request),intentFingerprint:`jev:${request.decisionId}:${request.freshnessToken}`,
    fallbackPolicy:{type:'DETERMINISTIC',maxRetries:request.escalationPolicy.maxRetries},
    outputSchema:{type:'object',required:PROVIDER_KEYS},
    metadata:{decisionId:request.decisionId,decisionType:request.decisionType,decisionShape:request.decisionShape,resourceClass:request.resourceClass,
      viableOptionCount:prefilter?.viableOptions?.length??request.options.length,expectedOutputTokens:700,truthAuthorityGranted:false,durableMutationAllowed:false},
  });
}

export function createJevProviderInput(requestInput,prefilter){
  const request=requestInput?.kind==='JevDecisionRequest'?requestInput:createJevDecisionRequest(requestInput);
  const viableIds=new Set((prefilter?.viableOptions??request.options).map(x=>x.optionId));
  const options=request.options.filter(x=>viableIds.has(x.optionId));
  const evidenceIds=new Set(options.flatMap(x=>x.evidenceRefs));
  const evidence=request.evidenceRefs.filter(x=>evidenceIds.has(x.evidenceId));
  const data={
    contract:'JevDecisionRequest',decisionId:request.decisionId,decisionType:request.decisionType,decisionShape:request.decisionShape,
    allowedOutcomes:request.allowedOutcomes,options,evidence,constraints:request.constraints.filter(c=>!c.hard||c.violatedOptionIds.every(id=>!viableIds.has(id))),
    authorityBoundary:request.authorityBoundary,abstentionAllowed:request.abstentionAllowed,escalationPolicy:request.escalationPolicy,
    operatorApprovalPolicy:request.operatorApprovalPolicy,
    revisionFence:{sourceRevisionSet:request.sourceRevisionSet,worldRevision:request.worldRevision,sceneRevision:request.sceneRevision,characterStateRevision:request.characterStateRevision,domainRevisions:request.domainRevisions},
    freshnessToken:request.freshnessToken,
    outputContract:{keys:PROVIDER_KEYS,rule:'Use only supplied option/evidence IDs. No new options. No hidden chain-of-thought. explanation must be concise.'},
  };
  return deepFreeze({messages:[
    {role:'system',content:'You are Jev, a bounded adjudication protocol. Compare only explicit surviving options against explicit evidence. Do not invent options or evidence. Do not claim authority or mutate state. UNRESOLVED, ABSTAIN, and escalation are valid. Return exactly one strict JSON object with the requested keys. reasonCodes must be machine-readable; explanation must be concise and must not expose chain-of-thought.'},
    {role:'user',content:JSON.stringify(data)},
  ],data});
}

export function validateJevProviderOutput(raw,{request:requestInput,prefilter}){
  const request=requestInput?.kind==='JevDecisionRequest'?requestInput:createJevDecisionRequest(requestInput);
  const value=parseStrictObject(raw);
  exactKeys(value,PROVIDER_KEYS);
  const viable=new Set((prefilter?.viableOptions??request.options).map(x=>x.optionId));
  const allOptions=new Set(request.options.map(x=>x.optionId));
  const evidence=new Set(request.evidenceRefs.map(x=>x.evidenceId));
  const selected=stringArray(value.selectedOptionIds,'selectedOptionIds');
  const rejected=stringArray(value.rejectedOptionIds,'rejectedOptionIds');
  const evidenceUsed=stringArray(value.evidenceUsed,'evidenceUsed');
  for(const id of [...selected,...rejected])if(!allOptions.has(id))fail(FailureCode.UNKNOWN_REFERENCE,`unknown Jev option: ${id}`);
  for(const id of selected)if(!viable.has(id))fail(FailureCode.AUTHORITY_VIOLATION,`provider selected deterministically rejected option: ${id}`);
  if(new Set([...selected,...rejected]).size!==selected.length+rejected.length)fail(FailureCode.SCHEMA_INVALID,'selected/rejected options overlap');
  for(const id of evidenceUsed)if(!evidence.has(id))fail(FailureCode.UNKNOWN_REFERENCE,`unknown Jev evidence: ${id}`);
  const outcome=requiredEnum(value.outcome,Object.values(JevOutcome),'outcome');
  const decisionCode=req(value.decisionCode,'decisionCode');
  const permittedCodes=new Set([...request.allowedOutcomes,JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN,JevDecisionShape.ESCALATE,JevDecisionShape.REQUEST_OPERATOR]);
  if(!permittedCodes.has(decisionCode))fail(FailureCode.SCHEMA_INVALID,`unsupported Jev decisionCode: ${decisionCode}`);
  const confidence=Number(value.confidence);if(!Number.isFinite(confidence)||confidence<0||confidence>1)fail(FailureCode.SCHEMA_INVALID,'confidence must be between 0 and 1');
  const reasonCodes=stringArray(value.reasonCodes,'reasonCodes');for(const code of reasonCodes)if(!/^[A-Z][A-Z0-9_:-]*$/.test(code))fail(FailureCode.SCHEMA_INVALID,`invalid reason code: ${code}`);
  const unresolvedFactors=stringArray(value.unresolvedFactors,'unresolvedFactors',32,600);
  const classification=value.classification==null?null:req(value.classification,'classification');
  const escalationTarget=value.escalationTarget==null?null:req(value.escalationTarget,'escalationTarget');
  const explanation=typeof value.explanation==='string'?value.explanation:'';if(explanation.length>800)fail(FailureCode.SCHEMA_INVALID,'explanation exceeds 800 characters');
  validateShape({request,outcome,decisionCode,selected,rejected,evidenceUsed,abstained:Boolean(value.abstained),requiresOperator:Boolean(value.requiresOperator)});
  return deepFreeze({outcome,decisionCode,selectedOptionIds:selected,rejectedOptionIds:rejected,classification,reasonCodes,evidenceUsed,unresolvedFactors,
    confidence,abstained:Boolean(value.abstained),escalationTarget,requiresOperator:Boolean(value.requiresOperator),explanation});
}

export class JevProviderExecutor{
  constructor({profiles,adapters,maxCostClass='HIGH'}={}){
    if(!profiles||typeof profiles.eligibleProfiles!=='function')throw new TypeError('JevProviderExecutor requires CapabilityProfileRegistry');
    if(!adapters||typeof adapters.get!=='function')throw new TypeError('JevProviderExecutor requires ProviderAdapterRegistry');
    this.profiles=profiles;this.adapters=adapters;this.maxCostClass=maxCostClass;
  }
  hasEligibleProvider(request,prefilter){
    const task=createJevCognitiveTask(request,{prefilter});const input=createJevProviderInput(request,prefilter);return this.#eligible(task,input).length>0;
  }
  async execute(requestInput,{prefilter,signal=null,attempt=1,profileId=null,leaseHeld=false}={}){
    const request=requestInput?.kind==='JevDecisionRequest'?requestInput:createJevDecisionRequest(requestInput);
    const task=createJevCognitiveTask(request,{prefilter});const input=createJevProviderInput(request,prefilter);
    const candidates=profileId!=null&&leaseHeld?[this.profiles.get(profileId)].filter(profile=>profile&&this.adapters.get(profile.providerId)&&jevProfileSupportsTask(profile,task)):this.#eligible(task,input);const fallbackIndex=Math.min(Math.max(0,Number(attempt??1)-1),Math.max(0,candidates.length-1));const profile=profileId?candidates.find(x=>x.profileId===profileId):candidates[fallbackIndex];
    if(!profile)throw new ProviderInvocationError(FailureCode.PROVIDER_UNAVAILABLE,'No eligible provider resource for Jev',{providerId:null});
    const adapter=this.adapters.get(profile.providerId);if(!adapter)throw new ProviderInvocationError(FailureCode.PROVIDER_UNAVAILABLE,'Jev provider adapter unavailable',{providerId:profile.providerId});
    const started=Date.now();let invocation;
    try{invocation=await adapter.invoke(task,input,{signal,attempt,maxOutputTokens:Number.isFinite(profile.maxOutputTokens)?Math.min(profile.maxOutputTokens,1200):1200});}
    catch(error){if(error instanceof ProviderInvocationError)throw error;throw new ProviderInvocationError(error?.code??FailureCode.PROVIDER_FAILURE,error?.message??String(error),{providerId:profile.providerId,cause:error});}
    const validationStarted=Date.now();const decision=validateJevProviderOutput(invocation.text,{request,prefilter});const validationLatency=Math.max(0,Date.now()-validationStarted);
    const measurementClass=invocation.metadata?.measurementClass??adapter.measurementClass??profile.profileMetadata?.measurementClass??null;
    const usageReceipt=normalizeProviderUsageReceipt({usage:invocation.usage??{},providerProfileId:profile.profileId,capability:Capability.SEMANTIC_JUDGMENT,latencyMs:invocation.latencyMs,pricing:profile.costMetadata});
    const actualModelId=invocation.modelId??profile.modelId;
    return deepFreeze({task,input,decision,providerProvenance:{providerProfileId:profile.profileId,providerId:profile.providerId,resourceId:profile.profileMetadata?.resourceId??null,
      modelId:actualModelId,requestedModelId:profile.modelId,actualProvider:invocation.metadata?.actualProvider??null,workerId:profile.workerId,
      capability:'SEMANTIC_JUDGMENT',attempt,finishReason:invocation.finishReason??null,usage:structuredClone(invocation.usage??{}),usageReceipt,measurementClass,
      latencyClass:profile.latencyClass??null,costClass:profile.costClass??null},
      latencyMetadata:{providerLatencyMs:Number(invocation.latencyMs??0),validationLatencyMs:validationLatency,totalLatencyMs:Math.max(0,Date.now()-started),attempts:attempt},
      payloadBytes:utf8ByteLength(JSON.stringify(input.data))});
  }
  #eligible(task,input){
    const contextTokens=Math.max(1,Math.ceil(utf8ByteLength(JSON.stringify(input))/4));
    return this.profiles.eligibleProfiles(task,{contextTokens,maxCostClass:this.maxCostClass,requireStructuredOutput:true,expectedOutputTokens:700})
      .filter(profile=>this.adapters.get(profile.providerId));
  }
}

export class JevDecisionCore{
  #replay=new Map();#metrics={decisions:0,invocations:0,skips:0,abstentions:0,escalations:0,operator:0,providerCalls:0,retries:0,timeouts:0,invalid:0,stale:0,late:0,totalLatencyMs:0,totalPayloadBytes:0};
  constructor({providerExecutor=null,replayLimit=128}={}){this.providerExecutor=providerExecutor;this.replayLimit=positiveReplayLimit(replayLimit);}
  async decide(requestInput,{currentRevisionState=null,sealed=false,signal=null,deterministicAnswer=null}={}){
    const started=Date.now();const request=createJevDecisionRequest(requestInput);const fingerprint=jevRequestFingerprint(request);const replayKey=`${request.decisionId}|${fingerprint}`;
    const replay=this.#replay.get(replayKey);
    if(replay){
      const currentReplay=await resolveValue(currentRevisionState,request);const freshnessReplay=evaluateJevFreshness(request,currentReplay);
      if(freshnessReplay.freshness!=='FRESH'){
        this.#metrics.stale++;
        return this.#receipt(request,{outcome:JevOutcome.STALE,serviceStatus:JevServiceStatus.JEV_STALE,decisionCode:'STALE',reasonCodes:[JevReasonCode.STALE_INPUT],providerProvenance:replay.providerProvenance,latencyMetadata:replay.latencyMetadata,validationStatus:{schema:'PASS',deterministic:'PASS',freshness:freshnessReplay.freshness},requestFingerprint:fingerprint},started);
      }
      const isSealedReplay=Boolean(await resolveValue(sealed,false));
      if(!isSealedReplay)return replay;
      this.#metrics.late++;
      return createJevDecisionReceipt({...replay,admission:lateJevAdmission(replay,{sealed:true}),validationStatus:{...replay.validationStatus,freshness:'FRESH'}},request);
    }
    this.#metrics.decisions++;
    const current=await resolveValue(currentRevisionState,request);const freshness=evaluateJevFreshness(request,current);
    if(freshness.freshness!=='FRESH'){
      this.#metrics.stale++;const receipt=this.#receipt(request,{outcome:JevOutcome.STALE,serviceStatus:JevServiceStatus.JEV_STALE,decisionCode:'STALE',reasonCodes:[JevReasonCode.STALE_INPUT],validationStatus:{schema:'PASS',deterministic:'PASS',freshness:freshness.freshness},requestFingerprint:fingerprint},started);return this.#remember(replayKey,receipt);
    }
    const pre=evaluateJevInvocationGate(request,{currentRevisionState:current,resourceAvailable:this.providerExecutor?.hasEligibleProvider?.(request,null)??Boolean(this.providerExecutor),deterministicAnswer});
    if(pre.route!==JevGateRoute.INVOKE_JEV){const receipt=this.#fromGate(request,pre,fingerprint,started);return this.#remember(replayKey,receipt);}
    this.#metrics.invocations++;
    const maxAttempts=1+request.escalationPolicy.maxRetries;let lastError=null;
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      this.#metrics.providerCalls++;if(attempt>1)this.#metrics.retries++;
      try{
        const execution=await this.providerExecutor.execute(request,{prefilter:pre.prefilter,signal,attempt});
        this.#metrics.totalPayloadBytes+=execution.payloadBytes;
        const currentAfter=await resolveValue(currentRevisionState,request);const freshAfter=evaluateJevFreshness(request,currentAfter);
        if(freshAfter.freshness!=='FRESH'){
          this.#metrics.stale++;const receipt=this.#receipt(request,{outcome:JevOutcome.STALE,serviceStatus:JevServiceStatus.JEV_STALE,decisionCode:'STALE',reasonCodes:[JevReasonCode.STALE_INPUT],providerProvenance:execution.providerProvenance,latencyMetadata:execution.latencyMetadata,validationStatus:{schema:'PASS',deterministic:'PASS',freshness:freshAfter.freshness},requestFingerprint:fingerprint},started);return this.#remember(replayKey,receipt);
        }
        const isSealed=Boolean(await resolveValue(sealed,false));const admission=lateJevAdmission({kind:'JevDecisionReceipt'},{sealed:isSealed});if(isSealed)this.#metrics.late++;
        const d=execution.decision;const receipt=this.#receipt(request,{...d,serviceStatus:statusFromDecision(d),providerProvenance:execution.providerProvenance,
          latencyMetadata:execution.latencyMetadata,validationStatus:{schema:'PASS',deterministic:'PASS',freshness:'FRESH'},admission,requestFingerprint:fingerprint},started);
        return this.#remember(replayKey,receipt);
      }catch(error){lastError=error;if(error?.code===FailureCode.PROVIDER_TIMEOUT)this.#metrics.timeouts++;if(attempt<maxAttempts&&retryable(error))continue;break;}
    }
    const unavailable=[FailureCode.PROVIDER_UNAVAILABLE,FailureCode.CAPABILITY_UNAVAILABLE,FailureCode.PROVIDER_TIMEOUT,FailureCode.PROVIDER_ABORTED].includes(lastError?.code);
    if(unavailable){
      const code=lastError?.code===FailureCode.PROVIDER_TIMEOUT?JevReasonCode.PROVIDER_TIMEOUT:JevReasonCode.PROVIDER_UNAVAILABLE;
      const receipt=this.#receipt(request,{outcome:JevOutcome.UNRESOLVED,serviceStatus:JevServiceStatus.JEV_UNAVAILABLE,decisionCode:JevDecisionShape.UNRESOLVED,
        reasonCodes:[code],unresolvedFactors:['Jev provider execution unavailable'],validationStatus:{schema:'NOT_AVAILABLE',deterministic:'PASS',freshness:'FRESH'},requestFingerprint:fingerprint},started);return this.#remember(replayKey,receipt);
    }
    this.#metrics.invalid++;
    const receipt=this.#receipt(request,{outcome:JevOutcome.INVALID,serviceStatus:JevServiceStatus.JEV_INVALID,decisionCode:'INVALID',reasonCodes:[JevReasonCode.INVALID_PROVIDER_OUTPUT],
      unresolvedFactors:[String(lastError?.message??'invalid provider output').slice(0,600)],validationStatus:{schema:'FAIL',deterministic:'FAIL_CLOSED',freshness:'FRESH'},requestFingerprint:fingerprint},started);
    return this.#remember(replayKey,receipt);
  }
  metricsSnapshot(){const m=this.#metrics;return deepFreeze({...m,invocationRate:m.decisions?m.invocations/m.decisions:0,skipRate:m.decisions?m.skips/m.decisions:0,abstentionRate:m.decisions?m.abstentions/m.decisions:0,averageLatencyMs:m.decisions?m.totalLatencyMs/m.decisions:0,averageDecisionPayloadBytes:m.providerCalls?m.totalPayloadBytes/m.providerCalls:0});}
  #fromGate(request,gate,fingerprint,started){
    if(gate.route===JevGateRoute.SKIP_JEV){this.#metrics.skips++;const d=gate.deterministicAnswer??{outcome:JevOutcome.UNRESOLVED,decisionCode:JevDecisionShape.UNRESOLVED,selectedOptionIds:[],rejectedOptionIds:gate.prefilter.rejectedOptionIds,evidenceUsed:[],confidence:0};return this.#receipt(request,{...d,serviceStatus:JevServiceStatus.JEV_SKIPPED,reasonCodes:[...gate.reasonCodes,...(d.reasonCodes??[])],requestFingerprint:fingerprint},started);}
    if(gate.route===JevGateRoute.REQUEST_OPERATOR){this.#metrics.operator++;return this.#receipt(request,{outcome:JevOutcome.REQUEST_OPERATOR,serviceStatus:JevServiceStatus.JEV_OPERATOR,decisionCode:JevDecisionShape.REQUEST_OPERATOR,reasonCodes:gate.reasonCodes,requiresOperator:true,escalationTarget:JevEscalationTarget.OPERATOR,requestFingerprint:fingerprint},started);}
    if(gate.route===JevGateRoute.ESCALATE){this.#metrics.escalations++;return this.#receipt(request,{outcome:JevOutcome.ESCALATE_OWNER,serviceStatus:JevServiceStatus.JEV_ESCALATED,decisionCode:JevDecisionShape.ESCALATE,reasonCodes:gate.reasonCodes,escalationTarget:JevEscalationTarget.OWNER,requestFingerprint:fingerprint},started);}
    this.#metrics.abstentions++;const outcome=gate.deterministicOutcome??JevOutcome.ABSTAINED;return this.#receipt(request,{outcome,serviceStatus:gate.serviceStatus??JevServiceStatus.JEV_ABSTAINED,decisionCode:outcome===JevOutcome.STALE?'STALE':outcome===JevOutcome.UNRESOLVED?JevDecisionShape.UNRESOLVED:JevDecisionShape.ABSTAIN,reasonCodes:gate.reasonCodes,abstained:outcome===JevOutcome.ABSTAINED,requestFingerprint:fingerprint},started);
  }
  #receipt(request,input,started){const total=Math.max(0,Date.now()-started);const receipt=createJevDecisionReceipt({...input,latencyMetadata:{...(input.latencyMetadata??{}),totalLatencyMs:Math.max(total,Number(input.latencyMetadata?.totalLatencyMs??0))}},request);this.#metrics.totalLatencyMs+=receipt.latencyMetadata.totalLatencyMs;return receipt;}
  #remember(key,receipt){
    this.#replay.delete(key);this.#replay.set(key,receipt);
    while(this.#replay.size>this.replayLimit)this.#replay.delete(this.#replay.keys().next().value);
    return receipt;
  }
}

function jevProfileSupportsTask(profile,task){const caps=new Set(profile.capabilities??[]);return (task.requiredCapabilities??[]).every(cap=>caps.has(cap))&&(profile.supportedLayers??[]).includes(task.cognitiveLayer)&&(profile.placements??[]).includes(task.placement)&&profile.available!==false;}
function validateShape({request,outcome,decisionCode,selected,evidenceUsed,abstained,requiresOperator}){
  if(outcome===JevOutcome.DECIDED||outcome===JevOutcome.PARTIAL){
    if(decisionCode===JevDecisionShape.REJECT_ALL){if(selected.length)fail(FailureCode.SCHEMA_INVALID,'REJECT_ALL cannot select options');}
    else if(decisionCode===JevDecisionShape.CHOOSE_ONE||request.decisionShape===JevDecisionShape.CHOOSE_ONE||request.decisionShape===JevDecisionShape.CLASSIFY_RELATIONSHIP){if(selected.length!==1)fail(FailureCode.SCHEMA_INVALID,'CHOOSE_ONE/classification requires exactly one selected option');}
    else if([JevDecisionShape.CHOOSE_SUBSET,JevDecisionShape.PRESERVE_MULTIPLE,JevDecisionShape.RANK_BOUNDED_OPTIONS].includes(decisionCode)&&selected.length<1)fail(FailureCode.SCHEMA_INVALID,`${decisionCode} requires selected options`);
    const selectedRows=request.options.filter(x=>selected.includes(x.optionId));const requiresEvidence=selectedRows.some(x=>x.requiresEvidence&&x.evidenceRefs.length);if(requiresEvidence&&!evidenceUsed.length)fail(FailureCode.SCHEMA_INVALID,'evidence-backed decision must cite evidenceUsed');
  }
  if(outcome===JevOutcome.ABSTAINED&&(!abstained||selected.length))fail(FailureCode.SCHEMA_INVALID,'ABSTAINED must abstain with no selected options');
  if(outcome===JevOutcome.UNRESOLVED&&selected.length&&decisionCode!==JevDecisionShape.PRESERVE_MULTIPLE)fail(FailureCode.SCHEMA_INVALID,'UNRESOLVED may select only when preserving multiple alternatives');
  if(outcome===JevOutcome.REQUEST_OPERATOR&&!requiresOperator)fail(FailureCode.SCHEMA_INVALID,'REQUEST_OPERATOR must set requiresOperator');
  if(!request.allowedOutcomes.includes(decisionCode)&&![JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN,JevDecisionShape.ESCALATE,JevDecisionShape.REQUEST_OPERATOR].includes(decisionCode))fail(FailureCode.SCHEMA_INVALID,`decisionCode not allowed by request: ${decisionCode}`);
}
function parseStrictObject(raw){if(raw&&typeof raw==='object')return raw;if(typeof raw!=='string')fail(FailureCode.MALFORMED_OUTPUT,'Jev provider output must be object/JSON string');let value;try{value=JSON.parse(raw);}catch{fail(FailureCode.MALFORMED_OUTPUT,'Jev provider output is not valid JSON');}if(!value||typeof value!=='object'||Array.isArray(value))fail(FailureCode.SCHEMA_INVALID,'Jev provider output must be an object');return value;}
function exactKeys(value,keys){const actual=Object.keys(value).sort(),expected=[...keys].sort();if(actual.length!==expected.length||actual.some((x,i)=>x!==expected[i]))fail(FailureCode.SCHEMA_INVALID,`Jev provider output keys must be exactly: ${keys.join(', ')}`);}
function stringArray(value,name,max=128,maxLength=240){if(!Array.isArray(value)||value.length>max)fail(FailureCode.SCHEMA_INVALID,`${name} must be an array with at most ${max} items`);const out=[];for(const item of value){if(typeof item!=='string'||!item.trim()||item.length>maxLength)fail(FailureCode.SCHEMA_INVALID,`${name} contains invalid string`);if(!out.includes(item.trim()))out.push(item.trim());}return out;}
function requiredEnum(value,values,name){if(!values.includes(value))fail(FailureCode.SCHEMA_INVALID,`${name} is invalid: ${value}`);return value;}
function req(value,name){if(typeof value!=='string'||!value.trim())fail(FailureCode.SCHEMA_INVALID,`${name} must be a non-empty string`);return value.trim();}
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function retryable(error){return [FailureCode.MALFORMED_OUTPUT,FailureCode.SCHEMA_INVALID,FailureCode.SCHEMA_VALIDATION_FAILED,FailureCode.PROVIDER_FAILURE,FailureCode.PROVIDER_TIMEOUT].includes(error?.code);}
function statusFromDecision(d){if(d.outcome===JevOutcome.DECIDED)return JevServiceStatus.JEV_DECIDED;if(d.outcome===JevOutcome.PARTIAL)return JevServiceStatus.JEV_PARTIAL;if(d.outcome===JevOutcome.UNRESOLVED)return JevServiceStatus.JEV_UNRESOLVED;if(d.outcome===JevOutcome.ABSTAINED)return JevServiceStatus.JEV_ABSTAINED;if(d.outcome===JevOutcome.REQUEST_OPERATOR)return JevServiceStatus.JEV_OPERATOR;if(d.outcome===JevOutcome.ESCALATE_OWNER)return JevServiceStatus.JEV_ESCALATED;return JevServiceStatus.JEV_INVALID;}
async function resolveValue(value,fallback){if(typeof value==='function')return await value();return value??fallback;}
function positiveReplayLimit(value){const n=Number(value);if(!Number.isInteger(n)||n<1)throw new TypeError('replayLimit must be a positive integer');return n;}