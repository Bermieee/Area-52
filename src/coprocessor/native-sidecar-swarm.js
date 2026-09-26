import { FailureCode, Freshness, ResultClass, TelemetryEvent } from './constants.js';
import { DynamicFanOutPlanner } from './fanout-planner.js';
import { JevDecisionCore } from './jev-decision-core.js';
import { GatherCoordinator } from './gather-coordinator.js';
import { createWorkerResult } from './contracts.js';
import { classifyFreshness, validateWorkerOutput } from './validation.js';
import { ScatterAdmission, ScatterLayer, createLayeredScatterPlan, evaluateJevLayerAdmission, evaluateScatterAdmission, fallbackPayloadForTask, plannerSignalSnapshot } from './layered-scatter-policy.js';
import { createLayeredScatterReceipt, createScatterLayerReceipt, summarizeOptionalResourceStates } from './layered-scatter-telemetry.js';
import { createCoprocessorChoiceExecutionTrace, toCoreCognitiveChoiceContribution } from './cognitive-choice-execution.js';
import { sha256Hex } from './browser-compat.js';
import { emitTelemetry } from './telemetry.js';

export const NATIVE_SIDECAR_SWARM_VERSION='1.1.0';

export const NativeSwarmResultState=Object.freeze({
  READY_FOR_CORE:'READY_FOR_CORE',
  REJECTED_STALE:'REJECTED_STALE',
  REJECTED_INVALID:'REJECTED_INVALID',
  REJECTED_LATE:'REJECTED_LATE',
  FAILED:'FAILED',
  UNAVAILABLE:'UNAVAILABLE',
  PARKED:'PARKED',
  SKIPPED:'SKIPPED',
  FALLBACK:'FALLBACK',
});

const AUTHORITY_SAFE=new Set(['UNRESOLVED','INFERRED']);

export class NativeSidecarSwarm{
  constructor({
    connections,planner=null,telemetry=null,now=()=>Date.now(),maxHistory=64,maxCheckpointBytes=131072,maxProvidersPerTask=2,minimumJevExpectedValue=.65,
  }={}){
    if(!connections||typeof connections.readModel!=='function'||typeof connections.executeTask!=='function')throw new TypeError('NativeSidecarSwarm requires CoprocessorResourceConnections');
    this.connections=connections;
    this.planner=planner??new DynamicFanOutPlanner();
    this.telemetry=telemetry;
    this.now=now;
    this.maxHistory=Math.max(8,Number(maxHistory)||64);
    this.maxCheckpointBytes=Math.max(16384,Number(maxCheckpointBytes)||131072);
    this.maxProvidersPerTask=Math.max(1,Number(maxProvidersPerTask)||2);
    this.minimumJevExpectedValue=Math.max(0,Math.min(1,Number(minimumJevExpectedValue)||.65));
    this.turns=new Map();
    this.turnOrder=[];
    this.jev=new JevDecisionCore({providerExecutor:this.connections.createJevProviderExecutor()});
  }

  prepareTurn({turnEvent,plannerInput={},ownerSignals={},choicePolicyVersion='sidecar-choice-v1',chatId=null,generationId=null}={}){
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
      capabilityAliases:{'jev-adjudication':['SEMANTIC_JUDGMENT']},
    });
    const checkpoint=createSwarmCheckpoint({
      turnEvent,proposal:plan.choiceProposal,tasks:plan.fanOutPlan.tasks,createdAt:this.now(),maxBytes:this.maxCheckpointBytes,
      plannerSignals:plannerSignalSnapshot(plannerInput),identity:{chatId,generationId},
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
      return this.#finish(checkpoint,{records,jevReceipt:null,checkpoint:null,resumeStatus:'STALE_REJECTED',gatherBundle:null,gatherCompilerInput:null,layeredScatterReceipt:null});
    }

    emitTelemetry(this.telemetry,TelemetryEvent.SWARM_RESUMED,{
      checkpointId:checkpoint.checkpointId,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,pendingTaskCount:checkpoint.pendingTasks.length,
    });

    const waveStarted=this.now();
    const deferred=checkpoint.pendingTasks.filter(task=>task.resultClass===ResultClass.DEFERRED);
    const foreground=checkpoint.pendingTasks.filter(task=>task.resultClass!==ResultClass.DEFERRED);
    const gather=new GatherCoordinator({
      turnEvent:{turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,eventId:checkpoint.eventId??null,...checkpoint.revisionFence},
      plan:{tasks:foreground},currentRevisionSet:current??checkpoint.revisionFence,
    });
    const layerPlan=createLayeredScatterPlan({
      fanOutPlan:{kind:'FanOutPlan',turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,tasks:checkpoint.pendingTasks},
      plannerInput:checkpoint.plannerSignals??{},choiceProposal:checkpoint.proposal,
    });
    const records=[],layerRows=[];
    let gatherBundle=gather.bundle();
    let retainedBytes=0,peakRetainedBytes=0,legacyRetainedBytes=0,workAvoidedCount=0,fallbackCount=0;
    let physicalAttemptCount=0,physicalReturnedCount=0;

    const hotAt=this.now();
    const hotReceipt=createScatterLayerReceipt({
      ...checkpoint.identity,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,parentReceiptId:checkpoint.parentCheckpointId,
      layer:ScatterLayer.HOT_SIGNAL,trigger:'TURN_SIGNAL_AND_CURRENT_STATE',admission:'EVALUATED',reason:'CHEAP_DETERMINISTIC_SIGNALS_FIRST',
      startedAt:hotAt,completedAt:hotAt,durationMs:0,queueDepth:0,peakConcurrency:0,logicalJobCount:0,costClass:'FREE',
    });
    layerRows.push(hotReceipt);

    for(const layer of layerPlan.layers){
      if([ScatterLayer.HOT_SIGNAL,ScatterLayer.DEEP].includes(layer.layer))continue;
      const tasks=layer.tasks.filter(task=>task.resultClass!==ResultClass.DEFERRED);
      if(!tasks.length)continue;
      const layerStarted=this.now();
      const decisions=tasks.map(task=>({task,decision:evaluateScatterAdmission(task,{
        plannerInput:checkpoint.plannerSignals??{},completedRecords:records,gatherBundle,now:this.now(),hardDeadline:task.hardDeadline,
      })}));
      const admitted=[];let layerFallbacks=0,layerSkipped=0;
      for(const row of decisions){
        if(row.decision.admission===ScatterAdmission.ADMIT){admitted.push(row.task);continue;}
        if(row.decision.admission===ScatterAdmission.FALLBACK){
          const fallback=fallbackRecord(row.task,row.decision.reason,this.now());
          records.push(fallback);gather.addFallback(row.task.taskId,fallback.result);layerFallbacks++;fallbackCount++;workAvoidedCount++;retainedBytes+=byteSize(fallback.result);
        }else{
          records.push(skippedRecord(row.task,row.decision.reason));layerSkipped++;workAvoidedCount++;
        }
      }
      peakRetainedBytes=Math.max(peakRetainedBytes,retainedBytes);
      emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_LAYER_STARTED,{
        chatId:checkpoint.identity?.chatId??null,turnId:checkpoint.turnId,generationId:checkpoint.identity?.generationId??null,correlationId:checkpoint.correlationId,
        parentReceiptId:checkpoint.parentCheckpointId,layer:layer.layer,trigger:layer.trigger,queueDepth:admitted.length,logicalJobCount:tasks.length,
      });

      const executed=admitted.length?await this.#executeForeground(admitted,{inputResolver,currentRevisionState,sealed,signal,maxProvidersPerTask,checkpoint}):[];
      const transientBytes=executed.reduce((sum,row)=>sum+byteSize(row.result),0);
      legacyRetainedBytes+=transientBytes;
      peakRetainedBytes=Math.max(peakRetainedBytes,retainedBytes+transientBytes);
      let layerReturned=0,layerFailed=0;
      for(const original of executed){
        if(original.providerProfileId||original.providerId)physicalAttemptCount+=Math.max(1,Number(original.attempt??1));
        if(original.state===NativeSwarmResultState.READY_FOR_CORE&&original.result){
          const compacted=compactReadyRecord(original);
          const accepted=await gather.accept(compacted.result,{arrivalAt:compacted.completedAt});
          if(accepted.accepted){
            records.push(compacted);layerReturned++;physicalReturnedCount++;retainedBytes+=byteSize(compacted.result);continue;
          }
          if(accepted.stale)records.push(rejectedRecord(admitted.find(x=>x.taskId===original.taskId)??{...original},NativeSwarmResultState.REJECTED_STALE,FailureCode.STALE_RESULT,{reason:'GATHER_STALE'}));
          else records.push(rejectedRecord(admitted.find(x=>x.taskId===original.taskId)??{...original},NativeSwarmResultState.REJECTED_LATE,FailureCode.DEADLINE_MISS,{late:true,reason:'GATHER_CLOSED_OR_LATE'}));
          layerFailed++;continue;
        }
        records.push(original);layerFailed++;
        const task=admitted.find(x=>x.taskId===original.taskId);
        const isSealed=Boolean(await resolveValue(sealed,false));
        if(task?.resultClass===ResultClass.REQUIRED&&!isSealed){
          const fallback=fallbackRecord(task,original.failureCode??'PHYSICAL_EXECUTION_FAILED',this.now());
          records.push(fallback);gather.addFallback(task.taskId,fallback.result);layerFallbacks++;fallbackCount++;retainedBytes+=byteSize(fallback.result);
        }
      }
      peakRetainedBytes=Math.max(peakRetainedBytes,retainedBytes);
      gatherBundle=gather.bundle();
      const layerCompleted=this.now();
      const concurrency=maxConcurrent(executed);
      const layerReceipt=createScatterLayerReceipt({
        ...checkpoint.identity,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,parentReceiptId:checkpoint.parentCheckpointId,
        layer:layer.layer,trigger:layer.trigger,admission:'EXECUTED',reason:'EVIDENCE_DRIVEN_LAYER',
        startedAt:layerStarted,completedAt:layerCompleted,durationMs:Math.max(0,layerCompleted-layerStarted),
        queueDepth:admitted.length,peakConcurrency:concurrency,logicalJobCount:tasks.length,
        physicalAttemptCount:executed.reduce((sum,row)=>sum+((row.providerProfileId||row.providerId)?Math.max(1,Number(row.attempt??1)):0),0),
        returnedCount:layerReturned,fallbackCount:layerFallbacks,skippedCount:layerSkipped,failedCount:layerFailed,
        retainedBytesEstimate:retainedBytes,costClass:layer.costClass,
      });
      layerRows.push(layerReceipt);
      emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_LAYER_COMPLETED,layerReceipt);
      emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_GATHER_PROGRESS,{
        turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,layer:layer.layer,quorumSatisfied:gather.quorumSatisfied(),
        missingRequiredCount:gather.missingRequired().length,acceptedResultCount:gatherBundle.acceptedResultIds.length,
      });
    }

    const isSealedBeforeFallback=Boolean(await resolveValue(sealed,false));
    if(!isSealedBeforeFallback){
      for(const task of gather.missingRequired()){
        const fallback=fallbackRecord(task,'REQUIRED_FALLBACK_BEFORE_GATHER_CLOSE',this.now());
        records.push(fallback);gather.addFallback(task.taskId,fallback.result);fallbackCount++;workAvoidedCount++;retainedBytes+=byteSize(fallback.result);
      }
    }
    peakRetainedBytes=Math.max(peakRetainedBytes,retainedBytes);
    gatherBundle=gather.bundle();

    for(const task of deferred)records.push(parkedRecord(task));
    if(deferred.length){
      const at=this.now();
      layerRows.push(createScatterLayerReceipt({
        ...checkpoint.identity,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,parentReceiptId:checkpoint.parentCheckpointId,
        layer:ScatterLayer.DEEP,trigger:'DEEP_BACKGROUND_ONLY',admission:'DEFERRED',reason:'OUTSIDE_FOREGROUND_DEADLINE',
        startedAt:at,completedAt:at,durationMs:0,queueDepth:deferred.length,logicalJobCount:deferred.length,deferredCount:deferred.length,costClass:'BACKGROUND',
      }));
    }

    let jevReceipt=null;
    const sealedForJev=Boolean(await resolveValue(sealed,false));
    const jevAdmission=evaluateJevLayerAdmission({
      proposal:checkpoint.proposal,request:jevRequest,gatherBundle,sealed:sealedForJev,now:this.now(),minimumExpectedValue:this.minimumJevExpectedValue,
    });
    const jevBefore=this.jev.metricsSnapshot();
    if(jevAdmission.admission===ScatterAdmission.ADMIT&&jevRequest){
      if(jevRequest.turnId!==checkpoint.turnId||jevRequest.correlationId!==checkpoint.correlationId)throw new TypeError('Jev request turn identity does not match swarm checkpoint');
      jevReceipt=await this.jev.decide(jevRequest,{currentRevisionState,sealed,signal});
    }
    const jevAfter=this.jev.metricsSnapshot();
    const jevPhysicalAttempts=Math.max(0,Number(jevAfter.providerCalls??0)-Number(jevBefore.providerCalls??0));
    physicalAttemptCount+=jevPhysicalAttempts;
    emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_JEV_ADMISSION,{
      turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,admission:jevAdmission.admission,reason:jevAdmission.reason,
      expectedValue:jevAdmission.expectedValue,physicalAttempts:jevPhysicalAttempts,serviceStatus:jevReceipt?.serviceStatus??null,
    });

    const gatherClosedAt=this.now();
    gather.close({at:gatherClosedAt,reason:gather.quorumSatisfied()?'FOREGROUND_QUORUM':'HARD_DEADLINE_OR_DECLARED_FALLBACK'});
    gatherBundle=gather.bundle();
    const gatherCompilerInput=gather.compilerInput();
    const resources=this.connections.readModel();
    const jevExecution={
      physicalAttempts:jevPhysicalAttempts,returned:jevReceipt&&jevReceipt.serviceStatus!=='JEV_UNAVAILABLE'?1:0,
      ownerAccepted:0,ownerAcceptanceKnown:0,skipped:jevAdmission.admission===ScatterAdmission.ADMIT?0:1,
      failed:jevAdmission.admission===ScatterAdmission.ADMIT&&(!jevReceipt||jevReceipt.serviceStatus==='JEV_UNAVAILABLE'||jevReceipt.serviceStatus==='JEV_INVALID')?1:0,
    };
    const resourceStates=summarizeOptionalResourceStates({resources:resources.resources,records,jevExecution});
    const peakLayerConcurrency=layerRows.reduce((m,row)=>Math.max(m,Number(row.peakConcurrency??0)),0);
    const layeredScatterReceipt=createLayeredScatterReceipt({
      ...checkpoint.identity,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,proposalId:checkpoint.proposalId,layers:layerRows,resourceStates,
      baseline:{executionModel:'UNLAYERED_FOREGROUND_BURST',logicalJobCount:foreground.length,estimatedPeakConcurrency:Math.min(foreground.length,Math.max(1,resources.readyResourceCount)),estimatedPeakRetainedBytes:legacyRetainedBytes},
      metrics:{logicalJobCount:checkpoint.pendingTasks.length,physicalAttemptCount,physicalReturnedCount,workAvoidedCount,fallbackCount,deferredCount:deferred.length,
        peakLayerConcurrency,peakRetainedBytesEstimate:peakRetainedBytes,timeToGatherCloseMs:Math.max(0,gatherClosedAt-waveStarted),quorumSatisfied:gather.quorumSatisfied(),
        lateAdmissionCount:records.filter(row=>row.late).length,staleDropCount:records.filter(row=>row.stale).length},
    });

    const nextCheckpoint=deferred.length?createSwarmCheckpoint({
      turnEvent:{turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,...checkpoint.revisionFence},
      proposal:checkpoint.proposal,tasks:deferred,createdAt:this.now(),maxBytes:this.maxCheckpointBytes,parentCheckpointId:checkpoint.checkpointId,
      plannerSignals:checkpoint.plannerSignals,identity:checkpoint.identity,
    }):null;
    return this.#finish(checkpoint,{records,jevReceipt,checkpoint:nextCheckpoint,resumeStatus:'EXECUTED',gatherBundle,gatherCompilerInput,layeredScatterReceipt});
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
          const nextAttempt=outcome.item.attempt+1;
          emitTelemetry(this.telemetry,TelemetryEvent.RETRY,{
            taskId:outcome.item.task.taskId,turnId:outcome.item.task.turnId,correlationId:outcome.item.task.correlationId,
            attempt:nextAttempt,failedProviderProfileId:outcome.profile.profileId,failedProviderId:outcome.profile.providerId,
            resourceId:outcome.record.resourceId,failureCode:outcome.record.failureCode,
          });
          outcome.item.attempt=nextAttempt;outcome.item.excluded.add(outcome.profile.profileId);pending.push(outcome.item);
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
      emitTelemetry(this.telemetry,TelemetryEvent.SWARM_TASK_RESULT,{taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,state:record.state,providerId:record.providerId,workerId:record.workerId,failureCode:record.failureCode,latencyMs:record.latencyMs,fallbackUsed:record.fallbackUsed,resourceId:record.resourceId});
      if(record.fallbackUsed&&record.state===NativeSwarmResultState.READY_FOR_CORE)emitTelemetry(this.telemetry,TelemetryEvent.FALLBACK_USED,{
        taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,attempt:item.attempt,
        providerProfileId:profile.profileId,providerId:record.providerId,workerId:record.workerId,resourceId:record.resourceId,
      });
      return{item,profile,record,retry:false};
    }catch(error){
      const deadlineMiss=deadlineController.signal.aborted&&deadlineController.signal.reason==='foreground-deadline';
      const code=deadlineMiss?FailureCode.DEADLINE_MISS:(error?.code??FailureCode.PROVIDER_FAILURE);
      const record=rejectedRecord(task,deadlineMiss?NativeSwarmResultState.REJECTED_LATE:NativeSwarmResultState.FAILED,code,{
        attempt:item.attempt,providerProfileId:profile.profileId,providerId:profile.providerId,workerId:profile.workerId,resourceId,
        startedAt:started,completedAt:this.now(),late:deadlineMiss,fallbackUsed:item.attempt>1,
      });
      const retry=!deadlineMiss&&retryable(code);
      emitTelemetry(this.telemetry,TelemetryEvent.SWARM_TASK_RESULT,{taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,state:record.state,providerId:record.providerId,workerId:record.workerId,failureCode:record.failureCode,latencyMs:record.latencyMs});
      return{item,profile,record,retry};
    }finally{clearTimeout(timer);detach();}
  }

  #finish(sourceCheckpoint,{records,jevReceipt,checkpoint,resumeStatus,gatherBundle=null,gatherCompilerInput=null,layeredScatterReceipt=null}){
    const providerExecutions=records.filter(record=>record.providerProfileId||record.providerId).map(record=>({
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
      gatherBundle:clone(gatherBundle),gatherCompilerInput:clone(gatherCompilerInput),layeredScatterReceipt:clone(layeredScatterReceipt),
      resultSummary:records.map(publicRecord),resumeStatus,
      ownerAdmissionRequired:true,authority:'NONE',truthAuthority:false,precisionAuthority:false,settlementAuthority:false,canonicalMutationAuthority:false,finalChoiceAuthority:false,contextSealAuthority:false,
    });
    const summary=deepFreeze({
      turnId:sourceCheckpoint.turnId,correlationId:sourceCheckpoint.correlationId,proposalId:sourceCheckpoint.proposal.proposalId,at:this.now(),resumeStatus,
      counts:countStates(records),assignments:records.map(publicRecord),
      jev:jevReceipt?{serviceStatus:jevReceipt.serviceStatus,outcome:jevReceipt.outcome,abstained:Boolean(jevReceipt.abstained),providerProfileId:jevReceipt.providerProvenance?.providerProfileId??null}:null,
      nextCheckpointId:checkpoint?.checkpointId??null,
      layeredScatter:layeredScatterReceipt?{physicalAttempts:layeredScatterReceipt.metrics.physicalAttemptCount,workAvoided:layeredScatterReceipt.metrics.workAvoidedCount,
        peakConcurrency:layeredScatterReceipt.metrics.peakLayerConcurrency,timeToGatherCloseMs:layeredScatterReceipt.metrics.timeToGatherCloseMs}:null,
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

export function createSwarmCheckpoint({turnEvent,proposal,tasks=[],createdAt=Date.now(),maxBytes=131072,parentCheckpointId=null,plannerSignals=null,identity=null}={}){
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
    turnId:base.turnId,correlationId:base.correlationId,proposalId:base.proposalId,revisionFence:deepFreeze(revisionFence),proposal:clone(proposal),
    plannerSignals:clone(plannerSignals),identity:deepFreeze({chatId:identity?.chatId??null,generationId:identity?.generationId??null}),
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
    taskId:task.taskId,optionId:task.metadata?.roleId??null,taskType:task.taskType,resultClass:task.resultClass,state,reason:extra.reason??null,
    providerProfileId:profile.profileId,providerId:result.providerId,workerId:result.workerId,resourceId:profile.profileMetadata?.resourceId??null,
    startedAt:result.startedAt,completedAt:result.completedAt,latencyMs:result.latency,result,attempt:Number(extra.attempt??1),
    failureCode:extra.failureCode??null,fallbackUsed:Boolean(extra.fallbackUsed),late:Boolean(extra.late),stale:Boolean(extra.stale),invalid:Boolean(extra.invalid),
  });
}
function rejectedRecord(task,state,failureCode,extra={}){
  const startedAt=extra.startedAt??null,completedAt=extra.completedAt??null;
  return deepFreeze({
    taskId:task.taskId,optionId:task.metadata?.roleId??null,taskType:task.taskType,resultClass:task.resultClass,state,reason:extra.reason??failureCode??null,
    providerProfileId:extra.providerProfileId??null,providerId:extra.providerId??null,workerId:extra.workerId??null,resourceId:extra.resourceId??null,
    startedAt,completedAt,latencyMs:startedAt!=null&&completedAt!=null?Math.max(0,completedAt-startedAt):null,result:null,attempt:Number(extra.attempt??1),
    failureCode,fallbackUsed:Boolean(extra.fallbackUsed),late:Boolean(extra.late),stale:state===NativeSwarmResultState.REJECTED_STALE,invalid:state===NativeSwarmResultState.REJECTED_INVALID,
  });
}
function parkedRecord(task){return rejectedRecord(task,NativeSwarmResultState.PARKED,null,{reason:'DEEP_BACKGROUND_ONLY'});}
function skippedRecord(task,reason){return rejectedRecord(task,NativeSwarmResultState.SKIPPED,null,{reason});}
function fallbackRecord(task,reason,at=Date.now()){
  const result=createWorkerResult({
    resultId:`fallback:${task.taskId}:${String(reason).slice(0,64)}`,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,
    workerId:'native-fallback',providerId:'native-fallback',modelId:null,capabilities:[...(task.requiredCapabilities??[])],status:'FALLBACK',
    payload:fallbackPayloadForTask(task,reason),provenance:{fallbackPolicy:task.fallbackPolicy?.type??'DEGRADED_CONTINUE',reason},
    confidence:0,freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,intentFingerprint:task.intentFingerprint,
    providerMetadata:{measurementClass:'NATIVE_FALLBACK',physicalExecutionAttempted:false},startedAt:at,completedAt:at,latency:0,
    validationReceipt:{syntax:'PASS',type:'DECLARED_FALLBACK',deterministic:'PASS'},authorityClass:'UNRESOLVED',
  });
  return deepFreeze({
    taskId:task.taskId,optionId:task.metadata?.roleId??null,taskType:task.taskType,resultClass:task.resultClass,state:NativeSwarmResultState.FALLBACK,reason,
    providerProfileId:null,providerId:null,workerId:'native-fallback',resourceId:null,startedAt:at,completedAt:at,latencyMs:0,result,attempt:0,
    failureCode:null,fallbackUsed:true,late:false,stale:false,invalid:false,
  });
}
function compactReadyRecord(record){
  if(!record?.result)return record;
  const r=record.result;
  const compact=createWorkerResult({
    resultId:r.resultId,taskId:r.taskId,turnId:r.turnId,correlationId:r.correlationId,workerId:r.workerId,providerId:r.providerId,modelId:r.modelId,
    capabilities:r.capabilities,status:r.status,payload:r.payload,provenance:r.provenance,confidence:r.confidence,
    freshnessIdentity:r.freshnessIdentity,inputRevisionSet:r.inputRevisionSet,intentFingerprint:r.intentFingerprint,
    providerMetadata:{measurementClass:r.providerMetadata?.measurementClass??null,usageReceipt:r.providerMetadata?.usageReceipt?.cost?{cost:{status:r.providerMetadata.usageReceipt.cost.status}}:null,compacted:true},
    startedAt:r.startedAt,completedAt:r.completedAt,latency:r.latency,
    validationReceipt:{syntax:r.validationReceipt?.syntax??'PASS',type:r.validationReceipt?.type??'PASS',deterministic:r.validationReceipt?.deterministic??'PASS',compacted:true},
    authorityClass:r.authorityClass,
  });
  return deepFreeze({...record,result:compact});
}
function maxConcurrent(records){
  const points=[];
  for(const row of records??[]){if(row.startedAt==null||row.completedAt==null||!(row.providerProfileId||row.providerId))continue;points.push([Number(row.startedAt),1],[Number(row.completedAt),-1]);}
  points.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);let active=0,peak=0;for(const[,delta]of points){active+=delta;peak=Math.max(peak,active);}return peak;
}
function byteSize(value){if(value==null)return 0;try{return new TextEncoder().encode(JSON.stringify(value)).length;}catch{return 0;}}
function publicRecord(record){return deepFreeze({taskId:record.taskId,optionId:record.optionId,taskType:record.taskType,resultClass:record.resultClass,state:record.state,reason:record.reason??null,
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
