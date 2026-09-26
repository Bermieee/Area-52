import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { chromium } from 'playwright';

const args=Object.fromEntries(process.argv.slice(2).reduce((out,value,index,all)=>{
  if(value.startsWith('--'))out.push([value.slice(2),all[index+1]]);
  return out;
},[]));
const baseline=args.baseline,current=args.current;
if(!baseline||!current)throw new Error('Usage: --baseline <path> --current <path>');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function server(root,port){
  const child=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
  for(let i=0;i<40;i++){await sleep(100);if(child.exitCode!=null)throw new Error('HTTP server exited early');try{const r=await fetch('http://127.0.0.1:'+port+'/');if(r.ok)return child;}catch{}}
  child.kill();throw new Error('HTTP server did not become ready');
}
async function run(root,port,label,browser){
  const child=await server(root,port);
  try{
    const page=await browser.newPage();
    await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
    const result=await page.evaluate(async({label,origin})=>{
      const mod=await import(origin+'/src/ui-core/index.js');
      const {DemoEvidenceJournal,DemoActivityFeedController}=mod;
      document.body.innerHTML='<main><div id="feed"></div></main>';
      const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
      const selection={chatId:'bench:chat',turnId:'bench:turn',generationId:'bench:gen',correlationId:'bench:corr',worldRevision:9,sceneRevision:4,sourceRevisionRefs:['scene:r4','world:r9']};
      const jobs=Array.from({length:40},(_,i)=>({jobId:'job:'+i,taskId:'job:'+i,taskType:'RETRIEVAL',state:'COMPLETE',resourceId:'worker:'+(i%6),providerId:'provider:'+(i%3),modelId:'model:'+(i%2)}));
      const results=Array.from({length:64},(_,i)=>({resultId:'result:'+i,taskId:'job:'+(i%40),status:'COMPLETE',capability:'RETRIEVAL',resourceId:'worker:'+(i%6),destination:'GATHER'}));
      const stages=['scene','runtime','coprocessor','choice','truth','jev','gather','seal','promptPlan','generation','learning'].map(id=>({id,label:id,state:'LIVE',reason:'Owner receipt published.',chatId:selection.chatId,turnId:selection.turnId,generationId:selection.generationId}));
      const inspections=Object.fromEntries(stages.map(row=>[row.id,{available:true,receiptRef:'receipt:'+row.id,payload:{kind:'Receipt',id:'receipt:'+row.id,...selection}}]));
      const operations={selection,stages,inspections,pipeline:{mappingReceipt:true,logicalJobsMapped:40,mappedResourceCount:6,executionReceipt:true,physicalExecutionAttempts:40,physicalExecutionSucceeded:40,resultReceipt:true,returnedResults:64,admissionReceipt:true,contextAdmitted:64,generationReceipt:true,deliveryReceipt:true,generationState:'OBSERVED',learningReceipt:true}};
      const diagnostics={host:{liveBinding:{reads:1,rejected:0,lastError:null}},resources:{rows:Array.from({length:6},(_,i)=>({id:'worker:'+i,displayName:'Worker '+i,kind:i===0?'JEV':i<3?'SIDECAR':'VECTORING',physicalExecutionAttempted:true,physicalExecutionSucceeded:true,ownerAccepted:true,lastExecution:{status:'SUCCESS'}}))}};
      const cognition={data:{scatter:{receiptId:'scatter:1',jobs,resourceCount:6},gather:{receiptId:'gather:1',results},seal:{receiptId:'seal:1',effectiveAdmittedResultIds:results.map(r=>r.resultId)},jev:{receiptId:'jev:1',state:'COMPLETE'}}};
      const promptPlan={data:{promptPlanId:'plan:1',totalTokens:499,budgetTotal:4096,deferred:[{slot:'RELEVANT_LORE',reason:'BUDGET_EXHAUSTED'}],sections:[{slot:'CURRENT_SCENE',state:'INCLUDED',estimatedTokens:499}]}};
      const journal=new DemoEvidenceJournal({storage,namespace:'bench',now:()=>1000});
      const feedHost=document.querySelector('#feed');let inspectCount=0;
      const feed=new DemoActivityFeedController({host:feedHost,journal,selectionProvider:()=>selection,inspect:()=>inspectCount++,now:()=>1000,scheduleEnabled:false,maxVisible:5}).mount();
      let mutations=0;const mo=new MutationObserver(rows=>{mutations+=rows.length;});mo.observe(feedHost,{childList:true,subtree:true});
      const longTasks=[];let observer=null;
      try{observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(x=>x.duration)));observer.observe({entryTypes:['longtask']});}catch{}
      const heapBefore=performance.memory?.usedJSHeapSize??null;
      let feedRenderCalls=0;
      const started=performance.now();
      for(let i=0;i<600;i++){
        journal.recordSnapshot({selection,operations,diagnostics,cognition,promptPlan,ownerReceipt:null});
        if(journal.lastRecordChanged===false)continue;
        feed.render();feedRenderCalls++;
      }
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const durationMs=performance.now()-started,heapAfter=performance.memory?.usedJSHeapSize??null;
      observer?.disconnect?.();mo.disconnect();const status=journal.status();
      const out={
        label,durationMs:Math.round(durationMs*1000)/1000,feedRenderCalls,domMutationRecords:mutations,longTaskCount:longTasks.length,
        maxLongTaskMs:longTasks.length?Math.round(Math.max(...longTasks)*1000)/1000:0,
        heapBeforeBytes:heapBefore,heapAfterBytes:heapAfter,heapGrowthBytes:heapBefore!=null&&heapAfter!=null?heapAfter-heapBefore:null,
        journalWrites:status.writes,coalescedSnapshots:status.skippedRedundantWrites,retainedEntries:status.entryCount,serializedBytes:status.serializedBytes,inspectCount,
      };
      feed.destroy();return out;
    },{label,origin:'http://127.0.0.1:'+port});
    await page.close();return result;
  }finally{child.kill();}
}
const browser=await chromium.launch({headless:true,args:['--enable-precise-memory-info']});
try{
  const before=await run(baseline,41731,'base-253',browser);
  const after=await run(current,41732,'closure-head',browser);
  const report={kind:'WORKER3_BROWSER_LOAD_BEFORE_AFTER',workload:'600 identical selected-turn snapshots; 40 Scatter jobs; 64 Gather results; six optional resources; live DOM activity feed',before,after};
  console.log(JSON.stringify(report,null,2));
  assert.equal(before.journalWrites,1);
  assert.equal(after.journalWrites,1);
  assert.equal(after.coalescedSnapshots,599);
  assert.ok(after.feedRenderCalls<=1,'unchanged snapshots must not re-enter feed rendering');
  assert.ok(after.feedRenderCalls<before.feedRenderCalls,'closure must reduce feed render calls versus exact #253 base');
  assert.ok(after.domMutationRecords<=before.domMutationRecords,'closure must not increase feed DOM mutation records');
  assert.ok(after.serializedBytes<=262144,'journal remains bounded');
}finally{await browser.close();}
