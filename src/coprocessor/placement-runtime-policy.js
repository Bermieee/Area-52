import { Placement, ResultClass } from './constants.js';
import { classifyFreshness } from './validation.js';

export function executionPlacementPolicy(task){
  const deep=task.placement===Placement.DEEP;
  return Object.freeze({
    taskId:task.taskId,executionClass:deep?'DEEP':'HOT',
    preemptionPolicy:deep?'YIELD_TO_FOREGROUND':'FOREGROUND_PRIORITY',
    yieldPolicy:deep?(task.batchMetadata?.yieldSafety??'CHECKPOINT_ONLY'):'FOREGROUND_BOUND',
    resumeRequired:deep && (task.batchMetadata?.yieldSafety??'NOT_APPLICABLE')!=='NOT_APPLICABLE',
    foregroundReserveEligibility:!deep && task.resultClass!==ResultClass.DEFERRED,
    runtimeDecisionAuthority:false,
  });
}

export function createDeepCheckpoint(task,{checkpointId,completedUnits=0,remainingUnits=null,payloadRef=null}={}){
  if(task.placement!==Placement.DEEP)throw new TypeError('Deep checkpoint requires a DEEP task');
  return Object.freeze({
    kind:'CoprocessorDeepCheckpoint',checkpointId:checkpointId??\`checkpoint:\${task.taskId}:\${completedUnits}\`,taskId:task.taskId,
    resumeIdentity:task.metadata?.resumeIdentity??\`resume:\${task.taskId}:\${task.dedupeKey}\`,
    completedUnits:Math.max(0,Number(completedUnits)||0),remainingUnits:remainingUnits==null?null:Math.max(0,Number(remainingUnits)||0),
    payloadRef:payloadRef==null?null:structuredClone(payloadRef),sourceRevisionSet:[...task.sourceRevisionSet],worldRevision:task.worldRevision,
    sceneRevision:task.sceneRevision,characterStateRevision:task.characterStateRevision,intentFingerprint:task.intentFingerprint,
    restartRequired:false,canonicalAuthority:false,
  });
}

export function evaluateDeepResume(checkpoint,currentRevisionSet){
  const freshness=classifyFreshness(checkpoint,currentRevisionSet);
  if(freshness!=='FRESH')return Object.freeze({action:'INVALIDATE_AND_REPLAN',freshness,resume:false,restartFromZero:false});
  return Object.freeze({action:'RESUME_FROM_CHECKPOINT',freshness,resume:true,restartFromZero:false});
}
