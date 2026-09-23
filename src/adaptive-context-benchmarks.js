import { performance } from 'node:perf_hooks';
import { deliveryHash } from './adaptive-context-contracts.js';

const pct=(n,d)=>d?Number((n/d).toFixed(6)):1;
const semanticKey=(entry)=>entry.semanticKey;

export function semanticManifestSet(delivery){
  return new Set((delivery?.plan?.segments??[]).flatMap(s=>s.semanticManifest??[]).map(semanticKey));
}

export function benchmarkAdaptiveDelivery({delivery,requiredSemanticKeys=[],costEstimator=null,elapsedMs=null}){
  const plan=delivery?.plan??null,segments=plan?.segments??[];
  const actual=semanticManifestSet(delivery),required=new Set(requiredSemanticKeys);
  const retained=[...required].filter(x=>actual.has(x)).length;
  const reused=segments.filter(s=>s.reuseState==='NO_CHANGE').length;
  const rebuilt=segments.filter(s=>s.reuseState==='REBUILD').length;
  const cacheEligible=segments.filter(s=>s.cacheEligible).length;
  const historical=(plan?.sections??[]).filter(s=>s.slot==='HISTORICAL_SUPPORT').flatMap(s=>s.semanticManifest??[]);
  const unresolved=(plan?.sections??[]).filter(s=>s.slot==='UNRESOLVED_EVIDENCE').flatMap(s=>s.semanticManifest??[]);
  const current=(plan?.sections??[]).filter(s=>s.slot==='CURRENT_WORLD_STATE'||s.slot==='CURRENT_CHARACTER_STATE').flatMap(s=>s.semanticManifest??[]);
  const temporalRetention=historical.every(x=>x.temporalStatus&&x.temporalStatus!=='CURRENT')?1:0;
  const unresolvedRetention=unresolved.every(x=>x.temporalStatus&&x.temporalStatus!=='CURRENT')?1:0;
  const currentStateRetention=current.every(x=>x.temporalStatus==='CURRENT')?1:0;
  const renderedSize=delivery?.rendered?Buffer.byteLength(JSON.stringify(delivery.rendered),'utf8'):0;
  const allocatedSize=plan?.budget?.allocated??0;
  const costEstimate=typeof costEstimator==='function'?costEstimator({allocatedTokens:allocatedSize,renderedBytes:renderedSize,profileId:plan?.modelProfileId??null}):null;
  return{
    kind:'AdaptiveContextRuntimeBenchmark',ok:Boolean(delivery?.ok),semanticRetention:pct(retained,required.size),currentStateRetention,temporalQualifierRetention:temporalRetention,
    unresolvedRetention,contradictionRetention:unresolvedRetention,provenanceReferenceRetention:delivery?.integrityReceipt?.revisionChecks?.passed?1:0,
    allocatedSize,renderedSize,reusePercentage:pct(reused,segments.length),rebuildPercentage:pct(rebuilt,segments.length),cacheEligiblePercentage:pct(cacheEligible,segments.length),
    deliveryLatencyMs:elapsedMs,fallbackUse:(plan?.fallbackDecisions??[]).length,integrityFailures:delivery?.integrityReceipt?.violations?.length??(delivery?.ok?0:1),costEstimate,
    pass:Boolean(delivery?.ok)&&pct(retained,required.size)===1&&currentStateRetention===1&&temporalRetention===1&&unresolvedRetention===1&&(delivery?.integrityReceipt?.valid??false),
  };
}

export function compareProfileDeliveries(deliveries=[]){
  const rows=deliveries.map(delivery=>({
    profileId:delivery?.plan?.modelProfileId??null,planId:delivery?.plan?.promptPlanId??null,segmentCount:delivery?.plan?.segments?.length??0,
    ordering:delivery?.plan?.ordering??[],semanticHash:deliveryHash([...(semanticManifestSet(delivery))].sort()),renderedHash:delivery?.rendered?deliveryHash(delivery.rendered):null,
  }));
  return{kind:'AdaptiveContextProfileComparison',rows,semanticEquivalent:rows.length<2||rows.every(x=>x.semanticHash===rows[0].semanticHash),presentationDiffers:rows.length>1&&new Set(rows.map(x=>x.renderedHash)).size>1};
}

export function timedDelivery(runtime,input){
  const start=performance.now(),delivery=runtime.deliver(input),elapsedMs=performance.now()-start;
  return{delivery,elapsedMs};
}
