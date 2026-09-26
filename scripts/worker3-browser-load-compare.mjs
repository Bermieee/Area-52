import fs from 'node:fs';
const [beforePath,afterPath]=process.argv.slice(2);if(!beforePath||!afterPath)throw new Error('before and after HTML paths required');
const attrs=['reader-calls','mutations','elapsed-ms','long-task-count','long-task-total-ms','long-task-max-ms','heap-growth-bytes','listeners-peak','listeners-after-destroy','listeners-after-remount-destroy','node-count','suppressed-routine','workspace-renders'];
function parse(path){const html=fs.readFileSync(path,'utf8'),out={};for(const key of attrs){const m=html.match(new RegExp('data-'+key+'="([^"]+)"'));out[key]=!m||m[1]==='NA'?null:Number(m[1]);}out.status=html.match(/data-status="([^"]+)"/)?.[1]??null;return out;}
const before=parse(beforePath),after=parse(afterPath);
console.log('WORKER3_BROWSER_LOAD_BEFORE '+JSON.stringify(before));
console.log('WORKER3_BROWSER_LOAD_AFTER '+JSON.stringify(after));
if(before.status!=='PASS'||after.status!=='PASS')throw new Error('browser harness lifecycle failed');
if(after['listeners-after-destroy']!==0||after['listeners-after-remount-destroy']!==0)throw new Error('listener leak after current-head lifecycle');
if(!(after['reader-calls']<before['reader-calls']))throw new Error('owner-reader load did not improve');
if(!(after.mutations<=before.mutations))throw new Error('DOM mutation load regressed');
console.log('WORKER3_BROWSER_LOAD_DELTA '+JSON.stringify({readerCalls:after['reader-calls']-before['reader-calls'],mutations:after.mutations-before.mutations,elapsedMs:(after['elapsed-ms']??0)-(before['elapsed-ms']??0),longTaskTotalMs:(after['long-task-total-ms']??0)-(before['long-task-total-ms']??0),heapGrowthBytes:after['heap-growth-bytes']==null||before['heap-growth-bytes']==null?null:after['heap-growth-bytes']-before['heap-growth-bytes']}));
