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
      const {createWave6ProductInterface,UIStateStore}=mod;
      localStorage.clear();
      document.body.innerHTML='<main><aside id="area52"></aside></main>';
      const selection={chatId:'bench:chat',turnId:'bench:turn',generationId:'bench:gen',correlationId:'bench:corr',worldRevision:9,sceneRevision:4,sourceRevisionRefs:['scene:r4','world:r9']};
      const ids=Array.from({length:64},(_,i)=>'result:'+i);
      const jobs=Array.from({length:40},(_,i)=>({jobId:'job:'+i,taskId:'job:'+i,capability:'RETRIEVAL',state:'COMPLETE',resourceId:'worker:'+(i%6),provider:'provider:'+(i%3),model:'model:'+(i%2)}));
      const results=ids.map((resultId,i)=>({resultId,taskId:'job:'+(i%40),status:'ADMITTED',accepted:true,capability:'RETRIEVAL',resourceId:'worker:'+(i%6),destination:'CONTEXT'}));
      const calls={selection:0,scene:0,choice:0,scatter:0,gather:0,seal:0,prompt:0,context:0,selectedTurn:0,hostDelivery:0,lore:0,memory:0,resources:0};
      const listeners=new Set();
      const same=extra=>({...selection,...extra});
      const ownerReceipt=same({kind:'NativeBrainSelectedTurnReceipt',contractVersion:1,sourceRevisions:{selectedRefs:selection.sourceRevisionRefs,sceneRefs:['scene:r4'],sealRefs:selection.sourceRevisionRefs},producers:{
        scene:{status:'PUBLISHED',id:'scene:r4',sceneRevision:4,sourceRevisionRefs:['scene:r4']},
        cognitiveChoice:{status:'PUBLISHED',id:'choice:bench'},retrieval:{status:'PUBLISHED',id:'scatter:bench'},gather:{status:'PUBLISHED',id:'gather:bench'},
        contextSeal:{status:'PUBLISHED',id:'seal:bench'},promptPlan:{status:'PUBLISHED',id:'plan:bench'},contextReceipt:{status:'PUBLISHED',id:'context:bench'},
      }});
      const bindings={
        readSelection(){calls.selection++;return{...selection};},
        subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
        readScene(){calls.scene++;return same({kind:'SceneUiReadModel',sceneId:'scene:bench',revision:4,lifecycle:'ACTIVE',location:{value:{name:'Benchmark Harbor'},authority:'OBSERVED'},narrativeTime:{value:'evening'},activeCast:['Ari'],objects:[],activeThreads:['load'],uncertainFields:[],provenanceRefs:['scene:r4'],health:{state:'READY',reasons:[]}});},
        readCognitiveChoice(){calls.choice++;return same({kind:'CognitiveChoiceReceipt',receiptId:'choice:bench',status:'COMPLETE',paths:['RETRIEVAL'],functionDecisions:[],admittedJobs:jobs.map(x=>x.jobId),skippedJobs:[],deferredJobs:[],consideredCognitionOptions:[],reasonCodes:['RETRIEVAL_REQUIRED'],retrievalIntents:[],sensoryChannelsRequested:[],sensoryChannelsUsed:[],candidateCounts:{},measurements:{}});},
        readScatter(){calls.scatter++;return same({kind:'RuntimeScatterReceipt',receiptId:'scatter:bench',jobs,resourceCount:6,resourceIds:Array.from({length:6},(_,i)=>'worker:'+i)});},
        readGather(){calls.gather++;return same({kind:'GatherReceipt',receiptId:'gather:bench',state:'COMPLETE',counts:{ADMITTED:64,LATE:0,STALE:0,REJECTED:0,INVALID:0},results});},
        readContextSeal(){calls.seal++;return same({kind:'ContextSealReceipt',sealId:'seal:bench',sealedState:true,effectiveAdmittedResultIds:ids,admittedResultIds:ids,sourceRevisionRefs:selection.sourceRevisionRefs});},
        readPromptPlan(){calls.prompt++;return same({kind:'PromptPlanReadModel',promptPlanId:'plan:bench',contextSealId:'seal:bench',slotAllocation:[{slot:'CURRENT_SCENE',estimatedTokens:499},{slot:'RELEVANT_LORE',estimatedTokens:0}],sectionOrder:['CURRENT_SCENE','RELEVANT_LORE'],reuseDecisions:[],dropped:[],deferred:[],budget:{total:4096,allocated:499,remaining:3597},estimatedTokens:499});},
        readContextReceipt(){calls.context++;return same({kind:'ContextReceiptReadModel',promptPlanId:'plan:bench',contextSealId:'seal:bench',packetId:'packet:bench',includedSections:['CURRENT_SCENE'],omittedSections:[],deferredSections:[{slot:'RELEVANT_LORE',reason:'BUDGET_EXHAUSTED_AFTER_REQUIRED_CONTEXT'}],budget:{total:4096,allocated:499},estimatedTokens:499});},
        readSelectedTurnReceipt(){calls.selectedTurn++;return ownerReceipt;},
        readHostDeliveryReceipt(){calls.hostDelivery++;return same({kind:'SillyTavernHostDeliveryReceipt',receiptId:'host:bench',state:'MODEL_REQUEST_PAYLOAD_INJECTED',promptInjected:true,requestInjectedAt:100});},
        readLoreStatus(){calls.lore++;return same({kind:'LorePublicIntegrationSurface',entries:[],artifacts:[],conflicts:[],lifecycle:{counts:{DUE:0,PENDING:0,ACTIVE:0,CHECKPOINTED:0,COMPLETED:0,SUPERSEDED:0,STALE:0,INVALID:0},due:0,active:0}});},
        readMemoryStatus(){calls.memory++;return same({kind:'MemoryStatus',state:'READY',count:2});},
        listResourceProfiles(){calls.resources++;return Array.from({length:6},(_,i)=>({profileId:'worker:'+i,kind:i===0?'JEV':i<3?'SIDECAR':'VECTORING',providerId:'local',modelId:'bench',local:true,health:'HEALTHY',availability:'AVAILABLE',connected:true,capabilities:['RETRIEVAL'],placements:['FOREGROUND'],currentLoad:0,concurrencyCapacity:2}));},
      };
      const root=document.querySelector('#area52');
      const ui=createWave6ProductInterface({root,stateStore:new UIStateStore({storage:localStorage,namespace:'browser-load-'+label}),hostBindings:bindings,floatingNavigation:false,viewportProvider:()=>({width:1280,height:800})});
      ui.scheduler.flush(0);
      for(const key of Object.keys(calls))calls[key]=0;
      let feedRenderCalls=0;
      if(ui.operator?.activityFeed?.render){const render=ui.operator.activityFeed.render.bind(ui.operator.activityFeed);ui.operator.activityFeed.render=(...args)=>{feedRenderCalls++;return render(...args);};}
      globalThis.gc?.();
      const heapBefore=performance.memory?.usedJSHeapSize??null,longTasks=[];let observer=null,mutations=0;
      try{observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(x=>x.duration)));observer.observe({entryTypes:['longtask']});}catch{}
      const mo=new MutationObserver(rows=>{mutations+=rows.length;});mo.observe(document.body,{childList:true,subtree:true,attributes:true});
      const started=performance.now();
      for(let i=0;i<160;i++)ui.operator.captureEvidence();
      const durationMs=performance.now()-started;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      observer?.disconnect?.();mo.disconnect();
      globalThis.gc?.();
      const heapAfter=performance.memory?.usedJSHeapSize??null,status=ui.operator.evidenceJournal.status(),loadTrace=ui.operator.loadTrace?.snapshot?.()??null;
      const out={
        label,durationMs:Math.round(durationMs*1000)/1000,feedRenderCalls,domMutationRecords:mutations,longTaskCount:longTasks.length,
        maxLongTaskMs:longTasks.length?Math.round(Math.max(...longTasks)*1000)/1000:0,
        heapBeforeBytes:heapBefore,heapAfterBytes:heapAfter,heapGrowthBytes:heapBefore!=null&&heapAfter!=null?heapAfter-heapBefore:null,
        journalWrites:status.writes,coalescedSnapshots:status.skippedRedundantWrites,retainedEntries:status.entryCount,serializedBytes:status.serializedBytes,
        ownerReads:{...calls},loadTrace,
      };
      ui.destroy();return out;
    },{label,origin:'http://127.0.0.1:'+port});
    await page.close();return result;
  }finally{child.kill();}
}
const browser=await chromium.launch({headless:true,args:['--enable-precise-memory-info','--js-flags=--expose-gc']});
try{
  const before=await run(baseline,41731,'base-253',browser);
  const after=await run(current,41732,'closure-head',browser);
  const report={kind:'WORKER3_BROWSER_LOAD_BEFORE_AFTER',workload:'160 full selected-turn UI capture cycles in Chromium; 40 Scatter jobs; 64 Gather results; six optional resources; live DOM + bounded journal/feed',before,after};
  console.log(JSON.stringify(report,null,2));
  assert.equal(before.journalWrites,1);
  assert.equal(after.journalWrites,1);
  assert.ok(after.coalescedSnapshots>=159);
  assert.equal(after.feedRenderCalls,0,'unchanged selected-turn captures must not re-enter feed rendering after warm mount');
  assert.ok(after.feedRenderCalls<before.feedRenderCalls,'closure must reduce feed render calls versus exact #253 base');
  assert.ok(after.ownerReads.scatter<before.ownerReads.scatter,'closure must remove duplicate Scatter reads from journal diagnostics');
  assert.ok(after.ownerReads.prompt<before.ownerReads.prompt,'closure must remove duplicate PromptPlan reads from journal diagnostics');
  assert.ok(after.ownerReads.lore<before.ownerReads.lore,'closure must stop journal capture from re-reading Lore status');
  assert.ok(after.serializedBytes<=262144,'journal remains bounded');
}finally{await browser.close();}
