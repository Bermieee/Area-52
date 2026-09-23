import { Capability, Placement, ResultClass } from './constants.js';
import { createCognitiveTask } from './contracts.js';

export const INITIAL_ROLE_CATALOG = Object.freeze([
  Object.freeze({
    roleId: 'historian', taskType: 'HISTORIAN_RETRIEVAL', compilerLane: 'loreEvidence',
    requiredCapabilities: [Capability.RETRIEVAL, Capability.LONG_CONTEXT],
    resultClass: ResultClass.REQUIRED, placement: Placement.HOT, cognitiveLayer: 'L1',
  }),
  Object.freeze({
    roleId: 'graph-walker', taskType: 'GRAPH_WALK', compilerLane: 'graphResults',
    requiredCapabilities: [Capability.GRAPH],
    resultClass: ResultClass.REQUIRED, placement: Placement.HOT, cognitiveLayer: 'L1',
  }),
  Object.freeze({
    roleId: 'green-room', taskType: 'GREEN_ROOM', compilerLane: 'greenRoom',
    requiredCapabilities: [Capability.SEMANTIC_JUDGMENT, Capability.CHARACTER_INFERENCE],
    resultClass: ResultClass.OPPORTUNISTIC, placement: Placement.HOT, cognitiveLayer: 'L1',
  }),
  Object.freeze({
    roleId: 'truth-precision', taskType: 'TRUTH_PRECISION', compilerLane: 'truthClassifications',
    requiredCapabilities: [Capability.TRUTH_JUDGMENT, Capability.RERANK],
    resultClass: ResultClass.REQUIRED, placement: Placement.HOT, cognitiveLayer: 'L1',
  }),
]);

export class DynamicFanOutPlanner {
  constructor({ roleCatalog = INITIAL_ROLE_CATALOG, defaultSoftBudgetMs = 70, defaultHardBudgetMs = 120, maxWorkers = 16 } = {}) {
    this.roleCatalog = [...roleCatalog];
    this.defaultSoftBudgetMs = defaultSoftBudgetMs;
    this.defaultHardBudgetMs = defaultHardBudgetMs;
    this.maxWorkers = maxWorkers;
  }

  plan({
    turnEvent, text = '', queryIntent = null, activeCast = [], activeThreads = [],
    conflictSignals = [], expectedValue = {}, providerHealth = {}, latencyBudgetMs = this.defaultHardBudgetMs,
    costBudget = 'MEDIUM', cacheWarmth = {},
  }) {
    const normalized = String(text).trim().toLowerCase();
    const trivial = /^(ok|okay|thanks|thank you|got it|sure|yep|yes)[.! ]*$/.test(normalized);
    if (trivial) return freezePlan(turnEvent, [], { reason: 'zero-worker path: no expected-value cognition', costBudget, latencyBudgetMs });

    const physical = /\b(where|location|inventory|item|weapon|blade|find|looking|returns?|ruin|tavern|carried|left)\b/.test(normalized)
      || ['LOCATION','INVENTORY','PHYSICAL_STATE','CURRENT_STATE'].includes(queryIntent);
    const dialogue = /\b(speaks?|speaking|talks?|asks?|tells?|mara|dialogue)\b/.test(normalized) || activeCast.length > 1;
    const conflict = conflictSignals.length > 0 || /\b(conflict|contradiction|ambiguous|truth|current|historical)\b/.test(normalized);
    const continuity = activeThreads.length > 0 || normalized.length > 20;

    const selected = new Set();
    if (continuity || physical || dialogue) selected.add('historian');
    if (physical) selected.add('graph-walker');
    if (dialogue) selected.add('green-room');
    if (physical || conflict) selected.add('truth-precision');

    for (const [roleId, value] of Object.entries(expectedValue)) if (Number(value) > 0.65) selected.add(roleId);

    const tasks = [];
    for (const role of this.roleCatalog) {
      if (!selected.has(role.roleId)) continue;
      if (role.resultClass !== ResultClass.REQUIRED && providerHealth[role.roleId] === 'unavailable') continue;
      if (tasks.length >= this.maxWorkers) break;
      const softDeadline = turnEvent.createdAt + Math.min(this.defaultSoftBudgetMs, latencyBudgetMs);
      const hardDeadline = turnEvent.createdAt + Math.min(this.defaultHardBudgetMs, latencyBudgetMs);
      tasks.push(createCognitiveTask({
        taskId: `${turnEvent.turnId}:${role.roleId}`,
        taskType: role.taskType,
        turnId: turnEvent.turnId,
        correlationId: turnEvent.correlationId,
        causationId: turnEvent.eventId,
        requiredCapabilities: role.requiredCapabilities,
        cognitiveLayer: role.cognitiveLayer,
        resultClass: role.resultClass,
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
        intentFingerprint: `intent:${turnEvent.turnId}:${queryIntent ?? 'AUTO'}`,
        metadata: { roleId: role.roleId, cacheWarm: Boolean(cacheWarmth[role.roleId]), costBudget },
      }));
    }
    return freezePlan(turnEvent, tasks, {
      reason: tasks.length ? 'expected-value fan-out' : 'no eligible expected-value cognition',
      costBudget, latencyBudgetMs,
    });
  }
}

function fallbackFor(roleId) {
  const map = {
    historian: { type: 'DETERMINISTIC_RETRIEVAL', maxRetries: 1 },
    'graph-walker': { type: 'CURRENT_STATE_LOOKUP', maxRetries: 1 },
    'green-room': { type: 'OMIT_INFERRED_SHADOW_STATE', maxRetries: 0 },
    'truth-precision': { type: 'PRESERVE_UNRESOLVED_AND_FUSED_ORDER', maxRetries: 1 },
  };
  return map[roleId] ?? { type: 'DEGRADED_CONTINUE', maxRetries: 0 };
}

function freezePlan(turnEvent, tasks, metadata) {
  return Object.freeze({
    kind: 'FanOutPlan',
    turnId: turnEvent.turnId,
    correlationId: turnEvent.correlationId,
    tasks: Object.freeze([...tasks]),
    plannedWorkerCount: tasks.length,
    ...metadata,
  });
}
