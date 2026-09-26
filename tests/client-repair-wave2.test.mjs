import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoEvidenceJournal } from '../src/ui-core/demo-visibility.js';
import { CoprocessorTelemetry } from '../src/coprocessor/telemetry.js';
import { TelemetryEvent } from '../src/coprocessor/constants.js';
import { createCognitionUiReadModelReader } from '../src/coprocessor/coprocessor-ui-read-model.js';
import { createDevelopmentDeploymentSillyTavernSession } from '../src/deployment/sillytavern-live.js';

const selection={chatId:'chat:repair2',turnId:'turn:repair2',generationId:'gen:repair2',correlationId:'corr:repair2',worldRevision:4,sceneRevision:2};

function countingStorage(){
  const data=new Map();let reads=0,writes=0;
  return{data,get reads(){return reads;},get writes(){return writes;},getItem(k){reads+=1;return data.get(k)??null;},setItem(k,v){writes+=1;data.set(k,String(v));},removeItem(k){data.delete(k);}};
}

function representativeSnapshot(){
  const ids=['CONTEXT_COMPILER','CONTEXT_SEAL','GATHER','PRECISION','RETRIEVAL','TRUTH'];
  const nativeJobs=ids.map((jobId,index)=>({jobId,sequence:index+1,status:'EXECUTED',owner:'COGNITIVE_CORE'}));
  const optionalJobs=ids.map(jobId=>({jobId,capability:'Cognitive job',state:'EXECUTED',resourceId:null,provider:null,model:null}));
  return{
    operations:{
      selection,
      stages:[
        {id:'runtime',label:'Runtime',state:'LIVE',reason:'Runtime owner receipt current.'},
        {id:'coprocessor',label:'Coprocessor',state:'LIVE',reason:'Optional resources connected.'},
        {id:'truth',label:'Truth',state:'LIVE',reason:'Truth current.'},
        {id:'jev',label:'Jev',state:'IDLE',reason:'JEV_NOT_REQUIRED'},
        {id:'gather',label:'Gather',state:'LIVE',reason:'Gather current.'},
        {id:'seal',label:'Context Seal',state:'LIVE',reason:'Seal current.'},
        {id:'promptPlan',label:'PromptPlan',state:'LIVE',reason:'Plan current.'},
      ],
      inspections:{
        runtime:{available:true,receiptRef:'runtime:repair2',payload:{kind:'Runtime detail',receipt:{kind:'RuntimeTurnReceipt',...selection,resourceCount:1,resourceIds:['native-brain-local-cpu'],jobs:nativeJobs}}},
        coprocessor:{available:true,receiptRef:'coprocessor:repair2'},
        truth:{available:true,receiptRef:'truth:repair2'},
        jev:{available:true,receiptRef:'jev:repair2'},
        gather:{available:true,receiptRef:'gather:repair2'},
        seal:{available:true,receiptRef:'seal:repair2'},
        promptPlan:{available:true,receiptRef:'plan:repair2'},
      },
      pipeline:{mappingReceipt:true,logicalJobsMapped:6,mappedResourceCount:1,mappedResourceIds:['native-brain-local-cpu'],executionReceipt:false,physicalExecutionAttempts:0,physicalExecutionSucceeded:0,physicalExecutionFailed:0,resultReceipt:true,returnedResults:1,admissionReceipt:true,contextAdmitted:1},
    },
    diagnostics:{resources:{rows:[
      {id:'jev:primary',kind:'JEV',state:'READY',callable:true,physicalExecutionAttempted:false,physicalExecutionSucceeded:false,ownerAccepted:null,measurementClass:'MEASURED_LIVE',apiKey:'sk-secret-do-not-persist'},
      {id:'sidecar:primary',kind:'SIDECAR',state:'READY',callable:true,physicalExecutionAttempted:false,physicalExecutionSucceeded:false,ownerAccepted:null,measurementClass:'MEASURED_LIVE'},
      {id:'vector:primary',kind:'VECTORING',state:'CONFIGURED',callable:false,physicalExecutionAttempted:false,physicalExecutionSucceeded:false,ownerAccepted:null,measurementClass:'MEASURED_LIVE'},
    ]}},
    cognition:{data:{
      scatter:{kind:'NormalizedScatterReceipt',...selection,resourceCount:0,jobs:optionalJobs,rawPrompt:'RAW PROMPT MUST NOT PERSIST'},
      jev:{state:'SKIPPED',outcome:'JEV_NOT_REQUIRED'},
      gather:{kind:'NormalizedGatherReceipt',...selection,state:'COMPLETE',counts:{ADMITTED:1,STALE:0,LATE:0,REJECTED:0,INVALID:0},results:[{resultId:'result:gather:1',taskId:'GATHER',status:'ADMITTED',accepted:true,resourceId:null,destination:'FOREGROUND',capability:'Result'}]},
      seal:{sealId:'seal:repair2',sealedState:true,admittedResultIds:['result:gather:1']},
    }},
    promptPlan:{data:{promptPlanId:'plan:repair2',generationId:selection.generationId,totalTokens:499,budgetTotal:4096,prompt:'RAW PROMPT MUST NOT PERSIST',storyText:'STORY MUST NOT PERSIST'}},
  };
}

test('same-turn journal snapshots avoid repeated localStorage parse/stringify work and stay byte bounded',()=>{
  const storage=countingStorage(),journal=new DemoEvidenceJournal({storage,namespace:'repair2',maxStoredBytes:32768,now:()=>1000});
  const snap=representativeSnapshot();
  for(let i=0;i<100;i+=1)journal.recordSnapshot({selection,...snap});
  const status=journal.status();
  assert.equal(storage.reads,1);
  assert.equal(storage.writes,1);
  assert.equal(status.storageLoads,1);
  assert.equal(status.writes,1);
  assert.equal(status.skippedRedundantWrites,99);
  assert.ok(status.serializedBytes<=32768,status.serializedBytes);
  assert.equal(status.metadataOnly,true);
});

test('selected-turn export distinguishes six native jobs from zero optional provider executions and records lifecycle states honestly',()=>{
  const journal=new DemoEvidenceJournal({storage:countingStorage(),namespace:'audit',now:()=>2000});
  const snap=representativeSnapshot(),turn=journal.recordSnapshot({selection,...snap});
  const audit=turn.entries.find(row=>row.type==='JOB_AUDIT');
  assert.ok(audit);assert.equal(audit.metadata.logicalJobCount,6);
  assert.deepEqual(audit.metadata.nativeResourceIds,['native-brain-local-cpu']);
  assert.deepEqual(audit.metadata.optionalExecutionResourceIds,[]);
  assert.equal(audit.metadata.jobs.every(row=>row.assignedNativeResourceId==='native-brain-local-cpu'),true);
  assert.equal(audit.metadata.jobs.every(row=>row.assignedOptionalResourceId==null),true);
  assert.equal(audit.metadata.jobs.find(row=>row.jobId==='GATHER').contextSealResultIds[0],'result:gather:1');

  const lifecycle=turn.entries.find(row=>row.type==='OPTIONAL_RESOURCE_LIFECYCLE');
  assert.ok(lifecycle);const jev=lifecycle.metadata.resources.find(row=>row.kind==='JEV');
  assert.equal(jev.configured,true);assert.equal(jev.qualifiedCallable,true);assert.equal(jev.attempted,false);
  assert.equal(jev.failed,false);assert.equal(jev.ownerAccepted,false);assert.equal(jev.skipReason,'JEV_NOT_REQUIRED');

  const json=JSON.stringify(journal.exportEvidence({selection}));
  for(const forbidden of ['RAW PROMPT MUST NOT PERSIST','STORY MUST NOT PERSIST','sk-secret-do-not-persist'])assert.equal(json.includes(forbidden),false,forbidden);
  assert.match(json,/native-brain-local-cpu/);
  assert.match(json,/JEV_NOT_REQUIRED/);
});

test('failed optional execution stays distinct from intentional Jev skip and owner acceptance',()=>{
  const journal=new DemoEvidenceJournal({storage:countingStorage(),namespace:'failed-resource',now:()=>2500});
  const snap=representativeSnapshot();
  snap.diagnostics.resources.rows=snap.diagnostics.resources.rows.map(row=>row.kind==='SIDECAR'?{
    ...row,physicalExecutionAttempted:true,physicalExecutionSucceeded:false,ownerAccepted:false,
    lastExecution:{status:'FAIL',executionId:'sidecar:failed:1',latencyMs:37},
    lastFailure:{status:'FAIL',code:'PROVIDER_UNAVAILABLE'},
  }:row);
  const turn=journal.recordSnapshot({selection,...snap});
  const lifecycle=turn.entries.find(row=>row.type==='OPTIONAL_RESOURCE_LIFECYCLE');
  const jev=lifecycle.metadata.resources.find(row=>row.kind==='JEV');
  const sidecar=lifecycle.metadata.resources.find(row=>row.kind==='SIDECAR');
  assert.equal(jev.skipReason,'JEV_NOT_REQUIRED');assert.equal(jev.attempted,false);assert.equal(jev.failed,false);
  assert.equal(sidecar.attempted,true);assert.equal(sidecar.succeeded,false);assert.equal(sidecar.failed,true);assert.equal(sidecar.ownerAccepted,false);
});

test('cognition UI projection consumes a bounded recent telemetry window while full telemetry remains available on demand',()=>{
  const telemetry=new CoprocessorTelemetry({limit:2000});
  for(let i=0;i<2000;i+=1)telemetry.emit(TelemetryEvent.PROVIDER_HEALTH,{providerProfileId:'provider:'+i,health:'HEALTHY'});
  assert.equal(telemetry.list().length,2000);
  assert.strictEqual(telemetry.snapshot(),telemetry.snapshot(),'snapshot should be cached until the next event');

  const original=telemetry.list.bind(telemetry);let projectedRows=0,calls=0,lastLimit=null;
  telemetry.list=(options)=>{lastLimit=options?.limit??null;const rows=original(options);projectedRows+=rows.length;calls+=1;return rows;};
  const reader=createCognitionUiReadModelReader({telemetry,eventWindow:512,resourceConnections:{listResources:()=>[]}});
  for(let i=0;i<10;i+=1)reader.read(selection);
  assert.equal(lastLimit,512);assert.equal(calls,10);assert.equal(projectedRows,5120);
  assert.equal(reader.eventWindow,512);
});

function makeHost(){
  const listeners=new Map();
  const eventTypes={
    MESSAGE_SENT:'message_sent',MESSAGE_RECEIVED:'message_received',MESSAGE_EDITED:'message_edited',MESSAGE_DELETED:'message_deleted',MESSAGE_UPDATED:'message_updated',
    MESSAGE_SWIPED:'message_swiped',MESSAGE_SWIPE_DELETED:'message_swipe_deleted',CHAT_CHANGED:'chat_changed',CHAT_LOADED:'chat_loaded',CHAT_CREATED:'chat_created',
    CHAT_RENAMED:'chat_renamed',WORLDINFO_UPDATED:'worldinfo_updated',WORLDINFO_SETTINGS_UPDATED:'worldinfo_settings_updated',GENERATION_STARTED:'generation_started',
    GENERATION_ENDED:'generation_ended',GENERATION_STOPPED:'generation_stopped',
  };
  const context={chatId:'chat:repair2',chat:[],eventTypes,eventSource:{on(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeListener(type,fn){listeners.get(type)?.delete(fn);}},async setExtensionPrompt(){}};
  return{sillyTavern:{getContext:()=>context},context,listeners};
}
const listenerCount=(listeners)=>[...listeners.values()].reduce((sum,set)=>sum+set.size,0);

test('live evidence notifications coalesce redundant host updates and start/stop/remount cycles do not accumulate listeners',async()=>{
  const {sillyTavern,listeners}=makeHost();let deliveries=0;
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,onEvidence:()=>{deliveries+=1;}});
  session.start();const firstListeners=listenerCount(listeners);assert.ok(firstListeners>0);
  const generationStarted=[...(listeners.get('generation_started')??[])][0];assert.equal(typeof generationStarted,'function');
  for(let i=0;i<100;i+=1)generationStarted({sequence:i,prompt:'DO NOT RETAIN'});
  await new Promise(resolve=>setImmediate(resolve));
  const live=session.loadDiagnostics();
  assert.equal(deliveries,1);
  assert.equal(live.notification.requested,101);
  assert.equal(live.notification.delivered,1);
  assert.equal(live.notification.coalesced,100);
  assert.equal(live.hostListenerCount,firstListeners);
  assert.equal(JSON.stringify(session.exportEvidence()).includes('DO NOT RETAIN'),false);

  session.stop();assert.equal(listenerCount(listeners),0);assert.equal(session.loadDiagnostics().hostListenerCount,0);
  session.start();assert.equal(listenerCount(listeners),firstListeners);
  session.stop();assert.equal(listenerCount(listeners),0);
  session.destroy();assert.equal(listenerCount(listeners),0);
});
