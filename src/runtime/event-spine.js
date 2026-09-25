import { immutableCopy, makeSequenceId } from './utils.js';

export class EventSpine {
  constructor({ limit = 2000, registry = null, onDiagnostic = null } = {}) {
    this.limit = limit;
    this.registry = registry;
    this.onDiagnostic = onDiagnostic;
    this.sequence = 0;
    this.events = [];
    this.subscribers = new Map();
    this.dedupe = new Map();
    this.subscriberFailures = [];
  }

  subscribe(eventType, handler) {
    if (!this.subscribers.has(eventType)) this.subscribers.set(eventType, new Set());
    this.subscribers.get(eventType).add(handler);
    return () => this.subscribers.get(eventType)?.delete(handler);
  }

  emit(eventType, payload = {}, meta = {}) {
    const schemaVersion = meta.schemaVersion ?? this.registry?.resolve(eventType)?.schemaVersion ?? '1.0';
    if (this.registry) {
      const validation = this.registry.validate(eventType, schemaVersion, payload);
      if (!validation.ok) {
        this.onDiagnostic?.({ type: 'EVENT_REJECTED', eventType, schemaVersion, reason: validation.reason });
        const error = new Error(`Event rejected: ${eventType}@${schemaVersion}: ${validation.reason}`);
        error.code = 'EVENT_SCHEMA_INCOMPATIBLE';
        throw error;
      }
    }
    const dedupeIdentity = meta.dedupeKey ? `${eventType}@${schemaVersion}:${meta.dedupeKey}` : null;
    if (dedupeIdentity && this.dedupe.has(dedupeIdentity)) {
      return this.dedupe.get(dedupeIdentity);
    }
    const sequence = ++this.sequence;
    const event = immutableCopy({
      eventId: meta.eventId ?? makeSequenceId('evt', sequence),
      eventType,
      schemaVersion,
      producer: meta.producer ?? this.registry?.resolve(eventType, schemaVersion)?.producer ?? 'UNSPECIFIED',
      causationId: meta.causationId ?? null,
      correlationId: meta.correlationId ?? null,
      turnId: meta.turnId ?? null,
      taskId: meta.taskId ?? null,
      revisionFences: meta.revisionFences ?? {
        sourceRevisions: meta.sourceRevisions ?? {},
        worldRevision: meta.worldRevision ?? null,
        sceneRevision: meta.sceneRevision ?? null,
      },
      sourceRevisions: meta.sourceRevisions ?? {},
      worldRevision: meta.worldRevision ?? null,
      sceneRevision: meta.sceneRevision ?? null,
      createdSequence: sequence,
      createdAt: meta.createdAt ?? sequence,
      dedupeKey: meta.dedupeKey ?? null,
      payload,
    });
    this.events.push(event);
    if (this.events.length > this.limit) this.events.shift();
    if (dedupeIdentity) this.dedupe.set(dedupeIdentity, event);

    const handlers = [
      ...(this.subscribers.get(eventType) ?? []),
      ...(this.subscribers.get('*') ?? []),
    ];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        const failure = { eventId: event.eventId, message: error?.message ?? String(error) };
        this.subscriberFailures.push(failure);
        this.onDiagnostic?.({ type: 'EVENT_SUBSCRIBER_FAILED', eventType, ...failure });
      }
    }
    return event;
  }
}
