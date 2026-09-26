import fs from 'node:fs/promises';
import {runWave17SidecarJevEvaluation} from '../evaluation/sidecar-jev-wave17-evaluator.mjs';
const report=await runWave17SidecarJevEvaluation();
const resolved={...report,browserFetchBinding:{
  supported:report.browserFetchBinding.supported,
  calledAfterInvoke:await report.browserFetchBinding.calledAfterInvoke,
  receiverCorrectAfterInvoke:await report.browserFetchBinding.receiverCorrectAfterInvoke,
}};
const dir=new URL('../artifacts/sidecar-jev-wave17/',import.meta.url);
await fs.mkdir(dir,{recursive:true});
await fs.writeFile(new URL('report.json',dir),JSON.stringify(resolved,null,2)+'\n');
console.log(JSON.stringify(resolved,null,2));
