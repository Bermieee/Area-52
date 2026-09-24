import assert from 'node:assert/strict';
import { FrontFaceMode, ProductDetailLevel, UIStateStore, createWave6ProductInterface } from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';
import { createWave11LiveHost, makeWave11Turn } from './fixtures/wave11-live-receipts.mjs';

class Doc extends FakeDocument{createDocumentFragment(){return new FakeNode('fragment',this);}}
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const countNodes=node=>1+(node?.children??[]).reduce((n,x)=>n+countNodes(x),0);

const sourceRevisionRefs=['lore:ember@6','scene:ember@19','memory:ember@12'];
const turns=Array.from({length:24},(_,i)=>makeWave11Turn({
  selection:{chatId:'chat:'+(i%4),turnId:'turn:'+i,generationId:'gen:'+i,correlationId:'corr:'+i,worldRevision:100+i,sceneRevision:20+i,sourceRevisionRefs},
  scenario:i%5===0?'hot':i%3===0?'ambiguous':'retrieval',resourceCount:(i%4)+1,late:i%7===0,
}));
const large=turns[7];
large.transactions=Array.from({length:10000},(_,i)=>({
  kind:'CognitiveTransaction',contractVersion:'1.0.0',transactionId:'tx:bulk:'+i,transactionType:i%11===0?'RESULT_LATE':'REFLECTION_CREATED',sequence:i+1,
  turnId:large.selection.turnId,generationId:large.selection.generationId,correlationId:large.selection.correlationId,subsystem:i%11===0?'GREEN_ROOM':'MEMORY',
  owner:i%11===0?'COPROCESSOR':'MEMORY',sourceRevisionIds:large.selection.sourceRevisionRefs,authorityContext:{authorityClass:i%11===0?'INFERRED':'UNRESOLVED'},
  outcome:{status:i%11===0?'LATE':'RECORDED',summary:'bounded stress transaction '+i},reasonCode:i%11===0?'CONTEXT_ALREADY_SEALED':'STRESS_RECORDED',
  provenance:{},metadata:{},retentionClass:'LIGHTWEIGHT_METADATA',
}));
large.forensic={...large.forensic,transactionRefs:large.transactions.map(x=>x.transactionId),lateResultRefs:large.transactions.filter(x=>x.outcome.status==='LATE').slice(0,128).map(x=>x.transactionId)};
large.gather={...large.gather,results:Array.from({length:10000},(_,i)=>({
  resultId:'result:bulk:'+i,capability:i%9===0?'Green Room':'Historian',status:i%97===0?'LATE':i%71===0?'STALE':'ADMITTED',
  accepted:i%97!==0&&i%71!==0,late:i%97===0,freshness:i%71===0?'STALE':'FRESH',evidenceRefs:['evidence:'+i],
  correlationId:large.selection.correlationId,worldRevision:large.selection.worldRevision,sceneRevision:large.selection.sceneRevision,
})),admittedEvidenceRefs:[]};

const host=createWave11LiveHost(turns,'turn:0'),doc=new Doc(),root=new FakeNode('div',doc),storage=memory();
const ui=createWave6ProductInterface({root,stateStore:new UIStateStore({storage,namespace:'wave11-live-stress'}),hostBindings:host.bundle});
ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:900,inspectorVisible:true});
ui.productAdapter.setDetailLevel(ProductDetailLevel.ADVANCED);ui.shell.selectWorkspace('brain');ui.scheduler.flush(0);

let maxPending=0,maxBrainNodes=0,maxForensicNodes=0;
for(let i=0;i<600;i++){
  host.switchTo('turn:'+(i%turns.length));
  if(i%3===0)ui.presentation.setWidth([420,560,720,900][i%4]);
  if(i%5===0)ui.productAdapter.setDetailLevel([ProductDetailLevel.NORMAL,ProductDetailLevel.DETAIL,ProductDetailLevel.ADVANCED][i%3]);
  maxPending=Math.max(maxPending,ui.scheduler.pendingCount);assert.ok(ui.scheduler.pendingCount<=5,'host switch render queue must stay bounded');
  ui.scheduler.flush(i+1);
  const read=ui.productionAdapters.cognition.read();
  assert.equal(read.data?.turnId??ui.liveReceiptBinding.selection().turnId,ui.liveReceiptBinding.selection().turnId,'visible cognition must remain selected-turn coherent');
  if(ui.shell.currentWorkspace==='brain')maxBrainNodes=Math.max(maxBrainNodes,countNodes(root));
}

host.switchTo(large.selection.turnId);ui.productAdapter.setDetailLevel(ProductDetailLevel.ADVANCED);ui.shell.selectWorkspace('forensics');ui.scheduler.flush(700);
maxForensicNodes=countNodes(root);assert.ok(maxForensicNodes<1800,'10k transaction forensic DOM must remain virtualized/bounded');
ui.shell.selectWorkspace('brain');ui.scheduler.flush(701);maxBrainNodes=Math.max(maxBrainNodes,countNodes(root));assert.ok(maxBrainNodes<1900,'10k Gather Brain DOM must remain virtualized/bounded');

for(let i=0;i<400;i++){
  ui.shell.inspector.select({kind:'wave8-gather-item',id:'stress:'+i,title:'Gather result',item:{resultId:'result:'+i,status:i%7===0?'LATE':'ADMITTED',capability:'Historian',evidenceRefs:['e:'+i]}});
  if(i%2===0)ui.shell.inspector.clear();
  maxPending=Math.max(maxPending,ui.scheduler.pendingCount);assert.ok(ui.scheduler.pendingCount<=5,'Inspector render queue must stay bounded');
  ui.scheduler.flush(800+i);
}
assert.equal(host.listenerCount(),1,'one mounted UI must own one live host subscription');
const listenersBefore={workspace:ui.signals.listenerCount('UI_WORKSPACE_CHANGED'),inspect:ui.signals.listenerCount('UI_INSPECT_SELECTION_CHANGED'),wildcard:ui.signals.listenerCount('*')};
ui.destroy();
assert.equal(host.listenerCount(),0);assert.equal(root.children.length,0);assert.equal(ui.signals.listenerCount('UI_WORKSPACE_CHANGED'),0);assert.equal(ui.signals.listenerCount('UI_INSPECT_SELECTION_CHANGED'),0);assert.equal(ui.signals.listenerCount('*'),0);

let remounts=0;
for(let i=0;i<50;i++){
  const r=new FakeNode('div',doc),next=createWave6ProductInterface({root:r,stateStore:new UIStateStore({storage:memory(),namespace:'wave11-remount:'+i}),hostBindings:host.bundle});
  next.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:i%2?420:900});next.shell.selectWorkspace(i%2?'brain':'home');next.scheduler.flush(i);
  assert.equal(host.listenerCount(),1);next.destroy();assert.equal(host.listenerCount(),0);assert.equal(r.children.length,0);remounts++;
}

console.log(JSON.stringify({
  turns:turns.length,chatNamespaces:4,turnSwitches:600,inspectorCycles:400,largeTransactions:large.transactions.length,largeGatherResults:large.gather.results.length,
  maxBrainDomNodes:maxBrainNodes,maxForensicDomNodes:maxForensicNodes,maxSchedulerPending:maxPending,hostSubscriptionsMounted:1,hostSubscriptionsAfterDestroy:0,
  signalListenersBeforeDestroy:listenersBefore,signalListenersAfterDestroy:{workspace:0,inspect:0,wildcard:0},rootChildrenAfterDestroy:0,destroyRemountCycles:remounts,
},null,2));
