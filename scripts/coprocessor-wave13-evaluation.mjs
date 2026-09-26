import fs from 'node:fs/promises';
import {runCoprocessorWave13Evaluation} from '../evaluation/coprocessor-wave13-evaluator.mjs';

const report=await runCoprocessorWave13Evaluation();
const dir=new URL('../artifacts/jev-wave13/',import.meta.url);
await fs.mkdir(dir,{recursive:true});
await fs.writeFile(new URL('cognitive-choice-evaluation.json',dir),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify(report,null,2));
