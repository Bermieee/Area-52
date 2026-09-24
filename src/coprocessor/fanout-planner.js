import { Capability, Placement, ResultClass } from './constants.js';
import { createCognitiveTask } from './contracts.js';
import { historianUrgency } from './historian-retrieval.js';
import { buildCoprocessorChoiceProposal } from './cognitive-choice-proposal.js';

export const INITIAL_ROLE_CATALOG = Object.freeze([
  Object.freeze({
    roleId: 'historian', taskType: 'HISTORIAN_RETRIEVAL', compilerLane: 'loreEvidence',
    requiredCapabilities: [Capability.RETRIEVAL, Capability.LONG_CONTEXT],
    resultClass: ResultClass.REQUIRED, placement: Placement.HOT, cognitiveLayer: 'L1', costUnits: 2, latencyClass: 'LOW',
  }),
  Object.freeze({
    roleId: 'graph-walker', taskType: 'GRAPH_WALK', compilerLane: 'graphResults',
    requiredCapabilities: [Capability.GRAPH],
    resultClass: ResultClass.REQUIRED, placement: Placement.HOT, cognitiveLayer: 'L1', costUnits: 1, latencyClass: 'LOW',
  }),
  Object.freeze({
    roleId: 'green-room', taskType: 'GREEN_ROOM', compilerLane: 'greenRoom',
    requiredCapabilities: [Capability.SEMANTIC_JUDGMENT, Capability.CHARACTER_INFERENCE],
    resultClass: ResultClass.OPPORTUNISTIC, placement: Placement.HOT, cognitiveLayer: 'L1', costUnits: 1, latencyClass: 'LOW',
    batchMetadata: { batchable: true, slicePolicy: 'ADAPTIVE', checkpointBoundary: 'SLICE', yieldSafety: 'CHECKPOINT_ONLY', partialResultSemantics: 'PRESERVE_VALID_SLICES' },
  }),
  Object.freeze({
    roleId: 'truth-precision', taskType: 'TRUTH_PRECISION', compilerLane: 'truthClassifications',
    requiredCapabilities: [Capability.TRUTH_JUDGMENT, Capability.RERANK],
    resultClass: ResultClass.REQUIRED, placement: Placement.HOT, cognitiveLayer: 'L1', costUnits: 2, latencyClass: 'LOW',
  }),
  Object.freeze({
    roleId: 'consolidation', taskType: 'CONSOLIDATION', compilerLane: 'consolidationProposals',
    requiredCapabilities: [Capability.CONSOLIDATION, Capability.COMPRESSION],
    resultClass: ResultClass.DEFERRED, placement: Placement.DEEP, cognitiveLayer: 'L3', costUnits: 4, latencyClass: 'HIGH',
    batchMetadata: { batchable: true, slicePolicy: 'ADAPTIVE', checkpointBoundary: 'SLICE', yieldSafety: 'CHECKPOINT_ONLY', partialResultSemantics: 'PRESERVE_VALID_SLICES' },
  }),
]);

export class DynamicFanOutPlanner {
  constructor({
    roleCatalog = INITIAL_ROLE_CATALOG,
    defaultSoftBudgetMs = 70,
    defaultHardBudgetMs = 120,
    maxWorkers = 16,
    expectedValueThreshold = 0.65,
    maxForegroundWorkers = null,
    maxOpportunisticWorkers = null,
    maxBackgroundNominations = null,
    maxCostUnits = 16,
    maxDeadlineExposureMs = null,
  } = {}) {
    this.roleCatalog = [...roleCatalog];
    this.defaultSoftBudgetMs = defaultSoftBudgetMs;
    this.defaultHardBudgetMs = defaultHardBudgetMs;
    this.maxWorkers = maxWorkers;
    this.expectedValueThreshold = expectedValueThreshold;
    this.defaultCaps = {
      maxForegroundWorkers: maxForegroundWorkers ?? maxWorkers,
      maxOpportunisticWorkers: maxOpportunisticWorkers ?? maxWorkers,
      maxBackgroundNominations: maxBackgroundNominations ?? maxWorkers,
      maxCostUnits,
      maxDeadlineExposureMs: maxDeadlineExposureMs ?? maxWorkers * defaultHardBudgetMs,
    };
  }

  plan({
    turnEvent,
    text = '',
    queryIntent = null,
    sceneEntities = [],
    activeCast = [],
    activeThreads = [],
    uncertainSceneFields = [],
    sceneTransitionType = null,
    retrievalQuality = null,
    prefetchRecommendations = [],
    conflictSignals = [],
    expectedValue = {},
    providerHealth = {},
    providerLoad = {},
    latencyBudgetMs = this.defaultHardBudgetMs,
    costBudget = 'MEDIUM',
    cacheWarmth = {},
    warmState = null,
    availableCapabilities = null,
    location = null,
    inputRefs = {},
    maxFanOut = this.maxWorkers,
    resourceConstraint = {},
    backgroundSignals = {},
    hotStateSufficient = false,
  }) {
    if (!turnEvent) throw new TypeError('turnEvent is required');
    const normalized = String(text).trim().toLowerCase();
    const trivial = /^(ok|okay|thanks|thank you|got it|sure|yep|yes)[.! ]*$/.test(normalized);
    const prefetch = Array.isArray(prefetchRecommendations) ? prefetchRecommendations : [];
    const sceneUncertain = Array.isArray(uncertainSceneFields) ? uncertainSceneFields : [];
    const physical = /\b(where|location|inventory|item|weapon|blade|find|looking|returns?|ruin|tavern|carried|left)\b/.test(normalized)
      || ['LOCATION', 'INVENTORY', 'PHYSICAL_STATE', 'CURRENT_STATE'].includes(queryIntent);
    const dialogue = /\b(speaks?|speaking|talks?|asks?|tells?|mara|dialogue)\b/.test(normalized) || activeCast.length > 1;
    const conflict = conflictSignals.length > 0 || sceneUncertain.length > 0 || ['MIXED', 'LOW'].includes(retrievalQuality)
      || /\b(conflict|contradiction|ambiguous|truth|current|historical)\b/.test(normalized);
    const continuity = activeThreads.length > 0 || sceneEntities.length > 0 || normalized.length > 20 || prefetch.length > 0;
    const transition = sceneTransitionType != null && !['CONTINUES', 'FALSE_BOUNDARY', 'REJECTED'].includes(sceneTransitionType);
    const freshWarm = warmState === 'FRESH' || cacheWarmth.historian === 'FRESH';
    const historianPolicy = historianUrgency({
      text, queryIntent, activeThreads, hotStateSufficient, freshWarm, physical,
    });

    if ((trivial || hotStateSufficient) && !conflict && !transition && !backgroundSignals.consolidationPending && !historianPolicy.wake) {
      return freezePlan(turnEvent, [], [], {
        reason: 'zero-worker path: hot cognition already satisfies turn',
        reasonCodes: ['HOT_STATE_SUFFICIENT'], costBudget, latencyBudgetMs,
        boundedFanOut: 0, budget: budgetReceipt(0, 0, 0, 0, this.#caps(maxFanOut, resourceConstraint)),
      });
    }

    const selected = new Map();
    const nominate = (roleId, value, reasons = [], requiredInputs = []) => {
      const prior = selected.get(roleId);
      const next = { expectedValue: clamp(value), reasonCodes: uniqueStrings([...(prior?.reasonCodes ?? []), ...reasons]), requiredInputs: uniqueStrings([...(prior?.requiredInputs ?? []), ...requiredInputs]) };
      if (!prior || next.expectedValue >= prior.expectedValue) selected.set(roleId, next);
    };

    if (historianPolicy.wake) nominate(
      'historian',
      historianPolicy.resultClass === ResultClass.REQUIRED ? 0.94 : 0.76,
      [historianPolicy.reason],
      ['sceneRevision', 'sourceRevisionSet', 'intentFingerprint', 'retrievalIntents'],
    );
    if (physical || transition || sceneUncertain.some((field) => ['location', 'immediateObjects', 'activeCast'].includes(field))) nominate('graph-walker', 0.86, ['PHYSICAL_OR_SCENE_STATE_QUERY'], ['sceneRevision', 'location']);
    if (dialogue && activeCast.length) nominate('green-room', 0.76, ['ACTIVE_CAST_DIALOGUE'], ['activeCast', 'sceneRevision']);
    if (physical || conflict || retrievalQuality === 'MIXED') nominate('truth-precision', 0.90, ['UNCERTAINTY_OR_PRECISION_REQUIRED'], ['worldRevision', 'sourceRevisionSet']);
    if (retrievalQuality === 'LOW') nominate('truth-precision', 0.72, ['LOW_RETRIEVAL_REQUIRES_ABSTENTION_CHECK'], ['retrievalQuality']);
    if (backgroundSignals.consolidationPending || Number(backgroundSignals.pendingUnits ?? 0) > 0) nominate('consolidation', Number(backgroundSignals.expectedValue ?? 0.70), ['BACKGROUND_CONSOLIDATION_PENDING'], ['artifactRefs', 'checkpoint']);

    for (const [roleId, value] of Object.entries(expectedValue)) if (Number(value) > this.expectedValueThreshold) nominate(roleId, Number(value), ['EXPLICIT_EXPECTED_VALUE'], []);

    const caps = this.#caps(maxFanOut, resourceConstraint);
    const capabilitySet = availableCapabilities ? new Set(availableCapabilities) : null;
    const tasks = [];
    const nominations = [];
    let foregroundCount = 0, opportunisticCount = 0, backgroundCount = 0, costUsed = 0, deadlineExposureUsed = 0;

    for (const role of this.roleCatalog) {
      const signal = selected.get(role.roleId);
      if (!signal || signal.expectedValue <= this.expectedValueThreshold && !expectedValue[role.roleId]) continue;
      if (capabilitySet && role.requiredCapabilities.some((capability) => !capabilitySet.has(capability))) continue;
      if (providerHealth[role.roleId] === 'unavailable' || providerHealth[role.roleId] === 'unhealthy') continue;
      if (Number(providerLoad[role.roleId] ?? 0) >= 1) continue;
      if (tasks.length >= caps.maxTotalWorkers) break;
      const effectiveResultClass = role.roleId === 'historian' ? (historianPolicy.resultClass ?? role.resultClass) : role.resultClass;
      if (effectiveResultClass === ResultClass.DEFERRED && backgroundCount >= caps.maxBackgroundNominations) continue;
      if (effectiveResultClass !== ResultClass.DEFERRED && foregroundCount >= caps.maxForegroundWorkers) continue;
      if (effectiveResultClass === ResultClass.OPPORTUNISTIC && opportunisticCount >= caps.maxOpportunisticWorkers) continue;
      const cost = Math.max(0, Number(role.costUnits ?? 1));
      if (costUsed + cost > caps.maxCostUnits) continue;
      const deadlineExposure = effectiveResultClass === ResultClass.DEFERRED ? 0 : Math.min(this.defaultHardBudgetMs, latencyBudgetMs);
      if (deadlineExposureUsed + deadlineExposure > caps.maxDeadlineExposureMs) continue;

      const softDeadline = turnEvent.createdAt + Math.min(this.defaultSoftBudgetMs, latencyBudgetMs);
      const hardDeadline = turnEvent.createdAt + Math.min(this.defaultHardBudgetMs, latencyBudgetMs);
      const nomination = Object.freeze({
        roleId: role.roleId,
        taskType: role.taskType,
        capability: Object.freeze([...role.requiredCapabilities]),
        resultClass: effectiveResultClass,
        expectedValue: signal.expectedValue,
        reasonCodes: Object.freeze([...signal.reasonCodes]),
        requiredInputs: Object.freeze([...signal.requiredInputs]),
        freshnessFence: Object.freeze({ sourceRevisionSet: [...turnEvent.sourceRevisionSet], worldRevision: turnEvent.worldRevision, sceneRevision: turnEvent.sceneRevision, characterStateRevision: turnEvent.characterStateRevision, intentFingerprint: `intent:${turnEvent.turnId}:${queryIntent ?? 'AUTO'}` }),
        costEstimate: Object.freeze({ units: cost, class: costBudget }),
        latencyClass: role.latencyClass ?? null,
        fallback: Object.freeze(fallbackFor(role.roleId)),
        providerIdentity: null,
        canonicalAuthority: false,
      });
      nominations.push(nomination);
      tasks.push(createCognitiveTask({
        taskId: `${turnEvent.turnId}:${role.roleId}`,
        taskType: role.taskType,
        turnId: turnEvent.turnId,
        correlationId: turnEvent.correlationId,
        causationId: turnEvent.eventId,
        requiredCapabilities: role.requiredCapabilities,
        cognitiveLayer: role.cognitiveLayer,
        resultClass: effectiveResultClass,
        inputRevisionSet: turnEvent,
        sourceRevisionSet: turnEvent.sourceRevisionSet,
        worldRevision: turnEvent.worldRevision,
        sceneRevision: turnEvent.sceneRevision,
        characterStateRevision: turnEvent.characterStateRevision,
        softDeadline,
        hardDeadline,
        batchMetadata: role.batchMetadata ?? { batchable: false },
        outputSchema: role.outputSchema ?? { type: 'object' },
        fallbackPolicy: fallbackFor(role.roleId),
        placement: role.placement,
        compilerLane: role.compilerLane,
        intentFingerprint: nomination.freshnessFence.intentFingerprint,
        metadata: {
          roleId: role.roleId,
          cacheWarm: Boolean(cacheWarmth[role.roleId]),
          warmState,
          costBudget,
          expectedValue: signal.expectedValue,
          reasonCodes: signal.reasonCodes,
          requiredInputs: signal.requiredInputs,
          costEstimate: nomination.costEstimate,
          latencyClass: nomination.latencyClass,
          historianUrgency: role.roleId === 'historian' ? historianPolicy.reason : null,
          location,
          inputRefs: structuredClone(inputRefs[role.roleId] ?? []),
          resourceConstraint: structuredClone(resourceConstraint),
        },
      }));
      costUsed += cost;
      deadlineExposureUsed += deadlineExposure;
      if (effectiveResultClass === ResultClass.DEFERRED) backgroundCount += 1;
      else foregroundCount += 1;
      if (effectiveResultClass === ResultClass.OPPORTUNISTIC) opportunisticCount += 1;
    }

    return freezePlan(turnEvent, tasks, nominations, {
      reason: tasks.length ? 'expected-value bounded fan-out' : 'zero-worker path: no eligible expected-value cognition',
      reasonCodes: tasks.length ? ['EXPECTED_VALUE_PLAN'] : ['NO_ELIGIBLE_EXPECTED_VALUE'],
      costBudget,
      latencyBudgetMs,
      boundedFanOut: caps.maxTotalWorkers,
      budget: budgetReceipt(foregroundCount, opportunisticCount, backgroundCount, costUsed, caps, deadlineExposureUsed),
      inputSignals: Object.freeze({ queryIntent, location, retrievalQuality, sceneTransitionType, uncertainSceneFieldCount: sceneUncertain.length, prefetchRecommendationCount: prefetch.length }),
    });
  }


  planChoice(input = {}) {
    const {
      capabilityProfiles = [], ownerSignals = {}, choicePolicyVersion = 'sidecar-choice-v1',
      choiceLimits = {}, telemetry = null, ...plannerInput
    } = input;
    const fanOutPlan = this.plan(plannerInput);
    const choiceProposal = buildCoprocessorChoiceProposal({
      fanOutPlan,
      turnEvent: plannerInput.turnEvent,
      plannerInput: { ...plannerInput, expectedValueThreshold: this.expectedValueThreshold },
      roleCatalog: this.roleCatalog,
      capabilityProfiles,
      ownerSignals,
      policyVersion: choicePolicyVersion,
      telemetry,
      limits: choiceLimits,
    });
    return Object.freeze({ kind: 'FanOutChoicePlan', fanOutPlan, choiceProposal });
  }

  #caps(maxFanOut, resourceConstraint) {
    const total = Math.max(0, Math.min(this.maxWorkers, finiteCap(maxFanOut, this.maxWorkers)));
    const foreground = Math.max(0, Math.min(total, finiteCap(resourceConstraint.maxForegroundWorkers, this.defaultCaps.maxForegroundWorkers)));
    return Object.freeze({
      maxTotalWorkers: total,
      maxForegroundWorkers: foreground,
      maxOpportunisticWorkers: Math.max(0, Math.min(foreground, finiteCap(resourceConstraint.maxOpportunisticWorkers, this.defaultCaps.maxOpportunisticWorkers))),
      maxBackgroundNominations: Math.max(0, Math.min(total, finiteCap(resourceConstraint.maxBackgroundNominations, this.defaultCaps.maxBackgroundNominations))),
      maxCostUnits: Math.max(0, finiteCap(resourceConstraint.maxCostUnits, this.defaultCaps.maxCostUnits)),
      maxDeadlineExposureMs: Math.max(0, finiteCap(resourceConstraint.maxDeadlineExposureMs, this.defaultCaps.maxDeadlineExposureMs)),
    });
  }
}

function fallbackFor(roleId) {
  const map = {
    historian: { type: 'DETERMINISTIC_RETRIEVAL', maxRetries: 1 },
    'graph-walker': { type: 'CURRENT_STATE_LOOKUP', maxRetries: 1 },
    'green-room': { type: 'OMIT_INFERRED_SHADOW_STATE', maxRetries: 0 },
    'truth-precision': { type: 'PRESERVE_UNRESOLVED_AND_FUSED_ORDER', maxRetries: 1 },
    consolidation: { type: 'PARK_OR_RECOMPUTE', maxRetries: 0 },
  };
  return map[roleId] ?? { type: 'DEGRADED_CONTINUE', maxRetries: 0 };
}

function freezePlan(turnEvent, tasks, nominations, metadata) {
  return Object.freeze({
    kind: 'FanOutPlan',
    turnId: turnEvent.turnId,
    correlationId: turnEvent.correlationId,
    tasks: Object.freeze([...tasks]),
    nominations: Object.freeze([...nominations]),
    plannedWorkerCount: tasks.length,
    ...metadata,
  });
}
function budgetReceipt(foreground, opportunistic, background, cost, caps, deadlineExposureMs = 0) { return Object.freeze({ foregroundWorkers: foreground, opportunisticWorkers: opportunistic, backgroundNominations: background, estimatedCostUnits: cost, deadlineExposureMs, caps }); }
function finiteCap(value, fallback) { const n = Number(value ?? fallback); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback; }
function clamp(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function uniqueStrings(values) { return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))]; }
