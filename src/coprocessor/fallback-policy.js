import { ResultClass, ResultStatus } from './constants.js';
import { createWorkerResult } from './contracts.js';

export const CoprocessorFallbackMatrix=Object.freeze({
  HISTORIAN_RETRIEVAL:Object.freeze({policy:'DETERMINISTIC_RETRIEVAL',behavior:'use supplied candidate ordering; do not invent relevance'}),
  GRAPH_WALK:Object.freeze({policy:'CURRENT_STATE_LOOKUP',behavior:'use supplied bounded graph/state references'}),
  GREEN_ROOM:Object.freeze({policy:'OMIT_INFERRED_SHADOW_STATE',behavior:'omit ephemeral character inference'}),
  TRUTH_PRECISION:Object.freeze({policy:'PRESERVE_UNRESOLVED_AND_FUSED_ORDER',behavior:'preserve ambiguity and deterministic fused ranking'}),
  SPECULATIVE_WARMER:Object.freeze({policy:'FOREGROUND_RETRIEVAL',behavior:'perform normal foreground retrieval'}),
  CONSOLIDATION:Object.freeze({policy:'PRESERVE_RAW_EXPERIENCE',behavior:'raw experience remains intact'}),
  STREAM_TRUTH:Object.freeze({policy:'CONTINUE_UNVERIFIED',behavior:'generation continues without hard interception'}),
  RERANK:Object.freeze({policy:'DETERMINISTIC_FUSED_RANK',behavior:'use deterministic fusion'}),
});

export function fallbackForTask(task,{at=task.hardDeadline,input=null}={}){
  if(task.resultClass!==ResultClass.REQUIRED)return null;
  const spec=CoprocessorFallbackMatrix[task.taskType]??{policy:task.fallbackPolicy?.type??'DEGRADED_CONTINUE',behavior:'continue degraded'};
  const payload={lane:task.compilerLane,fallback:spec.policy,fallbackBehavior:spec.behavior,evidence:[]};
  if(task.taskType==='HISTORIAN_RETRIEVAL'&&input?.candidates)payload.refs=input.candidates.map(x=>x.ref);
  if(task.taskType==='TRUTH_PRECISION')payload.unresolved=true;
  return createWorkerResult({
    resultId:`fallback:${task.taskId}`,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,
    workerId:'deterministic-fallback',providerId:'area52:deterministic-fallback',modelId:null,
    capabilities:[...task.requiredCapabilities],status:ResultStatus.FALLBACK,payload,provenance:{fallback:true,policy:spec.policy},
    confidence:0,freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,intentFingerprint:task.intentFingerprint,
    startedAt:Number(at),completedAt:Number(at),latency:0,validationReceipt:{syntax:'PASS',deterministic:'FALLBACK'},
    authorityClass:task.taskType==='GREEN_ROOM'?'INFERRED':'UNRESOLVED',providerMetadata:{fallbackUsed:true},
  });
}
