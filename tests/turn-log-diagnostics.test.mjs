import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoEvidenceJournal } from '../src/ui-core/demo-visibility.js';
import { SelectedTurnLogModel, installTurnLogDiagnosticsWorkspace } from '../src/ui-core/turn-log-diagnostics.js';
import { WorkspaceRegistry } from '../src/ui-core/registry.js';

function memoryStorage(){
  const map=new Map();
  return{map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)};
}
const baseSelection={chatId:'chat:demo',turnId:'turn:demo',generationId:'gen:demo',correlationId:'corr:demo',worldRevision:17,sceneRevision:9,sourceRevisionRefs:['source:r17']};
const jobIds=['HOT','SENSORY','JEV','PRECISION','RETRIEVAL','TRUTH'];

function snapshot({selection=baseSelection,optionalRows=null,gatherResults=null,gatherCounts=null,hostDelivery=null,liveError=null,jevReason='JEV_NOT_REQUIRED'}={}){
  const jobs=jobIds.map((jobId,index)=>({jobId,sequence:index+1,status:'EXECUTED',owner:'COGNITIVE_CORE'}));
  const results=gatherResults??Array.from({length:32},(_,index)=>({
    resultId:'result:'+(index+1),
    ...(index<6?{taskId:jobIds[index]}:{}),
    status:'ADMITTED',accepted:true,resourceId:'native-brain-local-cpu',
    destination:'GATHER',capability:index<6?jobIds[index]:'CURRENT_CONTEXT',providerAttempted:false,
    completedAt:1700000001000+index,
  }));
  const counts=gatherCounts??{ADMITTED:32,LATE:0,STALE:0,REJECTED:0,INVALID:0};
  const stages=[
    {id:'runtime',label:'Runtime',state:'LIVE',reason:'Owner runtime receipt published.'},
    {id:'coprocessor',label:'Coprocessor',state:'LIVE',reason:'Resource telemetry current.'},
    {id:'choice',label:'Cognitive Choice',state:'LIVE',reason:'Choice receipt published.'},
    {id:'jev',label:'Jev',state:'LIVE',reason:jevReason},
    {id:'gather',label:'Gather',state:'LIVE',reason:'Gather receipt published.'},
    {id:'seal',label:'Context Seal',state:'LIVE',reason:'Seal receipt published.'},
    {id:'promptPlan',label:'PromptPlan',state:'LIVE',reason:'PromptPlan published.'},
    {id:'generation',label:'SillyTavern prompt delivery',state:hostDelivery?'LIVE':'IDLE',reason:hostDelivery?'Host receipt published.':'No host delivery receipt.'},
  ];
  const operations={
    selection,stages,pipeline:{mappingReceipt:true,logicalJobsMapped:6,mappedResourceCount:0,executionReceipt:false,physicalExecutionAttempts:0,physicalExecutionSucceeded:0,resultReceipt:true,returnedResults:results.length,admissionReceipt:true,contextAdmitted:counts.ADMITTED,promptPlanReceipt:true,deliveryReceipt:Boolean(hostDelivery)},
    inspections:{
      runtime:{receiptRef:'runtime:receipt',available:true,payload:{receipt:{receiptId:'runtime:receipt',jobs,admittedJobCount:6,resourceCount:1,resourceIds:['native-brain-local-cpu'],executionComplete:true}}},
      ...(hostDelivery?{generation:{receiptRef:hostDelivery.receiptId,available:true,payload:hostDelivery}}:{}),
    },
  };
  const diagnostics={
    host:{liveBinding:{reads:12,rejected:liveError?1:0,lastError:liveError??null}},
    resources:{rows:optionalRows??[
      {id:'jev:openrouter',kind:'JEV',displayName:'Jev',state:'READY',callable:true,physicalExecutionAttempted:false,physicalExecutionSucceeded:false,measurementClass:'MEASURED_LIVE'},
      {id:'sidecar:openrouter',kind:'SIDECAR',displayName:'Sidecar',state:'READY',callable:true,physicalExecutionAttempted:false,physicalExecutionSucceeded:false,measurementClass:'MEASURED_LIVE'},
    ]},
  };
  const cognition={data:{
    choice:{admitted:jobIds,skipped:[]},
    scatter:{receiptId:'scatter:receipt',jobs:jobIds.map(jobId=>({jobId,capability:jobId,state:'MAPPED',resourceId:null}))},
    jev:{reasonCode:jevReason,outcome:jevReason},
    gather:{receiptId:'gather:receipt',counts,results},
    seal:{sealId:'seal:receipt',sealedState:true,admittedResultIds:results.filter(row=>row.status==='ADMITTED').map(row=>row.resultId)},
  }};
  const promptPlan={data:{promptPlanId:'prompt-plan:demo',generationId:selection.generationId,status:'PUBLISHED',totalTokens:499,budgetTotal:4096,seal:{sealedState:true}}};
  return{selection,operations,diagnostics,cognition,promptPlan};
}

test('six-job demo shape explains native execution, zero optional attempts, 32 Gather admissions, and honest unknown attribution',()=>{
  let now=1700000000000;
  const storage=memoryStorage(),journal=new DemoEvidenceJournal({storage,now:()=>++now});
  journal.recordSnapshot(snapshot());
  const model=new SelectedTurnLogModel({journal,selectionProvider:()=>baseSelection,now:()=>now});
  const log=model.read();
  assert.equal(log.summary.logicalJobs,6);
  assert.equal(log.summary.nativeResources,1);
  assert.equal(log.summary.optionalAttempts,0);
  assert.equal(log.summary.gatherAdmitted,32);
  const jobs=log.rows.filter(row=>row.stage==='Fan-out job');
  assert.equal(jobs.length,6);
  assert.ok(jobs.every(row=>row.resourceId==='native-brain-local-cpu'));
  const jev=log.rows.find(row=>row.resourceId==='jev:openrouter');
  assert.equal(jev.status,'SKIPPED');
  assert.equal(jev.reasonCode,'JEV_NOT_REQUIRED');
  assert.match(jev.summary,/No provider attempt occurred/);
  const attributed=log.rows.find(row=>row.resultId==='result:1');
  assert.equal(attributed.jobId,'HOT');
  const unknown=log.rows.find(row=>row.resultId==='result:20');
  assert.equal(unknown.jobId,null);
  assert.match(unknown.summary,/job attribution unknown/);
  assert.equal(log.summary.hostDeliveryState,'NOT OBSERVED');
  assert.equal(log.rows.find(row=>row.reasonCode==='HOST_DELIVERY_NOT_OBSERVED')?.status,'UNKNOWN');
  assert.equal(log.rows.find(row=>row.reasonCode==='HOST_EVENT_TYPE_NOT_RETAINED')?.status,'UNKNOWN');
});

test('optional lifecycle separates intentional skip, provider failure, and successful execution without owner acceptance',()=>{
  let now=1700000100000;
  const journal=new DemoEvidenceJournal({storage:memoryStorage(),now:()=>++now});
  const rows=[
    {id:'jev:openrouter',kind:'JEV',state:'READY',callable:true,physicalExecutionAttempted:false,measurementClass:'MEASURED_LIVE'},
    {id:'sidecar:failed',kind:'SIDECAR',state:'DEGRADED',callable:true,physicalExecutionAttempted:true,physicalExecutionSucceeded:false,lastExecution:{status:'FAIL',receiptId:'exec:fail'},lastFailure:{code:'PROVIDER_TIMEOUT'},measurementClass:'MEASURED_LIVE'},
    {id:'sidecar:success',kind:'SIDECAR',state:'READY',callable:true,physicalExecutionAttempted:true,physicalExecutionSucceeded:true,lastExecution:{status:'SUCCESS',receiptId:'exec:success'},ownerAccepted:false,ownerAcceptanceSource:null,measurementClass:'MEASURED_LIVE'},
  ];
  journal.recordSnapshot(snapshot({optionalRows:rows}));
  const log=new SelectedTurnLogModel({journal,selectionProvider:()=>baseSelection,now:()=>now}).read();
  assert.equal(log.rows.find(row=>row.resourceId==='jev:openrouter')?.status,'SKIPPED');
  assert.equal(log.rows.find(row=>row.resourceId==='sidecar:failed'&&row.stage==='Optional resource')?.status,'FAILED');
  assert.equal(log.rows.find(row=>row.resourceId==='sidecar:success'&&row.stage==='Optional resource')?.status,'SUCCEEDED_OWNER_NOT_ACCEPTED');
  assert.equal(log.summary.optionalAttempts,2);
});

test('source-fence failure remains attributed to selected revisions and secret-shaped text is excluded',()=>{
  let now=1700000200000;
  const journal=new DemoEvidenceJournal({storage:memoryStorage(),now:()=>++now});
  journal.recordSnapshot(snapshot({liveError:{stage:'ContextSeal',code:'LIVE_RECEIPT_STALE',message:'ContextSeal references source:r16 outside source:r17; authorization=Bearer-should-not-survive api_key=sk-supersecretvalue'}}));
  const model=new SelectedTurnLogModel({journal,selectionProvider:()=>baseSelection,now:()=>now});
  const log=model.read();
  const error=log.rows.find(row=>row.category==='ERROR'&&row.reasonCode==='LIVE_RECEIPT_STALE');
  assert.ok(error);
  const detail=model.detail(error.id);
  assert.deepEqual(detail.sources[0].metadata.sourceRevisionRefs,['source:r17']);
  const exported=JSON.stringify(model.exportMetadata());
  assert.equal(exported.includes('sk-supersecretvalue'),false);
  assert.equal(exported.includes('Bearer-should-not-survive'),false);
  assert.match(exported,/\[REDACTED\]/);
});

test('late results stay separate from seal admission and exact host observation is distinguished from PromptPlan',()=>{
  let now=1700000300000;
  const results=[
    {resultId:'result:late',taskId:'HOT',status:'LATE',accepted:false,resourceId:'native-brain-local-cpu',destination:'GATHER',capability:'HOT',completedAt:1700000300100},
    {resultId:'result:ok',taskId:'TRUTH',status:'ADMITTED',accepted:true,resourceId:'native-brain-local-cpu',destination:'GATHER',capability:'TRUTH',completedAt:1700000300200},
  ];
  const hostDelivery={kind:'SillyTavernHostDeliveryReceipt',receiptId:'host-delivery:gen:demo',chatId:baseSelection.chatId,turnId:baseSelection.turnId,generationId:baseSelection.generationId,state:'MODEL_REQUEST_PAYLOAD_INJECTED',promptPlanId:'prompt-plan:demo',contextSealId:'seal:receipt',preparedAt:1700000300001,requestInjectedAt:1700000300500,promptInjected:true,hostObserved:true,responseCompleted:false};
  const journal=new DemoEvidenceJournal({storage:memoryStorage(),now:()=>++now});
  journal.recordSnapshot(snapshot({gatherResults:results,gatherCounts:{ADMITTED:1,LATE:1,STALE:0,REJECTED:0,INVALID:0},hostDelivery}));
  const log=new SelectedTurnLogModel({journal,selectionProvider:()=>baseSelection,now:()=>now}).read();
  const late=log.rows.find(row=>row.resultId==='result:late'),ok=log.rows.find(row=>row.resultId==='result:ok');
  assert.equal(late.status,'LATE');
  assert.match(late.summary,/not evidenced in Context Seal/);
  assert.equal(ok.status,'ADMITTED');
  assert.match(ok.summary,/admitted by Context Seal/);
  assert.equal(log.summary.promptPlanState,'PLANNED');
  assert.equal(log.summary.hostDeliveryState,'INJECTED');
  const delivery=log.rows.find(row=>row.stage==='Observed host delivery');
  assert.equal(delivery.receiptId,'host-delivery:gen:demo');
  assert.equal(delivery.time,1700000300500);
});

test('chat switch, regeneration, reload, bounded retention, failed storage, and workspace registration stay safe',()=>{
  let now=1700000400000;
  const storage=memoryStorage(),journal=new DemoEvidenceJournal({storage,maxTurns:2,now:()=>++now});
  const s1={...baseSelection,chatId:'chat:A',turnId:'turn:1',generationId:'gen:1'};
  const s2={...baseSelection,chatId:'chat:A',turnId:'turn:1',generationId:'gen:2'};
  const s3={...baseSelection,chatId:'chat:B',turnId:'turn:9',generationId:'gen:9'};
  journal.recordSnapshot(snapshot({selection:s1}));
  journal.recordSnapshot(snapshot({selection:s2}));
  journal.recordSnapshot(snapshot({selection:s3}));
  assert.equal(journal.status().turnCount,2);
  assert.equal(journal.readTurn(s1),null);
  const model=new SelectedTurnLogModel({journal,selectionProvider:()=>s2,now:()=>now,maxVisibleRows:16});
  assert.ok(model.read().rows.every(row=>row.correlationId===s2.correlationId||row.correlationId==null));
  const reloaded=new DemoEvidenceJournal({storage,namespace:journal.namespace,now:()=>++now});
  assert.equal(new SelectedTurnLogModel({journal:reloaded,selectionProvider:()=>s2,now:()=>now}).read().summary.logicalJobs,6);

  const broken={getItem(){return null;},setItem(){throw new Error('quota failed credential=should-not-leak');},removeItem(){}};
  const degraded=new DemoEvidenceJournal({storage:broken,now:()=>++now});
  degraded.recordSnapshot(snapshot({selection:s3}));
  assert.equal(degraded.status().available,false);
  assert.equal(new SelectedTurnLogModel({journal:degraded,selectionProvider:()=>s3,now:()=>now}).read().summary.logicalJobs,6);

  const registry=new WorkspaceRegistry();
  const mounted=installTurnLogDiagnosticsWorkspace(registry,{journal:reloaded,selectionProvider:()=>s2});
  assert.equal(registry.has('turn-log'),true);
  mounted.release();
  assert.equal(registry.has('turn-log'),false);
});
