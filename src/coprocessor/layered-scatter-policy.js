import { ResultClass } from './constants.js';

export const ScatterLayer=Object.freeze({
  HOT_SIGNAL:'HOT_SIGNAL',
  RETRIEVAL:'RETRIEVAL',
  EXPANSION:'EXPANSION',
  PRECISION:'PRECISION',
  DEEP:'DEEP',
});
export const ScatterAdmission=Object.freeze({ADMIT:'ADMIT',FALLBACK:'FALLBACK',SKIP:'SKIP',DEFER:'DEFER'});
export const SCATTER_LAYER_ORDER=Object.freeze([
  ScatterLayer.HOT_SIGNAL,ScatterLayer.RETRIEVAL,ScatterLayer.EXPANSION,ScatterLayer.PRECISION,ScatterLayer.DEEP,
]);

const ROLE_LAYER=Object.freeze({
  historian:ScatterLayer.RETRIEVAL,
  'graph-walker':ScatterLayer.EXPANSION,
  'green-room':ScatterLayer.EXPANSION,
  'truth-precision':ScatterLayer.PRECISION,
  consolidation:ScatterLayer.DEEP,
});

export function createLayeredScatterPlan({fanOutPlan,plannerInput={},choiceProposal=null}={}){
  if(fanOutPlan?.kind!=='FanOutPlan')throw new TypeError('FanOutPlan is required');
  const layers=SCATTER_LAYER_ORDER.map(layer=>({layer,tasks:[],trigger:triggerFor(layer,plannerInput),costClass:String(plannerInput.costBudget??'MEDIUM')}));
  const byLayer=new Map(layers.map(row=>[row.layer,row]));
  for(const task of fanOutPlan.tasks??[]){
    const role=task.metadata?.roleId??roleFor(task.taskType);
    const layer=task.resultClass===ResultClass.DEFERRED?ScatterLayer.DEEP:(ROLE_LAYER[role]??ScatterLayer.EXPANSION);
    byLayer.get(layer).tasks.push(task);
  }
  return freeze({
    kind:'LayeredScatterPlan',contractVersion:'1.0.0',turnId:fanOutPlan.turnId,correlationId:fanOutPlan.correlationId,
    proposalId:choiceProposal?.proposalId??null,logicalJobCount:fanOutPlan.tasks.length,
    layers:layers.map(row=>freeze({...row,tasks:freeze([...row.tasks]),logicalJobCount:row.tasks.length})),
    policy:Object.freeze({concurrentWithinLayer:true,serialAcrossDependencies:true,deepOutsideForeground:true,contextSealAuthority:false}),
  });
}

export function evaluateScatterAdmission(task,{
  plannerInput={},completedRecords=[],gatherBundle=null,now=Date.now(),hardDeadline=task?.hardDeadline,
}={}){
  if(!task?.taskId)throw new TypeError('CognitiveTask is required');
  if(task.resultClass===ResultClass.DEFERRED||task.placement==='DEEP')return decision(ScatterAdmission.DEFER,'DEEP_OUTSIDE_FOREGROUND',task);
  const remaining=Number(hardDeadline??task.hardDeadline??Infinity)-Number(now);
  if(Number.isFinite(remaining)&&remaining<=0)return decision(task.resultClass===ResultClass.REQUIRED?ScatterAdmission.FALLBACK:ScatterAdmission.SKIP,'FOREGROUND_DEADLINE_EXPIRED',task);
  if(task.resultClass===ResultClass.OPPORTUNISTIC&&Number.isFinite(remaining)&&remaining<20)return decision(ScatterAdmission.SKIP,'OPPORTUNISTIC_DEADLINE_PRESSURE',task);

  const role=task.metadata?.roleId??roleFor(task.taskType);
  if(role==='truth-precision'&&graphResolvedWithoutAmbiguity(completedRecords)&&!explicitAmbiguity(plannerInput,gatherBundle)){
    return decision(ScatterAdmission.FALLBACK,'GRAPH_RESOLVED_NO_TRUTH_AMBIGUITY',task);
  }
  return decision(ScatterAdmission.ADMIT,'LAYER_SIGNAL_ADMITTED',task);
}

export function evaluateJevLayerAdmission({
  proposal=null,request=null,gatherBundle=null,sealed=false,now=Date.now(),minimumExpectedValue=.65,
}={}){
  const option=proposal?.options?.find(row=>row.optionId==='jev-adjudication')??null;
  const ownerRequested=proposal?.ownerStageRequests?.jevAdjudication===true&&option?.disposition==='NOMINATED';
  if(!ownerRequested)return freeze({admission:ScatterAdmission.SKIP,reason:'OWNER_DID_NOT_REQUEST_JEV',expectedValue:Number(option?.expectedValue??0)});
  if(!request)return freeze({admission:ScatterAdmission.SKIP,reason:'JEV_REQUEST_MISSING',expectedValue:Number(option?.expectedValue??0)});
  if(sealed)return freeze({admission:ScatterAdmission.SKIP,reason:'CONTEXT_ALREADY_SEALED',expectedValue:Number(option?.expectedValue??0)});
  if(Number(request.deadline??Infinity)<=Number(now))return freeze({admission:ScatterAdmission.SKIP,reason:'JEV_DEADLINE_EXPIRED',expectedValue:Number(option?.expectedValue??0)});
  const expectedValue=Number(request.routing?.expectedDecisionValue??option?.expectedValue??0);
  if(!Number.isFinite(expectedValue)||expectedValue<Number(minimumExpectedValue))return freeze({admission:ScatterAdmission.SKIP,reason:'JEV_VALUE_BELOW_THRESHOLD',expectedValue});
  const optionCount=Array.isArray(request.options)?request.options.length:0;
  const unresolved=optionCount>1||Number(gatherBundle?.unresolvedDisagreement?.length??0)>0;
  if(!unresolved)return freeze({admission:ScatterAdmission.SKIP,reason:'NO_BOUNDED_AMBIGUITY_REMAINS',expectedValue});
  return freeze({admission:ScatterAdmission.ADMIT,reason:'OWNER_REQUESTED_HIGH_VALUE_AMBIGUITY',expectedValue});
}

export function fallbackPayloadForTask(task,reason='DECLARED_FALLBACK'){
  const role=task?.metadata?.roleId??roleFor(task?.taskType);
  if(role==='historian')return freeze({evidence:[],candidateRefs:[],abstained:true,fallbackReason:reason});
  if(role==='graph-walker')return freeze({nodes:[],edges:[],currentStateRefs:[],historicalRefs:[],unresolvedRefs:[],conflicts:[],fallbackReason:reason});
  if(role==='green-room')return freeze({characters:[],inferences:[],omitted:true,fallbackReason:reason});
  if(role==='truth-precision')return freeze({assessments:[],ranking:[],rejectedRefs:[],uncertaintyPreserved:true,fallbackReason:reason});
  return freeze({fallbackReason:reason});
}

export function plannerSignalSnapshot(input={}){
  return freeze({
    queryIntent:input.queryIntent??null,retrievalQuality:input.retrievalQuality??null,sceneTransitionType:input.sceneTransitionType??null,
    hotStateSufficient:Boolean(input.hotStateSufficient),conflictSignalCount:Array.isArray(input.conflictSignals)?input.conflictSignals.length:0,
    uncertainSceneFieldCount:Array.isArray(input.uncertainSceneFields)?input.uncertainSceneFields.length:0,
    activeCastCount:Array.isArray(input.activeCast)?input.activeCast.length:0,activeThreadCount:Array.isArray(input.activeThreads)?input.activeThreads.length:0,
    prefetchRecommendationCount:Array.isArray(input.prefetchRecommendations)?input.prefetchRecommendations.length:0,
    backgroundConsolidationPending:Boolean(input.backgroundSignals?.consolidationPending||Number(input.backgroundSignals?.pendingUnits??0)>0),
    textSignals:freeze({
      physical:/\b(where|location|inventory|item|object|weapon|equipment|find|current state|physical state)\b/i.test(String(input.text??'')),
      ambiguity:/\b(conflict|contradiction|ambiguous|uncertain|truth)\b/i.test(String(input.text??'')),
      dialogue:/\b(speaks?|speaking|talks?|asks?|tells?|replies?|answers?|dialogue|conversation)\b/i.test(String(input.text??'')),
    }),
  });
}

function graphResolvedWithoutAmbiguity(records){
  const row=[...(records??[])].reverse().find(record=>record?.taskType==='GRAPH_WALK'&&record?.state==='READY_FOR_CORE'&&record?.result?.payload);
  if(!row)return false;
  const payload=row.result.payload;
  return (payload.conflicts?.length??0)===0&&(payload.unresolvedRefs?.length??0)===0;
}
function explicitAmbiguity(input,bundle){
  return (input.conflictSignals?.length??0)>0||(input.uncertainSceneFields?.length??0)>0||
    ['MIXED','LOW'].includes(String(input.retrievalQuality??'').toUpperCase())||
    /\b(conflict|contradiction|ambiguous|uncertain|truth)\b/i.test(String(input.text??''))||
    Number(bundle?.unresolvedDisagreement?.length??0)>0;
}
function decision(admission,reason,task){return freeze({admission,reason,taskId:task.taskId,resultClass:task.resultClass,fallback:task.fallbackPolicy?.type??null,costClass:task.metadata?.costBudget??task.metadata?.costEstimate?.class??'MEDIUM'});}
function roleFor(type){return({HISTORIAN_RETRIEVAL:'historian',GRAPH_WALK:'graph-walker',GREEN_ROOM:'green-room',TRUTH_PRECISION:'truth-precision',CONSOLIDATION:'consolidation'})[type]??String(type??'').toLowerCase();}
function triggerFor(layer,input){
  if(layer===ScatterLayer.HOT_SIGNAL)return 'TURN_SIGNAL_AND_CURRENT_STATE';
  if(layer===ScatterLayer.RETRIEVAL)return input.retrievalQuality==='LOW'?'LOW_RETRIEVAL_OR_HISTORIAN_SIGNAL':'HISTORIAN_WAKE_SIGNAL';
  if(layer===ScatterLayer.EXPANSION)return input.sceneTransitionType?'SCENE_TRANSITION_OR_PHYSICAL_STATE':'PHYSICAL_GRAPH_OR_ACTIVE_CAST_SIGNAL';
  if(layer===ScatterLayer.PRECISION)return (input.conflictSignals?.length??0)>0?'UNRESOLVED_CONFLICT':'POST_EXPANSION_AMBIGUITY';
  return 'DEEP_BACKGROUND_ONLY';
}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
