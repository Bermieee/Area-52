import fs from 'node:fs/promises';
import {runSpeculativeWarmerWave12Benchmark} from '../evaluation/speculative-warmer-wave12-evaluator.mjs';

const report=await runSpeculativeWarmerWave12Benchmark({latency:true});
await fs.mkdir(new URL('../artifacts/jev-wave12/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('../artifacts/jev-wave12/speculative-warmer-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify(report,null,2));
