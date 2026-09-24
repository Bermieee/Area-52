import { TelemetryEvent } from './constants.js';

const BLOCKED_KEYS = new Set([
  'prompt', 'rawPrompt', 'rawResponse', 'fullResponse', 'response', 'payload', 'messages', 'candidateBodies',
  'candidateText', 'sourceText', 'retrievedSourceText', 'retrievedText', 'fullArtifact', 'rawArtifact',
  'conversation', 'fullConversation', 'chatHistory', 'lorebook', 'fullLorebook', 'memory', 'allMemory',
  'privateDiagnostics', 'chainOfThought', 'reasoning',
]);
const DEFAULT_BOUNDS = Object.freeze({ maxDepth: 5, maxKeys: 64, maxArray: 64, maxString: 768 });

export class CoprocessorTelemetry {
  #subscribers = new Set();
  #events = [];
  #counters = new Map();

  constructor({ limit = 2000, bounds = {} } = {}) {
    this.limit = Math.max(1, Number(limit) || 2000);
    this.bounds = { ...DEFAULT_BOUNDS, ...bounds };
  }

  emit(type, payload = {}) {
    if (!Object.values(TelemetryEvent).includes(type)) throw new TypeError(`Unknown coprocessor telemetry event: ${type}`);
    let safePayload;
    try { safePayload = sanitize(payload, this.bounds); }
    catch { safePayload = { telemetryError: 'SANITIZE_FAILED' }; }
    const event = Object.freeze({ type, payload: Object.freeze(safePayload) });
    this.#events.push(event);
    this.#counters.set(type, (this.#counters.get(type) ?? 0) + 1);
    if (this.#events.length > this.limit) this.#events.splice(0, this.#events.length - this.limit);
    for (const handler of [...this.#subscribers]) { try { handler(event); } catch {} }
    return event;
  }

  subscribe(handler) {
    if (typeof handler !== 'function') throw new TypeError('telemetry subscriber must be a function');
    this.#subscribers.add(handler);
    return () => this.#subscribers.delete(handler);
  }

  list() { return [...this.#events]; }
  snapshot() {
    const retrieval = { HIGH: 0, MIXED: 0, LOW: 0 };
    const resultDestinations = {};
    const precision = { requests: 0, inputCandidates: 0, outputCandidates: 0, correctivePasses: 0, staleRejected: 0, authorityRejected: 0, deduped: 0, stages: {}, fallbacks: {} };
    let warmHit = 0, warmMiss = 0, retry = 0, fallback = 0, staleDrop = 0;
    const providerHealth={};
    for (const event of this.#events) {
      if (event.type === TelemetryEvent.WARM_HIT || (event.type === TelemetryEvent.CACHE_HIT && event.payload.cacheClass === 'WARM')) warmHit += 1;
      if (event.type === TelemetryEvent.WARM_MISS) warmMiss += 1;
      if (event.type === TelemetryEvent.RETRY) retry += 1;
      if (event.type === TelemetryEvent.FALLBACK_USED) fallback += 1;
      if (event.type === TelemetryEvent.STALE_DROPPED) staleDrop += 1;
      if (event.type === TelemetryEvent.PROVIDER_HEALTH && typeof event.payload.providerProfileId === 'string') providerHealth[event.payload.providerProfileId]=event.payload.health;
      if (event.type === TelemetryEvent.RETRIEVAL_QUALITY && retrieval[event.payload.quality] != null) retrieval[event.payload.quality] += 1;
      if (event.type === TelemetryEvent.RESULT_ROUTED && typeof event.payload.destination === 'string') resultDestinations[event.payload.destination] = (resultDestinations[event.payload.destination] ?? 0) + 1;
      if (event.type === TelemetryEvent.PRECISION_REQUEST) {
        precision.requests += 1; precision.inputCandidates += Number(event.payload.inputCandidateCount ?? 0); if (event.payload.correctivePass) precision.correctivePasses += 1;
      }
      if (event.type === TelemetryEvent.PRECISION_STAGE) {
        precision.outputCandidates += Number(event.payload.outputCandidateCount ?? 0); if (event.payload.stage) precision.stages[event.payload.stage] = (precision.stages[event.payload.stage] ?? 0) + 1;
      }
      if (event.type === TelemetryEvent.PRECISION_FALLBACK && event.payload.fallbackStage) precision.fallbacks[event.payload.fallbackStage] = (precision.fallbacks[event.payload.fallbackStage] ?? 0) + 1;
      if (event.type === TelemetryEvent.CANDIDATE_REJECTED) { if (event.payload.stale) precision.staleRejected += 1; if (event.payload.authorityViolation) precision.authorityRejected += 1; }
      if (event.type === TelemetryEvent.CANDIDATE_DEDUPED) precision.deduped += Number(event.payload.duplicateCount ?? 1);
    }
    return Object.freeze({
      totalEvents: this.#events.length,
      capacity: this.limit,
      eventCounts: Object.freeze(Object.fromEntries(this.#counters)),
      warm: Object.freeze({ hit: warmHit, miss: warmMiss }),
      retrieval: Object.freeze(retrieval),
      precision: Object.freeze({ ...precision, stages: Object.freeze(precision.stages), fallbacks: Object.freeze(precision.fallbacks) }),
      retry,
      fallback,
      staleDrop,
      resultDestinations: Object.freeze(resultDestinations),
      providerHealth: Object.freeze(providerHealth),
    });
  }
}

export function emitTelemetry(telemetry, type, payload = {}) {
  if (!telemetry || typeof telemetry.emit !== 'function') return null;
  try { return telemetry.emit(type, payload); } catch { return null; }
}

function sanitize(payload, bounds, depth = 0, seen = new WeakSet()) {
  if (payload == null || typeof payload === 'number' || typeof payload === 'boolean') return payload;
  if (typeof payload === 'string') return payload.length > bounds.maxString ? `${payload.slice(0, bounds.maxString)}…[clipped]` : payload;
  if (typeof payload === 'bigint') return String(payload);
  if (typeof payload !== 'object') return String(payload);
  if (depth >= bounds.maxDepth) return '[depth-clipped]';
  if (seen.has(payload)) return '[circular]';
  seen.add(payload);
  if (Array.isArray(payload)) {
    const out = payload.slice(0, bounds.maxArray).map((value) => sanitize(value, bounds, depth + 1, seen));
    if (payload.length > bounds.maxArray) out.push(`[+${payload.length - bounds.maxArray} items clipped]`);
    return out;
  }
  const safe = {};
  let count = 0;
  for (const [key, value] of Object.entries(payload)) {
    if (BLOCKED_KEYS.has(key)) continue;
    if (count >= bounds.maxKeys) { safe.__clippedKeys = Object.keys(payload).length - count; break; }
    safe[key] = sanitize(value, bounds, depth + 1, seen);
    count += 1;
  }
  return safe;
}
