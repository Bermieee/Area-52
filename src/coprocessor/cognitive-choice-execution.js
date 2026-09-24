import { sha256Hex } from './browser-compat.js';
import { TelemetryEvent } from './constants.js';
import { emitTelemetry } from './telemetry.js';
import { CoprocessorChoiceDisposition, COPROCESSOR_CHOICE_VERSION } from './cognitive-choice-proposal.js';

export const CoprocessorChoiceExecutionState=Object.freeze({
  NOT_ADMITTED:'NOT_ADMITTED',RUNTIME_ADMITTED:'RUNTIME_ADMITTED',STARTED:'STARTED',COMPLETED:'COMPLETED',
  SKIPPED:'SKIPPED',DEFERRED:'DEFERRED',UNAVAILABLE:'UNAVAILABLE',ABORTED:'ABORTED',TIMED_OUT:'TIMED_OUT',
  FAILED:'FAILED',STALE:'STALE',INVALID:'INVALID',LATE:'LATE',
});

export function createCoprocessorChoiceExecutionTrace({proposal,runtimeRecords=[],swarmTraces=[],resultRoutes=[],providerExecutions=[],jevObservation=null,warmObservation=null,telemetry=null,maxReceiptBytes=32768}={}){
  if(proposal?.kind!=='CoprocessorChoiceProposal')throw new TypeError('CoprocessorChoiceProposal required');
  const runtime=byIdentity(runtimeRecords),swarm=byIdentity(swarmTraces),provider=byIdentity(providerExecutions),routes=routesByIdentity(resultRoutes);
  const facts=proposal.options.map(option=>fact(option,{
    runtime:lookup(runtime,option),swarm:lookup(swarm,option),provider:lookup(provider,option),routes:lookup(routes,option)??[],
  }));
  const executionCounts=counts(facts);
  const trace=freeze({
    kind:'CoprocessorChoiceExecutionTrace',contractVersion:COPROCESSOR_CHOICE_VERSION,
    traceId:'cop-exec:'+sha256Hex(stable({proposalId:proposal.proposalId,facts:facts.map(x=>[x.optionId,x.state,x.executionResourceId,x.failureCode])})).slice(0,24),
    proposalId:proposal.proposalId,turnId:proposal.turnId,correlationId:proposal.correlationId,revisionFence:clone(proposal.revisionFence),
    facts:freeze(facts),counts:executionCounts,jev:normalizeJev(jevObservation,proposal.jev),warm:normalizeWarm(warmObservation,proposal.warmHint),
    degraded:facts.some(x=>['FAILED','TIMED_OUT','ABORTED','UNAVAILABLE','STALE','INVALID','LATE'].includes(x.state)),
    authority:'NONE',finalChoiceAuthority:false,truthAuthority:false,settlementAuthority:false,contextSealAuthority:false,
  });
  if(new TextEncoder().encode(JSON.stringify(trace)).length>Number(maxReceiptBytes))throw new RangeError('execution trace exceeds byte budget');
  emitTelemetry(telemetry,TelemetryEvent.CHOICE_EXECUTION,{traceId:trace.traceId,proposalId:trace.proposalId,turnId:trace.turnId,...executionCounts});
  if(trace.degraded)emitTelemetry(telemetry,TelemetryEvent.CHOICE_DEGRADED,{traceId:trace.traceId,turnId:trace.turnId,degraded:facts.filter(x=>x.degradedReasonCodes.length).length});
  return trace;
}

export function toCoreCognitiveChoiceContribution({proposal,executionTrace=null}={}){
  if(proposal?.kind!=='CoprocessorChoiceProposal')throw new TypeError('proposal required');
  if(executionTrace&&executionTrace.kind!=='CoprocessorChoiceExecutionTrace')throw new TypeError('execution trace invalid');
  return freeze({
    kind:'CoprocessorChoiceContribution',contractVersion:COPROCESSOR_CHOICE_VERSION,proposalId:proposal.proposalId,executionTraceId:executionTrace?.traceId??null,
    turnId:proposal.turnId,correlationId:proposal.correlationId,policyVersion:proposal.policyVersion,revisions:clone(proposal.revisionFence),
    consideredOptions:proposal.options.map(o=>({optionId:o.optionId,logicalCapability:o.logicalCapability,disposition:o.disposition,reasonCodes:[...o.reasonCodes],expectedValue:o.expectedValue,
      requiredCapabilities:[...o.requiredCapabilities],deadlineClass:o.deadlineClass,taskId:o.taskId,estimatedLatency:clone(o.estimatedLatency),estimatedCost:clone(o.estimatedCost)})),
    executionFacts:executionTrace?.facts.map(x=>({optionId:x.optionId,taskId:x.taskId,state:x.state,executionResourceId:x.executionResourceId,providerProfileId:x.providerProfileId,
      failureCode:x.failureCode,fallbackUsed:x.fallbackUsed,late:x.late,stale:x.stale,invalid:x.invalid}))??[],
    proposalCounts:clone(proposal.counts),executionCounts:executionTrace?clone(executionTrace.counts):null,ownerStageRequests:clone(proposal.ownerStageRequests),
    jev:clone(executionTrace?.jev??proposal.jev),warmHint:clone(executionTrace?.warm??proposal.warmHint),
    coreMustCombineWith:freeze(['RETRIEVAL_QUALITY_RECEIPT','CANDIDATE_BUS_FUSION_RECEIPT','TRUTH_ASSESSMENT','CORRECTIVE_RETRIEVAL_RECEIPT','PRECISION_RECEIPT','GATHER_RECEIPT','CONTEXT_SEAL_RECEIPT']),
    cognitiveChoiceReceipt:null,truthClass:null,precisionDecision:null,finalEvidenceRefs:null,correctiveExecutionAuthority:false,
    finalChoiceAuthority:false,admissionAuthority:false,truthAuthority:false,precisionAuthority:false,settlementAuthority:false,contextSealAuthority:false,
  });
}

function fact(option,{runtime,swarm,provider,routes}){
  let state,failureCode=swarm?.failureCode??provider?.failureCode??runtime?.failureCode??null;
  const late=routes.some(x=>x?.route?.late===true||x?.late===true),stale=routes.some(x=>String(x?.route?.freshness??x?.freshness??'').toUpperCase()==='STALE'),
    invalid=routes.some(x=>String(x?.route?.freshness??x?.freshness??'').toUpperCase()==='INVALID');
  const es=String(runtime?.executionStatus??'').toUpperCase(),ls=String(runtime?.lifecycleStatus??'').toUpperCase(),reason=String(runtime?.executionReason??swarm?.reason??'').toUpperCase();
  const degraded=[];
  if(late){state=CoprocessorChoiceExecutionState.LATE;degraded.push('LATE_RESULT');}
  else if(invalid){state=CoprocessorChoiceExecutionState.INVALID;degraded.push('INVALID_RESULT');}
  else if(stale||ls==='SUPERSEDED'){state=CoprocessorChoiceExecutionState.STALE;degraded.push('STALE_RESULT');}
  else if(['PROVIDER_TIMEOUT','DEADLINE_MISS','DEADLINE_EXPIRED'].includes(failureCode)||/TIMEOUT|DEADLINE/.test(reason)){state=CoprocessorChoiceExecutionState.TIMED_OUT;degraded.push('PROVIDER_TIMEOUT');}
  else if(failureCode==='PROVIDER_ABORTED'||ls==='CANCELLED'||/ABORT|CANCEL/.test(reason)){state=CoprocessorChoiceExecutionState.ABORTED;degraded.push('PROVIDER_ABORTED');}
  else if(failureCode||es==='FAILED'||swarm?.validation==='FAIL'){state=CoprocessorChoiceExecutionState.FAILED;degraded.push('PROVIDER_FAILED');}
  else if(swarm?.completedAt!=null||provider?.completedAt!=null||es==='COMPLETE')state=CoprocessorChoiceExecutionState.COMPLETED;
  else if(swarm?.startedAt!=null||provider?.startedAt!=null||es==='ACTIVE')state=CoprocessorChoiceExecutionState.STARTED;
  else if(['PARKED','YIELDING','RECOVERING'].includes(es)){state=CoprocessorChoiceExecutionState.DEFERRED;degraded.push('RUNTIME_DEFERRED');}
  else if(es==='QUEUED'||ls==='ELIGIBLE')state=CoprocessorChoiceExecutionState.RUNTIME_ADMITTED;
  else if(option.disposition===CoprocessorChoiceDisposition.SKIPPED)state=CoprocessorChoiceExecutionState.SKIPPED;
  else if(option.disposition===CoprocessorChoiceDisposition.DEFERRED)state=CoprocessorChoiceExecutionState.DEFERRED;
  else if(option.disposition===CoprocessorChoiceDisposition.UNAVAILABLE)state=CoprocessorChoiceExecutionState.UNAVAILABLE;
  else{state=CoprocessorChoiceExecutionState.NOT_ADMITTED;degraded.push('RUNTIME_NOT_OBSERVED');}
  const fallbackUsed=Boolean(swarm?.fallbackUsed||provider?.fallbackUsed||runtime?.fallbackUsed);if(fallbackUsed)degraded.push('FALLBACK_USED');
  const started=numberOrNull(swarm?.startedAt??provider?.startedAt??runtime?.startedAt),completed=numberOrNull(swarm?.completedAt??provider?.completedAt??runtime?.completedAt);
  return freeze({
    kind:'CoprocessorChoiceExecutionFact',optionId:option.optionId,logicalCapability:option.logicalCapability,taskId:option.taskId,proposalDisposition:option.disposition,state,
    executionResourceId:valueOrNull(swarm?.workerId??provider?.workerId??runtime?.workerId??runtime?.negotiation?.selectedWorkerId??runtime?.negotiation?.workerId),
    providerProfileId:valueOrNull(swarm?.providerId??provider?.providerProfileId??provider?.providerId??runtime?.providerProfileId),
    startedAt:started,completedAt:completed,latencyMs:numberOrNull(swarm?.latencyMs??provider?.latencyMs??((started!=null&&completed!=null)?completed-started:null)),
    failureCode:valueOrNull(failureCode),fallbackUsed,late,stale,invalid,degradedReasonCodes:freeze([...new Set(degraded)]),
    resultRef:valueOrNull(provider?.resultId??swarm?.resultId??routes.find(x=>x?.result?.id)?.result?.id),authority:'NONE',
  });
}
function normalizeJev(o,p){if(!o)return freeze({...clone(p),ran:false,status:p?.disposition==='UNAVAILABLE'?'UNAVAILABLE':p?.disposition==='SKIPPED'?'SKIPPED':'NOT_OBSERVED',abstained:false,unresolved:false,stale:false,late:false,measuredContribution:null,settlementAuthority:false});
  const status=String(o.status??'UNKNOWN');return freeze({...clone(p),ran:Boolean(o.ran??!['SKIPPED','UNAVAILABLE','NOT_OBSERVED'].includes(status)),status,abstained:Boolean(o.abstained||status==='ABSTAINED'),
    unresolved:Boolean(o.unresolved||status==='UNRESOLVED'),stale:Boolean(o.stale||status==='STALE'),late:Boolean(o.late||status==='LATE'),providerProfileId:valueOrNull(o.providerProfileId),
    decisionRef:valueOrNull(o.decisionRef),latencyMs:numberOrNull(o.latencyMs),measuredContribution:o.measuredContribution?freeze({baselineOutcome:valueOrNull(o.measuredContribution.baselineOutcome),
      optionalOutcome:valueOrNull(o.measuredContribution.optionalOutcome),changedDecision:Boolean(o.measuredContribution.changedDecision),measurementClass:String(o.measuredContribution.measurementClass??'NOT_MEASURED')}):null,settlementAuthority:false});}
function normalizeWarm(o,p){if(!o)return freeze({...clone(p),coreRevalidated:false,countedUseful:false});const valid=o.coreRevalidated===true;return freeze({...clone(p),freshness:o.freshness??p?.freshness??null,
  coreRevalidated:valid,countedUseful:valid&&o.countedUseful===true,preparationCostMs:numberOrNull(o.preparationCostMs),sendLatencySavedMs:numberOrNull(o.sendLatencySavedMs),measurementClass:valueOrNull(o.measurementClass)});}
function identities(row){return [...new Set([row?.taskId,row?.task?.taskId,row?.obligation?.taskId,row?.optionId,row?.choiceOptionId,row?.metadata?.choiceOptionId,row?.result?.taskId,row?.result?.optionId,row?.result?.choiceOptionId].filter(Boolean).map(String))];}
function byIdentity(rows){const m=new Map();for(const r of rows??[])for(const id of identities(r))m.set(id,r);return m;}
function routesByIdentity(rows){const m=new Map();for(const r of rows??[])for(const id of identities(r)){const a=m.get(id)??[];a.push(r);m.set(id,a);}return m;}
function lookup(map,option){if(option.taskId&&map.has(String(option.taskId)))return map.get(String(option.taskId));return map.get(String(option.optionId));}
function counts(facts){const out=Object.fromEntries(Object.values(CoprocessorChoiceExecutionState).map(x=>[x,0]));for(const x of facts)out[x.state]++;return freeze(out);}
function valueOrNull(v){return v==null?null:String(v);}function numberOrNull(v){if(v==null)return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function stable(v){if(Array.isArray(v))return'['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function clone(v){return v==null?v:structuredClone(v);}function freeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const x of Object.values(v))freeze(x);return v;}
