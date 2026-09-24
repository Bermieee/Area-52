import { createTurnEnvelope, toCloudEvent } from './contracts.js';

export class TurnEventHub {
  #byTurn = new Map();
  #byDedupe = new Map();
  #subscribers = new Set();
  #events = [];

  constructor({ limit = 2000 } = {}) { this.limit = Math.max(1, Number(limit) || 2000); }

  publish(input) {
    const event = createTurnEnvelope(input);
    const existing = this.#byTurn.get(event.turnId) ?? this.#byDedupe.get(event.dedupeKey);
    if (existing) return { event: existing, duplicate: true };
    this.#byTurn.set(event.turnId, event);
    this.#byDedupe.set(event.dedupeKey, event);
    this.#events.push(event);
    if (this.#events.length > this.limit) this.#events.shift();
    for (const subscriber of [...this.#subscribers]) {
      try { subscriber(event); } catch {}
    }
    return { event, duplicate: false };
  }

  subscribe(handler) {
    if (typeof handler !== 'function') throw new TypeError('TurnEventHub subscriber must be a function');
    this.#subscribers.add(handler);
    return () => this.#subscribers.delete(handler);
  }

  get(turnId) { return this.#byTurn.get(turnId) ?? null; }
  list() { return [...this.#events]; }
  toCloudEvent(turnId, options) {
    const event = this.get(turnId);
    if (!event) throw new Error(`Unknown turn: ${turnId}`);
    return toCloudEvent(event, options);
  }
}
