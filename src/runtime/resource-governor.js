import { normalizeResources } from './utils.js';

export class ResourceGovernor {
  constructor({ capacity = { CPU: 4 }, foregroundReserve = { CPU: 1 } } = {}) {
    this.capacity = normalizeResources(capacity);
    this.foregroundReserve = normalizeResources(foregroundReserve);
    this.generationActive = false;
    this.leases = new Map();
  }

  usage() {
    const used = {};
    for (const lease of this.leases.values()) {
      for (const [resource, amount] of Object.entries(lease.resources)) {
        used[resource] = (used[resource] ?? 0) + amount;
      }
    }
    return used;
  }

  canAcquire(task, worker) {
    const used = this.usage();
    for (const [resource, amount] of Object.entries(worker.resourceProfile ?? {})) {
      const capacity = this.capacity[resource] ?? 0;
      if (capacity <= 0) return false;
      const current = used[resource] ?? 0;
      if (task.foreground) {
        if (current + amount > capacity) return false;
      } else if (this.generationActive) {
        const reserve = this.foregroundReserve[resource] ?? 0;
        if (current + amount > Math.max(0, capacity - reserve)) return false;
      } else if (current + amount > capacity) {
        return false;
      }
    }
    return true;
  }

  acquire(task, worker) {
    if (!this.canAcquire(task, worker)) return null;
    const usedBefore = this.usage();
    let borrowed = false;
    for (const [resource, amount] of Object.entries(worker.resourceProfile ?? {})) {
      const normalBackgroundLimit = Math.max(0, (this.capacity[resource] ?? 0) - (this.foregroundReserve[resource] ?? 0));
      if (!task.foreground && (usedBefore[resource] ?? 0) + amount > normalBackgroundLimit) borrowed = true;
    }
    const lease = {
      taskId: task.taskId,
      workerId: worker.workerId,
      foreground: Boolean(task.foreground),
      borrowed,
      resources: { ...(worker.resourceProfile ?? {}) },
    };
    this.leases.set(task.taskId, lease);
    return lease;
  }

  release(taskId) {
    return this.leases.delete(taskId);
  }

  beginGeneration() {
    this.generationActive = true;
    return [...this.leases.values()].filter((lease) => !lease.foreground).map((lease) => lease.taskId);
  }

  completeGeneration() {
    this.generationActive = false;
  }

  snapshot() {
    const usage = this.usage();
    const borrowed = [...this.leases.values()].filter((lease) => lease.borrowed).length;
    return {
      generationActive: this.generationActive,
      capacity: { ...this.capacity },
      foregroundReserve: { ...this.foregroundReserve },
      usage,
      borrowedBackgroundLeases: borrowed,
      activeLeases: this.leases.size,
    };
  }
}
