import { FailureCode, TelemetryEvent } from './constants.js';
import { createWorkerResult } from './contracts.js';
import { specialistForTask } from './foreground-specialists.js';
import { ProviderInvocationError } from './provider-adapters.js';

export class SpecialistExecutionLayer {
  constructor({profiles,adapters,telemetry=null,specialists=null}={}){
    if(!profiles||typeof profiles.eligibleProfiles!=='function')throw new TypeError('SpecialistExecutionLayer requires CapabilityProfileRegistry');
    if(!adapters||typeof adapters.get!=='function')throw new TypeError('SpecialistExecutionLayer requires ProviderAdapterRegistry');
    this.profiles=profiles;this.adapters=adapters;this.telemetry=telemetry;this.specialists=specialists;
  }

  async execute(task,{input,attempt=1,signal=null,maxCostClass='HIGH'}={}){
    const specialist=this.specialists?.[task.taskType]??specialistForTask(task.taskType);
    if(!specialist)throw executionError(FailureCode.CAPABILITY_UNAVAILABLE,`No specialist contract for ${task.taskType}`);
    const providerInput=specialist.buildInput(task,input??{});
    const contextTokens=estimateTokens(providerInput);
    const eligible=this.profiles.eligibleProfiles(task,{contextTokens,maxCostClass,requireStructuredOutput:true})
      .filter(profile=>this.adapters.get(profile.providerId));
    if(!eligible.length)throw executionError(FailureCode.CAPABILITY_UNAVAILABLE,`No eligible provider adapter for ${task.taskId}`);
    const profile=eligible[0],adapter=this.adapters.get(profile.providerId);
    this.telemetry?.emit(TelemetryEvent.PROVIDER_SELECTED,{taskId:task.taskId,turnId:task.turnId,providerId:profile.providerId,modelId:profile.modelId,
      requiredCapabilities:task.requiredCapabilities,contextTokens,attempt});
    let invocation;
    try{
      invocation=await adapter.invoke(task,providerInput,{signal,attempt,maxOutputTokens:profile.profileMetadata?.maxOutputTokens??null});
    }catch(error){
      this.telemetry?.emit(TelemetryEvent.PROVIDER_FAILED,{taskId:task.taskId,turnId:task.turnId,providerId:profile.providerId,modelId:profile.modelId,
        attempt,reason:error?.code??FailureCode.PROVIDER_FAILURE});
      if(error instanceof ProviderInvocationError)throw error;
      throw executionError(error?.code??FailureCode.PROVIDER_FAILURE,error?.message??String(error),{cause:error,providerId:profile.providerId});
    }
    const validationStarted=Date.now();let payload;
    try{payload=specialist.normalize(invocation.text,{input:input??{},task,providerInput});}
    catch(error){throw executionError(error?.code??FailureCode.SCHEMA_INVALID,error?.message??String(error),{cause:error,providerId:profile.providerId});}
    const validationLatency=Math.max(0,Date.now()-validationStarted);
    this.telemetry?.emit(TelemetryEvent.PROVIDER_INVOKED,{taskId:task.taskId,turnId:task.turnId,providerId:profile.providerId,modelId:profile.modelId,
      executionLatency:invocation.latencyMs,validationLatency,attempt});
    const confidence=deriveConfidence(payload);
    return createWorkerResult({
      resultId:`result:${task.taskId}:${profile.providerId}:${attempt}`,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,
      workerId:profile.workerId,providerId:profile.providerId,modelId:profile.modelId,capabilities:[...profile.capabilities],
      status:'SUCCESS',payload,provenance:{specialist:task.taskType,inputRefs:collectRefs(input),providerId:profile.providerId},
      confidence,freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,intentFingerprint:task.intentFingerprint,
      startedAt:invocation.startedAt,completedAt:invocation.completedAt,latency:invocation.latencyMs,
      validationReceipt:{syntax:'PASS',type:'PASS',deterministic:'PASS',validationLatency},
      providerMetadata:{finishReason:invocation.finishReason,usage:invocation.usage??{},...invocation.metadata},
      authorityClass:task.taskType==='GREEN_ROOM'?'INFERRED':'UNRESOLVED',
    });
  }
}

export class ProviderExecutionRouter {
  constructor({executionLayer,inputResolver}={}){
    if(!executionLayer)throw new TypeError('ProviderExecutionRouter requires executionLayer');
    if(typeof inputResolver!=='function')throw new TypeError('ProviderExecutionRouter requires inputResolver');
    this.executionLayer=executionLayer;this.inputResolver=inputResolver;
  }
  async dispatch(task,{attempt=1,turnEvent=null,signal=null}={}){
    const input=await this.inputResolver(task,{turnEvent,attempt});
    return this.executionLayer.execute(task,{input,attempt,signal});
  }
}

export function estimateTokens(value){return Math.max(1,Math.ceil(Buffer.byteLength(JSON.stringify(value??{}),'utf8')/4));}

function collectRefs(input){
  const refs=[];const visit=(v)=>{
    if(Array.isArray(v)){for(const x of v)visit(x);return;}
    if(!v||typeof v!=='object')return;
    for(const[k,x]of Object.entries(v)){if((k==='ref'||k.endsWith('Ref'))&&typeof x==='string')refs.push(x);else if(k.endsWith('Refs')&&Array.isArray(x))refs.push(...x.filter(y=>typeof y==='string'));else visit(x);}
  };visit(input);return[...new Set(refs)].sort();
}
function deriveConfidence(payload){
  const values=[];const visit=(v)=>{if(Array.isArray(v)){v.forEach(visit);return;}if(!v||typeof v!=='object')return;for(const[k,x]of Object.entries(v)){if(k==='confidence'&&Number.isFinite(Number(x)))values.push(Number(x));else visit(x);}};
  visit(payload);return values.length?Math.max(0,Math.min(1,values.reduce((a,b)=>a+b,0)/values.length)):1;
}
function executionError(code,message,extra={}){const error=new Error(message,{cause:extra.cause});error.code=code;error.providerId=extra.providerId??null;return error;}
