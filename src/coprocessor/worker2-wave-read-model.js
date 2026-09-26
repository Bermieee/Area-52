import { TelemetryEvent } from './constants.js';

export const WORKER2_WAVE_READ_MODEL_VERSION='1.0.0';

const EXECUTION_KINDS=Object.freeze(['SIDECAR','JEV','VECTORING']);

export function projectWorker2WaveTelemetry({
  selection={},events=[],resources=[],ownerReceipts=[],maxEvents=256,
}={}){
  const selected={
    chatId:nullable(selection.chatId),
    turnId:nullable(selection.turnId),
    generationId:nullable(selection.generationId),
    correlationId:nullable(selection.correlationId),
  };
  const bounded=Math.max(16,Math.min(1024,Number(maxEvents)||256));
  const filtered=(Array.isArray(events)?events:[]).filter(event=>matches(event?.payload??{},selected)).slice(-bounded);
  const lifecycle=Object.fromEntries(EXECUTION_KINDS.map(kind=>[kind,{configured:0,qualified:0,physicalAttempts:0,returned:0,ownerAccepted:0,skipped:0,failed:0}]));
  const resourceRows=Array.isArray(resources)?resources:(resources?.resources??[]);
  for(const row of resourceRows){
    for(const kind of resourceKinds(row)){
      lifecycle[kind].configured+=1;
      if(row?.selectedModelQualified||row?.qualification?.qualified)lifecycle[kind].qualified+=1;
    }
  }
  const waves=[];
  for(const event of filtered){
    const p=event.payload??{};
    if(event.type===TelemetryEvent.RESOURCE_EXECUTION_ATTEMPT){
      const kind=normalizeKind(p.executionKind);if(kind)lifecycle[kind].physicalAttempts+=1;
    }
    if(event.type===TelemetryEvent.RESOURCE_EXECUTION){
      const kind=normalizeKind(p.executionKind??kindFromTaskType(p.taskType));
      if(kind){
        if(p.status==='SUCCESS')lifecycle[kind].returned+=1;
        else if(p.status==='FAIL')lifecycle[kind].failed+=1;
      }
    }
    if(event.type===TelemetryEvent.SCATTER_TASK_STATE&&p.decision==='SKIP'){
      const kind=normalizeKind(p.executionKind??'SIDECAR');if(kind)lifecycle[kind].skipped+=1;
    }
    if(event.type===TelemetryEvent.SCATTER_LAYER){
      waves.push(freeze({
        phase:nullable(p.phase),trigger:nullable(p.trigger),layer:nullable(p.layer),taskId:nullable(p.taskId),
        chatId:nullable(p.chatId),turnId:nullable(p.turnId),generationId:nullable(p.generationId),
        correlationId:nullable(p.correlationId),parentReceiptId:nullable(p.parentReceiptId),
        admitted:Number(p.admitted??0),skipped:Number(p.skipped??0),deferred:Number(p.deferred??0),
        reason:nullable(p.reason),queueDepth:finite(p.queueDepth),concurrency:finite(p.concurrency),
        durationMs:finite(p.durationMs),fallback:Boolean(p.fallback),costClass:nullable(p.costClass),
        physicalAttempts:Number(p.physicalAttempts??0),retainedBytes:finite(p.retainedBytes),
      }));
    }
  }
  for(const receipt of normalizeReceipts(ownerReceipts)){
    if(!matches(receipt,selected))continue;
    for(const row of receipt.admissions??[]){
      if(!row?.acceptedByOwner)continue;
      const kind=normalizeKind(row.executionKind??kindFromTaskType(row.taskType)??'SIDECAR');
      if(kind)lifecycle[kind].ownerAccepted+=1;
    }
    if(receipt.kind==='JevOwnerAdmissionReceipt'&&receipt.accepted)lifecycle.JEV.ownerAccepted+=1;
  }
  return freeze({
    kind:'Worker2WaveTelemetryReadModel',contractVersion:WORKER2_WAVE_READ_MODEL_VERSION,
    selection:selected,lifecycle:Object.fromEntries(Object.entries(lifecycle).map(([k,v])=>[k,freeze({...v})])),
    waves:Object.freeze(waves.slice(-bounded)),
    eventCount:filtered.length,
    rawPromptIncluded:false,storyBodyIncluded:false,loreBodyIncluded:false,credentialIncluded:false,hiddenReasoningIncluded:false,
    authority:{mutation:false,truth:false,settlement:false,contextSeal:false,finalChoice:false},
  });
}

export function createWorker2WaveTelemetryReader({telemetry=null,resourceConnections=null,ownerReceipts=null,maxEvents=256}={}){
  const readOwners=typeof ownerReceipts==='function'?ownerReceipts:()=>ownerReceipts??[];
  return freeze({
    kind:'Worker2WaveTelemetryReader',contractVersion:WORKER2_WAVE_READ_MODEL_VERSION,
    read(selection={}){
      return projectWorker2WaveTelemetry({
        selection,
        events:telemetry?.list?.({limit:maxEvents})??[],
        resources:resourceConnections?.listResources?.()??resourceConnections?.readModel?.()?.resources??[],
        ownerReceipts:readOwners(selection)??[],
        maxEvents,
      });
    },
    authority:{mutation:false,truth:false,settlement:false,contextSeal:false,finalChoice:false},
  });
}

function resourceKinds(row){
  if(row?.configured===false)return[];
  const caps=new Set(row?.activeCapabilities??row?.qualifiedCapabilities??row?.capabilities??[]);
  const kinds=[];
  if(caps.has('EMBED'))kinds.push('VECTORING');
  if(caps.has('SEMANTIC_JUDGMENT'))kinds.push('JEV');
  if([...caps].some(cap=>cap!=='EMBED')||!caps.size)kinds.push('SIDECAR');
  return[...new Set(kinds)];
}
function kindFromTaskType(value){
  const type=String(value??'').toUpperCase();
  if(type==='JEV_DECISION')return 'JEV';
  if(type==='EMBEDDING')return 'VECTORING';
  return type?'SIDECAR':null;
}
function normalizeKind(value){const kind=String(value??'').toUpperCase();return EXECUTION_KINDS.includes(kind)?kind:null;}
function normalizeReceipts(value){return(Array.isArray(value)?value:[value]).filter(Boolean);}
function matches(payload,selection){
  for(const key of ['chatId','turnId','generationId','correlationId']){
    if(selection[key]!=null&&payload?.[key]!=null&&String(payload[key])!==String(selection[key]))return false;
  }
  return true;
}
function nullable(value){return value==null?null:String(value);}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
