import { sha256Hex } from './browser-compat.js';
import { Capability, ResultClass, TelemetryEvent } from './constants.js';
import { emitTelemetry } from './telemetry.js';
import { historianUrgency } from './historian-retrieval.js';

export const COPROCESSOR_CHOICE_VERSION='1.0.0';
export const CoprocessorChoiceDisposition=Object.freeze({NOMINATED:'NOMINATED',SKIPPED:'SKIPPED',DEFERRED:'DEFERRED',UNAVAILABLE:'UNAVAILABLE'});
export const CoprocessorChoiceReason=Object.freeze({
  HOT_STATE_SUFFICIENT:'HOT_STATE_SUFFICIENT',NO_EXPECTED_VALUE:'NO_EXPECTED_VALUE',BELOW_THRESHOLD:'BELOW_EXPECTED_VALUE_THRESHOLD',
  CAPABILITY_ABSENT:'CAPABILITY_ABSENT',PROVIDER_UNAVAILABLE:'PROVIDER_UNAVAILABLE',PROVIDER_UNHEALTHY:'PROVIDER_UNHEALTHY',PROVIDER_OVERLOADED:'PROVIDER_OVERLOADED',
  BUDGET_LIMIT:'BUDGET_LIMIT',FANOUT_LIMIT:'FANOUT_LIMIT',OWNER_STAGE_REQUIRED:'OWNER_STAGE_REQUIRED',
  CORE_CORRECTIVE_REQUEST:'CORE_CORRECTIVE_REQUEST',CORRECTION_NOT_REQUESTED:'CORRECTION_NOT_REQUESTED',CORRECTION_LIMIT_REACHED:'CORRECTION_LIMIT_REACHED',
  JEV_BOUNDED_AMBIGUITY:'JEV_BOUNDED_AMBIGUITY',JEV_DETERMINISTIC_SUFFICIENT:'JEV_DETERMINISTIC_SUFFICIENT',JEV_ABSTAINED:'JEV_ABSTAINED',
  JEV_OWNER_ESCALATION:'JEV_OWNER_ESCALATION',JEV_QUESTION_MISSING:'JEV_QUESTION_MISSING',
  EXTERNAL_POLICY_DISABLED:'EXTERNAL_POLICY_DISABLED',EXTERNAL_NOT_NEEDED:'EXTERNAL_GROUNDING_NOT_NEEDED',EXTERNAL_ALLOWED:'EXTERNAL_GROUNDING_ALLOWED',
  WARM_FRESH_HINT:'WARM_FRESH_HINT',WARM_PARTIAL_HINT:'WARM_PARTIAL_HINT',WARM_STALE_OR_MISS:'WARM_STALE_OR_MISS',
});
export const DEFAULT_COPROCESSOR_CHOICE_LIMITS=Object.freeze({maxOptions:32,maxEvidenceRefs:64,maxReasons:16,maxReceiptBytes:32768,maxHistory:128});

const ADVISORY=Object.freeze([
  Object.freeze({optionId:'corrective-retrieval',taskType:'CORRECTIVE_RETRIEVAL',logicalCapability:'CORRECTIVE_RETRIEVAL',requiredCapabilities:[Capability.RETRIEVAL],resultClass:ResultClass.REQUIRED,costUnits:1,latencyClass:'LOW',ownerGate:'CORE_RETRIEVAL_QUALITY'}),
  Object.freeze({optionId:'jev-adjudication',taskType:'JEV_ADJUDICATION',logicalCapability:'BOUNDED_JEV_ADJUDICATION',requiredCapabilities:[Capability.DEEP_REASONING],resultClass:ResultClass.OPPORTUNISTIC,costUnits:2,latencyClass:'MEDIUM',ownerGate:'CORE_TRUTH_AMBIGUITY'}),
  Object.freeze({optionId:'external-grounding',taskType:'EXTERNAL_GROUNDING',logicalCapability:'EXTERNAL_GROUNDING',requiredCapabilities:[Capability.EXTERNAL_GROUNDING],resultClass:ResultClass.OPPORTUNISTIC,costUnits:2,latencyClass:'HIGH',ownerGate:'CORE_POLICY'}),
]);
const LATENCY=Object.freeze({ULTRA_LOW:10,LOW:25,MEDIUM:100,HIGH:300});

export function createCoprocessorChoiceOption(input={},limits={}){
  const cap={...DEFAULT_COPROCESSOR_CHOICE_LIMITS,...limits};
  const disposition=String(input.disposition??'');if(!Object.values(CoprocessorChoiceDisposition).includes(disposition))throw new TypeError('unsupported choice disposition');
  return freeze({
    kind:'CoprocessorChoiceOption',contractVersion:COPROCESSOR_CHOICE_VERSION,
    optionId:req(input.optionId,'optionId'),roleId:req(input.roleId??input.optionId,'roleId'),taskType:req(input.taskType??input.optionId,'taskType'),
    logicalCapability:req(input.logicalCapability??input.taskType??input.optionId,'logicalCapability'),
    requiredCapabilities:strings(input.requiredCapabilities??[],16,'requiredCapabilities'),registeredProfileIds:strings(input.registeredProfileIds??[],32,'registeredProfileIds'),
    eligibleProfileIds:strings(input.eligibleProfileIds??[],32,'eligibleProfileIds'),inputEvidenceRefs:strings(input.inputEvidenceRefs??[],cap.maxEvidenceRefs,'inputEvidenceRefs'),
    revisionFence:fence(input.revisionFence),expectedValue:unit(input.expectedValue??0),estimatedLatency:latency(input.estimatedLatency,input.latencyClass),
    estimatedCost:freeze({units:nonneg(input.estimatedCost?.units??0),class:String(input.estimatedCost?.class??'MEDIUM'),measurement:'ESTIMATE'}),
    deadlineClass:String(input.deadlineClass??deadline(input.resultClass)),resultClass:String(input.resultClass??ResultClass.OPPORTUNISTIC),
    disposition,reasonCodes:strings(input.reasonCodes??[],cap.maxReasons,'reasonCodes'),taskId:opt(input.taskId),ownerGate:opt(input.ownerGate),
    ownerActionRequired:Boolean(input.ownerActionRequired),physicalExecutionHint:String(input.physicalExecutionHint??'NOT_SCHEDULED'),fallback:clone(input.fallback??null),
    metadata:safeMeta(input.metadata),authority:'NONE',admissionAuthority:false,truthAuthority:false,settlementAuthority:false,contextSealAuthority:false,
  });
}

export function createCoprocessorChoiceProposal(input={},limits={}){
  const cap={...DEFAULT_COPROCESSOR_CHOICE_LIMITS,...limits};
  if(!Array.isArray(input.options)||input.options.length>cap.maxOptions)throw new RangeError('choice option budget exceeded');
  const options=input.options.map(x=>x?.kind==='CoprocessorChoiceOption'?freeze(clone(x)):createCoprocessorChoiceOption(x,cap));
  const semantic={turnId:req(input.turnId,'turnId'),correlationId:req(input.correlationId,'correlationId'),policyVersion:req(input.policyVersion??'sidecar-choice-v1','policyVersion'),
    revisionFence:fence(input.revisionFence),queryIntent:input.queryIntent??null,warmFreshness:input.warmFreshness??null,resourceCount:posint(input.resourceCount??1),
    options:options.map(x=>[x.optionId,x.disposition,x.reasonCodes,x.expectedValue,x.eligibleProfileIds,x.taskId])};
  const proposal=freeze({
    kind:'CoprocessorChoiceProposal',contractVersion:COPROCESSOR_CHOICE_VERSION,proposalId:input.proposalId??'cop-choice:'+sha256Hex(stable(semantic)).slice(0,24),
    ...semantic,hotStateSufficient:Boolean(input.hotStateSufficient),resourceMode:semantic.resourceCount===1?'SERIAL_RESOURCE':'MULTI_RESOURCE',
    options:freeze(options),counts:counts(options),ownerStageRequests:freeze(clone(input.ownerStageRequests??{})),jev:jevSummary(input.jev),warmHint:warmHint(input.warmHint?.freshness??input.warmFreshness),
    budget:freeze(clone(input.budget??{})),measurements:freeze({estimatesOnly:true,providerMeasurementsIncluded:false,...clone(input.measurements??{})}),
    authority:'NONE',finalChoiceAuthority:false,truthAuthority:false,precisionAuthority:false,settlementAuthority:false,contextSealAuthority:false,
  });
  bytes(proposal,cap.maxReceiptBytes,'CoprocessorChoiceProposal');return proposal;
}

export function buildCoprocessorChoiceProposal({fanOutPlan,turnEvent,plannerInput={},roleCatalog=[],capabilityProfiles=[],ownerSignals={},policyVersion='sidecar-choice-v1',telemetry=null,limits={}}={}){
  if(fanOutPlan?.kind!=='FanOutPlan'||!turnEvent)throw new TypeError('FanOutPlan and turnEvent are required');
  const cap={...DEFAULT_COPROCESSOR_CHOICE_LIMITS,...limits},profiles=profilesOf(capabilityProfiles),tasks=new Map(),noms=new Map();
  for(const task of fanOutPlan.tasks??[])tasks.set(task.metadata?.roleId??roleFor(task.taskType),task);
  for(const row of fanOutPlan.nominations??[])noms.set(row.roleId,row);
  const signals=signalsOf(plannerInput),resourceCount=posint(plannerInput.resourceCount??ownerSignals.resourceCount??1);
  const revisionFence=fence({sourceRevisionSet:turnEvent.sourceRevisionSet,worldRevision:turnEvent.worldRevision,sceneRevision:turnEvent.sceneRevision,
    characterStateRevision:turnEvent.characterStateRevision,intentFingerprint:plannerInput.intentFingerprint??('intent:'+turnEvent.turnId+':'+(plannerInput.queryIntent??'AUTO')),
    policyRevision:policyVersion,providerRevision:ownerSignals.providerRevision??null});
  const options=[];
  for(const role of roleCatalog){
    if(options.length>=cap.maxOptions)break;
    const task=tasks.get(role.roleId),nom=noms.get(role.roleId),avail=availability(role,profiles,plannerInput),need=needOf(role.roleId,signals,plannerInput);
    let disposition,reasons;
    if(avail.unavailable){disposition=CoprocessorChoiceDisposition.UNAVAILABLE;reasons=avail.reasons;}
    else if(task){disposition=task.resultClass===ResultClass.DEFERRED?CoprocessorChoiceDisposition.DEFERRED:CoprocessorChoiceDisposition.NOMINATED;reasons=[...(nom?.reasonCodes??[]),...need.reasons];}
    else if(plannerInput.hotStateSufficient&&!need.required){disposition=CoprocessorChoiceDisposition.SKIPPED;reasons=[CoprocessorChoiceReason.HOT_STATE_SUFFICIENT];}
    else if(need.value<=0){disposition=CoprocessorChoiceDisposition.SKIPPED;reasons=need.reasons;}
    else if(need.value<=Number(plannerInput.expectedValueThreshold??0.65)){disposition=CoprocessorChoiceDisposition.SKIPPED;reasons=[CoprocessorChoiceReason.BELOW_THRESHOLD];}
    else if((fanOutPlan.plannedWorkerCount??0)>=Number(fanOutPlan.boundedFanOut??9999)){disposition=CoprocessorChoiceDisposition.SKIPPED;reasons=[CoprocessorChoiceReason.FANOUT_LIMIT];}
    else{disposition=CoprocessorChoiceDisposition.SKIPPED;reasons=[CoprocessorChoiceReason.BUDGET_LIMIT];}
    options.push(createCoprocessorChoiceOption({optionId:role.roleId,roleId:role.roleId,taskType:role.taskType,logicalCapability:logical(role.roleId,role.taskType),
      requiredCapabilities:role.requiredCapabilities,registeredProfileIds:avail.registered,eligibleProfileIds:avail.eligible,inputEvidenceRefs:evidence(role.roleId,plannerInput),
      revisionFence,expectedValue:nom?.expectedValue??need.value,latencyClass:role.latencyClass,estimatedLatency:estimate(role,avail),estimatedCost:{units:Number(role.costUnits??1),class:plannerInput.costBudget??'MEDIUM'},
      resultClass:task?.resultClass??role.resultClass,disposition,reasonCodes:reasons,taskId:task?.taskId,physicalExecutionHint:hint(disposition,resourceCount),
      fallback:task?.fallbackPolicy??fallback(role.roleId),metadata:{planned:Boolean(task),requiredInputs:nom?.requiredInputs??[],resourceCount}},cap));
  }
  for(const advisory of ADVISORY){
    if(options.length>=cap.maxOptions)break;
    const avail=availability({...advisory,roleId:advisory.optionId},profiles,plannerInput),d=advisoryDecision(advisory,ownerSignals,plannerInput,avail);
    options.push(createCoprocessorChoiceOption({...advisory,roleId:advisory.optionId,registeredProfileIds:avail.registered,eligibleProfileIds:avail.eligible,
      inputEvidenceRefs:evidence(advisory.optionId,plannerInput,ownerSignals),revisionFence,expectedValue:d.value,estimatedLatency:estimate(advisory,avail),
      estimatedCost:{units:advisory.costUnits,class:'MEDIUM'},disposition:d.disposition,reasonCodes:d.reasons,ownerActionRequired:true,
      physicalExecutionHint:hint(d.disposition,resourceCount),fallback:fallback(advisory.optionId),metadata:d.metadata},cap));
  }
  const proposal=createCoprocessorChoiceProposal({turnId:turnEvent.turnId,correlationId:turnEvent.correlationId,policyVersion,revisionFence,queryIntent:plannerInput.queryIntent,
    warmFreshness:plannerInput.warmState,hotStateSufficient:plannerInput.hotStateSufficient,resourceCount,options,budget:fanOutPlan.budget,jev:{...jevFrom(ownerSignals),disposition:options.find(x=>x.optionId==='jev-adjudication')?.disposition},
    ownerStageRequests:{correctiveRetrieval:isNom(options,'corrective-retrieval'),jevAdjudication:isNom(options,'jev-adjudication'),externalGrounding:isNom(options,'external-grounding')},
    measurements:{fanOutWorkerCount:fanOutPlan.plannedWorkerCount??0}},cap);
  emitTelemetry(telemetry,TelemetryEvent.CHOICE_PROPOSED,{proposalId:proposal.proposalId,turnId:proposal.turnId,correlationId:proposal.correlationId,...proposal.counts,resourceCount});
  for(const o of proposal.options)emitTelemetry(telemetry,TelemetryEvent.CHOICE_OPTION,{proposalId:proposal.proposalId,optionId:o.optionId,disposition:o.disposition,reasonCodes:o.reasonCodes,expectedValue:o.expectedValue,taskId:o.taskId});
  return proposal;
}

export class CoprocessorChoiceHistory{
  #rows=new Map();#order=[];
  constructor({maxHistory=128,maxReceiptBytes=32768}={}){this.maxHistory=posint(maxHistory);this.maxReceiptBytes=posint(maxReceiptBytes);}
  record({proposal,executionTrace=null}={}){if(proposal?.kind!=='CoprocessorChoiceProposal')throw new TypeError('proposal required');if(executionTrace&&executionTrace.proposalId!==proposal.proposalId)throw new TypeError('trace mismatch');
    const row=freeze({proposal:clone(proposal),executionTrace:clone(executionTrace)});bytes(row,this.maxReceiptBytes*2,'choice history row');if(!this.#rows.has(proposal.proposalId))this.#order.push(proposal.proposalId);this.#rows.set(proposal.proposalId,row);
    while(this.#order.length>this.maxHistory)this.#rows.delete(this.#order.shift());return clone(row);}
  get(id){return this.#rows.has(String(id))?clone(this.#rows.get(String(id))):null;}
  list({limit=this.maxHistory}={}){return this.#order.slice(-Math.max(1,Math.min(this.maxHistory,Number(limit)||this.maxHistory))).map(id=>clone(this.#rows.get(id)));}
  metrics(){return Object.freeze({size:this.#rows.size,maxHistory:this.maxHistory,maxReceiptBytes:this.maxReceiptBytes});}
}

function advisoryDecision(a,owner,input,avail){
  if(a.optionId==='corrective-retrieval'){const c=owner.correctiveRetrieval??{},attempt=Math.max(0,Number(c.attempt??0)),max=Math.max(1,Number(c.maxAttempts??1));
    if(!c.requested)return{disposition:CoprocessorChoiceDisposition.SKIPPED,value:0,reasons:[CoprocessorChoiceReason.CORRECTION_NOT_REQUESTED],metadata:{attempt,maxAttempts:max}};
    if(attempt>=max)return{disposition:CoprocessorChoiceDisposition.SKIPPED,value:0,reasons:[CoprocessorChoiceReason.CORRECTION_LIMIT_REACHED],metadata:{attempt,maxAttempts:max}};
    if(avail.unavailable)return{disposition:CoprocessorChoiceDisposition.UNAVAILABLE,value:.9,reasons:avail.reasons,metadata:{attempt,maxAttempts:max}};
    return{disposition:CoprocessorChoiceDisposition.NOMINATED,value:.9,reasons:[CoprocessorChoiceReason.CORE_CORRECTIVE_REQUEST,CoprocessorChoiceReason.OWNER_STAGE_REQUIRED],metadata:{attempt,maxAttempts:max}};}
  if(a.optionId==='jev-adjudication'){const g=owner.jevGate??{},route=String(g.route??'SKIP_JEV').toUpperCase(),q=jevQuestion(owner.jevQuestion??g.request);
    if(route==='INVOKE_JEV'){if(!q.questionId)return{disposition:CoprocessorChoiceDisposition.SKIPPED,value:0,reasons:[CoprocessorChoiceReason.JEV_QUESTION_MISSING],metadata:{route,q}};
      if(avail.unavailable)return{disposition:CoprocessorChoiceDisposition.UNAVAILABLE,value:Number(g.expectedDecisionValue??.8),reasons:[...avail.reasons,CoprocessorChoiceReason.JEV_BOUNDED_AMBIGUITY],metadata:{route,q}};
      return{disposition:CoprocessorChoiceDisposition.NOMINATED,value:Number(g.expectedDecisionValue??.8),reasons:[CoprocessorChoiceReason.JEV_BOUNDED_AMBIGUITY,CoprocessorChoiceReason.OWNER_STAGE_REQUIRED,...(g.reasonCodes??[])],metadata:{route,q}};}
    if(route==='ABSTAIN')return{disposition:CoprocessorChoiceDisposition.SKIPPED,value:0,reasons:[CoprocessorChoiceReason.JEV_ABSTAINED,...(g.reasonCodes??[])],metadata:{route,q}};
    if(route==='ESCALATE'||route==='REQUEST_OPERATOR')return{disposition:CoprocessorChoiceDisposition.SKIPPED,value:0,reasons:[CoprocessorChoiceReason.JEV_OWNER_ESCALATION,...(g.reasonCodes??[])],metadata:{route,q}};
    return{disposition:CoprocessorChoiceDisposition.SKIPPED,value:0,reasons:[CoprocessorChoiceReason.JEV_DETERMINISTIC_SUFFICIENT,...(g.reasonCodes??[])],metadata:{route,q}};}
  const allow=owner.externalGroundingPolicy==='ALLOW'||input.externalGroundingPolicy==='ALLOW',needed=owner.externalGroundingNeeded===true||input.externalGroundingNeeded===true;
  if(!allow)return{disposition:CoprocessorChoiceDisposition.SKIPPED,value:0,reasons:[CoprocessorChoiceReason.EXTERNAL_POLICY_DISABLED],metadata:{allow,needed}};
  if(!needed)return{disposition:CoprocessorChoiceDisposition.SKIPPED,value:0,reasons:[CoprocessorChoiceReason.EXTERNAL_NOT_NEEDED],metadata:{allow,needed}};
  if(avail.unavailable)return{disposition:CoprocessorChoiceDisposition.UNAVAILABLE,value:.7,reasons:avail.reasons,metadata:{allow,needed}};
  return{disposition:CoprocessorChoiceDisposition.NOMINATED,value:.7,reasons:[CoprocessorChoiceReason.EXTERNAL_ALLOWED,CoprocessorChoiceReason.OWNER_STAGE_REQUIRED],metadata:{allow,needed}};
}
function signalsOf(i){const t=String(i.text??'').toLowerCase(),physical=/\b(where|location|inventory|item|weapon|blade|find|ruin|tavern|carried|left)\b/.test(t)||['LOCATION','INVENTORY','PHYSICAL_STATE','CURRENT_STATE'].includes(i.queryIntent);
  return{physical,dialogue:/\b(speaks?|talks?|asks?|tells?|dialogue)\b/.test(t)||(i.activeCast?.length??0)>1,conflict:(i.conflictSignals?.length??0)>0||(i.uncertainSceneFields?.length??0)>0||['MIXED','LOW'].includes(i.retrievalQuality)||/\b(conflict|contradiction|ambiguous)\b/.test(t),
    transition:i.sceneTransitionType!=null&&!['CONTINUES','FALSE_BOUNDARY','REJECTED'].includes(i.sceneTransitionType),historian:historianUrgency({text:i.text??'',queryIntent:i.queryIntent,activeThreads:i.activeThreads??[],hotStateSufficient:Boolean(i.hotStateSufficient),freshWarm:i.warmState==='FRESH'||i.cacheWarmth?.historian==='FRESH',physical})};}
function needOf(id,s,i){if(id==='historian')return{required:s.historian.resultClass===ResultClass.REQUIRED,value:s.historian.wake?(s.historian.resultClass===ResultClass.REQUIRED?.94:.76):0,reasons:[s.historian.reason]};
  if(id==='graph-walker'){const n=s.physical||s.transition||(i.uncertainSceneFields??[]).some(x=>['location','immediateObjects','activeCast'].includes(x));return{required:n,value:n?.86:0,reasons:[n?'PHYSICAL_OR_SCENE_STATE_QUERY':CoprocessorChoiceReason.NO_EXPECTED_VALUE]};}
  if(id==='green-room'){const n=s.dialogue&&(i.activeCast?.length??0)>0;return{required:false,value:n?.76:0,reasons:[n?'ACTIVE_CAST_DIALOGUE':CoprocessorChoiceReason.NO_EXPECTED_VALUE]};}
  if(id==='truth-precision'){const low=i.retrievalQuality==='LOW',n=s.physical||s.conflict||i.retrievalQuality==='MIXED'||low;return{required:n,value:n?(low?.72:.9):0,reasons:[n?(low?'LOW_RETRIEVAL_REQUIRES_ABSTENTION_CHECK':'UNCERTAINTY_OR_PRECISION_REQUIRED'):CoprocessorChoiceReason.NO_EXPECTED_VALUE]};}
  if(id==='consolidation'){const n=i.backgroundSignals?.consolidationPending||Number(i.backgroundSignals?.pendingUnits??0)>0;return{required:false,value:n?Number(i.backgroundSignals?.expectedValue??.7):0,reasons:[n?'BACKGROUND_CONSOLIDATION_PENDING':CoprocessorChoiceReason.NO_EXPECTED_VALUE]};}
  const v=Number(i.expectedValue?.[id]??0);return{required:false,value:Math.max(0,Math.min(1,v)),reasons:[v>0?'EXPLICIT_EXPECTED_VALUE':CoprocessorChoiceReason.NO_EXPECTED_VALUE]};}
function availability(role,p,i){const caps=role.requiredCapabilities??[],matching=p.filter(x=>caps.every(c=>x.capabilities.includes(c))),reasons=[],explicit=i.availableCapabilities==null?null:new Set(i.availableCapabilities);
  if(explicit&&caps.some(c=>!explicit.has(c)))reasons.push(CoprocessorChoiceReason.CAPABILITY_ABSENT);if(p.length&&matching.length===0)reasons.push(CoprocessorChoiceReason.CAPABILITY_ABSENT);
  const h=String(i.providerHealth?.[role.roleId]??'').toUpperCase();if(h==='UNAVAILABLE')reasons.push(CoprocessorChoiceReason.PROVIDER_UNAVAILABLE);if(['UNHEALTHY','COOLDOWN'].includes(h))reasons.push(CoprocessorChoiceReason.PROVIDER_UNHEALTHY);
  if(h==='SATURATED'||Number(i.providerLoad?.[role.roleId]??0)>=1)reasons.push(CoprocessorChoiceReason.PROVIDER_OVERLOADED);
  const eligible=matching.filter(x=>x.available&&['HEALTHY','DEGRADED'].includes(x.health)&&x.currentLoad<x.capacity);if(matching.length&&!eligible.length){if(matching.some(x=>x.currentLoad>=x.capacity))reasons.push(CoprocessorChoiceReason.PROVIDER_OVERLOADED);if(matching.every(x=>!x.available))reasons.push(CoprocessorChoiceReason.PROVIDER_UNAVAILABLE);if(matching.some(x=>!['HEALTHY','DEGRADED'].includes(x.health)))reasons.push(CoprocessorChoiceReason.PROVIDER_UNHEALTHY);}
  return{registered:matching.map(x=>x.profileId).sort(),eligible:eligible.map(x=>x.profileId).sort(),eligibleProfiles:eligible,unavailable:[...new Set(reasons)].length>0,reasons:[...new Set(reasons)]};}
function profilesOf(v){if(!Array.isArray(v))throw new TypeError('capabilityProfiles must be array');return v.map(x=>({profileId:req(x.profileId??x.providerProfileId,'profileId'),capabilities:[...(x.capabilities??[])],
  health:String(x.providerHealth??x.health??'HEALTHY').toUpperCase(),available:x.available!==false&&String(x.availability??'AVAILABLE').toUpperCase()!=='UNAVAILABLE',currentLoad:Number(x.currentLoad??0),capacity:Math.max(1,Number(x.concurrencyCapacity??x.maxConcurrency??1)),latencyClass:String(x.latencyClass??'MEDIUM').toUpperCase()}));}
function evidence(id,i,o={}){const out=[...(i.evidenceRefs??[]),...(Array.isArray(i.inputRefs?.[id])?i.inputRefs[id]:[])];if(id==='corrective-retrieval')out.push(...(o.correctiveRetrieval?.evidenceRefs??[]));if(id==='jev-adjudication')out.push(...(o.jevQuestion?.evidenceRefs??[]));return [...new Set(out)].slice(0,64);}
function jevFrom(o){const g=o.jevGate??{};return{considered:Boolean(g.route||o.jevQuestion),gateRoute:g.route??null,reasonCodes:g.reasonCodes??[],boundedQuestion:jevQuestion(o.jevQuestion??g.request),proposalOnly:true,settlementAuthority:false};}
function jevQuestion(v){if(!v||typeof v!=='object')return{questionId:null,decisionShape:null,optionIds:[],evidenceRefs:[],questionHash:null,rawQuestionRetained:false};const raw=typeof v.query==='string'?v.query:typeof v.question==='string'?v.question:null;
  return{questionId:v.questionId??v.requestId??v.decisionId??null,decisionShape:v.decisionShape??null,optionIds:[...new Set(v.optionIds??(v.options??[]).map(x=>x.optionId).filter(Boolean))].slice(0,32),evidenceRefs:[...new Set((v.evidenceRefs??[]).map(x=>typeof x==='string'?x:x.evidenceId??x.ref).filter(Boolean))].slice(0,64),questionHash:v.questionHash??(raw?sha256Hex(raw).slice(0,24):null),rawQuestionRetained:false};}
function jevSummary(v={}){return freeze({considered:Boolean(v.considered),gateRoute:v.gateRoute??null,disposition:v.disposition??CoprocessorChoiceDisposition.SKIPPED,reasonCodes:strings(v.reasonCodes??[],16,'jev reasons'),boundedQuestion:jevQuestion(v.boundedQuestion),proposalOnly:true,settlementAuthority:false});}
function warmHint(s){const f=s??null,r=f==='FRESH'?CoprocessorChoiceReason.WARM_FRESH_HINT:f==='PARTIALLY_STALE'?CoprocessorChoiceReason.WARM_PARTIAL_HINT:CoprocessorChoiceReason.WARM_STALE_OR_MISS;return freeze({freshness:f,reasonCode:r,admissionResult:false,countedUseful:false,coreRevalidationRequired:f==='FRESH'||f==='PARTIALLY_STALE'});}
function estimate(role,a){const vals=a.eligibleProfiles.map(x=>LATENCY[x.latencyClass]).filter(Number.isFinite);return{milliseconds:vals.length?Math.min(...vals):(LATENCY[String(role.latencyClass??'MEDIUM').toUpperCase()]??100),class:String(role.latencyClass??'MEDIUM'),measurement:'ESTIMATE'};}
function latency(v={},fallback='MEDIUM'){return freeze({milliseconds:nonneg(v?.milliseconds??v?.ms??LATENCY[String(fallback??'MEDIUM').toUpperCase()]??0),class:String(v?.class??fallback??'MEDIUM'),measurement:'ESTIMATE'});}
function fence(v={}){return freeze({sourceRevisionSet:strings(v.sourceRevisionSet??v.sourceRevisionRefs??[],128,'sourceRevisionSet'),worldRevision:Number(v.worldRevision??0),sceneRevision:Number(v.sceneRevision??0),characterStateRevision:Number(v.characterStateRevision??0),
  intentFingerprint:String(v.intentFingerprint??'intent:unknown'),policyRevision:String(v.policyRevision??'1'),providerRevision:v.providerRevision??null});}
function safeMeta(v={}){const out={};for(const[k,x]of Object.entries(v).slice(0,24)){if(['prompt','rawPrompt','rawResponse','response','payload','sourceText','reasoning'].includes(k))continue;out[k]=typeof x==='string'?x.slice(0,512):clone(x);}return freeze(out);}
function counts(options){const out={NOMINATED:0,SKIPPED:0,DEFERRED:0,UNAVAILABLE:0};for(const o of options)out[o.disposition]++;return freeze(out);}
function logical(id,t){return({historian:'HISTORIAN','graph-walker':'GRAPH_WALKER','green-room':'GREEN_ROOM','truth-precision':'TRUTH_PRECISION_WORKER',consolidation:'CONSOLIDATION'})[id]??t;}
function roleFor(t){return({HISTORIAN_RETRIEVAL:'historian',GRAPH_WALK:'graph-walker',GREEN_ROOM:'green-room',TRUTH_PRECISION:'truth-precision',CONSOLIDATION:'consolidation'})[t]??String(t??'').toLowerCase();}
function hint(d,n){return[d===CoprocessorChoiceDisposition.NOMINATED,d===CoprocessorChoiceDisposition.DEFERRED].some(Boolean)?(n===1?'SERIALIZE_ON_AVAILABLE_RESOURCE':'PARALLEL_ELIGIBLE'):'NOT_SCHEDULED';}
function deadline(r){return r===ResultClass.REQUIRED?'FOREGROUND_REQUIRED':r===ResultClass.DEFERRED?'BACKGROUND_DEFERRED':'FOREGROUND_OPPORTUNISTIC';}
function fallback(id){return({historian:{type:'DETERMINISTIC_RETRIEVAL'},'graph-walker':{type:'CURRENT_STATE_LOOKUP'},'green-room':{type:'OMIT_INFERRED_SHADOW_STATE'},'truth-precision':{type:'PRESERVE_UNRESOLVED_AND_FUSED_ORDER'},consolidation:{type:'PARK_OR_RECOMPUTE'},'corrective-retrieval':{type:'PRESERVE_PRIOR_EVIDENCE'},'jev-adjudication':{type:'PRESERVE_UNRESOLVED'},'external-grounding':{type:'OMIT_EXTERNAL_GROUNDING'}})[id]??{type:'DEGRADED_CONTINUE'};}
function isNom(o,id){return o.find(x=>x.optionId===id)?.disposition===CoprocessorChoiceDisposition.NOMINATED;}
function strings(v,max,n){if(!Array.isArray(v))throw new TypeError(n+' must be array');const out=[...new Set(v.filter(x=>x!=null&&String(x).trim()).map(x=>String(x).trim()))].sort();if(out.length>max)throw new RangeError(n+' exceeds '+max);return freeze(out);}
function req(v,n){if(typeof v!=='string'||!v.trim())throw new TypeError(n+' required');return v.trim();}function opt(v){return v==null?null:String(v);}
function unit(v){const n=Number(v);if(!Number.isFinite(n)||n<0||n>1)throw new TypeError('expected value must be 0..1');return n;}function nonneg(v){const n=Number(v);if(!Number.isFinite(n)||n<0)throw new TypeError('non-negative number required');return n;}function posint(v){const n=Number(v);if(!Number.isInteger(n)||n<1)throw new TypeError('positive integer required');return n;}
function bytes(v,max,n){if(new TextEncoder().encode(JSON.stringify(v)).length>max)throw new RangeError(n+' exceeds byte budget');}
function stable(v){if(Array.isArray(v))return'['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function clone(v){return v==null?v:structuredClone(v);}function freeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const x of Object.values(v))freeze(x);return v;}
