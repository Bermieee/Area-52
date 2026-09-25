import { TelemetryEvent } from './constants.js';
import { sha256Hex } from './browser-compat.js';
import { emitTelemetry } from './telemetry.js';
import {
  WarmPacketCache, WarmState, createWarmIdentity, createWarmPacket, normalizePrefetchRecommendation,
} from './speculative-warmer.js';

export const SPECULATIVE_WARM_COORDINATOR_VERSION = '1.0.0';

export const DEFAULT_WARM_COORDINATOR_LIMITS = Object.freeze({
  maxActivePreparations: 1,
  maxQueuedPreparations: 8,
  maxIntents: 64,
  retrievalBatchSize: 8,
  maxCandidateRefs: 48,
  maxEvidenceRefs: 64,
  maxPacketBytes: 32768,
  maxEstimatedTokens: 8192,
  maxReceiptBytes: 4096,
  maxDiagnostics: 256,
  maxSealedTurns: 64,
  defaultTtlTurns: 2,
});

const ACTIVE_RECOMMENDATION_STATUS = new Set(['ACTIVE']);
const FINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED']);

export class SpeculativeWarmCoordinator {
  #queue = [];
  #jobsByKey = new Map();
  #activeJobs = new Set();
  #foregroundActive = false;
  #sealedTurns = new Map();
  #diagnostics = [];
  #consumptions = new Map();
  #sequence = 0;
  #metrics = {
    predictionAttempts: 0,
    rejectedRecommendations: 0,
    coalescedRecommendations: 0,
    queueFullFallbacks: 0,
    preparationsStarted: 0,
    preparationsCompleted: 0,
    preparationsFailed: 0,
    preparationsCancelled: 0,
    preparationsYielded: 0,
    preparationsResumed: 0,
    usefulFreshHits: 0,
    freshCandidates: 0,
    partialSalvage: 0,
    staleDiscards: 0,
    invalidDiscards: 0,
    misses: 0,
    falseWarmHits: 0,
    lateAfterSeal: 0,
    foregroundFallbacks: 0,
    nativeReferenceOnlyPreparations: 0,
    optionalProviderPreparations: 0,
    avoidedRetrieval: 0,
    avoidedTruth: 0,
    avoidedPrecision: 0,
    avoidedCompile: 0,
  };

  constructor({
    adapters = {},
    cache = null,
    telemetry = null,
    limits = {},
    clock = () => globalThis.performance?.now?.() ?? Date.now(),
  } = {}) {
    this.limits = normalizeLimits(limits);
    this.cache = cache ?? new WarmPacketCache({
      capacity: Math.max(4, this.limits.maxQueuedPreparations * 2),
      maxCandidateRefs: this.limits.maxCandidateRefs + this.limits.maxEvidenceRefs,
      defaultTtlTurns: this.limits.defaultTtlTurns,
    });
    this.telemetry = telemetry;
    this.clock = typeof clock === 'function' ? clock : (() => Date.now());
    const native = createNativeReferenceWarmAdapters();
    this.adapters = Object.freeze({
      retrieve: typeof adapters.retrieve === 'function' ? adapters.retrieve : native.retrieve,
      evaluateQuality: typeof adapters.evaluateQuality === 'function' ? adapters.evaluateQuality : native.evaluateQuality,
      truthCheck: typeof adapters.truthCheck === 'function' ? adapters.truthCheck : null,
      precisionRank: typeof adapters.precisionRank === 'function' ? adapters.precisionRank : null,
      compile: typeof adapters.compile === 'function' ? adapters.compile : null,
      providerMode: typeof adapters.retrieve === 'function' ? String(adapters.providerMode ?? 'OPTIONAL_INJECTED') : 'NATIVE_REFERENCE_ONLY',
    });
  }

  enqueuePreparation(input = {}) {
    this.#metrics.predictionAttempts += 1;
    let request;
    try {
      request = normalizePreparationRequest(input, this.limits);
    } catch (error) {
      this.#metrics.rejectedRecommendations += 1;
      this.#metrics.foregroundFallbacks += 1;
      const result = frozenResult('REJECTED', {
        reason: String(error?.message ?? error),
        foregroundFallback: 'NORMAL_FOREGROUND_RETRIEVAL',
      });
      this.#diag('RECOMMENDATION_REJECTED', { reason: result.reason });
      emitTelemetry(this.telemetry, TelemetryEvent.WARM_MISS, { reason: result.reason, phase: 'PREFETCH_ACCEPTANCE' });
      return Object.freeze({ status: 'REJECTED', preparationId: null, promise: Promise.resolve(result) });
    }

    const key = preparationKey(request);
    const existing = this.#jobsByKey.get(key);
    if (existing && !FINAL_STATES.has(existing.status)) {
      this.#metrics.coalescedRecommendations += 1;
      this.#diag('RECOMMENDATION_COALESCED', { preparationId: existing.preparationId, key });
      return Object.freeze({ status: 'COALESCED', preparationId: existing.preparationId, promise: existing.promise });
    }

    const pendingCount = this.#queue.length + this.#activeJobs.size;
    if (pendingCount >= this.limits.maxQueuedPreparations + this.limits.maxActivePreparations) {
      this.#metrics.queueFullFallbacks += 1;
      this.#metrics.foregroundFallbacks += 1;
      const result = frozenResult('QUEUE_FULL', {
        reason: 'WARM_PREPARATION_QUEUE_FULL',
        foregroundFallback: 'NORMAL_FOREGROUND_RETRIEVAL',
      });
      this.#diag('QUEUE_FULL', { key, pendingCount });
      emitTelemetry(this.telemetry, TelemetryEvent.WARM_MISS, { reason: result.reason, phase: 'PREFETCH_QUEUE' });
      return Object.freeze({ status: 'QUEUE_FULL', preparationId: null, promise: Promise.resolve(result) });
    }

    const preparationId = 'warm-prep:' + (++this.#sequence);
    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    const job = {
      preparationId,
      key,
      request,
      status: 'QUEUED',
      cancelled: false,
      cancelReason: null,
      checkpoint: {
        nextIntentOffset: 0,
        candidateRefs: [],
        evidenceRefs: [...request.recommendation.evidenceRefs],
        retrievalReceipts: [],
      },
      resolve: resolvePromise,
      promise,
      yielded: false,
      enqueuedAt: this.clock(),
    };
    this.#jobsByKey.set(key, job);
    this.#queue.push(job);
    this.#diag('PREPARATION_QUEUED', { preparationId, queueDepth: this.#queue.length });
    emitTelemetry(this.telemetry, TelemetryEvent.TASK_QUEUED, {
      taskType: 'SPECULATIVE_CONTEXT_WARM',
      preparationId,
      queueDepth: this.#queue.length,
      authority: 'NONE',
    });
    this.#drain();
    return Object.freeze({ status: 'QUEUED', preparationId, promise });
  }

  async prepare(input = {}) {
    return this.enqueuePreparation(input).promise;
  }

  onForegroundStart({ turnId = null } = {}) {
    this.#foregroundActive = true;
    this.#diag('FOREGROUND_STARTED', { turnId, activePreparations: this.#activeJobs.size });
    emitTelemetry(this.telemetry, TelemetryEvent.TASK_YIELD_REQUESTED, {
      taskType: 'SPECULATIVE_CONTEXT_WARM',
      turnId,
      activePreparations: this.#activeJobs.size,
    });
    return Object.freeze({ yieldRequested: true, activePreparations: this.#activeJobs.size });
  }

  onForegroundEnd({ currentIdentity = null } = {}) {
    if (currentIdentity) this.invalidateActiveWork({ currentIdentity, reason: 'FOREGROUND_RESUME_FENCE_CHECK' });
    this.#foregroundActive = false;
    this.#diag('FOREGROUND_ENDED', { queuedPreparations: this.#queue.length });
    this.#drain();
    return Object.freeze({ resumed: true, queuedPreparations: this.#queue.length });
  }

  markTurnSealed(turnId) {
    const id = required(turnId, 'turnId');
    this.#sealedTurns.delete(id);
    this.#sealedTurns.set(id, ++this.#sequence);
    while (this.#sealedTurns.size > this.limits.maxSealedTurns) this.#sealedTurns.delete(this.#sealedTurns.keys().next().value);
    this.#diag('TURN_SEALED', { turnId: id });
  }

  invalidateActiveWork({ currentIdentity, reason = 'REVISION_CHANGED' } = {}) {
    const current = createWarmIdentity(currentIdentity);
    let cancelled = 0;
    for (const job of this.#jobsByKey.values()) {
      if (FINAL_STATES.has(job.status)) continue;
      if (samePreparationFences(job.request.identity, current)) continue;
      job.cancelled = true;
      job.cancelReason = reason;
      cancelled += 1;
      if (job.status === 'QUEUED' || job.status === 'PARKED') {
        this.#finishCancelled(job);
      }
    }
    if (cancelled) {
      this.#queue = this.#queue.filter((job) => !job.cancelled);
      emitTelemetry(this.telemetry, TelemetryEvent.TASK_SUPERSEDED, {
        taskType: 'SPECULATIVE_CONTEXT_WARM',
        cancelled,
        reason,
      });
    }
    return cancelled;
  }

  consumeForSend({ identity, turnSequence = 0, turnId = null } = {}) {
    let current;
    try { current = createWarmIdentity(identity); }
    catch (error) {
      this.#metrics.invalidDiscards += 1;
      this.#metrics.foregroundFallbacks += 1;
      return frozenResult('FOREGROUND_FALLBACK', {
        freshness: WarmState.INVALID,
        reason: 'INVALID_CURRENT_IDENTITY:' + String(error?.message ?? error),
        foregroundFallback: 'NORMAL_FOREGROUND_RETRIEVAL',
        admissionAllowed: false,
      });
    }

    if (turnId != null && this.#sealedTurns.has(String(turnId))) {
      this.#metrics.lateAfterSeal += 1;
      this.#metrics.foregroundFallbacks += 1;
      this.#diag('LATE_SEND_REJECTED', { turnId: String(turnId) });
      emitTelemetry(this.telemetry, TelemetryEvent.LATE_ROUTED, {
        taskType: 'SPECULATIVE_CONTEXT_WARM',
        turnId: String(turnId),
        destination: 'NEXT_TURN_OR_DROP',
      });
      return frozenResult('LATE_REJECTED', {
        freshness: WarmState.INVALID,
        reason: 'CONTEXT_ALREADY_SEALED',
        foregroundFallback: 'NORMAL_FOREGROUND_RETRIEVAL',
        admissionAllowed: false,
      });
    }

    const evaluated = this.cache.evaluate(current, { turnSequence });
    if (!evaluated.state) {
      this.#metrics.misses += 1;
      this.#metrics.foregroundFallbacks += 1;
      emitTelemetry(this.telemetry, TelemetryEvent.WARM_MISS, { reason: 'MISS', intentFingerprint: current.intentFingerprint });
      return frozenResult('FOREGROUND_FALLBACK', {
        freshness: null,
        reason: 'MISS',
        foregroundFallback: 'NORMAL_FOREGROUND_RETRIEVAL',
        admissionAllowed: false,
      });
    }

    if (evaluated.state === WarmState.FRESH) {
      const packet = this.#findPacketByIdentity(current);
      const coverage = packet?.metadata?.stageCoverage ?? {};
      const compiled = normalizeReusableCompiled(packet?.compiledRepresentation);
      const compiledReusable = Boolean(compiled?.reusable && coverage.truth);
      const requiredForegroundStages = ['CORE_FRESHNESS_REVALIDATION'];
      if (!coverage.retrieval) requiredForegroundStages.push('RETRIEVAL');
      if (coverage.truth) requiredForegroundStages.push('CORE_TRUTH_RECEIPT_REVALIDATION');
      else requiredForegroundStages.push('TRUTH_CHECK');
      if (!coverage.precision) requiredForegroundStages.push('OPTIONAL_PRECISION');
      if (!compiledReusable) requiredForegroundStages.push('COMPILE');
      requiredForegroundStages.push('CORE_ADMISSION');
      const consumptionId = 'warm-consume:' + (++this.#sequence);
      const reusableRefs = boundedUniqueStrings(evaluated.salvageableRefs ?? [], this.limits.maxCandidateRefs + this.limits.maxEvidenceRefs);
      const record = {
        consumptionId,
        state: WarmState.FRESH,
        packetId: evaluated.packetId,
        coverage: structuredClone(coverage),
        compiledReusable,
        createdAt: this.clock(),
      };
      this.#rememberConsumption(record);
      this.#metrics.freshCandidates += 1;
      emitTelemetry(this.telemetry, TelemetryEvent.WARM_HIT, {
        packetId: evaluated.packetId,
        consumptionId,
        admissionPending: true,
        reusableRefCount: reusableRefs.length,
      });
      return deepFreeze({
        status: 'REVALIDATE_FOR_CORE_ADMISSION',
        consumptionId,
        freshness: WarmState.FRESH,
        packetId: evaluated.packetId,
        reusableRefs,
        compiledReference: compiledReusable ? compiled.reference : null,
        truthReceipt: boundedReceipt(packet?.truthReceipt, 'TRUTH', this.limits),
        precisionReceipt: boundedReceipt(packet?.precisionReceipt, 'PRECISION', this.limits),
        requiredForegroundStages,
        requiresCoreFreshnessRevalidation: true,
        admissionAllowed: false,
        authority: 'NONE',
        foregroundFallback: null,
      });
    }

    if (evaluated.state === WarmState.PARTIALLY_STALE) {
      this.#metrics.partialSalvage += 1;
      const refs = boundedUniqueStrings(evaluated.salvageableRefs ?? [], this.limits.maxCandidateRefs + this.limits.maxEvidenceRefs);
      emitTelemetry(this.telemetry, TelemetryEvent.WARM_PARTIAL, {
        packetId: evaluated.packetId,
        salvageableRefCount: refs.length,
        reason: evaluated.reason,
      });
      return deepFreeze({
        status: 'PARTIAL_SALVAGE_REQUIRES_FOREGROUND_RECHECK',
        freshness: WarmState.PARTIALLY_STALE,
        packetId: evaluated.packetId,
        reusableRefs: refs,
        compiledReference: null,
        truthReceipt: null,
        precisionReceipt: null,
        requiredForegroundStages: ['RERANK', 'TRUTH_RECHECK', 'RECOMPILE', 'CORE_ADMISSION'],
        requiresCoreFreshnessRevalidation: true,
        admissionAllowed: false,
        authority: 'NONE',
        foregroundFallback: refs.length ? 'SALVAGE_REFERENCES_THEN_FOREGROUND_PIPELINE' : 'NORMAL_FOREGROUND_RETRIEVAL',
      });
    }

    if (evaluated.state === WarmState.STALE) this.#metrics.staleDiscards += 1;
    else this.#metrics.invalidDiscards += 1;
    this.#metrics.foregroundFallbacks += 1;
    emitTelemetry(this.telemetry, TelemetryEvent.STALE_DROPPED, {
      packetId: evaluated.packetId,
      freshness: evaluated.state,
      reason: evaluated.reason,
    });
    emitTelemetry(this.telemetry, TelemetryEvent.WARM_MISS, {
      packetId: evaluated.packetId,
      freshness: evaluated.state,
      reason: evaluated.reason,
    });
    return deepFreeze({
      status: 'FOREGROUND_FALLBACK',
      freshness: evaluated.state,
      packetId: evaluated.packetId,
      reason: evaluated.reason,
      reusableRefs: [],
      compiledReference: null,
      requiredForegroundStages: ['NORMAL_FOREGROUND_RETRIEVAL', 'TRUTH', 'COMPILE', 'CORE_ADMISSION'],
      admissionAllowed: false,
      authority: 'NONE',
      foregroundFallback: 'NORMAL_FOREGROUND_RETRIEVAL',
    });
  }

  recordCoreRevalidation({ consumptionId, accepted, reason = null } = {}) {
    const id = required(consumptionId, 'consumptionId');
    const record = this.#consumptions.get(id);
    if (!record) throw new Error('unknown or expired warm consumption');
    this.#consumptions.delete(id);
    if (!accepted) {
      this.#metrics.falseWarmHits += 1;
      this.#metrics.foregroundFallbacks += 1;
      emitTelemetry(this.telemetry, TelemetryEvent.WARM_MISS, {
        packetId: record.packetId,
        consumptionId: id,
        reason: reason ?? 'CORE_REVALIDATION_REJECTED',
        falseWarmHit: true,
      });
      return frozenResult('CORE_REVALIDATION_REJECTED', {
        packetId: record.packetId,
        foregroundFallback: 'NORMAL_FOREGROUND_RETRIEVAL',
        admissionAllowed: false,
      });
    }
    this.#metrics.usefulFreshHits += 1;
    if (record.coverage.retrieval) this.#metrics.avoidedRetrieval += 1;
    if (record.coverage.truth) this.#metrics.avoidedTruth += 1;
    if (record.coverage.precision) this.#metrics.avoidedPrecision += 1;
    if (record.compiledReusable) this.#metrics.avoidedCompile += 1;
    return deepFreeze({
      status: 'CORE_REVALIDATED',
      packetId: record.packetId,
      reusableDerivedMaterialAccepted: true,
      avoidedWork: {
        retrieval: Boolean(record.coverage.retrieval),
        truth: Boolean(record.coverage.truth),
        precision: Boolean(record.coverage.precision),
        compile: Boolean(record.compiledReusable),
      },
      admissionAuthority: 'CORE_ONLY',
      warmerAuthority: 'NONE',
    });
  }

  metrics() {
    const parked = [...this.#jobsByKey.values()].filter((job) => job.status === 'PARKED').length;
    return deepFreeze({
      ...this.#metrics,
      activePreparations: this.#activeJobs.size,
      queuedPreparations: this.#queue.length,
      parkedPreparations: parked,
      retainedDiagnostics: this.#diagnostics.length,
      pendingCoreRevalidations: this.#consumptions.size,
      cache: this.cache.metrics(),
      limits: structuredClone(this.limits),
      providerMode: this.adapters.providerMode,
    });
  }

  diagnostics() {
    return deepFreeze(structuredClone(this.#diagnostics));
  }

  #drain() {
    if (this.#foregroundActive) return;
    while (this.#activeJobs.size < this.limits.maxActivePreparations && this.#queue.length) {
      const job = this.#queue.shift();
      if (!job || job.cancelled || FINAL_STATES.has(job.status)) continue;
      if (job.yielded) this.#metrics.preparationsResumed += 1;
      job.status = 'RUNNING';
      this.#activeJobs.add(job);
      this.#metrics.preparationsStarted += 1;
      emitTelemetry(this.telemetry, job.yielded ? TelemetryEvent.TASK_RESUMED : TelemetryEvent.TASK_STARTED, {
        taskType: 'SPECULATIVE_CONTEXT_WARM',
        preparationId: job.preparationId,
        nextIntentOffset: job.checkpoint.nextIntentOffset,
      });
      void this.#execute(job);
    }
  }

  async #execute(job) {
    const startedAt = this.clock();
    try {
      const { request } = job;
      const intents = request.intents;
      while (job.checkpoint.nextIntentOffset < intents.length) {
        if (job.cancelled) return this.#finishCancelled(job);
        if (this.#foregroundActive) return this.#park(job);
        const offset = job.checkpoint.nextIntentOffset;
        const slice = intents.slice(offset, offset + this.limits.retrievalBatchSize);
        const retrieval = await this.adapters.retrieve({
          intentSlice: structuredClone(slice),
          recommendation: request.recommendation,
          identity: request.identity,
          context: request.context,
          checkpoint: deepFreeze(structuredClone(job.checkpoint)),
        });
        if (job.cancelled) return this.#finishCancelled(job);
        const refs = extractRetrievalReferences(retrieval, this.limits);
        job.checkpoint.candidateRefs = mergeBounded(
          job.checkpoint.candidateRefs, refs.candidateRefs, this.limits.maxCandidateRefs, 'candidate refs',
        );
        job.checkpoint.evidenceRefs = mergeBounded(
          job.checkpoint.evidenceRefs, refs.evidenceRefs, this.limits.maxEvidenceRefs, 'evidence refs',
        );
        job.checkpoint.retrievalReceipts.push(boundedReceipt(retrieval?.receipt ?? {
          status: retrieval?.status ?? 'OK',
          candidateRefCount: refs.candidateRefs.length,
          evidenceRefCount: refs.evidenceRefs.length,
        }, 'RETRIEVAL', this.limits));
        if (job.checkpoint.retrievalReceipts.length > Math.ceil(this.limits.maxIntents / this.limits.retrievalBatchSize)) {
          job.checkpoint.retrievalReceipts.shift();
        }
        job.checkpoint.nextIntentOffset += slice.length;
        emitTelemetry(this.telemetry, TelemetryEvent.BATCH_SLICE, {
          taskType: 'SPECULATIVE_CONTEXT_WARM',
          preparationId: job.preparationId,
          processed: job.checkpoint.nextIntentOffset,
          total: intents.length,
          candidateRefCount: job.checkpoint.candidateRefs.length,
        });
        if (this.#foregroundActive && job.checkpoint.nextIntentOffset < intents.length) return this.#park(job);
      }

      if (job.cancelled) return this.#finishCancelled(job);
      if (this.#foregroundActive) return this.#park(job);

      const referenceBundle = deepFreeze({
        candidateRefs: boundedUniqueStrings(job.checkpoint.candidateRefs, this.limits.maxCandidateRefs),
        evidenceRefs: boundedUniqueStrings(job.checkpoint.evidenceRefs, this.limits.maxEvidenceRefs),
        retrievalReceipts: structuredClone(job.checkpoint.retrievalReceipts),
      });
      const qualityRaw = await this.adapters.evaluateQuality(referenceBundle, {
        recommendation: request.recommendation, identity: request.identity, context: request.context,
      });
      const qualityReceipt = boundedReceipt(qualityRaw, 'QUALITY', this.limits);
      if (this.#foregroundActive) return this.#park(job, { afterRetrieval: true });

      const truthRaw = this.adapters.truthCheck
        ? await this.adapters.truthCheck(referenceBundle, {
          quality: qualityReceipt, recommendation: request.recommendation, identity: request.identity, context: request.context,
        })
        : null;
      const truthReceipt = this.adapters.truthCheck ? boundedReceipt(truthRaw, 'TRUTH', this.limits) : null;
      if (this.#foregroundActive) return this.#park(job, { afterRetrieval: true });

      const precisionRaw = this.adapters.precisionRank
        ? await this.adapters.precisionRank(referenceBundle, {
          quality: qualityReceipt, truth: truthReceipt, recommendation: request.recommendation,
          identity: request.identity, context: request.context,
        })
        : null;
      const precisionReceipt = this.adapters.precisionRank ? boundedReceipt(precisionRaw, 'PRECISION', this.limits) : null;
      if (this.#foregroundActive) return this.#park(job, { afterRetrieval: true });

      const compiledRaw = this.adapters.compile
        ? await this.adapters.compile({
          references: referenceBundle, quality: qualityReceipt, truth: truthReceipt, precision: precisionReceipt,
          recommendation: request.recommendation, identity: request.identity, context: request.context,
        })
        : null;
      const compiledRepresentation = normalizeCompiledResult(compiledRaw, this.limits, request.identity);
      const stageCoverage = {
        retrieval: this.adapters.providerMode !== 'NATIVE_REFERENCE_ONLY',
        quality: true,
        truth: Boolean(this.adapters.truthCheck && truthReceipt),
        precision: Boolean(this.adapters.precisionRank && precisionReceipt),
        compile: Boolean(compiledRepresentation?.reusable),
      };
      const elapsedMs = Math.max(0, this.clock() - startedAt);
      const packet = createWarmPacket({
        identity: request.identity,
        recommendation: request.recommendation,
        candidateRefs: referenceBundle.candidateRefs,
        evidenceRefs: referenceBundle.evidenceRefs,
        retrievalQuality: qualityReceipt?.quality ?? qualityReceipt?.classification ?? qualityReceipt?.status ?? null,
        truthReceipt,
        precisionReceipt,
        compiledRepresentation,
        createdAt: Number(request.context.createdAt ?? 0),
        expiresAfterTurns: Number(request.context.expiresAfterTurns ?? this.cache.defaultTtlTurns ?? this.limits.defaultTtlTurns),
        metadata: {
          coordinatorVersion: SPECULATIVE_WARM_COORDINATOR_VERSION,
          providerMode: this.adapters.providerMode,
          stageCoverage,
          preparationCostMs: elapsedMs,
          retrievalBatchCount: job.checkpoint.retrievalReceipts.length,
          intentCount: request.intents.length,
          authority: 'NONE',
        },
      });
      assertPacketBounds(packet, this.limits);
      this.cache.put(packet, { turnSequence: request.turnSequence });

      const targetTurnId = request.context.targetTurnId == null ? null : String(request.context.targetTurnId);
      const late = targetTurnId != null && this.#sealedTurns.has(targetTurnId);
      if (late) {
        this.#metrics.lateAfterSeal += 1;
        this.#diag('PREPARED_AFTER_SEAL', { preparationId: job.preparationId, packetId: packet.packetId, targetTurnId });
      }
      if (this.adapters.providerMode === 'NATIVE_REFERENCE_ONLY') this.#metrics.nativeReferenceOnlyPreparations += 1;
      else this.#metrics.optionalProviderPreparations += 1;
      this.#metrics.preparationsCompleted += 1;
      job.status = 'COMPLETED';
      const result = deepFreeze({
        status: late ? 'LATE_CACHED_FOR_FUTURE' : 'WARMED',
        preparationId: job.preparationId,
        packet,
        usableForTargetTurn: !late,
        foregroundFallback: null,
        correctnessDegraded: false,
        authority: 'NONE',
      });
      this.#finish(job, result);
    } catch (error) {
      if (job.cancelled) return this.#finishCancelled(job);
      this.#metrics.preparationsFailed += 1;
      this.#metrics.foregroundFallbacks += 1;
      job.status = 'FAILED';
      const result = frozenResult('WARMER_FAILED', {
        preparationId: job.preparationId,
        reason: String(error?.message ?? error),
        packet: null,
        correctnessDegraded: false,
        foregroundFallback: 'NORMAL_FOREGROUND_RETRIEVAL',
      });
      this.#diag('PREPARATION_FAILED', { preparationId: job.preparationId, reason: result.reason });
      emitTelemetry(this.telemetry, TelemetryEvent.FALLBACK_USED, {
        taskType: 'SPECULATIVE_CONTEXT_WARM',
        preparationId: job.preparationId,
        reason: result.reason,
        fallback: 'NORMAL_FOREGROUND_RETRIEVAL',
      });
      this.#finish(job, result);
    }
  }

  #park(job) {
    if (!this.#activeJobs.has(job)) return;
    this.#activeJobs.delete(job);
    job.status = 'PARKED';
    job.yielded = true;
    this.#metrics.preparationsYielded += 1;
    this.#queue.unshift(job);
    this.#diag('PREPARATION_YIELDED', {
      preparationId: job.preparationId,
      nextIntentOffset: job.checkpoint.nextIntentOffset,
    });
    emitTelemetry(this.telemetry, TelemetryEvent.TASK_YIELDING, {
      taskType: 'SPECULATIVE_CONTEXT_WARM',
      preparationId: job.preparationId,
      nextIntentOffset: job.checkpoint.nextIntentOffset,
      candidateRefCount: job.checkpoint.candidateRefs.length,
    });
  }

  #finishCancelled(job) {
    if (FINAL_STATES.has(job.status)) return;
    this.#metrics.preparationsCancelled += 1;
    job.status = 'CANCELLED';
    const result = frozenResult('CANCELLED', {
      preparationId: job.preparationId,
      reason: job.cancelReason ?? 'SUPERSEDED',
      packet: null,
      foregroundFallback: 'NORMAL_FOREGROUND_RETRIEVAL',
    });
    emitTelemetry(this.telemetry, TelemetryEvent.TASK_CANCELLED, {
      taskType: 'SPECULATIVE_CONTEXT_WARM',
      preparationId: job.preparationId,
      reason: result.reason,
    });
    this.#finish(job, result);
  }

  #finish(job, result) {
    this.#activeJobs.delete(job);
    this.#queue = this.#queue.filter((entry) => entry !== job);
    this.#jobsByKey.delete(job.key);
    try { job.resolve(result); } catch {}
    this.#drain();
  }

  #findPacketByIdentity(identity) {
    if (typeof this.cache.peek !== 'function') return null;
    return this.cache.peek(identity);
  }

  #rememberConsumption(record) {
    this.#consumptions.set(record.consumptionId, record);
    while (this.#consumptions.size > this.limits.maxDiagnostics) this.#consumptions.delete(this.#consumptions.keys().next().value);
  }

  #diag(type, payload = {}) {
    const entry = {
      type,
      at: this.clock(),
      ...boundedDiagnosticPayload(payload),
    };
    this.#diagnostics.push(entry);
    if (this.#diagnostics.length > this.limits.maxDiagnostics) {
      this.#diagnostics.splice(0, this.#diagnostics.length - this.limits.maxDiagnostics);
    }
  }
}

export function createNativeReferenceWarmAdapters() {
  return Object.freeze({
    providerMode: 'NATIVE_REFERENCE_ONLY',
    async retrieve({ intentSlice, recommendation }) {
      const refs = boundedUniqueStrings(intentSlice.map((intent) => intent.ref), 64);
      return {
        status: 'REFERENCE_ONLY',
        candidateRefs: refs,
        evidenceRefs: recommendation.evidenceRefs,
        receipt: {
          status: 'REFERENCE_ONLY',
          semanticRetrievalExecuted: false,
          candidateRefCount: refs.length,
          evidenceRefCount: recommendation.evidenceRefs.length,
          authority: 'NONE',
        },
      };
    },
    async evaluateQuality(referenceBundle) {
      return {
        status: 'REFERENCE_ONLY',
        quality: referenceBundle.candidateRefs.length ? 'REFERENCE_ONLY' : 'EMPTY',
        candidateRefCount: referenceBundle.candidateRefs.length,
        evidenceRefCount: referenceBundle.evidenceRefs.length,
        authority: 'NONE',
      };
    },
  });
}

export function normalizeWarmSceneRequest(input = {}, limits = DEFAULT_WARM_COORDINATOR_LIMITS) {
  return normalizePreparationRequest(input, normalizeLimits(limits));
}

function normalizePreparationRequest(input, limits) {
  if (!input || typeof input !== 'object') throw new TypeError('warm preparation request is required');
  if (!input.recommendation) throw new TypeError('PrefetchRecommendation is required');
  const rawRecommendation = input.recommendation;
  const recommendation = normalizePrefetchRecommendation(rawRecommendation);
  if (!ACTIVE_RECOMMENDATION_STATUS.has(recommendation.status)) throw new TypeError('PrefetchRecommendation must be ACTIVE');
  if (!recommendation.evidenceRefs.length) throw new TypeError('PrefetchRecommendation must be evidence-backed');
  if (recommendation.expiryRevision < recommendation.sceneRevision) throw new TypeError('PrefetchRecommendation is already expired');

  const identity = createWarmIdentity(input.identity);
  if (recommendation.sceneRevision !== identity.sceneRevision) throw new TypeError('PrefetchRecommendation scene revision does not match warm identity');
  if (!identity.sourceRevisionSet.length) throw new TypeError('warm identity requires an explicit source revision set');
  if (!identity.retrievalPolicyRevision) throw new TypeError('warm identity requires retrieval policy revision');

  const sourceRevisionSet = boundedUniqueStrings(
    rawRecommendation.sourceRevisionSet ?? rawRecommendation.sourceRevisionRefs ?? [], limits.maxEvidenceRefs,
  );
  if (!sourceRevisionSet.length) throw new TypeError('PrefetchRecommendation requires source revision refs');
  const currentSources = new Set(identity.sourceRevisionSet);
  if (sourceRevisionSet.some((ref) => !currentSources.has(ref))) {
    throw new TypeError('PrefetchRecommendation source revision is not current');
  }

  const intents = createBoundedIntents(recommendation, limits.maxIntents);
  if (!intents.length) throw new TypeError('PrefetchRecommendation contains no bounded retrieval intents');

  return deepFreeze({
    recommendation,
    identity,
    sourceRevisionSet,
    intents,
    turnSequence: nonNegativeInteger(input.turnSequence ?? 0, 'turnSequence'),
    context: safeClone(input.context ?? {}),
  });
}

function createBoundedIntents(recommendation, maxIntents) {
  const rows = [];
  for (const [kind, values] of [
    ['ENTITY', recommendation.entityRefs],
    ['LOCATION', recommendation.locationRefs],
    ['THREAD', recommendation.threadRefs],
    ['SCENE', recommendation.sceneRefs],
  ]) {
    for (const ref of values) rows.push({ kind, ref });
  }
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = row.kind + ':' + row.ref;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(Object.freeze(row));
    if (out.length >= maxIntents) break;
  }
  return Object.freeze(out);
}

function preparationKey(request) {
  return sha256Hex(JSON.stringify({
    identity: request.identity,
    sceneId: request.recommendation.sceneId,
    entityRefs: request.recommendation.entityRefs,
    locationRefs: request.recommendation.locationRefs,
    threadRefs: request.recommendation.threadRefs,
    sceneRefs: request.recommendation.sceneRefs,
  }));
}

function extractRetrievalReferences(value, limits) {
  const candidateRefs = refs(value?.candidateRefs ?? value?.refs ?? value?.artifactRefs ?? []);
  const evidenceRefs = refs(value?.evidenceRefs ?? []);
  return {
    candidateRefs: boundedUniqueStrings(candidateRefs, limits.maxCandidateRefs),
    evidenceRefs: boundedUniqueStrings(evidenceRefs, limits.maxEvidenceRefs),
  };
}

function refs(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    if (typeof value === 'string') return value;
    if (value?.kind === 'ArtifactReference' && typeof value.artifactId === 'string') {
      return 'artifact:' + value.artifactType + ':' + value.artifactId + '@' + value.revision;
    }
    return value?.ref ?? value?.artifactId ?? value?.id ?? null;
  }).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
}

function boundedReceipt(value, stage, limits) {
  if (value == null) return null;
  const raw = safeClone(value);
  const bytes = byteLength(raw);
  if (bytes <= limits.maxReceiptBytes) {
    return deepFreeze({
      ...((raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { value: raw }),
      stage,
      receiptBytes: bytes,
      authority: 'NONE',
    });
  }
  const summary = {
    kind: 'BoundedWarmStageReceipt',
    stage,
    status: raw?.status ?? null,
    classification: raw?.classification ?? null,
    quality: raw?.quality ?? null,
    checked: raw?.checked ?? null,
    ranked: raw?.ranked ?? null,
    reason: typeof raw?.reason === 'string' ? raw.reason.slice(0, 512) : null,
    conflictState: raw?.conflictState ?? null,
    unresolved: raw?.unresolved ?? null,
    sourceBytes: bytes,
    sourceHash: sha256Hex(JSON.stringify(raw)),
    clipped: true,
    authority: 'NONE',
  };
  return deepFreeze(summary);
}

function normalizeCompiledResult(value, limits, identity = null) {
  if (value == null) return null;
  const candidate = value?.compiledRef ?? value?.artifactRef ?? value?.reference ?? value;
  if (candidate?.kind === 'ArtifactReference' && typeof candidate.artifactId === 'string') {
    const cloned = safeClone(candidate);
    if (identity && !artifactReferenceMatchesIdentity(cloned, identity)) {
      return deepFreeze({
        kind: 'WarmCompiledReceipt',
        contentHash: sha256Hex(JSON.stringify(cloned)),
        sourceBytes: byteLength(cloned),
        reusable: false,
        reason: 'COMPILED_REFERENCE_FENCE_MISMATCH',
        authority: 'NONE',
      });
    }
    const bytes = byteLength(cloned);
    if (bytes > limits.maxReceiptBytes) throw new RangeError('compiled ArtifactReference exceeds receipt budget');
    return deepFreeze({
      kind: 'WarmCompiledReference',
      reference: cloned,
      reusable: true,
      receiptBytes: bytes,
      authority: 'NONE',
    });
  }
  const raw = safeClone(value);
  const bytes = byteLength(raw);
  return deepFreeze({
    kind: 'WarmCompiledReceipt',
    contentHash: sha256Hex(JSON.stringify(raw)),
    sourceBytes: bytes,
    reusable: false,
    reason: 'COMPILED_OUTPUT_NOT_REFERENCE_BACKED',
    authority: 'NONE',
  });
}

function artifactReferenceMatchesIdentity(reference, identity) {
  const refChatId=reference.chatId??reference.chatNamespace??reference.conversationId??null;
  if (refChatId != null && String(refChatId) !== String(identity.chatId??'')) return false;
  if (reference.sceneRevision != null && Number(reference.sceneRevision) !== Number(identity.sceneRevision)) return false;
  if (reference.worldRevision != null && Number(reference.worldRevision) !== Number(identity.worldRevision)) return false;
  if (Array.isArray(reference.sourceRevisionSet) && reference.sourceRevisionSet.length) {
    const have = new Set(identity.sourceRevisionSet);
    if (reference.sourceRevisionSet.some((item) => !have.has(item))) return false;
  }
  return true;
}

function normalizeReusableCompiled(value) {
  if (!value || value.kind !== 'WarmCompiledReference' || value.reusable !== true) return null;
  return { reusable: true, reference: safeClone(value.reference) };
}

function assertPacketBounds(packet, limits) {
  const bytes = byteLength(packet);
  const tokens = Math.ceil(bytes / 4);
  if (bytes > limits.maxPacketBytes) throw new RangeError('WarmPacket byte budget exceeded');
  if (tokens > limits.maxEstimatedTokens) throw new RangeError('WarmPacket estimated token budget exceeded');
}

function samePreparationFences(a, b) {
  return a.chatId === b.chatId
    && a.sceneRevision === b.sceneRevision
    && a.worldRevision === b.worldRevision
    && a.characterStateRevision === b.characterStateRevision
    && a.intentFingerprint === b.intentFingerprint
    && a.retrievalPolicyRevision === b.retrievalPolicyRevision
    && sameSet(a.sourceRevisionSet, b.sourceRevisionSet);
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((value) => set.has(value));
}

function mergeBounded(a, b, max, label) {
  const out = boundedUniqueStrings([...(a ?? []), ...(b ?? [])], max);
  if (out.length > max) throw new RangeError(label + ' budget exceeded');
  return out;
}

function boundedUniqueStrings(values, max) {
  if (!Array.isArray(values)) throw new TypeError('expected an array of references');
  const out = [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))].sort();
  if (out.length > max) throw new RangeError('reference budget exceeded');
  return out;
}

function normalizeLimits(overrides = {}) {
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_WARM_COORDINATOR_LIMITS)) {
    out[key] = positiveInteger(overrides[key] ?? fallback, key);
  }
  if (out.retrievalBatchSize > out.maxIntents) out.retrievalBatchSize = out.maxIntents;
  return deepFreeze(out);
}

function boundedDiagnosticPayload(value) {
  const safe = {};
  let count = 0;
  for (const [key, item] of Object.entries(value ?? {})) {
    if (count >= 24) break;
    if (['payload', 'prompt', 'rawResponse', 'candidateBodies', 'sourceText'].includes(key)) continue;
    if (typeof item === 'string') safe[key] = item.slice(0, 512);
    else if (typeof item === 'number' || typeof item === 'boolean' || item == null) safe[key] = item;
    count += 1;
  }
  return safe;
}

function frozenResult(status, rest = {}) {
  return deepFreeze({ status, ...rest, authority: 'NONE' });
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(name + ' must be a positive integer');
  return number;
}

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new TypeError(name + ' must be a non-negative integer');
  return number;
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' must be a non-empty string');
  return value.trim();
}

function safeClone(value) {
  return value == null ? null : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
