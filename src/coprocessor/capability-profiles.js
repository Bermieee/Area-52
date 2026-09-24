import { Placement, ResultClass } from './constants.js';

const LATENCY = Object.freeze({ ULTRA_LOW: 0, LOW: 1, MEDIUM: 2, HIGH: 3 });
const COST = Object.freeze({ FREE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 });

function versionParts(value) {
  if (typeof value === 'number') return [value];
  const parts = String(value ?? '1').replace(/^v/i,'').split('.').map((part)=>Number.parseInt(part,10));
  return parts.every(Number.isFinite) ? parts : [1];
}
export function compareCapabilityVersions(a,b) {
  const aa=versionParts(a), bb=versionParts(b), len=Math.max(aa.length,bb.length);
  for(let i=0;i<len;i+=1){const delta=(aa[i]??0)-(bb[i]??0);if(delta)return delta<0?-1:1;}
  return 0;
}

export class CapabilityProfileRegistry {
  #profiles = new Map();
  #state = new Map();

  register(input = {}) {
    if (!input.profileId) throw new TypeError('profileId is required');
    if (this.#profiles.has(input.profileId)) throw new Error(`Capability profile already registered: ${input.profileId}`);
    const capabilities=[...new Set(input.capabilities ?? [])];
    const profile = Object.freeze({
      profileId: String(input.profileId),
      workerId: String(input.workerId ?? input.profileId),
      providerId: String(input.providerId ?? 'provider:unknown'),
      modelId: input.modelId == null ? null : String(input.modelId),
      capabilities: Object.freeze(capabilities),
      capabilityVersions: Object.freeze({ ...(input.capabilityVersions ?? {}) }),
      capabilityDescriptors: Object.freeze(capabilities.map((id)=>Object.freeze({
        id, version: input.capabilityVersions?.[id] ?? 1,
        qualityScore: Number(input.capabilityQuality?.[id] ?? 0),
        metadata: Object.freeze({ ...(input.capabilityMetadata?.[id] ?? {}) }),
      }))),
      resourceProfile: Object.freeze({ ...(input.resourceProfile ?? { CPU: 1 }) }),
      supportedLayers: Object.freeze([...(input.supportedLayers ?? ['L0','L1','L2','L3','L4'])]),
      placements: Object.freeze([...(input.placements ?? [Placement.HOT, Placement.DEEP])]),
      latencyClass: input.latencyClass ?? 'MEDIUM',
      reliability: Number(input.reliability ?? 1),
      structuredOutput: input.structuredOutput !== false,
      streamingSupport: Boolean(input.streamingSupport),
      abortSupport: input.abortSupport !== false,
      maxContextTokens: Number(input.maxContextTokens ?? Number.MAX_SAFE_INTEGER),
      maxOutputTokens: Number(input.maxOutputTokens ?? Number.MAX_SAFE_INTEGER),
      local: Boolean(input.local),
      costMetadata: Object.freeze({ ...(input.costMetadata ?? {}) }),
      costClass: input.costClass ?? 'MEDIUM',
      concurrencyCapacity: Math.max(1, Number(input.concurrencyCapacity ?? 1)),
      currentLoad: Math.max(0, Number(input.currentLoad ?? 0)),
      health: input.health ?? 'healthy',
      available: input.available !== false,
      fallbackCapabilities: Object.freeze([...(input.fallbackCapabilities ?? [])]),
      implementationId: input.implementationId ?? input.providerId ?? input.workerId ?? input.profileId,
      qualityScore: Number(input.qualityScore ?? 0),
      profileMetadata: Object.freeze({ ...(input.profileMetadata ?? {}) }),
      foregroundEligible: input.foregroundEligible !== false,
      backgroundEligible: input.backgroundEligible !== false,
    });
    this.#profiles.set(profile.profileId, profile);
    this.#state.set(profile.profileId,{health:profile.health,available:profile.available,currentLoad:profile.currentLoad});
    return this.get(profile.profileId);
  }

  get(profileId) { const p=this.#profiles.get(profileId);if(!p)return null;return Object.freeze({...p,...this.#state.get(profileId)}); }
  list() { return [...this.#profiles.keys()].map(id=>this.get(id)); }
  setHealth(profileId,health){this.#requiredState(profileId).health=health;}
  setAvailability(profileId,available){this.#requiredState(profileId).available=Boolean(available);}
  setLoad(profileId,currentLoad){this.#requiredState(profileId).currentLoad=Math.max(0,Number(currentLoad)||0);}

  eligibleProfiles(task, options = {}) {
    const requests=primaryRequests(task);
    return this.#eligibleForRequests(task,requests,options);
  }

  discover(task, options = {}) {
    const requestSets=[primaryRequests(task),...(task.fallbackCapabilitySets??[])];
    const attempts=[];
    for(let index=0;index<requestSets.length;index+=1){
      const requests=requestSets[index];
      const profiles=this.#eligibleForRequests(task,requests,options);
      attempts.push(Object.freeze({fallbackIndex:index-1,capabilityRequests:structuredClone(requests),eligibleProfileIds:profiles.map(x=>x.profileId)}));
      if(profiles.length){
        return Object.freeze({
          taskId:task.taskId,
          capabilityRequests:structuredClone(requests),
          fallbackIndex:index-1,
          degraded:index>0,
          profiles:Object.freeze(profiles),
          attempts:Object.freeze(attempts),
        });
      }
    }
    return Object.freeze({
      taskId:task.taskId,capabilityRequests:structuredClone(requestSets[0]??[]),
      fallbackIndex:null,degraded:false,profiles:Object.freeze([]),attempts:Object.freeze(attempts),
    });
  }

  #eligibleForRequests(task, requests, {
    contextTokens = 0,
    maxCostClass = 'HIGH',
    maxLatencyClass = null,
    maxLatencyMs = null,
    requireStructuredOutput = true,
    expectedOutputTokens = 0,
    preferLocal = false,
  } = {}) {
    return this.list().filter((profile) => {
      if (!profile.available || profile.health !== 'healthy') return false;
      if (profile.currentLoad >= profile.concurrencyCapacity) return false;
      if (task.resultClass === ResultClass.DEFERRED ? !profile.backgroundEligible : !profile.foregroundEligible) return false;
      if (!profile.supportedLayers.includes(task.cognitiveLayer)) return false;
      if (!profile.placements.includes(task.placement)) return false;
      if (requireStructuredOutput && !profile.structuredOutput) return false;
      if (contextTokens > profile.maxContextTokens) return false;
      if (Number(expectedOutputTokens)>profile.maxOutputTokens) return false;
      if ((COST[profile.costClass] ?? 99) > (COST[maxCostClass] ?? 99)) return false;
      if (maxLatencyClass!=null && (LATENCY[profile.latencyClass]??99)>(LATENCY[maxLatencyClass]??99)) return false;
      if (maxLatencyMs!=null && latencyScore(profile.latencyClass)>Number(maxLatencyMs)) return false;
      for (const request of requests) {
        const descriptor=profile.capabilityDescriptors.find((item)=>item.id===request.id);
        if (!descriptor || compareCapabilityVersions(descriptor.version,request.minVersion??1)<0) return false;
      }
      return true;
    }).sort((a, b) => {
      const loadA = a.currentLoad / a.concurrencyCapacity;
      const loadB = b.currentLoad / b.concurrencyCapacity;
      const versionScore=(profile)=>requests.reduce((score,request)=>{
        const descriptor=profile.capabilityDescriptors.find((item)=>item.id===request.id);
        return score+(descriptor&&compareCapabilityVersions(descriptor.version,request.preferredVersion??request.minVersion??1)>=0?100:0)+Number(descriptor?.qualityScore??0);
      },0);
      return loadA-loadB
        || (preferLocal ? Number(b.local)-Number(a.local) : 0)
        || versionScore(b)-versionScore(a)
        || b.qualityScore-a.qualityScore
        || (LATENCY[a.latencyClass]??99)-(LATENCY[b.latencyClass]??99)
        || b.reliability-a.reliability
        || (COST[a.costClass]??99)-(COST[b.costClass]??99)
        || a.profileId.localeCompare(b.profileId);
    });
  }

  #requiredState(profileId){const state=this.#state.get(profileId);if(!state)throw new Error(`Unknown capability profile: ${profileId}`);return state;}
}

export function toRuntimeCapabilityDescriptor(profile) {
  if (!profile) throw new TypeError('profile is required');
  return Object.freeze({
    workerId: profile.workerId,
    capabilities: [...profile.capabilities],
    capabilityDescriptors: structuredClone(profile.capabilityDescriptors),
    fallbackCapabilities:[...profile.fallbackCapabilities],
    supportedLayers: [...profile.supportedLayers],
    placements:[...profile.placements],
    resourceProfile: { ...profile.resourceProfile },
    provider: profile.providerId,
    implementationId: profile.implementationId,
    model: profile.modelId,
    concurrencyCapacity: profile.concurrencyCapacity,
    currentLoad: profile.currentLoad,
    latencyScore: latencyScore(profile.latencyClass),
    latencyClass: profile.latencyClass,
    reliability:profile.reliability,
    structuredOutput:profile.structuredOutput,
    maxContextTokens:profile.maxContextTokens,
    maxOutputTokens:profile.maxOutputTokens,
    local:profile.local,
    costClass:profile.costClass,
    qualityScore: profile.qualityScore,
    profileMetadata: { ...profile.profileMetadata },
    foregroundEligible: profile.foregroundEligible,
    backgroundEligible: profile.backgroundEligible,
    health: profile.health,
    available: profile.available,
  });
}

export function capabilityRequest(task) {
  return Object.freeze({
    taskId: task.taskId,
    requiredCapabilities: [...task.requiredCapabilities],
    capabilityRequests: structuredClone(task.capabilityRequests ?? []),
    fallbackCapabilitySets: structuredClone(task.fallbackCapabilitySets ?? []),
    layer: task.cognitiveLayer,
    foreground: task.resultClass !== ResultClass.DEFERRED,
    placement: task.placement,
    hardDeadline: task.hardDeadline,
  });
}

function primaryRequests(task){
  return task.capabilityRequests?.length?structuredClone(task.capabilityRequests):(task.requiredCapabilities??[]).map((id)=>({id,minVersion:1,preferredVersion:1}));
}
function latencyScore(value) {
  return ({ ULTRA_LOW: 10, LOW: 25, MEDIUM: 100, HIGH: 300 })[value] ?? 100;
}
