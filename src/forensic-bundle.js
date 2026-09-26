import {clone,req,strings} from './framework-utils.js';

function uniq(values){return[...new Set(values.filter(Boolean))].sort();}
function uniqStable(values){return[...new Set(values.filter(Boolean))];}
export function createForensicBundle({
  bundleId,turnId,generationId=null,sourceRevisionRefs=[],worldRevision=null,sceneRevision=null,turnEventRef=null,runtimeWorkRefs=[],workerResultRefs=[],truthDecisionRefs=[],precisionRefs=[],gatherRef=null,transactionRefs=[],settlementRefs=[],promptPlanRef=null,contextSealRef=null,lateResultRefs=[],staleResultRefs=[],diagnosticRefs=[],assemblyProvenanceRefs=[],reconstructionReceipt={},complete=false,
}){
  if(generationId!==null)req(generationId,'ForensicBundle.generationId');
  return{kind:'ForensicBundle',bundleId:req(bundleId,'ForensicBundle.bundleId'),turnId:req(turnId,'ForensicBundle.turnId'),generationId,sourceRevisionRefs:uniq(strings(sourceRevisionRefs,'ForensicBundle.sourceRevisionRefs')),worldRevision:worldRevision===null?null:Number(worldRevision),sceneRevision:sceneRevision===null?null:Number(sceneRevision),turnEventRef:turnEventRef===null?null:req(turnEventRef,'ForensicBundle.turnEventRef'),runtimeWorkRefs:uniq(strings(runtimeWorkRefs,'ForensicBundle.runtimeWorkRefs')),workerResultRefs:uniq(strings(workerResultRefs,'ForensicBundle.workerResultRefs')),truthDecisionRefs:uniq(strings(truthDecisionRefs,'ForensicBundle.truthDecisionRefs')),precisionRefs:uniq(strings(precisionRefs,'ForensicBundle.precisionRefs')),gatherRef:gatherRef===null?null:req(gatherRef,'ForensicBundle.gatherRef'),transactionRefs:uniqStable(strings(transactionRefs,'ForensicBundle.transactionRefs')),settlementRefs:uniq(strings(settlementRefs,'ForensicBundle.settlementRefs')),promptPlanRef:promptPlanRef===null?null:req(promptPlanRef,'ForensicBundle.promptPlanRef'),contextSealRef:contextSealRef===null?null:req(contextSealRef,'ForensicBundle.contextSealRef'),lateResultRefs:uniq(strings(lateResultRefs,'ForensicBundle.lateResultRefs')),staleResultRefs:uniq(strings(staleResultRefs,'ForensicBundle.staleResultRefs')),diagnosticRefs:uniq(strings(diagnosticRefs,'ForensicBundle.diagnosticRefs')),assemblyProvenanceRefs:uniq(strings(assemblyProvenanceRefs,'ForensicBundle.assemblyProvenanceRefs')),reconstructionReceipt:clone(reconstructionReceipt),complete:Boolean(complete)};
}

export class ForensicBundleStore{
  #bundles=new Map();#sequence=0;
  create(input){const bundleId=input.bundleId??`forensic-bundle:${++this.#sequence}:${input.turnId}`;const bundle=createForensicBundle({...input,bundleId});if(this.#bundles.has(bundleId))throw new Error(`Forensic bundle already exists: ${bundleId}`);this.#bundles.set(bundleId,structuredClone(bundle));return clone(bundle);}
  get(bundleId){const x=this.#bundles.get(bundleId);return x?clone(x):null;}
  list({turnId=null,generationId=null}={}){return[...this.#bundles.values()].filter(x=>(!turnId||x.turnId===turnId)&&(!generationId||x.generationId===generationId)).map(clone);}
}
