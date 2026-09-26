export function summarizeJevUsefulnessCorpus({cases=[],measurementClass='LOCAL_DETERMINISTIC',falseCertaintyThreshold=.75}={}){
  const rows=(cases??[]).map((row,index)=>normalizeCase(row,index,falseCertaintyThreshold));
  const deterministic=summary(rows.map(row=>row.deterministic),falseCertaintyThreshold);
  const assisted=summary(rows.map(row=>row.jevAssisted),falseCertaintyThreshold);
  const live=String(measurementClass).toUpperCase()==='MEASURED_LIVE';
  const physicalExecutions=rows.filter(row=>row.jevAssisted.physicalExecution).length;
  const measuredCosts=rows.map(row=>row.jevAssisted.cost).filter(Number.isFinite);
  return freeze({
    kind:'JevUsefulnessBenchmark',contractVersion:'1.0.0',measurementClass:String(measurementClass),
    caseCount:rows.length,deterministic,jevAssisted:assisted,
    delta:freeze({
      correctnessRate:assisted.correctnessRate-deterministic.correctnessRate,
      abstentionRate:assisted.abstentionRate-deterministic.abstentionRate,
      falseCertaintyRate:assisted.falseCertaintyRate-deterministic.falseCertaintyRate,
      meanLatencyMs:assisted.meanLatencyMs-deterministic.meanLatencyMs,
    }),
    physicalProviderExecutions:physicalExecutions,
    fixtureExecutions:live?0:physicalExecutions,
    liveProviderExecutions:live?physicalExecutions:0,
    cost:live&&measuredCosts.length?freeze({status:'MEASURED',total:sum(measuredCosts),mean:sum(measuredCosts)/measuredCosts.length}):freeze({status:'NOT_MEASURED',total:null,mean:null}),
    ownerAcceptanceRate:rate(rows,x=>x.jevAssisted.ownerAccepted===true),
    authorityViolations:rows.filter(row=>row.jevAssisted.authorityViolation).length,
    rows:rows.map(row=>freeze({id:row.id,ambiguous:row.ambiguous,deterministic:row.deterministic,jevAssisted:row.jevAssisted})),
    claimBoundary:live?'Provider latency/cost may be reported only for authenticated measured executions in this corpus.':'Deterministic/fixture evidence; no live-provider latency or cost claim.',
  });
}

function normalizeCase(row,index,threshold){
  const normalize=(value={})=>freeze({
    correct:Boolean(value.correct),abstained:Boolean(value.abstained),confidence:unit(value.confidence),
    falseCertain:Boolean(!value.correct&&!value.abstained&&unit(value.confidence)>=threshold),
    latencyMs:nonneg(value.latencyMs),cost:Number.isFinite(Number(value.cost))?Number(value.cost):null,
    physicalExecution:Boolean(value.physicalExecution),ownerAccepted:value.ownerAccepted==null?null:Boolean(value.ownerAccepted),
    authorityViolation:Boolean(value.authorityViolation),outcome:value.outcome==null?null:String(value.outcome).slice(0,128),
  });
  return freeze({id:String(row.id??('case-'+index)),ambiguous:Boolean(row.ambiguous),deterministic:normalize(row.deterministic),jevAssisted:normalize(row.jevAssisted)});
}
function summary(rows){
  return freeze({
    correctnessRate:rate(rows,x=>x.correct),abstentionRate:rate(rows,x=>x.abstained),falseCertaintyRate:rate(rows,x=>x.falseCertain),
    meanLatencyMs:rows.length?sum(rows.map(x=>x.latencyMs))/rows.length:0,p95LatencyMs:percentile(rows.map(x=>x.latencyMs),.95),
  });
}
function rate(rows,predicate){return rows.length?rows.filter(predicate).length/rows.length:0;}
function percentile(values,p){if(!values.length)return 0;const rows=[...values].sort((a,b)=>a-b);return rows[Math.min(rows.length-1,Math.max(0,Math.ceil(rows.length*p)-1))];}
function sum(values){return values.reduce((a,b)=>a+b,0);}function nonneg(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,n):0;}
function unit(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
