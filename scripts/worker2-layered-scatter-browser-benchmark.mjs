import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const args=Object.fromEntries(process.argv.slice(2).reduce((out,value,index,all)=>{
  if(value.startsWith('--'))out.push([value.slice(2),all[index+1]]);
  return out;
},[]));
if(!args.baseline||!args.current)throw new Error('Usage: --baseline <path> --current <path>');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function server(root,port){
  const child=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1','--directory',root],{stdio:'ignore'});
  for(let i=0;i<40;i++){
    await sleep(100);
    if(child.exitCode!=null)throw new Error('HTTP server exited early');
    try{const response=await fetch('http://127.0.0.1:'+port+'/');if(response.ok)return child;}catch{}
  }
  child.kill();throw new Error('HTTP server did not become ready');
}

async function run(root,port,label,browser){
  const child=await server(root,port);
  try{
    const page=await browser.newPage();
    await page.goto('http://127.0.0.1:'+port+'/',{waitUntil:'domcontentloaded'});
    const result=await page.evaluate(async({label,origin})=>{
      const [constants,telemetryModule,swarmModule,contractsModule,choiceModule]=await Promise.all([
        import(origin+'/src/coprocessor/constants.js'),
        import(origin+'/src/coprocessor/telemetry.js'),
        import(origin+'/src/coprocessor/native-sidecar-swarm.js'),
        import(origin+'/src/coprocessor/contracts.js'),
        import(origin+'/src/coprocessor/cognitive-choice-proposal.js'),
      ]);
      const {Capability,Placement,ResultClass}=constants;
      const {CoprocessorTelemetry}=telemetryModule;
      const {NativeSidecarSwarm}=swarmModule;
      const {createCognitiveTask,createTurnEnvelope,createWorkerResult}=contractsModule;
      const {CoprocessorChoiceDisposition,createCoprocessorChoiceProposal}=choiceModule;
      const now=Date.now();
      const turn=createTurnEnvelope({
        turnId:'bench:turn',correlationId:'bench:corr',eventId:'bench:event',createdAt:now,deadline:now+10000,
        sourceRevisionSet:['bench:source:v1'],worldRevision:9,sceneRevision:4,characterStateRevision:2,
      });
      const makeTask=(roleId,layer,resultClass=ResultClass.REQUIRED,expectedValue=.9)=>createCognitiveTask({
        taskId:'bench:'+roleId,taskType:roleId==='hot-exact'?'GRAPH_WALK':roleId==='evidence-expansion'?'GRAPH_WALK':roleId==='truth-precision'?'TRUTH_PRECISION':'CONSOLIDATION',
        turnId:turn.turnId,correlationId:turn.correlationId,causationId:turn.eventId,requiredCapabilities:[Capability.GRAPH],
        cognitiveLayer:layer==='DEEP'?'L3':'L1',resultClass,inputRevisionSet:turn,softDeadline:now+8000,hardDeadline:now+9000,
        placement:layer==='DEEP'?Placement.DEEP:Placement.HOT,compilerLane:'graphResults',intentFingerprint:'bench:intent',
        metadata:{roleId,scatterLayer:layer,scatterTrigger:'BENCH_SIGNAL',expectedValue,costEstimate:{units:1,class:'LOW'}},
      });
      const tasks=[
        makeTask('hot-exact','HOT_EXACT',ResultClass.OPPORTUNISTIC,.8),
        makeTask('evidence-expansion','EVIDENCE_EXPANSION',ResultClass.REQUIRED,.9),
        makeTask('truth-precision','PRECISION',ResultClass.REQUIRED,.9),
        makeTask('deep-study','DEEP',ResultClass.DEFERRED,.7),
        makeTask('prefetch','DEEP',ResultClass.DEFERRED,.7),
      ];
      const revisionFence={...turn,intentFingerprint:'bench:intent',policyRevision:'bench'};
      const options=tasks.map(task=>({
        optionId:task.metadata.roleId,roleId:task.metadata.roleId,taskType:task.taskType,logicalCapability:task.taskType,requiredCapabilities:task.requiredCapabilities,
        revisionFence,expectedValue:task.metadata.expectedValue,estimatedCost:{units:1,class:'LOW'},resultClass:task.resultClass,
        disposition:task.resultClass===ResultClass.DEFERRED?CoprocessorChoiceDisposition.DEFERRED:CoprocessorChoiceDisposition.NOMINATED,
        reasonCodes:['BENCH_SIGNAL'],taskId:task.taskId,
      }));
      options.push({
        optionId:'jev-adjudication',roleId:'jev-adjudication',taskType:'JEV_ADJUDICATION',logicalCapability:'BOUNDED_JEV_ADJUDICATION',
        requiredCapabilities:[Capability.SEMANTIC_JUDGMENT],revisionFence,expectedValue:0,estimatedCost:{units:2,class:'MEDIUM'},
        resultClass:ResultClass.OPPORTUNISTIC,disposition:CoprocessorChoiceDisposition.SKIPPED,reasonCodes:['JEV_DETERMINISTIC_SUFFICIENT'],
      });
      const choiceProposal=createCoprocessorChoiceProposal({
        turnId:turn.turnId,correlationId:turn.correlationId,policyVersion:'bench',revisionFence,resourceCount:1,options,
        ownerStageRequests:{jevAdjudication:false},jev:{considered:false,gateRoute:'SKIP_JEV'},
      });
      const planner={planChoice(){return{fanOutPlan:{kind:'FanOutPlan',turnId:turn.turnId,correlationId:turn.correlationId,tasks,nominations:[],plannedWorkerCount:tasks.length,boundedFanOut:tasks.length,budget:{}},choiceProposal};}};
      const telemetry=new CoprocessorTelemetry();
      const capabilities=[Capability.GRAPH,Capability.SEMANTIC_JUDGMENT];
      const profile={profileId:'bench:profile',workerId:'bench:worker',providerId:'bench:provider',modelId:'bench:model',capabilities,structuredOutput:true,
        supportedLayers:['L1','L3'],placements:[Placement.HOT,Placement.DEEP],foregroundEligible:true,backgroundEligible:true,available:true,availability:'AVAILABLE',
        health:'HEALTHY',providerHealth:'HEALTHY',currentLoad:0,concurrencyCapacity:6,maxConcurrency:6,profileMetadata:{resourceId:'bench:resource'},maxContextTokens:65536,maxOutputTokens:4096};
      let active=0,maxConcurrent=0,physicalAttempts=0,normalizationMs=0,peakHeap=performance.memory?.usedJSHeapSize??null,cooperativeYields=0;
      const updatePeak=()=>{const value=performance.memory?.usedJSHeapSize??null;if(value!=null)peakHeap=peakHeap==null?value:Math.max(peakHeap,value);};
      const busy=ms=>{const start=performance.now();while(performance.now()-start<ms){};};
      const connections={
        profiles:{list:()=>[profile],eligibleProfiles:()=>[profile]},
        adapters:{get:()=>({})},
        readModel:()=>({activeCapabilities:capabilities,readyResourceCount:1,resources:[{resourceId:'bench:resource',providerProfileId:profile.profileId,configured:true,selectedModelQualified:true,callable:true,activeCapabilities:capabilities,maxConcurrency:6,activeExecutions:active,measurementClass:'LOCAL_DETERMINISTIC'}]}),
        createJevProviderExecutor:()=>({hasEligibleProvider:()=>false,execute:async()=>{throw new Error('benchmark Jev is not physically executed');}}),
        executeTask:async task=>{
          physicalAttempts+=1;active+=1;maxConcurrent=Math.max(maxConcurrent,active);updatePeak();
          await Promise.resolve();
          busy(30);
          const normalizeStarted=performance.now();
          const scratch='x'.repeat(256*1024);
          const payload={unresolvedRefs:[],conflicts:[],scratch,role:task.metadata.roleId};
          const stamp=Date.now();
          const result=createWorkerResult({
            resultId:'bench:result:'+task.taskId,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,
            workerId:profile.workerId,providerId:profile.providerId,modelId:profile.modelId,capabilities,
            payload,freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,intentFingerprint:task.intentFingerprint,
            startedAt:stamp,completedAt:stamp,latency:30,authorityClass:'UNRESOLVED',
          });
          normalizationMs+=performance.now()-normalizeStarted;updatePeak();active-=1;return result;
        },
      };
      const swarm=new NativeSidecarSwarm({
        connections,planner,telemetry,
        cooperativeYield:async()=>{cooperativeYields+=1;await new Promise(resolve=>setTimeout(resolve,0));},
      });
      globalThis.gc?.();
      const heapBefore=performance.memory?.usedJSHeapSize??null;updatePeak();
      const longTasks=[];let observer=null;
      try{observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(entry=>entry.duration)));observer.observe({entryTypes:['longtask']});}catch{}
      const planningStarted=performance.now();
      const prepared=swarm.prepareTurn({turnEvent:turn,selection:{chatId:'bench:chat',turnId:turn.turnId,generationId:'bench:gen',correlationId:turn.correlationId}});
      const scatterPlanningMs=performance.now()-planningStarted;
      const executionStarted=performance.now();
      const output=await swarm.executeCheckpoint(prepared.checkpoint,{currentRevisionState:turn});
      const nativeSidecarExecutionMs=performance.now()-executionStarted;
      const timeToSealReadyHandoffMs=performance.now()-planningStarted;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      observer?.disconnect?.();updatePeak();globalThis.gc?.();
      const heapAfter=performance.memory?.usedJSHeapSize??null;
      const serializedOwnerBytes=new TextEncoder().encode(JSON.stringify(output.contribution.resultsForOwner)).length;
      const layerEvents=telemetry.list().filter(event=>event.type==='COPROCESSOR_SCATTER_LAYER_STARTED');
      const taskDecisions=telemetry.list().filter(event=>event.type==='COPROCESSOR_SCATTER_TASK_DECISION');
      return {
        label,workload:'six logical jobs: HOT, evidence expansion, precision, two DEEP jobs, Jev option',
        logicalJobs:6,physicalAttempts,maxConcurrentPhysical:maxConcurrent,cooperativeYields,
        scatterPlanningMs:Math.round(scatterPlanningMs*1000)/1000,
        nativeSidecarExecutionMs:Math.round(nativeSidecarExecutionMs*1000)/1000,
        resultNormalizationMs:Math.round(normalizationMs*1000)/1000,
        optionalProviderAttempts:0,
        gatherMs:null,journalPublicationMs:null,uiHandoffMs:null,
        externalOwnerStages:['CORE_GATHER','CONTEXT_SEAL','WORKER3_JOURNAL_UI'],
        timeToSealReadyHandoffMs:Math.round(timeToSealReadyHandoffMs*1000)/1000,
        retainedOwnerBytes:serializedOwnerBytes,
        heapBeforeBytes:heapBefore,heapAfterBytes:heapAfter,peakHeapBytes:peakHeap,
        peakHeapDeltaBytes:peakHeap!=null&&heapBefore!=null?peakHeap-heapBefore:null,
        heapGrowthBytes:heapBefore!=null&&heapAfter!=null?heapAfter-heapBefore:null,
        longTaskCount:longTasks.length,maxLongTaskMs:longTasks.length?Math.round(Math.max(...longTasks)*1000)/1000:0,
        layerWaveCount:layerEvents.length,taskDecisionCount:taskDecisions.length,
        resultStates:Object.fromEntries(output.contribution.resultSummary.map(row=>[row.optionId,row.state])),
        readyResults:output.contribution.resultsForOwner.length,
      };
    },{label,origin:'http://127.0.0.1:'+port});
    await page.close();
    return result;
  }finally{child.kill();}
}

const browser=await chromium.launch({headless:true,args:['--enable-precise-memory-info','--js-flags=--expose-gc']});
try{
  const before=await run(args.baseline,42821,'baseline-main',browser);
  const after=await run(args.current,42822,'layered-head',browser);
  const report={
    kind:'WORKER2_LAYERED_SCATTER_BROWSER_BEFORE_AFTER',
    baselineSha:'ea66ddce461803d5279b4497f6604e3d75d6def6',
    workload:before.workload,
    before,after,
    delta:{
      physicalAttempts:after.physicalAttempts-before.physicalAttempts,
      totalWorkAvoided:before.physicalAttempts-after.physicalAttempts,
      maxConcurrentPhysical:after.maxConcurrentPhysical-before.maxConcurrentPhysical,
      retainedOwnerBytes:after.retainedOwnerBytes-before.retainedOwnerBytes,
      peakHeapDeltaBytes:(after.peakHeapDeltaBytes??0)-(before.peakHeapDeltaBytes??0),
      timeToSealReadyHandoffMs:after.timeToSealReadyHandoffMs-before.timeToSealReadyHandoffMs,
      maxLongTaskMs:after.maxLongTaskMs-before.maxLongTaskMs,
    },
    scope:{
      browserMainThreadMeasured:true,installedSillyTavernMeasured:false,nodeOnly:false,
      coreGatherAndSealOwnedByWorker1:true,journalAndUiOwnedByWorker3:true,
    },
  };
  console.log(JSON.stringify(report,null,2));
  assert.equal(before.logicalJobs,6);assert.equal(after.logicalJobs,6);
  assert.equal(before.physicalAttempts,3,'baseline should physically execute HOT + evidence + precision together');
  assert.equal(after.physicalAttempts,2,'layered head should avoid resolved precision');
  assert.equal(report.delta.totalWorkAvoided,1);
  assert.ok(after.maxConcurrentPhysical<before.maxConcurrentPhysical,'layering must reduce peak physical concurrency on the same workload');
  assert.ok(after.retainedOwnerBytes<before.retainedOwnerBytes,'skipped precision must reduce retained owner payload bytes');
  assert.ok(after.cooperativeYields>=2,'foreground layer boundaries must return control to the browser event loop');
  assert.equal(after.resultStates['truth-precision'],'SKIPPED');
  assert.equal(after.resultStates['deep-study'],'PARKED');
  assert.equal(after.resultStates.prefetch,'PARKED');
  assert.ok(after.timeToSealReadyHandoffMs<=before.timeToSealReadyHandoffMs+75,'lower peak must not impose a severe foreground delay');
}finally{
  await browser.close();
}
