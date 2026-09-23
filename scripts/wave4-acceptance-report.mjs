import { runWave4AdaptiveContextGoldenWorld } from '../tests/wave4-golden-harness.js';

const scored=runWave4AdaptiveContextGoldenWorld();
const rows=Object.entries(scored.metrics).map(([name,pass])=>({name,pass:Boolean(pass)}));
for(const row of rows)console.log(`${row.pass?'PASS':'FAIL'} ${row.name}`);
console.log(`Wave 4 acceptance: ${rows.filter(x=>x.pass).length}/${rows.length}`);
if(!scored.pass)process.exitCode=1;
