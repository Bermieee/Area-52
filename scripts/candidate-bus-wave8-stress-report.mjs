import {runWave8Stress} from '../tests/candidate-bus-wave8-stress-harness.js';
const r=runWave8Stress();
for(const [name,count] of Object.entries(r.counts))console.log(name+': '+count);
for(const [name,pass] of Object.entries(r.invariants))console.log((pass?'PASS':'FAIL')+' '+name);
for(const [name,value] of Object.entries(r.metrics))console.log('METRIC '+name+': '+JSON.stringify(value));
console.log('Wave 8 stress total pressure units: '+Object.values(r.counts).reduce((a,b)=>a+b,0));
if(!r.pass)process.exitCode=1;
