import { sha256Hex } from './browser-compat.js';

export const WarmState = Object.freeze({
  FRESH: 'FRESH',
  PARTIALLY_STALE: 'PARTIALLY_STALE',
  STALE: 'STALE',
  INVALID: 'INVALID',
});

export const WARM_PACKET_VERSION = '1.0.0';

export function createWarmIdentity(input = {}) {
  const sourceRevisionSet = uniqueStrings(input.sourceRevisionSet ?? []);
  return deepFreeze({
    sceneRevision: finite(input.sceneRevision, 'sceneRevision'),
    worldRevision: finite(input.worldRevision, 'worldRevision'),
    characterStateRevision: finite(input.characterStateRevision, 'characterStateRevision'),
    sourceRevisionSet,
    intentFingerprint: required(input.intentFingerprint, 'intentFingerprint'),
    retrievalPolicyRevision: required(input.retrievalPolicyRevision ?? '1', 'retrievalPolicyRevision'),
  });
}

export function createWarmPacket({
  packetId = null,
  identity,
  recommendation = null,
  candidateRefs = [],
  evidenceRefs = [],
  retrievalQuality = null,
  truthReceipt = null,
  precisionReceipt = null,
  compiledRepresentation = null,
  createdAt = 0,
  expiresAfterTurns = 2,
  metadata = {},
} = {}) {
  const normalizedIdentity = createWarmIdentity(identity);
  const id = packetId ?? `warm:${sha256Hex(JSON.stringify(normalizedIdentity)).slice(0, 20)}`;
  return deepFreeze({
    kind: 'WarmPacket',
    contractVersion: WARM_PACKET_VERSION,
    packetId: required(id, 'packetId'),
    identity: normalizedIdentity,
    recommendation: recommendation == null ? null : normalizePrefetchRecommendation(recommendation),
    candidateRefs: uniqueStrings(candidateRefs),
    evidenceRefs: uniqueStrings(evidenceRefs),
    retrievalQuality: retrievalQuality == null ? null : String(retrievalQuality),
    truthReceipt: safeClone(truthReceipt),
    precisionReceipt: safeClone(precisionReceipt),
    compiledRepresentation: safeClone(compiledRepresentation),
    createdAt: finite(createdAt, 'createdAt'),
    expiresAfterTurns: nonNegativeInteger(expiresAfterTurns, 'expiresAfterTurns'),
    metadata: safeClone(metadata) ?? {},
    authority: 'NONE',
    canonical: false,
  });
}

export function evaluateWarmPacket(packet, currentIdentity, { turnSequence = 0, storedTurn = 0 } = {}) {
  let current;
  try { current = createWarmIdentity(currentIdentity); }
  catch (error) { return receipt(WarmState.INVALID, packet, [], `INVALID_CURRENT_IDENTITY:${error.message}`); }
  if (!packet || packet.kind !== 'WarmPacket' || !packet.identity) return receipt(WarmState.INVALID, packet, [], 'INVALID_PACKET');
  const prior = packet.identity;
  if (prior.intentFingerprint !== current.intentFingerprint) return receipt(WarmState.INVALID, packet, [], 'INTENT_MISMATCH');
  if (prior.retrievalPolicyRevision !== current.retrievalPolicyRevision) return receipt(WarmState.STALE, packet, [], 'RETRIEVAL_POLICY_CHANGED');
  if (Number(turnSequence) - Number(storedTurn) > Number(packet.expiresAfterTurns ?? 0)) return receipt(WarmState.STALE, packet, [], 'TTL_EXPIRED');
  if (prior.sceneRevision !== current.sceneRevision) return receipt(WarmState.STALE, packet, [], 'SCENE_REVISION_CHANGED');
  if (prior.worldRevision !== current.worldRevision) return receipt(WarmState.STALE, packet, [], 'WORLD_REVISION_CHANGED');

  const source = compareSets(prior.sourceRevisionSet, current.sourceRevisionSet);
  const characterChanged = prior.characterStateRevision !== current.characterStateRevision;
  if (!source.equal || characterChanged) {
    const salvageable = source.overlap.length ? uniqueStrings([...(packet.candidateRefs ?? []), ...(packet.evidenceRefs ?? [])]) : [];
    if (salvageable.length || characterChanged) {
      return deepFreeze({
        ...receipt(WarmState.PARTIALLY_STALE, packet, salvageable, characterChanged ? 'CHARACTER_OR_SOURCE_REVISION_CHANGED' : 'SOURCE_REVISION_CHANGED'),
        compiledRepresentation: null,
        requiresRerank: true,
        requiresRevalidation: true,
        requiresRecompile: true,
      });
    }
    return receipt(WarmState.STALE, packet, [], 'SOURCE_REVISION_SET_REPLACED');
  }
  return deepFreeze({
    ...receipt(WarmState.FRESH, packet, uniqueStrings([...(packet.candidateRefs ?? []), ...(packet.evidenceRefs ?? [])]), 'ALL_FENCES_MATCH'),
    compiledRepresentation: safeClone(packet.compiledRepresentation),
    requiresRerank: false,
    requiresRevalidation: false,
    requiresRecompile: false,
  });
}

export class WarmPacketCache {
  #entries = new Map();
  #sequence = 0;
  #metrics = { hits: 0, misses: 0, partial: 0, stale: 0, invalid: 0, evictions: 0 };

  constructor({ capacity = 24, maxCandidateRefs = 64, defaultTtlTurns = 2 } = {}) {
    this.capacity = positiveInteger(capacity, 'capacity');
    this.maxCandidateRefs = positiveInteger(maxCandidateRefs, 'maxCandidateRefs');
    this.defaultTtlTurns = nonNegativeInteger(defaultTtlTurns, 'defaultTtlTurns');
  }

  put(packetInput, { turnSequence = 0 } = {}) {
    const packet = packetInput?.kind === 'WarmPacket' ? packetInput : createWarmPacket({ ...packetInput, expiresAfterTurns: packetInput?.expiresAfterTurns ?? this.defaultTtlTurns });
    if ((packet.candidateRefs?.length ?? 0) + (packet.evidenceRefs?.length ?? 0) > this.maxCandidateRefs) throw new RangeError('WarmPacket reference budget exceeded');
    const key = warmKey(packet.identity);
    this.#entries.delete(key);
    this.#entries.set(key, { packet, storedTurn: Number(turnSequence), sequence: ++this.#sequence });
    while (this.#entries.size > this.capacity) {
      const oldest = this.#entries.keys().next().value;
      this.#entries.delete(oldest);
      this.#metrics.evictions += 1;
    }
    return packet;
  }

  evaluate(currentIdentity, { turnSequence = 0 } = {}) {
    const identity = createWarmIdentity(currentIdentity);
    const exact = this.#entries.get(warmKey(identity));
    if (exact) {
      this.#entries.delete(warmKey(identity));
      this.#entries.set(warmKey(identity), exact);
      return this.#record(evaluateWarmPacket(exact.packet, identity, { turnSequence, storedTurn: exact.storedTurn }));
    }
    for (const entry of [...this.#entries.values()].reverse()) {
      if (entry.packet.identity.intentFingerprint !== identity.intentFingerprint) continue;
      return this.#record(evaluateWarmPacket(entry.packet, identity, { turnSequence, storedTurn: entry.storedTurn }));
    }
    this.#metrics.misses += 1;
    return deepFreeze({ state: null, packetId: null, reason: 'MISS', salvageableRefs: [], compiledRepresentation: null, requiresForegroundRetrieval: true });
  }

  invalidate({ sceneRevision = null, intentFingerprint = null, sourceRevisionIds = [] } = {}) {
    const sources = new Set(sourceRevisionIds);
    let count = 0;
    for (const [key, entry] of [...this.#entries]) {
      const identity = entry.packet.identity;
      const invalidate = (sceneRevision != null && identity.sceneRevision !== Number(sceneRevision))
        || (intentFingerprint != null && identity.intentFingerprint !== String(intentFingerprint))
        || (sources.size && identity.sourceRevisionSet.some((id) => sources.has(id)));
      if (invalidate) { this.#entries.delete(key); count += 1; }
    }
    return count;
  }

  size() { return this.#entries.size; }
  metrics() { return deepFreeze({ ...this.#metrics, size: this.#entries.size, capacity: this.capacity }); }

  #record(value) {
    if (value.state === WarmState.FRESH) this.#metrics.hits += 1;
    else if (value.state === WarmState.PARTIALLY_STALE) this.#metrics.partial += 1;
    else if (value.state === WarmState.STALE) this.#metrics.stale += 1;
    else if (value.state === WarmState.INVALID) this.#metrics.invalid += 1;
    return value;
  }
}

export class SpeculativeContextWarmer {
  constructor({ retrieve, evaluateQuality, truthCheck = null, precisionRank = null, compile = null, cache = new WarmPacketCache() } = {}) {
    if (typeof retrieve !== 'function') throw new TypeError('retrieve is required');
    if (typeof evaluateQuality !== 'function') throw new TypeError('evaluateQuality is required');
    this.retrieve = retrieve;
    this.evaluateQuality = evaluateQuality;
    this.truthCheck = truthCheck;
    this.precisionRank = precisionRank;
    this.compile = compile;
    this.cache = cache;
  }

  async prepare({ recommendation, identity, turnSequence = 0, context = {} } = {}) {
    const normalizedRecommendation = normalizePrefetchRecommendation(recommendation);
    try {
      const retrieval = await this.retrieve({ recommendation: normalizedRecommendation, identity: createWarmIdentity(identity), context });
      const quality = await this.evaluateQuality(retrieval, { recommendation: normalizedRecommendation, identity, context });
      const truth = typeof this.truthCheck === 'function' ? await this.truthCheck(retrieval, { quality, recommendation: normalizedRecommendation, identity, context }) : null;
      const precision = typeof this.precisionRank === 'function' ? await this.precisionRank(retrieval, { quality, truth, recommendation: normalizedRecommendation, identity, context }) : null;
      const compiledRepresentation = typeof this.compile === 'function' ? await this.compile({ retrieval, quality, truth, precision, recommendation: normalizedRecommendation, identity, context }) : null;
      const packet = createWarmPacket({
        identity,
        recommendation: normalizedRecommendation,
        candidateRefs: refsFrom(retrieval, 'candidateRefs'),
        evidenceRefs: refsFrom(retrieval, 'evidenceRefs'),
        retrievalQuality: quality?.quality ?? quality?.classification ?? null,
        truthReceipt: truth,
        precisionReceipt: precision,
        compiledRepresentation,
        createdAt: Number(context.createdAt ?? 0),
        expiresAfterTurns: Number(context.expiresAfterTurns ?? this.cache.defaultTtlTurns),
      });
      this.cache.put(packet, { turnSequence });
      return deepFreeze({ status: 'WARMED', packet, correctnessDegraded: false });
    } catch (error) {
      return deepFreeze({ status: 'WARMER_FAILED', packet: null, correctnessDegraded: false, foregroundFallback: 'NORMAL_FOREGROUND_RETRIEVAL', reason: String(error?.message ?? error) });
    }
  }
}

export function normalizePrefetchRecommendation(input = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('PrefetchRecommendation is required');
  if (input.kind != null && input.kind !== 'PrefetchRecommendation') throw new TypeError(`Unsupported prefetch kind: ${input.kind}`);
  if (input.authority != null && input.authority !== 'NONE') throw new TypeError('PrefetchRecommendation cannot grant authority');
  return deepFreeze({
    kind: 'PrefetchRecommendation',
    recommendationId: required(input.recommendationId, 'recommendationId'),
    sceneId: required(input.sceneId, 'sceneId'),
    sceneRevision: finite(input.sceneRevision, 'sceneRevision'),
    trigger: required(input.trigger, 'trigger'),
    entityRefs: boundedStrings(input.entityRefs ?? [], 32, 'entityRefs'),
    locationRefs: boundedStrings(input.locationRefs ?? [], 16, 'locationRefs'),
    threadRefs: boundedStrings(input.threadRefs ?? [], 32, 'threadRefs'),
    sceneRefs: boundedStrings(input.sceneRefs ?? [], 16, 'sceneRefs'),
    priority: String(input.priority ?? 'NORMAL'),
    expiryRevision: finite(input.expiryRevision ?? input.sceneRevision, 'expiryRevision'),
    evidenceRefs: boundedStrings(input.evidenceRefs ?? [], 64, 'evidenceRefs'),
    authority: 'NONE',
    status: String(input.status ?? 'ACTIVE'),
  });
}

function receipt(state, packet, salvageableRefs, reason) {
  return deepFreeze({
    state,
    packetId: packet?.packetId ?? null,
    reason,
    salvageableRefs: uniqueStrings(salvageableRefs ?? []),
    compiledRepresentation: null,
    requiresForegroundRetrieval: state !== WarmState.FRESH,
    authority: 'NONE',
  });
}
function warmKey(identity) { return `${identity.sceneRevision}|${identity.intentFingerprint}|${identity.retrievalPolicyRevision}`; }
function compareSets(a, b) { const aa = new Set(a), bb = new Set(b); const overlap = [...aa].filter((x) => bb.has(x)); return { equal: aa.size === bb.size && overlap.length === aa.size, overlap }; }
function refsFrom(value, key) { const list = value?.[key] ?? value?.refs ?? []; return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []; }
function boundedStrings(values, max, name) { const out = uniqueStrings(values); if (out.length > max) throw new RangeError(`${name} exceeds ${max}`); return out; }
function uniqueStrings(values) { if (!Array.isArray(values)) throw new TypeError('expected array'); return [...new Set(values.map((value) => required(value, 'reference')))].sort(); }
function required(value, name) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`); return value.trim(); }
function finite(value, name) { const number = Number(value); if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`); return number; }
function positiveInteger(value, name) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new TypeError(`${name} must be a positive integer`); return number; }
function nonNegativeInteger(value, name) { const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative integer`); return number; }
function safeClone(value) { return value == null ? null : structuredClone(value); }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
