export const JEV_VALUE_BENCHMARK_VERSION='1.0.0';

export function summarizeJevValueBenchmark({cases=[]}={}){
  const rows=(Array.isArray(cases)?cases:[]).map(normalizeCase);
  const deterministic=rows.map(row=>row.deterministic);
  const assisted=rows.map(row=>row.jev);
  return freeze({
    kind:'JevValueBenchmarkSummary',contractVersion:JEV_VALUE_BENCHMARK_VERSION,
    caseCount:rows.length,
    deterministicOnly:aggregate(deterministic),
    jevAssisted:aggregate(assisted),
    delta:{
      correctness:ratio(assisted,'correct')-ratio(deterministic,'correct'),
      abstention:ratio(assisted,'abstained')-ratio(deterministic,'abstained'),
      falseCertainty:ratio(assisted,'falseCertain')-ratio(deterministic,'falseCertain'),
      averageLatencyMs:average(assisted,'latencyMs')-average(deterministic,'latencyMs'),
      estimatedCostUnits:sum(assisted,'costUnits')-sum(deterministic,'costUnits'),
    },
    physicalProviderExecutions:rows.filter(row=>row.measurementClass==='MEASURED_LIVE'&&row.physicalProviderExecution).length,
    fixtureExecutions:rows.filter(row=>row.measurementClass!=='MEASURED_LIVE').length,
    rows,
  });
}

function normalizeCase(row={}){
  return freeze({
    caseId:String(row.caseId??'case'),
    measurementClass:String(row.measurementClass??'LOCAL_DETERMINISTIC'),
    physicalProviderExecution:Boolean(row.physicalProviderExecution),
    deterministic:normalizeOutcome(row.deterministic),
    jev:normalizeOutcome(row.jev),
  });
}
function normalizeOutcome(value={}){
  return freeze({
    correct:Boolean(value.correct),
    abstained:Boolean(value.abstained),
    falseCertain:Boolean(value.falseCertain),
    latencyMs:finite(value.latencyMs),
    costUnits:finite(value.costUnits),
  });
}
function aggregate(rows){
  return freeze({
    correctness:ratio(rows,'correct'),
    abstention:ratio(rows,'abstained'),
    falseCertainty:ratio(rows,'falseCertain'),
    averageLatencyMs:average(rows,'latencyMs'),
    totalCostUnits:sum(rows,'costUnits'),
  });
}
function ratio(rows,key){return rows.length?rows.filter(row=>row[key]).length/rows.length:0;}
function average(rows,key){return rows.length?sum(rows,key)/rows.length:0;}
function sum(rows,key){return rows.reduce((n,row)=>n+Number(row[key]??0),0);}
function finite(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,n):0;}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
