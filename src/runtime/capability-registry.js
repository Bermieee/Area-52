import { LAYER_NAMES, assertLayer } from './constants.js';
import { normalizeCapabilities, normalizeResources, stableSort } from './utils.js';

export class CapabilityRegistry {
  constructor() {
    this.workers = new Map();
  }

  register(worker) {
    if (!worker?.workerId) throw new TypeError('workerId is required');
    if (this.workers.has(worker.workerId)) throw new Error(`Worker already registered: ${worker.workerId}`);
    const entry = {
      workerId: worker.workerId,
      capabilities: normalizeCapabilities(worker.capabilities),
      supportedLayers: [...new Set(worker.supportedLayers ?? LAYER_NAMES)].map(assertLayer),
      resourceProfile: normalizeResources(worker.resourceProfile ?? { CPU: 1 }),
      provider: worker.provider ?? null,
      model: worker.model ?? null,
      concurrencyCapacity: Math.max(1, Number(worker.concurrencyCapacity ?? 1)),
      currentLoad: 0,
      latencyScore: Number(worker.latencyScore ?? 100),
      health: worker.health ?? 'healthy',
      available: worker.available ?? true,
    };
    this.workers.set(entry.workerId, entry);
    return entry;
  }

  setHealth(workerId, health) {
    this.#required(workerId).health = health;
  }

  setAvailability(workerId, available) {
    this.#required(workerId).available = Boolean(available);
  }

  eligible(task, governor = null) {
    const required = new Set(task.requiredCapabilities ?? []);
    const workers = [...this.workers.values()].filter((worker) => {
      if (!worker.available || worker.health !== 'healthy') return false;
      if (worker.currentLoad >= worker.concurrencyCapacity) return false;
      if (!worker.supportedLayers.includes(task.layer)) return false;
      for (const capability of required) if (!worker.capabilities.includes(capability)) return false;
      return !governor || governor.canAcquire(task, worker);
    });
    return stableSort(workers, (a, b) => {
      const aLoad = a.currentLoad / a.concurrencyCapacity;
      const bLoad = b.currentLoad / b.concurrencyCapacity;
      return aLoad - bLoad || a.latencyScore - b.latencyScore || a.workerId.localeCompare(b.workerId);
    });
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
    return [...this.workers.values()].map((worker) => ({ ...worker, capabilities: [...worker.capabilities], supportedLayers: [...worker.supportedLayers], resourceProfile: { ...worker.resourceProfile } }));
  }

  #required(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Unknown worker: ${workerId}`);
    return worker;
  }
}
