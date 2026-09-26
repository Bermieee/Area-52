import { buildBoundedProviderPayload, assertProviderPayloadBoundary } from './provider-payload-boundary.js';
import { normalizeProviderUsageReceipt } from './usage-receipt.js';

export const PROVIDER_EXECUTION_CONTRACT_VERSION='1.0.0';

export function createProviderExecutionRequest(task,{providerProfileId,input={},sourceReferences=[],selectedContext=[],diagnosticMetadata={}}={}){
  if(!task?.taskId)throw new TypeError('CognitiveTask is required');
  if(typeof providerProfileId!=='string'||!providerProfileId)throw new TypeError('providerProfileId is required');
  const payload=buildBoundedProviderPayload({
    taskSlice:{
      taskId:task.taskId,taskType:task.taskType,requiredCapabilities:task.requiredCapabilities,optionalCapabilities:task.optionalCapabilities,
      resultClass:task.resultClass,softDeadline:task.softDeadline,hardDeadline:task.hardDeadline,input,
    },
    sourceReferences,selectedContext,diagnosticMetadata,
  });
  assertProviderPayloadBoundary(payload);
  return Object.freeze({
    kind:'ProviderExecutionRequest',contractVersion:PROVIDER_EXECUTION_CONTRACT_VERSION,taskId:task.taskId,turnId:task.turnId,
    correlationId:task.correlationId,providerProfileId,payload,authorityGranted:false,schedulingDecision:null,
  });
}

export function normalizeProviderTransportResult(value,{providerProfileId,providerId=null,modelId=null,capability=null,pricing=null}={}){
  if(!value||typeof value!=='object')throw new TypeError('ProviderTransportResult is required');
  if(typeof value.text!=='string')throw new TypeError('ProviderTransportResult.text is required');
  const startedAt=Number(value.startedAt??0),completedAt=Number(value.completedAt??startedAt),latencyMs=Number(value.latencyMs??completedAt-startedAt);
  if(!Number.isFinite(startedAt)||!Number.isFinite(completedAt)||completedAt<startedAt)throw new TypeError('invalid provider timing');
  return Object.freeze({
    kind:'ProviderTransportResult',contractVersion:PROVIDER_EXECUTION_CONTRACT_VERSION,providerProfileId,
    providerId:providerId??value.providerId??null,modelId:modelId??value.modelId??null,text:value.text,finishReason:value.finishReason??null,
    startedAt,completedAt,latencyMs,
    usageReceipt:normalizeProviderUsageReceipt({usage:value.usage??{},providerProfileId,capability,latencyMs,pricing}),
    metadata:structuredClone(value.metadata??{}),authorityGranted:false,
  });
}
