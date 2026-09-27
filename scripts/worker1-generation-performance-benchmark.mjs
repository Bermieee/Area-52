import {performance} from 'node:perf_hooks';
import {ResultBus} from '../src/result-bus.js';
import {Area52NativeBrain} from '../src/native-brain.js';

const RUNS=Math.max(20,Number(process.env.A52_BENCH_RUNS)||80);
const WARMUP=10;

function scene(){
  return{sceneId:'scene:benchmark',sceneRevision:1,location:'Bench Hall',narrativeTime:'tick 1',activeCast:[],activeThreads:[],objects:[],sourceRevisionRefs:['scene:benchmark@1'],provenance:['benchmark']};
}

function seedBus(){
  const bus=new ResultBus({getWorldRevision:()=>1,getSceneRevision:()=>1,isSourceRevisionCurrent:()=>true});
  for(let i=0;i<48;i+=1){
    const id=String(i).padStart(2,'0');
    bus.receiveCandidate({
      candidateId:'candidate:'+id,sourceRevisionRefs:[],claimIds:['claim:'+id],
      provenance:Array.from({length:6},(_,n)=>({source:'source:'+id+':'+n,weight:n/10})),
      evidenceRefs:Array.from({length:4},(_,n)=>'evidence:'+id+':'+n),
      representationText:'R'.repeat(1536),metadata:{channel:'fixture',nested:{id,flags:Array(8).fill(true)}},
    },{
      taskId:'retrieve:benchmark',turnId:'turn:benchmark',correlationId:'corr:benchmark',
      worldRevision:1,sceneRevision:1,
    });
    bus.receive({
      kind:'CognitiveResult',id:'result:precision:'+id,taskId:'precision:benchmark',turnId:'turn:benchmark',correlationId:'corr:benchmark',
      causationId:null,sourceSubsystem:'PRECISION',workerId:'deterministic-reference',destinationOwner:null,
      resultType:'PRECISION_RESULT',resultClass:'REQUIRED',payloadClass:'DERIVED_DATA',evidenceIds:['candidate:'+id],provenance:{candidateId:'candidate:'+id},
      sourceRevisionIds:[],worldRevision:1,sceneRevision:1,authorityClass:'UNRESOLVED',destination:'FOREGROUND',
      payload:{candidateId:'candidate:'+id,finalRank:i+1,normalizedScore:1-(i/100),freshness:'FRESH',sourceRevisionIds:[]},timing:{latencyMs:0},
    });
  }
  return bus;
}

function legacyRead(bus){
  const candidateRows=bus.foreground('turn:benchmark').filter(row=>row.result.resultType==='RETRIEVAL_CANDIDATE');
  const precisionRows=bus.foreground('turn:benchmark').filter(row=>row.result.resultType==='PRECISION_RESULT');
  const gatherRows=bus.results({turnId:'turn:benchmark'});
  const finalRows=bus.results({turnId:'turn:benchmark'});
  return{candidates:candidateRows.length,precision:precisionRows.length,gather:gatherRows.length,final:finalRows.length};
}

function optimizedRead(bus){
  const candidates=bus.foregroundPayloads('turn:benchmark',{resultType:'RETRIEVAL_CANDIDATE'});
  const precision=bus.foregroundPayloads('turn:benchmark',{resultType:'PRECISION_RESULT'});
  const routes=bus.results({turnId:'turn:benchmark'});
  return{candidates:candidates.length,precision:precision.length,gather:routes.length,final:routes.length};
}

function sample(fn){
  for(let i=0;i<WARMUP;i+=1)fn();
  const values=[];
  for(let i=0;i<RUNS;i+=1){const started=performance.now();fn();values.push(performance.now()-started);}
  values.sort((a,b)=>a-b);
  const sum=values.reduce((a,b)=>a+b,0);
  const percentile=(p)=>values[Math.min(values.length-1,Math.floor((values.length-1)*p))];
  return{runs:RUNS,meanMs:sum/values.length,p50Ms:percentile(0.50),p95Ms:percentile(0.95),maxMs:values.at(-1)};
}

const bus=seedBus(),legacyCounts=legacyRead(bus),optimizedCounts=optimizedRead(bus);
const legacy=sample(()=>legacyRead(bus)),optimized=sample(()=>optimizedRead(bus));
const brain=new Area52NativeBrain();
const prepareStarted=performance.now();
const prepared=await brain.prepareTurn({
  chatId:'chat:benchmark',turnId:'turn:benchmark-native',generationId:'gen:benchmark-native',correlationId:'corr:benchmark-native',
  query:'Continue the benchmark turn.',scene:scene(),executionLabel:'DETERMINISTIC',
});
const prepareWallMs=performance.now()-prepareStarted;
const selected=brain.uiBindings().readSelectedTurnReceipt(prepared.selection);
const plan=brain.uiBindings().readPromptPlan(prepared.selection);
const performanceReceipt=selected?.performance??null;
const result={
  kind:'Worker1GenerationPerformanceBenchmark',contractVersion:1,
  exactHeadRequired:true,
  fixture:{retrievalCandidates:48,precisionResults:48,totalResultRows:96,candidateRepresentationBytes:1536,referenceInstalledPromptPlanTokens:501},
  legacyEquivalent:{counts:legacyCounts,timing:legacy},
  optimized:{counts:optimizedCounts,timing:optimized},
  reduction:{
    meanMs:legacy.meanMs-optimized.meanMs,
    percent:legacy.meanMs>0?((legacy.meanMs-optimized.meanMs)/legacy.meanMs)*100:null,
    fullResultRouteMaterializationsBefore:4,
    fullResultRouteMaterializationsAfter:1,
    payloadOnlyMaterializationsAfter:2,
  },
  representativeNativeTurn:{
    prepareWallMs,
    performanceReceipt,
    promptPlan:{totalTokens:plan?.totalTokens??plan?.budget?.allocated??null,segmentCount:plan?.segments?.length??null,deferralCount:plan?.deferred?.length??plan?.deferrals?.length??null},
  },
  safety:{rawPromptCaptured:false,storyTextCaptured:false,loreBodiesCaptured:false,credentialsCaptured:false,hiddenReasoningCaptured:false},
  limitations:['Node microbenchmark is not a browser heap trace.','The 501-token value is installed-run reference evidence, not synthesized by this fixture.'],
};
console.log(JSON.stringify(result));
