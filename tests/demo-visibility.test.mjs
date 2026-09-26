import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoEvidenceJournal } from '../src/ui-core/index.js';

const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const selection={chatId:'chat:demo',turnId:'turn:demo',generationId:'gen:demo',correlationId:'corr:demo',worldRevision:7,sceneRevision:3};

function snapshot(){
  const jobs=Array.from({length:6},(_,i)=>({jobId:'job:'+(i+1),capability:'CAP_'+(i+1),state:'MAPPED',resourceId:'resource:one'}));
  return{
    operations:{
      selection,stages:[
        {id:'runtime',label:'Runtime',state:'LIVE',reason:'Scatter receipt published.'},
        {id:'coprocessor',label:'Coprocessor',state:'LIVE',reason:'Execution telemetry current.'},
        {id:'gather',label:'Gather',state:'LIVE',reason:'Gather receipt published.'},
        {id:'seal',label:'Context Seal',state:'LIVE',reason:'Seal published.'},
        {id:'promptPlan',label:'PromptPlan',state:'LIVE',reason:'Plan published.'},
        {id:'learning',label:'Learning write-back',state:'LIVE',reason:'Learning receipt published.'},
      ],
      inspections:{
        runtime:{available:true,receiptRef:'scatter:demo'},coprocessor:{available:true,receiptRef:'cognition:demo'},gather:{available:true,receiptRef:'gather:demo'},
        seal:{available:true,receiptRef:'seal:demo'},promptPlan:{available:true,receiptRef:'plan:demo'},
        learning:{available:true,receiptRef:'learning:demo',payload:{kind:'LearningReceipt',status:'RECORDED',rawPrompt:'DO_NOT_PERSIST_PROMPT'}},
      },
      pipeline:{mappingReceipt:true,logicalJobsMapped:6,mappedResourceCount:1,executionReceipt:true,physicalExecutionAttempts:1,physicalExecutionSucceeded:1,physicalExecutionFailed:0,learningReceipt:true,learningKind:'LearningReceipt'},
    },
    diagnostics:{resources:{rows:[{id:'resource:one',displayName:'One resource',providerId:'provider:one',modelId:'model:one',workerId:'worker:one',physicalExecutionAttempted:true,physicalExecutionSucceeded:true,lastExecution:{status:'SUCCESS',executionId:'exec:1',latencyMs:42},apiKey:'DO_NOT_PERSIST_KEY'}]}},
    cognition:{data:{
      scatter:{receiptId:'scatter:demo',jobs,rawPrompt:'DO_NOT_PERSIST_PROMPT'},
      gather:{receiptId:'gather:demo',state:'COMPLETE',counts:{ADMITTED:1,LATE:1,STALE:0,REJECTED:0,INVALID:0},results:[
        {resultId:'result:1',status:'ADMITTED',resourceId:'resource:one',destination:'CONTEXT',capability:'CAP_1'},
        {resultId:'result:2',status:'LATE',resourceId:'resource:one',destination:'LATE',capability:'CAP_2'},
      ]},
      seal:{sealId:'seal:demo',sealedState:true,admittedResultIds:['result:1'],lateResultIds:['result:2']},
    }},
    promptPlan:{data:{promptPlanId:'plan:demo',generationId:selection.generationId,totalTokens:900,budgetTotal:4096,seal:{sealedState:true},prompt:'DO_NOT_PERSIST_PROMPT',storyText:'DO_NOT_PERSIST_STORY'}},
  };
}

test('durable evidence journal separates six logical mappings from one physical execution and survives reload',()=>{
  const storage=memory(),first=new DemoEvidenceJournal({storage,namespace:'demo-test',now:()=>1000});
  const s=snapshot(),recorded=first.recordSnapshot({selection,...s});
  assert.ok(recorded);const scatter=recorded.entries.find(x=>x.type==='SCATTER'),attempt=recorded.entries.find(x=>x.type==='RESOURCE_ATTEMPT');
  assert.equal(scatter.metadata.logicalJobCount,6);assert.equal(scatter.metadata.mappedResourceCount,1);assert.match(scatter.detail,/not evidence.*physically executed/i);
  assert.equal(attempt.status,'SUCCEEDED');assert.equal(attempt.metadata.resourceId,'resource:one');
  const second=new DemoEvidenceJournal({storage,namespace:'demo-test',now:()=>2000}),reloaded=second.readTurn(selection);
  assert.equal(reloaded.key,recorded.key);assert.equal(reloaded.entries.length,recorded.entries.length);
  assert.equal(second.readTurn({...selection,chatId:'chat:other'}),null);
});

test('evidence export is readable metadata-only JSON without prompt story credential or hidden-reasoning content',()=>{
  const storage=memory(),journal=new DemoEvidenceJournal({storage,namespace:'export-test',now:()=>3000}),s=snapshot();
  journal.recordSnapshot({selection,...s});
  const exported=journal.exportEvidence({selection}),json=JSON.stringify(exported,null,2);
  assert.equal(exported.turns.length,1);assert.deepEqual(exported.safety,{rawPromptsPersisted:false,storyTextPersisted:false,credentialsPersisted:false,hiddenReasoningPersisted:false,externalDatabaseUsed:false});
  for(const forbidden of ['DO_NOT_PERSIST_PROMPT','DO_NOT_PERSIST_STORY','DO_NOT_PERSIST_KEY'])assert.equal(json.includes(forbidden),false,forbidden);
  for(const required of ['scatter:demo','exec:1','gather:demo','seal:demo','plan:demo','learning:demo'])assert.equal(json.includes(required),true,required);
});

test('unchanged owner evidence is de-duplicated instead of becoming repetitive activity',()=>{
  const storage=memory();let now=10;const journal=new DemoEvidenceJournal({storage,namespace:'dedupe-test',now:()=>now}),s=snapshot();
  const a=journal.recordSnapshot({selection,...s});now=20;const b=journal.recordSnapshot({selection,...s});
  assert.equal(b.entries.length,a.entries.length);
  const ids=a.entries.map(x=>x.id);assert.deepEqual(b.entries.map(x=>x.id),ids);
  assert.deepEqual(b.entries.map(x=>x.at),a.entries.map(x=>x.at));
});
