import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,normalize} from 'node:path';

const chrome=process.env.CHROME;
if(!chrome)throw new Error('CHROME executable is required');
const root=process.cwd(),port=8765,debugPort=9222;
const targetUrl=`http://127.0.0.1:${port}/tests/worker2-layered-scatter-browser.html`;
const profileDir=`/tmp/area52-worker2-chrome-${process.pid}`;

const server=createServer(async(req,res)=>{
  try{
    const requestPath=decodeURIComponent(new URL(req.url,targetUrl).pathname);
    const local=normalize(resolve(root,'.'+requestPath));
    if(!local.startsWith(root)){res.writeHead(403);res.end('forbidden');return;}
    const body=await readFile(local);
    res.writeHead(200,{'content-type':local.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream','cache-control':'no-store'});
    res.end(body);
  }catch(error){res.writeHead(404);res.end(String(error?.message??error));}
});
await new Promise((resolve,reject)=>server.listen(port,'127.0.0.1',error=>error?reject(error):resolve()));

const child=spawn(chrome,[
  '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-timer-throttling',
  '--enable-precise-memory-info','--js-flags=--expose-gc',`--remote-debugging-port=${debugPort}`,'--remote-allow-origins=*',
  `--user-data-dir=${profileDir}`,targetUrl,
],{stdio:['ignore','ignore','pipe']});
let stderr='';child.stderr.on('data',chunk=>{stderr+=String(chunk);if(stderr.length>12000)stderr=stderr.slice(-12000);});

try{
  const target=await waitForTarget(targetUrl,30000);
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(new Error('CDP websocket failed to open'));});
  let sequence=0;const pending=new Map();
  ws.onmessage=event=>{
    const message=JSON.parse(String(event.data));
    if(message.id&&pending.has(message.id)){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(new Error(JSON.stringify(message.error))):resolve(message.result);}
  };
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
    setTimeout(()=>{if(pending.delete(id))reject(new Error(`CDP timeout: ${method}`));},5000).unref?.();
  });
  await call('Runtime.enable');
  const started=Date.now();let status='RUNNING';
  while(status==='RUNNING'){
    if(Date.now()-started>30000)throw new Error('browser benchmark did not settle within 30s');
    await sleep(50);
    status=await evaluate(call,"document.body?.dataset?.status ?? 'MISSING'");
  }
  const raw=await evaluate(call,"document.getElementById('results')?.textContent ?? ''");
  const html=await evaluate(call,'document.documentElement.outerHTML');
  await writeFile('worker2-browser-dump.html',html+'\n');
  if(!raw)throw new Error(`browser benchmark result missing (status=${status})`);
  const payload=JSON.parse(raw);
  await writeFile('worker2-browser-results.json',JSON.stringify(payload,null,2)+'\n');
  console.log(JSON.stringify(payload,null,2));
  ws.close();
  if(status!=='PASS'||payload.pass!==true)process.exitCode=1;
}finally{
  child.kill('SIGTERM');
  await new Promise(resolve=>server.close(()=>resolve()));
  await rm(profileDir,{recursive:true,force:true}).catch(()=>{});
  if(process.exitCode&&stderr)console.error(stderr);
}

async function waitForTarget(url,timeoutMs){
  const started=Date.now();let lastError=null;
  while(Date.now()-started<timeoutMs){
    try{
      const response=await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const rows=await response.json();
      const target=rows.find(row=>row.type==='page'&&row.url===url)||rows.find(row=>row.type==='page');
      if(target?.webSocketDebuggerUrl)return target;
    }catch(error){lastError=error;}
    await sleep(50);
  }
  throw new Error(`Chrome DevTools target unavailable: ${lastError?.message??'timeout'}`);
}
async function evaluate(call,expression){
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error(`Runtime.evaluate failed: ${result.exceptionDetails.text??'unknown'}`);
  return result.result?.value;
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
