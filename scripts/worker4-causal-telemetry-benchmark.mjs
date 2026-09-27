import {performance} from 'node:perf_hooks';
import {DemoEvidenceJournal} from '../src/ui-core/demo-visibility.js';
import {SelectedTurnCausalReportReader} from '../src/selected-turn-causal-report.js';

const memory=()=>{const map=new Map();return{getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)};};
const selection={chatId:'bench:chat',turnId:'bench:turn',generationId:'bench:generation',correlationId:'bench:correlation',worldRevision:9,sceneRevision:4,sourceRevisionRefs:['scene:bench:r4']};
const stages=['hostObservation','scene','hotCognition','cognitiveChoice','sensory','retrieval','truth','runtime','jev','sidecar','vectoring','precision','gather','contextSeal','promptPlan','contextReceipt','compiledDelivery','delivery','learning','memory','lore'];
const producers=Object.fromEntries(stages.map((stage,index)=>[stage,{
  kind:'BenchmarkOwnerReceipt',id:'bench:'+stage,status:['jev','sidecar','vectoring'].includes(stage)?'SKIPPED':'PUBLISHED',
  lifecycleState:['jev','sidecar','vectoring'].includes(stage)?'SKIPPED':'PUBLISHED',reasonCode:['jev','sidecar','vectoring'].includes(stage)?'OPTIONAL_RESOURCE_NOT_REQUIRED':'EVIDENCE_PUBLISHED',
  durationMs:0.05+(index%5)*0.02,worldRevision:9,sceneRevision:4,sourceRevisionRefs:['scene:bench:r4'],
  metadata:['jev','sidecar','vectoring'].includes(stage)?{configured:true,qualified:true,physicalAttempt:false,returned:false}:undefined,
}]));
const expectedWork={items:Array.from({length:8},(_,index)=>({
  expectedId:'bench:expected:'+index,owner:index%2?'MEMORY':'SCENE',ownerSignalId:'bench:signal:'+index,status:index%4===0?'SKIPPED_WITH_REASON':'DONE',
  reasonCode:index%4===0?'OPTIONAL_RESOURCE_UNAVAILABLE':'OWNER_ACCEPTED',taskId:'bench:task:'+index,
  cause:{chatId:selection.chatId,turnId:selection.turnId,generationId:selection.generationId,correlationId:selection.correlationId,worldRevision:9,sceneRevision:4,sourceRevisionRefs:['scene:bench:r4']},
  evidenceStages:index%4===0?[]:[
    {id:'bench:e:'+index+':start',eventKind:'PHYSICAL_EXECUTION_STARTED',producerId:'RUNTIME',consumerId:'WORKER',durationMs:0.04},
    {id:'bench:e:'+index+':return',eventKind:'RESULT_RETURNED',producerId:'WORKER',consumerId:'OWNER',parentReceiptId:'bench:e:'+index+':start',durationMs:0.08},
    {id:'bench:e:'+index+':accept',eventKind:'OWNER_ADMISSION',producerId:'OWNER',consumerId:'COGNITIVE_STATE',parentReceiptId:'bench:e:'+index+':return',ownerAccepted:true,durationMs:0.01},
  ],
}))};
const ownerReceipt={
  kind:'NativeBrainSelectedTurnReceipt',contractVersion:2,...selection,producers,expectedWork,
  delivery:{planned:{state:'PLANNED',promptPlanId:'bench:plan'},compiled:{state:'COMPILED_AND_SEALED',contextSealId:'bench:seal'},hostObserved:{state:'OBSERVED',requestId:'bench:request',matching:true,live:false,observedRoles:['system','user']}},
};
const cognition={data:{
  scatter:{jobs:Array.from({length:8},(_,index)=>({jobId:'bench:job:'+index,status:index<4?'OWNER_ACCEPTED':'ADMITTED_LOGICAL',physicalExecutionEvidence:index<4?'EVIDENCE':'NO_EVIDENCE',resultReturned:index<4,ownerAccepted:index<4,taskIds:['bench:task:'+index]})),resourceIds:['native:cpu'],resourceCount:1},
  gather:{state:'COMPLETE',counts:{ADMITTED:4,LATE:1,STALE:1,REJECTED:1,INVALID:0},results:[
    {resultId:'bench:r:1',taskId:'bench:job:0',status:'ADMITTED',accepted:true,resourceId:'native:cpu'},
    {resultId:'bench:r:2',taskId:'bench:job:1',status:'ADMITTED',accepted:true,resourceId:'native:cpu'},
    {resultId:'bench:r:late',taskId:'bench:job:4',status:'LATE',accepted:false,resourceId:'optional:jev',providerAttempted:true,reasonCode:'LATE_RESULT'},
  ]},
  seal:{sealedState:true,sealId:'bench:seal',effectiveAdmittedResultIds:['bench:r:1','bench:r:2'],lateResultIds:['bench:r:late']},
}};
const diagnostics={resources:{rows:[
  {id:'optional:jev',kind:'JEV',state:'CONNECTED',callable:true,physicalExecutionAttempted:false,physicalExecutionReturned:false,ownerAccepted:null},
  {id:'optional:sidecar',kind:'SIDECAR',state:'CONNECTED',callable:true,physicalExecutionAttempted:false,physicalExecutionReturned:false,ownerAccepted:null},
  {id:'optional:vectoring',kind:'VECTORING',state:'CONNECTED',callable:true,physicalExecutionAttempted:false,physicalExecutionReturned:false,ownerAccepted:null},
]}};
const promptPlan={kind:'PromptPlan',promptPlanId:'bench:plan',status:'PUBLISHED',totalTokens:1800,budgetTotal:4096,seal:{sealedState:true}};

const journal=new DemoEvidenceJournal({storage:memory(),namespace:'worker4-benchmark',now:()=>1});
const reader=new SelectedTurnCausalReportReader({journal,selectionProvider:()=>selection,now:()=>2});
const snapshot={selection,ownerReceipt,cognition,diagnostics,promptPlan};
for(let i=0;i<25;i++){journal.recordSnapshot(snapshot);reader.read();}

const iterations=1000;
const recordTimes=[],readTimes=[],exportTimes=[];
for(let i=0;i<iterations;i++){
  let start=performance.now();journal.recordSnapshot(snapshot);recordTimes.push(performance.now()-start);
  start=performance.now();reader.read();readTimes.push(performance.now()-start);
  if(i<100){start=performance.now();reader.exportDetailed();exportTimes.push(performance.now()-start);}
}
const stats=values=>{
  const sorted=[...values].sort((a,b)=>a-b),sum=values.reduce((a,b)=>a+b,0);
  return{avgMs:round(sum/values.length),p95Ms:round(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*0.95))]),maxMs:round(sorted.at(-1)??0)};
};
const result={
  evidenceClass:'LOCAL_DETERMINISTIC_NODE',iterations,journalRecord:stats(recordTimes),reportRead:stats(readTimes),reportExport:stats(exportTimes),
  retained:journal.status(),reportAssembledOnDemand:true,generationPathInstrumentedByBenchmark:false,
};
console.log('WORKER4_CAUSAL_TELEMETRY_OVERHEAD '+JSON.stringify(result));

function round(value){return Math.round(Number(value)*1000)/1000;}
