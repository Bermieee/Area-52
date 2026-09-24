import {stableJson} from './browser-runtime-utils.js';
import {DependencyReadiness} from './dependency-readiness.js';
import {ShadowMeasurementState} from './shadow-context-scorer.js';
const clone=(v)=>structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean))].sort();
const setEq=(a,b)=>a.size===b.size&&[...a].every(x=>b.has(x));
const factKey=(f)=>JSON.stringify([f.e??f.subjectId,f.p??f.predicate,f.v??f.value,f.status??f.t?.[2]??null]);
export const CorePreflightState=Object.freeze({READY:'CORE_SIDE_READY',PARTIAL:'PARTIAL',BLOCKED:'BLOCKED'});

export function evaluateFt002CorePreflight({sceneSignal,sceneEvent,currentSceneRevision,staleSceneEvent=null,staleSceneResultRoute=null,sealReceipt,packet,ft001Expected={}}={}){
  const checks={};
  checks.sceneRevisionSurvives=Number(sceneSignal?.sceneRevision)===Number(sceneEvent?.sceneRevision)&&Number(sealReceipt?.sceneRevision)===Number(currentSceneRevision);
  const sceneSources=new Set(sceneSignal?.sourceRevisionRefs??sceneSignal?.sourceRevisionSet??[]),sealSources=new Set(sealReceipt?.sourceRevisionIds??[]);
  checks.sourceRevisionRefsSurvive=[...sceneSources].every(x=>sealSources.has(x));
  const active=(sceneSignal?.activeCast??[]),observed=(sceneSignal?.castObservations??[]);
  checks.activeCastOnlyPresent=active.every(x=>typeof x==='string'||x?.state==='PRESENT'||x?.presence==='PRESENT');
  const mentioned=observed.filter(x=>x?.state==='MENTIONED_ONLY'||x?.presence==='MENTIONED_ONLY').map(x=>x.characterId??x.id);
  const activeIds=new Set(active.map(x=>typeof x==='string'?x:x.characterId??x.id));checks.mentionedOnlyExcluded=mentioned.every(id=>!activeIds.has(id));
  checks.flashbackPreservedAsHistorical=!['FLASHBACK_OF','FLASHBACK'].includes(sceneSignal?.sceneRelationship)||!(sceneSignal?.flashbackCurrentFactIds??[]).some(id=>(packet?.current??[]).some(f=>f.id===id));
  checks.parallelDoesNotImplyLater=!['PARALLEL_TO','PARALLEL'].includes(sceneSignal?.sceneRelationship)||sceneSignal?.chronologyAssumption==null;
  const stale=staleSceneEvent&&Number(staleSceneEvent.sceneRevision)<Number(currentSceneRevision);checks.staleSceneExcluded=!stale||(staleSceneResultRoute?.freshness==='STALE'&&!(sealReceipt?.admittedResultIds??[]).includes(staleSceneResultRoute?.resultId??staleSceneEvent?.eventId));
  const expectedCurrent=new Set((ft001Expected.currentFacts??[]).map(factKey)),actualCurrent=new Set((packet?.current??[]).map(factKey)),expectedHistorical=new Set((ft001Expected.historicalFacts??[]).map(factKey)),actualHistorical=new Set((packet?.historical??[]).map(factKey)),expectedUnresolved=new Set((ft001Expected.unresolvedFacts??[]).map(factKey)),actualUnresolved=new Set((packet?.unresolved??[]).map(factKey));
  checks.ft001CurrentInvariant=[...expectedCurrent].every(x=>actualCurrent.has(x));checks.ft001HistoricalInvariant=[...expectedHistorical].every(x=>actualHistorical.has(x));checks.ft001UnresolvedInvariant=[...expectedUnresolved].every(x=>actualUnresolved.has(x));
  const pass=Object.values(checks).every(Boolean);return{kind:'FT002CorePreflightReceipt',state:pass?CorePreflightState.READY:CorePreflightState.BLOCKED,checks,sceneRef:sceneSignal?{sceneId:sceneSignal.sceneId,sceneRevision:sceneSignal.sceneRevision}:null,sealRef:sealReceipt?.id??null,liveAcceptance:false};
}
export function evaluateFt005CorePreflight({providerValidations=[],malformedValidation=null,semanticInvalidValidation=null,unavailableReadiness=null,lateRoute=null,sealReceipt=null,requiredFallback={bounded:false,attempts:null,maxAttempts:null}}={}){
  const normalized=providerValidations.filter(x=>x?.canonicalReady).map(x=>stableJson(x.normalized));
  const checks={
    providerInterchangeable:normalized.length>=2&&new Set(normalized).size===1,
    providerIdentityNonAuthoritative:providerValidations.every(x=>x?.normalized&&!('providerId'in x.normalized)&&!('provider'in x.normalized)),
    malformedRejected:malformedValidation?.canonicalReady===false&&Boolean(malformedValidation?.failure?.code),
    semanticInvalidRejected:semanticInvalidValidation?.canonicalReady===false&&semanticInvalidValidation?.stage==='SEMANTIC',
    outageDegrades:unavailableReadiness?.state===DependencyReadiness.DEGRADED,
    lateOpportunisticContained:Boolean(lateRoute?.late)&&lateRoute?.effectiveDestination!=='FOREGROUND'&&!(sealReceipt?.admittedResultIds??[]).includes(lateRoute?.resultId),
    requiredFallbackBounded:Boolean(requiredFallback.bounded)&&Number(requiredFallback.attempts)<=Number(requiredFallback.maxAttempts),
  };
  const pass=Object.values(checks).every(Boolean);return{kind:'FT005CorePreflightReceipt',state:pass?CorePreflightState.READY:CorePreflightState.BLOCKED,checks,liveProviderAcceptance:false};
}

export const RepresentativeWorkloadMetric=Object.freeze({
 CURRENT_STATE_ERRORS:'currentStateErrors',HISTORICAL_STATE_ERRORS:'historicalStateErrors',CONTRADICTION_ERRORS:'contradictionErrors',STALE_ADMISSION:'staleAdmission',
 MISSED_RELEVANT_CONTEXT:'missedRelevantContext',UNNECESSARY_CONTEXT:'unnecessaryContext',UNRESOLVED_THREAD_MISSES:'unresolvedThreadMisses',PROVENANCE_COMPLETENESS:'provenanceCompleteness',
 CALLBACK_CONTINUITY:'callbackContinuityQuality',CHARACTER_CONSISTENCY:'characterConsistencyEvidence',LATENCY_MS:'latencyMs',TOKEN_BYTES:'tokenByteSize',WORKER_FANOUT:'workerFanOut',
 WARM_CACHE_REUSE:'warmCacheReuse',OPERATOR_CORRECTIONS:'operatorCorrections',
});
export class RepresentativeWorkloadHarness{
  #turns=[];
  constructor({workloadId='ft006-replay'}={}){this.workloadId=workloadId;}
  recordTurn({turnId,sceneId=null,generationId=null,metrics={},evidenceRefs=[],events=[]}={}){
    if(!turnId)throw new TypeError('turnId required');const normalized={};
    for(const name of Object.values(RepresentativeWorkloadMetric)){const m=metrics[name]??{state:ShadowMeasurementState.NOT_MEASURED,value:null};if(!Object.values(ShadowMeasurementState).includes(m.state))throw new TypeError(`invalid measurement state for ${name}`);normalized[name]={state:m.state,value:[ShadowMeasurementState.NOT_MEASURED,ShadowMeasurementState.NOT_APPLICABLE].includes(m.state)?null:clone(m.value),evidenceRefs:uniq(m.evidenceRefs)};}
    const row={kind:'RepresentativeWorkloadTurn',turnId:String(turnId),sceneId,generationId,metrics:normalized,evidenceRefs:uniq(evidenceRefs),events:clone(events)};this.#turns.push(row);return clone(row);
  }
  report(){const rows=clone(this.#turns),counts={turns:rows.length,measured:0,replayed:0,notMeasured:0,notApplicable:0};for(const row of rows)for(const m of Object.values(row.metrics)){if(m.state==='MEASURED')counts.measured++;else if(m.state==='REPLAYED')counts.replayed++;else if(m.state==='NOT_MEASURED')counts.notMeasured++;else counts.notApplicable++;}return{kind:'RepresentativeWorkloadReport',schemaVersion:'1',workloadId:this.workloadId,turns:rows,counts,aggregateScore:null,liveQualification:false,rule:'Metrics remain separate; missing or qualitative evidence is never collapsed into an arbitrary scalar.'};}
}
