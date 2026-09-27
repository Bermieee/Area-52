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
      cause: request.cause ?? {},
      producerId,
    };
    return this.director.submit(obligation, { ...executor, units: request.units ?? executor.units });
  }

  bindEvent({ eventType, producerId, mapEvent, executorFactory, guardEvent = null, onDisposition = null }) {
    if (typeof mapEvent !== 'function') throw new TypeError('mapEvent must be a function supplied by the specialist owner');
    if (typeof executorFactory !== 'function') throw new TypeError('executorFactory must be supplied by the specialist owner');
    if (guardEvent !== null && typeof guardEvent !== 'function') throw new TypeError('guardEvent must be a function when supplied');
    if (onDisposition !== null && typeof onDisposition !== 'function') throw new TypeError('onDisposition must be a function when supplied');
    this.#required(producerId);
    const notify = (entry) => {
      try { onDisposition?.(structuredClone(entry)); } catch {}
    };
    const unsubscribe = this.director.events.subscribe(eventType, (event) => {
      if (guardEvent) {
        let guard;
        try { guard = guardEvent(event); }
        catch (error) {
          notify({ status: 'REJECTED', reasonCode: error?.code ?? 'EVENT_GUARD_FAILED', event, admission: null });
          throw error;
        }
        const accepted = typeof guard === 'boolean' ? guard : guard?.accepted !== false;
        if (!accepted) {
          notify({ status: 'REJECTED', reasonCode: guard?.reasonCode ?? 'EVENT_GUARD_REJECTED', event, admission: null });
          return;
        }
      }
      let request;
      try { request = mapEvent(event); }
      catch (error) {
        notify({ status: 'REJECTED', reasonCode: error?.code ?? 'EVENT_OWNER_MAP_FAILED', event, admission: null });
        throw error;
      }
      if (!request) {
        notify({ status: 'SKIPPED', reasonCode: 'OWNER_DECLARED_NO_WORK', event, admission: null });
        return;
      }
      let executor;
      try { executor = executorFactory(event, request); }
      catch (error) {
        notify({ status: 'REJECTED', reasonCode: error?.code ?? 'EVENT_EXECUTOR_FACTORY_FAILED', event, request, admission: null });
        throw error;
      }
      try {
        const admission = this.produce(producerId, request, executor);
        notify({
          status: admission?.accepted === false ? 'REJECTED' : admission?.deduped ? 'DEDUPED' : admission?.coalesced ? 'COALESCED' : 'ADMITTED',
          reasonCode: admission?.accepted === false ? String(admission?.reason ?? 'OBLIGATION_REJECTED') : 'OWNER_OBLIGATION_ADMITTED',
          event, request, admission,
        });
      } catch (error) {
        notify({ status: 'REJECTED', reasonCode: error?.code ?? 'OBLIGATION_PRODUCTION_FAILED', event, request, admission: null });
        throw error;
      }
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
