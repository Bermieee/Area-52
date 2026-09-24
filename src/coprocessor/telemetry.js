import { TelemetryEvent } from './constants.js';

export class CoprocessorTelemetry {
  #subscribers = new Set();
  #events = [];
  constructor({ limit = 2000 } = {}) { this.limit = Math.max(1, Number(limit) || 2000); }

  emit(type, payload = {}) {
    if (!Object.values(TelemetryEvent).includes(type)) throw new TypeError(`Unknown coprocessor telemetry event: ${type}`);
    const event = Object.freeze({
      type,
      payload: Object.freeze(sanitize(payload)),
    });
    this.#events.push(event);
    if (this.#events.length > this.limit) this.#events.shift();
    for (const handler of [...this.#subscribers]) {
      try { handler(event); } catch {}
    }
    return event;
  }

  subscribe(handler) {
    this.#subscribers.add(handler);
    return () => this.#subscribers.delete(handler);
  }
  list() { return [...this.#events]; }
}

function sanitize(payload) {
  const blocked = new Set(['prompt','rawPrompt','rawResponse','fullResponse','payload']);
  const safe = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (blocked.has(key)) continue;
    safe[key] = structuredClone(value);
  }
  return safe;
}
