import fs from 'node:fs/promises';
import {runResourceConnectionWave14Evaluation} from '../evaluation/resource-connection-wave14-evaluator.mjs';

const report=await runResourceConnectionWave14Evaluation();
const dir=new URL('../artifacts/sidecar-connection-wave14/',import.meta.url);
await fs.mkdir(dir,{recursive:true});
await fs.writeFile(new URL('resource-connection-evaluation.json',dir),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify(report,null,2));
