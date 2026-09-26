import { TelemetryEvent } from './constants.js';

const BLOCKED_KEYS = new Set([
  'prompt', 'rawPrompt', 'rawResponse', 'fullResponse', 'response', 'payload', 'messages', 'candidateBodies',
  'candidateText', 'sourceText', 'retrievedSourceText', 'retrievedText', 'fullArtifact', 'rawArtifact',
  'conversation', 'fullConversation', 'chatHistory', 'lorebook', 'fullLorebook', 'memory', 'allMemory',
  'privateDiagnostics', 'chainOfThought', 'reasoning',
  'apiKey', 'api_key', 'authorization', 'credential', 'credentials', 'secret', 'token', 'accessToken', 'refreshToken',
]);
const NORMALIZED_BLOCKED_KEYS = new Set([...BLOCKED_KEYS].map(normalizeKey));
const DEFAULT_BOUNDS = Object.freeze({ maxDepth: 5, maxKeys: 64, maxArray: 64, maxString: 768 });

export class CoprocessorTelemetry {
  #subscribers = new Set();
  #events = [];
  #counters = new Map();
  #revision = 0;
  #snapshotCache = null;

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
    this.#revision += 1;
    this.#snapshotCache = null;
    if (this.#events.length > this.limit) this.#events.splice(0, this.#events.length - this.limit);
    for (const handler of [...this.#subscribers]) { try { handler(event); } catch {} }
    return event;
  }

  subscribe(handler) {
    if (typeof handler !== 'function') throw new TypeError('telemetry subscriber must be a function');
    this.#subscribers.add(handler);
    return () => this.#subscribers.delete(handler);
  }

  get revision() { return this.#revision; }
  list({ limit = null } = {}) {
    const requested = Number(limit);
    if (!Number.isFinite(requested) || requested <= 0 || requested >= this.#events.length) return [...this.#events];
    return this.#events.slice(-Math.floor(requested));
  }
  snapshot() {
    if (this.#snapshotCache) return this.#snapshotCache;
    const retrieval = { HIGH: 0, MIXED: 0, LOW: 0 };
    const resultDestinations = {};
    const precision = { requests: 0, inputCandidates: 0, outputCandidates: 0, correctivePasses: 0, staleRejected: 0, authorityRejected: 0, deduped: 0, stages: {}, fallbacks: {} };
    let warmHit = 0, warmMiss = 0, retry = 0, fallback = 0, staleDrop = 0;
    const providerHealth={};
    const choice={proposals:0,options:0,nominated:0,skipped:0,deferred:0,unavailable:0,executions:0,degraded:0,states:{}};
    const resources={configured:0,connecting:0,ready:0,disconnected:0,testsPassed:0,testsFailed:0,executionsSucceeded:0,executionsFailed:0,states:{},measurementClasses:{}};
    const providerCalls={invoked:0,failed:0,usageReceipts:0,costMeasured:0,costNotMeasured:0,measurementClasses:{}};
    const swarm={turnsPlanned:0,assignments:0,results:0,checkpoints:0,resumes:0,fallbacks:0,states:{},resources:{}};
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
      if (event.type === TelemetryEvent.CHOICE_PROPOSED) choice.proposals += 1;
      if (event.type === TelemetryEvent.CHOICE_OPTION) {
        choice.options += 1; const d=event.payload.disposition; if(d==='NOMINATED')choice.nominated+=1; else if(d==='SKIPPED')choice.skipped+=1; else if(d==='DEFERRED')choice.deferred+=1; else if(d==='UNAVAILABLE')choice.unavailable+=1;
      }
      if (event.type === TelemetryEvent.CHOICE_EXECUTION) { choice.executions += 1; for (const [state,count] of Object.entries(event.payload)) if (typeof count==='number' && count>0) choice.states[state]=(choice.states[state]??0)+count; }
      if (event.type === TelemetryEvent.CHOICE_DEGRADED) choice.degraded += 1;
      if (event.type === TelemetryEvent.RESOURCE_CONFIGURED) resources.configured += 1;
      if (event.type === TelemetryEvent.RESOURCE_CONNECTING) resources.connecting += 1;
      if (event.type === TelemetryEvent.RESOURCE_READY) resources.ready += 1;
      if (event.type === TelemetryEvent.RESOURCE_DISCONNECTED) resources.disconnected += 1;
      if (event.type === TelemetryEvent.RESOURCE_TESTED) { if (event.payload.testStatus === 'PASS') resources.testsPassed += 1; else if (event.payload.testStatus === 'FAIL') resources.testsFailed += 1; }
      if (event.type === TelemetryEvent.RESOURCE_EXECUTION) { if (event.payload.status === 'SUCCESS') resources.executionsSucceeded += 1; else if (event.payload.status === 'FAIL') resources.executionsFailed += 1; }
      if ([TelemetryEvent.RESOURCE_CONFIGURED,TelemetryEvent.RESOURCE_CONNECTING,TelemetryEvent.RESOURCE_READY,TelemetryEvent.RESOURCE_DISCONNECTED,TelemetryEvent.RESOURCE_TESTED,TelemetryEvent.RESOURCE_EXECUTION].includes(event.type)) { const state=event.payload.state; if(state)resources.states[state]=(resources.states[state]??0)+1; const m=event.payload.measurementClass; if(m)resources.measurementClasses[m]=(resources.measurementClasses[m]??0)+1; }
      if (event.type === TelemetryEvent.PROVIDER_INVOKED) { providerCalls.invoked += 1; const m=event.payload.measurementClass; if(m)providerCalls.measurementClasses[m]=(providerCalls.measurementClasses[m]??0)+1; }
      if (event.type === TelemetryEvent.PROVIDER_FAILED) providerCalls.failed += 1;
      if (event.type === TelemetryEvent.PROVIDER_USAGE) { providerCalls.usageReceipts += 1; const status=event.payload.usageReceipt?.cost?.status; if(status==='MEASURED')providerCalls.costMeasured+=1; else providerCalls.costNotMeasured+=1; const m=event.payload.measurementClass; if(m)providerCalls.measurementClasses[m]=(providerCalls.measurementClasses[m]??0)+1; }
      if (event.type === TelemetryEvent.SWARM_TURN_PLANNED) swarm.turnsPlanned += 1;
      if (event.type === TelemetryEvent.SWARM_TASK_ASSIGNED) { swarm.assignments += 1; const r=event.payload.resourceId; if(r)swarm.resources[r]=(swarm.resources[r]??0)+1; }
      if (event.type === TelemetryEvent.SWARM_TASK_RESULT) { swarm.results += 1; const state=event.payload.state; if(state)swarm.states[state]=(swarm.states[state]??0)+1; if(event.payload.fallbackUsed)swarm.fallbacks+=1; }
      if (event.type === TelemetryEvent.SWARM_CHECKPOINTED) swarm.checkpoints += 1;
      if (event.type === TelemetryEvent.SWARM_RESUMED) swarm.resumes += 1;
    }
    this.#snapshotCache = Object.freeze({
      revision: this.#revision,
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
      choice: Object.freeze({...choice,states:Object.freeze(choice.states)}),
      resources: Object.freeze({...resources,states:Object.freeze(resources.states),measurementClasses:Object.freeze(resources.measurementClasses)}),
      providerCalls: Object.freeze({...providerCalls,measurementClasses:Object.freeze(providerCalls.measurementClasses)}),
      swarm: Object.freeze({...swarm,states:Object.freeze(swarm.states),resources:Object.freeze(swarm.resources)}),
    });
    return this.#snapshotCache;
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
    if (BLOCKED_KEYS.has(key) || NORMALIZED_BLOCKED_KEYS.has(normalizeKey(key))) continue;
    if (count >= bounds.maxKeys) { safe.__clippedKeys = Object.keys(payload).length - count; break; }
    safe[key] = sanitize(value, bounds, depth + 1, seen);
    count += 1;
  }
  return safe;
}

function normalizeKey(value) { return String(value??'').replace(/[^a-z0-9]/gi,'').toLowerCase(); }
