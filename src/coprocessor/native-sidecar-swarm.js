import { FailureCode, Freshness, ResultClass, TelemetryEvent } from './constants.js';
import { DynamicFanOutPlanner } from './fanout-planner.js';
import { JevDecisionCore } from './jev-decision-core.js';
import { classifyFreshness, validateWorkerOutput } from './validation.js';
import { createCoprocessorChoiceExecutionTrace, toCoreCognitiveChoiceContribution } from './cognitive-choice-execution.js';
import { sha256Hex } from './browser-compat.js';
import { emitTelemetry } from './telemetry.js';

export const NATIVE_SIDECAR_SWARM_VERSION='1.0.0';

export const NativeSwarmResultState=Object.freeze({
  READY_FOR_CORE:'READY_FOR_CORE',
  REJECTED_STALE:'REJECTED_STALE',
  REJECTED_INVALID:'REJECTED_INVALID',
  REJECTED_LATE:'REJECTED_LATE',
  FAILED:'FAILED',
  UNAVAILABLE:'UNAVAILABLE',
  PARKED:'PARKED',
});

const AUTHORITY_SAFE=new Set(['UNRESOLVED','INFERRED']);

export class NativeSidecarSwarm{
  constructor({
    connections,planner=null,telemetry=null,now=()=>Date.now(),maxHistory=64,maxCheckpointBytes=131072,maxProvidersPerTask=2,
  }={}){
    if(!connections||typeof connections.readModel!=='function'||typeof connections.executeTask!=='function')throw new TypeError('NativeSidecarSwarm requires CoprocessorResourceConnections');
    this.connections=connections;
    this.planner=planner??new DynamicFanOutPlanner();
    this.telemetry=telemetry;
    this.now=now;
    this.maxHistory=Math.max(8,Number(maxHistory)||64);
    this.maxCheckpointBytes=Math.max(16384,Number(maxCheckpointBytes)||131072);
    this.maxProvidersPerTask=Math.max(1,Number(maxProvidersPerTask)||2);
    this.turns=new Map();
    this.turnOrder=[];
    this.jev=new JevDecisionCore({providerExecutor:this.connections.createJevProviderExecutor()});
  }

  prepareTurn({turnEvent,plannerInput={},ownerSignals={},choicePolicyVersion='sidecar-choice-v1'}={}){
    if(!turnEvent?.turnId||!turnEvent?.correlationId)throw new TypeError('turnEvent with turnId and correlationId is required');
    const resources=this.connections.readModel();
    const profiles=this.connections.profiles.list();
    const plan=this.planner.planChoice({
      ...plannerInput,
      turnEvent,
      capabilityProfiles:profiles,
      ownerSignals,
      choicePolicyVersion,
      telemetry:this.telemetry,
      availableCapabilities:resources.activeCapabilities,
      resourceCount:Math.max(1,resources.readyResourceCount),
    });
    const checkpoint=createSwarmCheckpoint({
      turnEvent,proposal:plan.choiceProposal,tasks:plan.fanOutPlan.tasks,createdAt:this.now(),maxBytes:this.maxCheckpointBytes,
    });
    emitTelemetry(this.telemetry,TelemetryEvent.SWARM_TURN_PLANNED,{
      turnId:turnEvent.turnId,correlationId:turnEvent.correlationId,proposalId:plan.choiceProposal.proposalId,
      plannedWorkerCount:plan.fanOutPlan.plannedWorkerCount,readyResourceCount:resources.readyResourceCount,
    });
    return Object.freeze({kind:'NativeSidecarSwarmPreparedTurn',fanOutPlan:plan.fanOutPlan,choiceProposal:plan.choiceProposal,checkpoint,resourceSnapshot:resources});
  }

  async runTurn(input={}){
    const prepared=this.prepareTurn(input);
    return this.executeCheckpoint(prepared.checkpoint,{
      inputResolver:input.inputResolver,
      currentRevisionState:input.currentRevisionState??input.turnEvent,
      sealed:input.sealed??false,
      signal:input.signal??null,
      jevRequest:input.jevRequest??null,
      ownerSignals:input.ownerSignals??{},
      maxProvidersPerTask:input.maxProvidersPerTask??this.maxProvidersPerTask,
    });
  }

  async executeCheckpoint(checkpointInput,{
    inputResolver=()=>({}),currentRevisionState=null,sealed=false,signal=null,jevRequest=null,ownerSignals={},
    maxProvidersPerTask=this.maxProvidersPerTask,
  }={}){
    const checkpoint=validateCheckpoint(checkpointInput,this.maxCheckpointBytes);
    const current=await resolveValue(currentRevisionState,checkpoint.revisionFence);
    const freshness=classifyFreshness(checkpoint.revisionFence,current??checkpoint.revisionFence);
    if(freshness!==Freshness.FRESH){
      const records=checkpoint.pendingTasks.map(task=>rejectedRecord(task,NativeSwarmResultState.REJECTED_STALE,FailureCode.STALE_RESULT));
      return this.#finish(checkpoint,{records,jevReceipt:null,checkpoint:null,resumeStatus:'STALE_REJECTED'});
    }

    emitTelemetry(this.telemetry,TelemetryEvent.SWARM_RESUMED,{
      checkpointId:checkpoint.checkpointId,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,pendingTaskCount:checkpoint.pendingTasks.length,
    });

    const deferred=checkpoint.pendingTasks.filter(task=>task.resultClass===ResultClass.DEFERRED);
    const foreground=checkpoint.pendingTasks.filter(task=>task.resultClass!==ResultClass.DEFERRED);
    const records=await this.#executeForeground(foreground,{inputResolver,currentRevisionState,sealed,signal,maxProvidersPerTask,checkpoint});
    for(const task of deferred)records.push(parkedRecord(task));

    let jevReceipt=null;
    const jevOption=checkpoint.proposal.options.find(option=>option.optionId==='jev-adjudication');
    const shouldRunJev=checkpoint.proposal.ownerStageRequests?.jevAdjudication===true&&jevOption?.disposition==='NOMINATED';
    if(shouldRunJev&&jevRequest){
      jevReceipt=await this.jev.decide(jevRequest,{currentRevisionState,sealed,signal});
    }

    const nextCheckpoint=deferred.length?createSwarmCheckpoint({
      turnEvent:{turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,...checkpoint.revisionFence},
      proposal:checkpoint.proposal,tasks:deferred,createdAt:this.now(),maxBytes:this.maxCheckpointBytes,parentCheckpointId:checkpoint.checkpointId,
    }):null;
    return this.#finish(checkpoint,{records,jevReceipt,checkpoint:nextCheckpoint,resumeStatus:'EXECUTED'});
  }

  readModel(){
    const resources=this.connections.readModel();
    const turns=this.turnOrder.map(id=>this.turns.get(id)).filter(Boolean);
    return deepFreeze({
      kind:'NativeSidecarSwarmReadModel',contractVersion:NATIVE_SIDECAR_SWARM_VERSION,
      readyResourceCount:resources.readyResourceCount,activeCapabilities:[...resources.activeCapabilities],
      turnCount:turns.length,lastTurn:turns.at(-1)??null,
      authority:{truth:false,precision:false,settlement:false,canonicalMutation:false,finalChoice:false,contextSeal:false},
    });
  }

  readTurn(turnId){return clone(this.turns.get(String(turnId))??null);}

  async #executeForeground(tasks,{inputResolver,currentRevisionState,sealed,signal,maxProvidersPerTask,checkpoint}){
    const pending=tasks.map(task=>({task,attempt:1,excluded:new Set()}));
    const records=[];
    while(pending.length){
      if(signal?.aborted){
        for(const item of pending.splice(0))records.push(rejectedRecord(item.task,NativeSwarmResultState.FAILED,FailureCode.PROVIDER_ABORTED));
        break;
      }
      const round=[];const reserved=new Map();
      for(let index=0;index<pending.length;){
        const item=pending[index],task=item.task;
        if(this.now()>=task.hardDeadline){
          records.push(rejectedRecord(task,NativeSwarmResultState.REJECTED_LATE,FailureCode.DEADLINE_MISS,{attempt:item.attempt,late:true}));
          pending.splice(index,1);continue;
        }
        const candidates=this.#eligible(task,item.excluded,reserved);
        if(!candidates.length){index+=1;continue;}
        const profile=candidates[0];reserved.set(profile.profileId,(reserved.get(profile.profileId)??0)+1);
        pending.splice(index,1);
        round.push(this.#executeAssigned(item,profile,{inputResolver,currentRevisionState,sealed,signal,checkpoint}));
      }
      if(!round.length){
        for(const item of pending.splice(0))records.push(rejectedRecord(item.task,NativeSwarmResultState.UNAVAILABLE,FailureCode.CAPABILITY_UNAVAILABLE,{attempt:item.attempt}));
        break;
      }
      const outcomes=await Promise.all(round);
      for(const outcome of outcomes){
        if(outcome.retry&&outcome.item.attempt<Math.max(1,Number(maxProvidersPerTask)||1)&&this.now()<outcome.item.task.hardDeadline){
          outcome.item.attempt+=1;outcome.item.excluded.add(outcome.profile.profileId);pending.push(outcome.item);
        }else records.push(outcome.record);
      }
    }
    return records;
  }

  #eligible(task,excluded,reserved=new Map()){
    return this.connections.profiles.eligibleProfiles(task,{
      contextTokens:0,maxCostClass:'HIGH',requireStructuredOutput:true,expectedOutputTokens:Number(task.metadata?.expectedOutputTokens??0),
    }).filter(profile=>!excluded.has(profile.profileId)&&this.connections.adapters.get(profile.providerId)
      && Number(profile.currentLoad??0)+Number(reserved.get(profile.profileId)??0)<Number(profile.concurrencyCapacity??profile.maxConcurrency??1));
  }

  async #executeAssigned(item,profile,{inputResolver,currentRevisionState,sealed,signal,checkpoint}){
    const task=item.task,resourceId=profile.profileMetadata?.resourceId??null;
    emitTelemetry(this.telemetry,TelemetryEvent.SWARM_TASK_ASSIGNED,{
      turnId:task.turnId,correlationId:task.correlationId,taskId:task.taskId,taskType:task.taskType,
      providerProfileId:profile.profileId,providerId:profile.providerId,workerId:profile.workerId,resourceId,attempt:item.attempt,
    });
    const started=this.now();
    const deadlineController=new AbortController();
    const detach=linkAbort(signal,deadlineController);
    const remaining=Math.max(0,task.hardDeadline-this.now());
    const timer=setTimeout(()=>deadlineController.abort('foreground-deadline'),remaining);
    try{
      const input=await inputResolver(task,{checkpoint,profile,attempt:item.attempt});
      const result=await this.connections.executeTask(task,{input,profileId:profile.profileId,signal:deadlineController.signal,attempt:item.attempt});
      const current=await resolveValue(currentRevisionState,checkpoint.revisionFence);
      const validation=await validateWorkerOutput(result,task,{currentRevisionSet:current??checkpoint.revisionFence,attempt:item.attempt,maxRetries:0});
      const isSealed=Boolean(await resolveValue(sealed,false));
      const late=isSealed||result.completedAt>task.hardDeadline||this.now()>task.hardDeadline;
      let record;
      if(late)record=resultRecord(task,result,profile,NativeSwarmResultState.REJECTED_LATE,{failureCode:FailureCode.DEADLINE_MISS,attempt:item.attempt,late:true});
      else if(!validation.valid)record=resultRecord(task,result,profile,NativeSwarmResultState.REJECTED_INVALID,{failureCode:validation.failure?.code??FailureCode.SCHEMA_VALIDATION_FAILED,attempt:item.attempt,invalid:true});
      else if(validation.freshness!==Freshness.FRESH||validation.failure?.code===FailureCode.STALE_RESULT)record=resultRecord(task,result,profile,NativeSwarmResultState.REJECTED_STALE,{failureCode:FailureCode.STALE_RESULT,attempt:item.attempt,stale:true});
      else if(!AUTHORITY_SAFE.has(String(result.authorityClass??'').toUpperCase()))record=resultRecord(task,result,profile,NativeSwarmResultState.REJECTED_INVALID,{failureCode:FailureCode.AUTHORITY_VIOLATION,attempt:item.attempt,invalid:true});
      else record=resultRecord(task,result,profile,NativeSwarmResultState.READY_FOR_CORE,{attempt:item.attempt,fallbackUsed:item.attempt>1});
      emitTelemetry(this.telemetry,TelemetryEvent.SWARM_TASK_RESULT,{taskId:task.taskId,turnId:task.turnId,state:record.state,providerId:record.providerId,workerId:record.workerId,failureCode:record.failureCode,latencyMs:record.latencyMs,fallbackUsed:record.fallbackUsed,resourceId:record.resourceId});
      return{item,profile,record,retry:false};
    }catch(error){
      const deadlineMiss=deadlineController.signal.aborted&&deadlineController.signal.reason==='foreground-deadline';
      const code=deadlineMiss?FailureCode.DEADLINE_MISS:(error?.code??FailureCode.PROVIDER_FAILURE);
      const record=rejectedRecord(task,deadlineMiss?NativeSwarmResultState.REJECTED_LATE:NativeSwarmResultState.FAILED,code,{
        attempt:item.attempt,providerProfileId:profile.profileId,providerId:profile.providerId,workerId:profile.workerId,resourceId,
        startedAt:started,completedAt:this.now(),late:deadlineMiss,fallbackUsed:item.attempt>1,
      });
      const retry=!deadlineMiss&&retryable(code);
      emitTelemetry(this.telemetry,TelemetryEvent.SWARM_TASK_RESULT,{taskId:task.taskId,turnId:task.turnId,state:record.state,providerId:record.providerId,workerId:record.workerId,failureCode:record.failureCode,latencyMs:record.latencyMs});
      return{item,profile,record,retry};
    }finally{clearTimeout(timer);detach();}
  }

  #finish(sourceCheckpoint,{records,jevReceipt,checkpoint,resumeStatus}){
    const providerExecutions=records.map(record=>({
      taskId:record.taskId,choiceOptionId:record.optionId,executionResourceId:record.resourceId,providerProfileId:record.providerProfileId,providerId:record.providerId,workerId:record.workerId,
      startedAt:record.startedAt,completedAt:record.completedAt,latencyMs:record.latencyMs,resultId:record.result?.resultId??null,
      failureCode:record.failureCode,fallbackUsed:record.fallbackUsed,
    }));
    const resultRoutes=records.map(record=>({taskId:record.taskId,late:record.late,freshness:record.stale?'STALE':record.invalid?'INVALID':'FRESH'}));
    const jevObservation=jevReceipt?{
      ran:!['JEV_SKIPPED','JEV_UNAVAILABLE'].includes(jevReceipt.serviceStatus),status:jevReceipt.serviceStatus,
      abstained:jevReceipt.abstained,unresolved:jevReceipt.outcome==='UNRESOLVED',late:Boolean(jevReceipt.admission?.late),stale:jevReceipt.outcome==='STALE',
      providerProfileId:jevReceipt.providerProvenance?.providerProfileId??null,decisionRef:jevReceipt.receiptId??jevReceipt.decisionId??null,
      latencyMs:jevReceipt.latencyMetadata?.totalLatencyMs??null,
    }:null;
    const executionTrace=createCoprocessorChoiceExecutionTrace({proposal:sourceCheckpoint.proposal,providerExecutions,resultRoutes,jevObservation,telemetry:this.telemetry});
    const choiceContribution=toCoreCognitiveChoiceContribution({proposal:sourceCheckpoint.proposal,executionTrace});
    const readyResults=records.filter(record=>record.state===NativeSwarmResultState.READY_FOR_CORE).map(record=>record.result);
    const contribution=deepFreeze({
      kind:'NativeSidecarSwarmContribution',contractVersion:NATIVE_SIDECAR_SWARM_VERSION,
      turnId:sourceCheckpoint.turnId,correlationId:sourceCheckpoint.correlationId,proposalId:sourceCheckpoint.proposal.proposalId,
      choiceContribution,executionTrace,resultsForOwner:readyResults,jevReceipt:clone(jevReceipt),
      resultSummary:records.map(publicRecord),resumeStatus,
      ownerAdmissionRequired:true,authority:'NONE',truthAuthority:false,precisionAuthority:false,settlementAuthority:false,canonicalMutationAuthority:false,finalChoiceAuthority:false,contextSealAuthority:false,
    });
    const summary=deepFreeze({
      turnId:sourceCheckpoint.turnId,correlationId:sourceCheckpoint.correlationId,proposalId:sourceCheckpoint.proposal.proposalId,at:this.now(),resumeStatus,
      counts:countStates(records),assignments:records.map(publicRecord),
      jev:jevReceipt?{serviceStatus:jevReceipt.serviceStatus,outcome:jevReceipt.outcome,abstained:Boolean(jevReceipt.abstained),providerProfileId:jevReceipt.providerProvenance?.providerProfileId??null}:null,
      nextCheckpointId:checkpoint?.checkpointId??null,
    });
    this.#remember(summary);
    if(checkpoint)emitTelemetry(this.telemetry,TelemetryEvent.SWARM_CHECKPOINTED,{checkpointId:checkpoint.checkpointId,turnId:checkpoint.turnId,pendingTaskCount:checkpoint.pendingTasks.length});
    return Object.freeze({kind:'NativeSidecarSwarmTurnResult',contribution,checkpoint,readModel:summary});
  }

  #remember(summary){
    const id=summary.turnId;if(!this.turns.has(id))this.turnOrder.push(id);this.turns.set(id,summary);
    while(this.turnOrder.length>this.maxHistory)this.turns.delete(this.turnOrder.shift());
  }
}

export function createSwarmCheckpoint({turnEvent,proposal,tasks=[],createdAt=Date.now(),maxBytes=131072,parentCheckpointId=null}={}){
  if(proposal?.kind!=='CoprocessorChoiceProposal')throw new TypeError('CoprocessorChoiceProposal required');
  const revisionFence={
    sourceRevisionSet:[...(turnEvent?.sourceRevisionSet??proposal.revisionFence?.sourceRevisionSet??[])],
    worldRevision:Number(turnEvent?.worldRevision??proposal.revisionFence?.worldRevision??0),
    sceneRevision:Number(turnEvent?.sceneRevision??proposal.revisionFence?.sceneRevision??0),
    characterStateRevision:Number(turnEvent?.characterStateRevision??proposal.revisionFence?.characterStateRevision??0),
  };
  const base={turnId:String(turnEvent?.turnId??proposal.turnId),correlationId:String(turnEvent?.correlationId??proposal.correlationId),proposalId:proposal.proposalId,
    revisionFence,taskIds:tasks.map(task=>task.taskId),parentCheckpointId};
  const checkpoint=deepFreeze({
    kind:'CoprocessorSwarmCheckpoint',contractVersion:NATIVE_SIDECAR_SWARM_VERSION,
    checkpointId:'cop-swarm:'+sha256Hex(stable(base)).slice(0,24),createdAt:Number(createdAt),parentCheckpointId,
    turnId:base.turnId,correlationId:base.correlationId,revisionFence:deepFreeze(revisionFence),proposal:clone(proposal),
    pendingTasks:tasks.map(clone),authority:'NONE',
  });
  assertBytes(checkpoint,maxBytes,'swarm checkpoint');
  return checkpoint;
}

export function validateCheckpoint(value,maxBytes=131072){
  if(value?.kind!=='CoprocessorSwarmCheckpoint'||value.contractVersion!==NATIVE_SIDECAR_SWARM_VERSION)throw new TypeError('unsupported CoprocessorSwarmCheckpoint');
  assertBytes(value,maxBytes,'swarm checkpoint');
  if(value.proposal?.proposalId!==value.proposalId)throw new TypeError('checkpoint proposal identity mismatch');
  if(value.proposal?.turnId!==value.turnId||value.proposal?.correlationId!==value.correlationId)throw new TypeError('checkpoint turn identity mismatch');
  if(!Array.isArray(value.pendingTasks))throw new TypeError('checkpoint pendingTasks must be an array');
  for(const task of value.pendingTasks){
    if(task?.kind!=='CognitiveTask'||task.turnId!==value.turnId||task.correlationId!==value.correlationId)throw new TypeError('checkpoint task identity mismatch');
    if(classifyFreshness(task.inputRevisionSet,value.revisionFence)!==Freshness.FRESH)throw new TypeError('checkpoint task revision fence mismatch');
  }
  return deepFreeze(clone(value));
}

function resultRecord(task,result,profile,state,extra={}){
  return deepFreeze({
    taskId:task.taskId,optionId:task.metadata?.roleId??null,taskType:task.taskType,resultClass:task.resultClass,state,
    providerProfileId:profile.profileId,providerId:result.providerId,workerId:result.workerId,resourceId:profile.profileMetadata?.resourceId??null,
    startedAt:result.startedAt,completedAt:result.completedAt,latencyMs:result.latency,result,attempt:Number(extra.attempt??1),
    failureCode:extra.failureCode??null,fallbackUsed:Boolean(extra.fallbackUsed),late:Boolean(extra.late),stale:Boolean(extra.stale),invalid:Boolean(extra.invalid),
  });
}
function rejectedRecord(task,state,failureCode,extra={}){
  const startedAt=extra.startedAt??null,completedAt=extra.completedAt??null;
  return deepFreeze({
    taskId:task.taskId,optionId:task.metadata?.roleId??null,taskType:task.taskType,resultClass:task.resultClass,state,
    providerProfileId:extra.providerProfileId??null,providerId:extra.providerId??null,workerId:extra.workerId??null,resourceId:extra.resourceId??null,
    startedAt,completedAt,latencyMs:startedAt!=null&&completedAt!=null?Math.max(0,completedAt-startedAt):null,result:null,attempt:Number(extra.attempt??1),
    failureCode,fallbackUsed:Boolean(extra.fallbackUsed),late:Boolean(extra.late),stale:state===NativeSwarmResultState.REJECTED_STALE,invalid:state===NativeSwarmResultState.REJECTED_INVALID,
  });
}
function parkedRecord(task){return rejectedRecord(task,NativeSwarmResultState.PARKED,null);}
function publicRecord(record){return deepFreeze({taskId:record.taskId,optionId:record.optionId,taskType:record.taskType,resultClass:record.resultClass,state:record.state,
  providerProfileId:record.providerProfileId,providerId:record.providerId,workerId:record.workerId,resourceId:record.resourceId,attempt:record.attempt,
  resultId:record.result?.resultId??null,startedAt:record.startedAt,completedAt:record.completedAt,latencyMs:record.latencyMs,failureCode:record.failureCode,
  fallbackUsed:record.fallbackUsed,late:record.late,stale:record.stale,invalid:record.invalid});}
function countStates(records){const out=Object.fromEntries(Object.values(NativeSwarmResultState).map(state=>[state,0]));for(const record of records)out[record.state]+=1;return deepFreeze(out);}
function retryable(code){return [FailureCode.MALFORMED_OUTPUT,FailureCode.SCHEMA_INVALID,FailureCode.SCHEMA_VALIDATION_FAILED,FailureCode.SEMANTIC_VALIDATION_FAILED,FailureCode.PROVIDER_FAILURE,FailureCode.PROVIDER_TIMEOUT,FailureCode.CAPABILITY_UNAVAILABLE].includes(code);}
function linkAbort(signal,controller){if(!signal)return()=>{};const abort=()=>controller.abort(signal.reason??'caller-abort');if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});return()=>signal.removeEventListener?.('abort',abort);}
async function resolveValue(value,fallback){if(typeof value==='function')return await value();return value??fallback;}
function assertBytes(value,max,name){if(new TextEncoder().encode(JSON.stringify(value)).length>Number(max))throw new RangeError(name+' exceeds byte budget');}
function stable(v){if(Array.isArray(v))return'['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function clone(v){return v==null?v:structuredClone(v);}
function deepFreeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const x of Object.values(v))deepFreeze(x);return v;}
