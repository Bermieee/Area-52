import { Placement, ResultClass, TelemetryEvent } from './constants.js';

export const ScatterLayer=Object.freeze({
  HOT_EXACT:'HOT_EXACT',
  EVIDENCE_EXPANSION:'EVIDENCE_EXPANSION',
  PRECISION:'PRECISION',
  DEEP:'DEEP',
});
export const FOREGROUND_SCATTER_LAYERS=Object.freeze([
  ScatterLayer.HOT_EXACT,
  ScatterLayer.EVIDENCE_EXPANSION,
  ScatterLayer.PRECISION,
]);
export const ALL_SCATTER_LAYERS=Object.freeze([...FOREGROUND_SCATTER_LAYERS,ScatterLayer.DEEP]);

const PRECISION_ROLE_IDS=new Set(['truth-precision','jev-adjudication']);
const EVIDENCE_ROLE_IDS=new Set(['historian','graph-walker','episodic-retrieval','dense-retrieval']);
const VECTOR_CAPABILITIES=new Set(['EMBED','RETRIEVAL_QUALITY','RERANK','LATE_INTERACTION','CROSS_ENCODER_RERANK']);
const FAILURE_STATES=new Set(['FAILED','REJECTED_INVALID','REJECTED_STALE','REJECTED_LATE','UNAVAILABLE']);

export function scatterLayerForTask(task={}){
  const explicit=String(task?.metadata?.scatterLayer??'').toUpperCase();
  if(ALL_SCATTER_LAYERS.includes(explicit))return explicit;
  const role=String(task?.metadata?.roleId??'').toLowerCase();
  if(task?.resultClass===ResultClass.DEFERRED||task?.placement===Placement.DEEP)return ScatterLayer.DEEP;
  if(PRECISION_ROLE_IDS.has(role)||String(task?.taskType??'').toUpperCase().includes('PRECISION'))return ScatterLayer.PRECISION;
  if(EVIDENCE_ROLE_IDS.has(role)||['GRAPH_WALK','HISTORIAN_RETRIEVAL'].includes(String(task?.taskType??'').toUpperCase()))return ScatterLayer.EVIDENCE_EXPANSION;
  return ScatterLayer.HOT_EXACT;
}

export function scatterTriggerForTask(task={}){
  const explicit=task?.metadata?.scatterTrigger;
  if(typeof explicit==='string'&&explicit.trim())return explicit.trim();
  const reasons=Array.isArray(task?.metadata?.reasonCodes)?task.metadata.reasonCodes:[];
  return reasons.find(value=>typeof value==='string'&&value.trim())??'PLANNER_NOMINATION';
}

export function groupTasksByScatterLayer(tasks=[]){
  const grouped=Object.fromEntries(ALL_SCATTER_LAYERS.map(layer=>[layer,[]]));
  for(const task of tasks??[])grouped[scatterLayerForTask(task)].push(task);
  return grouped;
}

export function evaluateScatterAdmission(task,{priorRecords=[],minimumPrecisionExpectedValue=0.8}={}){
  const layer=scatterLayerForTask(task);
  if(layer===ScatterLayer.DEEP)return freeze({admitted:false,decision:'DEFERRED',reason:'OUTSIDE_FOREGROUND_DEADLINE',layer});
  if(layer!==ScatterLayer.PRECISION)return freeze({admitted:true,decision:'ADMITTED',reason:'LAYER_SIGNAL_SATISFIED',layer});
  const expectedValue=finite(task?.metadata?.expectedValue,0);
  if(expectedValue<minimumPrecisionExpectedValue)return freeze({admitted:false,decision:'SKIPPED',reason:'PRECISION_EXPECTED_VALUE_BELOW_THRESHOLD',layer});
  const unresolved=priorRecords.some(record=>recordCarriesUnresolved(record));
  if(!unresolved)return freeze({admitted:false,decision:'SKIPPED',reason:'PRECEDING_EVIDENCE_RESOLVED',layer});
  return freeze({admitted:true,decision:'ADMITTED',reason:'UNRESOLVED_HIGH_VALUE_CHOICE',layer});
}

export function isBoundedJevChoice(request,{maxOptions=12}={}){
  const options=Array.isArray(request?.options)?request.options:[];
  if(options.length<2||options.length>Math.max(2,Number(maxOptions)||12))return freeze({eligible:false,reason:'NOT_FINITE_AMBIGUOUS_CHOICE'});
  const routing=request?.routing??{};
  const expectedValue=finite(routing.expectedDecisionValue,0);
  const threshold=finite(routing.minimumInvocationValue,0);
  if(expectedValue<threshold)return freeze({eligible:false,reason:'JEV_VALUE_BELOW_INVOCATION_THRESHOLD'});
  return freeze({eligible:true,reason:'OWNER_REQUESTED_FINITE_AMBIGUOUS_CHOICE'});
}

export function estimateRetainedResultBytes(records=[]){
  let bytes=0;
  for(const record of records??[]){
    if(record?.result==null)continue;
    try{bytes+=new TextEncoder().encode(JSON.stringify(record.result)).length;}catch{}
  }
  return bytes;
}

export async function yieldScatterBoundary(){
  await new Promise(resolve=>setTimeout(resolve,0));
}

export function projectLayeredScatterReadModel({
  events=[],resources=[],ownerReceipts=[],selection={},maxWaves=64,maxTasks=256,
}={}){
  const selected=normalizeSelection(selection);
  const waveMap=new Map(),taskRows=[],resourceEvidence=new Map();
  for(const event of Array.isArray(events)?events:[]){
    const payload=event?.payload??{};
    if(!matchesSelection(payload,selected))continue;
    if(event.type===TelemetryEvent.SCATTER_LAYER_STARTED){
      const waveId=String(payload.waveId??`${payload.turnId??'turn'}:${payload.layer??'layer'}`);
      waveMap.set(waveId,{
        waveId,turnId:nullable(payload.turnId),generationId:nullable(payload.generationId??payload.selection?.generationId),
        correlationId:nullable(payload.correlationId),parentReceiptId:nullable(payload.parentReceiptId),layer:nullable(payload.layer),
        trigger:nullable(payload.trigger),startedAt:finiteOrNull(payload.startedAt),completedAt:null,durationMs:null,
        queueDepth:finiteOrNull(payload.queueDepth),concurrency:finiteOrNull(payload.concurrency),taskCount:finiteOrNull(payload.taskCount),
        admitted:0,skipped:0,deferred:0,failed:0,fallbacks:0,costClass:nullable(payload.costClass),retainedBytes:null,releasedBytes:null,
      });
    }
    if(event.type===TelemetryEvent.SCATTER_TASK_DECISION){
      if(taskRows.length<Math.max(1,Number(maxTasks)||256))taskRows.push(freeze({
        taskId:nullable(payload.taskId),turnId:nullable(payload.turnId),generationId:nullable(payload.generationId??payload.selection?.generationId),
        correlationId:nullable(payload.correlationId),parentReceiptId:nullable(payload.parentReceiptId),layer:nullable(payload.layer),
        trigger:nullable(payload.trigger),decision:nullable(payload.decision),reason:nullable(payload.reason),queueDepth:finiteOrNull(payload.queueDepth),
        concurrency:finiteOrNull(payload.concurrency),durationMs:finiteOrNull(payload.durationMs),fallback:Boolean(payload.fallback),
        costClass:nullable(payload.costClass),resourceId:nullable(payload.resourceId),
      }));
      const wave=waveMap.get(String(payload.waveId??''));
      if(wave){
        const d=String(payload.decision??'');
        if(d==='ADMITTED')wave.admitted+=1;else if(d==='SKIPPED')wave.skipped+=1;else if(d==='DEFERRED')wave.deferred+=1;else if(d==='FAILED')wave.failed+=1;
        if(payload.fallback)wave.fallbacks+=1;
      }
    }
    if(event.type===TelemetryEvent.SCATTER_LAYER_COMPLETED){
      const wave=waveMap.get(String(payload.waveId??''));
      if(wave){
        wave.completedAt=finiteOrNull(payload.completedAt);wave.durationMs=finiteOrNull(payload.durationMs);
        wave.retainedBytes=finiteOrNull(payload.retainedBytes);wave.releasedBytes=finiteOrNull(payload.releasedBytes);
        wave.failed=Math.max(wave.failed,Number(payload.failed??0));wave.fallbacks=Math.max(wave.fallbacks,Number(payload.fallbacks??0));
      }
    }
    if(event.type===TelemetryEvent.RESOURCE_EXECUTION&&payload.resourceId){
      const id=String(payload.resourceId),row=resourceEvidence.get(id)??{physicalAttempted:false,returned:false,failed:false,taskIds:new Set()};
      row.physicalAttempted=true;if(payload.status==='SUCCESS')row.returned=true;if(payload.status==='FAIL')row.failed=true;
      if(payload.taskId)row.taskIds.add(String(payload.taskId));resourceEvidence.set(id,row);
    }
    if(event.type===TelemetryEvent.SWARM_TASK_RESULT&&payload.resourceId){
      const id=String(payload.resourceId),row=resourceEvidence.get(id)??{physicalAttempted:false,returned:false,failed:false,taskIds:new Set()};
      if(String(payload.state)!=='PARKED'&&String(payload.state)!=='SKIPPED')row.physicalAttempted=true;
      if(payload.state==='READY_FOR_CORE')row.returned=true;if(FAILURE_STATES.has(String(payload.state)))row.failed=true;
      if(payload.taskId)row.taskIds.add(String(payload.taskId));resourceEvidence.set(id,row);
    }
  }

  const acceptedResources=new Set();
  for(const receipt of Array.isArray(ownerReceipts)?ownerReceipts:[ownerReceipts]){
    if(!receipt||!matchesSelection(receipt,selected))continue;
    for(const admission of receipt.admissions??[]){
      if(admission?.acceptedByOwner&&admission?.resourceId)acceptedResources.add(String(admission.resourceId));
    }
  }

  const lifecycle=(Array.isArray(resources)?resources:resources?.resources??[]).map(resource=>{
    const resourceId=nullable(resource?.resourceId??resource?.id),evidence=resourceId?resourceEvidence.get(resourceId):null;
    const capabilities=[...(resource?.activeCapabilities??resource?.qualifiedCapabilities??resource?.declaredCapabilities??[])].map(String);
    return freeze({
      resourceId,providerProfileId:nullable(resource?.providerProfileId),serviceClasses:serviceClasses(capabilities),
      configured:resource?.configured!==false,qualified:Boolean(resource?.selectedModelQualified??resource?.qualification?.qualified),
      physicalAttempted:Boolean(evidence?.physicalAttempted),returned:Boolean(evidence?.returned),ownerAccepted:resourceId?acceptedResources.has(resourceId):false,
      skipped:taskRows.some(row=>row.resourceId===resourceId&&row.decision==='SKIPPED'),failed:Boolean(evidence?.failed),
      measurementClass:nullable(resource?.measurementClass),currentLoad:finiteOrNull(resource?.currentLoad??resource?.activeExecutions),
      concurrencyCapacity:finiteOrNull(resource?.concurrencyCapacity??resource?.maxConcurrency),
    });
  });

  const waves=[...waveMap.values()].slice(-Math.max(1,Number(maxWaves)||64)).map(row=>freeze({...row}));
  return freeze({
    kind:'LayeredScatterReadModel',contractVersion:'1.0.0',selection:selected,waves,tasks:taskRows,lifecycle,
    counts:{
      waves:waves.length,admitted:taskRows.filter(x=>x.decision==='ADMITTED').length,skipped:taskRows.filter(x=>x.decision==='SKIPPED').length,
      deferred:taskRows.filter(x=>x.decision==='DEFERRED').length,failed:taskRows.filter(x=>x.decision==='FAILED').length,
      configured:lifecycle.filter(x=>x.configured).length,qualified:lifecycle.filter(x=>x.qualified).length,
      physicalAttempts:lifecycle.filter(x=>x.physicalAttempted).length,returned:lifecycle.filter(x=>x.returned).length,
      ownerAccepted:lifecycle.filter(x=>x.ownerAccepted).length,resourceFailures:lifecycle.filter(x=>x.failed).length,
    },
    rawPromptIncluded:false,rawStoryIncluded:false,rawLoreIncluded:false,credentialIncluded:false,hiddenReasoningIncluded:false,
    authority:{mutation:false,truth:false,settlement:false,contextSeal:false,finalChoice:false},
  });
}

function recordCarriesUnresolved(record){
  if(record?.state&&['FAILED','UNAVAILABLE','REJECTED_INVALID','REJECTED_STALE'].includes(String(record.state)))return true;
  const payload=record?.result?.payload??record?.payload;
  if(!payload||typeof payload!=='object')return false;
  if(nonEmpty(payload.unresolvedRefs)||nonEmpty(payload.conflicts)||nonEmpty(payload.unresolved)||nonEmpty(payload.unresolvedDisagreement))return true;
  if(String(payload.status??'').toUpperCase()==='UNRESOLVED'||String(payload.truthClass??'').toUpperCase()==='UNRESOLVED')return true;
  return false;
}
function nonEmpty(value){return Array.isArray(value)?value.length>0:Boolean(value&&typeof value==='object'&&Object.keys(value).length);}
function serviceClasses(capabilities){
  const set=new Set(capabilities.map(x=>String(x).toUpperCase())),out=[];
  if(set.has('SEMANTIC_JUDGMENT'))out.push('JEV');
  if([...set].some(cap=>VECTOR_CAPABILITIES.has(cap)))out.push('VECTORING');
  if([...set].some(cap=>!VECTOR_CAPABILITIES.has(cap)&&cap!=='SEMANTIC_JUDGMENT'))out.push('SIDECAR');
  return out.length?Object.freeze(out):Object.freeze(['SIDECAR']);
}
function normalizeSelection(value={}){
  return freeze({
    chatId:nullable(value.chatId),turnId:nullable(value.turnId),generationId:nullable(value.generationId),correlationId:nullable(value.correlationId),
  });
}
function matchesSelection(value,selection){
  for(const key of ['chatId','turnId','generationId','correlationId']){
    const expected=selection[key],actual=value?.[key]??value?.selection?.[key];
    if(expected!=null&&actual!=null&&String(expected)!==String(actual))return false;
  }
  return true;
}
function nullable(value){return value==null||value===''?null:String(value);}
function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function finiteOrNull(value){if(value==null)return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
