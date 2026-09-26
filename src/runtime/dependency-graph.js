function normalizeDependency(value) {
  if (typeof value === 'string') return { id: value, required: true };
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) {
    throw new TypeError('dependency must be a string or descriptor with id');
  }
  return {
    id: value.id,
    required: value.required ?? !value.optional,
    minimumState: value.minimumState ?? 'AVAILABLE',
    metadata: structuredClone(value.metadata ?? {}),
  };
}

export class ServiceDependencyGraph {
  constructor({ onDiagnostic = null } = {}) {
    this.services = new Map();
    this.onDiagnostic = onDiagnostic;
  }

  registerService({ serviceId, dependencies = [], available = true, degraded = false, metadata = {} } = {}) {
    if (typeof serviceId !== 'string' || !serviceId) throw new TypeError('serviceId is required');
    const previous = this.services.get(serviceId);
    const entry = {
      serviceId,
      dependencies: dependencies.map(normalizeDependency),
      available: Boolean(available),
      degraded: Boolean(degraded),
      metadata: structuredClone(metadata),
    };
    this.services.set(serviceId, entry);
    const cycle = this.detectCycle();
    if (cycle) {
      if (previous) this.services.set(serviceId, previous);
      else this.services.delete(serviceId);
      this.onDiagnostic?.({ type: 'DEPENDENCY_CYCLE_REJECTED', serviceId, cycle });
      const error = new Error(`Circular dependency rejected: ${cycle.join(' -> ')}`);
      error.code = 'DEPENDENCY_CYCLE';
      error.cycle = cycle;
      throw error;
    }
    return structuredClone(entry);
  }

  setAvailability(serviceId, available, { degraded = null } = {}) {
    const service = this.#required(serviceId);
    service.available = Boolean(available);
    if (degraded != null) service.degraded = Boolean(degraded);
    return structuredClone(service);
  }

  setDegraded(serviceId, degraded) {
    const service = this.#required(serviceId);
    service.degraded = Boolean(degraded);
    return structuredClone(service);
  }

  evaluateTask(task) {
    const dependencies = (task.serviceDependencies ?? []).map(normalizeDependency);
    const missingRequired = [];
    const missingOptional = [];
    const degraded = [];
    for (const dependency of dependencies) {
      const service = this.services.get(dependency.id);
      const unavailable = !service?.available;
      if (unavailable) {
        (dependency.required ? missingRequired : missingOptional).push(dependency.id);
      } else if (service.degraded) {
        degraded.push(dependency.id);
      }
    }
    return {
      executable: missingRequired.length === 0,
      degraded: missingOptional.length > 0 || degraded.length > 0,
      missingRequired: missingRequired.sort(),
      missingOptional: missingOptional.sort(),
      degradedServices: degraded.sort(),
    };
  }

  validateRuntime() {
    const cycle = this.detectCycle();
    const missingRequired = [];
    const missingOptional = [];
    for (const service of this.services.values()) {
      for (const dependency of service.dependencies) {
        const target = this.services.get(dependency.id);
        if (target?.available) continue;
        (dependency.required ? missingRequired : missingOptional).push({ serviceId: service.serviceId, dependencyId: dependency.id });
      }
    }
    return { ok: !cycle && missingRequired.length === 0, cycle, missingRequired, missingOptional };
  }

  detectCycle() {
    const visiting = new Set();
    const visited = new Set();
    const stack = [];
    const visit = (id) => {
      if (visiting.has(id)) {
        const start = stack.indexOf(id);
        return [...stack.slice(start), id];
      }
      if (visited.has(id) || !this.services.has(id)) return null;
      visiting.add(id);
      stack.push(id);
      for (const dependency of this.services.get(id).dependencies) {
        const cycle = visit(dependency.id);
        if (cycle) return cycle;
      }
      stack.pop();
      visiting.delete(id);
      visited.add(id);
      return null;
    };
    for (const id of [...this.services.keys()].sort()) {
      const cycle = visit(id);
      if (cycle) return cycle;
    }
    return null;
  }

  snapshot() {
    return [...this.services.values()].map((service) => structuredClone(service)).sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  }

  #required(serviceId) {
    const service = this.services.get(serviceId);
    if (!service) throw new Error(`Unknown service dependency: ${serviceId}`);
    return service;
  }
}
