import {runWave6Stress} from '../tests/wave6-integration-stress-harness.js';
const r=runWave6Stress();
for(const [name,count] of Object.entries(r.counts))console.log(name+': '+count);
for(const [name,pass] of Object.entries(r.invariants))console.log((pass?'PASS':'FAIL')+' '+name);
console.log('Wave 6 stress total: '+r.total);
if(!r.pass)process.exitCode=1;
