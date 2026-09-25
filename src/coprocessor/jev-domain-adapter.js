import { ResultClass } from './constants.js';
import { deepFreeze } from './contracts.js';
import { utf8ByteLength } from './browser-compat.js';
import {
  JevDecisionShape,
  JevOutcome,
  JevServiceStatus,
  createJevDecisionRequest,
  evaluateJevFreshness,
  jevRequestFingerprint,
} from './jev-contracts.js';
import { createJevCognitiveTask } from './jev-decision-core.js';

export const JevDomain = Object.freeze({
  LORE: 'LORE',
  SCENE: 'SCENE',
  RETRIEVAL_TRUTH: 'RETRIEVAL_TRUTH',
  MEMORY: 'MEMORY',
  TEMPORAL: 'TEMPORAL',
});

export const JevAdapterPrecheckStatus = Object.freeze({
  DETERMINISTIC: 'DETERMINISTIC',
  JEV_REQUIRED: 'JEV_REQUIRED',
  UNRESOLVED_WITHOUT_JEV: 'UNRESOLVED_WITHOUT_JEV',
  INVALID: 'INVALID',
  STALE: 'STALE',
});

export const JEV_ADAPTER_LIMITS = Object.freeze({
  maxOptions: 16,
  maxEvidenceRefs: 32,
  maxCompactEvidenceBytes: 24 * 1024,
  maxProvenanceRefs: 64,
  maxAdapterMetadataBytes: 4 * 1024,
  maxExplanationChars: 400,
  maxOwnerProposalBytes: 32 * 1024,
});

export class JevDomainAdapterRegistry {
  #byId = new Map();
  #byDomainKind = new Map();

  register(adapter) {
    validateAdapter(adapter);
    if (this.#byId.has(adapter.adapterId)) throw new TypeError(`duplicate Jev adapterId: ${adapter.adapterId}`);
    for (const kind of adapter.supportedDecisionKinds) {
      const key = domainKindKey(adapter.domainId, kind);
      if (this.#byDomainKind.has(key)) throw new TypeError(`duplicate Jev adapter domain/kind: ${key}`);
    }
    this.#byId.set(adapter.adapterId, adapter);
    for (const kind of adapter.supportedDecisionKinds) this.#byDomainKind.set(domainKindKey(adapter.domainId, kind), adapter);
    return this;
  }

  get(adapterId) { return this.#byId.get(requiredString(adapterId, 'adapterId')) ?? null; }

  resolve(domainId, decisionKind) {
    const key = domainKindKey(requiredString(domainId, 'domainId'), requiredString(decisionKind, 'decisionKind'));
    const adapter = this.#byDomainKind.get(key);
    if (!adapter) throw new TypeError(`unsupported Jev adapter domain/kind: ${key}`);
    return adapter;
  }

  list() {
    return deepFreeze([...this.#byId.values()]
      .map((adapter) => ({ adapterId: adapter.adapterId, domainId: adapter.domainId, adapterVersion: adapter.adapterVersion, supportedDecisionKinds: [...adapter.supportedDecisionKinds] }))
      .sort((a, b) => a.adapterId.localeCompare(b.adapterId)));
  }

  get size() { return this.#byId.size; }
}

export class JevDomainAdapterService {
  #proposalReplay = new Map();
  #metrics = new Map();

  constructor({ registry, core, replayLimit = 128 } = {}) {
    if (!(registry instanceof JevDomainAdapterRegistry)) throw new TypeError('JevDomainAdapterService requires JevDomainAdapterRegistry');
    if (!core || typeof core.decide !== 'function') throw new TypeError('JevDomainAdapterService requires JevDecisionCore');
    this.registry = registry;
    this.core = core;
    this.replayLimit = positiveReplayLimit(replayLimit);
  }

  async adjudicate(input, { currentRevisionState = null, sealed = false, signal = null } = {}) {
    const adapter = this.registry.resolve(input?.domain, input?.decisionKind);
    const metric = this.#metric(adapter.domainId, input.decisionKind);
    metric.decisions += 1;

    let precheck;
    try {
      if (!adapter.canAdapt(input)) throw new TypeError(`${adapter.adapterId} cannot adapt supplied input`);
      precheck = adapter.deterministicPrecheck(input);
      validatePrecheck(precheck);
    } catch (error) {
      metric.adapterValidationFailures += 1;
      const proposal = adapter.fallbackProposal(input, { reason: 'ADAPTER_VALIDATION_FAILED', error });
      return this.#boundedProposal(proposal);
    }

    let request;
    try {
      request = adapter.buildRequest(input, precheck);
      if (request?.kind !== 'JevDecisionRequest') request = createJevDecisionRequest(request);
      assertAdapterRequestBounds(request);
    } catch (error) {
      metric.adapterValidationFailures += 1;
      const proposal = adapter.fallbackProposal(input, { reason: 'REQUEST_BUILD_FAILED', error });
      return this.#boundedProposal(proposal);
    }

    const fingerprint = jevRequestFingerprint(request);
    const replayKey = `${adapter.adapterId}|${fingerprint}`;
    if (this.#proposalReplay.has(replayKey)) {
      const currentReplay = await resolveCurrentState(currentRevisionState, request);
      const freshnessReplay = evaluateJevFreshness(request, currentReplay);
      const sealedReplay = Boolean(typeof sealed === 'function' ? await sealed(request) : sealed);
      if (freshnessReplay.freshness === 'FRESH' && !sealedReplay) {
        const replay = this.#proposalReplay.get(replayKey);
        this.#proposalReplay.delete(replayKey);
        this.#proposalReplay.set(replayKey, replay);
        metric.replays += 1;
        return replay;
      }
    }

    const deterministicAnswer = deterministicAnswerFor(precheck);
    const beforeCore = this.core.metricsSnapshot?.() ?? null;
    const receipt = await this.core.decide(request, { currentRevisionState, sealed, signal, deterministicAnswer });
    const afterCore = this.core.metricsSnapshot?.() ?? null;
    const current = await resolveCurrentState(currentRevisionState, request);

    let proposal;
    try {
      adapter.validateReceipt(receipt, { input, request, currentRevisionState: current, precheck });
      proposal = adapter.interpretReceipt(receipt, { input, request, currentRevisionState: current, precheck });
    } catch (error) {
      metric.adapterValidationFailures += 1;
      proposal = adapter.fallbackProposal(input, { reason: 'RECEIPT_VALIDATION_FAILED', error, request, receipt });
    }

    const providerAttempts = Math.max(0, Number(afterCore?.providerCalls ?? 0) - Number(beforeCore?.providerCalls ?? 0));
    const invoked = providerAttempts > 0;
    metric.providerAttempts += providerAttempts;
    if (invoked && receipt.providerProvenance?.providerId) metric.physicalSuccesses += 1;
    if (invoked) metric.jevInvoked += 1;
    else if (receipt.serviceStatus === JevServiceStatus.JEV_SKIPPED) metric.deterministicSkips += 1;
    if (receipt.abstained) metric.abstentions += 1;
    if (receipt.outcome === JevOutcome.UNRESOLVED) metric.unresolved += 1;
    if ([JevOutcome.ESCALATE_OWNER, JevOutcome.REQUEST_OPERATOR].includes(receipt.outcome)) metric.escalations += 1;
    if (receipt.outcome === JevOutcome.STALE || proposal.staleState === 'STALE') metric.staleRejections += 1;
    metric.totalLatencyMs += Number(receipt.latencyMetadata?.totalLatencyMs ?? 0);
    if (receipt.providerProvenance?.providerId) metric.providerIds.add(receipt.providerProvenance.providerId);

    proposal = this.#boundedProposal(proposal);
    if (proposal.staleState !== 'STALE' && !proposal.details?.late) this.#rememberProposal(replayKey, proposal);
    return proposal;
  }

  toRuntimeTask(input, precheck = null) {
    const adapter = this.registry.resolve(input?.domain, input?.decisionKind);
    const checked = precheck ?? adapter.deterministicPrecheck(input);
    const request = adapter.buildRequest(input, checked);
    const task = createJevCognitiveTask(request);
    return deepFreeze({
      ...task,
      taskType: 'JEV_DECISION',
      requiredCapabilities: deepFreeze(['SEMANTIC_JUDGMENT']),
      resultClass: request.resultClass ?? ResultClass.OPPORTUNISTIC,
      metadata: deepFreeze({ ...task.metadata, domain: adapter.domainId, decisionKind: input.decisionKind, adapterId: adapter.adapterId, authorityGranted: false }),
    });
  }

  diagnosticProjection(proposal, { advanced = false } = {}) {
    if (!proposal || typeof proposal !== 'object') throw new TypeError('owner proposal is required');
    const projection = {
      kind: 'JevAdapterDiagnosticProjection',
      domain: proposal.domain,
      decisionKind: proposal.decisionKind,
      path: proposal.path,
      status: proposal.status,
      outcome: proposal.proposedOutcome,
      abstained: proposal.abstained,
      unresolved: proposal.unresolved,
      escalation: proposal.escalation,
      owner: proposal.owner,
      evidenceCount: proposal.evidenceCount,
      optionCount: proposal.optionCount,
      staleState: proposal.staleState,
      jevReceiptRef: proposal.jevReceiptRef,
      explanation: proposal.explanation,
    };
    if (advanced) projection.advanced = { providerId: proposal.providerProvenance?.providerId ?? null, latencyMs: proposal.latencyMs ?? 0 };
    return deepFreeze(projection);
  }

  metricsSnapshot() {
    const rows = [...this.#metrics.values()].map((m) => deepFreeze({
      domain: m.domain,
      decisionKind: m.decisionKind,
      decisions: m.decisions,
      deterministicSkips: m.deterministicSkips,
      jevInvoked: m.jevInvoked,
      abstentions: m.abstentions,
      unresolved: m.unresolved,
      escalations: m.escalations,
      staleRejections: m.staleRejections,
      adapterValidationFailures: m.adapterValidationFailures,
      replays: m.replays,
      providerAttempts: m.providerAttempts,
      physicalSuccesses: m.physicalSuccesses,
      totalLatencyMs: m.totalLatencyMs,
      providerIds: [...m.providerIds].sort(),
    }));
    return deepFreeze(rows.sort((a, b) => `${a.domain}:${a.decisionKind}`.localeCompare(`${b.domain}:${b.decisionKind}`)));
  }

  #metric(domain, decisionKind) {
    const key = domainKindKey(domain, decisionKind);
    if (!this.#metrics.has(key)) this.#metrics.set(key, { domain, decisionKind, decisions: 0, deterministicSkips: 0, jevInvoked: 0, abstentions: 0, unresolved: 0, escalations: 0, staleRejections: 0, adapterValidationFailures: 0, replays: 0, providerAttempts: 0, physicalSuccesses: 0, totalLatencyMs: 0, providerIds: new Set() });
    return this.#metrics.get(key);
  }

  #rememberProposal(key, proposal) {
    this.#proposalReplay.delete(key);
    this.#proposalReplay.set(key, proposal);
    while (this.#proposalReplay.size > this.replayLimit) this.#proposalReplay.delete(this.#proposalReplay.keys().next().value);
  }

  #boundedProposal(proposal) {
    if (!proposal || typeof proposal !== 'object') throw new TypeError('adapter must return an owner proposal object');
    if (proposal.mutationAuthority !== false || proposal.requiresOwnerPolicy !== true) throw new TypeError('owner proposal authority boundary violated');
    const bytes = utf8ByteLength(JSON.stringify(proposal));
    if (bytes > JEV_ADAPTER_LIMITS.maxOwnerProposalBytes) throw new TypeError(`owner proposal exceeds ${JEV_ADAPTER_LIMITS.maxOwnerProposalBytes} bytes`);
    return deepFreeze(proposal);
  }
}

export function createOwnerProposal({
  proposalType,
  domain,
  decisionKind,
  owner,
  request = null,
  receipt = null,
  precheck = null,
  proposedOutcome = 'UNRESOLVED',
  details = {},
  explanation = '',
  staleState = null,
  fallbackReason = null,
} = {}) {
  const requestFingerprint = request ? jevRequestFingerprint(request) : null;
  const path = receipt?.serviceStatus === JevServiceStatus.JEV_SKIPPED || precheck?.status === JevAdapterPrecheckStatus.DETERMINISTIC ? 'DETERMINISTIC' : receipt ? 'JEV' : 'DEGRADED';
  const boundedExplanation = String(explanation ?? '').slice(0, JEV_ADAPTER_LIMITS.maxExplanationChars);
  const proposal = {
    kind: requiredString(proposalType, 'proposalType'),
    proposalType,
    domain: requiredString(domain, 'domain'),
    decisionKind: requiredString(decisionKind, 'decisionKind'),
    proposedOutcome: requiredString(proposedOutcome, 'proposedOutcome'),
    jevReceiptRef: receipt ? `${receipt.decisionId}:${receipt.requestFingerprint}` : null,
    sourceRequestRef: requestFingerprint,
    owner: requiredString(owner, 'owner'),
    revisionFence: request ? {
      sourceRevisionSet: [...request.sourceRevisionSet],
      worldRevision: request.worldRevision,
      sceneRevision: request.sceneRevision,
      characterStateRevision: request.characterStateRevision,
      domainRevisions: structuredClone(request.domainRevisions),
      freshnessToken: request.freshnessToken,
    } : null,
    staleState: staleState ?? (receipt?.outcome === JevOutcome.STALE ? 'STALE' : 'FRESH'),
    abstained: Boolean(receipt?.abstained || receipt?.outcome === JevOutcome.ABSTAINED),
    unresolved: Boolean([JevOutcome.UNRESOLVED, JevOutcome.ABSTAINED, JevOutcome.STALE, JevOutcome.INVALID].includes(receipt?.outcome) || proposedOutcome === 'UNRESOLVED'),
    escalation: receipt?.escalationTarget ?? null,
    mutationAuthority: false,
    requiresOwnerPolicy: true,
    requiresOwnerSettlement: Boolean(receipt?.requiresOwnerSettlement),
    requiresOperatorReview: Boolean(receipt?.requiresOperator),
    admission: receipt ? {
      foregroundEligible: receipt.admission?.foregroundEligible !== false,
      late: Boolean(receipt.admission?.late),
      destination: receipt.admission?.destination ?? null,
    } : { foregroundEligible: true, late: false, destination: null },
    path,
    status: receipt?.serviceStatus ?? 'ADAPTER_DEGRADED',
    evidenceCount: request?.evidenceRefs?.length ?? 0,
    optionCount: request?.options?.length ?? 0,
    reasonCodes: [...(receipt?.reasonCodes ?? [])].slice(0, 16),
    providerProvenance: receipt?.providerProvenance?.providerId ? {
      providerProfileId: receipt.providerProvenance.providerProfileId ?? null,
      providerId: receipt.providerProvenance.providerId,
      resourceId: receipt.providerProvenance.resourceId ?? null,
      workerId: receipt.providerProvenance.workerId ?? null,
      modelId: receipt.providerProvenance.modelId ?? null,
      actualProvider: receipt.providerProvenance.actualProvider ?? null,
      measurementClass: receipt.providerProvenance.measurementClass ?? null,
      latencyClass: receipt.providerProvenance.latencyClass ?? null,
      costClass: receipt.providerProvenance.costClass ?? null,
      costStatus: receipt.providerProvenance.usageReceipt?.cost?.status ?? null,
    } : null,
    latencyMs: Number(receipt?.latencyMetadata?.totalLatencyMs ?? 0),
    explanation: boundedExplanation,
    fallbackReason,
    details: boundedObject(details, 'proposal.details', JEV_ADAPTER_LIMITS.maxAdapterMetadataBytes),
  };
  return deepFreeze(proposal);
}

export function validateReceiptAgainstRequest(receipt, { request, currentRevisionState = null } = {}) {
  if (receipt?.kind !== 'JevDecisionReceipt') throw new TypeError('JevDecisionReceipt required');
  if (request?.kind !== 'JevDecisionRequest') throw new TypeError('JevDecisionRequest required');
  if (receipt.decisionId !== request.decisionId) throw new TypeError('Jev receipt decisionId mismatch');
  if (receipt.requestFingerprint !== jevRequestFingerprint(request)) throw new TypeError('Jev receipt fingerprint mismatch');
  const freshness = evaluateJevFreshness(request, currentRevisionState ?? request);
  if (freshness.freshness !== 'FRESH' && receipt.outcome !== JevOutcome.STALE) throw new TypeError(`stale Jev receipt rejected: ${freshness.freshness}`);
  if (receipt.authorityGranted !== false || receipt.canonicalMutation !== false || receipt.settlementPerformed !== false) throw new TypeError('Jev receipt authority boundary violated');
  return true;
}

export function assertAdapterInputBounds({ options = [], evidence = [], provenanceRefs = [], metadata = {} } = {}) {
  if (!Array.isArray(options) || options.length < 1 || options.length > JEV_ADAPTER_LIMITS.maxOptions) throw new TypeError(`adapter options must contain 1-${JEV_ADAPTER_LIMITS.maxOptions} entries`);
  if (!Array.isArray(evidence) || evidence.length > JEV_ADAPTER_LIMITS.maxEvidenceRefs) throw new TypeError(`adapter evidence exceeds ${JEV_ADAPTER_LIMITS.maxEvidenceRefs}`);
  if (!Array.isArray(provenanceRefs) || provenanceRefs.length > JEV_ADAPTER_LIMITS.maxProvenanceRefs) throw new TypeError(`adapter provenance exceeds ${JEV_ADAPTER_LIMITS.maxProvenanceRefs}`);
  const evidenceBytes = utf8ByteLength(JSON.stringify(evidence));
  if (evidenceBytes > JEV_ADAPTER_LIMITS.maxCompactEvidenceBytes) throw new TypeError(`adapter compact evidence exceeds ${JEV_ADAPTER_LIMITS.maxCompactEvidenceBytes} bytes`);
  if (utf8ByteLength(JSON.stringify(metadata ?? {})) > JEV_ADAPTER_LIMITS.maxAdapterMetadataBytes) throw new TypeError(`adapter metadata exceeds ${JEV_ADAPTER_LIMITS.maxAdapterMetadataBytes} bytes`);
  return true;
}

function deterministicAnswerFor(precheck) {
  if (precheck.status === JevAdapterPrecheckStatus.DETERMINISTIC) return precheck.deterministicAnswer;
  if (precheck.status === JevAdapterPrecheckStatus.UNRESOLVED_WITHOUT_JEV) return {
    outcome: JevOutcome.UNRESOLVED,
    decisionCode: JevDecisionShape.UNRESOLVED,
    selectedOptionIds: [],
    rejectedOptionIds: precheck.rejectedOptionIds ?? [],
    evidenceUsed: precheck.evidenceUsed ?? [],
    confidence: 0,
    reasonCodes: precheck.reasonCodes ?? ['OWNER_POLICY_UNRESOLVED_WITHOUT_JEV'],
  };
  return null;
}

function assertAdapterRequestBounds(request) {
  assertAdapterInputBounds({ options: request.options, evidence: request.evidenceRefs, provenanceRefs: request.provenanceRefs, metadata: request.metadata });
  return true;
}

function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Jev domain adapter object required');
  requiredString(adapter.adapterId, 'adapter.adapterId');
  requiredString(adapter.domainId, 'adapter.domainId');
  requiredString(adapter.adapterVersion, 'adapter.adapterVersion');
  if (!Array.isArray(adapter.supportedDecisionKinds) || !adapter.supportedDecisionKinds.length) throw new TypeError('adapter.supportedDecisionKinds must be non-empty');
  for (const kind of adapter.supportedDecisionKinds) requiredString(kind, 'adapter decision kind');
  for (const method of ['canAdapt', 'deterministicPrecheck', 'buildRequest', 'validateReceipt', 'interpretReceipt', 'fallbackProposal']) {
    if (typeof adapter[method] !== 'function') throw new TypeError(`adapter.${method} must be a function`);
  }
}

function validatePrecheck(precheck) {
  if (!precheck || !Object.values(JevAdapterPrecheckStatus).includes(precheck.status)) throw new TypeError('adapter deterministicPrecheck returned invalid status');
  if (precheck.status === JevAdapterPrecheckStatus.DETERMINISTIC && !precheck.deterministicAnswer) throw new TypeError('DETERMINISTIC precheck requires deterministicAnswer');
}

async function resolveCurrentState(value, request) {
  if (typeof value === 'function') return await value(request);
  return value ?? {
    sourceRevisionSet: request.sourceRevisionSet,
    worldRevision: request.worldRevision,
    sceneRevision: request.sceneRevision,
    characterStateRevision: request.characterStateRevision,
    domainRevisions: request.domainRevisions,
    freshnessToken: request.freshnessToken,
  };
}

function domainKindKey(domain, kind) { return `${domain}:${kind}`; }
function requiredString(value, name) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`); return value.trim(); }
function boundedObject(value, name, maxBytes) { const clone = structuredClone(value ?? {}); if (utf8ByteLength(JSON.stringify(clone)) > maxBytes) throw new TypeError(`${name} exceeds ${maxBytes} bytes`); return clone; }
function positiveReplayLimit(value) { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new TypeError('replayLimit must be a positive integer'); return n; }