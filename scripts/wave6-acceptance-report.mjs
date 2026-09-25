import {runWave6Acceptance} from '../tests/wave6-integration-harness.js';
const r=runWave6Acceptance();
for(const [name,pass] of Object.entries(r.metrics))console.log((pass?'PASS':'FAIL')+' '+name);
console.log('Wave 6 acceptance: '+Object.values(r.metrics).filter(Boolean).length+'/'+Object.values(r.metrics).length);
console.log('Contract matrix: '+JSON.stringify(r.matrix.counts));
for(const pair of [...new Set(r.matrix.rows.map(x=>x.pair))]){
  const rows=r.matrix.rows.filter(x=>x.pair===pair);
  const counts=Object.fromEntries(['COMPATIBLE','PARTIAL','BLOCKED_ON_OTHER_LANE','MISMATCH'].map(s=>[s,rows.filter(x=>x.status===s).length]));
  console.log('CONTRACT_PAIR '+pair+' '+JSON.stringify(counts));
}
console.log('Drift matrix: '+JSON.stringify(r.drift.counts));
for(const report of r.drift.reports)console.log('DRIFT '+report.lane+' '+report.status+' '+report.acceptedCheckpoint+' -> '+report.currentCheckpoint);
console.log('FT002: '+r.ft002.summary.status+' / LIVE SILLYTAVERN PENDING');
console.log('FT005: '+r.ft005.summary.status+' / LIVE PROVIDER EXECUTION PENDING');
for(const row of r.blockers.rows)console.log('FT_BLOCKER '+row.test+' '+row.state+' '+JSON.stringify(Object.fromEntries(row.components.map(x=>[x.name,x.state]))));
console.log('Nexus live seam: '+r.nexusStatus.implementation+' / '+r.nexusStatus.runtimeConnection);
for(const [lane,lock] of Object.entries(r.checkpointLocks))console.log('CHECKPOINT_LOCK '+lane+' '+JSON.stringify(lock));
for(const [action,count] of Object.entries(r.assembly.plan.steps.reduce((m,x)=>(m[x.action]=(m[x.action]??0)+1,m),{})))console.log('ASSEMBLY_ACTION '+action+' '+count);
for(const m of r.performance.measurements)console.log('PERF '+m.stage+' '+m.state+' '+(m.latencyMs==null?'null':m.latencyMs.toFixed(6))+'ms');
console.log('Phase 1 gate V2: '+r.gate.state);
if(!r.pass)process.exitCode=1;
