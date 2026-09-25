import { Placement, ResultClass } from './constants.js';

export const HOT_DEEP_SCHEDULER_VERSION='1.0.0';

export const NativeWorkState=Object.freeze({
  QUEUED:'QUEUED',
  RUNNING:'RUNNING',
  CHECKPOINTED:'CHECKPOINTED',
  YIELDED:'YIELDED',
  PARKED_OWNER:'PARKED_OWNER',
  COMPLETED:'COMPLETED',
  REJECTED_STALE:'REJECTED_STALE',
  FAILED:'FAILED',
  SKIPPED:'SKIPPED',
});

export class NativeHotDeepScheduler {
  #deep=new Map();
  #history=[];
  #waiters=[];
  #foregroundRequests=0;
  #activeHot=0;
  #activeDeep=0;
  #metrics={
    hotRuns:0,hotSkips:0,deepQueued:0,deepDeferred:0,deepBackpressureRejected:0,deepSlices:0,deepCompleted:0,deepYields:0,deepResumes:0,deepOwnerParks:0,deepStaleRejects:0,
    totalHotQueueMs:0,totalHotExecutionMs:0,totalDeepQueueMs:0,totalDeepExecutionMs:0,foregroundBlockedMs:0,
  };

  constructor({resourceSlots=1,foregroundReserve=1,maxDeepQueue=128,now=()=>globalThis.performance?.now?.()??Date.now(),maxHistory=128}={}){
    this.resourceSlots=positiveInt(resourceSlots,'resourceSlots');
    this.foregroundReserve=Math.min(this.resourceSlots,positiveInt(foregroundReserve,'foregroundReserve'));
    this.maxDeepQueue=positiveInt(maxDeepQueue,'maxDeepQueue');
    this.now=typeof now==='function'?now:(()=>Date.now());
    this.maxHistory=Math.max(16,Number(maxHistory)||128);
  }

  classify(task,{expectedValue=1,minimumExpectedValue=.5}={}){
    if(!task||typeof task!=='object')throw new TypeError('task is required');
    const deep=task.placement===Placement.DEEP||task.resultClass===ResultClass.DEFERRED;
    const optional=task.resultClass!==ResultClass.REQUIRED;
    if(deep&&this.#pendingDeepCount()>=this.maxDeepQueue){
      this.#metrics.deepDeferred+=1;
      return freeze({decision:'DEFER',executionClass:'DEEP',reason:'DEEP_QUEUE_BACKPRESSURE',queueDepth:this.#pendingDeepCount(),maxDeepQueue:this.maxDeepQueue,authority:'NONE'});
    }
    if(optional&&Number(expectedValue)<Number(minimumExpectedValue)){
      this.#metrics.hotSkips+=deep?0:1;
      return freeze({decision:'SKIP',executionClass:deep?'DEEP':'HOT',reason:'EXPECTED_VALUE_BELOW_THRESHOLD',authority:'NONE'});
    }
    return freeze({
      decision:deep?'QUEUE_DEEP':'RUN_HOT',
      executionClass:deep?'DEEP':'HOT',
      reason:deep?'BORROW_IDLE_CAPACITY':'FOREGROUND_PRIORITY',
      foregroundReserve:this.foregroundReserve,
      resourceSlots:this.resourceSlots,
      authority:'NONE',
    });
  }

  beginForeground({workId=null}={}){
    this.#foregroundRequests+=1;
    this.#record({type:'FOREGROUND_REQUESTED',workId});
    return this.readModel();
  }

  endForeground({workId=null}={}){
    this.#foregroundRequests=Math.max(0,this.#foregroundRequests-1);
    this.#record({type:'FOREGROUND_RELEASED',workId});
    this.#notifyCapacity();
    return this.readModel();
  }

  async runHot(workId,execute,{metadata={}}={}){
    const id=required(workId,'workId');
    if(typeof execute!=='function')throw new TypeError('execute must be a function');
    const queuedAt=this.now();
    this.beginForeground({workId:id});
    try{
      while(this.#activeHot+this.#activeDeep>=this.resourceSlots)await this.#waitForCapacity();
      const startedAt=this.now();
      const queueMs=Math.max(0,startedAt-queuedAt);
      this.#metrics.totalHotQueueMs+=queueMs;
      this.#metrics.foregroundBlockedMs+=queueMs;
      this.#activeHot+=1;
      this.#metrics.hotRuns+=1;
      this.#record({type:'HOT_STARTED',workId:id,queueMs});
      try{
        const value=await execute();
        const completedAt=this.now(),executionMs=Math.max(0,completedAt-startedAt);
        this.#metrics.totalHotExecutionMs+=executionMs;
        const receipt=freeze({kind:'NativeHotWorkReceipt',workId:id,status:'COMPLETED',queueMs,executionMs,metadata:safeMetadata(metadata),authority:'NONE',result:value??null});
        this.#record({type:'HOT_COMPLETED',workId:id,queueMs,executionMs});
        return receipt;
      }finally{
        this.#activeHot=Math.max(0,this.#activeHot-1);
        this.#notifyCapacity();
      }
    }finally{this.endForeground({workId:id});}
  }

  enqueueDeep({workId,runSlice,checkpoint=null,metadata={}}={}){
    const id=required(workId,'workId');
    if(typeof runSlice!=='function')throw new TypeError('runSlice must be a function');
    if(this.#deep.has(id))throw new Error('deep work already queued: '+id);
    if(this.#pendingDeepCount()>=this.maxDeepQueue){this.#metrics.deepBackpressureRejected+=1;throw new RangeError('deep work queue capacity exhausted');}
    const at=this.now();
    const row={
      workId:id,runSlice,checkpoint:clone(checkpoint),metadata:safeMetadata(metadata),status:NativeWorkState.QUEUED,
      enqueuedAt:at,queuedAt:at,queueMs:0,executionMs:0,yields:0,resumes:0,slices:0,ownerState:null,
      ownerAccepted:false,ownerPublishedArtifactIds:[],lastFailure:null,
    };
    this.#deep.set(id,row);
    this.#metrics.deepQueued+=1;
    this.#record({type:'DEEP_QUEUED',workId:id});
    return this.readDeepWork(id);
  }

  async runDeepSlice(workId,{context={}}={}){
    const row=this.#deep.get(required(workId,'workId'));
    if(!row)throw new Error('unknown deep work: '+workId);
    if([NativeWorkState.COMPLETED,NativeWorkState.REJECTED_STALE,NativeWorkState.FAILED].includes(row.status))return this.readDeepWork(row.workId);

    const deepLimit=this.#foregroundRequests>0?Math.max(0,this.resourceSlots-this.foregroundReserve):this.resourceSlots;
    if(this.#activeDeep>=deepLimit||this.#activeHot+this.#activeDeep>=this.resourceSlots){
      if(row.status!==NativeWorkState.YIELDED){
        row.yields+=1;this.#metrics.deepYields+=1;
      }
      row.status=NativeWorkState.YIELDED;row.queuedAt=this.now();
      this.#record({type:'DEEP_YIELDED',workId:row.workId,reason:'FOREGROUND_RESERVE'});
      return this.readDeepWork(row.workId);
    }

    if(row.status===NativeWorkState.YIELDED||row.status===NativeWorkState.PARKED_OWNER){
      row.resumes+=1;this.#metrics.deepResumes+=1;
    }
    const startedAt=this.now();
    const queueMs=Math.max(0,startedAt-Number(row.queuedAt??row.enqueuedAt));
    row.queueMs+=queueMs;this.#metrics.totalDeepQueueMs+=queueMs;
    row.status=NativeWorkState.RUNNING;
    this.#activeDeep+=1;this.#metrics.deepSlices+=1;row.slices+=1;
    this.#record({type:'DEEP_SLICE_STARTED',workId:row.workId,queueMs,slice:row.slices});
    try{
      const result=await row.runSlice({checkpoint:clone(row.checkpoint),context:clone(context),workId:row.workId,slice:row.slices});
      const completedAt=this.now(),executionMs=Math.max(0,completedAt-startedAt);
      row.executionMs+=executionMs;this.#metrics.totalDeepExecutionMs+=executionMs;
      if(result?.checkpoint!==undefined)row.checkpoint=clone(result.checkpoint);
      row.ownerState=result?.ownerState??result?.state??result?.status??null;
      row.ownerAccepted=Boolean(row.ownerAccepted||result?.ownerAccepted);
      row.ownerPublishedArtifactIds=unique([...(row.ownerPublishedArtifactIds??[]),...(result?.ownerPublishedArtifactIds??[])]);
      const stale=Boolean(result?.stale||row.ownerState==='STALE');
      const ownerPark=Boolean(result?.postSeal||row.ownerState==='PARKED_AFTER_SEAL');
      const done=Boolean(result?.done||result?.terminal||row.ownerState==='COMPLETED');
      if(stale){
        row.status=NativeWorkState.REJECTED_STALE;this.#metrics.deepStaleRejects+=1;
      }else if(done){
        row.status=NativeWorkState.COMPLETED;this.#metrics.deepCompleted+=1;
      }else if(ownerPark){
        row.status=NativeWorkState.PARKED_OWNER;this.#metrics.deepOwnerParks+=1;row.queuedAt=completedAt;
      }else if(this.#foregroundRequests>0){
        row.status=NativeWorkState.YIELDED;row.yields+=1;this.#metrics.deepYields+=1;row.queuedAt=completedAt;
      }else{
        row.status=NativeWorkState.CHECKPOINTED;row.queuedAt=completedAt;
      }
      this.#record({type:'DEEP_SLICE_COMPLETED',workId:row.workId,executionMs,status:row.status,ownerState:row.ownerState});
      return this.readDeepWork(row.workId);
    }catch(error){
      const completedAt=this.now(),executionMs=Math.max(0,completedAt-startedAt);
      row.executionMs+=executionMs;this.#metrics.totalDeepExecutionMs+=executionMs;
      row.status=NativeWorkState.FAILED;
      row.lastFailure={code:String(error?.code??'DEEP_WORK_FAILED'),message:String(error?.message??error).slice(0,400)};
      this.#record({type:'DEEP_FAILED',workId:row.workId,code:row.lastFailure.code});
      return this.readDeepWork(row.workId);
    }finally{
      this.#activeDeep=Math.max(0,this.#activeDeep-1);
      this.#notifyCapacity();
    }
  }

  readDeepWork(workId){
    const row=this.#deep.get(String(workId));if(!row)return null;
    return freeze({
      kind:'NativeDeepWorkReadModel',workId:row.workId,status:row.status,executionClass:'DEEP',
      queueMs:row.queueMs,executionMs:row.executionMs,slices:row.slices,yields:row.yields,resumes:row.resumes,
      ownerState:row.ownerState,ownerAccepted:row.ownerAccepted,ownerPublishedArtifactIds:[...row.ownerPublishedArtifactIds],
      checkpointPresent:row.checkpoint!=null,metadata:clone(row.metadata),lastFailure:clone(row.lastFailure),
      authority:'NONE',canonicalMutation:false,settlementAuthority:false,contextSealAuthority:false,
    });
  }

  readModel(){
    return freeze({
      kind:'NativeHotDeepSchedulerReadModel',contractVersion:HOT_DEEP_SCHEDULER_VERSION,
      resourceSlots:this.resourceSlots,foregroundReserve:this.foregroundReserve,maxDeepQueue:this.maxDeepQueue,foregroundActive:this.#foregroundRequests>0,
      activeHot:this.#activeHot,activeDeep:this.#activeDeep,
      deepWork:[...this.#deep.values()].map(row=>this.readDeepWork(row.workId)),
      metrics:clone(this.#metrics),history:clone(this.#history),
      authority:{mutation:false,truth:false,settlement:false,contextSeal:false},
    });
  }

  #pendingDeepCount(){let count=0;for(const row of this.#deep.values())if(![NativeWorkState.COMPLETED,NativeWorkState.REJECTED_STALE,NativeWorkState.FAILED,NativeWorkState.SKIPPED].includes(row.status))count+=1;return count;}
  #waitForCapacity(){return new Promise(resolve=>this.#waiters.push(resolve));}
  #notifyCapacity(){for(const resolve of this.#waiters.splice(0))try{resolve();}catch{}}
  #record(event){
    this.#history.push({at:this.now(),...event});
    if(this.#history.length>this.maxHistory)this.#history.splice(0,this.#history.length-this.maxHistory);
  }
}

function safeMetadata(value){
  const out={};for(const [k,v] of Object.entries(value??{})){
    if(/prompt|credential|secret|token|authorization|payload|raw/i.test(k))continue;
    if(v==null||typeof v==='string'||typeof v==='number'||typeof v==='boolean')out[k]=typeof v==='string'?v.slice(0,240):v;
  }return out;
}
function unique(values){return[...new Set(values.filter(v=>typeof v==='string'&&v))];}
function required(value,name){if(typeof value!=='string'||!value.trim())throw new TypeError(name+' must be a non-empty string');return value.trim();}
function positiveInt(value,name){const n=Number(value);if(!Number.isInteger(n)||n<1)throw new TypeError(name+' must be a positive integer');return n;}
function clone(value){return value==null?value:structuredClone(value);}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
