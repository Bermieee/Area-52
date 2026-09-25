import { Placement, ResultClass } from './constants.js';
import { createCapabilityRequirement, negotiateCapabilities } from './capability-negotiation.js';
import { projectCognitiveTaskContract } from './resource-connections.js';

export const RUNTIME_DIRECTOR_BRIDGE_VERSION='1.0.0';

export function createRuntimeCapabilityAdmission(registry,task,options={}){
  if(!registry||typeof registry.discover!=='function')throw new TypeError('CapabilityProfileRegistry is required');
  if(!task||task.kind!=='CognitiveTask')throw new TypeError('CognitiveTask is required');
  const negotiation=negotiateCapabilities(registry,task,options);
  return freeze({
    kind:'RuntimeCapabilityAdmission',contractVersion:RUNTIME_DIRECTOR_BRIDGE_VERSION,
    taskContract:projectCognitiveTaskContract(task),
    requirement:createCapabilityRequirement(task,options),
    status:negotiation.status,
    degraded:Boolean(negotiation.degraded),
    fallbackSetUsed:negotiation.fallbackSetUsed,
    candidates:negotiation.eligibleProfiles.map(profile=>({
      runtimeWorkerId:profile.profileId,profileId:profile.profileId,sourceWorkerId:profile.workerId,
      capabilities:[...profile.capabilities],capabilityDescriptors:clone(profile.capabilityDescriptors),
      resourceProfile:clone(profile.resourceProfile),resourceClass:profile.resourceClass,
      latencyClass:profile.latencyClass,maxContextTokens:profile.maxContextTokens,maxOutputTokens:profile.maxOutputTokens,
      concurrencyCapacity:profile.concurrencyCapacity,currentLoad:profile.currentLoad,
      foregroundEligible:profile.foregroundEligible,backgroundEligible:profile.backgroundEligible,
      providerHealth:profile.providerHealth,availability:profile.availability,
      providerId:profile.providerId??profile.provider??null,modelId:profile.modelId??profile.model??null,
    })),
    authority:{runtimeScheduling:false,physicalWorker:false,truth:false,settlement:false,canonicalMutation:false,contextSeal:false},
  });
}

export function toWorkerDirectorWorker(profile){
  if(!profile?.profileId)throw new TypeError('capability profile is required');
  const health=String(profile.providerHealth??profile.health??'UNAVAILABLE').toUpperCase();
  const available=profile.available!==false&&profile.availability!=='UNAVAILABLE'&&['HEALTHY','DEGRADED'].includes(health);
  return freeze({
    workerId:String(profile.profileId),
    capabilities:[...(profile.capabilities??[])],
    capabilityDescriptors:clone(profile.capabilityDescriptors??[]),
    supportedLayers:[...(profile.supportedLayers??[])],
    resourceProfile:clone(profile.resourceProfile??{CPU:1}),
    provider:profile.providerId??null,
    implementationId:profile.implementationId??profile.providerId??profile.profileId,
    model:profile.modelId??null,
    concurrencyCapacity:Math.max(1,Number(profile.concurrencyCapacity??profile.maxConcurrency??1)),
    latencyScore:latencyScore(profile.latencyClass),
    latencyClass:profile.latencyClass??'MEDIUM',
    qualityScore:Number(profile.qualityScore??0),
    profileMetadata:{
      ...(clone(profile.profileMetadata??{})),
      sourceProfileId:profile.profileId,sourceWorkerId:profile.workerId??null,
      providerHealth:health,maxContextTokens:Number(profile.maxContextTokens??Number.MAX_SAFE_INTEGER),
      maxOutputTokens:Number(profile.maxOutputTokens??Number.MAX_SAFE_INTEGER),resourceClass:profile.resourceClass??null,
      authorityGranted:false,
    },
    foregroundEligible:profile.foregroundEligible!==false,
    backgroundEligible:profile.backgroundEligible!==false,
    health:available?'healthy':'unavailable',
    available,
  });
}

export function toWorkerDirectorObligation(task,{placementDecision=null,owner='COGNITIVE_COPROCESSOR',priority=null}={}){
  if(!task||task.kind!=='CognitiveTask')throw new TypeError('CognitiveTask is required');
  const executionClass=placementDecision?.executionClass??(task.placement===Placement.DEEP?'DEEP':'HOT');
  const deep=executionClass==='DEEP'||task.resultClass===ResultClass.DEFERRED;
  const resourceLimits=clone(task.metadata?.resourceLimits??task.metadata?.resourceHints??{});
  const requirement=createCapabilityRequirement(task);
  return freeze({
    taskId:task.taskId,taskType:task.taskType,owner,producerId:'COGNITIVE_COPROCESSOR',
    runtimeClass:deep?'DEEP':'NATIVE_COGNITIVE',layer:task.cognitiveLayer,
    requiredCapabilities:[...(task.requiredCapabilities??[])],capabilityRequests:clone(task.capabilityRequests??[]),
    fallbackCapabilitySets:clone(task.fallbackCapabilitySets??[]),resourceClass:requirement.resourceClass,resourceLimits,
    sourceRevisions:{sourceRevisionSet:[...(task.sourceRevisionSet??task.inputRevisionSet?.sourceRevisionSet??[])]},
    sourceRevisionIds:[...(task.sourceRevisionSet??task.inputRevisionSet?.sourceRevisionSet??[])],
    worldRevision:task.worldRevision??task.inputRevisionSet?.worldRevision??0,sceneRevision:task.sceneRevision??task.inputRevisionSet?.sceneRevision??0,
    revision:task.worldRevision??task.inputRevisionSet?.worldRevision??0,
    priority:Number.isFinite(priority)?priority:defaultPriority(task.resultClass),
    deadline:task.hardDeadline??null,deadlineClass:task.resultClass,
    foreground:!deep&&task.resultClass!==ResultClass.DEFERRED,
    foregroundSensitivity:deep?'YIELD_ON_GENERATION':'FOREGROUND_PRIORITY',
    expectedCost:{maxCostClass:requirement.costBudget},
    yieldPolicy:deep?{mode:'SAFE_BOUNDARY',maxUninterruptedSliceMs:positive(task.metadata?.maxUninterruptedSliceMs,25)}:{mode:'FOREGROUND_BOUND'},
    checkpointPolicy:deep?{maxUnitsPerCheckpoint:positive(task.batchMetadata?.maxUnitsPerCheckpoint,1)}:{},
    batchHint:deep?{maxSliceUnits:positive(task.batchMetadata?.maxSliceUnits,1)}:{maxSliceUnits:positive(task.batchMetadata?.maxSliceUnits,1)},
    speculative:task.resultClass!==ResultClass.REQUIRED,dedupeKey:task.dedupeKey,
    conflictKey:task.metadata?.conflictKey??null,
    resultContract:{kind:'CognitiveWorkerResult',schemaVersion:task.schemaVersion??'1.0.0',resultClass:task.resultClass,outputSchema:clone(task.outputSchema),authorityGranted:false},
    payload:{
      turnId:task.turnId,correlationId:task.correlationId,causationId:task.causationId??null,
      capabilityRequirement:requirement,cognitiveTask:projectCognitiveTaskContract(task),
      providerIdentityInTask:false,authorityGranted:false,canonicalMutation:false,settlementPerformed:false,
    },
  });
}

export function createResourceDirectorExecutor({connections,task,input={},inputResolver=null}={}){
  if(!connections||typeof connections.executeTask!=='function')throw new TypeError('CoprocessorResourceConnections is required');
  if(!task||task.kind!=='CognitiveTask')throw new TypeError('CognitiveTask is required');
  if(inputResolver!=null&&typeof inputResolver!=='function')throw new TypeError('inputResolver must be a function');
  return Object.freeze({
    async execute(context={}){
      const profileId=context?.worker?.workerId??null;
      if(!profileId){const error=new Error('WorkerDirector assignment did not include a resource profile identity');error.code='RUNTIME_ASSIGNMENT_PROFILE_REQUIRED';throw error;}
      const providerInput=inputResolver?await inputResolver({task,context,units:clone(context.units??[])}):clone(input);
      return connections.executeTask(task,{input:providerInput,profileId,signal:context.signal??null});
    },
    validate({output}={}){
      return Boolean(output&&output.kind==='CognitiveWorkerResult'&&output.taskId===task.taskId&&output.turnId===task.turnId&&output.correlationId===task.correlationId&&output.status==='SUCCESS');
    },
    commit({output}={}){
      return {
        kind:'RuntimeCoprocessorProviderCommitReceipt',
        providerExecution:{
          workerId:output?.workerId??null,providerId:output?.providerId??null,modelId:output?.modelId??null,
          measurementClass:output?.providerMetadata?.measurementClass??null,actualProvider:output?.providerMetadata?.actualProvider??null,
          latencyMs:Number(output?.latency??0),usageReceipt:clone(output?.providerMetadata?.usageReceipt??null),
          authorityGranted:false,canonicalMutation:false,settlementPerformed:false,
        },
      };
    },
  });
}

export class RuntimeDirectorAdmissionBridge{
  #registered=new Set();
  constructor({director,capabilityRegistry,placementScheduler}={}){
    if(!director||typeof director.submit!=='function')throw new TypeError('WorkerDirector-compatible director is required');
    if(!capabilityRegistry||typeof capabilityRegistry.list!=='function')throw new TypeError('CapabilityProfileRegistry is required');
    if(!placementScheduler||typeof placementScheduler.classify!=='function')throw new TypeError('NativeHotDeepScheduler-compatible placementScheduler is required');
    this.director=director;this.capabilityRegistry=capabilityRegistry;this.placementScheduler=placementScheduler;
  }
  registerProfiles({profiles=null}={}){
    if(typeof this.director.registerWorker!=='function')throw new TypeError('director.registerWorker is required');
    const registered=[];
    for(const profile of profiles??this.capabilityRegistry.list()){
      if(this.#registered.has(profile.profileId))continue;
      const descriptor=toWorkerDirectorWorker(profile);
      this.director.registerWorker(descriptor);this.#registered.add(profile.profileId);registered.push(descriptor);
    }
    return freeze(registered);
  }
  syncProfileState(profileId){
    const profile=this.capabilityRegistry.get(profileId);if(!profile)return null;
    const descriptor=toWorkerDirectorWorker(profile);
    this.director.setWorkerAvailability?.(descriptor.workerId,descriptor.available);
    this.director.setWorkerHealth?.(descriptor.workerId,descriptor.health);
    return descriptor;
  }
  plan(task,{expectedValue=1,minimumExpectedValue=.5,...constraints}={}){
    const placement=this.placementScheduler.classify(task,{expectedValue,minimumExpectedValue});
    const admission=createRuntimeCapabilityAdmission(this.capabilityRegistry,task,constraints);
    const decision=placement.decision==='SKIP'?'SKIP':placement.decision==='DEFER'?'DEFER':admission.candidates.length?'ADMIT':'BLOCKED';
    return freeze({kind:'RuntimeDirectorAdmissionPlan',contractVersion:RUNTIME_DIRECTOR_BRIDGE_VERSION,decision,placement,capabilityAdmission:admission,
      taskContract:admission.taskContract,authority:{runtimeScheduling:false,physicalWorker:false,truth:false,settlement:false,canonicalMutation:false}});
  }
  admit(task,{executor,units=null,expectedValue=1,minimumExpectedValue=.5,constraints={},owner='COGNITIVE_COPROCESSOR',priority=null}={}){
    if(typeof executor?.execute!=='function')throw new TypeError('executor.execute is required');
    const plan=this.plan(task,{expectedValue,minimumExpectedValue,...constraints});
    if(plan.decision!=='ADMIT')return freeze({kind:'RuntimeDirectorAdmissionReceipt',status:plan.decision,submitted:false,plan,directorAdmission:null,authority:'NONE'});
    const allowed=new Set(plan.capabilityAdmission.candidates.map(row=>row.runtimeWorkerId));
    const wrapped={
      ...executor,
      async execute(context){
        const selected=context?.worker?.workerId??null;
        if(selected&&!allowed.has(selected)){
          const error=new Error('WorkerDirector selected a worker outside the qualified capability admission set');
          error.code='RUNTIME_ASSIGNMENT_NOT_QUALIFIED';throw error;
        }
        return executor.execute(context);
      },
    };
    const obligation=toWorkerDirectorObligation(task,{placementDecision:plan.placement,owner,priority});
    const directorAdmission=this.director.submit(obligation,{...wrapped,...(units==null?{}:{units})});
    const accepted=directorAdmission?.accepted!==false;
    return freeze({kind:'RuntimeDirectorAdmissionReceipt',status:accepted?'ADMITTED':'REJECTED',submitted:accepted,
      plan,obligation,directorAdmission:clone(directorAdmission),authority:'NONE'});
  }
  beginGeneration(meta={}){if(typeof this.director.beginGeneration!=='function')throw new TypeError('director.beginGeneration is required');return clone(this.director.beginGeneration(meta));}
  completeGeneration(meta={}){if(typeof this.director.completeGeneration!=='function')throw new TypeError('director.completeGeneration is required');return clone(this.director.completeGeneration(meta));}
  snapshot(){return typeof this.director.snapshot==='function'?clone(this.director.snapshot()):null;}
}

function defaultPriority(resultClass){return resultClass===ResultClass.REQUIRED?10:resultClass===ResultClass.OPPORTUNISTIC?35:70;}
function latencyScore(value){return({ULTRA_LOW:10,LOW:25,MEDIUM:100,HIGH:300})[String(value??'MEDIUM').toUpperCase()]??100;}
function positive(value,fallback){const n=Number(value);return Number.isInteger(n)&&n>0?n:fallback;}
function clone(value){return value==null?value:structuredClone(value);}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
