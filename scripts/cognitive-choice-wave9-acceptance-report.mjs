import {runCognitiveChoiceWave9Acceptance} from '../tests/cognitive-choice-wave9-harness.js';
const r=runCognitiveChoiceWave9Acceptance();
for(const [name,pass] of Object.entries(r.metrics))console.log((pass?'PASS':'FAIL')+' '+name);
console.log('Wave 9 Cognitive Choice acceptance: '+Object.values(r.metrics).filter(Boolean).length+'/'+Object.values(r.metrics).length);
console.log('hot paths: '+JSON.stringify(r.hot.cognitiveChoiceReceipt.paths));
console.log('high candidates: '+JSON.stringify(r.high.cognitiveChoiceReceipt.candidateCounts));
console.log('mixed correction: '+JSON.stringify(r.mixed.cognitiveChoiceReceipt.correctiveRetrieval));
console.log('mixed Jev: '+JSON.stringify(r.mixed.cognitiveChoiceReceipt.jev));
if(!r.pass)process.exitCode=1;
