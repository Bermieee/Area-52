import {runCognitiveChoiceWave9Stress} from '../tests/cognitive-choice-wave9-stress-harness.js';
const r=runCognitiveChoiceWave9Stress();
for(const [name,count] of Object.entries(r.counts))console.log(name+': '+count);
for(const [name,pass] of Object.entries(r.invariants))console.log((pass?'PASS':'FAIL')+' '+name);
if(r.failures.length)for(const failure of r.failures)console.log('FAILURE '+failure);
console.log('Wave 9 stress pressure units: '+Object.values(r.counts).reduce((a,b)=>a+b,0));
if(!r.pass)process.exitCode=1;
