import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root=process.cwd(),label=process.env.PROFILE_LABEL??'profile';
const mod=(p)=>import(pathToFileURL(path.join(root,p)).href+'?profile='+Date.now()+Math.random());
const {DemoEvidenceJournal}=await mod('src/ui-core/demo-visibility.js');
const {CoprocessorTelemetry}=await mod('src/coprocessor/telemetry.js');
const {TelemetryEvent}=await mod('src/coprocessor/constants.js');
const {createCognitionUiReadModelReader}=await mod('src/coprocessor/coprocessor-ui-read-model.js');
const {createDevelopmentDeploymentSillyTavernSession}=await mod('src/deployment/sillytavern-live.js');

const selection={chatId:'chat:profile',turnId:'turn:profile',generationId:'gen:profile',correlationId:'corr:profile',worldRevision:1,sceneRevision:1};
function storage(){
  const data=new Map();let reads=0,writes=0;
  return{data,get reads(){return reads;},get writes(){return writes;},getItem(k){reads+=1;return data.get(k)??null;},setItem(k,v){writes+=1;data.set(k,String(v));},removeItem(k){data.delete(k);}};
}
const jobs=['CONTEXT_COMPILER','CONTEXT_SEAL','GATHER','PRECISION','RETRIEVAL','TRUTH'].map((jobId,i)=>({jobId,sequence:i+1,status:'EXECUTED',owner:'COGNITIVE_CORE'}));
function snapshot(){
  return{
    operations:{selection,stages:[{id:'runtime',label:'Runtime',state:'LIVE',reason:'current'},{id:'gather',label:'Gather',state:'LIVE',reason:'current'},{id:'seal',label:'Context Seal',state:'LIVE',reason:'current'}],inspections:{runtime:{available:true,receiptRef:'runtime:profile',payload:{receipt:{...selection,resourceCount:1,resourceIds:['native-brain-local-cpu'],jobs}}},gather:{available:true,receiptRef:'gather:profile'},seal:{available:true,receiptRef:'seal:profile'}},pipeline:{mappingReceipt:true,logicalJobsMapped:6,mappedResourceCount:1,executionReceipt:false,physicalExecutionAttempts:0}},
    diagnostics:{resources:{rows:[{id:'jev:primary',kind:'JEV',state:'READY',callable:true,physicalExecutionAttempted:false},{id:'sidecar:primary',kind:'SIDECAR',state:'READY',callable:true,physicalExecutionAttempted:false}]}},
    cognition:{data:{scatter:{jobs:jobs.map(row=>({jobId:row.jobId,state:'EXECUTED',resourceId:null}))},jev:{state:'SKIPPED',outcome:'JEV_NOT_REQUIRED'},gather:{state:'COMPLETE',counts:{ADMITTED:1,STALE:0,LATE:0,REJECTED:0,INVALID:0},results:[]},seal:{sealedState:true,admittedResultIds:[]}}},
    promptPlan:{data:{promptPlanId:'plan:profile',generationId:selection.generationId,totalTokens:499,budgetTotal:4096}},
  };
}
function heap(){global.gc?.();return Number(process.memoryUsage().heapUsed);}

const s=storage(),journal=new DemoEvidenceJournal({storage:s,namespace:'repair2-profile',now:()=>1000});
const heapJournalBefore=heap(),journalStart=performance.now();
for(let i=0;i<120;i+=1)journal.recordSnapshot({selection,...snapshot()});
const journalMs=performance.now()-journalStart,heapJournalAfter=heap();
const stored=[...s.data.values()][0]??'';

const telemetry=new CoprocessorTelemetry({limit:2000});
for(let i=0;i<2000;i+=1)telemetry.emit(TelemetryEvent.PROVIDER_HEALTH,{providerProfileId:'provider:'+i,health:'HEALTHY'});
const originalList=telemetry.list.bind(telemetry);let listCalls=0,rowsReturned=0,requestedLimits=[];
telemetry.list=(options)=>{const rows=originalList(options);listCalls+=1;rowsReturned+=rows.length;requestedLimits.push(options?.limit??null);return rows;};
const reader=createCognitionUiReadModelReader({telemetry,eventWindow:512,resourceConnections:{listResources:()=>[]}});
const heapReadBefore=heap(),readStart=performance.now();
for(let i=0;i<30;i+=1)reader.read(selection);
const readMs=performance.now()-readStart,heapReadAfter=heap();

function host(){
  const listeners=new Map(),eventTypes={MESSAGE_SENT:'message_sent',MESSAGE_RECEIVED:'message_received',MESSAGE_EDITED:'message_edited',MESSAGE_DELETED:'message_deleted',MESSAGE_UPDATED:'message_updated',MESSAGE_SWIPED:'message_swiped',MESSAGE_SWIPE_DELETED:'message_swipe_deleted',CHAT_CHANGED:'chat_changed',CHAT_LOADED:'chat_loaded',CHAT_CREATED:'chat_created',CHAT_RENAMED:'chat_renamed',WORLDINFO_UPDATED:'worldinfo_updated',WORLDINFO_SETTINGS_UPDATED:'worldinfo_settings_updated',GENERATION_STARTED:'generation_started',GENERATION_ENDED:'generation_ended',GENERATION_STOPPED:'generation_stopped'};
  const context={chatId:'chat:profile',chat:[],eventTypes,eventSource:{on(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeListener(type,fn){listeners.get(type)?.delete(fn);}},async setExtensionPrompt(){}};
  return{sillyTavern:{getContext:()=>context},listeners};
}
const h=host();let deliveries=0;
const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern:h.sillyTavern,document:null,mountUi:false,onEvidence:()=>{deliveries+=1;}});
session.start();
const countListeners=()=>[...h.listeners.values()].reduce((sum,set)=>sum+set.size,0);
const listenersMounted=countListeners(),gen=[...(h.listeners.get('generation_started')??[])][0];
for(let i=0;i<100;i+=1)gen?.({sequence:i,prompt:'DO NOT RETAIN'});
await new Promise(resolve=>setImmediate(resolve));
const load=typeof session.loadDiagnostics==='function'?session.loadDiagnostics():null;
session.stop();const listenersAfterStop=countListeners();session.destroy();

const out={
  label,
  journal:{snapshots:120,storageReads:s.reads,storageWrites:s.writes,storedBytes:stored.length,elapsedMs:Number(journalMs.toFixed(3)),heapDeltaBytes:heapJournalAfter-heapJournalBefore,status:journal.status?.()??null},
  cognition:{retainedEvents:2000,reads:30,listCalls,rowsReturned,rowsPerRead:rowsReturned/30,requestedLimit:[...new Set(requestedLimits)].map(x=>x??'FULL'),elapsedMs:Number(readMs.toFixed(3)),heapDeltaBytes:heapReadAfter-heapReadBefore},
  notifications:{requestedStimuli:101,deliveries,listenersMounted,listenersAfterStop,load},
};
console.log('CLIENT_REPAIR_WAVE2_PROFILE '+JSON.stringify(out));
