import { ResultClass } from './constants.js';
import { ALL_SCATTER_LAYERS, scatterLayerForTask, scatterTriggerForTask } from './layered-scatter.js';

export const LAYERED_SCATTER_OWNER_CONTRACT_VERSION='1.0.0';

export const LayeredScatterOwnerPolicy=Object.freeze({
  layerOrder:Object.freeze([...ALL_SCATTER_LAYERS]),
  required:'COMPLETE_OR_DECLARED_FALLBACK_BEFORE_SEAL',
  opportunistic:'ADMIT_ONLY_IF_FRESH_AND_RETURNED_BEFORE_SEAL',
  deferred:'BACKGROUND_OR_NEXT_TURN_ONLY_NEVER_MUTATE_SEALED_TURN',
  late:'REJECT_FROM_SEALED_TURN_MAY_ONLY_SERVE_LATER_FRESH_TURN',
  precision:'ADMIT_ONLY_AFTER_PRECEDING_UNRESOLVED_HIGH_VALUE_EVIDENCE',
  jev:'OWNER_REQUESTED_FINITE_AMBIGUOUS_ADVISORY_ONLY',
  gather:'OWNER_CONTINUOUSLY_GATHERS_EACH_COMPLETED_LAYER_UNTIL_DEADLINE',
  resultRetention:'COMPACT_NON_ADMISSIBLE_PROVIDER_PAYLOADS_RELEASE_INTERMEDIATE_LAYER_INPUTS',
  ownerAdmissionRequired:true,
  contextSealAuthority:false,
  truthAuthority:false,
  settlementAuthority:false,
  finalChoiceAuthority:false,
});

export function createLayeredScatterOwnerReceipt({checkpoint,records=[],jevObservation=null,createdAt=Date.now()}={}){
  if(checkpoint?.kind!=='CoprocessorSwarmCheckpoint')throw new TypeError('CoprocessorSwarmCheckpoint required');
  const tasks=new Map((checkpoint.pendingTasks??[]).map(task=>[task.taskId,task]));
  const taskResults=(records??[]).map(record=>{
    const task=tasks.get(record.taskId);
    const physicalAttempted=Boolean(record.providerProfileId||record.resourceId||record.startedAt!=null);
    const returned=Boolean(record.resultId||record.result?.resultId);
    const ownerAdmissible=record.state==='READY_FOR_CORE';
    return freeze({
      taskId:String(record.taskId),optionId:record.optionId??task?.metadata?.roleId??null,layer:record.layer??scatterLayerForTask(task??{}),
      trigger:record.trigger??scatterTriggerForTask(task??{}),resultClass:record.resultClass??task?.resultClass??null,state:String(record.state),
      physicalAttempted,returned,ownerAdmissible,requiredFallbackRequired:(record.resultClass??task?.resultClass)===ResultClass.REQUIRED&&!ownerAdmissible,
      providerProfileId:record.providerProfileId??null,resourceId:record.resourceId??null,resultId:record.resultId??record.result?.resultId??null,
      failureCode:record.failureCode??null,fallbackUsed:Boolean(record.fallbackUsed),late:Boolean(record.late),stale:Boolean(record.stale),invalid:Boolean(record.invalid),
      skipReason:record.skipReason??null,compactedBytes:Number(record.compactedBytes??0),
    });
  });
  return freeze({
    kind:'LayeredScatterOwnerReceipt',contractVersion:LAYERED_SCATTER_OWNER_CONTRACT_VERSION,
    receiptId:checkpoint.checkpointId+':owner-handoff',checkpointId:checkpoint.checkpointId,parentReceiptId:checkpoint.proposalId,
    selection:freeze({...normalizeSelection(checkpoint.selection??checkpoint)}),turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,createdAt:Number(createdAt),
    policy:LayeredScatterOwnerPolicy,taskResults,jev:jevObservation?freeze({
      requested:Boolean(jevObservation.requested),admitted:Boolean(jevObservation.admitted),physicalAttempted:Boolean(jevObservation.physicalAttempted),
      returned:Boolean(jevObservation.returned),ownerAdmissible:Boolean(jevObservation.ownerAdmissible),status:jevObservation.status??null,reason:jevObservation.reason??null,
      providerProfileId:jevObservation.providerProfileId??null,decisionRef:jevObservation.decisionRef??null,
    }):null,
    counts:freeze({
      logical:taskResults.length,physicalAttempts:taskResults.filter(row=>row.physicalAttempted).length,returned:taskResults.filter(row=>row.returned).length,
      ownerAdmissible:taskResults.filter(row=>row.ownerAdmissible).length,requiredFallbackRequired:taskResults.filter(row=>row.requiredFallbackRequired).length,
      skipped:taskResults.filter(row=>row.state==='SKIPPED').length,deferred:taskResults.filter(row=>row.state==='PARKED').length,
      compactedBytes:taskResults.reduce((sum,row)=>sum+row.compactedBytes,0),
    }),
    rawPromptIncluded:false,rawPayloadIncluded:false,rawStoryIncluded:false,rawLoreIncluded:false,credentialIncluded:false,hiddenReasoningIncluded:false,
    authority:freeze({mutation:false,truth:false,settlement:false,contextSeal:false,finalChoice:false}),
  });
}

function normalizeSelection(value={}){
  return{chatId:value?.chatId==null?null:String(value.chatId),turnId:value?.turnId==null?null:String(value.turnId),generationId:value?.generationId==null?null:String(value.generationId),correlationId:value?.correlationId==null?null:String(value.correlationId)};
}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
