import {utf8ByteLength,stableHash} from './browser-runtime-utils.js';
const clone=(v)=>structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean))].sort();
export const ShadowMeasurementState=Object.freeze({MEASURED:'MEASURED',REPLAYED:'REPLAYED',NOT_MEASURED:'NOT_MEASURED',NOT_APPLICABLE:'NOT_APPLICABLE'});
const states=new Set(Object.values(ShadowMeasurementState));
const metric=(state,value=null,evidenceRefs=[])=>({state,value:state===ShadowMeasurementState.NOT_MEASURED||state===ShadowMeasurementState.NOT_APPLICABLE?null:value,evidenceRefs:uniq(evidenceRefs)});
const factKey=(f)=>JSON.stringify([f.subjectId??f.e,f.predicate??f.p,f.value??f.v,f.status??f.t?.[2]??null]);
function expectedSet(rows){return new Set((rows??[]).map(factKey));}
function measuredRatio(hit,total){return total===0?metric(ShadowMeasurementState.NOT_APPLICABLE,null):metric(ShadowMeasurementState.MEASURED,Number((hit/total).toFixed(6)));}
function candidateFacts(c){return[...(c.facts??c.current??[]),...(c.historical??[]),...(c.unresolved??[])];}
function scoreCandidate(candidate,truth){
  const facts=candidateFacts(candidate),keys=new Set(facts.map(factKey)),relevant=expectedSet(truth.relevantFacts),continuity=expectedSet(truth.continuityFacts),current=expectedSet(truth.currentFacts),historical=expectedSet(truth.historicalFacts),actualCurrent=new Set((candidate.current??[]).map(factKey)),actualHistorical=new Set((candidate.historical??[]).map(factKey));
  const unresolvedExpected=new Set(truth.unresolvedThreadIds??[]),unresolvedActual=new Set((candidate.unresolvedThreads??candidate.activeThreads??[]).map(x=>x.threadId??x.id??String(x)));
  const activeSources=new Set(truth.activeSourceRevisionRefs??[]),candidateSources=uniq(candidate.sourceRevisionRefs??candidate.dependencies??[]);
  const expectedProv=new Set(truth.requiredProvenanceRefs??[]),actualProv=new Set(candidate.provenanceRefs??Object.values(candidate.provenanceIndex??{}).flat());
  const expectedAll=new Set([...relevant,...continuity,...current,...historical]);
  const relevance=relevant.size?measuredRatio([...relevant].filter(x=>keys.has(x)).length,relevant.size):metric(ShadowMeasurementState.NOT_MEASURED);
  const missingContinuity=continuity.size?metric(ShadowMeasurementState.MEASURED,[...continuity].filter(x=>!keys.has(x)).length,truth.evaluationRefs):metric(ShadowMeasurementState.NOT_MEASURED);
  const currentUnion=new Set([...current,...actualCurrent]),historicalUnion=new Set([...historical,...actualHistorical]);
  const currentCorrect=current.size?measuredRatio([...current].filter(x=>actualCurrent.has(x)).length,currentUnion.size):metric(ShadowMeasurementState.NOT_MEASURED);
  const historicalCorrect=historical.size?measuredRatio([...historical].filter(x=>actualHistorical.has(x)).length,historicalUnion.size):metric(ShadowMeasurementState.NOT_MEASURED);
  const unresolvedCoverage=unresolvedExpected.size?measuredRatio([...unresolvedExpected].filter(x=>unresolvedActual.has(x)).length,unresolvedExpected.size):metric(ShadowMeasurementState.NOT_MEASURED);
  const provenanceCoverage=expectedProv.size?measuredRatio([...expectedProv].filter(x=>actualProv.has(x)).length,expectedProv.size):metric(ShadowMeasurementState.NOT_MEASURED);
  const staleFacts=activeSources.size?metric(ShadowMeasurementState.MEASURED,candidateSources.filter(x=>!activeSources.has(x)).length,truth.evaluationRefs):metric(ShadowMeasurementState.NOT_MEASURED);
  const unnecessaryContext=expectedAll.size?metric(ShadowMeasurementState.MEASURED,facts.filter(x=>!expectedAll.has(factKey(x))).length,truth.evaluationRefs):metric(ShadowMeasurementState.NOT_MEASURED);
  const size=metric(ShadowMeasurementState.MEASURED,utf8ByteLength(JSON.stringify(candidate.payload??candidate)),candidate.evidenceRefs);
  const latency=candidate.latencyMs!==null&&candidate.latencyMs!==undefined&&Number.isFinite(Number(candidate.latencyMs))?metric(ShadowMeasurementState.MEASURED,Number(candidate.latencyMs),candidate.evidenceRefs):metric(ShadowMeasurementState.NOT_MEASURED);
  const expectedNext=new Set(truth.nextBeatRefs??[]),actualNext=new Set(candidate.nextBeatRefs??[]);
  const nextBeat=expectedNext.size?measuredRatio([...expectedNext].filter(x=>actualNext.has(x)).length,expectedNext.size):metric(ShadowMeasurementState.NOT_MEASURED);
  return{relevance,staleFacts,missingContinuity,currentStateCorrectness:currentCorrect,historicalStateCorrectness:historicalCorrect,unresolvedThreadCoverage:unresolvedCoverage,provenanceCoverage,unnecessaryContext,byteSize:size,latencyMs:latency,nextBeatUsefulness:nextBeat};
}
export function createShadowContextCandidate({candidateId,system,turnId,generationId,payload={},facts=[],current=[],historical=[],unresolved=[],unresolvedThreads=[],sourceRevisionRefs=[],provenanceRefs=[],provenanceIndex={},latencyMs=null,nextBeatRefs=[],evidenceRefs=[]}={}){
  if(!candidateId||!system||!turnId)throw new TypeError('Shadow candidate requires candidateId, system, and turnId');
  return{kind:'ShadowContextCandidate',candidateId:String(candidateId),system:String(system),turnId:String(turnId),generationId:generationId??null,payload:clone(payload),facts:clone(facts),current:clone(current),historical:clone(historical),unresolved:clone(unresolved),unresolvedThreads:clone(unresolvedThreads),sourceRevisionRefs:uniq(sourceRevisionRefs),provenanceRefs:uniq(provenanceRefs),provenanceIndex:clone(provenanceIndex),latencyMs:latencyMs===null?null:Number(latencyMs),nextBeatRefs:uniq(nextBeatRefs),evidenceRefs:uniq(evidenceRefs),authority:'EVALUATION_ONLY',affectsGeneration:false};
}
export function compareShadowContexts({turnId,generationId=null,nexus,area52,groundTruth={},comparisonId=null,measurementState=ShadowMeasurementState.MEASURED}={}){
  if(!states.has(measurementState))throw new TypeError('invalid shadow measurement state');if(!nexus||!area52)throw new TypeError('both Nexus and Area-52 candidates are required');
  const id=comparisonId??`shadow:${stableHash(JSON.stringify([turnId,generationId,nexus.candidateId,area52.candidateId]),{length:20,alreadyString:true})}`;
  const normalizeState=(metrics)=>measurementState===ShadowMeasurementState.MEASURED?metrics:Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,{...v,state:measurementState,value:measurementState===ShadowMeasurementState.REPLAYED?v.value:null}]));
  return{kind:'ShadowComparisonReceipt',comparisonId:id,turnId:String(turnId),generationId:generationId??null,nexusCandidateId:nexus.candidateId,area52CandidateId:area52.candidateId,measurementState,nexusMetrics:normalizeState(scoreCandidate(nexus,groundTruth)),area52Metrics:normalizeState(scoreCandidate(area52,groundTruth)),evaluationRefs:uniq(groundTruth.evaluationRefs),winner:null,authority:'EVALUATION_ONLY',affectsGeneration:false,rule:'Per-metric evidence only; incomplete measurements never produce an automatic winner.'};
}
export function exportShadowReplay(receipt){return{kind:'ShadowComparisonReplay',schemaVersion:'1',receipt:clone(receipt)};}
export function importShadowReplay(input){if(input?.kind!=='ShadowComparisonReplay'||input?.schemaVersion!=='1'||input?.receipt?.kind!=='ShadowComparisonReceipt')throw new TypeError('invalid ShadowComparisonReplay');const out=clone(input.receipt);out.measurementState=ShadowMeasurementState.REPLAYED;for(const side of ['nexusMetrics','area52Metrics'])for(const m of Object.values(out[side]??{}))if(m.state===ShadowMeasurementState.MEASURED)m.state=ShadowMeasurementState.REPLAYED;return out;}
