import {runKnowledgeWave5Stress} from '../tests/knowledge-wave5-stress-harness.js';
const r=runKnowledgeWave5Stress();
for(const [name,count] of Object.entries(r.counts))console.log(name+': '+count);
for(const [name,pass] of Object.entries(r.invariants))console.log((pass?'PASS':'FAIL')+' '+name);
console.log('Wave 5 stress total: '+r.total);
if(!r.pass)process.exitCode=1;
