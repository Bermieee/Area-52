import {runCognitiveAuditStress} from '../tests/cognitive-audit-stress-harness.js';
const r=runCognitiveAuditStress();console.log(JSON.stringify(r.metrics,null,2));console.log(`Cognitive Audit stress: ${r.pass?'PASS':'FAIL'}`);if(!r.pass)process.exitCode=1;
