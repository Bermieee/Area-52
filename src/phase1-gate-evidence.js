const clone=(v)=>structuredClone(v);
export const GateEvidenceState=Object.freeze({PASS:'PASS',PARTIAL:'PARTIAL',BLOCKED:'BLOCKED',NOT_RUN:'NOT_RUN'});
export const GateEvidenceCategory=Object.freeze({
 SUBSYSTEM_CHECKPOINT:'subsystemCheckpoint',CI:'ciEvidence',GOLDEN_WORLD:'goldenWorldEvidence',STRESS:'stressEvidence',BROWSER:'browserEvidence',RECOVERY:'restartRecoveryEvidence',FRESHNESS:'freshnessStaleResultEvidence',FUNCTION_TEST:'functionTestEvidence',PERFORMANCE:'performanceResourceEvidence',BLOCKERS:'openBlockers',UI_DIAGNOSTIC:'uiDiagnosticReadiness',CROSS_LANE:'crossLaneCompatibility',
});
export const KnowledgeReadinessDimension=Object.freeze({CORE:'CORE',MEMORY_OWNER:'MEMORY_OWNER',LORE_OWNER:'LORE_OWNER',SENSORY:'SENSORY',PRECISION:'PRECISION',LIVE_ASSEMBLED_MAIN:'LIVE_ASSEMBLED_MAIN'});
const states=new Set(Object.values(GateEvidenceState));
export function createGateEvidenceItem({category,state=GateEvidenceState.NOT_RUN,summary='',evidenceRefs=[],blockers=[]}={}){
  if(!Object.values(GateEvidenceCategory).includes(category))throw new TypeError('unknown gate evidence category');if(!states.has(state))throw new TypeError('invalid gate evidence state');
  return{kind:'GateEvidenceItem',category,state,summary:String(summary),evidenceRefs:[...new Set(evidenceRefs)].sort(),blockers:[...new Set(blockers)].sort()};
}
export class Phase1GateEvidenceAggregator{
  #items=new Map();#knowledgeReadiness=new Map();
  record(item){const normalized=item?.kind==='GateEvidenceItem'?clone(item):createGateEvidenceItem(item);this.#items.set(normalized.category,normalized);return clone(normalized);}
  get(category){const x=this.#items.get(category);return x?clone(x):null;}
  recordKnowledgeReadiness({dimension,state=GateEvidenceState.NOT_RUN,summary='',evidenceRefs=[],blockers=[]}={}){
    if(!Object.values(KnowledgeReadinessDimension).includes(dimension))throw new TypeError('unknown knowledge readiness dimension');
    if(!states.has(state))throw new TypeError('invalid knowledge readiness state');
    const row={kind:'KnowledgeReadinessItem',dimension,state,summary:String(summary),evidenceRefs:[...new Set(evidenceRefs)].sort(),blockers:[...new Set(blockers)].sort()};
    this.#knowledgeReadiness.set(dimension,row);return clone(row);
  }
  knowledgeReadinessReport(){
    const items=Object.values(KnowledgeReadinessDimension).map(dimension=>this.#knowledgeReadiness.get(dimension)??{kind:'KnowledgeReadinessItem',dimension,state:GateEvidenceState.NOT_RUN,summary:'No evidence recorded',evidenceRefs:[],blockers:[]});
    const counts=Object.fromEntries(Object.values(GateEvidenceState).map(s=>[s,items.filter(x=>x.state===s).length]));
    return{kind:'KnowledgeReadinessReport',items:clone(items),counts,coreReady:this.#knowledgeReadiness.get(KnowledgeReadinessDimension.CORE)?.state===GateEvidenceState.PASS,liveAssembledMainReady:this.#knowledgeReadiness.get(KnowledgeReadinessDimension.LIVE_ASSEMBLED_MAIN)?.state===GateEvidenceState.PASS};
  }
  report({checkpoint=null}={}){
    const items=Object.values(GateEvidenceCategory).map(category=>this.#items.get(category)??createGateEvidenceItem({category,state:GateEvidenceState.NOT_RUN,summary:'No evidence recorded'}));
    const counts=Object.fromEntries(Object.values(GateEvidenceState).map(s=>[s,items.filter(x=>x.state===s).length]));
    const gateState=counts.BLOCKED?GateEvidenceState.BLOCKED:(counts.NOT_RUN||counts.PARTIAL)?GateEvidenceState.PARTIAL:GateEvidenceState.PASS;
    return{kind:'Phase1GateEvidenceReport',checkpoint,gateState,items:clone(items),counts,knowledgeReadiness:this.knowledgeReadinessReport(),promotionDecision:null,phase2PromotionAllowed:false,rule:'Missing evidence never implies PASS; Core-side readiness never implies live Function Test PASS; program promotion remains an explicit integration decision.'};
  }
}
