import { Placement, ResultClass } from './constants.js';

export const CoprocessorPlacementPolicy=Object.freeze({
  HISTORIAN_RETRIEVAL:Object.freeze({placement:Placement.HOT,layers:Object.freeze(['L1']),resultClass:ResultClass.REQUIRED}),
  GRAPH_WALK:Object.freeze({placement:Placement.HOT,layers:Object.freeze(['L1']),resultClass:ResultClass.REQUIRED}),
  TRUTH_PRECISION:Object.freeze({placement:Placement.HOT,layers:Object.freeze(['L1']),resultClass:ResultClass.REQUIRED}),
  GREEN_ROOM:Object.freeze({placement:Placement.HOT,layers:Object.freeze(['L1']),resultClass:ResultClass.OPPORTUNISTIC}),
  CONSOLIDATION:Object.freeze({placement:Placement.DEEP,layers:Object.freeze(['L3','L4']),resultClass:ResultClass.DEFERRED}),
  REFLECTION:Object.freeze({placement:Placement.DEEP,layers:Object.freeze(['L3']),resultClass:ResultClass.DEFERRED}),
  LORE_STUDY:Object.freeze({placement:Placement.DEEP,layers:Object.freeze(['L3']),resultClass:ResultClass.DEFERRED}),
});

export function placementFor(taskType){
  return CoprocessorPlacementPolicy[taskType]??null;
}
