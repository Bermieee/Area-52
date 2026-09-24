import assert from 'node:assert/strict';
import { FrontFaceMode, ProductDetailLevel, UIStateStore, createWave6ProductInterface } from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';
import { createReviewScenarios } from '../demo/phase2-shell/scenarios/index.js';
import { createWave10TraceFixture } from '../demo/phase2-shell/scenarios/wave10-context-trace.js';
import { installPhase2ReviewWorkspaces } from '../demo/phase2-shell/review-workspaces.js';

class Doc extends FakeDocument{createDocumentFragment(){return new FakeNode('fragment',this);}}
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const countNodes=node=>1+(node?.children??[]).reduce((n,x)=>n+countNodes(x),0);
const rec=createReviewScenarios().get('ambiguous'),trace=createWave10TraceFixture('ambiguous'),base=trace.transactions;
const large=Array.from({length:10000},(_,i)=>({
  kind:'CognitiveTransaction',transactionId:`tx:bulk:${i}`,transactionType:'REFLECTION_CREATED',sequence:200+i,timestamp:20000+i,correlationId:'corr:gen:418',
  turnId:'turn:gen:418',generationId:'gen:418',subsystem:'MEMORY',owner:'MEMORY',sourceRevisionIds:['memory:r12'],affectedArtifactIds:[`reflection:${i}`],
  authorityContext:{authorityClass:'INFERRED'},decision:null,outcome:{status:'RECORDED',summary:`Bounded reflection ${i}`},receiptRefs:[],reasonCode:'STRESS_RECORDED',
  provenance:{},metadata:{},retentionClass:'LIGHTWEIGHT_METADATA',
}));
const bridges={...rec.bridges,forensics:{...rec.bridges.forensics,listTransactions:()=>[...base,...large]},cognition:rec.cognition?{fixture:rec.cognition}:{}};
const doc=new Doc(),root=new FakeNode('div',doc),stateStore=new UIStateStore({storage:memory(),namespace:'wave10-stress'});
const ui=createWave6ProductInterface({root,stateStore,fixture:rec.product,bridges});installPhase2ReviewWorkspaces(ui);ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:900});ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);
ui.shell.selectWorkspace('forensics');ui.scheduler.flush(0);const firstNodes=countNodes(root);assert.ok(firstNodes<1800,`forensic DOM must stay bounded, got ${firstNodes}`);
for(let i=0;i<120;i++){ui.shell.selectWorkspace(i%2?'generation-explainability':'forensics');ui.scheduler.flush(i+1);}
for(let i=0;i<300;i++){ui.shell.inspector.select({kind:'wave7-generation',id:`gen:${i}`,title:'Generation Context',generation:{generationId:'gen:418',modelProfileId:'RP-LONG-CONTEXT-v3',budget:{total:32000,allocated:27800,remaining:4200},sections:[],sectionCounts:{},sourceRevisionRefs:[]}});ui.scheduler.flush(200+i);ui.shell.inspector.clear();}
ui.shell.selectWorkspace('forensics');ui.scheduler.flush(600);const finalNodes=countNodes(root);assert.ok(finalNodes<1800,`forensic DOM after churn must stay bounded, got ${finalNodes}`);
const pending=ui.scheduler.pendingCount;assert.ok(pending<=4,`scheduler pending work must remain bounded, got ${pending}`);ui.scheduler.flush(601);
ui.destroy();assert.equal(root.children.length,0);assert.equal(ui.signals.listenerCount('UI_WORKSPACE_CHANGED'),0);assert.equal(ui.signals.listenerCount('UI_INSPECT_SELECTION_CHANGED'),0);assert.equal(ui.signals.listenerCount('*'),0);
console.log(JSON.stringify({cognitiveTransactions:base.length+large.length,workspaceSwitches:120,inspectorCycles:300,firstDomNodes:firstNodes,finalDomNodes:finalNodes,schedulerPendingBeforeFinalFlush:pending,listenersAfterDestroy:{workspace:0,inspect:0,wildcard:0},rootChildrenAfterDestroy:0},null,2));
