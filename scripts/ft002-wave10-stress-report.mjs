import {runFt002Wave10NativeSceneStress} from '../tests/ft002-wave10-native-scene-stress-harness.js';
const r=await runFt002Wave10NativeSceneStress();
for(const [name,count] of Object.entries(r.counts))console.log(name+': '+count);
for(const [name,pass] of Object.entries(r.invariants))console.log((pass?'PASS':'FAIL')+' '+name);
if(r.failures.length)for(const failure of r.failures)console.log('FAILURE '+failure);
console.log('Wave 10 native Scene/Core stress pressure units: '+Object.values(r.counts).reduce((a,b)=>a+b,0));
if(!r.pass)process.exitCode=1;
