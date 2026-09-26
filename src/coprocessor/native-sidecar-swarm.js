import { FailureCode, Freshness, ResultClass, TelemetryEvent } from './constants.js';
import { DynamicFanOutPlanner } from './fanout-planner.js';
import { JevDecisionCore } from './jev-decision-core.js';
import { classifyFreshness, validateWorkerOutput } from './validation.js';
import { createCoprocessorChoiceExecutionTrace, toCoreCognitiveChoiceContribution } from './cognitive-choice-execution.js';
import { sha256Hex } from './browser-compat.js';
import { emitTelemetry } from './telemetry.js';
import { fallbackForTask } from './fallback-policy.js';
import { ScatterLayer, boundedLayerConcurrency, estimateRetainedResultBytes, evaluateScatterAdmission, partitionScatterTasks, scatterTrigger, yieldScatterHost } from './layered-scatter.js';

export const NATIVE_SIDECAR_SWARM_VERSION='1.0.0';

export const NativeSwarmResultState=Object.freeze({
  READY_FOR_CORE:'READY_FOR_CORE',
  REJECTED_STALE:'REJECTED_STALE',
  REJECTED_INVALID:'REJECTED_INVALID',
  REJECTED_LATE:'REJECTED_LATE',
  FAILED:'FAILED',
  UNAVAILABLE:'UNAVAILABLE',
  PARKED:'PARKED',
  SKIPPED:'SKIPPED',
});

const AUTHORITY_SAFE=new Set(['UNRESOLVED','INFERRED']);

export class NativeSidecarSwarm{
  constructor({
    connections,planner=null,telemetry=null,now=()=>Date.now(),maxHistory=64,maxCheckpointBytes=131072,maxProvidersPerTask=2,
    maxLayerConcurrency=2,minFreshWindowMs=12,hostYield=yieldScatterHost,executionLedger=null,maxReplayEntries=16,
  }={}){
    if(!connections||typeof connections.readModel!=='function'||typeof connections.executeTask!=='function')throw new TypeError('NativeSidecarSwarm requires CoprocessorResourceConnections');
    this.connections=connections;
    this.planner=planner??new DynamicFanOutPlanner();
    this.telemetry=telemetry;
    this.now=now;
    this.maxHistory=Math.max(8,Number(maxHistory)||64);
    this.maxCheckpointBytes=Math.max(16384,Number(maxCheckpointBytes)||131072);
    this.maxProvidersPerTask=Math.max(1,Number(maxProvidersPerTask)||2);
    this.maxLayerConcurrency=boundedLayerConcurrency(maxLayerConcurrency);
    this.minFreshWindowMs=Math.max(0,Number(minFreshWindowMs)||0);
    this.hostYield=typeof hostYield==='function'?hostYield:yieldScatterHost;
    this.executionLedger=executionLedger&&typeof executionLedger.get==='function'&&typeof executionLedger.set==='function'?executionLedger:new Map();
    this.maxReplayEntries=Math.max(1,Number(maxReplayEntries)||16);this.replayOrder=[];
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
      capabilityAliases:{'jev-adjudication':['SEMANTIC_JUDGMENT']},
    });
    const selection=publicSelection(turnEvent,plannerInput);
    const checkpoint=createSwarmCheckpoint({
      turnEvent,proposal:plan.choiceProposal,tasks:plan.fanOutPlan.tasks,createdAt:this.now(),maxBytes:this.maxCheckpointBytes,
      selection,trigger:String(plannerInput.trigger??plannerInput.eventType??turnEvent.eventType??'TURN'),
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
      gather:input.gather??null,
      selection:input.selection??input.plannerInput?.selection??prepared.checkpoint.selection,
    });
  }

  async executeCheckpoint(checkpointInput,{
    inputResolver=()=>({}),currentRevisionState=null,sealed=false,signal=null,jevRequest=null,ownerSignals={},
    maxProvidersPerTask=this.maxProvidersPerTask,gather=null,selection=null,
  }={}){
    const checkpoint=validateCheckpoint(checkpointInput,this.maxCheckpointBytes);
    if(selection&&!selectionMatches(checkpoint.selection,selection)){
      const records=checkpoint.pendingTasks.map(task=>rejectedRecord(task,NativeSwarmResultState.REJECTED_STALE,FailureCode.STALE_RESULT));
      return this.#finish(checkpoint,{records,jevReceipt:null,checkpoint:null,resumeStatus:'SELECTION_REJECTED',cache:false});
    }
    const replay=this.executionLedger.get(checkpoint.checkpointId);
    if(replay){emitTelemetry(this.telemetry,TelemetryEvent.SWARM_RESUMED,{...checkpoint.selection,checkpointId:checkpoint.checkpointId,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,pendingTaskCount:0,replaySuppressed:true});return replay;}
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
    const records=await this.#executeForeground(foreground,{inputResolver,currentRevisionState,sealed,signal,maxProvidersPerTask,checkpoint,gather});
    if(deferred.length)emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_LAYER,{...checkpoint.selection,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,parentReceiptId:checkpoint.parentCheckpointId??checkpoint.checkpointId,phase:'DEFERRED',layer:ScatterLayer.BACKGROUND,trigger:checkpoint.trigger,queueDepth:deferred.length,concurrency:0,admitted:0,skipped:0,deferred:deferred.length,durationMs:0,physicalAttempts:0,reason:'BACKGROUND_OUTSIDE_FOREGROUND_DEADLINE'});
    for(const task of deferred)records.push(parkedRecord(task));

    let jevReceipt=null;
    const jevOption=checkpoint.proposal.options.find(option=>option.optionId==='jev-adjudication');
    const shouldRunJev=checkpoint.proposal.ownerStageRequests?.jevAdjudication===true&&jevOption?.disposition==='NOMINATED';
    if(shouldRunJev&&jevRequest){
      if(jevRequest.turnId!==checkpoint.turnId||jevRequest.correlationId!==checkpoint.correlationId)throw new TypeError('Jev request turn identity does not match swarm checkpoint');
      jevReceipt=await this.jev.decide(jevRequest,{currentRevisionState,sealed,signal});
      emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_TASK_STATE,{...checkpoint.selection,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,parentReceiptId:checkpoint.checkpointId,layer:ScatterLayer.PRECISION,executionKind:'JEV',taskId:jevRequest.taskId??null,decision:['JEV_SKIPPED','JEV_UNAVAILABLE','JEV_ABSTAINED','JEV_ESCALATED','JEV_OPERATOR'].includes(jevReceipt.serviceStatus)?'SKIP':'RETURNED',reason:jevReceipt.serviceStatus,physicalAttempt:Boolean(jevReceipt.providerProvenance?.providerProfileId)});
    }else if(jevOption){
      emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_TASK_STATE,{...checkpoint.selection,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,parentReceiptId:checkpoint.checkpointId,layer:ScatterLayer.PRECISION,executionKind:'JEV',taskId:jevRequest?.taskId??null,decision:'SKIP',reason:shouldRunJev?'JEV_REQUEST_ABSENT':'OWNER_DID_NOT_REQUEST_JEV',physicalAttempt:false});
    }

    const nextCheckpoint=deferred.length?createSwarmCheckpoint({
      turnEvent:{turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,...checkpoint.revisionFence},
      proposal:checkpoint.proposal,tasks:deferred,createdAt:this.now(),maxBytes:this.maxCheckpointBytes,parentCheckpointId:checkpoint.checkpointId,
      selection:checkpoint.selection,trigger:checkpoint.trigger,
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
  releaseCheckpointReplay(checkpointId){const id=String(checkpointId);this.replayOrder=this.replayOrder.filter(value=>value!==id);return Boolean(this.executionLedger.delete?.(id));}

  async #executeForeground(tasks,{inputResolver,currentRevisionState,sealed,signal,maxProvidersPerTask,checkpoint,gather=null}){
    const records=[];const turnUsage=new Map();
    for(const bucket of partitionScatterTasks(tasks)){
      if(bucket.layer===ScatterLayer.BACKGROUND||!bucket.tasks.length)continue;
      const pending=bucket.tasks.map(task=>({task,attempt:1,excluded:new Set()}));
      const layerStarted=this.now();let physicalAttempts=0,skipped=0,fallbacks=0;
      const layerTrigger=[...new Set(bucket.tasks.map(scatterTrigger))].slice(0,8).join('|');
      emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_LAYER,{...checkpoint.selection,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,parentReceiptId:checkpoint.parentCheckpointId??checkpoint.checkpointId,phase:'STARTED',layer:bucket.layer,trigger:layerTrigger||checkpoint.trigger,queueDepth:pending.length,concurrency:this.maxLayerConcurrency,admitted:0,skipped:0,deferred:0,durationMs:0,physicalAttempts:0,costClass:bucket.tasks[0]?.metadata?.costBudget??null});
      while(pending.length){
        if(signal?.aborted){
          for(const item of pending.splice(0)){
            records.push(rejectedRecord(item.task,NativeSwarmResultState.FAILED,FailureCode.PROVIDER_ABORTED,{attempt:item.attempt}));
            emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_TASK_STATE,{...checkpoint.selection,turnId:item.task.turnId,correlationId:item.task.correlationId,parentReceiptId:checkpoint.checkpointId,taskId:item.task.taskId,layer:bucket.layer,executionKind:'SIDECAR',decision:'FAILED',reason:FailureCode.PROVIDER_ABORTED,queueDepth:pending.length,concurrency:this.maxLayerConcurrency});
          }
          break;
        }
        const round=[];const reserved=new Map();
        for(let index=0;index<pending.length&&round.length<this.maxLayerConcurrency;){
          const item=pending[index],task=item.task;
          const admission=evaluateScatterAdmission(task,{now:this.now(),minFreshWindowMs:this.minFreshWindowMs});
          if(admission.decision==='SKIP'){
            pending.splice(index,1);skipped+=1;
            const record=skippedRecord(task,admission.reason,{attempt:item.attempt});
            records.push(record);
            emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_TASK_STATE,{...checkpoint.selection,turnId:task.turnId,correlationId:task.correlationId,parentReceiptId:checkpoint.checkpointId,taskId:task.taskId,layer:bucket.layer,executionKind:'SIDECAR',decision:'SKIP',reason:admission.reason,queueDepth:pending.length,concurrency:this.maxLayerConcurrency,costClass:task.metadata?.costBudget??null});
            continue;
          }
          if(this.now()>=task.hardDeadline){
            pending.splice(index,1);
            let record=rejectedRecord(task,NativeSwarmResultState.REJECTED_LATE,FailureCode.DEADLINE_MISS,{attempt:item.attempt,late:true});
            record=await this.#settleRecord(record,{task,currentRevisionState,sealed,signal,gather,checkpoint});
            if(record.fallbackUsed)fallbacks+=1;
            records.push(record);continue;
          }
          const candidates=this.#eligible(task,item.excluded,reserved,turnUsage);
          if(!candidates.length){index+=1;continue;}
          const profile=candidates[0];reserved.set(profile.profileId,(reserved.get(profile.profileId)??0)+1);turnUsage.set(profile.profileId,(turnUsage.get(profile.profileId)??0)+1);
          pending.splice(index,1);
          physicalAttempts+=1;
          emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_TASK_STATE,{...checkpoint.selection,turnId:task.turnId,correlationId:task.correlationId,parentReceiptId:checkpoint.checkpointId,taskId:task.taskId,layer:bucket.layer,executionKind:'SIDECAR',decision:'ADMIT',reason:admission.reason,queueDepth:pending.length,concurrency:this.maxLayerConcurrency,costClass:task.metadata?.costBudget??null});
          round.push(this.#executeAssigned(item,profile,{inputResolver,currentRevisionState,sealed,signal,checkpoint}));
        }
        if(!round.length){
          for(const item of pending.splice(0)){
            let record=rejectedRecord(item.task,NativeSwarmResultState.UNAVAILABLE,FailureCode.CAPABILITY_UNAVAILABLE,{attempt:item.attempt});
            record=await this.#settleRecord(record,{task:item.task,currentRevisionState,sealed,signal,gather,checkpoint});
            if(record.fallbackUsed)fallbacks+=1;
            records.push(record);
          }
          break;
        }
        const outcomes=await Promise.all(round);
        for(const outcome of outcomes){
          if(outcome.retry&&outcome.item.attempt<Math.max(1,Number(maxProvidersPerTask)||1)&&this.now()<outcome.item.task.hardDeadline){
            const nextAttempt=outcome.item.attempt+1;
            emitTelemetry(this.telemetry,TelemetryEvent.RETRY,{
              ...checkpoint.selection,taskId:outcome.item.task.taskId,turnId:outcome.item.task.turnId,correlationId:outcome.item.task.correlationId,
              attempt:nextAttempt,failedProviderProfileId:outcome.profile.profileId,failedProviderId:outcome.profile.providerId,
              resourceId:outcome.record.resourceId,failureCode:outcome.record.failureCode,
            });
            outcome.item.attempt=nextAttempt;outcome.item.excluded.add(outcome.profile.profileId);pending.push(outcome.item);
          }else{
            const settled=await this.#settleRecord(outcome.record,{task:outcome.item.task,currentRevisionState,sealed,signal,gather,checkpoint});
            if(settled.fallbackUsed&&!outcome.record.fallbackUsed)fallbacks+=1;
            records.push(settled);
          }
        }
        if(pending.length)await this.hostYield();
      }
      const layerRecords=records.filter(record=>classifyRecordLayer(record,bucket.tasks)===bucket.layer);
      emitTelemetry(this.telemetry,TelemetryEvent.SCATTER_LAYER,{...checkpoint.selection,turnId:checkpoint.turnId,correlationId:checkpoint.correlationId,parentReceiptId:checkpoint.parentCheckpointId??checkpoint.checkpointId,phase:'COMPLETED',layer:bucket.layer,trigger:layerTrigger||checkpoint.trigger,queueDepth:0,concurrency:this.maxLayerConcurrency,admitted:layerRecords.filter(row=>row.state===NativeSwarmResultState.READY_FOR_CORE).length,skipped,deferred:0,durationMs:Math.max(0,this.now()-layerStarted),physicalAttempts,fallback:fallbacks>0,costClass:bucket.tasks[0]?.metadata?.costBudget??null,retainedBytes:layerRecords.reduce((n,row)=>n+Number(row.retainedPayloadBytes??0),0)});
      await this.hostYield();
    }
    return records;
  }

  async #settleRecord(record,{task,currentRevisionState,sealed,signal,gather,checkpoint}){
    let settled=record;
    const canFallback=task.resultClass===ResultClass.REQUIRED&&!signal?.aborted&&record.state!==NativeSwarmResultState.REJECTED_STALE&&record.state!==NativeSwarmResultState.READY_FOR_CORE;
    if(canFallback){
      const isSealed=Boolean(await resolveValue(sealed,false));
      const current=await resolveValue(currentRevisionState,checkpoint.revisionFence);
      const fresh=classifyFreshness(checkpoint.revisionFence,current??checkpoint.revisionFence)===Freshness.FRESH;
      if(!isSealed&&fresh){
        const fallback=fallbackForTask(task,{at:Math.min(this.now(),Number(task.hardDeadline))});
        if(fallback){
          settled=fallbackRecord(task,fallback,record);
          emitTelemetry(this.telemetry,TelemetryEvent.FALLBACK_USED,{...checkpoint.selection,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,attempt:record.attempt,providerId:fallback.providerId,failureCode:record.failureCode,deterministic:true});
        }
      }
    }
    if(settled.state!==NativeSwarmResultState.READY_FOR_CORE||!settled.result||!gather)return settled;
    let outcome;
    if(settled.fallbackUsed&&!gather.closed&&!gather.sealed&&typeof gather.addFallback==='function'){
      gather.addFallback(task.taskId,settled.result);
      outcome={accepted:true,destination:'FOREGROUND',fallback:true};
    }else{
      outcome=await gather.accept(settled.result,{arrivalAt:settled.completedAt,attempt:settled.attempt});
    }
    emitTelemetry(this.telemetry,TelemetryEvent.GATHER_ADMISSION,{...checkpoint.selection,turnId:task.turnId,correlationId:task.correlationId,parentReceiptId:checkpoint.checkpointId,taskId:task.taskId,resultId:settled.resultId,accepted:Boolean(outcome?.accepted),destination:outcome?.destination??null,late:Boolean(outcome?.late),stale:Boolean(outcome?.stale),fallback:Boolean(settled.fallbackUsed)});
    return withOwnerAdmission(settled,outcome);
  }

  #eligible(task,excluded,reserved=new Map(),turnUsage=new Map()){
    const eligible=this.connections.profiles.eligibleProfiles(task,{
      contextTokens:0,maxCostClass:'HIGH',requireStructuredOutput:true,expectedOutputTokens:Number(task.metadata?.expectedOutputTokens??0),
    }).filter(profile=>!excluded.has(profile.profileId)&&this.connections.adapters.get(profile.providerId)
      && Number(profile.currentLoad??0)+Number(reserved.get(profile.profileId)??0)<Number(profile.concurrencyCapacity??profile.maxConcurrency??1));
    return eligible.map((profile,index)=>({profile,index})).sort((a,b)=>{
      if(!equivalentPlacementProfiles(a.profile,b.profile))return a.index-b.index;
      return Number(turnUsage.get(a.profile.profileId)??0)-Number(turnUsage.get(b.profile.profileId)??0)||a.index-b.index;
    }).map(row=>row.profile);
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

  #finish(sourceCheckpoint,{records,jevReceipt,checkpoint,resumeStatus,cache=true}){
    const providerExecutions=records.map(record=>({
      taskId:record.taskId,choiceOptionId:record.optionId,executionResourceId:record.resourceId,providerProfileId:record.providerProfileId,providerId:record.providerId,workerId:record.workerId,
      startedAt:record.startedAt,completedAt:record.completedAt,latencyMs:record.latencyMs,resultId:record.resultId??record.result?.resultId??null,
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
    const readyResults=records.filter(record=>record.state===NativeSwarmResultState.READY_FOR_CORE&&!record.ownerAdmissionAttempted&&record.result).map(record=>record.result);
    const continuousOwnerAdmissions=records.filter(record=>record.ownerAdmissionAttempted).map(record=>({taskId:record.taskId,resultId:record.resultId,acceptedByOwner:Boolean(record.ownerAccepted),destination:record.ownerDestination??null,late:Boolean(record.ownerLate),stale:Boolean(record.ownerStale),fallback:Boolean(record.fallbackUsed)}));
    const contribution=deepFreeze({
      kind:'NativeSidecarSwarmContribution',contractVersion:NATIVE_SIDECAR_SWARM_VERSION,
      turnId:sourceCheckpoint.turnId,correlationId:sourceCheckpoint.correlationId,proposalId:sourceCheckpoint.proposal.proposalId,
      choiceContribution,executionTrace,resultsForOwner:readyResults,jevReceipt:clone(jevReceipt),
      resultSummary:records.map(publicRecord),continuousOwnerAdmissions,resumeStatus,
      ownerAdmissionRequired:readyResults.length>0,authority:'NONE',truthAuthority:false,precisionAuthority:false,settlementAuthority:false,canonicalMutationAuthority:false,finalChoiceAuthority:false,contextSealAuthority:false,
    });
    const summary=deepFreeze({
      turnId:sourceCheckpoint.turnId,correlationId:sourceCheckpoint.correlationId,proposalId:sourceCheckpoint.proposal.proposalId,at:this.now(),resumeStatus,
      counts:countStates(records),assignments:records.map(publicRecord),
      jev:jevReceipt?{serviceStatus:jevReceipt.serviceStatus,outcome:jevReceipt.outcome,abstained:Boolean(jevReceipt.abstained),providerProfileId:jevReceipt.providerProvenance?.providerProfileId??null}:null,
      nextCheckpointId:checkpoint?.checkpointId??null,
    });
    this.#remember(summary);
    if(checkpoint)emitTelemetry(this.telemetry,TelemetryEvent.SWARM_CHECKPOINTED,{checkpointId:checkpoint.checkpointId,turnId:checkpoint.turnId,pendingTaskCount:checkpoint.pendingTasks.length});
    const output=Object.freeze({kind:'NativeSidecarSwarmTurnResult',contribution,checkpoint,readModel:summary});
    if(cache)this.#rememberReplay(sourceCheckpoint.checkpointId,output);
    return output;
  }

  #remember(summary){
    const id=summary.turnId;if(!this.turns.has(id))this.turnOrder.push(id);this.turns.set(id,summary);
    while(this.turnOrder.length>this.maxHistory)this.turns.delete(this.turnOrder.shift());
  }
  #rememberReplay(checkpointId,result){
    const id=String(checkpointId);if(!this.executionLedger.has(id))this.replayOrder.push(id);this.executionLedger.set(id,result);
    while(this.replayOrder.length>this.maxReplayEntries){const evicted=this.replayOrder.shift();this.executionLedger.delete?.(evicted);}
  }
}

export function createSwarmCheckpoint({turnEvent,proposal,tasks=[],createdAt=Date.now(),maxBytes=131072,parentCheckpointId=null,selection=null,trigger='TURN'}={}){
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
    selection:publicSelection({turnId:base.turnId,correlationId:base.correlationId},selection??{}),trigger:String(trigger??'TURN').slice(0,160),
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
  const payloadBytes=estimateRetainedResultBytes(result);
  const retain=state===NativeSwarmResultState.READY_FOR_CORE;
  return deepFreeze({
    taskId:task.taskId,optionId:task.metadata?.roleId??null,taskType:task.taskType,resultClass:task.resultClass,state,
    providerProfileId:profile.profileId,providerId:result.providerId,workerId:result.workerId,resourceId:profile.profileMetadata?.resourceId??null,
    startedAt:result.startedAt,completedAt:result.completedAt,latencyMs:result.latency,resultId:result.resultId,result:retain?result:null,attempt:Number(extra.attempt??1),
    payloadBytes,retainedPayloadBytes:retain?payloadBytes:0,
    failureCode:extra.failureCode??null,fallbackUsed:Boolean(extra.fallbackUsed),late:Boolean(extra.late),stale:Boolean(extra.stale),invalid:Boolean(extra.invalid),
    ownerAdmissionAttempted:false,ownerAccepted:false,ownerDestination:null,ownerLate:false,ownerStale:false,
  });
}
function rejectedRecord(task,state,failureCode,extra={}){
  const startedAt=extra.startedAt??null,completedAt=extra.completedAt??null;
  return deepFreeze({
    taskId:task.taskId,optionId:task.metadata?.roleId??null,taskType:task.taskType,resultClass:task.resultClass,state,
    providerProfileId:extra.providerProfileId??null,providerId:extra.providerId??null,workerId:extra.workerId??null,resourceId:extra.resourceId??null,
    startedAt,completedAt,latencyMs:startedAt!=null&&completedAt!=null?Math.max(0,completedAt-startedAt):null,resultId:extra.resultId??null,result:null,attempt:Number(extra.attempt??1),payloadBytes:Number(extra.payloadBytes??0),retainedPayloadBytes:0,
    failureCode,fallbackUsed:Boolean(extra.fallbackUsed),late:Boolean(extra.late),stale:state===NativeSwarmResultState.REJECTED_STALE,invalid:state===NativeSwarmResultState.REJECTED_INVALID,
    ownerAdmissionAttempted:false,ownerAccepted:false,ownerDestination:null,ownerLate:false,ownerStale:false,
  });
}
function parkedRecord(task){return rejectedRecord(task,NativeSwarmResultState.PARKED,null);}
function skippedRecord(task,reason,extra={}){return rejectedRecord(task,NativeSwarmResultState.SKIPPED,reason,extra);}
function fallbackRecord(task,result,prior){
  const bytes=estimateRetainedResultBytes(result);
  return deepFreeze({
    taskId:task.taskId,optionId:task.metadata?.roleId??null,taskType:task.taskType,resultClass:task.resultClass,state:NativeSwarmResultState.READY_FOR_CORE,
    providerProfileId:null,providerId:result.providerId,workerId:result.workerId,resourceId:null,
    startedAt:result.startedAt,completedAt:result.completedAt,latencyMs:result.latency,resultId:result.resultId,result,attempt:prior.attempt,
    payloadBytes:bytes,retainedPayloadBytes:bytes,failureCode:prior.failureCode,fallbackUsed:true,late:false,stale:false,invalid:false,
    ownerAdmissionAttempted:false,ownerAccepted:false,ownerDestination:null,ownerLate:false,ownerStale:false,
  });
}
function withOwnerAdmission(record,outcome){
  return deepFreeze({...record,result:null,retainedPayloadBytes:0,ownerAdmissionAttempted:true,ownerAccepted:Boolean(outcome?.accepted),
    ownerDestination:outcome?.destination??null,ownerLate:Boolean(outcome?.late),ownerStale:Boolean(outcome?.stale)});
}
function classifyRecordLayer(record,tasks){const task=tasks.find(row=>row.taskId===record.taskId);return task?partitionScatterTasks([task]).find(row=>row.tasks.length)?.layer:null;}
function publicRecord(record){return deepFreeze({taskId:record.taskId,optionId:record.optionId,taskType:record.taskType,resultClass:record.resultClass,state:record.state,
  providerProfileId:record.providerProfileId,providerId:record.providerId,workerId:record.workerId,resourceId:record.resourceId,attempt:record.attempt,
  resultId:record.resultId??record.result?.resultId??null,startedAt:record.startedAt,completedAt:record.completedAt,latencyMs:record.latencyMs,failureCode:record.failureCode,
  fallbackUsed:record.fallbackUsed,late:record.late,stale:record.stale,invalid:record.invalid,payloadBytes:Number(record.payloadBytes??0),retainedPayloadBytes:Number(record.retainedPayloadBytes??0),ownerAdmissionAttempted:Boolean(record.ownerAdmissionAttempted),ownerAccepted:Boolean(record.ownerAccepted),ownerDestination:record.ownerDestination??null});}
function countStates(records){const out=Object.fromEntries(Object.values(NativeSwarmResultState).map(state=>[state,0]));for(const record of records)out[record.state]+=1;return deepFreeze(out);}
function retryable(code){return [FailureCode.MALFORMED_OUTPUT,FailureCode.SCHEMA_INVALID,FailureCode.SCHEMA_VALIDATION_FAILED,FailureCode.SEMANTIC_VALIDATION_FAILED,FailureCode.PROVIDER_FAILURE,FailureCode.PROVIDER_TIMEOUT,FailureCode.CAPABILITY_UNAVAILABLE].includes(code);}
function linkAbort(signal,controller){if(!signal)return()=>{};const abort=()=>controller.abort(signal.reason??'caller-abort');if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});return()=>signal.removeEventListener?.('abort',abort);}
async function resolveValue(value,fallback){if(typeof value==='function')return await value();return value??fallback;}
function assertBytes(value,max,name){if(new TextEncoder().encode(JSON.stringify(value)).length>Number(max))throw new RangeError(name+' exceeds byte budget');}
function stable(v){if(Array.isArray(v))return'['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function clone(v){return v==null?v:structuredClone(v);}
function deepFreeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;Object.freeze(v);for(const x of Object.values(v))deepFreeze(x);return v;}

function publicSelection(primary={},secondary={}){return deepFreeze({chatId:secondary?.chatId??secondary?.selection?.chatId??primary?.chatId??null,turnId:primary?.turnId??secondary?.turnId??secondary?.selection?.turnId??null,generationId:secondary?.generationId??secondary?.selection?.generationId??primary?.generationId??null,correlationId:primary?.correlationId??secondary?.correlationId??secondary?.selection?.correlationId??null});}

function equivalentPlacementProfiles(a,b){return a?.latencyClass===b?.latencyClass&&a?.costClass===b?.costClass&&Number(a?.reliability??0)===Number(b?.reliability??0)&&Number(a?.qualityScore??0)===Number(b?.qualityScore??0)&&Boolean(a?.local)===Boolean(b?.local);}

function selectionMatches(expected={},actual={}){for(const key of ['chatId','turnId','generationId','correlationId']){if(expected?.[key]!=null&&actual?.[key]!=null&&String(expected[key])!==String(actual[key]))return false;}return true;}
