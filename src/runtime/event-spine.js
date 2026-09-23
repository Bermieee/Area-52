import { immutableCopy, makeSequenceId } from './utils.js';

export class EventSpine {
  constructor({ limit = 2000 } = {}) {
    this.limit = limit;
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
    if (meta.dedupeKey && this.dedupe.has(meta.dedupeKey)) {
      return this.dedupe.get(meta.dedupeKey);
    }
    const sequence = ++this.sequence;
    const event = immutableCopy({
      eventId: meta.eventId ?? makeSequenceId('evt', sequence),
      eventType,
      causationId: meta.causationId ?? null,
      correlationId: meta.correlationId ?? null,
      turnId: meta.turnId ?? null,
      taskId: meta.taskId ?? null,
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
    if (event.dedupeKey) this.dedupe.set(event.dedupeKey, event);

    const handlers = [
      ...(this.subscribers.get(eventType) ?? []),
      ...(this.subscribers.get('*') ?? []),
    ];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        this.subscriberFailures.push({ eventId: event.eventId, message: error?.message ?? String(error) });
      }
    }
    return event;
  }
}
