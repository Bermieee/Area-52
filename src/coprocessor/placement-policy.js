import { Placement, ResultClass } from './constants.js';

export const CoprocessorPlacementPolicy = Object.freeze({
  FAN_OUT_PLANNER: Object.freeze({ placement: Placement.HOT, layers: Object.freeze(['L1']), resultClass: ResultClass.REQUIRED, runtimeEnforced: false }),
  WARM_VALIDATION: Object.freeze({ placement: Placement.HOT, layers: Object.freeze(['L1']), resultClass: ResultClass.OPPORTUNISTIC, runtimeEnforced: false }),
  HISTORIAN_RETRIEVAL: Object.freeze({ placement: Placement.HOT, layers: Object.freeze(['L1']), resultClass: ResultClass.REQUIRED }),
  ADAPTIVE_RETRIEVAL: Object.freeze({ placement: Placement.HOT, layers: Object.freeze(['L1']), resultClass: ResultClass.REQUIRED }),
  PRECISION_RERANK: Object.freeze({ placement: Placement.HOT, layers: Object.freeze(['L1']), resultClass: ResultClass.REQUIRED, runtimeEnforced: false }),
  PRECISION_SEMANTIC_JUDGE: Object.freeze({ placement: Placement.HOT, layers: Object.freeze(['L1']), resultClass: ResultClass.OPPORTUNISTIC, runtimeEnforced: false }),
  GRAPH_WALK: Object.freeze({ placement: Placement.HOT, layers: Object.freeze(['L1']), resultClass: ResultClass.REQUIRED }),
  TRUTH_PRECISION: Object.freeze({ placement: Placement.HOT, layers: Object.freeze(['L1']), resultClass: ResultClass.REQUIRED }),
  GREEN_ROOM: Object.freeze({ placement: Placement.HOT, layers: Object.freeze(['L1']), resultClass: ResultClass.OPPORTUNISTIC }),
  STREAM_VERIFY: Object.freeze({ placement: Placement.HOT, layers: Object.freeze(['L1']), resultClass: ResultClass.OPPORTUNISTIC }),
  CONSOLIDATION: Object.freeze({ placement: Placement.DEEP, layers: Object.freeze(['L3', 'L4']), resultClass: ResultClass.DEFERRED }),
  REFLECTION: Object.freeze({ placement: Placement.DEEP, layers: Object.freeze(['L3']), resultClass: ResultClass.DEFERRED }),
  COLD_RETRIEVAL_MAINTENANCE: Object.freeze({ placement: Placement.DEEP, layers: Object.freeze(['L3']), resultClass: ResultClass.DEFERRED }),
  LORE_STUDY: Object.freeze({ placement: Placement.DEEP, layers: Object.freeze(['L3']), resultClass: ResultClass.DEFERRED }),
});

export function placementFor(taskType) { return CoprocessorPlacementPolicy[taskType] ?? null; }
