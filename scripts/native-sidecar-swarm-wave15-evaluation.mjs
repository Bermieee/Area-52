import fs from 'node:fs/promises';
import { runWave15NativeSwarmEvaluation } from '../evaluation/native-sidecar-swarm-wave15-evaluator.mjs';
const report=await runWave15NativeSwarmEvaluation();
const dir=new URL('../artifacts/native-sidecar-swarm-wave15/',import.meta.url);
await fs.mkdir(dir,{recursive:true});
await fs.writeFile(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
