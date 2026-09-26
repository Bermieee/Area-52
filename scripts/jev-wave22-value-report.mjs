import { mkdir, writeFile } from 'node:fs/promises';
import { evaluateWave22JevValue } from '../evaluation/jev-wave22-value-evaluator.mjs';

const report=await evaluateWave22JevValue();
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/jev-wave22-value-report.json',JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify(report,null,2));
