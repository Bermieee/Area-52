const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();
const req=(value,name)=>{if(typeof value!=='string'||!value.trim())throw new TypeError(name+' must be a non-empty string');return value.trim();};
const finite=(value)=>Number.isFinite(Number(value))?Number(value):null;

export const CAUSAL_OWNER_RECEIPT_VERSION='1.0.0';

export const CausalLifecycleState=Object.freeze({
  PLANNED:'PLANNED',
  PUBLISHED:'PUBLISHED',
  QUALIFIED:'QUALIFIED',
  ATTEMPTED:'ATTEMPTED',
  RETURNED:'RETURNED',
  OWNER_ACCEPTED:'OWNER_ACCEPTED',
  OWNER_REJECTED:'OWNER_REJECTED',
  DONE:'DONE',
  SKIPPED:'SKIPPED',
  DEFERRED:'DEFERRED',
  BLOCKED:'BLOCKED',
  FAILED:'FAILED',
  STALE:'STALE',
  LATE:'LATE',
  TIMED_OUT:'TIMED_OUT',
  UNAVAILABLE:'UNAVAILABLE',
  DEGRADED:'DEGRADED',
  SEALED:'SEALED',
  COMPILED_AND_SEALED:'COMPILED_AND_SEALED',
  OBSERVED:'OBSERVED',
  RECORDED:'RECORDED',
  NO_EVIDENCE:'NO_EVIDENCE',
});

export const CausalOwnerReason=Object.freeze({
  EVIDENCE_PUBLISHED:'EVIDENCE_PUBLISHED',
  OWNER_STAGE_RECEIPT_NOT_PUBLISHED:'OWNER_STAGE_RECEIPT_NOT_PUBLISHED',
  NO_WORK_WARRANTED:'NO_WORK_WARRANTED',
  OPTIONAL_RESOURCE_UNAVAILABLE:'OPTIONAL_RESOURCE_UNAVAILABLE',
  OPTIONAL_RESOURCE_NOT_REQUIRED:'OPTIONAL_RESOURCE_NOT_REQUIRED',
  PREREQUISITE_PENDING:'PREREQUISITE_PENDING',
  OWNER_ACCEPTANCE_PENDING:'OWNER_ACCEPTANCE_PENDING',
  OWNER_ACCEPTED:'OWNER_ACCEPTED',
  OWNER_REJECTED:'OWNER_REJECTED',
  EXECUTION_FAILED:'EXECUTION_FAILED',
  RESULT_STALE:'RESULT_STALE',
  RESULT_LATE:'RESULT_LATE',
  RESULT_TIMED_OUT:'RESULT_TIMED_OUT',
  RESULT_UNAVAILABLE:'RESULT_UNAVAILABLE',
  DEGRADED_FALLBACK:'DEGRADED_FALLBACK',
  HOST_OBSERVATION_NOT_PUBLISHED:'HOST_OBSERVATION_NOT_PUBLISHED',
  RETRIEVAL_SKIPPED:'RETRIEVAL_SKIPPED',
  LEARNING_PENDING:'LEARNING_PENDING',
  SETTLEMENT_PENDING:'SETTLEMENT_PENDING',
});

const STATES=new Set(Object.values(CausalLifecycleState));
const REASONS=new Set(Object.values(CausalOwnerReason));

export function createCausalOwnerEvent({
  selection={},stage,producer,consumer,lifecycleState=CausalLifecycleState.PUBLISHED,
  reasonCode=CausalOwnerReason.EVIDENCE_PUBLISHED,receiptId=null,parentReceiptId=null,
  durationMs=null,ownerAccepted=null,sourceRevisionRefs=null,worldRevision=null,sceneRevision=null,
  evidenceKind=null,
}={}){
  if(!STATES.has(lifecycleState))throw new TypeError('Unsupported causal lifecycle state: '+lifecycleState);
  if(!REASONS.has(reasonCode))throw new TypeError('Unsupported causal reason code: '+reasonCode);
  const boundedRefs=uniq(sourceRevisionRefs??selection.sourceRevisionRefs??[]).slice(0,128);
  return Object.freeze({
    kind:'CausalOwnerEvent',contractVersion:CAUSAL_OWNER_RECEIPT_VERSION,
    stage:req(stage,'stage'),producer:req(producer,'producer'),consumer:req(consumer,'consumer'),
    chatId:selection.chatId==null?null:String(selection.chatId),
    turnId:selection.turnId==null?null:String(selection.turnId),
    generationId:selection.generationId==null?null:String(selection.generationId),
    correlationId:selection.correlationId==null?null:String(selection.correlationId),
    receiptId:receiptId==null?null:String(receiptId),parentReceiptId:parentReceiptId==null?null:String(parentReceiptId),
    lifecycleState,reasonCode,durationMs:finite(durationMs),
    ownerAccepted:typeof ownerAccepted==='boolean'?ownerAccepted:null,
    worldRevision:finite(worldRevision??selection.worldRevision),
    sceneRevision:finite(sceneRevision??selection.sceneRevision),
    sourceRevisionRefs:boundedRefs,evidenceKind:evidenceKind==null?null:String(evidenceKind).slice(0,160),
    rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
    authorityGranted:false,canonicalMutationAuthority:false,
  });
}

export function createNoEvidenceCausalOwnerEvent(input={}){
  return createCausalOwnerEvent({
    ...clone(input),lifecycleState:CausalLifecycleState.NO_EVIDENCE,
    reasonCode:input.reasonCode??CausalOwnerReason.OWNER_STAGE_RECEIPT_NOT_PUBLISHED,
    receiptId:null,ownerAccepted:null,
  });
}

export function causalOwnerReceiptContract(){
  return Object.freeze({
    kind:'CausalOwnerReceiptContract',contractVersion:CAUSAL_OWNER_RECEIPT_VERSION,
    identity:['chatId','turnId','generationId','correlationId'],
    causal:['stage','producer','consumer','receiptId','parentReceiptId'],
    fences:['worldRevision','sceneRevision','sourceRevisionRefs'],
    lifecycle:['lifecycleState','durationMs','reasonCode','ownerAccepted'],
    missingEvidenceState:CausalLifecycleState.NO_EVIDENCE,
    prohibitedPayloads:['rawPrompt','storyText','loreBodies','credentials','hiddenReasoning'],
    inferenceAllowed:false,
  });
}
