import {readFile,writeFile} from 'node:fs/promises';

const [logPath='worker2-full-regression.log',baselinePath='tests/fixtures/worker2-main-ea66ddce-baseline-failures.txt']=process.argv.slice(2);
const log=await readFile(logPath,'utf8');
const baselineText=await readFile(baselinePath,'utf8');
const current=new Set();
for(const line of log.split(/\r?\n/)){
  const match=line.match(/^not ok \d+ - (.*)$/);
  if(match)current.add(match[1].replaceAll('\\#','#'));
}
const baseline=new Set(baselineText.split(/\r?\n/).map(x=>x.trim()).filter(Boolean));
const sorted=value=>[...value].sort((a,b)=>a.localeCompare(b));
const newlyFailed=sorted(new Set([...current].filter(x=>!baseline.has(x))));
const resolved=sorted(new Set([...baseline].filter(x=>!current.has(x))));
await writeFile('worker2-full-failures.txt',sorted(current).join('\n')+(current.size?'\n':''));
await writeFile('worker2-new-failures.txt',newlyFailed.join('\n')+(newlyFailed.length?'\n':''));
await writeFile('worker2-baseline-resolved.txt',resolved.join('\n')+(resolved.length?'\n':''));
console.log('EXACT_MAIN_BASELINE_FAILURES='+baseline.size);
console.log('CURRENT_FAILURES='+current.size);
console.log('BASELINE_RESOLVED='+resolved.length);
console.log('NEW_FAILURES='+newlyFailed.length);
if(newlyFailed.length){
  console.error('New failures introduced by Worker2 branch:');
  for(const name of newlyFailed)console.error(name);
  process.exitCode=1;
}else{
  console.log('BASELINE_DEBT_ONLY: no failures outside exact main ea66ddce461803d5279b4497f6604e3d75d6def6.');
}
