import {runKnowledgeWave5Acceptance} from '../tests/knowledge-wave5-harness.js';
const r=runKnowledgeWave5Acceptance();
for(const [name,pass] of Object.entries(r.metrics))console.log((pass?'PASS':'FAIL')+' '+name);
console.log('Knowledge Integration Wave 5 acceptance: '+Object.values(r.metrics).filter(Boolean).length+'/'+Object.values(r.metrics).length);
console.log('FT003 status: '+r.fixture.ft003.statusLabel);
console.log('FT004 status: '+r.fixture.ft004.statusLabel);
console.log('Nexus shadow: '+r.shadowStatus.replay+' / '+r.shadowStatus.live);
if(!r.pass)process.exitCode=1;
