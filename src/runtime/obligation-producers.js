import { assertLayer } from './constants.js';

function normalizeProducer(descriptor) {
  if (!descriptor?.producerId) throw new TypeError('producerId is required');
  if (!descriptor.obligationType) throw new TypeError('obligationType is required');
  return {
    producerId: descriptor.producerId,
    obligationType: descriptor.obligationType,
    requestedLayer: assertLayer(descriptor.requestedLayer ?? 'L2'),
    requiredCapabilities: [...(descriptor.requiredCapabilities ?? [])],
    capabilityRequests: structuredClone(descriptor.capabilityRequests ?? []),
    fallbackCapabilitySets: structuredClone(descriptor.fallbackCapabilitySets ?? []),
    serviceDependencies: structuredClone(descriptor.serviceDependencies ?? []),
    priority: Number.isFinite(descriptor.priority) ? descriptor.priority : 50,
    deadlineClass: descriptor.deadlineClass ?? null,
    batchHint: structuredClone(descriptor.batchHint ?? {}),
    resourceLimits: structuredClone(descriptor.resourceLimits ?? {}),
    resultContract: structuredClone(descriptor.resultContract ?? null),
  };
}

export class ObligationProducerRegistry {
  constructor({ director } = {}) {
    if (!director) throw new TypeError('ObligationProducerRegistry requires a WorkerDirector');
    this.director = director;
    this.producers = new Map();
    this.bindings = [];
  }

  register(descriptor) {
    const producer = normalizeProducer(descriptor);
    if (this.producers.has(producer.producerId)) throw new Error(`Producer already registered: ${producer.producerId}`);
    this.producers.set(producer.producerId, producer);
    return structuredClone(producer);
  }

  produce(producerId, request = {}, executor = {}) {
    const producer = this.#required(producerId);
    const obligation = {
      taskType: request.obligationType ?? producer.obligationType,
      owner: request.owner ?? producerId,
      layer: request.requestedLayer ?? producer.requestedLayer,
      requiredCapabilities: request.requiredCapabilities ?? producer.requiredCapabilities,
      capabilityRequests: request.capabilityRequests ?? producer.capabilityRequests,
      fallbackCapabilitySets: request.fallbackCapabilitySets ?? producer.fallbackCapabilitySets,
      serviceDependencies: request.serviceDependencies ?? producer.serviceDependencies,
      dependencies: request.dependencies ?? [],
      sourceRevisions: request.sourceRevisions ?? {},
      sourceRevisionIds: request.sourceRevisionIds ?? [],
      worldRevision: request.worldRevision ?? null,
      sceneRevision: request.sceneRevision ?? null,
      revision: request.revision ?? request.worldRevision ?? 0,
      priority: request.priority ?? producer.priority,
      deadline: request.deadline ?? null,
      deadlineClass: request.deadlineClass ?? producer.deadlineClass,
      resourceLimits: { ...producer.resourceLimits, ...(request.resourceLimits ?? {}) },
      batchHint: { ...producer.batchHint, ...(request.batchHint ?? {}) },
      resultContract: structuredClone(request.resultContract ?? producer.resultContract),
      dedupeKey: request.dedupeKey,
      conflictKey: request.conflictKey ?? null,
      coalesceKey: request.coalesceKey ?? null,
      coalescible: request.coalescible ?? false,
      foreground: request.foreground,
      payload: request.payload ?? {},
      producerId,
      cause: request.cause ?? null,
    };
    return this.director.submit(obligation, { ...executor, units: request.units ?? executor.units });
  }

  bindEvent({ eventType, producerId, mapEvent, executorFactory }) {
    if (typeof mapEvent !== 'function') throw new TypeError('mapEvent must be a function supplied by the specialist owner');
    if (typeof executorFactory !== 'function') throw new TypeError('executorFactory must be supplied by the specialist owner');
    this.#required(producerId);
    const unsubscribe = this.director.events.subscribe(eventType, (event) => {
      const request = mapEvent(event);
      if (!request) return;
      const mapped = { ...request, cause: request.cause ?? { eventType: event.eventType, eventId: event.eventId, correlationId: event.correlationId, turnId: event.turnId } };
      const executor = executorFactory(event, mapped);
      this.produce(producerId, mapped, executor);
    });
    const binding = { eventType, producerId, unsubscribe };
    this.bindings.push(binding);
    return () => {
      unsubscribe();
      this.bindings = this.bindings.filter((item) => item !== binding);
    };
  }

  list() {
    return [...this.producers.values()].map((producer) => structuredClone(producer));
  }

  #required(producerId) {
    const producer = this.producers.get(producerId);
    if (!producer) throw new Error(`Unknown obligation producer: ${producerId}`);
    return producer;
  }
}
