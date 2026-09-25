import {runIntegrationWave4Stress} from '../tests/integration-wave4-stress-harness.js';
const r=runIntegrationWave4Stress();console.log(JSON.stringify(r.metrics,null,2));console.log(`Integration Wave 4 stress: ${r.pass?'PASS':'FAIL'}`);if(!r.pass)process.exitCode=1;
