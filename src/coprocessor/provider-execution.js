import { FailureCode, TelemetryEvent } from './constants.js';
import { utf8ByteLength } from './browser-compat.js';
import { createWorkerResult } from './contracts.js';
import { specialistForTask } from './foreground-specialists.js';
import { ProviderInvocationError } from './provider-adapters.js';
import { emitTelemetry } from './telemetry.js';
import { normalizeProviderUsageReceipt } from './usage-receipt.js';

export class SpecialistExecutionLayer {
  constructor({profiles,adapters,telemetry=null,specialists=null}={}){
    if(!profiles||typeof profiles.eligibleProfiles!=='function')throw new TypeError('SpecialistExecutionLayer requires CapabilityProfileRegistry');
    if(!adapters||typeof adapters.get!=='function')throw new TypeError('SpecialistExecutionLayer requires ProviderAdapterRegistry');
    this.profiles=profiles;this.adapters=adapters;this.telemetry=telemetry;this.specialists=specialists;
  }

  async execute(task,{input,attempt=1,signal=null,maxCostClass='HIGH',profileId=null,leaseHeld=false}={}){
    const specialist=this.specialists?.[task.taskType]??specialistForTask(task.taskType);
    if(!specialist)throw executionError(FailureCode.CAPABILITY_UNAVAILABLE,`No specialist contract for ${task.taskType}`);
    const providerInput=specialist.buildInput(task,input??{});
    const contextTokens=estimateTokens(providerInput);
    const eligibilityOptions={contextTokens,maxCostClass,requireStructuredOutput:true,
      expectedOutputTokens:Number(task.metadata?.expectedOutputTokens??0),preferLocal:Boolean(task.metadata?.preferLocal),
      maxLatencyMs:positiveFiniteOrNull(task.metadata?.latencyBudgetMs??task.metadata?.maxLatencyMs),maxLatencyClass:task.metadata?.maxLatencyClass??null,
      resourceLimits:structuredClone(task.metadata?.resourceLimits??task.metadata?.resourceHints??{}),resourceClass:task.metadata?.resourceClass??null};
    const eligible=(profileId!=null&&leaseHeld
      ? [this.profiles.get(profileId)].filter(Boolean)
      : profileId==null
        ? this.profiles.eligibleProfiles(task,eligibilityOptions)
        : this.profiles.discover(task,eligibilityOptions).profiles)
      .filter(profile=>this.adapters.get(profile.providerId))
      .filter(profile=>profileSatisfiesTask(profile,task,{allowCapabilityFallback:profileId!=null&&!leaseHeld}))
      .filter(profile=>profileSatisfiesExecutionLimits(profile,eligibilityOptions));
    if(!eligible.length)throw executionError(FailureCode.CAPABILITY_UNAVAILABLE,`No eligible provider adapter for ${task.taskId}`);
    const profile=profileId==null?eligible[0]:eligible.find((candidate)=>candidate.profileId===profileId);
    if(!profile)throw executionError(FailureCode.CAPABILITY_UNAVAILABLE,`Requested Runtime-selected profile is not eligible for ${task.taskId}`);
    const adapter=this.adapters.get(profile.providerId);
    emitTelemetry(this.telemetry,TelemetryEvent.PROVIDER_SELECTED,{taskId:task.taskId,turnId:task.turnId,providerId:profile.providerId,modelId:profile.modelId,
      workerCapability:[...task.requiredCapabilities],taskClass:task.taskType,cognitiveLayer:task.cognitiveLayer,placement:task.placement,
      requiredCapabilities:task.requiredCapabilities,contextTokens,expectedOutputTokens:Number(task.metadata?.expectedOutputTokens??0),
      queueTime:Number(task.metadata?.queueTime??0),local:profile.local,providerHealth:profile.health,attempt});
    let invocation;
    try{
      const expectedOutputTokens=positiveFiniteOrNull(task?.metadata?.expectedOutputTokens);
      const qualifiedOutputLimit=positiveFiniteOrNull(profile.maxOutputTokens);
      const requestedOutputTokens=expectedOutputTokens==null?null:(qualifiedOutputLimit==null?expectedOutputTokens:Math.min(expectedOutputTokens,qualifiedOutputLimit));
      invocation=await adapter.invoke(task,providerInput,{signal,attempt,maxOutputTokens:requestedOutputTokens});
    }catch(error){
      emitTelemetry(this.telemetry,TelemetryEvent.PROVIDER_FAILED,{taskId:task.taskId,turnId:task.turnId,providerId:profile.providerId,modelId:profile.modelId,
        taskClass:task.taskType,cognitiveLayer:task.cognitiveLayer,placement:task.placement,attempt,reason:error?.code??FailureCode.PROVIDER_FAILURE});
      if(error instanceof ProviderInvocationError)throw error;
      throw executionError(error?.code??FailureCode.PROVIDER_FAILURE,error?.message??String(error),{cause:error,providerId:profile.providerId});
    }
    const validationStarted=Date.now();let payload;
    try{payload=specialist.normalize(invocation.text,{input:input??{},task,providerInput});}
    catch(error){throw executionError(error?.code??FailureCode.SCHEMA_INVALID,error?.message??String(error),{cause:error,providerId:profile.providerId});}
    const validationLatency=Math.max(0,Date.now()-validationStarted);
    const actualModelId=invocation.modelId??profile.modelId;
    const measurementClass=invocation.metadata?.measurementClass??adapter.measurementClass??profile.profileMetadata?.measurementClass??null;
    const usageReceipt=normalizeProviderUsageReceipt({usage:invocation.usage??{},providerProfileId:profile.profileId,capability:task.requiredCapabilities?.[0]??null,latencyMs:invocation.latencyMs,pricing:profile.costMetadata});
    emitTelemetry(this.telemetry,TelemetryEvent.PROVIDER_INVOKED,{taskId:task.taskId,turnId:task.turnId,providerId:profile.providerId,modelId:actualModelId,requestedModelId:profile.modelId,
      taskClass:task.taskType,cognitiveLayer:task.cognitiveLayer,placement:task.placement,executionLatency:invocation.latencyMs,validationLatency,attempt,measurementClass});
    emitTelemetry(this.telemetry,TelemetryEvent.PROVIDER_USAGE,{taskId:task.taskId,turnId:task.turnId,providerId:profile.providerId,providerProfileId:profile.profileId,measurementClass,usageReceipt});
    const confidence=deriveConfidence(payload);
    return createWorkerResult({
      resultId:`result:${task.taskId}:${profile.providerId}:${attempt}`,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,
      workerId:profile.workerId,providerId:profile.providerId,modelId:actualModelId,capabilities:[...profile.capabilities],
      status:'SUCCESS',payload,provenance:{specialist:task.taskType,inputRefs:collectRefs(input),providerId:profile.providerId},
      confidence,freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,intentFingerprint:task.intentFingerprint,
      startedAt:invocation.startedAt,completedAt:invocation.completedAt,latency:invocation.latencyMs,
      validationReceipt:{syntax:'PASS',type:'PASS',deterministic:'PASS',validationLatency},
      providerMetadata:{finishReason:invocation.finishReason,usage:invocation.usage??{},usageReceipt,measurementClass,requestedModelId:profile.modelId,actualModelId,...invocation.metadata},
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

export function estimateTokens(value){return Math.max(1,Math.ceil(utf8ByteLength(JSON.stringify(value??{}))/4));}

function positiveFiniteOrNull(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}

function profileSatisfiesExecutionLimits(profile,{contextTokens=0,maxCostClass='HIGH',maxLatencyClass=null,maxLatencyMs=null,requireStructuredOutput=true,expectedOutputTokens=0,resourceLimits={},resourceClass=null}={}){
  if(!profile)return false;
  if(requireStructuredOutput&&!profile.structuredOutput)return false;
  if(Number(contextTokens)>Number(profile.maxContextTokens??Number.MAX_SAFE_INTEGER))return false;
  if(Number(expectedOutputTokens)>Number(profile.maxOutputTokens??Number.MAX_SAFE_INTEGER))return false;
  if(resourceClass!=null&&profile.resourceClass!==resourceClass)return false;
  if(!resourcesWithinLimits(profile.resourceProfile,resourceLimits))return false;
  if(costRank(profile.costClass)>costRank(maxCostClass))return false;
  if(maxLatencyClass!=null&&latencyRank(profile.latencyClass)>latencyRank(maxLatencyClass))return false;
  if(maxLatencyMs!=null&&latencyMs(profile.latencyClass)>Number(maxLatencyMs))return false;
  return true;
}
function resourcesWithinLimits(profileResources={},limits={}){for(const[resource,rawLimit]of Object.entries(limits??{})){const limit=Number(rawLimit);if(Number.isFinite(limit)&&Number(profileResources?.[resource]??0)>limit)return false;}return true;}
function costRank(value){return({FREE:0,LOW:1,MEDIUM:2,HIGH:3})[String(value??'MEDIUM').toUpperCase()]??99;}
function latencyRank(value){return({ULTRA_LOW:0,LOW:1,MEDIUM:2,HIGH:3})[String(value??'MEDIUM').toUpperCase()]??99;}
function latencyMs(value){return({ULTRA_LOW:10,LOW:25,MEDIUM:100,HIGH:300})[String(value??'MEDIUM').toUpperCase()]??100;}

function profileSatisfiesTask(profile,task,{allowCapabilityFallback=false}={}){
  if(!profile)return false;
  const capabilities=new Set(profile.capabilities??[]);
  if(!allowCapabilityFallback&&(task.requiredCapabilities??[]).some(capability=>!capabilities.has(capability)))return false;
  if(!(profile.supportedLayers??[]).includes(task.cognitiveLayer))return false;
  if(!(profile.placements??[]).includes(task.placement))return false;
  if(task.resultClass==='DEFERRED'&&profile.backgroundEligible===false)return false;
  if(task.resultClass!=='DEFERRED'&&profile.foregroundEligible===false)return false;
  if(profile.available===false)return false;
  if(!['HEALTHY','DEGRADED','SATURATED'].includes(String(profile.providerHealth??profile.health??'').toUpperCase()))return false;
  return true;
}
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
