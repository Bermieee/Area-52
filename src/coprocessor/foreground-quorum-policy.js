import { ResultClass, ResultDestination } from './constants.js';

export const DeadlineClass=Object.freeze({REQUIRED:'REQUIRED',OPPORTUNISTIC:'OPPORTUNISTIC',DEFERRED:'DEFERRED'});
export const LateResultDestination=Object.freeze({
  DROP:ResultDestination.DROP,NEXT_TURN:ResultDestination.NEXT_TURN,WARM_CACHE:ResultDestination.WARM_CACHE,
  NEARLINE:ResultDestination.NEARLINE,BACKGROUND:ResultDestination.BACKGROUND,DIAGNOSTIC_ONLY:ResultDestination.DIAGNOSTIC_ONLY,
});

export function taskDeadlinePolicy(task){
  return Object.freeze({
    taskId:task.taskId,resultClass:task.resultClass,softDeadline:Number(task.softDeadline),hardDeadline:Number(task.hardDeadline),
    deterministicFallback:structuredClone(task.fallbackPolicy??null),
    qualityWeight:Number(task.metadata?.qualityWeight??(task.resultClass===ResultClass.REQUIRED?1:task.resultClass===ResultClass.OPPORTUNISTIC?0.5:0.25)),
    deadlineClass:task.metadata?.deadlineClass??task.resultClass,
  });
}

export function createForegroundQuorumPlan(tasks,{minimumForegroundCompletion=null,deadline=null}={}){
  const list=[...(tasks??[])];const required=list.filter((t)=>t.resultClass===ResultClass.REQUIRED);
  const opportunistic=list.filter((t)=>t.resultClass===ResultClass.OPPORTUNISTIC);const deferred=list.filter((t)=>t.resultClass===ResultClass.DEFERRED);
  const minimum=Math.max(0,Math.min(required.length,Number(minimumForegroundCompletion??required.length)||0));
  const hard=deadline==null?(required.length?Math.max(...required.map((t)=>Number(t.hardDeadline))):0):Number(deadline);
  return Object.freeze({
    kind:'ForegroundQuorumPlan',requiredTaskIds:Object.freeze(required.map((t)=>t.taskId)),minimumForegroundCompletion:minimum,deadline:hard,
    fallbackReadiness:Object.freeze(Object.fromEntries(required.map((t)=>[t.taskId,Boolean(t.fallbackPolicy?.type)]))),
    optionalTaskIds:Object.freeze(opportunistic.map((t)=>t.taskId)),deferredTaskIds:Object.freeze(deferred.map((t)=>t.taskId)),
    policies:Object.freeze(Object.fromEntries(list.map((t)=>[t.taskId,taskDeadlinePolicy(t)]))),schedulingDecision:null,executionAuthority:false,
  });
}

export function evaluateForegroundQuorum(plan,{completedTaskIds=[],fallbackTaskIds=[],now=0}={}){
  const satisfied=new Set([...completedTaskIds,...fallbackTaskIds]);const requiredSatisfied=plan.requiredTaskIds.filter((id)=>satisfied.has(id));
  const missing=plan.requiredTaskIds.filter((id)=>!satisfied.has(id));const expired=Number(now)>Number(plan.deadline);
  return Object.freeze({
    satisfied:requiredSatisfied.length>=plan.minimumForegroundCompletion,expired,requiredSatisfied:Object.freeze(requiredSatisfied),missingRequired:Object.freeze(missing),
    closeReason:requiredSatisfied.length>=plan.minimumForegroundCompletion?'FOREGROUND_QUORUM':expired?'HARD_DEADLINE':'WAITING_REQUIRED',
    runtimeTimerAuthority:false,
  });
}

export function lateResultDestination(task,{cancelled=false,superseded=false,stale=false,failed=false,warmReusable=false,nearlineEligible=false}={}){
  if(cancelled||superseded||stale)return LateResultDestination.DROP;
  if(failed)return LateResultDestination.DIAGNOSTIC_ONLY;
  if(task.resultClass===ResultClass.DEFERRED)return nearlineEligible?LateResultDestination.NEARLINE:LateResultDestination.BACKGROUND;
  if(warmReusable)return LateResultDestination.WARM_CACHE;
  if(task.resultClass===ResultClass.OPPORTUNISTIC)return LateResultDestination.NEXT_TURN;
  return LateResultDestination.DIAGNOSTIC_ONLY;
}

export function hardDeadlineDisposition(task){
  if(task.resultClass===ResultClass.REQUIRED)return Object.freeze({action:'BOUNDED_FALLBACK',blocksSeal:false});
  if(task.resultClass===ResultClass.OPPORTUNISTIC)return Object.freeze({action:'CONTINUE_AND_ROUTE_LATE',blocksSeal:false});
  return Object.freeze({action:'BACKGROUND_ACCOUNTING',blocksSeal:false});
}
