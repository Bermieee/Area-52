import { ResultClass, TelemetryEvent } from './constants.js';

export const COGNITION_UI_READ_MODEL_VERSION='2.0.0';
export const WidgetHealth=Object.freeze({READY:'READY',WORKING:'WORKING',DEGRADED:'DEGRADED',STALE:'STALE',BLOCKED:'BLOCKED',ERROR:'ERROR'});

export function projectCognitionUiState({
  chatId=null,turnId=null,generationId=null,correlationId=null,
  events=[],providerHealth=[],queuePressure=null,resources=[],ownerReceipts=[],telemetrySnapshot=null,
}={}){
  const selection={chatId:nullable(chatId),turnId:nullable(turnId),generationId:nullable(generationId),correlationId:nullable(correlationId)};
  const tasks=new Map();
  const resourceEvidence=new Map();
  let lateResults=0,staleDrops=0,warmHits=0,warmMisses=0,fallbackCount=0,retryCount=0,validationFailures=0;
  let queueEvents=0,yields=0,parks=0,resumes=0,physicalAttempts=0,physicalSuccesses=0,physicalFailures=0;
  const resultDestinations={};

  for(const event of Array.isArray(events)?events:[]){
    const p=event?.payload??{};
    if(!matchesSelection(p,selection))continue;
    const taskId=nullable(p.taskId);
    if(taskId){
      const row=tasks.get(taskId)??taskRow(taskId,p);
      updateTask(row,event.type,p);
      tasks.set(taskId,row);
    }
    if(event.type===TelemetryEvent.TASK_QUEUED)queueEvents+=1;
    if(event.type===TelemetryEvent.TASK_YIELD_REQUESTED||event.type===TelemetryEvent.TASK_YIELDING)yields+=1;
    if(event.type===TelemetryEvent.TASK_PARKED)parks+=1;
    if(event.type===TelemetryEvent.TASK_RESUMED)resumes+=1;
    if(event.type===TelemetryEvent.LATE_ROUTED)lateResults+=1;
    if(event.type===TelemetryEvent.STALE_DROPPED)staleDrops+=1;
    if(event.type===TelemetryEvent.WARM_HIT)warmHits+=1;
    if(event.type===TelemetryEvent.WARM_MISS)warmMisses+=1;
    if(event.type===TelemetryEvent.FALLBACK_USED)fallbackCount+=1;
    if(event.type===TelemetryEvent.RETRY)retryCount+=1;
    if(event.type===TelemetryEvent.VALIDATION_FAILED)validationFailures+=1;
    if(event.type===TelemetryEvent.RESULT_ROUTED&&typeof p.destination==='string')resultDestinations[p.destination]=(resultDestinations[p.destination]??0)+1;
    if(event.type===TelemetryEvent.RESOURCE_EXECUTION){
      physicalAttempts+=1;if(p.status==='SUCCESS')physicalSuccesses+=1;else if(p.status==='FAIL')physicalFailures+=1;
      if(p.resourceId){
        const state=resourceEvidence.get(String(p.resourceId))??{attempted:false,succeeded:false,failed:false,taskIds:new Set()};
        state.attempted=true;state.succeeded ||= p.status==='SUCCESS';state.failed ||= p.status==='FAIL';if(taskId)state.taskIds.add(taskId);
        resourceEvidence.set(String(p.resourceId),state);
      }
    }
  }

  const ownerAcceptance=projectOwnerReceipts(ownerReceipts,selection);
  const acceptedTasks=new Set(ownerAcceptance.flatMap(row=>row.admissions.filter(x=>x.acceptedByOwner).map(x=>x.taskId).filter(Boolean)));
  const acceptedResources=new Set(ownerAcceptance.flatMap(row=>row.admissions.filter(x=>x.acceptedByOwner).map(x=>x.resourceId).filter(Boolean)));
  for(const taskId of acceptedTasks){const row=tasks.get(taskId);if(row)row.ownerAccepted=true;}

  const resourceRows=(Array.isArray(resources)?resources:resources?.resources??[]).map(row=>{
    const resourceId=nullable(row?.resourceId??row?.id);
    const execution=resourceId?resourceEvidence.get(resourceId):null;
    const physicalAttempted=Boolean(row?.physicalExecutionAttempted??execution?.attempted??row?.lastExecution);
    const physicalSucceeded=Boolean(row?.physicalExecutionSucceeded??execution?.succeeded??row?.lastExecution?.status==='SUCCESS');
    return freeze({
      resourceId,displayName:nullable(row?.displayName??row?.name),state:nullable(row?.state),health:nullable(row?.health),
      configured:row?.configured!==false,connected:Boolean(row?.connected??row?.callable),
      qualified:Boolean(row?.selectedModelQualified??row?.qualification?.qualified),callable:Boolean(row?.callable),
      physicalExecutionAttempted:physicalAttempted,physicalExecutionSucceeded:physicalSucceeded,
      ownerAccepted:resourceId?acceptedResources.has(resourceId):false,
      providerProfileId:nullable(row?.providerProfileId??row?.profileId),providerId:nullable(row?.providerId),
      requestedModelId:nullable(row?.modelId),actualModelId:nullable(row?.actualModelId),actualProvider:nullable(row?.actualProvider),
      activeCapabilities:[...(row?.activeCapabilities??[])],measurementClass:nullable(row?.measurementClass),
      currentLoad:Number(row?.currentLoad??row?.activeExecutions??0),concurrencyCapacity:Number(row?.concurrencyCapacity??row?.maxConcurrency??1),
      reasonCode:nullable(row?.reasonCode),lastHealthResult:nullable(row?.lastHealthResult),lastHealthLatencyMs:finiteOrNull(row?.lastHealthLatencyMs),
    });
  });

  const values=[...tasks.values()].map(row=>freeze({...row,capabilities:[...row.capabilities],destinations:[...row.destinations]}));
  const activeRows=values.filter(x=>x.state==='ACTIVE'||x.state==='PARKED'||x.state==='QUEUED');
  const providerRows=Array.isArray(providerHealth)?providerHealth:Object.entries(providerHealth??{}).map(([providerProfileId,health])=>({providerProfileId,health}));
  const blockedProviders=providerRows.filter(x=>['UNAVAILABLE','COOLDOWN'].includes(String(x.health).toUpperCase())).length;
  const degradedProviders=providerRows.filter(x=>String(x.health).toUpperCase()==='DEGRADED').length;
  const health=validationFailures?WidgetHealth.ERROR:staleDrops?WidgetHealth.STALE:blockedProviders&&providerRows.length===blockedProviders?WidgetHealth.BLOCKED:(degradedProviders||fallbackCount||physicalFailures)?WidgetHealth.DEGRADED:activeRows.length?WidgetHealth.WORKING:WidgetHealth.READY;
  const snapshot=telemetrySnapshot&&typeof telemetrySnapshot==='object'?telemetrySnapshot:{};

  return freeze({
    kind:'CognitionUiState',contractVersion:COGNITION_UI_READ_MODEL_VERSION,
    ...selection,
    activeTasks:activeRows.length,activeTaskDetails:activeRows,tasks:values,
    hotTasks:activeRows.filter(x=>x.placement==='HOT').length,deepTasks:activeRows.filter(x=>x.placement==='DEEP').length,
    requiredPending:activeRows.filter(x=>x.resultClass===ResultClass.REQUIRED).length,
    opportunisticPending:activeRows.filter(x=>x.resultClass===ResultClass.OPPORTUNISTIC).length,
    deferredTasks:activeRows.filter(x=>x.resultClass===ResultClass.DEFERRED).length,
    lateResults,staleDrops,warmHits,warmMisses,fallbackCount,retryCount,validationFailures,
    fallback:fallbackCount,retry:retryCount,warm:{hit:warmHits,miss:warmMisses},
    queue:{queued:queueEvents,yields,parks,resumes,pressure:queuePressure==null?null:structuredClone(queuePressure)},
    physicalExecution:{attempts:physicalAttempts,succeeded:physicalSuccesses,failed:physicalFailures},
    resultDestinations,providerHealth:providerRows.map(row=>freeze({...row})),
    resources:resourceRows,ownerAcceptance,
    lifecycle:{
      configured:resourceRows.filter(x=>x.configured).length,
      connected:resourceRows.filter(x=>x.connected).length,
      physicallyExecuted:resourceRows.filter(x=>x.physicalExecutionAttempted).length,
      ownerAccepted:resourceRows.filter(x=>x.ownerAccepted).length,
    },
    eventCounts:clone(snapshot.eventCounts??{}),providerCalls:clone(snapshot.providerCalls??{}),
    health,queuePressure:queuePressure==null?null:structuredClone(queuePressure),
    rawPromptIncluded:false,rawPayloadIncluded:false,credentialIncluded:false,
    mutationAuthority:false,truthAuthority:false,settlementAuthority:false,contextSealAuthority:false,finalChoiceAuthority:false,
  });
}

export function createCognitionUiReadModelReader({
  telemetry=null,resourceConnections=null,ownerReceipts=null,queuePressure=null,
}={}){
  const readOwner=typeof ownerReceipts==='function'?ownerReceipts:()=>ownerReceipts??[];
  const readQueue=typeof queuePressure==='function'?queuePressure:()=>queuePressure??null;
  return freeze({
    kind:'CognitionUiReadModelReader',contractVersion:COGNITION_UI_READ_MODEL_VERSION,
    read(selection={}){
      const snapshot=telemetry?.snapshot?.()??{};
      return projectCognitionUiState({
        ...selection,
        events:telemetry?.list?.()??[],
        providerHealth:snapshot.providerHealth??{},
        queuePressure:readQueue(selection),
        resources:resourceConnections?.listResources?.()??resourceConnections?.readModel?.()?.resources??[],
        ownerReceipts:readOwner(selection)??[],
        telemetrySnapshot:snapshot,
      });
    },
    authority:{mutation:false,truth:false,settlement:false,contextSeal:false,finalChoice:false},
  });
}

function taskRow(taskId,p){
  return{
    taskId,state:'PLANNED',placement:nullable(p.placement),resultClass:nullable(p.resultClass),cognitiveLayer:nullable(p.cognitiveLayer??p.layer),
    taskType:nullable(p.taskType),capabilities:[...(p.capabilities??p.requiredCapabilities??[])],providerProfileId:nullable(p.providerProfileId),
    providerId:nullable(p.providerId),workerId:nullable(p.workerId),resourceId:nullable(p.resourceId),modelId:nullable(p.modelId),
    queueMs:finiteOrNull(p.queueMs??p.queueTimeMs),executionMs:finiteOrNull(p.executionMs??p.latencyMs??p.executionLatency),
    yields:0,parks:0,resumes:0,retries:0,fallbacks:0,validationFailures:0,staleDrops:0,lateRoutes:0,
    physicallyExecuted:false,physicalExecutionSucceeded:false,ownerAccepted:false,destinations:[],
  };
}
function updateTask(row,type,p){
  if(type===TelemetryEvent.TASK_QUEUED)row.state='QUEUED';
  if(type===TelemetryEvent.TASK_STARTED)row.state='ACTIVE';
  if(type===TelemetryEvent.TASK_COMPLETED)row.state='COMPLETED';
  if(type===TelemetryEvent.TASK_PARKED){row.state='PARKED';row.parks+=1;}
  if(type===TelemetryEvent.TASK_RESUMED){row.state='ACTIVE';row.resumes+=1;}
  if(type===TelemetryEvent.TASK_CANCELLED)row.state='CANCELLED';
  if(type===TelemetryEvent.TASK_SUPERSEDED)row.state='SUPERSEDED';
  if(type===TelemetryEvent.TASK_YIELD_REQUESTED||type===TelemetryEvent.TASK_YIELDING)row.yields+=1;
  if(type===TelemetryEvent.RETRY)row.retries+=1;
  if(type===TelemetryEvent.FALLBACK_USED)row.fallbacks+=1;
  if(type===TelemetryEvent.VALIDATION_FAILED)row.validationFailures+=1;
  if(type===TelemetryEvent.STALE_DROPPED)row.staleDrops+=1;
  if(type===TelemetryEvent.LATE_ROUTED)row.lateRoutes+=1;
  if(type===TelemetryEvent.RESOURCE_EXECUTION){row.physicallyExecuted=true;row.physicalExecutionSucceeded ||= p.status==='SUCCESS';}
  if(type===TelemetryEvent.SWARM_TASK_RESULT&&['READY_FOR_CORE','FAILED','REJECTED_INVALID','REJECTED_STALE','REJECTED_LATE'].includes(String(p.state)))row.physicallyExecuted=true;
  if(type===TelemetryEvent.RESULT_ROUTED&&typeof p.destination==='string'&&!row.destinations.includes(p.destination))row.destinations.push(p.destination);
  row.placement=nullable(p.placement)??row.placement;row.resultClass=nullable(p.resultClass)??row.resultClass;row.cognitiveLayer=nullable(p.cognitiveLayer??p.layer)??row.cognitiveLayer;
  row.taskType=nullable(p.taskType)??row.taskType;row.providerProfileId=nullable(p.providerProfileId)??row.providerProfileId;row.providerId=nullable(p.providerId)??row.providerId;
  row.workerId=nullable(p.workerId)??row.workerId;row.resourceId=nullable(p.resourceId)??row.resourceId;row.modelId=nullable(p.modelId??p.actualModelId)??row.modelId;
  row.queueMs=maxFinite(row.queueMs,p.queueMs??p.queueTimeMs);row.executionMs=maxFinite(row.executionMs,p.executionMs??p.latencyMs??p.executionLatency);
  const caps=p.capabilities??p.requiredCapabilities;if(Array.isArray(caps))for(const cap of caps)if(!row.capabilities.includes(String(cap)))row.capabilities.push(String(cap));
}

function projectOwnerReceipts(receipts,selection){
  const out=[];
  for(const receipt of Array.isArray(receipts)?receipts:[receipts]){
    if(!receipt||typeof receipt!=='object'||!matchesSelection(receipt,selection))continue;
    const admissions=Array.isArray(receipt.admissions)?receipt.admissions.map(row=>freeze({
      taskId:nullable(row?.taskId),resultId:nullable(row?.resultId),resourceId:nullable(row?.resourceId),providerProfileId:nullable(row?.providerProfileId),
      providerId:nullable(row?.providerId),workerId:nullable(row?.workerId),acceptedByOwner:Boolean(row?.acceptedByOwner??row?.accepted),
      destination:nullable(row?.destination),stale:Boolean(row?.stale),late:Boolean(row?.late),invalid:Boolean(row?.invalid),reason:nullable(row?.reason??row?.reasonCode),
    })):receipt.ownerDecision||receipt.accepted!=null?[freeze({
      taskId:nullable(receipt.taskId),resultId:nullable(receipt.resultId),resourceId:nullable(receipt.resourceId),providerProfileId:nullable(receipt.providerProfileId),
      providerId:nullable(receipt.providerId),workerId:nullable(receipt.workerId),acceptedByOwner:Boolean(receipt.accepted??receipt.ownerAccepted),
      destination:nullable(receipt.destination),stale:Boolean(receipt.stale),late:Boolean(receipt.late),invalid:Boolean(receipt.invalid),reason:nullable(receipt.reasonCode??receipt.reason),
    })]:[];
    out.push(freeze({
      kind:nullable(receipt.kind),turnId:nullable(receipt.turnId),correlationId:nullable(receipt.correlationId),generationId:nullable(receipt.generationId),
      ownerDecision:nullable(receipt.ownerDecision??receipt.status),ownerAdmissionPerformed:Boolean(receipt.ownerAdmissionPerformed||admissions.length),
      settlementPerformed:Boolean(receipt.settlementPerformed),canonicalMutation:Boolean(receipt.canonicalMutation),admissions,
    }));
  }
  return out;
}

function matchesSelection(value,selection){
  for(const key of ['chatId','turnId','generationId','correlationId']){
    const expected=selection[key],actual=value?.[key]??value?.selection?.[key]??value?.metadata?.[key];
    if(expected!=null&&actual!=null&&String(expected)!==String(actual))return false;
  }
  return true;
}
function nullable(value){return value==null||value===''?null:String(value);}
function finiteOrNull(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function maxFinite(a,b){const aa=finiteOrNull(a),bb=finiteOrNull(b);if(aa==null)return bb;if(bb==null)return aa;return Math.max(aa,bb);}
function clone(value){return value==null?value:structuredClone(value);}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
