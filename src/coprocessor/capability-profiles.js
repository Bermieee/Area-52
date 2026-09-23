import { Placement } from './constants.js';

const LATENCY = Object.freeze({ ULTRA_LOW: 0, LOW: 1, MEDIUM: 2, HIGH: 3 });
const COST = Object.freeze({ FREE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 });

export class CapabilityProfileRegistry {
  #profiles = new Map();

  register(input = {}) {
    if (!input.profileId) throw new TypeError('profileId is required');
    if (this.#profiles.has(input.profileId)) throw new Error(`Capability profile already registered: ${input.profileId}`);
    const profile = Object.freeze({
      profileId: String(input.profileId),
      workerId: String(input.workerId ?? input.profileId),
      providerId: String(input.providerId ?? 'provider:unknown'),
      modelId: input.modelId == null ? null : String(input.modelId),
      capabilities: Object.freeze([...new Set(input.capabilities ?? [])]),
      capabilityVersions: Object.freeze({ ...(input.capabilityVersions ?? {}) }),
      resourceProfile: Object.freeze({ ...(input.resourceProfile ?? { CPU: 1 }) }),
      supportedLayers: Object.freeze([...(input.supportedLayers ?? ['L0','L1','L2','L3','L4'])]),
      placements: Object.freeze([...(input.placements ?? [Placement.HOT, Placement.DEEP])]),
      latencyClass: input.latencyClass ?? 'MEDIUM',
      reliability: Number(input.reliability ?? 1),
      structuredOutput: input.structuredOutput !== false,
      maxContextTokens: Number(input.maxContextTokens ?? Number.MAX_SAFE_INTEGER),
      costClass: input.costClass ?? 'MEDIUM',
      concurrencyCapacity: Math.max(1, Number(input.concurrencyCapacity ?? 1)),
      currentLoad: Math.max(0, Number(input.currentLoad ?? 0)),
      health: input.health ?? 'healthy',
      available: input.available !== false,
      fallbackCapabilities: Object.freeze([...(input.fallbackCapabilities ?? [])]),
    });
    this.#profiles.set(profile.profileId, profile);
    return profile;
  }

  get(profileId) { return this.#profiles.get(profileId) ?? null; }
  list() { return [...this.#profiles.values()]; }

  eligibleProfiles(task, {
    contextTokens = 0,
    maxCostClass = 'HIGH',
    requireStructuredOutput = true,
  } = {}) {
    const required = new Set(task.requiredCapabilities ?? []);
    return this.list().filter((profile) => {
      if (!profile.available || profile.health !== 'healthy') return false;
      if (profile.currentLoad >= profile.concurrencyCapacity) return false;
      if (!profile.supportedLayers.includes(task.cognitiveLayer)) return false;
      if (!profile.placements.includes(task.placement)) return false;
      if (requireStructuredOutput && !profile.structuredOutput) return false;
      if (contextTokens > profile.maxContextTokens) return false;
      if ((COST[profile.costClass] ?? 99) > (COST[maxCostClass] ?? 99)) return false;
      for (const capability of required) if (!profile.capabilities.includes(capability)) return false;
      return true;
    }).sort((a, b) => {
      const loadA = a.currentLoad / a.concurrencyCapacity;
      const loadB = b.currentLoad / b.concurrencyCapacity;
      return loadA - loadB
        || (LATENCY[a.latencyClass] ?? 99) - (LATENCY[b.latencyClass] ?? 99)
        || b.reliability - a.reliability
        || (COST[a.costClass] ?? 99) - (COST[b.costClass] ?? 99)
        || a.profileId.localeCompare(b.profileId);
    });
  }
}

export function toRuntimeCapabilityDescriptor(profile) {
  if (!profile) throw new TypeError('profile is required');
  return Object.freeze({
    workerId: profile.workerId,
    capabilities: [...profile.capabilities],
    supportedLayers: [...profile.supportedLayers],
    resourceProfile: { ...profile.resourceProfile },
    provider: profile.providerId,
    model: profile.modelId,
    concurrencyCapacity: profile.concurrencyCapacity,
    currentLoad: profile.currentLoad,
    latencyScore: latencyScore(profile.latencyClass),
    health: profile.health,
    available: profile.available,
  });
}

export function capabilityRequest(task) {
  return Object.freeze({
    taskId: task.taskId,
    requiredCapabilities: [...task.requiredCapabilities],
    layer: task.cognitiveLayer,
    placement: task.placement,
    hardDeadline: task.hardDeadline,
  });
}

function latencyScore(value) {
  return ({ ULTRA_LOW: 10, LOW: 25, MEDIUM: 100, HIGH: 300 })[value] ?? 100;
}
