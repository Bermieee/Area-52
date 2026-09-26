import { Placement, ResultClass } from './constants.js';

export const LAYERED_SCATTER_VERSION='1.0.0';

export const ScatterLayer=Object.freeze({
  SIGNAL:'SIGNAL',
  EXPANSION:'EXPANSION',
  PRECISION:'PRECISION',
  BACKGROUND:'BACKGROUND',
});

export const SCATTER_LAYER_ORDER=Object.freeze([
  ScatterLayer.SIGNAL,
  ScatterLayer.EXPANSION,
  ScatterLayer.PRECISION,
  ScatterLayer.BACKGROUND,
]);

const SIGNAL_TASKS=new Set([
  'NATIVE_BOUNDED_TURN','CHANGE_CLASSIFICATION','SCENE_CLASSIFICATION','EXACT_LOOKUP','HOT_STATE_LOOKUP',
]);
const EXPANSION_TASKS=new Set([
  'HISTORIAN_RETRIEVAL','GRAPH_WALK','GREEN_ROOM','DENSE_RETRIEVAL','EPISODIC_RETRIEVAL',
]);
const PRECISION_TASKS=new Set([
  'TRUTH_PRECISION','JEV_DECISION','PRECISION_RERANK','CROSS_ENCODER_RERANK','CONFLICT_INTERPRETATION',
]);

export function classifyScatterLayer(task={}){
  if(task.placement===Placement.DEEP||task.resultClass===ResultClass.DEFERRED)return ScatterLayer.BACKGROUND;
  const declared=String(task.metadata?.scatterLayer??'').toUpperCase();
  if(Object.values(ScatterLayer).includes(declared))return declared;
  const type=String(task.taskType??'').toUpperCase();
  const role=String(task.metadata?.roleId??'').toLowerCase();
  if(PRECISION_TASKS.has(type)||role.includes('truth')||role.includes('precision')||role.includes('jev'))return ScatterLayer.PRECISION;
  if(EXPANSION_TASKS.has(type)||role.includes('graph')||role.includes('historian')||role.includes('green-room')||role.includes('dense')||role.includes('episodic'))return ScatterLayer.EXPANSION;
  if(SIGNAL_TASKS.has(type)||task.cognitiveLayer==='L0')return ScatterLayer.SIGNAL;
  return ScatterLayer.SIGNAL;
}

export function partitionScatterTasks(tasks=[]){
  const buckets=new Map(SCATTER_LAYER_ORDER.map(layer=>[layer,[]]));
  for(const task of tasks)buckets.get(classifyScatterLayer(task)).push(task);
  return Object.freeze(SCATTER_LAYER_ORDER.map(layer=>Object.freeze({layer,tasks:Object.freeze([...buckets.get(layer)])})));
}

export function evaluateScatterAdmission(task,{now=Date.now(),minFreshWindowMs=12}={}){
  const layer=classifyScatterLayer(task);
  if(layer===ScatterLayer.BACKGROUND)return freeze({decision:'DEFER',layer,reason:'BACKGROUND_OUTSIDE_FOREGROUND_DEADLINE'});
  const remaining=Math.max(0,Number(task.hardDeadline??now)-Number(now));
  const pastSoft=Number.isFinite(Number(task.softDeadline))&&Number(now)>=Number(task.softDeadline);
  if(task.resultClass===ResultClass.OPPORTUNISTIC&&(pastSoft||remaining<=Math.max(0,Number(minFreshWindowMs)||0))){
    return freeze({decision:'SKIP',layer,reason:pastSoft?'OPPORTUNISTIC_SOFT_DEADLINE':'OPPORTUNISTIC_FRESHNESS_GUARD',remainingMs:remaining});
  }
  return freeze({decision:'ADMIT',layer,reason:admissionReason(task,layer),remainingMs:remaining});
}

export function scatterTrigger(task={}){
  const reasons=Array.isArray(task.metadata?.reasonCodes)?task.metadata.reasonCodes.filter(x=>typeof x==='string'&&x):[];
  if(reasons.length)return reasons.slice(0,8).join('|');
  return String(task.metadata?.historianUrgency??task.metadata?.trigger??task.taskType??'TASK');
}

export function boundedLayerConcurrency(value=2){
  const n=Number(value);
  if(!Number.isInteger(n)||n<1)return 2;
  return Math.min(8,n);
}

export async function yieldScatterHost(){
  const scheduler=globalThis.scheduler;
  if(typeof scheduler?.yield==='function'){await scheduler.yield();return;}
  if(typeof scheduler?.postTask==='function'){await scheduler.postTask(()=>{}, {priority:'user-visible'});return;}
  await new Promise(resolve=>setTimeout(resolve,0));
}

export function estimateRetainedResultBytes(result){
  if(!result)return 0;
  try{return new TextEncoder().encode(JSON.stringify(result)).length;}catch{return 0;}
}

function admissionReason(task,layer){
  const reasons=Array.isArray(task.metadata?.reasonCodes)?task.metadata.reasonCodes:[];
  if(reasons.length)return String(reasons[0]);
  if(layer===ScatterLayer.SIGNAL)return 'EARLY_SIGNAL';
  if(layer===ScatterLayer.EXPANSION)return 'PRECEDING_SIGNAL_NOMINATED';
  if(layer===ScatterLayer.PRECISION)return 'UNRESOLVED_HIGH_VALUE_NOMINATION';
  return 'FOREGROUND_REQUIRED';
}
function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;
}
