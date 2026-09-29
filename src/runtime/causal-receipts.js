const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values,limit=32)=>[...new Set((values??[]).filter(Boolean).map(String))].sort().slice(0,limit);

export const CausalReceiptKind=Object.freeze({
  OBLIGATION_ADMITTED:'OBLIGATION_ADMITTED',
  PHYSICAL_EXECUTION_STARTED:'PHYSICAL_EXECUTION_STARTED',
  RESULT_RETURNED:'RESULT_RETURNED',
  OWNER_ADMISSION:'OWNER_ADMISSION',
  SETTLEMENT:'SETTLEMENT',
  WORK_SKIPPED:'WORK_SKIPPED',
  WORK_BLOCKED:'WORK_BLOCKED',
  WORK_DEFERRED:'WORK_DEFERRED',
  WORK_FAILED:'WORK_FAILED',
  RESULT_STALE:'RESULT_STALE',
  RESULT_LATE:'RESULT_LATE',
  OWNER_REJECTED:'OWNER_REJECTED',
});

export const CausalLifecycleState=Object.freeze({
  EXPECTED:'EXPECTED',ADMITTED:'ADMITTED',RUNNING:'RUNNING',RETURNED:'RETURNED',ACCEPTED:'ACCEPTED',
  SETTLED:'SETTLED',SKIPPED:'SKIPPED',BLOCKED:'BLOCKED',DEFERRED:'DEFERRED',FAILED:'FAILED',
  STALE:'STALE',LATE:'LATE',UNAVAILABLE:'UNAVAILABLE',NO_EVIDENCE:'NO_EVIDENCE',
});

export const CausalReasonCode=Object.freeze({
  OWNER_EXPECTED_WORK:'OWNER_EXPECTED_WORK',
  OWNER_DECLARED_NO_WORK:'OWNER_DECLARED_NO_WORK',
  OWNER_DEFERRED:'OWNER_DEFERRED',
  PREREQUISITE_PENDING:'PREREQUISITE_PENDING',
  EXECUTOR_UNAVAILABLE:'EXECUTOR_UNAVAILABLE',
  TASK_NOT_ADMITTED:'TASK_NOT_ADMITTED',
  LOGICAL_ADMISSION_ONLY:'LOGICAL_ADMISSION_ONLY',
  PHYSICAL_EXECUTION_STARTED:'PHYSICAL_EXECUTION_STARTED',
  RESULT_RETURNED:'RESULT_RETURNED',
  OWNER_ACCEPTED:'OWNER_ACCEPTED',
  OWNER_REJECTED:'OWNER_REJECTED',
  SETTLED:'SETTLED',
  STALE_RESULT:'STALE_RESULT',
  LATE_RESULT:'LATE_RESULT',
  TASK_FAILED:'TASK_FAILED',
  OPTIONAL_RESOURCE_UNAVAILABLE:'OPTIONAL_RESOURCE_UNAVAILABLE',
  NO_EVIDENCE:'NO_EVIDENCE',
  BACKPRESSURE:'BACKPRESSURE',
  DEPENDENCY_BLOCKED:'DEPENDENCY_BLOCKED',
  CANCELLED:'CANCELLED',
  SUPERSEDED:'SUPERSEDED',
  NOT_REQUIRED:'NOT_REQUIRED',
  PROVIDER_UNAVAILABLE:'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT:'PROVIDER_TIMEOUT',
});

const KINDS=new Set(Object.values(CausalReceiptKind));
const STATES=new Set(Object.values(CausalLifecycleState));
const REASONS=new Set(Object.values(CausalReasonCode));

export function normalizeCausalCause(input={}){
  return Object.freeze({
    eventType:input.eventType==null?null:String(input.eventType),
    eventId:input.eventId==null?null:String(input.eventId),
    correlationId:input.correlationId==null?null:String(input.correlationId),
    parentReceiptId:input.parentReceiptId==null?null:String(input.parentReceiptId),
    producerId:input.producerId==null?null:String(input.producerId),
    consumerId:input.consumerId==null?null:String(input.consumerId),
    ownerId:input.ownerId==null?null:String(input.ownerId),
    chatId:input.chatId==null?null:String(input.chatId),
    turnId:input.turnId==null?null:String(input.turnId),
    generationId:input.generationId==null?null:String(input.generationId),
    causationId:input.causationId==null?null:String(input.causationId),
    sceneId:input.sceneId==null?null:String(input.sceneId),
    turnRevision:Number.isFinite(Number(input.turnRevision))?Number(input.turnRevision):null,
    sourceRevisionRefs:uniq(input.sourceRevisionRefs),
    worldRevision:Number.isFinite(Number(input.worldRevision))?Number(input.worldRevision):null,
    sceneRevision:Number.isFinite(Number(input.sceneRevision))?Number(input.sceneRevision):null,
  });
}

export function causalObligationMatchesSelection(obligation={},selection={}){
  const cause=obligation?.cause??{},payload=obligation?.payload??{};
  const actual=(key)=>cause[key]??payload[key]??null;
  for(const key of ['chatId','turnId','generationId','correlationId']){
    if(selection?.[key]==null)continue;
    const value=actual(key);
    if(value==null||String(value)!==String(selection[key]))return false;
  }
  for(const key of ['worldRevision','sceneRevision']){
    if(selection?.[key]==null)continue;
    const value=obligation?.[key]??cause[key]??payload[key]??null;
    if(value==null||Number(value)!==Number(selection[key]))return false;
  }
  return true;
}

export function createCausalReceipt({
  id,kind,lifecycleState,reasonCode,taskId=null,taskType=null,owner=null,producerId=null,consumerId=null,
  parentReceiptId=null,workerId=null,durationMs=null,ownerAccepted=null,cause={},metadata={},
}={}){
  if(!id)throw new TypeError('CausalReceipt.id is required');
  if(!KINDS.has(kind))throw new TypeError('Unsupported CausalReceipt.kind: '+kind);
  if(!STATES.has(lifecycleState))throw new TypeError('Unsupported CausalReceipt.lifecycleState: '+lifecycleState);
  if(!REASONS.has(reasonCode))throw new TypeError('Unsupported CausalReceipt.reasonCode: '+reasonCode);
  const fence=normalizeCausalCause({...cause,producerId:producerId??cause?.producerId,consumerId:consumerId??cause?.consumerId,parentReceiptId:parentReceiptId??cause?.parentReceiptId,ownerId:owner??cause?.ownerId});
  return Object.freeze({
    kind:'CausalOwnerReceipt',contractVersion:1,id:String(id),eventKind:kind,lifecycleState,reasonCode,
    taskId:taskId==null?null:String(taskId),taskType:taskType==null?null:String(taskType),owner:owner==null?null:String(owner),
    producerId:producerId==null?fence.producerId:String(producerId),consumerId:consumerId==null?fence.consumerId:String(consumerId),
    parentReceiptId:parentReceiptId==null?fence.parentReceiptId:String(parentReceiptId),workerId:workerId==null?null:String(workerId),
    durationMs:Number.isFinite(Number(durationMs))?Math.max(0,Number(durationMs)):null,
    ownerAccepted:ownerAccepted==null?null:Boolean(ownerAccepted),
    chatId:fence.chatId,turnId:fence.turnId,generationId:fence.generationId,correlationId:fence.correlationId,turnRevision:fence.turnRevision,
    sourceRevisionRefs:[...fence.sourceRevisionRefs],worldRevision:fence.worldRevision,sceneRevision:fence.sceneRevision,
    metadata:clone(metadata??{}),
    rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
    authorityGranted:false,canonicalMutation:false,settlementPerformed:kind===CausalReceiptKind.SETTLEMENT,
  });
}

export function causalReceiptContract(){
  return Object.freeze({
    kind:'CausalOwnerReceiptContract',contractVersion:1,
    kinds:[...KINDS],lifecycleStates:[...STATES],reasonCodes:[...REASONS],
    requiredIdentity:['chatId','turnId','generationId','correlationId'],
    boundedSourceRevisionRefs:32,
    prohibitedPayloads:['rawPrompt','storyText','loreBodies','credentials','hiddenReasoning'],
    configuredIsNotExecution:true,scheduledIsNotExecution:true,ownerAcceptanceMustBeExplicit:true,
  });
}
