import assert from 'node:assert/strict';
import {
  BrainPulseModel, CoprocessorProductionUIAdapter, FrontFaceMode, RenderScheduler, RuntimeProductionUIAdapter,
  UIStateStore, computeVirtualWindow, createWave6ProductInterface, resolveResponsiveMode,
} from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

class Doc extends FakeDocument { createDocumentFragment(){return new FakeNode('fragment',this);} }
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const runtimeAdapter={
  getTelemetrySummary(){return{mode:'BACKGROUND / IDLE',hotActivity:0,deepActivity:2,utilization:{L0:0,L1:0,L2:1,L3:1,L4:0},queueDepth:{L0:0,L1:0,L2:1,L3:1,L4:0},reservedForegroundCapacity:{CPU:1},borrowedBackgroundCapacity:1,activeWorkerCount:2,parkedWorkerCount:0,queuedObligations:2,blockedRecoveringWork:0,activeBatches:1,foregroundDeadlineState:'IDLE'};},
  subscribeRuntime(){return()=>{};},getLedgerPage(){return{items:[],total:0};},getLedgerTaskDetail(){return null;},getRecoveryPage(){return{items:[],total:0};},
};
const copTelemetry={snapshot(){return{totalEvents:0,warm:{hit:0,miss:0},retrieval:{HIGH:0,MIXED:0,LOW:0},precision:{requests:0},retry:0,fallback:0,staleDrop:0,resultDestinations:{},providerHealth:{}};},subscribe(){return()=>{};}};

const doc=new Doc(),root=new FakeNode('div',doc),storage=memory(),stateStore=new UIStateStore({storage,namespace:'wave6-stress'});
const ui=createWave6ProductInterface({root,stateStore,bridges:{runtimeAdapter,coprocessorTelemetry:copTelemetry}});
const initialWorkspaceListeners=ui.signals.listenerCount('UI_WORKSPACE_CHANGED');
const initialInspectListeners=ui.signals.listenerCount('UI_INSPECT_SELECTION_CHANGED');

for(let i=0;i<5000;i++)ui.signals.publish(i%2?'RUNTIME_STRESS':'COPROCESSOR_STRESS',{i},{source:'wave6-stress'});
const quickDashPending=ui.scheduler.pendingCount;
ui.scheduler.flush(1);

for(let i=0;i<1000;i++)ui.presentation.toggle();
assert.equal(ui.presentation.get().frontFaceMode,FrontFaceMode.COLLAPSED);

const ids=['home','story','characters','lore','memory-product','world-product','brain'];
for(let i=0;i<500;i++)ui.shell.selectWorkspace(ids[i%ids.length]);

for(let i=0;i<500;i++){ui.shell.inspector.select({kind:'stress',id:`s:${i}`,title:`Stress ${i}`});ui.shell.inspector.clear();}
const inspectorPending=ui.scheduler.pendingCount;ui.scheduler.flush(2);

const resizeModes={};
for(let i=0;i<250;i++){const mode=resolveResponsiveMode(i%3===0?1440:i%3===1?900:600);resizeModes[mode]=(resizeModes[mode]??0)+1;}

const virtual=computeVirtualWindow({count:100000,itemSize:46,viewportSize:460,scrollOffset:230000,overscan:6});
assert.ok(virtual.end-virtual.start<=22);

let brainFrame=null,brainFlushes=0;
const brainScheduler=new RenderScheduler({requestFrame:(cb)=>{brainFrame=cb;return 1;},cancelFrame(){}});
const pulse=new BrainPulseModel({runtime:new RuntimeProductionUIAdapter(runtimeAdapter),coprocessor:new CoprocessorProductionUIAdapter(copTelemetry),scheduler:brainScheduler,onUpdate(){brainFlushes++;},maxActivity:20});
for(let i=0;i<2000;i++)pulse.ingestRuntime({type:i%5===0?'WORK_BLOCKED':'WORK_STARTED',payload:{taskId:`task:${i%64}`,workerId:`worker:${i%64}`,layer:i%3===0?'L1':'L3'}});
const brainPending=brainScheduler.pendingCount,pendingBrainKeys=pulse.pendingCount;brainFrame(3);
assert.equal(brainFlushes,1);assert.equal(pulse.getSnapshot().activity.length,20);

const persisted=ui.presentation.get();
const listenerSnapshot={workspace:ui.signals.listenerCount('UI_WORKSPACE_CHANGED'),inspect:ui.signals.listenerCount('UI_INSPECT_SELECTION_CHANGED'),wildcard:ui.signals.listenerCount('*')};
assert.ok(listenerSnapshot.workspace<=initialWorkspaceListeners+1);assert.equal(listenerSnapshot.inspect,initialInspectListeners);

ui.destroy();
const postDestroyListeners={workspace:ui.signals.listenerCount('UI_WORKSPACE_CHANGED'),inspect:ui.signals.listenerCount('UI_INSPECT_SELECTION_CHANGED'),wildcard:ui.signals.listenerCount('*')};
assert.deepEqual(postDestroyListeners,{workspace:0,inspect:0,wildcard:0});assert.equal(root.children.length,0);

const restoredRoot=new FakeNode('div',doc),restored=createWave6ProductInterface({root:restoredRoot,stateStore,bridges:{runtimeAdapter,coprocessorTelemetry:copTelemetry}});
assert.deepEqual(restored.presentation.get(),persisted);restored.destroy();

console.log(JSON.stringify({
  signalTransitions:5000,
  quickDashSchedulerPendingAfterBurst:quickDashPending,
  brainPulseUpdates:2000,
  brainPulseSchedulerPending:brainPending,
  brainPulsePendingKeys:pendingBrainKeys,
  brainPulseFlushes:brainFlushes,
  brainPulseRetainedActivity:pulse.getSnapshot().activity.length,
  collapseExpandCycles:1000,
  workspaceSwitches:500,
  inspectorCycles:500,
  inspectorSchedulerPending:inspectorPending,
  responsiveTransitions:250,
  responsiveModes:resizeModes,
  virtualCollectionCount:100000,
  virtualMountedWindow:virtual.end-virtual.start,
  listenerSnapshot,
  postDestroyListeners,
  rootChildrenAfterDestroy:root.children.length,
  presentationRestored:true,
},null,2));
