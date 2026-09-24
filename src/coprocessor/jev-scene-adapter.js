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

export const SceneJevDecisionKind = Object.freeze({
  BOUNDARY: 'SCENE_BOUNDARY',
  CAST_LOCATION_CONFLICT: 'SCENE_CAST_LOCATION_CONFLICT',
  MERGE_SPLIT_REVIEW: 'SCENE_MERGE_SPLIT_REVIEW',
});

export const SceneBoundaryOutcome = Object.freeze({
  CONTINUE_SCENE: 'CONTINUE_SCENE',
  OPEN_NEW_SCENE: 'OPEN_NEW_SCENE',
  RESUME_PRIOR_SCENE: 'RESUME_PRIOR_SCENE',
  UNRESOLVED: 'UNRESOLVED',
});

const BOUNDARY_OUTCOMES = new Set(Object.values(SceneBoundaryOutcome));

export function createSceneJevAdapter() {
  return deepFreeze({
    adapterId: 'jev.adapter.scene.v1',
    domainId: JevDomain.SCENE,
    adapterVersion: '1.0.0',
    supportedDecisionKinds: Object.values(SceneJevDecisionKind),

    canAdapt(input) { return Boolean(input && input.domain === JevDomain.SCENE && Object.values(SceneJevDecisionKind).includes(input.decisionKind)); },

    deterministicPrecheck(input) {
      const normalized = normalizeSceneInput(input);
      const illegal = normalized.options.filter((option) => violatesSceneBoundary(option, normalized));
      const rejectedOptionIds = illegal.map((option) => option.optionId);
      const viable = normalized.options.filter((option) => !rejectedOptionIds.includes(option.optionId));

      if (normalized.decisionKind === SceneJevDecisionKind.BOUNDARY && normalized.boundarySignals.doorwayOnly === true && normalized.boundarySignals.realLocationChange !== true && normalized.boundarySignals.majorTimeShift !== true) {
        const continuation = viable.find((option) => option.optionId === SceneBoundaryOutcome.CONTINUE_SCENE);
        if (continuation) return precheck(JevAdapterPrecheckStatus.DETERMINISTIC, { reasonCodes: ['SCENE_DOORWAY_NO_REAL_BOUNDARY'], rejectedOptionIds, deterministicAnswer: answer(continuation, rejectedOptionIds) });
      }

      if (normalized.decisionKind === SceneJevDecisionKind.BOUNDARY && normalized.boundarySignals.realLocationChange === true && normalized.boundarySignals.observed === true && normalized.boundarySignals.flashbackAmbiguous !== true) {
        const opened = viable.find((option) => option.optionId === SceneBoundaryOutcome.OPEN_NEW_SCENE);
        if (opened) return precheck(JevAdapterPrecheckStatus.DETERMINISTIC, { reasonCodes: ['SCENE_OBSERVED_LOCATION_BOUNDARY'], rejectedOptionIds, deterministicAnswer: answer(opened, rejectedOptionIds) });
      }

      if (normalized.deterministicOutcome) {
        const option = viable.find((row) => row.optionId === normalized.deterministicOutcome);
        if (!option) throw new TypeError('Scene deterministicOutcome must name a viable supplied option');
        return precheck(JevAdapterPrecheckStatus.DETERMINISTIC, { reasonCodes: ['SCENE_OWNER_DETERMINISTIC'], rejectedOptionIds, deterministicAnswer: answer(option, rejectedOptionIds) });
      }

      if (viable.length === 1) return precheck(JevAdapterPrecheckStatus.DETERMINISTIC, { reasonCodes: ['ONLY_ONE_OWNER_VALID_SCENE_OPTION'], rejectedOptionIds, deterministicAnswer: answer(viable[0], rejectedOptionIds) });
      if (!viable.length) return precheck(JevAdapterPrecheckStatus.UNRESOLVED_WITHOUT_JEV, { reasonCodes: ['NO_VALID_SCENE_OPTION'], rejectedOptionIds });
      return precheck(JevAdapterPrecheckStatus.JEV_REQUIRED, { reasonCodes: ['SCENE_BOUNDED_AMBIGUITY'], rejectedOptionIds });
    },

    buildRequest(input, precheckReceipt) {
      const normalized = normalizeSceneInput(input);
      const illegal = normalized.options.filter((option) => violatesSceneBoundary(option, normalized));
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
        constraints: illegal.map((option) => ({ constraintId: `scene-owner-rule:${option.optionId}`, type: 'SCENE_OWNER_RULE', hard: true, violatedOptionIds: [option.optionId], reasonCode: sceneViolationReason(option, normalized), description: 'Scene owner policy forbids semantic upgrade by Jev.' })),
        allowedOutcomes: [JevDecisionShape.CHOOSE_ONE, JevDecisionShape.UNRESOLVED, JevDecisionShape.ABSTAIN, JevDecisionShape.ESCALATE, JevDecisionShape.REQUEST_OPERATOR],
        authorityBoundary: { authorityClass: 'ADVISORY', ownerId: normalized.owner, notes: 'Scene adapter proposes only; Scene owner retains revision, presence, location and merge/split authority.' },
        sourceRevisionSet: normalized.sourceRevisionSet,
        worldRevision: normalized.worldRevision,
        sceneRevision: normalized.sceneRevision,
        characterStateRevision: normalized.characterStateRevision,
        domainRevisions: { scene: normalized.sceneRevision, owner: normalized.ownerRevision },
        freshnessToken: normalized.freshnessToken,
        abstentionAllowed: true,
        escalationPolicy: { allowedTargets: ['OWNER', 'OPERATOR', 'DEEP_REVIEW', 'RETRY_LATER', 'UNRESOLVED'], defaultTarget: 'OWNER', maxRetries: normalized.maxRetries },
        deadline: normalized.deadline,
        softDeadline: normalized.softDeadline,
        resultClass: normalized.resultClass,
        cognitiveLayer: normalized.cognitiveLayer,
        domainAdapterId: 'jev.adapter.scene.v1',
        domainAdapterVersion: '1.0.0',
        routing: normalized.routing,
        metadata: { domain: JevDomain.SCENE, decisionKind: normalized.decisionKind, precheckStatus: precheckReceipt.status, episodeRefs: normalized.episodeRefs, mentionedOnlyRefs: normalized.mentionedOnlyRefs, observedLocationRef: normalized.observedLocationRef },
      });
    },

    validateReceipt(receipt, context) {
      validateReceiptAgainstRequest(receipt, context);
      for (const selectedId of receipt.selectedOptionIds) {
        const option = context.input.options.find((row) => (row.optionId ?? row.id) === selectedId);
        if (option && violatesSceneBoundary(normalizeOption(option), normalizeSceneInput(context.input))) throw new TypeError('Scene receipt selected an owner-forbidden semantic upgrade');
      }
      return true;
    },

    interpretReceipt(receipt, { input, request, currentRevisionState, precheck: pre }) {
      validateReceiptAgainstRequest(receipt, { request, currentRevisionState });
      const selected = receipt.selectedOptionIds[0] ?? null;
      const unresolved = [JevOutcome.UNRESOLVED, JevOutcome.ABSTAINED, JevOutcome.STALE, JevOutcome.INVALID].includes(receipt.outcome);
      const proposedOutcome = unresolved ? 'UNRESOLVED' : selected ?? 'UNRESOLVED';
      return createOwnerProposal({
        proposalType: 'SceneDecisionProposal',
        domain: JevDomain.SCENE,
        decisionKind: input.decisionKind,
        owner: input.owner ?? 'SCENE_OWNER',
        request,
        receipt,
        precheck: pre,
        proposedOutcome,
        details: {
          boundaryProposal: input.decisionKind === SceneJevDecisionKind.BOUNDARY ? proposedOutcome : null,
          preserveCurrentScene: unresolved || receipt.abstained,
          createSceneRevision: false,
          presenceAuthority: false,
          locationAuthority: false,
          mentionedOnlyPromoted: false,
          inferredLocationPromoted: false,
        },
        explanation: sceneExplanation(receipt, proposedOutcome),
        staleState: receipt.outcome === JevOutcome.STALE ? 'STALE' : 'FRESH',
      });
    },

    fallbackProposal(input, { reason, error } = {}) {
      return createOwnerProposal({
        proposalType: 'SceneDecisionProposal',
        domain: JevDomain.SCENE,
        decisionKind: input?.decisionKind ?? 'SCENE_UNKNOWN',
        owner: input?.owner ?? 'SCENE_OWNER',
        proposedOutcome: 'UNRESOLVED',
        details: { boundaryProposal: 'UNRESOLVED', preserveCurrentScene: true, createSceneRevision: false, presenceAuthority: false, locationAuthority: false },
        explanation: `Scene state is preserved because ${reason ?? 'adapter execution degraded'}.`,
        fallbackReason: `${reason ?? 'DEGRADED'}${error?.message ? `:${String(error.message).slice(0, 120)}` : ''}`,
      });
    },
  });
}

function normalizeSceneInput(input) {
  if (!input || input.domain !== JevDomain.SCENE) throw new TypeError('Scene adapter requires domain SCENE');
  if (!Object.values(SceneJevDecisionKind).includes(input.decisionKind)) throw new TypeError(`unsupported Scene decision kind: ${input.decisionKind}`);
  const options = normalizeOptions(input.options);
  const evidence = normalizeEvidence(input.evidence);
  assertAdapterInputBounds({ options, evidence, provenanceRefs: input.provenanceRefs ?? [], metadata: input.adapterMetadata ?? {} });
  if (input.decisionKind === SceneJevDecisionKind.BOUNDARY) for (const option of options) if (!BOUNDARY_OUTCOMES.has(option.optionId)) throw new TypeError(`unsupported Scene boundary option: ${option.optionId}`);
  for (const option of options) for (const ref of option.evidenceRefs) if (!evidence.some((row) => row.evidenceId === ref)) throw new TypeError(`Scene option ${option.optionId} references unknown evidence ${ref}`);
  return {
    ...input,
    decisionId: required(input.decisionId, 'decisionId'),
    turnId: required(input.turnId, 'turnId'),
    taskId: required(input.taskId ?? `jev:${input.decisionId}`, 'taskId'),
    correlationId: required(input.correlationId, 'correlationId'),
    owner: required(input.owner ?? 'SCENE_OWNER', 'owner'),
    options,
    evidence,
    provenanceRefs: strings(input.provenanceRefs ?? []),
    episodeRefs: strings(input.episodeRefs ?? []).slice(0, 32),
    mentionedOnlyRefs: strings(input.mentionedOnlyRefs ?? []).slice(0, 32),
    observedPresenceRefs: strings(input.observedPresenceRefs ?? []).slice(0, 32),
    observedLocationRef: input.observedLocationRef ?? null,
    inferredLocationRefs: strings(input.inferredLocationRefs ?? []).slice(0, 32),
    boundarySignals: structuredClone(input.boundarySignals ?? {}),
    sourceRevisionSet: strings(input.sourceRevisionSet ?? []),
    worldRevision: finite(input.worldRevision ?? 0),
    sceneRevision: finite(input.sceneRevision ?? 0),
    characterStateRevision: finite(input.characterStateRevision ?? 0),
    ownerRevision: revision(input.ownerRevision ?? input.domainRevisions?.owner ?? 0),
    freshnessToken: required(input.freshnessToken ?? `scene:${input.decisionId}`, 'freshnessToken'),
    deadline: finite(input.deadline ?? Number.MAX_SAFE_INTEGER),
    softDeadline: finite(input.softDeadline ?? input.deadline ?? Number.MAX_SAFE_INTEGER),
    resultClass: input.resultClass ?? ResultClass.OPPORTUNISTIC,
    cognitiveLayer: input.cognitiveLayer ?? 'L1',
    maxRetries: integer(input.maxRetries ?? 1, 0, 3),
    routing: input.routing ?? { expectedDecisionValue: .85, latencyPenalty: .05, costPenalty: .03, uncertaintyPenalty: .05, authorityRisk: 0, minimumInvocationValue: .2 },
  };
}

function violatesSceneBoundary(option, input) {
  const presenceClaims = option.payload?.presenceClaims ?? [];
  if (presenceClaims.some((claim) => claim.status === 'PRESENT' && input.mentionedOnlyRefs.includes(claim.characterRef) && !input.observedPresenceRefs.includes(claim.characterRef))) return true;
  const locationClaim = option.payload?.locationClaim;
  if (locationClaim?.status === 'OBSERVED' && locationClaim.locationRef && input.inferredLocationRefs.includes(locationClaim.locationRef) && input.observedLocationRef !== locationClaim.locationRef) return true;
  return Boolean(option.illegal);
}
function sceneViolationReason(option, input) { const presenceClaims = option.payload?.presenceClaims ?? []; if (presenceClaims.some((claim) => claim.status === 'PRESENT' && input.mentionedOnlyRefs.includes(claim.characterRef) && !input.observedPresenceRefs.includes(claim.characterRef))) return 'MENTIONED_ONLY_NOT_PRESENT'; const locationClaim = option.payload?.locationClaim; if (locationClaim?.status === 'OBSERVED' && input.inferredLocationRefs.includes(locationClaim.locationRef) && input.observedLocationRef !== locationClaim.locationRef) return 'INFERRED_NOT_OBSERVED'; return 'SCENE_OWNER_RULE'; }
function normalizeOptions(values) { if (!Array.isArray(values)) throw new TypeError('Scene options must be array'); const seen = new Set(); return values.map(normalizeOption).map((value) => { if (seen.has(value.optionId)) throw new TypeError('duplicate Scene optionId'); seen.add(value.optionId); return value; }); }
function normalizeOption(value) { return { optionId: required(value.optionId ?? value.id, 'optionId'), label: String(value.label ?? value.optionId ?? value.id).slice(0, 240), evidenceRefs: strings(value.evidenceRefs ?? []), provenanceRefs: strings(value.provenanceRefs ?? []), payload: structuredClone(value.payload ?? {}), illegal: Boolean(value.illegal) }; }
function normalizeEvidence(values = []) { if (!Array.isArray(values)) throw new TypeError('Scene evidence must be array'); return values.map((value) => ({ evidenceId: required(value.evidenceId ?? value.ref, 'evidenceId'), sourceRef: value.sourceRef ?? null, summary: String(value.summary ?? '').slice(0, 1200), provenanceRefs: strings(value.provenanceRefs ?? []), revision: value.revision ?? null, available: value.available !== false, stale: Boolean(value.stale), metadata: structuredClone(value.metadata ?? {}) })); }
function answer(option, rejectedOptionIds) { return { outcome: JevOutcome.DECIDED, decisionCode: JevDecisionShape.CHOOSE_ONE, selectedOptionIds: [option.optionId], rejectedOptionIds: rejectedOptionIds.filter((id) => id !== option.optionId), evidenceUsed: [...option.evidenceRefs], confidence: 1, reasonCodes: ['SCENE_OWNER_DETERMINISTIC'] }; }
function precheck(status, extra = {}) { return deepFreeze({ kind: 'JevAdapterPrecheckReceipt', status, ...extra }); }
function sceneExplanation(receipt, outcome) { if (receipt.outcome === JevOutcome.STALE) return 'Scene Jev receipt was rejected because the Scene/revision fence changed.'; if (receipt.abstained || outcome === 'UNRESOLVED') return 'Jev preserved the accepted Scene state because the bounded Scene evidence remained ambiguous.'; if (receipt.serviceStatus === 'JEV_SKIPPED') return `Jev was skipped because Scene owner checks deterministically left ${outcome} as the valid boundary option.`; return `Jev proposed ${outcome} from owner-supplied Scene alternatives; Scene owner policy retains revision and state authority.`; }
function required(value, name) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be non-empty string`); return value.trim(); }
function strings(values) { if (!Array.isArray(values)) throw new TypeError('expected array'); return [...new Set(values.map((value) => required(value, 'array value')))]; }
function finite(value) { const n = Number(value); if (!Number.isFinite(n)) throw new TypeError('value must be finite'); return n; }
function revision(value) { return ['string', 'number'].includes(typeof value) && String(value) ? value : 0; }
function integer(value, min, max) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new TypeError(`integer must be ${min}-${max}`); return n; }