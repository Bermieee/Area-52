import {runFt002Wave10NativeSceneAcceptance} from '../tests/ft002-wave10-native-scene-harness.js';
const r=await runFt002Wave10NativeSceneAcceptance();
for(const [name,pass] of Object.entries(r.metrics))console.log((pass?'PASS':'FAIL')+' '+name);
console.log('Wave 10 native Scene/Core FT002 acceptance: '+Object.values(r.metrics).filter(Boolean).length+'/'+Object.values(r.metrics).length);
console.log('Scene reference: '+r.sceneCheckpoint);
if(!r.pass)process.exitCode=1;
