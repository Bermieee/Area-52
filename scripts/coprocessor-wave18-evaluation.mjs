import { mkdir, writeFile } from 'node:fs/promises';
import { evaluateCoprocessorWave18 } from '../evaluation/coprocessor-wave18-evaluator.mjs';

const report=await evaluateCoprocessorWave18();
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/coprocessor-wave18-evaluation.json',JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify(report,null,2));
