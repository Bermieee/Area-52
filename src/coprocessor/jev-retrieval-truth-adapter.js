import { ResultClass } from './constants.js';
import { deepFreeze } from './contracts.js';
import { JevDecisionShape, JevOutcome, createJevDecisionRequest } from './jev-contracts.js';
import {
  JevAdapterPrecheckStatus,
  JevDomain,
  assertAdapterInputBounds,
  createOwnerProposal,
  validateReceiptAgainstRequest,
} from './jev-domain-adapter.js';

export const RetrievalTruthJevDecisionKind = Object.freeze({
  CANDIDATE_INTERPRETATION: 'RETRIEVAL_CANDIDATE_INTERPRETATION',
  CORRECTIVE_RETRIEVAL: 'RETRIEVAL_CORRECTIVE_CHOICE',
  TRUTH_AMBIGUITY: 'TRUTH_SEMANTIC_AMBIGUITY',
});

export const CorrectiveRetrievalJevOutcome = Object.freeze({
  NO_CORRECTION: 'NO_CORRECTION',
  RETRY_SPARSE: 'RETRY_SPARSE',
  RETRY_DENSE: 'RETRY_DENSE',
  RETRY_GRAPH: 'RETRY_GRAPH',
  ABSTAIN: 'ABSTAIN',
});

export const TruthSemanticOutcome = Object.freeze({
  SUPPORT_A: 'SUPPORT_A',
  SUPPORT_B: 'SUPPORT_B',
  PRESERVE_UNRESOLVED: 'PRESERVE_UNRESOLVED',
  ABSTAIN: 'ABSTAIN',
  ESCALATE: 'ESCALATE',
});

const CORRECTIVE = new Set(Object.values(CorrectiveRetrievalJevOutcome));
const TRUTH = new Set(Object.values(TruthSemanticOutcome));

export function createRetrievalTruthJevAdapter() {
  return deepFreeze({
    adapterId: 'jev.adapter.retrieval-truth.v1',
    domainId: JevDomain.RETRIEVAL_TRUTH,
    adapterVersion: '1.0.0',
    supportedDecisionKinds: Object.values(RetrievalTruthJevDecisionKind),

    canAdapt(input) { return Boolean(input && input.domain === JevDomain.RETRIEVAL_TRUTH && Object.values(RetrievalTruthJevDecisionKind).includes(input.decisionKind)); },

    deterministicPrecheck(input) {
      const normalized = normalizeInput(input);
      const rejectedOptionIds = normalized.options.filter(ownerRejects).map((option) => option.optionId);
      const viable = normalized.options.filter((option) => !rejectedOptionIds.includes(option.optionId));

      if (normalized.decisionKind === RetrievalTruthJevDecisionKind.CORRECTIVE_RETRIEVAL && normalized.retrievalQuality === 'HIGH') {
        const noCorrection = viable.find((option) => option.optionId === CorrectiveRetrievalJevOutcome.NO_CORRECTION);
        if (noCorrection) return precheck(JevAdapterPrecheckStatus.DETERMINISTIC, { reasonCodes: ['HIGH_QUALITY_RETRIEVAL_NO_CORRECTION'], rejectedOptionIds, deterministicAnswer: answer(noCorrection, rejectedOptionIds) });
      }

      if (normalized.retrievalQuality === 'LOW') return precheck(JevAdapterPrecheckStatus.UNRESOLVED_WITHOUT_JEV, { reasonCodes: ['LOW_QUALITY_EVIDENCE_ABSTAIN'], rejectedOptionIds, evidenceUsed: [] });

      if (normalized.deterministicOutcome) {
        const option = viable.find((row) => row.optionId === normalized.deterministicOutcome);
        if (!option) throw new TypeError('Retrieval/Truth deterministicOutcome must name a viable supplied option');
        return precheck(JevAdapterPrecheckStatus.DETERMINISTIC, { reasonCodes: ['RETRIEVAL_TRUTH_OWNER_DETERMINISTIC'], rejectedOptionIds, deterministicAnswer: answer(option, rejectedOptionIds) });
      }

      if (viable.length === 1) return precheck(JevAdapterPrecheckStatus.DETERMINISTIC, { reasonCodes: ['ONLY_ONE_OWNER_VALID_RETRIEVAL_OPTION'], rejectedOptionIds, deterministicAnswer: answer(viable[0], rejectedOptionIds) });
      if (!viable.length) return precheck(JevAdapterPrecheckStatus.UNRESOLVED_WITHOUT_JEV, { reasonCodes: ['NO_VALID_RETRIEVAL_TRUTH_OPTION'], rejectedOptionIds });
      return precheck(JevAdapterPrecheckStatus.JEV_REQUIRED, { reasonCodes: ['RETRIEVAL_TRUTH_BOUNDED_AMBIGUITY'], rejectedOptionIds });
    },

    buildRequest(input, precheckReceipt) {
      const normalized = normalizeInput(input);
      const rejected = normalized.options.filter(ownerRejects);
      return createJevDecisionRequest({
        decisionId: normalized.decisionId,
        decisionType: normalized.decisionKind,
        decisionShape: JevDecisionShape.CHOOSE_ONE,
        turnId: normalized.turnId,
        taskId: normalized.taskId,
        correlationId: normalized.correlationId,
        causationId: normalized.causationId,
        options: normalized.options.map((option) => ({ optionId: option.optionId, label: option.label, evidenceRefs: option.evidenceRefs, provenanceRefs: option.provenanceRefs, requiresEvidence: option.evidenceRefs.length > 0, payload: option.payload })),
        evidenceRefs: normalized.evidence,
        provenanceRefs: normalized.provenanceRefs,
        constraints: rejected.map((option) => ({ constraintId: `retrieval-truth-owner-rule:${option.optionId}`, type: 'RETRIEVAL_TRUTH_OWNER_RULE', hard: true, violatedOptionIds: [option.optionId], reasonCode: rejectionReason(option), description: 'Retrieval/Truth owner policy deterministically rejects stale or authority-upgrading option.' })),
        allowedOutcomes: [JevDecisionShape.CHOOSE_ONE, JevDecisionShape.UNRESOLVED, JevDecisionShape.ABSTAIN, JevDecisionShape.ESCALATE, JevDecisionShape.REQUEST_OPERATOR],
        authorityBoundary: { authorityClass: 'ADVISORY', ownerId: normalized.owner, notes: 'Retrieval score/provider confidence/Jev confidence are not Truth or Settlement authority.' },
        sourceRevisionSet: normalized.sourceRevisionSet,
        worldRevision: normalized.worldRevision,
        sceneRevision: normalized.sceneRevision,
        characterStateRevision: normalized.characterStateRevision,
        domainRevisions: { candidateSet: normalized.candidateSetRevision, truthOwner: normalized.ownerRevision },
        freshnessToken: normalized.freshnessToken,
        abstentionAllowed: true,
        escalationPolicy: { allowedTargets: ['OWNER', 'OPERATOR', 'DEEP_REVIEW', 'RETRY_LATER', 'UNRESOLVED'], defaultTarget: 'OWNER', maxRetries: normalized.maxRetries },
        deadline: normalized.deadline,
        softDeadline: normalized.softDeadline,
        resultClass: normalized.resultClass,
        cognitiveLayer: normalized.cognitiveLayer,
        domainAdapterId: 'jev.adapter.retrieval-truth.v1',
        domainAdapterVersion: '1.0.0',
        routing: normalized.routing,
        metadata: { domain: JevDomain.RETRIEVAL_TRUTH, decisionKind: normalized.decisionKind, precheckStatus: precheckReceipt.status, candidateSetId: normalized.candidateSetId, retrievalQuality: normalized.retrievalQuality, correctiveAttempt: normalized.correctiveAttempt },
      });
    },

    validateReceipt(receipt, context) {
      validateReceiptAgainstRequest(receipt, context);
      for (const selectedId of receipt.selectedOptionIds) {
        const option = normalizeOption(context.input.options.find((row) => (row.optionId ?? row.id) === selectedId));
        if (ownerRejects(option)) throw new TypeError('Retrieval/Truth receipt selected deterministically rejected option');
      }
      return true;
    },

    interpretReceipt(receipt, { input, request, currentRevisionState, precheck: pre }) {
      validateReceiptAgainstRequest(receipt, { request, currentRevisionState });
      const selected = receipt.selectedOptionIds[0] ?? null;
      const unresolved = [JevOutcome.UNRESOLVED, JevOutcome.ABSTAINED, JevOutcome.STALE, JevOutcome.INVALID].includes(receipt.outcome);
      const proposedOutcome = unresolved ? 'UNRESOLVED' : selected ?? 'UNRESOLVED';
      return createOwnerProposal({
        proposalType: 'RetrievalTruthDecisionProposal',
        domain: JevDomain.RETRIEVAL_TRUTH,
        decisionKind: input.decisionKind,
        owner: input.owner ?? 'RETRIEVAL_TRUTH_OWNER',
        request,
        receipt,
        precheck: pre,
        proposedOutcome,
        details: {
          semanticDecision: proposedOutcome,
          allowWeakEvidencePromotion: false,
          candidateAuthority: false,
          truthSettlement: false,
          provenanceRewrite: false,
          historicalToCurrentPromotion: false,
          candidateBusMutation: false,
          contextSealWrite: false,
        },
        explanation: retrievalExplanation(receipt, proposedOutcome),
        staleState: receipt.outcome === JevOutcome.STALE ? 'STALE' : 'FRESH',
      });
    },

    fallbackProposal(input, { reason, error } = {}) {
      return createOwnerProposal({
        proposalType: 'RetrievalTruthDecisionProposal',
        domain: JevDomain.RETRIEVAL_TRUTH,
        decisionKind: input?.decisionKind ?? 'RETRIEVAL_TRUTH_UNKNOWN',
        owner: input?.owner ?? 'RETRIEVAL_TRUTH_OWNER',
        proposedOutcome: 'UNRESOLVED',
        details: { semanticDecision: 'UNRESOLVED', allowWeakEvidencePromotion: false, candidateAuthority: false, truthSettlement: false, candidateBusMutation: false, contextSealWrite: false },
        explanation: `Retrieval/Truth remains unresolved because ${reason ?? 'adapter execution degraded'}.`,
        fallbackReason: `${reason ?? 'DEGRADED'}${error?.message ? `:${String(error.message).slice(0, 120)}` : ''}`,
      });
    },
  });
}

function normalizeInput(input) {
  if (!input || input.domain !== JevDomain.RETRIEVAL_TRUTH) throw new TypeError('Retrieval/Truth adapter requires domain RETRIEVAL_TRUTH');
  if (!Object.values(RetrievalTruthJevDecisionKind).includes(input.decisionKind)) throw new TypeError(`unsupported Retrieval/Truth decision kind: ${input.decisionKind}`);
  const options = normalizeOptions(input.options);
  const evidence = normalizeEvidence(input.evidence);
  assertAdapterInputBounds({ options, evidence, provenanceRefs: input.provenanceRefs ?? [], metadata: input.adapterMetadata ?? {} });
  if (input.decisionKind === RetrievalTruthJevDecisionKind.CORRECTIVE_RETRIEVAL) for (const option of options) if (!CORRECTIVE.has(option.optionId)) throw new TypeError(`unsupported corrective retrieval option: ${option.optionId}`);
  if (input.decisionKind === RetrievalTruthJevDecisionKind.TRUTH_AMBIGUITY) for (const option of options) if (!TRUTH.has(option.optionId)) throw new TypeError(`unsupported truth semantic option: ${option.optionId}`);
  for (const option of options) for (const ref of option.evidenceRefs) if (!evidence.some((row) => row.evidenceId === ref)) throw new TypeError(`Retrieval/Truth option ${option.optionId} references unknown evidence ${ref}`);
  return {
    ...input,
    decisionId: required(input.decisionId, 'decisionId'),
    turnId: required(input.turnId, 'turnId'),
    taskId: required(input.taskId ?? `jev:${input.decisionId}`, 'taskId'),
    correlationId: required(input.correlationId, 'correlationId'),
    owner: required(input.owner ?? 'RETRIEVAL_TRUTH_OWNER', 'owner'),
    options,
    evidence,
    provenanceRefs: strings(input.provenanceRefs ?? []),
    candidateSetId: input.candidateSetId ?? null,
    candidateSetRevision: revision(input.candidateSetRevision ?? input.domainRevisions?.candidateSet ?? 0),
    ownerRevision: revision(input.ownerRevision ?? input.domainRevisions?.truthOwner ?? 0),
    retrievalQuality: input.retrievalQuality ?? 'MIXED',
    correctiveAttempt: integer(input.correctiveAttempt ?? 0, 0, 1),
    sourceRevisionSet: strings(input.sourceRevisionSet ?? []),
    worldRevision: finite(input.worldRevision ?? 0),
    sceneRevision: finite(input.sceneRevision ?? 0),
    characterStateRevision: finite(input.characterStateRevision ?? 0),
    freshnessToken: required(input.freshnessToken ?? `retrieval-truth:${input.decisionId}`, 'freshnessToken'),
    deadline: finite(input.deadline ?? Number.MAX_SAFE_INTEGER),
    softDeadline: finite(input.softDeadline ?? input.deadline ?? Number.MAX_SAFE_INTEGER),
    resultClass: input.resultClass ?? ResultClass.OPPORTUNISTIC,
    cognitiveLayer: input.cognitiveLayer ?? 'L1',
    maxRetries: integer(input.maxRetries ?? 1, 0, 3),
    routing: input.routing ?? { expectedDecisionValue: .82, latencyPenalty: .05, costPenalty: .03, uncertaintyPenalty: .05, authorityRisk: 0, minimumInvocationValue: .2 },
  };
}

function ownerRejects(option) { return Boolean(option.stale || option.illegal || option.payload?.promotesHistoricalToCurrent === true || option.payload?.rewritesProvenance === true || option.payload?.claimsAuthority === true); }
function rejectionReason(option) { if (option.stale) return 'STALE_CANDIDATE'; if (option.payload?.promotesHistoricalToCurrent) return 'HISTORICAL_NOT_CURRENT'; if (option.payload?.rewritesProvenance) return 'PROVENANCE_IMMUTABLE'; if (option.payload?.claimsAuthority) return 'CANDIDATE_NOT_AUTHORITY'; return 'RETRIEVAL_TRUTH_OWNER_RULE'; }
function normalizeOptions(values) { if (!Array.isArray(values)) throw new TypeError('Retrieval/Truth options must be array'); const seen = new Set(); return values.map(normalizeOption).map((value) => { if (seen.has(value.optionId)) throw new TypeError('duplicate Retrieval/Truth optionId'); seen.add(value.optionId); return value; }); }
function normalizeOption(value) { if (!value) throw new TypeError('Retrieval/Truth option required'); return { optionId: required(value.optionId ?? value.id, 'optionId'), label: String(value.label ?? value.optionId ?? value.id).slice(0, 240), evidenceRefs: strings(value.evidenceRefs ?? []), provenanceRefs: strings(value.provenanceRefs ?? []), stale: Boolean(value.stale), illegal: Boolean(value.illegal), payload: structuredClone(value.payload ?? {}) }; }
function normalizeEvidence(values = []) { if (!Array.isArray(values)) throw new TypeError('Retrieval/Truth evidence must be array'); return values.map((value) => ({ evidenceId: required(value.evidenceId ?? value.ref, 'evidenceId'), sourceRef: value.sourceRef ?? null, summary: String(value.summary ?? '').slice(0, 1200), provenanceRefs: strings(value.provenanceRefs ?? []), revision: value.revision ?? null, available: value.available !== false, stale: Boolean(value.stale), metadata: structuredClone(value.metadata ?? {}) })); }
function answer(option, rejectedOptionIds) { return { outcome: JevOutcome.DECIDED, decisionCode: JevDecisionShape.CHOOSE_ONE, selectedOptionIds: [option.optionId], rejectedOptionIds: rejectedOptionIds.filter((id) => id !== option.optionId), evidenceUsed: [...option.evidenceRefs], confidence: 1, reasonCodes: ['RETRIEVAL_TRUTH_OWNER_DETERMINISTIC'] }; }
function precheck(status, extra = {}) { return deepFreeze({ kind: 'JevAdapterPrecheckReceipt', status, ...extra }); }
function retrievalExplanation(receipt, outcome) { if (receipt.outcome === JevOutcome.STALE) return 'Retrieval/Truth Jev receipt was rejected because its candidate/revision fence is stale.'; if (receipt.abstained || outcome === 'UNRESOLVED') return 'Jev preserved Retrieval/Truth as unresolved; weak or conflicting evidence was not promoted.'; if (receipt.serviceStatus === 'JEV_SKIPPED') return `Jev was skipped because deterministic Retrieval/Truth policy left ${outcome} as the valid bounded outcome.`; return `Jev proposed ${outcome} from finite owner-supplied Retrieval/Truth alternatives; Truth/Settlement authority remains external.`; }
function required(value, name) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be non-empty string`); return value.trim(); }
function strings(values) { if (!Array.isArray(values)) throw new TypeError('expected array'); return [...new Set(values.map((value) => required(value, 'array value')))]; }
function finite(value) { const n = Number(value); if (!Number.isFinite(n)) throw new TypeError('value must be finite'); return n; }
function revision(value) { return ['string', 'number'].includes(typeof value) && String(value) ? value : 0; }
function integer(value, min, max) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new TypeError(`integer must be ${min}-${max}`); return n; }