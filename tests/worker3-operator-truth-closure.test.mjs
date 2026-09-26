import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DemoActivityFeedController,
  DemoEvidenceJournal,
  OperatorLoadTrace,
  Wave13DiagnosticsCenterAdapter,
  buildGenerationExplainability,
  normalizeScatterReceipt,
} from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

class Node extends FakeNode{
  constructor(tag,doc){super(tag,doc);this.id='';this.value='';this.hidden=false;}
  setAttribute(name,value){super.setAttribute(name,value);if(name==='id')this.id=String(value);if(name==='value')this.value=String(value);}
}
class Doc extends FakeDocument{
  constructor(){super();this.body=new Node('body',this);this.documentElement=new Node('html',this);}
  createElement(tag){return new Node(tag,this);}
  createDocumentFragment(){return new Node('fragment',this);}
}
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
const walk=node=>[node,...(node?.children??[]).flatMap(walk)];

const selection={chatId:'chat:truth',turnId:'turn:truth',generationId:'gen:truth',correlationId:'corr:truth',worldRevision:7,sceneRevision:3,sourceRevisionRefs:['scene:r3']};

test('Prompt Inspector keeps planned, compiled/sealed, and observed host evidence distinct',()=>{
  const promptPlan={
    kind:'PromptPlanReadModel',promptPlanId:'plan:truth',generationId:selection.generationId,turnId:selection.turnId,contextSealId:'seal:truth',
    slotAllocation:[{slot:'RELEVANT_LORE',estimatedTokens:0,required:false,protected:false}],
    sectionOrder:['RELEVANT_LORE'],reuseDecisions:[],dropped:[],deferred:[],
    budget:{total:4096,allocated:499,remaining:3597},estimatedTokens:499,
  };
  const contextReceipt={
    kind:'ContextReceiptReadModel',turnId:selection.turnId,generationId:selection.generationId,contextSealId:'seal:truth',promptPlanId:'plan:truth',
    packetId:'packet:truth',includedSections:[],omittedSections:[],
    deferredSections:[{slot:'RELEVANT_LORE',reason:'BUDGET_EXHAUSTED_AFTER_REQUIRED_CONTEXT'}],
    budget:{total:4096,allocated:499},estimatedTokens:499,
  };
  const hostDelivery={
    kind:'SillyTavernHostDeliveryReceipt',receiptId:'host:truth',...selection,state:'MODEL_REQUEST_PAYLOAD_INJECTED',
    promptInjected:true,requestInjectedAt:123,rawPrompt:'DO NOT RETAIN RAW PROMPT',
  };
  const x=buildGenerationExplainability({promptPlan,contextReceipt,hostDeliveryReceipt:hostDelivery});
  const lore=x.sections.find(row=>row.slot==='RELEVANT_LORE');
  assert.equal(lore.plannedState,'INCLUDED');
  assert.equal(lore.compiledState,'DEFERRED');
  assert.equal(lore.state,'DEFERRED');
  assert.equal(lore.observedState,'NO_EVIDENCE');
  assert.equal(lore.reason,'BUDGET_EXHAUSTED_AFTER_REQUIRED_CONTEXT');
  assert.equal(x.deliveryEvidence.planned.state,'PLANNED');
  assert.equal(x.deliveryEvidence.compiled.state,'COMPILED_AND_SEALED');
  assert.equal(x.deliveryEvidence.observed.state,'OBSERVED');
  assert.deepEqual(x.budgetEvidence.planned,{total:4096,allocated:499,remaining:3597});
  assert.deepEqual(x.budgetEvidence.compiled,{total:4096,allocated:499,remaining:3597});
  assert.doesNotMatch(JSON.stringify(x),/DO NOT RETAIN RAW PROMPT/);
});

test('Prompt Inspector does not infer host observation when host delivery evidence is absent',()=>{
  const x=buildGenerationExplainability({
    promptPlan:{kind:'PromptPlanReadModel',promptPlanId:'plan:none',generationId:'gen:none',turnId:'turn:none',slotAllocation:[{slot:'CURRENT_SCENE',estimatedTokens:120}],sectionOrder:['CURRENT_SCENE'],budget:{total:2048,allocated:120}},
    contextReceipt:{kind:'ContextReceiptReadModel',generationId:'gen:none',turnId:'turn:none',promptPlanId:'plan:none',includedSections:['CURRENT_SCENE'],deferredSections:[],omittedSections:[],budget:{total:2048,allocated:120},estimatedTokens:120},
  });
  assert.equal(x.sections[0].compiledState,'INCLUDED');
  assert.equal(x.sections[0].observedState,'NO_EVIDENCE');
  assert.equal(x.deliveryEvidence.observed.state,'NO_EVIDENCE');
});

test('journal exposes whether a repeated selected-turn snapshot changed retained evidence',()=>{
  const journal=new DemoEvidenceJournal({storage:memory(),namespace:'closure-journal',now:()=>100});
  const snapshot={selection,operations:{stages:[{id:'scene',label:'Scene',state:'IDLE',reason:'No owner Scene receipt.'}],inspections:{scene:{available:false,receiptRef:null}},pipeline:{}},diagnostics:{},cognition:{data:{}},promptPlan:null,ownerReceipt:null};
  journal.recordSnapshot(snapshot);
  assert.equal(journal.lastRecordChanged,true);
  assert.equal(journal.status().revision,1);
  journal.recordSnapshot(snapshot);
  assert.equal(journal.lastRecordChanged,false);
  assert.equal(journal.status().revision,1);
});

test('activity feed click and keyboard expose exact selected-turn NO_EVIDENCE instead of inventing a receipt',()=>{
  const journal=new DemoEvidenceJournal({storage:memory(),namespace:'closure-feed',now:()=>100});
  journal.recordSnapshot({selection,operations:{stages:[{id:'scene',label:'Scene',state:'IDLE',reason:'No owner Scene receipt.'}],inspections:{scene:{available:false,receiptRef:null}},pipeline:{}},diagnostics:{},cognition:{data:{}}});
  const d=new Doc(),host=d.createElement('div');d.body.append(host);let inspected=null;
  const feed=new DemoActivityFeedController({host,journal,selectionProvider:()=>selection,inspect:value=>{inspected=value;},now:()=>100,scheduleEnabled:false}).mount();
  const button=walk(host).find(node=>node.tagName==='BUTTON');assert.ok(button);
  button.dispatch('click');
  assert.equal(inspected.available,false);
  assert.equal(inspected.evidenceState,'NO_EVIDENCE');
  assert.equal(inspected.selection.generationId,selection.generationId);
  inspected=null;
  button.dispatch('keydown',{key:'Enter'});
  assert.equal(inspected.evidenceState,'NO_EVIDENCE');
  assert.equal(inspected.selection.turnId,selection.turnId);
  feed.destroy();
});


test('bounded UI load trace keeps safe attribution only',()=>{
  let tick=0;
  const trace=new OperatorLoadTrace({maxSamples:8,clock:()=>tick++});
  for(let i=0;i<20;i++)trace.record('UI_JOURNAL_PROCESS',i,{selection:{...selection,sourceRevisionRefs:['a','b']},details:{jobs:40,entries:64,rawPrompt:'SECRET',story:'SECRET'}});
  const snapshot=trace.snapshot();
  assert.equal(snapshot.retainedSamples,8);
  assert.equal(snapshot.categories.UI_JOURNAL_PROCESS.count,8);
  assert.equal(snapshot.recent.at(-1).details.jobs,40);
  assert.equal(snapshot.recent.at(-1).details.entries,64);
  assert.equal('rawPrompt' in snapshot.recent.at(-1).details,false);
  assert.equal('story' in snapshot.recent.at(-1).details,false);
  assert.equal(snapshot.rawPromptTelemetry,false);
});

test('journal diagnostics seam does not re-read Scatter PromptPlan Runtime Lore or Memory',()=>{
  const calls={operations:0,resources:0,cognition:0,runtime:0,prompt:0,lore:0,memory:0};
  const live={selection:()=>selection,diagnostics:()=>({reads:3,rejected:0})};
  const adapter=new Wave13DiagnosticsCenterAdapter({
    operations:{read(){calls.operations++;return{selection};}},
    resources:{read(){calls.resources++;return{data:{resources:[{id:'jev:1',displayName:'Jev',kind:'JEV',physicalExecutionAttempted:true,physicalExecutionSucceeded:true,ownerAccepted:null}]};}},
    cognition:{read(){calls.cognition++;return null;}},
    loreStudy:{read(){calls.lore++;return null;}},
    memory:{read(){calls.memory++;return null;}},
    liveReceiptBinding:live,
    productionAdapters:{runtime:{read(){calls.runtime++;return null;}},promptPlan:{read(){calls.prompt++;return null;}}},
  });
  const out=adapter.readJournalEvidence();
  assert.equal(out.selection.generationId,selection.generationId);
  assert.equal(out.resources.rows.length,1);
  assert.deepEqual(calls,{operations:0,resources:1,cognition:0,runtime:0,prompt:0,lore:0,memory:0});
  assert.equal(out.resources.rows[0].ownerAccepted,null);
});

test('layered Scatter telemetry is shown only when the owner publishes it',()=>{
  const none=normalizeScatterReceipt({receiptId:'scatter:none',turnId:selection.turnId,jobs:[]});
  assert.equal(none.layeredTelemetry,null);
  const receipt=normalizeScatterReceipt({
    receiptId:'scatter:waves',turnId:selection.turnId,jobs:[],
    layeredTelemetry:[{waveId:'hot-1',trigger:'CHOICE_REQUIRED',durationMs:12.5,concurrency:3,deferredCount:2,jobCount:4}],
  });
  assert.deepEqual(receipt.layeredTelemetry,[{waveId:'hot-1',trigger:'CHOICE_REQUIRED',startedAt:null,completedAt:null,durationMs:12.5,concurrency:3,deferred:2,jobs:4}]);
});
