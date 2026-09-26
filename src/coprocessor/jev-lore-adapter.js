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

export const LoreJevDecisionKind = Object.freeze({
  TREE_PLACEMENT: 'LORE_TREE_PLACEMENT',
  RECONCILIATION: 'LORE_RECONCILIATION',
  RETENTION_REVIEW: 'LORE_RETENTION_REVIEW',
});

export const LoreReconciliationClassification = Object.freeze({
  EXACT_DUPLICATE: 'EXACT_DUPLICATE',
  REDUNDANT_OVERLAP: 'REDUNDANT_OVERLAP',
  COMPLEMENTARY: 'COMPLEMENTARY',
  TEMPORALLY_DISTINCT: 'TEMPORALLY_DISTINCT',
  CONTRADICTORY: 'CONTRADICTORY',
  RELATED_NOT_MERGEABLE: 'RELATED_NOT_MERGEABLE',
  UNRESOLVED: 'UNRESOLVED',
});

const RETENTION = new Set(['PASS', 'REWORK_REQUIRED', 'UNRESOLVED']);
const RECONCILIATION = new Set(Object.values(LoreReconciliationClassification));

export function createLoreJevAdapter() {
  return deepFreeze({
    adapterId: 'jev.adapter.lore.v1',
    domainId: JevDomain.LORE,
    adapterVersion: '1.0.0',
    supportedDecisionKinds: Object.values(LoreJevDecisionKind),

    canAdapt(input) {
      return Boolean(input && input.domain === JevDomain.LORE && Object.values(LoreJevDecisionKind).includes(input.decisionKind));
    },

    deterministicPrecheck(input) {
      const normalized = normalizeLoreInput(input);
      const viable = normalized.options.filter((option) => !option.protected && !option.illegal);
      const rejectedOptionIds = normalized.options.filter((option) => option.protected || option.illegal).map((option) => option.optionId);

      if (normalized.deterministicOutcome) {
        if (!normalized.options.some((option) => option.optionId === normalized.deterministicOutcome)) throw new TypeError('Lore deterministicOutcome must name a supplied option');
        if (rejectedOptionIds.includes(normalized.deterministicOutcome)) throw new TypeError('Lore deterministicOutcome cannot select protected/illegal option');
        return precheck(JevAdapterPrecheckStatus.DETERMINISTIC, {
          reasonCodes: ['LORE_OWNER_DETERMINISTIC'],
          rejectedOptionIds,
          deterministicAnswer: answer(normalized.deterministicOutcome, normalized, rejectedOptionIds),
        });
      }

      if (viable.length === 1) return precheck(JevAdapterPrecheckStatus.DETERMINISTIC, {
        reasonCodes: ['ONLY_ONE_OWNER_VALID_LORE_OPTION'],
        rejectedOptionIds,
        deterministicAnswer: answer(viable[0].optionId, normalized, rejectedOptionIds),
      });

      if (normalized.decisionKind === LoreJevDecisionKind.RECONCILIATION && normalized.exactDuplicate === true) {
        const exact = viable.find((option) => option.optionId === LoreReconciliationClassification.EXACT_DUPLICATE);
        if (exact) return precheck(JevAdapterPrecheckStatus.DETERMINISTIC, {
          reasonCodes: ['LORE_EXACT_DUPLICATE_DETERMINISTIC'],
          rejectedOptionIds,
          deterministicAnswer: answer(exact.optionId, normalized, rejectedOptionIds),
        });
      }

      if (normalized.decisionKind === LoreJevDecisionKind.RETENTION_REVIEW && normalized.requiredContributionMissing === true) {
        const rework = viable.find((option) => option.optionId === 'REWORK_REQUIRED');
        if (rework) return precheck(JevAdapterPrecheckStatus.DETERMINISTIC, {
          reasonCodes: ['LORE_REQUIRED_CONTRIBUTION_MISSING'],
          rejectedOptionIds,
          deterministicAnswer: answer(rework.optionId, normalized, rejectedOptionIds),
        });
      }

      if (viable.length < 1) return precheck(JevAdapterPrecheckStatus.UNRESOLVED_WITHOUT_JEV, { reasonCodes: ['NO_VALID_LORE_OPTION'], rejectedOptionIds });
      return precheck(JevAdapterPrecheckStatus.JEV_REQUIRED, { reasonCodes: ['LORE_BOUNDED_AMBIGUITY'], rejectedOptionIds });
    },

    buildRequest(input, precheckReceipt) {
      const normalized = normalizeLoreInput(input);
      const constraints = normalized.options.filter((option) => option.protected || option.illegal).map((option) => ({
        constraintId: `lore-owner-rule:${option.optionId}`,
        type: option.protected ? 'PROTECTED_LORE_NODE' : 'LORE_OWNER_RULE',
        hard: true,
        violatedOptionIds: [option.optionId],
        reasonCode: option.protected ? 'PROTECTED_LORE_NODE' : 'LORE_OPTION_ILLEGAL',
        description: option.protected ? 'Lore owner marks this placement as protected.' : 'Lore owner marks this option as illegal.',
      }));
      return createJevDecisionRequest({
        decisionId: normalized.decisionId,
        decisionType: normalized.decisionKind,
        decisionShape: JevDecisionShape.CHOOSE_ONE,
        turnId: normalized.turnId,
        taskId: normalized.taskId,
        correlationId: normalized.correlationId,
        causationId: normalized.causationId,
        options: normalized.options.map(toJevOption),
        evidenceRefs: normalized.evidence.map(toJevEvidence),
        provenanceRefs: normalized.provenanceRefs,
        constraints,
        allowedOutcomes: [JevDecisionShape.CHOOSE_ONE, JevDecisionShape.UNRESOLVED, JevDecisionShape.ABSTAIN, JevDecisionShape.ESCALATE, JevDecisionShape.REQUEST_OPERATOR],
        authorityBoundary: { authorityClass: 'ADVISORY', ownerId: normalized.owner, notes: 'Lore adapter may propose only; SOURCE_CANON/UID/Tree/merge authority remains with Lore owner and Settlement.' },
        sourceRevisionSet: normalized.sourceRevisionSet,
        worldRevision: normalized.worldRevision,
        sceneRevision: normalized.sceneRevision,
        characterStateRevision: normalized.characterStateRevision,
        domainRevisions: { lore: normalized.loreRevision, owner: normalized.ownerRevision },
        freshnessToken: normalized.freshnessToken,
        abstentionAllowed: true,
        escalationPolicy: { allowedTargets: ['OWNER', 'OPERATOR', 'DEEP_REVIEW', 'RETRY_LATER', 'UNRESOLVED'], defaultTarget: 'OWNER', maxRetries: normalized.maxRetries },
        operatorApprovalPolicy: { required: false },
        deadline: normalized.deadline,
        softDeadline: normalized.softDeadline,
        resultClass: normalized.resultClass,
        cognitiveLayer: normalized.cognitiveLayer,
        domainAdapterId: 'jev.adapter.lore.v1',
        domainAdapterVersion: '1.0.0',
        routing: normalized.routing,
        metadata: {
          domain: JevDomain.LORE,
          decisionKind: normalized.decisionKind,
          precheckStatus: precheckReceipt.status,
          artifactRefs: normalized.artifactRefs,
          representationRef: normalized.representationRef,
        },
      });
    },

    validateReceipt(receipt, context) {
      validateReceiptAgainstRequest(receipt, context);
      if (receipt.outcome === JevOutcome.DECIDED && !context.request.options.some((option) => receipt.selectedOptionIds.includes(option.optionId))) throw new TypeError('Lore receipt selected unknown owner option');
      return true;
    },

    interpretReceipt(receipt, { input, request, currentRevisionState, precheck: pre }) {
      validateReceiptAgainstRequest(receipt, { request, currentRevisionState });
      const selected = receipt.selectedOptionIds[0] ?? null;
      const unresolved = [JevOutcome.UNRESOLVED, JevOutcome.ABSTAINED, JevOutcome.STALE, JevOutcome.INVALID].includes(receipt.outcome);
      const proposedOutcome = unresolved ? 'UNRESOLVED' : selected ?? (receipt.outcome === JevOutcome.ESCALATE_OWNER ? 'UNRESOLVED' : receipt.decisionCode);
      const details = {
        classification: input.decisionKind === LoreJevDecisionKind.RECONCILIATION ? proposedOutcome : null,
        placementProposal: input.decisionKind === LoreJevDecisionKind.TREE_PLACEMENT ? proposedOutcome : null,
        retentionProposal: input.decisionKind === LoreJevDecisionKind.RETENTION_REVIEW ? proposedOutcome : null,
        sourceCanon: false,
        uidDeletion: false,
        treeMutation: false,
        sourceMerge: false,
      };
      return createOwnerProposal({
        proposalType: input.decisionKind === LoreJevDecisionKind.RECONCILIATION ? 'LoreReconciliationProposal' : 'LoreDecisionProposal',
        domain: JevDomain.LORE,
        decisionKind: input.decisionKind,
        owner: input.owner ?? 'LORE_OWNER',
        request,
        receipt,
        precheck: pre,
        proposedOutcome,
        details,
        explanation: loreExplanation(receipt, proposedOutcome),
        staleState: receipt.outcome === JevOutcome.STALE ? 'STALE' : 'FRESH',
      });
    },

    fallbackProposal(input, { reason, error } = {}) {
      return createOwnerProposal({
        proposalType: input?.decisionKind === LoreJevDecisionKind.RECONCILIATION ? 'LoreReconciliationProposal' : 'LoreDecisionProposal',
        domain: JevDomain.LORE,
        decisionKind: input?.decisionKind ?? 'LORE_UNKNOWN',
        owner: input?.owner ?? 'LORE_OWNER',
        proposedOutcome: 'UNRESOLVED',
        details: { classification: 'UNRESOLVED', preserveLoreState: true, sourceCanon: false, treeMutation: false, sourceMerge: false },
        explanation: `Lore ambiguity preserved because ${reason ?? 'adapter execution degraded'}.`,
        fallbackReason: `${reason ?? 'DEGRADED'}${error?.message ? `:${String(error.message).slice(0, 120)}` : ''}`,
      });
    },
  });
}

function normalizeLoreInput(input) {
  if (!input || input.domain !== JevDomain.LORE) throw new TypeError('Lore adapter requires domain LORE');
  if (!Object.values(LoreJevDecisionKind).includes(input.decisionKind)) throw new TypeError(`unsupported Lore decision kind: ${input.decisionKind}`);
  const options = normalizeOptions(input.options);
  const evidence = normalizeEvidence(input.evidence);
  assertAdapterInputBounds({ options, evidence, provenanceRefs: input.provenanceRefs ?? [], metadata: input.adapterMetadata ?? {} });
  const optionIds = new Set(options.map((option) => option.optionId));
  for (const option of options) for (const ref of option.evidenceRefs) if (!evidence.some((row) => row.evidenceId === ref)) throw new TypeError(`Lore option ${option.optionId} references unknown evidence ${ref}`);
  if (input.decisionKind === LoreJevDecisionKind.RECONCILIATION) for (const option of options) if (!RECONCILIATION.has(option.optionId)) throw new TypeError(`unsupported Lore reconciliation option: ${option.optionId}`);
  if (input.decisionKind === LoreJevDecisionKind.RETENTION_REVIEW) for (const option of options) if (!RETENTION.has(option.optionId)) throw new TypeError(`unsupported Lore retention option: ${option.optionId}`);
  if (optionIds.size !== options.length) throw new TypeError('duplicate Lore optionId');
  return {
    ...input,
    decisionId: required(input.decisionId, 'decisionId'),
    turnId: required(input.turnId, 'turnId'),
    taskId: required(input.taskId ?? `jev:${input.decisionId}`, 'taskId'),
    correlationId: required(input.correlationId, 'correlationId'),
    owner: required(input.owner ?? 'LORE_OWNER', 'owner'),
    options,
    evidence,
    provenanceRefs: strings(input.provenanceRefs ?? []),
    artifactRefs: strings(input.artifactRefs ?? []).slice(0, 32),
    representationRef: input.representationRef ?? null,
    sourceRevisionSet: strings(input.sourceRevisionSet ?? []),
    worldRevision: finite(input.worldRevision ?? 0),
    sceneRevision: finite(input.sceneRevision ?? 0),
    characterStateRevision: finite(input.characterStateRevision ?? 0),
    loreRevision: revision(input.loreRevision ?? input.domainRevisions?.lore ?? 0),
    ownerRevision: revision(input.ownerRevision ?? input.domainRevisions?.owner ?? 0),
    freshnessToken: required(input.freshnessToken ?? `lore:${input.decisionId}`, 'freshnessToken'),
    deadline: finite(input.deadline ?? Number.MAX_SAFE_INTEGER),
    softDeadline: finite(input.softDeadline ?? input.deadline ?? Number.MAX_SAFE_INTEGER),
    resultClass: input.resultClass ?? ResultClass.OPPORTUNISTIC,
    cognitiveLayer: input.cognitiveLayer ?? 'L1',
    maxRetries: integer(input.maxRetries ?? 1, 0, 3),
    routing: input.routing ?? { expectedDecisionValue: .85, latencyPenalty: .05, costPenalty: .03, uncertaintyPenalty: .05, authorityRisk: 0, minimumInvocationValue: .2 },
  };
}

function normalizeOptions(values) {
  if (!Array.isArray(values)) throw new TypeError('Lore options must be array');
  return values.map((value) => ({ optionId: required(value.optionId ?? value.id, 'optionId'), label: String(value.label ?? value.optionId ?? value.id).slice(0, 240), evidenceRefs: strings(value.evidenceRefs ?? []), provenanceRefs: strings(value.provenanceRefs ?? []), protected: Boolean(value.protected), illegal: Boolean(value.illegal), payload: structuredClone(value.payload ?? {}) }));
}
function normalizeEvidence(values = []) { if (!Array.isArray(values)) throw new TypeError('Lore evidence must be array'); return values.map((value) => ({ evidenceId: required(value.evidenceId ?? value.ref, 'evidenceId'), sourceRef: value.sourceRef ?? null, summary: String(value.summary ?? '').slice(0, 1200), provenanceRefs: strings(value.provenanceRefs ?? []), revision: value.revision ?? null, available: value.available !== false, stale: Boolean(value.stale), metadata: structuredClone(value.metadata ?? {}) })); }
function toJevOption(value) { return { optionId: value.optionId, label: value.label, evidenceRefs: value.evidenceRefs, provenanceRefs: value.provenanceRefs, requiresEvidence: value.evidenceRefs.length > 0, payload: value.payload }; }
function toJevEvidence(value) { return value; }
function answer(optionId, normalized, rejectedOptionIds) { const option = normalized.options.find((row) => row.optionId === optionId); return { outcome: JevOutcome.DECIDED, decisionCode: JevDecisionShape.CHOOSE_ONE, selectedOptionIds: [optionId], rejectedOptionIds: rejectedOptionIds.filter((id) => id !== optionId), evidenceUsed: [...(option?.evidenceRefs ?? [])], confidence: 1, reasonCodes: ['OWNER_DETERMINISTIC'] }; }
function precheck(status, extra = {}) { return deepFreeze({ kind: 'JevAdapterPrecheckReceipt', status, ...extra }); }
function loreExplanation(receipt, outcome) { if (receipt.outcome === JevOutcome.STALE) return 'Lore Jev receipt was rejected because its revision fence is stale.'; if (receipt.abstained) return 'Jev preserved Lore ambiguity because the bounded evidence did not support a safe classification.'; if (outcome === 'UNRESOLVED') return 'Jev preserved the Lore decision as unresolved; Lore owner policy remains authoritative.'; if (receipt.serviceStatus === 'JEV_SKIPPED') return `Jev was skipped because Lore owner checks deterministically left ${outcome} as the valid bounded outcome.`; return `Jev proposed ${outcome} from the bounded Lore decision space; Lore owner policy must decide whether to accept it.`; }
function required(value, name) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be non-empty string`); return value.trim(); }
function strings(values) { if (!Array.isArray(values)) throw new TypeError('expected array'); return [...new Set(values.map((value) => required(value, 'array value')))]; }
function finite(value) { const n = Number(value); if (!Number.isFinite(n)) throw new TypeError('value must be finite'); return n; }
function revision(value) { return ['string', 'number'].includes(typeof value) && String(value) ? value : 0; }
function integer(value, min, max) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new TypeError(`integer must be ${min}-${max}`); return n; }