import { FailureCode } from './constants.js';

export const StreamingTruthMode = Object.freeze({ OBSERVE: 'OBSERVE', VERIFIED_CHUNKS: 'VERIFIED_CHUNKS', HARD_INTERCEPT: 'HARD_INTERCEPT' });
export const TruthViolationClassification = Object.freeze({ SUPPORTED: 'SUPPORTED', VIOLATION: 'VIOLATION', AMBIGUOUS: 'AMBIGUOUS', UNCERTAIN: 'UNCERTAIN', UNRESOLVED: 'UNRESOLVED', CHECK_FAILED: 'CHECK_FAILED' });

export class StreamingTruthObserver {
  constructor({
    deterministicCheck,
    semanticVerifier = null,
    claimExtractor = null,
    mode = StreamingTruthMode.OBSERVE,
    hardInterceptEnabled = false,
    minClauseChars = 8,
    maxBufferChars = 4096,
    interceptConfidence = 0.95,
    interceptSeverity = 'HIGH',
  } = {}) {
    if (typeof deterministicCheck !== 'function') throw new TypeError('deterministicCheck is required');
    if (!Object.values(StreamingTruthMode).includes(mode)) throw new TypeError(`unsupported Streaming Truth mode: ${mode}`);
    this.deterministicCheck = deterministicCheck;
    this.semanticVerifier = semanticVerifier;
    this.claimExtractor = claimExtractor;
    this.mode = mode;
    this.hardInterceptEnabled = Boolean(hardInterceptEnabled);
    this.minClauseChars = Math.max(1, Number(minClauseChars) || 8);
    this.maxBufferChars = Math.max(this.minClauseChars, Number(maxBufferChars) || 4096);
    this.interceptConfidence = clamp(interceptConfidence);
    this.interceptSeverity = interceptSeverity;
    this.buffer = '';
    this.metrics = { clauses: 0, claims: 0, violations: 0, ambiguous: 0, failures: 0, intercepted: 0 };
  }

  async push(text, context = {}) {
    const incoming = String(text ?? '');
    this.buffer = (this.buffer + incoming).slice(-this.maxBufferChars);
    const complete = this.#takeCompleteClauses();
    const observations = [];
    const releasable = [];
    let intercepted = false;

    for (const clause of complete) {
      const checked = await this.#checkClause(clause, context);
      observations.push(...checked.observations);
      if (this.#effectiveMode() === StreamingTruthMode.HARD_INTERCEPT && checked.interceptEligible) {
        intercepted = true;
        this.metrics.intercepted += 1;
      } else {
        releasable.push(clause);
      }
    }

    const effectiveMode = this.#effectiveMode();
    const releasedText = effectiveMode === StreamingTruthMode.OBSERVE ? incoming : joinClauses(releasable);
    return Object.freeze({
      mode: effectiveMode,
      configuredMode: this.mode,
      releasedText,
      intercepted,
      observations: Object.freeze(observations),
      bufferedChars: this.buffer.length,
      verificationFailedOpen: observations.some((item) => item.classification === TruthViolationClassification.CHECK_FAILED),
    });
  }

  async flush(context = {}) {
    const pending = this.buffer.trim();
    this.buffer = '';
    if (pending.length < this.minClauseChars) return Object.freeze({ mode: this.#effectiveMode(), configuredMode: this.mode, releasedText: '', intercepted: false, observations: Object.freeze([]), bufferedChars: 0, verificationFailedOpen: false });
    const checked = await this.#checkClause(pending, context);
    const hard = this.#effectiveMode() === StreamingTruthMode.HARD_INTERCEPT && checked.interceptEligible;
    if (hard) this.metrics.intercepted += 1;
    return Object.freeze({
      mode: this.#effectiveMode(), configuredMode: this.mode,
      releasedText: this.#effectiveMode() === StreamingTruthMode.OBSERVE ? '' : hard ? '' : pending,
      intercepted: hard, observations: Object.freeze(checked.observations), bufferedChars: 0,
      verificationFailedOpen: checked.observations.some((item) => item.classification === TruthViolationClassification.CHECK_FAILED),
    });
  }

  snapshotMetrics() { return Object.freeze({ ...this.metrics, mode: this.#effectiveMode(), configuredMode: this.mode }); }

  #takeCompleteClauses() {
    const parts = this.buffer.split(/(?<=[.!?])\s+/);
    const complete = [];
    if (/[.!?]\s*$/.test(this.buffer)) { complete.push(...parts); this.buffer = ''; }
    else { this.buffer = parts.pop() ?? ''; complete.push(...parts); }
    return complete.map((value) => value.trim()).filter((value) => value.length >= this.minClauseChars);
  }

  async #checkClause(clause, context) {
    this.metrics.clauses += 1;
    let claims;
    try {
      claims = typeof this.claimExtractor === 'function' ? await this.claimExtractor(clause, context) : [{ claim: clause, claimSpan: { start: 0, end: clause.length } }];
      if (!Array.isArray(claims)) claims = [claims];
    } catch (error) {
      claims = [{ claim: clause, claimSpan: { start: 0, end: clause.length }, extractionError: String(error?.message ?? error) }];
    }
    const observations = [];
    let interceptEligible = false;
    for (const candidate of claims) {
      const claim = typeof candidate === 'string' ? candidate : candidate?.claim;
      const claimSpan = typeof candidate === 'string' ? { start: 0, end: clause.length } : candidate?.claimSpan;
      if (typeof claim !== 'string' || !claim.trim()) continue;
      this.metrics.claims += 1;
      let result;
      try {
        result = await this.deterministicCheck(claim.trim(), context);
        if (result?.classification === TruthViolationClassification.AMBIGUOUS && typeof this.semanticVerifier === 'function') {
          result = await this.semanticVerifier(claim.trim(), context, result);
        }
      } catch (error) {
        this.metrics.failures += 1;
        observations.push(observation({ claim: claim.trim(), claimSpan, context, result: { classification: TruthViolationClassification.CHECK_FAILED, confidence: 0, reason: String(error?.message ?? error), severity: 'NONE' }, mode: this.#effectiveMode(), intercepted: false }));
        continue;
      }
      const normalized = validateTruthMonitorReceipt({ ...result, claimSpan: result?.claimSpan ?? claimSpan }, { claim: claim.trim(), context, allowMissingClassification: true });
      if (normalized.classification === TruthViolationClassification.VIOLATION) this.metrics.violations += 1;
      if (normalized.classification === TruthViolationClassification.AMBIGUOUS) this.metrics.ambiguous += 1;
      const eligible = isHardInterceptEligible(normalized, { confidence: this.interceptConfidence, severity: this.interceptSeverity });
      interceptEligible ||= eligible;
      observations.push(observation({ claim: claim.trim(), claimSpan: normalized.claimSpan, context, result: normalized, mode: this.#effectiveMode(), intercepted: this.#effectiveMode() === StreamingTruthMode.HARD_INTERCEPT && eligible }));
    }
    return { observations, interceptEligible };
  }

  #effectiveMode() { return this.mode === StreamingTruthMode.HARD_INTERCEPT && !this.hardInterceptEnabled ? StreamingTruthMode.OBSERVE : this.mode; }
}

export function validateTruthMonitorReceipt(value = {}, { claim = null, context = {}, allowMissingClassification = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(FailureCode.SCHEMA_INVALID, 'Truth Monitor receipt must be an object');
  if (!value.claimSpan || !Number.isFinite(Number(value.claimSpan.start)) || !Number.isFinite(Number(value.claimSpan.end)) || Number(value.claimSpan.end) < Number(value.claimSpan.start)) fail(FailureCode.SCHEMA_INVALID, 'Truth Monitor output requires claimSpan');
  const classification = value.classification ?? (allowMissingClassification ? TruthViolationClassification.UNRESOLVED : null);
  if (!Object.values(TruthViolationClassification).includes(classification)) fail(FailureCode.SCHEMA_INVALID, `Unknown Truth Monitor classification: ${classification}`);
  const confidence = clamp(value.confidence ?? 0);
  const temporalContext = value.temporalContext ?? 'CURRENT';
  const severity = value.severity ?? 'LOW';
  return Object.freeze({
    claim,
    claimSpan: Object.freeze({ start: Number(value.claimSpan.start), end: Number(value.claimSpan.end) }),
    classification,
    confidence,
    severity,
    temporalContext,
    deterministic: value.deterministic !== false,
    currentCanonViolation: Boolean(value.currentCanonViolation ?? classification === TruthViolationClassification.VIOLATION),
    creativeAmbiguity: Boolean(value.creativeAmbiguity),
    reason: value.reason ?? null,
    worldRevision: context.worldRevision ?? value.worldRevision ?? null,
    sceneRevision: context.sceneRevision ?? value.sceneRevision ?? null,
    authorityGranted: false,
  });
}

export function isHardInterceptEligible(receipt, { confidence = 0.95, severity = 'HIGH' } = {}) {
  return receipt.classification === TruthViolationClassification.VIOLATION
    && receipt.deterministic === true
    && receipt.currentCanonViolation === true
    && receipt.temporalContext === 'CURRENT'
    && receipt.creativeAmbiguity === false
    && receipt.confidence >= Number(confidence)
    && severityRank(receipt.severity) >= severityRank(severity);
}

function observation({ claim, claimSpan, context, result, mode, intercepted }) {
  return Object.freeze({
    kind: 'StreamingTruthObservation', mode, claim, claimSpan,
    classification: result?.classification ?? TruthViolationClassification.UNRESOLVED,
    confidence: Number(result?.confidence ?? 0), severity: result?.severity ?? 'LOW',
    temporalContext: result?.temporalContext ?? 'CURRENT', currentCanonViolation: Boolean(result?.currentCanonViolation),
    creativeAmbiguity: Boolean(result?.creativeAmbiguity), deterministic: result?.deterministic !== false,
    reason: result?.reason ?? null, worldRevision: context.worldRevision ?? result?.worldRevision ?? null,
    sceneRevision: context.sceneRevision ?? result?.sceneRevision ?? null, intercepted: Boolean(intercepted), authorityGranted: false,
  });
}
function severityRank(value) { return ({ NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 })[value] ?? 0; }
function joinClauses(values) { return values.join(' '); }
function clamp(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
