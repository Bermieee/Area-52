import { LAYER_NAMES, assertLayer } from './constants.js';
import { normalizeResources, stableSort } from './utils.js';

function versionParts(value) {
  if (typeof value === 'number') return [value];
  const text = String(value ?? '1').replace(/^v/i, '');
  const parts = text.split('.').map((part) => Number.parseInt(part, 10));
  return parts.every(Number.isFinite) ? parts : [1];
}

export function compareCapabilityVersions(a, b) {
  const aa = versionParts(a);
  const bb = versionParts(b);
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (delta) return delta < 0 ? -1 : 1;
  }
  return 0;
}

function normalizeCapability(value) {
  if (typeof value === 'string') {
    return { id: value, version: 1, qualityScore: 0, metadata: {} };
  }
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) {
    throw new TypeError('capability must be a string or descriptor with id');
  }
  return {
    id: value.id,
    version: value.version ?? 1,
    qualityScore: Number(value.qualityScore ?? 0),
    metadata: structuredClone(value.metadata ?? value.profile ?? {}),
  };
}

function normalizeRequest(value) {
  if (typeof value === 'string') {
    return { id: value, minVersion: 1, preferredVersion: 1 };
  }
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) {
    throw new TypeError('capability request must be a string or descriptor with id');
  }
  return {
    id: value.id,
    minVersion: value.minVersion ?? 1,
    preferredVersion: value.preferredVersion ?? value.minVersion ?? 1,
  };
}

function normalizeRequestSet(values = []) {
  return values.map(normalizeRequest).sort((a, b) => a.id.localeCompare(b.id));
}

function resourcesWithinLimits(profile, limits = {}) {
  for (const [resource, rawLimit] of Object.entries(limits ?? {})) {
    const limit = Number(rawLimit);
    if (Number.isFinite(limit) && (profile?.[resource] ?? 0) > limit) return false;
  }
  return true;
}

export class CapabilityRegistry {
  constructor() {
    this.workers = new Map();
  }

  register(worker) {
    if (!worker?.workerId) throw new TypeError('workerId is required');
    if (this.workers.has(worker.workerId)) throw new Error(`Worker already registered: ${worker.workerId}`);
    const descriptors = (worker.capabilityDescriptors ?? worker.capabilities ?? []).map(normalizeCapability);
    if (!descriptors.length) throw new TypeError('worker must advertise at least one capability');
    const entry = {
      workerId: worker.workerId,
      capabilities: [...new Set(descriptors.map((item) => item.id))].sort(),
      capabilityDescriptors: descriptors,
      supportedLayers: [...new Set(worker.supportedLayers ?? LAYER_NAMES)].map(assertLayer),
      resourceProfile: normalizeResources(worker.resourceProfile ?? { CPU: 1 }),
      provider: worker.provider ?? null,
      implementationId: worker.implementationId ?? worker.provider ?? worker.workerId,
      model: worker.model ?? null,
      concurrencyCapacity: Math.max(1, Number(worker.concurrencyCapacity ?? 1)),
      currentLoad: 0,
      latencyScore: Number(worker.latencyScore ?? 100),
      latencyClass: worker.latencyClass ?? 'STANDARD',
      qualityScore: Number(worker.qualityScore ?? 0),
      profileMetadata: structuredClone(worker.profileMetadata ?? {}),
      foregroundEligible: worker.foregroundEligible ?? true,
      backgroundEligible: worker.backgroundEligible ?? true,
      health: worker.health ?? 'healthy',
      available: worker.available ?? true,
    };
    this.workers.set(entry.workerId, entry);
    return this.#copy(entry);
  }

  setHealth(workerId, health) {
    this.#required(workerId).health = health;
  }

  setAvailability(workerId, available) {
    this.#required(workerId).available = Boolean(available);
  }

  discover({ capabilityId = null, minVersion = null, layer = null } = {}) {
    return this.snapshot().filter((worker) => {
      if (layer && !worker.supportedLayers.includes(layer)) return false;
      if (!capabilityId) return true;
      return worker.capabilityDescriptors.some((capability) => capability.id === capabilityId
        && (minVersion == null || compareCapabilityVersions(capability.version, minVersion) >= 0));
    });
  }

  negotiate(task, governor = null) {
    const primary = normalizeRequestSet(task.capabilityRequests?.length ? task.capabilityRequests : task.requiredCapabilities ?? []);
    const fallbackSets = (task.fallbackCapabilitySets ?? (task.fallbackCapabilities?.length ? [task.fallbackCapabilities] : []))
      .map((set) => normalizeRequestSet(set));
    const requestSets = [primary, ...fallbackSets].filter((set) => set.length);
    if (!requestSets.length) return { workers: [], fallbackUsed: false, reason: 'task-declared-no-capability' };

    for (let setIndex = 0; setIndex < requestSets.length; setIndex += 1) {
      const requests = requestSets[setIndex];
      const workers = [...this.workers.values()].filter((worker) => this.#workerMatches(worker, task, requests, governor));
      if (!workers.length) continue;
      const sorted = stableSort(workers, (a, b) => this.#compareWorkers(a, b, requests));
      return {
        workers: sorted,
        worker: sorted[0],
        fallbackUsed: setIndex > 0,
        selectedRequests: requests,
        requestSetIndex: setIndex,
        reason: setIndex > 0 ? 'fallback-capability-set' : 'primary-capability-set',
      };
    }
    return { workers: [], fallbackUsed: false, selectedRequests: primary, reason: 'no-compatible-provider' };
  }

  eligible(task, governor = null) {
    return this.negotiate(task, governor).workers;
  }

  claim(workerId) {
    const worker = this.#required(workerId);
    if (worker.currentLoad >= worker.concurrencyCapacity) throw new Error(`Worker capacity exhausted: ${workerId}`);
    worker.currentLoad += 1;
  }

  release(workerId) {
    const worker = this.#required(workerId);
    worker.currentLoad = Math.max(0, worker.currentLoad - 1);
  }

  snapshot() {
    return [...this.workers.values()].map((worker) => this.#copy(worker));
  }

  #workerMatches(worker, task, requests, governor) {
    if (!worker.available || worker.health !== 'healthy') return false;
    if (worker.currentLoad >= worker.concurrencyCapacity) return false;
    if (!worker.supportedLayers.includes(task.layer)) return false;
    if (task.foreground && !worker.foregroundEligible) return false;
    if (!task.foreground && !worker.backgroundEligible) return false;
    if (!resourcesWithinLimits(worker.resourceProfile, task.resourceLimits)) return false;
    for (const request of requests) {
      const matches = worker.capabilityDescriptors.filter((capability) => capability.id === request.id);
      if (!matches.some((capability) => compareCapabilityVersions(capability.version, request.minVersion) >= 0)) return false;
    }
    return !governor || governor.canAcquire(task, worker);
  }

  #compareWorkers(a, b, requests) {
    const versionScore = (worker) => requests.reduce((score, request) => {
      const matching = worker.capabilityDescriptors.filter((capability) => capability.id === request.id);
      const best = matching.sort((x, y) => compareCapabilityVersions(y.version, x.version))[0];
      if (!best) return score - 1000;
      const preferred = compareCapabilityVersions(best.version, request.preferredVersion) >= 0 ? 1 : 0;
      return score + preferred * 100 + versionParts(best.version)[0] + Number(best.qualityScore ?? 0);
    }, 0);
    const aLoad = a.currentLoad / a.concurrencyCapacity;
    const bLoad = b.currentLoad / b.concurrencyCapacity;
    return aLoad - bLoad
      || versionScore(b) - versionScore(a)
      || b.qualityScore - a.qualityScore
      || a.latencyScore - b.latencyScore
      || a.workerId.localeCompare(b.workerId);
  }

  #copy(worker) {
    return {
      ...worker,
      capabilities: [...worker.capabilities],
      capabilityDescriptors: structuredClone(worker.capabilityDescriptors),
      supportedLayers: [...worker.supportedLayers],
      resourceProfile: { ...worker.resourceProfile },
      profileMetadata: structuredClone(worker.profileMetadata),
    };
  }

  #required(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Unknown worker: ${workerId}`);
    return worker;
  }
}
