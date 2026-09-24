import { ResultClass, TelemetryEvent } from './constants.js';

export const WidgetHealth=Object.freeze({READY:'READY',WORKING:'WORKING',DEGRADED:'DEGRADED',STALE:'STALE',BLOCKED:'BLOCKED',ERROR:'ERROR'});

export function projectCognitionUiState({turnId=null,events=[],providerHealth=[],queuePressure=null}={}){
  const tasks=new Map();let lateResults=0,staleDrops=0,warmHits=0,fallbackCount=0,validationFailures=0;
  for(const event of events){
    const p=event?.payload??{};
    if(turnId!=null&&p.turnId!=null&&p.turnId!==turnId)continue;
    if(p.taskId){
      const row=tasks.get(p.taskId)??{taskId:p.taskId,placement:p.placement??null,resultClass:p.resultClass??null,state:'PLANNED'};
      if(event.type===TelemetryEvent.TASK_STARTED)row.state='ACTIVE';
      if(event.type===TelemetryEvent.TASK_COMPLETED)row.state='COMPLETED';
      if(event.type===TelemetryEvent.TASK_PARKED)row.state='PARKED';
      if(event.type===TelemetryEvent.TASK_RESUMED)row.state='ACTIVE';
      if(event.type===TelemetryEvent.TASK_CANCELLED)row.state='CANCELLED';
      if(event.type===TelemetryEvent.TASK_SUPERSEDED)row.state='SUPERSEDED';
      row.placement=p.placement??row.placement;row.resultClass=p.resultClass??row.resultClass;tasks.set(p.taskId,row);
    }
    if(event.type===TelemetryEvent.LATE_ROUTED)lateResults+=1;
    if(event.type===TelemetryEvent.STALE_DROPPED)staleDrops+=1;
    if(event.type===TelemetryEvent.WARM_HIT)warmHits+=1;
    if(event.type===TelemetryEvent.FALLBACK_USED)fallbackCount+=1;
    if(event.type===TelemetryEvent.VALIDATION_FAILED)validationFailures+=1;
  }
  const values=[...tasks.values()];const active=values.filter((x)=>x.state==='ACTIVE'||x.state==='PARKED');
  const providerRows=Array.isArray(providerHealth)?providerHealth:Object.entries(providerHealth??{}).map(([providerProfileId,health])=>({providerProfileId,health}));
  const blockedProviders=providerRows.filter((x)=>['UNAVAILABLE','COOLDOWN'].includes(String(x.health).toUpperCase())).length;
  const degradedProviders=providerRows.filter((x)=>String(x.health).toUpperCase()==='DEGRADED').length;
  const health=validationFailures?WidgetHealth.ERROR:staleDrops?WidgetHealth.STALE:blockedProviders&&providerRows.length===blockedProviders?WidgetHealth.BLOCKED:(degradedProviders||fallbackCount)?WidgetHealth.DEGRADED:active.length?WidgetHealth.WORKING:WidgetHealth.READY;
  return Object.freeze({
    kind:'CognitionUiState',turnId,activeTasks:active.length,hotTasks:active.filter((x)=>x.placement==='HOT').length,deepTasks:active.filter((x)=>x.placement==='DEEP').length,
    requiredPending:active.filter((x)=>x.resultClass===ResultClass.REQUIRED).length,
    opportunisticPending:active.filter((x)=>x.resultClass===ResultClass.OPPORTUNISTIC).length,
    deferredTasks:active.filter((x)=>x.resultClass===ResultClass.DEFERRED).length,
    lateResults,staleDrops,warmHits,fallbackCount,providerHealth:Object.freeze(providerRows.map((x)=>Object.freeze({...x}))),
    queuePressure:queuePressure==null?null:structuredClone(queuePressure),health,mutationAuthority:false,
  });
}
