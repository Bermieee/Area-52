import {runIntegrationWave4Acceptance} from '../tests/integration-wave4-harness.js';
const r=runIntegrationWave4Acceptance();for(const [name,pass] of Object.entries(r.metrics))console.log(`${pass?'PASS':'FAIL'} ${name}`);console.log(`Integration Wave 4 acceptance: ${Object.values(r.metrics).filter(Boolean).length}/${Object.values(r.metrics).length}`);if(!r.pass)process.exitCode=1;
