import fs from 'node:fs/promises';
import {runWave16ResourceJevEvaluation} from '../evaluation/resource-jev-wave16-evaluator.mjs';
const report=await runWave16ResourceJevEvaluation();
const dir=new URL('../artifacts/resource-jev-wave16/',import.meta.url);
await fs.mkdir(dir,{recursive:true});
await fs.writeFile(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
