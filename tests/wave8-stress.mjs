import assert from 'node:assert/strict';
import {
  ExplainabilityPresentationState, ForensicMetadataIndex, FrontFaceMode, ProductDetailLevel, UIStateStore,
  computeVirtualWindow, createWave6ProductInterface,
} from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';
import { wave8LargeFixture, wave8RetrievalHeavyFixture } from './fixtures/wave8-cognition-fixtures.mjs';

class Doc extends FakeDocument { createDocumentFragment(){return new FakeNode('fragment',this);} }
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const countNodes=node=>1+(node?.children??[]).reduce((n,x)=>n+countNodes(x),0);

const base=wave8LargeFixture(10000);
let current=structuredClone(base);
let cognitionListener=null,subscriptionCount=0,releaseCount=0,readCount=0;
const cognition={
  readCognitiveChoiceReceipt(){readCount++;return current.cognitiveChoiceReceipt;},
  readScatterReceipt(){return current.scatter;},
  readSensoryTrace(){return current.sensory;},
  readTruthAssessment(){return current.truth;},
  readCorrectiveRetrievalReceipt(){return current.corrective??null;},
  readJevDecisionReceipt(){return current.jev??null;},
  readPrecisionReceipt(){return current.precision;},
  readGatherReceipt(){return current.gather;},
  readContextSealReceipt(){return current.seal;},
  readLoreStatus(){return current.lore;},
  subscribe(fn){subscriptionCount++;cognitionListener=fn;return()=>{releaseCount++;cognitionListener=null;};},
};

const doc=new Doc(),root=new FakeNode('div',doc),storage=memory(),stateStore=new UIStateStore({storage,namespace:'wave8-stress'});
const ui=createWave6ProductInterface({root,stateStore,bridges:{cognition}});
ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:860});
ui.productAdapter.setDetailLevel(ProductDetailLevel.ADVANCED);
ui.shell.selectWorkspace('brain');
ui.scheduler.flush(0);

const initialReads=readCount;
for(let i=0;i<5000;i++)cognitionListener?.({type:'COGNITION_ACTIVITY',sequence:i});
const activityPending=ui.scheduler.pendingCount;
assert.ok(activityPending<=2,'5,000 cognition signals must coalesce to bounded scheduler keys');
ui.scheduler.flush(1);
const readsAfterActivity=readCount-initialReads;
assert.ok(readsAfterActivity<=3,'signal burst must not cause thousands of cognition reads');

const beforePathReads=readCount;
for(let i=0;i<1000;i++){
  current={...current,cognitiveChoiceReceipt:{...current.cognitiveChoiceReceipt,receiptId:`choice:update:${i}`,correlationId:`corr:update:${i}`}};
  cognitionListener?.({type:'COGNITION_PATH_UPDATED',sequence:i});
}
const pathPending=ui.scheduler.pendingCount;
assert.ok(pathPending<=2,'1,000 cognition path updates must coalesce');
ui.scheduler.flush(2);
const readsAfterPath=readCount-beforePathReads;
assert.ok(readsAfterPath<=3,'path update burst must not create one render/read per update');

const explainability=new ExplainabilityPresentationState({stateStore});
for(let i=0;i<500;i++)explainability.selectGeneration({generationId:`gen:${i}`,turnId:`turn:${i}`});
assert.equal(explainability.get().bookmark.generationId,'gen:499');

const initialInspectListeners=ui.signals.listenerCount('UI_INSPECT_SELECTION_CHANGED');
for(let i=0;i<500;i++){ui.shell.inspector.select({kind:'wave8-stage',id:`inspect:${i}`,title:`Inspect ${i}`,item:{state:'COMPLETE',reason:'STRESS'}});ui.shell.inspector.clear();}
const inspectorPending=ui.scheduler.pendingCount;
assert.ok(inspectorPending<=2);
ui.scheduler.flush(3);
assert.equal(ui.shell.inspector.selection,null);
assert.equal(ui.signals.listenerCount('UI_INSPECT_SELECTION_CHANGED'),initialInspectListeners);

const workspaces=['brain','home','story','characters','lore','memory-product','world-product'];
for(let i=0;i<500;i++)ui.shell.selectWorkspace(workspaces[i%workspaces.length]);
ui.shell.selectWorkspace('brain');ui.scheduler.flush(4);

const largeWindow=computeVirtualWindow({count:10000,itemSize:54,viewportSize:540,scrollOffset:270000,overscan:8});
assert.ok(largeWindow.end-largeWindow.start<=26);
const domNodesWithLargeCollections=countNodes(root);
assert.ok(domNodesWithLargeCollections<1000,'10k candidate/result collections must not create runaway DOM');

const transactionRows=Array.from({length:20000},(_,i)=>({
  id:`tx:${i}`,eventType:i%11===0?'RESULT_STALE':i%13===0?'RESULT_LATE':'RESULT_ROUTED',
  stage:i%3===0?'COGNITION':'GATHER',subsystem:i%2?'SENSORY':'RESULT_BUS',status:i%11===0?'STALE':i%13===0?'LATE':'RECORDED',
  reasonCode:i%11===0?'REVISION_MISMATCH':'ROUTED',generationId:`gen:${Math.floor(i/20)}`,turnId:`turn:${Math.floor(i/20)}`,
  sourceRevisionRefs:[`src:${i%100}`],affectedArtifactIds:[`claim:${i%500}`],authority:{authority:i%5===0?'UNRESOLVED':'OBSERVED'},
}));
const index=new ForensicMetadataIndex(transactionRows);
const staleRows=index.query({status:'STALE'});
const searchRows=index.query({search:'revision mismatch'});
assert.ok(staleRows.length>0);assert.equal(searchRows.length,staleRows.length);
const forensicWindow=computeVirtualWindow({count:transactionRows.length,itemSize:58,viewportSize:580,scrollOffset:580000,overscan:8});
assert.ok(forensicWindow.end-forensicWindow.start<=26);

const beforeRapidReads=readCount;
for(let i=0;i<1500;i++){
  const late=i%2===0;
  current={...current,gather:{...current.gather,results:[
    {resultId:`stress:${i}`,capability:late?'Green Room':'Scene result',status:late?'LATE':'STALE',accepted:false,
     reason:late?'turn already sealed; routed to NEXT_TURN':'scene revision mismatch',freshness:late?'FRESH':'STALE',late,destination:late?'NEXT_TURN':'EVALUATION'}
  ]}};
  cognitionListener?.({type:late?'RESULT_LATE':'RESULT_STALE',sequence:i});
}
const staleLatePending=ui.scheduler.pendingCount;
assert.ok(staleLatePending<=2);
ui.scheduler.flush(5);
const readsAfterRapid=readCount-beforeRapidReads;
assert.ok(readsAfterRapid<=3);

const persisted=ui.presentation.get();
const listenersBeforeDestroy={
  workspace:ui.signals.listenerCount('UI_WORKSPACE_CHANGED'),
  inspect:ui.signals.listenerCount('UI_INSPECT_SELECTION_CHANGED'),
  wildcard:ui.signals.listenerCount('*'),
};
assert.equal(subscriptionCount,1);
ui.destroy();
const listenersAfterDestroy={
  workspace:ui.signals.listenerCount('UI_WORKSPACE_CHANGED'),
  inspect:ui.signals.listenerCount('UI_INSPECT_SELECTION_CHANGED'),
  wildcard:ui.signals.listenerCount('*'),
};
assert.deepEqual(listenersAfterDestroy,{workspace:0,inspect:0,wildcard:0});
assert.equal(releaseCount,1);assert.equal(cognitionListener,null);assert.equal(root.children.length,0);

const restoredRoot=new FakeNode('div',doc);
const restored=createWave6ProductInterface({root:restoredRoot,stateStore,bridges:{cognition:{...cognition,subscribe(){return()=>{};}}}});
assert.deepEqual(restored.presentation.get(),persisted);
restored.destroy();

console.log(JSON.stringify({
  cognitionActivitySignals:5000,
  cognitionActivitySchedulerPending:activityPending,
  cognitionReadsAfterActivityBurst:readsAfterActivity,
  cognitionPathUpdates:1000,
  cognitionPathSchedulerPending:pathPending,
  cognitionReadsAfterPathBurst:readsAfterPath,
  generationSelections:500,
  inspectorCycles:500,
  inspectorSchedulerPending:inspectorPending,
  workspaceSwitches:500,
  largeCandidateCount:10000,
  largeGatherResultCount:10000,
  virtualMountedWindow:largeWindow.end-largeWindow.start,
  domNodesWithLargeCollections,
  forensicTransactionRows:transactionRows.length,
  forensicVirtualMountedWindow:forensicWindow.end-forensicWindow.start,
  staleForensicMatches:staleRows.length,
  rapidStaleLateUpdates:1500,
  staleLateSchedulerPending:staleLatePending,
  cognitionReadsAfterStaleLateBurst:readsAfterRapid,
  liveCognitionSubscriptions:subscriptionCount,
  cognitionSubscriptionReleases:releaseCount,
  listenersBeforeDestroy,
  listenersAfterDestroy,
  rootChildrenAfterDestroy:root.children.length,
  presentationRestored:true,
},null,2));
