import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FrontFaceMode, ProductDetailLevel, UIStateStore,
  Wave13LoreStudyUIAdapter, Wave13ResourceControlAdapter,
  createWave6ProductInterface, parseLoreSubmission,
} from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

class Node extends FakeNode{
  constructor(tag,doc){super(tag,doc);this.id='';this.value='';this.hidden=false;}
  setAttribute(name,value){super.setAttribute(name,value);if(name==='id')this.id=String(value);if(name==='value')this.value=String(value);}
  getAttribute(name){return this.attributes?.[name]??null;}
  remove(){const p=this.parentNode,i=p?.children?.indexOf(this)??-1;if(i>=0)p.children.splice(i,1);this.parentNode=null;}
}
class Doc extends FakeDocument{
  constructor(width=1280,height=800){super();this.body=new Node('body',this);this.documentElement=new Node('html',this);this.documentElement.clientWidth=width;this.documentElement.clientHeight=height;this.body.clientWidth=width;this.body.clientHeight=height;this.defaultView={innerWidth:width,innerHeight:height};}
  createElement(tag){return new Node(tag,this);}
  createDocumentFragment(){return new Node('fragment',this);}
  dispatch(type,event={}){for(const handler of this.listeners.get(type)??[])handler({type,target:this,preventDefault(){},...event});}
}
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const walk=node=>[node,...(node?.children??[]).flatMap(walk)];
const textOf=node=>walk(node).map(x=>x.textContent??'').filter(Boolean).join(' ');

function scene(selection,location){
  return{kind:'SceneUiReadModel',sceneId:'scene:'+selection.chatId,revision:selection.sceneRevision,lifecycle:'ACTIVE',location:{value:{name:location},authority:'OBSERVED'},narrativeTime:{value:'evening'},activeCast:['Ari'],objects:[],activeThreads:['arrival'],uncertainFields:[],provenanceRefs:['scene-source'],health:{state:'READY',reasons:[]},...selection};
}
function scatter(selection){return{kind:'RuntimeScatterReceipt',jobs:[{taskId:'job:1',capability:'GRAPH',state:'COMPLETE',resourceId:'local:1'}],admittedJobCount:1,resourceCount:1,resourceIds:['local:1'],requiredFallback:0,opportunisticPending:0,...selection};}
function choice(selection){return{kind:'CognitiveChoiceReceipt',id:'choice:'+selection.turnId,receiptRevision:1,status:'COMPLETE',paths:['HOT_ONLY'],functionDecisions:[],admittedJobs:[],skippedJobs:[],deferredJobs:[],consideredCognitionOptions:[],reasonCodes:['HOT_SUFFICIENT'],retrievalIntents:[],sensoryChannelsRequested:[],sensoryChannelsUsed:[],candidateCounts:{},measurements:{},...selection};}

function liveOwner({withResources=false,withLore=false}={}){
  let selection={chatId:'chat:moon',turnId:'turn:1',generationId:'gen:1',correlationId:'corr:1',worldRevision:8,sceneRevision:4,sourceRevisionRefs:['scene:moon@4']};
  let location='Moon Harbor';const listeners=new Set();
  let resources=withResources?[{profileId:'sidecar:local',kind:'SIDECAR',providerId:'local',modelId:'small',local:true,health:'HEALTHY',availability:'AVAILABLE',connected:true,capabilities:['GRAPH','CPU_ANALYSIS'],placements:['FOREGROUND'],currentLoad:0,concurrencyCapacity:2}]:[];
  let lore={kind:'LorePublicIntegrationSurface',entries:[],artifacts:[],conflicts:[],lifecycle:{counts:{DUE:0,PENDING:0,ACTIVE:0,CHECKPOINTED:0,COMPLETED:0,SUPERSEDED:0,STALE:0,INVALID:0},due:0,active:0}};
  const calls=[];
  const emit=()=>{for(const fn of [...listeners])fn({kind:'OWNER_UPDATE',selection:{...selection}});};
  const bindings={
    readSelection:()=>({...selection}),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    readScene:()=>selection.turnId?scene(selection,location):null,readScatter:()=>selection.turnId?scatter(selection):null,readCognitiveChoice:()=>selection.turnId?choice(selection):null,
    readLoreStatus:()=>({...lore,...selection}),readMemoryStatus:()=>({kind:'MemoryStatus',state:'READY',count:2,...selection}),
    ...(withResources?{
      listResourceProfiles:()=>resources.map(x=>({...x})),
      connectResource:async config=>{calls.push(['connect',config]);resources=[...resources,{profileId:config.profileId||'new',kind:config.kind,endpoint:config.endpoint,health:'HEALTHY',availability:'AVAILABLE',connected:true,capabilities:['CPU_ANALYSIS'],placements:['FOREGROUND'],currentLoad:0,concurrencyCapacity:1}];emit();return{ok:true,profileId:config.profileId||'new'};},
      disconnectResource:async row=>{calls.push(['disconnect',row.id??row.profileId]);resources=resources.filter(x=>(x.profileId??x.id)!==(row.id??row.profileId));emit();return{ok:true};},
      testResource:async row=>{calls.push(['test',row.id??row.profileId]);return{ok:true,status:'HEALTHY'};},
    }:{}),
    ...(withLore?{
      acceptLorebook:async book=>{calls.push(['accept',book.id,book.entries.length]);lore={...lore,entries:book.entries.map(e=>({sourceId:'lore:'+book.id+':'+e.uid,lorebookId:book.id,uid:e.uid,sourceRevisionId:'lore:'+book.id+':'+e.uid+'@r1',sourceState:'CURRENT',learnedRevisionId:null,freshness:'STALE_OR_UNLEARNED',artifactIds:[],retrievalRepresentations:[]})),lifecycle:{...lore.lifecycle,counts:{...lore.lifecycle.counts,DUE:book.entries.length},due:book.entries.length,active:0}};emit();return{accepted:true,entryCount:book.entries.length};},
      runLoreStudy:async()=>{calls.push(['run']);lore={...lore,entries:lore.entries.map(e=>({...e,learnedRevisionId:'learned:'+e.sourceId,freshness:'CURRENT',artifactIds:['retrieval:'+e.uid],retrievalRepresentations:[{artifactId:'retrieval:'+e.uid,sourceRevisionId:e.sourceRevisionId,authorityClass:'DERIVED',temporalClass:'CURRENT',unresolved:false,provenance:{sourceRevisionId:e.sourceRevisionId}}]})),lifecycle:{...lore.lifecycle,counts:{...lore.lifecycle.counts,DUE:0,COMPLETED:lore.entries.length},due:0,active:0}};emit();return{completed:true};},
    }:{}),
  };
  return{bindings,calls,listenerCount:()=>listeners.size,switchStory({chatId,turnId,generationId,location:nextLocation}){selection={chatId,turnId,generationId,correlationId:'corr:'+turnId,worldRevision:selection.worldRevision+1,sceneRevision:selection.sceneRevision+1,sourceRevisionRefs:['scene:'+chatId+'@'+(selection.sceneRevision+1)]};location=nextLocation;emit();},clearTurn(){selection={...selection,turnId:null,generationId:null,correlationId:null,worldRevision:null,sceneRevision:null,sourceRevisionRefs:[]};emit();}};
}

function mount(owner,{width=1280,height=800,floating=true}={}){
  const document=new Doc(width,height),root=new Node('aside',document);document.body.append(root);
  const stateStore=new UIStateStore({storage:memory(),namespace:'wave13-test'});
  const ui=createWave6ProductInterface({root,stateStore,hostBindings:owner.bindings,floatingNavigation:floating,viewportProvider:()=>({width,height})});
  ui.scheduler.flush(0);return{document,root,ui,stateStore};
}

test('Wave 13 rail is labeled, edge-aware and opens one attached workspace panel',()=>{
  const owner=liveOwner(),{ui}=mount(owner,{width:1280,height:800});
  assert.ok(ui.floatingController);
  let d=ui.floatingController.diagnostics();
  assert.equal(d.card.side,'LEFT');assert.equal(d.card.attached,true);
  assert.equal(ui.shell.currentWorkspace,'home');
  const navText=textOf(ui.floatingController.nodes.nav);
  for(const label of ['Home','Story','Characters','Lore','Memory','World','Brain','Connections','Settings'])assert.match(navText,new RegExp(label));
  assert.doesNotMatch(textOf(ui.floatingController.nodes.controls),/[+−]/);
  const brain=[...ui.floatingController.nodes.nav.querySelectorAll('[data-workspace-id]')].find(x=>x.dataset.workspaceId==='brain');
  brain.dispatch('click');ui.scheduler.flush(1);
  assert.equal(ui.shell.currentWorkspace,'brain');assert.equal(ui.presentation.get().frontFaceMode,FrontFaceMode.EXPANDED);
  assert.equal(ui.floatingController.nodes.cardBody.children.includes(ui.controller.nodes.expanded),true);
  ui.destroy();assert.equal(owner.listenerCount(),0);
});

test('rail pointer drag crosses viewport and pop-out flips toward available space',()=>{
  const owner=liveOwner(),{ui,document}=mount(owner,{width:1000,height:700});
  const handle=ui.floatingController.nodes.railHandle,start=ui.floatingController.diagnostics().rail;
  handle.dispatch('pointerdown',{button:0,clientX:start.x,clientY:start.y,pointerId:1});
  document.dispatch('pointermove',{clientX:12,clientY:80,pointerId:1});document.dispatch('pointerup',{clientX:12,clientY:80,pointerId:1});
  const d=ui.floatingController.diagnostics();
  assert.ok(d.rail.x<=20);assert.equal(d.card.side,'RIGHT');assert.equal(d.card.x,d.rail.x+d.rail.width);
  ui.destroy();
});

test('attached rail/panel keyboard movement, resize, collapse, restore and close remain reachable',()=>{
  const owner=liveOwner(),{ui}=mount(owner,{width:920,height:680});
  const c=ui.floatingController;c.open('story');ui.scheduler.flush(1);
  const before=c.diagnostics();c.nodes.railHandle.dispatch('keydown',{key:'ArrowLeft'});c.nodes.cardHandle.dispatch('keydown',{key:'ArrowUp'});ui.scheduler.flush(2);
  const moved=c.diagnostics();assert.ok(moved.rail.x<=before.rail.x);assert.ok(moved.rail.y<=before.rail.y);assert.equal(moved.card.attached,true);
  const width=ui.presentation.get().frontFaceWidth;c.nodes.resizeHandle.dispatch('keydown',{key:moved.card.side==='RIGHT'?'ArrowLeft':'ArrowRight'});assert.ok(ui.presentation.get().frontFaceWidth<=width);
  const sideWidth=ui.presentation.get().frontFaceWidth;c.nodes.sideResizeHandle.dispatch('keydown',{key:moved.card.side==='RIGHT'?'ArrowRight':'ArrowLeft'});assert.ok(ui.presentation.get().frontFaceWidth>=sideWidth);
  c.nodes.minimize.dispatch('click');assert.equal(c.diagnostics().card.minimized,true);assert.equal(ui.shell.currentWorkspace,'story');assert.equal(c.nodes.minimize.textContent,'Expand');
  c.nodes.minimize.dispatch('click');assert.equal(c.diagnostics().card.minimized,false);assert.equal(c.nodes.minimize.textContent,'Collapse');
  c.nodes.close.dispatch('click');assert.equal(ui.presentation.get().frontFaceMode,FrontFaceMode.COLLAPSED);
  c.open();assert.equal(ui.shell.currentWorkspace,'story');ui.destroy();
});

test('narrow viewport clamps rail and attached card to reachable bounds even near viewport center',()=>{
  const owner=liveOwner(),{ui,document}=mount(owner,{width:420,height:620});ui.floatingController.open('brain');ui.presentation.setWidth(720);ui.scheduler.flush(2);
  const handle=ui.floatingController.nodes.railHandle,start=ui.floatingController.diagnostics().rail;
  handle.dispatch('pointerdown',{button:0,clientX:start.x,clientY:start.y,pointerId:7});
  document.dispatch('pointermove',{clientX:150,clientY:100,pointerId:7});document.dispatch('pointerup',{clientX:150,clientY:100,pointerId:7});ui.scheduler.flush(3);
  const d=ui.floatingController.diagnostics();
  assert.ok(d.rail.x>=8&&d.rail.x+d.rail.width<=412);
  assert.ok(d.card.x>=8);assert.ok(d.card.x+d.card.width<=412);assert.equal(d.card.attached,true);
  if(d.card.side==='RIGHT')assert.equal(d.card.x,d.rail.x+d.rail.width);else assert.equal(d.card.x+d.card.width,d.rail.x);
  assert.ok(d.card.y>=8&&d.card.y<620);
  ui.destroy();
});

test('panel outer side edge supports pointer resize in addition to the bottom handle',()=>{
  const owner=liveOwner(),{ui,document}=mount(owner,{width:1100,height:700});const c=ui.floatingController;c.open('connections');ui.scheduler.flush(1);
  const before=c.diagnostics(),handle=c.nodes.sideResizeHandle,startWidth=ui.presentation.get().frontFaceWidth;
  handle.dispatch('pointerdown',{button:0,clientX:before.card.side==='RIGHT'?before.card.x+before.card.width:before.card.x,clientY:before.card.y+120,pointerId:13});
  const delta=before.card.side==='RIGHT'?80:-80;
  document.dispatch('pointermove',{clientX:(before.card.side==='RIGHT'?before.card.x+before.card.width:before.card.x)+delta,clientY:before.card.y+120,pointerId:13});
  document.dispatch('pointerup',{pointerId:13});ui.scheduler.flush(2);
  assert.ok(ui.presentation.get().frontFaceWidth>startWidth);assert.equal(c.diagnostics().card.attached,true);ui.destroy();
});

test('selected chat with no active turn reports WAITING rather than fabricated live receipts',()=>{
  const owner=liveOwner();owner.clearTurn();const{ui}=mount(owner);
  const status=ui.operator.operations.read();
  assert.equal(status.waitingForTurn,true);
  for(const id of ['scene','runtime','choice'])assert.equal(status.stages.find(x=>x.id===id).state,'WAITING_FOR_TURN');
  for(const id of ['truth','gather','seal','promptPlan'])assert.equal(status.stages.find(x=>x.id===id).state,'UNAVAILABLE');
  assert.equal(ui.productAdapter.getSnapshot().wave6.sources.scene.operationalState,'WAITING_FOR_TURN');
  assert.equal(ui.productAdapter.getSnapshot().wave6.sources.promptPlan.mode,'UNAVAILABLE');
  ui.destroy();
});

test('selected-turn Runtime scatter is shown as live even without a separate scheduler telemetry adapter',()=>{
  const owner=liveOwner(),{ui}=mount(owner);const snap=ui.productAdapter.getSnapshot();
  assert.equal(snap.wave6.sources.runtime.mode,'LIVE');assert.equal(snap.runtime.resourceCount,1);assert.equal(snap.runtime.admittedJobCount,1);
  assert.match(snap.wave6.sources.runtime.impact,/1 logical jobs/);ui.destroy();
});

test('Coprocessor absent from assembly is UNAVAILABLE with a contract reason, not falsely live',()=>{
  const owner=liveOwner(),{ui}=mount(owner);const row=ui.operator.operations.read().stages.find(x=>x.id==='coprocessor');
  assert.equal(row.state,'UNAVAILABLE');assert.match(row.reason,/does not export|Assembly/i);ui.destroy();
});

test('exported Worker 2 CognitionUiState becomes live selected-turn Coprocessor telemetry',()=>{
  const owner=liveOwner();
  owner.bindings.readCognitionUiState=()=>({kind:'CognitionUiState',health:'WORKING',activeTasks:[{taskId:'sidecar-job',layer:'L1'}],warmHits:3,fallbackCount:0,...owner.bindings.readSelection()});
  const{ui}=mount(owner),snap=ui.productAdapter.getSnapshot(),row=ui.operator.operations.read().stages.find(x=>x.id==='coprocessor');
  assert.equal(snap.wave6.sources.coprocessor.mode,'LIVE');assert.equal(snap.coprocessor.hotActivity,1);assert.equal(snap.coprocessor.warm.hit,3);
  assert.equal(row.state,'WORKING');ui.destroy();
});

test('mounted resource controls route through UI ActionRouter into owner actions only',async()=>{
  const owner=liveOwner({withResources:true}),{ui}=mount(owner);
  assert.equal(ui.actionRouter.hasAction('wave13.resource.connect'),true);
  assert.equal(ui.actionRouter.hasAction('wave13.resource.test'),true);
  assert.equal(ui.actionRouter.hasAction('wave13.resource.disconnect'),true);
  const connected=await ui.actionRouter.route({type:'wave13.resource.connect',payload:{profileId:'sidecar:second',kind:'SIDECAR',endpoint:'http://127.0.0.1:9000'}});
  assert.equal(connected.ok,true);assert.ok(owner.calls.some(x=>x[0]==='connect'&&x[1].profileId==='sidecar:second'));
  ui.destroy();
});

test('chat switch cannot retain the previous story Scene as current',()=>{
  const owner=liveOwner(),{ui}=mount(owner);ui.shell.selectWorkspace('story');ui.scheduler.flush(1);
  assert.match(textOf(ui.shell.nodes.workspace),/Moon Harbor/);
  owner.switchStory({chatId:'chat:orchard',turnId:'turn:9',generationId:'gen:9',location:'Glass Orchard'});ui.scheduler.flush(2);
  assert.equal(ui.liveReceiptBinding.selection().chatId,'chat:orchard');
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/Glass Orchard/);assert.doesNotMatch(body,/Moon Harbor/);
  ui.destroy();
});

test('resource adapter displays actual Worker 2 profile fields and delegates test/disconnect/connect actions',async()=>{
  const owner=liveOwner({withResources:true}),adapter=new Wave13ResourceControlAdapter({bindings:owner.bindings});
  let read=adapter.read();assert.equal(read.source.operationalState,'LIVE');assert.deepEqual(read.data.resources[0].capabilities,['GRAPH','CPU_ANALYSIS']);
  const testResult=await adapter.test(read.data.resources[0]);assert.equal(testResult.ok,true);assert.equal(adapter.testResult('sidecar:local').status,'HEALTHY');
  await adapter.disconnect(read.data.resources[0]);assert.equal(adapter.read().source.operationalState,'DISCONNECTED');
  await adapter.connect({profileId:'jev:local',kind:'JEV',endpoint:'http://127.0.0.1:8080'});read=adapter.read();assert.ok(read.data.resources.some(x=>x.id==='jev:local'));
  assert.ok(owner.calls.some(x=>x[0]==='connect'));assert.ok(owner.calls.some(x=>x[0]==='test'));assert.ok(owner.calls.some(x=>x[0]==='disconnect'));
});

test('missing Worker 2 connection actions stay unavailable while native path remains declared usable',()=>{
  const owner=liveOwner(),adapter=new Wave13ResourceControlAdapter({bindings:owner.bindings}),read=adapter.read();
  assert.equal(read.source.operationalState,'UNAVAILABLE');assert.equal(read.data.nativePathAvailable,true);assert.equal(adapter.capabilities().connect,false);
});

test('Lore submission validates arbitrary source and never accepts invalid JSON as learned Lore',()=>{
  assert.throws(()=>parseLoreSubmission({id:'x',text:'{"entries":['}),error=>error?.code==='LORE_INPUT_INVALID_JSON');
  assert.throws(()=>parseLoreSubmission({id:'x',text:'{"entries":[{"uid":"a"}]}'}),error=>error?.code==='LORE_INPUT_INVALID_ENTRY');
  const plain=parseLoreSubmission({id:'moon-lore',title:'Moon Harbor',text:'Captain Vale keeps the blue ledger.'});
  assert.equal(plain.entries.length,1);assert.equal(plain.entries[0].content,'Captain Vale keeps the blue ledger.');
});

test('Lore owner lifecycle distinguishes accepted source from learned retrieval-ready state',async()=>{
  const owner=liveOwner({withLore:true}),adapter=new Wave13LoreStudyUIAdapter({bindings:owner.bindings,selectionProvider:owner.bindings.readSelection});
  let read=adapter.read();assert.equal(read.data.entries.length,0);
  await adapter.accept({id:'orchard-lore',title:'Glass Orchard',entries:[{uid:'keeper',content:'Ilya tends the Glass Orchard.',metadata:{title:'Ilya'}}],fullSnapshot:true});
  read=adapter.read();assert.equal(read.data.entries[0].freshness,'STALE_OR_UNLEARNED');assert.equal(read.data.entries[0].learnedRevisionId,null);assert.equal(read.data.retrievalReady,0);assert.equal(read.source.operationalState,'WORKING');
  await adapter.run({scope:'DUE'});read=adapter.read();assert.equal(read.data.entries[0].freshness,'CURRENT');assert.ok(read.data.entries[0].learnedRevisionId);assert.equal(read.data.retrievalReady,1);assert.equal(read.source.operationalState,'LIVE');
});

test('Lore workspace contains generic ingestion controls and no fixed Ember Tavern assumptions',()=>{
  const owner=liveOwner({withLore:true}),{ui}=mount(owner);ui.shell.selectWorkspace('lore');ui.scheduler.flush(1);
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/Submit Lore for study/);assert.match(body,/Accepted source entries/);assert.doesNotMatch(body,/Ember Tavern|Sun Blade/);
  const buttons=walk(ui.shell.nodes.workspace).filter(x=>x.tagName==='BUTTON');assert.ok(buttons.every(x=>x.attributes?.type==='button'));
  ui.destroy();
});

test('Connections is first-class, keyboard addressable, and native Brain remains usable without optional resources',()=>{
  const owner=liveOwner(),{ui}=mount(owner);ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);ui.shell.selectWorkspace('connections');ui.scheduler.flush(1);
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/Connections/);assert.match(body,/Jev/);assert.match(body,/Sidecar/);assert.match(body,/Vectoring/);assert.match(body,/Fan-out → Gather/);assert.match(body,/Native Brain remains available|native cognition remains available|native Brain remains usable/i);
  assert.match(body,/Load \/ Refresh Models/);assert.match(body,/Manual model fallback/);assert.match(body,/Test Connection/);
  const passwordFields=walk(ui.shell.nodes.workspace).filter(x=>x.tagName==='INPUT'&&x.attributes?.type==='password');assert.equal(passwordFields.length,3);
  const buttons=walk(ui.shell.nodes.workspace).filter(x=>x.tagName==='BUTTON');assert.ok(buttons.length>0);assert.ok(buttons.every(x=>x.attributes?.type==='button'));
  ui.destroy();
});

test('Connections renders separate Jev Sidecar and Vectoring slots and locks owner-configured resources',async()=>{
  const owner=liveOwner(),host=worker2ResourceHost();owner.bindings.resourceHost=host;
  const{ui}=mount(owner);ui.shell.selectWorkspace('connections');ui.scheduler.flush(1);
  let slots=walk(ui.shell.nodes.workspace).filter(x=>x.dataset?.slot);assert.deepEqual(slots.map(x=>x.dataset.slot),['JEV','SIDECAR','VECTORING']);
  await ui.actionRouter.route({type:'wave13.resource.connect',payload:{role:'JEV',resourceId:'jev:locked',endpoint:'http://127.0.0.1:8080',modelId:'jev-model',capabilities:['SEMANTIC_JUDGMENT']}});
  await ui.actionRouter.route({type:'wave13.resource.connect',payload:{role:'VECTORING',resourceId:'vector:locked',endpoint:'http://127.0.0.1:8090',modelId:'embed-model',capabilities:['RETRIEVAL','EMBED']}});
  ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(2);slots=walk(ui.shell.nodes.workspace).filter(x=>x.dataset?.slot);
  const jev=slots.find(x=>x.dataset.slot==='JEV'),vector=slots.find(x=>x.dataset.slot==='VECTORING'),sidecar=slots.find(x=>x.dataset.slot==='SIDECAR');
  assert.equal(jev.dataset.locked,'true');assert.equal(vector.dataset.locked,'true');assert.equal(sidecar.dataset.locked,'false');
  assert.match(textOf(jev),/CONFIG LOCKED/);assert.match(textOf(vector),/CONFIG LOCKED/);assert.match(textOf(sidecar),/Load \/ Refresh Models/);assert.match(textOf(sidecar),/Test Connection/);
  ui.destroy();
});

test('Connections maps logical fan-out to physical resources and shows owner Gather disposition',()=>{
  const owner=liveOwner({withResources:true}),selection=owner.bindings.readSelection();
  owner.bindings.readScatter=()=>({kind:'RuntimeScatterReceipt',receiptId:'scatter:1',jobs:[
    {taskId:'job:a',capability:'LORE_RETRIEVAL',state:'COMPLETE',resourceId:'sidecar:local'},
    {taskId:'job:b',capability:'GRAPH',state:'COMPLETE',resourceId:'sidecar:local'},
    {taskId:'job:c',capability:'SEMANTIC_JUDGMENT',state:'COMPLETE',resourceId:'jev:local'},
  ],...selection});
  owner.bindings.readGather=()=>({kind:'GatherReceipt',receiptId:'gather:1',results:[
    {resultId:'result:a',capability:'LORE_RETRIEVAL',status:'ADMITTED',accepted:true,resourceId:'sidecar:local',destination:'CONTEXT'},
    {resultId:'result:b',capability:'GRAPH',status:'LATE',accepted:false,resourceId:'sidecar:local',destination:'LATE'},
  ],...selection});
  owner.bindings.readContextSeal=()=>({kind:'ContextSealReceipt',sealId:'seal:1',sealed:true,admittedResultIds:['result:a'],...selection});
  const{ui}=mount(owner);ui.shell.selectWorkspace('connections');ui.scheduler.flush(1);
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/3 logical jobs → 2 physical resources/);assert.match(body,/LORE RETRIEVAL|Lore Retrieval/);assert.match(body,/SEALED/);assert.match(body,/LATE/);
  ui.destroy();
});

test('each product workspace keeps an independent scroll position while the panel header remains mounted',()=>{
  const owner=liveOwner({withLore:true}),{ui}=mount(owner);
  ui.floatingController.open('lore');ui.scheduler.flush(1);ui.shell.nodes.workspace.scrollTop=137;ui.shell.nodes.workspace.dispatch('scroll');
  ui.floatingController.open('brain');ui.scheduler.flush(2);ui.shell.nodes.workspace.scrollTop=41;ui.shell.nodes.workspace.dispatch('scroll');
  ui.floatingController.open('lore');ui.scheduler.flush(3);assert.equal(ui.shell.nodes.workspace.scrollTop,137);
  assert.ok(ui.floatingController.nodes.cardHead.parentNode===ui.floatingController.nodes.card);
  ui.destroy();
});

test('Settings is a labeled product workspace with explicit display controls',()=>{
  const owner=liveOwner(),{ui}=mount(owner);ui.shell.selectWorkspace('settings');ui.scheduler.flush(1);
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/Settings/);assert.match(body,/Detail level/);assert.match(body,/Panel display/);assert.match(body,/Resize/);
  ui.destroy();
});

test('Settings Diagnostics Center centralizes prompt-safe owner telemetry and three resource lanes',async()=>{
  const owner=liveOwner(),host=worker2ResourceHost();owner.bindings.resourceHost=host;
  const{ui}=mount(owner);
  for(const config of [
    {role:'JEV',resourceId:'jev:diag',endpoint:'http://127.0.0.1:8080',modelId:'jev-model',capabilities:[]},
    {role:'SIDECAR',resourceId:'sidecar:diag',endpoint:'http://127.0.0.1:8081',modelId:'sidecar-model',capabilities:[]},
    {role:'VECTORING',resourceId:'vector:diag',endpoint:'http://127.0.0.1:8082',modelId:'vector-model',capabilities:[]},
  ])assert.equal((await ui.actionRouter.route({type:'wave13.resource.connect',payload:config})).ok,true);
  for(const row of ui.operator.resources.read().data.resources)assert.equal((await ui.actionRouter.route({type:'wave13.resource.test',target:row})).ok,true);
  ui.shell.selectWorkspace('settings');ui.scheduler.flush(2);
  const body=textOf(ui.shell.nodes.workspace);
  assert.match(body,/Diagnostics Center/);assert.match(body,/Jev \/ Sidecar \/ Vectoring wiring/);assert.match(body,/Current turn activity/);assert.match(body,/Recent owner resource telemetry/);assert.match(body,/raw prompts are never collected/i);
  const snap=ui.operator.diagnostics.read();
  assert.equal(snap.telemetry.rawPromptTelemetry,false);assert.equal(snap.host.rawPromptTelemetry,false);
  assert.deepEqual(snap.resources.lanes.map(x=>[x.kind,x.connected]),[['JEV',1],['SIDECAR',1],['VECTORING',1]]);
  assert.deepEqual(host.calls.filter(x=>x[0]==='add').map(x=>[x[1].resourceId,x[1].capabilities]),[
    ['jev:diag',['SEMANTIC_JUDGMENT']],['sidecar:diag',['STRUCTURED_EXTRACTION']],['vector:diag',['RETRIEVAL','EMBED']],
  ]);
  assert.ok(snap.telemetry.resourceEvents.some(x=>x.code==='TEST_PASSED'));
  ui.destroy();assert.equal(host.listenerCount(),0);
});

test('Diagnostics Center follows chat switches and rejects stale turn telemetry',()=>{
  const owner=liveOwner(),oldSelection=owner.bindings.readSelection(),staleScatter=scatter(oldSelection);
  owner.bindings.readScatter=()=>staleScatter;
  const{ui}=mount(owner);ui.shell.selectWorkspace('settings');ui.scheduler.flush(1);
  owner.switchStory({chatId:'chat:diagnostics-new',turnId:'turn:diagnostics-new',generationId:'gen:diagnostics-new',location:'Copper Basin'});ui.scheduler.flush(2);
  const snap=ui.operator.diagnostics.read();
  assert.equal(snap.selection.chatId,'chat:diagnostics-new');assert.equal(snap.selection.turnId,'turn:diagnostics-new');
  assert.equal(snap.cognition.jobs.length,0);assert.equal(snap.cognition.errors.scatter.code,'LIVE_RECEIPT_IDENTITY_MISMATCH');
  assert.doesNotMatch(textOf(ui.shell.nodes.workspace),/turn:1/);
  ui.destroy();
});

test('two unrelated stories remain generic through the same UI surface',()=>{
  const owner=liveOwner(),{ui}=mount(owner);ui.shell.selectWorkspace('story');ui.scheduler.flush(1);assert.match(textOf(ui.shell.nodes.workspace),/Moon Harbor/);
  owner.switchStory({chatId:'chat:desert',turnId:'turn:desert',generationId:'gen:desert',location:'Saffron Observatory'});ui.scheduler.flush(2);
  const text=textOf(ui.shell.nodes.workspace);assert.match(text,/Saffron Observatory/);assert.doesNotMatch(text,/Ember Tavern|Sun Blade/);ui.destroy();
});


test('Worker 2 CognitionUiState exact numeric counters stay live instead of degrading',()=>{
  const owner=liveOwner();
  owner.bindings.readCognitionUiState=()=>({kind:'CognitionUiState',turnId:'turn:1',activeTasks:2,hotTasks:1,deepTasks:1,requiredPending:1,opportunisticPending:1,deferredTasks:0,lateResults:0,staleDrops:1,warmHits:4,fallbackCount:0,providerHealth:[],health:'STALE'});
  const{ui}=mount(owner),snap=ui.productAdapter.getSnapshot();
  assert.equal(snap.coprocessor.activeTaskCount,2);assert.equal(snap.coprocessor.hotActivity,1);assert.equal(snap.coprocessor.deepActivity,1);assert.equal(snap.coprocessor.warm.hit,4);
  assert.equal(snap.wave6.sources.coprocessor.mode,'DEGRADED');ui.destroy();
});

test('Worker 2 model discovery stays owner-backed and does not leak submitted credentials',async()=>{
  const host=worker2ResourceHost(),adapter=new Wave13ResourceControlAdapter({bindings:{resourceHost:host}});
  assert.equal(adapter.capabilities().discoverModels,true);
  const discovery=await adapter.discoverModels({role:'SIDECAR',endpoint:'https://openrouter.ai/api/v1',apiKey:'sk-ui-secret',capabilities:['STRUCTURED_EXTRACTION']});
  assert.equal(discovery.state,'READY');assert.equal(discovery.models[0].id,'owner/model-a');
  assert.deepEqual(host.calls[0],['discover',{kind:'OPENAI_COMPATIBLE',endpoint:'https://openrouter.ai/api/v1',capabilities:['STRUCTURED_EXTRACTION'],credentialConfigured:true}]);
  assert.doesNotMatch(JSON.stringify(host.calls),/sk-ui-secret/);assert.doesNotMatch(JSON.stringify(adapter.read()),/sk-ui-secret/);assert.doesNotMatch(JSON.stringify(adapter.lastAction),/sk-ui-secret/);

  const deniedHost=worker2ResourceHost({discoveryState:'UNAUTHORIZED'}),denied=new Wave13ResourceControlAdapter({bindings:{resourceHost:deniedHost}});
  const deniedResult=await denied.discoverModels({role:'JEV',endpoint:'https://openrouter.ai/api/v1',capabilities:['SEMANTIC_JUDGMENT']});
  assert.equal(deniedResult.state,'UNAUTHORIZED');assert.equal(deniedResult.manualModelEntryAllowed,false);
});

test('Worker 2 public resource host add/connect/test/disconnect contract is consumed without UI routing logic',async()=>{
  const owner=liveOwner(),host=worker2ResourceHost();owner.bindings.resourceHost=host;
  const{ui}=mount(owner);
  assert.equal(host.listenerCount(),1);
  const connected=await ui.actionRouter.route({type:'wave13.resource.connect',payload:{role:'JEV',resourceId:'jev:local',endpoint:'http://127.0.0.1:8080',modelId:'jev-local',capabilities:[]}});
  assert.equal(connected.ok,true);
  assert.deepEqual(host.calls.slice(0,2).map(x=>x[0]),['add','connect']);
  assert.equal(host.calls[0][1].kind,'OPENAI_COMPATIBLE');assert.deepEqual(host.calls[0][1].capabilities,['SEMANTIC_JUDGMENT']);assert.equal(host.calls[1][1],'jev:local');
  let read=ui.operator.resources.read();assert.equal(read.data.nativePathAvailable,true);assert.equal(read.data.resources[0].kind,'JEV');assert.equal(read.data.resources[0].state,'READY');assert.deepEqual(read.data.resources[0].capabilities,['SEMANTIC_JUDGMENT']);
  const tested=await ui.actionRouter.route({type:'wave13.resource.test',target:read.data.resources[0]});assert.equal(tested.ok,true);assert.equal(host.calls.at(-1)[0],'test');assert.equal(host.calls.at(-1)[1],'jev:local');
  const disconnected=await ui.actionRouter.route({type:'wave13.resource.disconnect',target:read.data.resources[0]});assert.equal(disconnected.ok,true);assert.equal(host.calls.at(-1)[0],'disconnect');assert.equal(host.calls.at(-1)[1],'jev:local');
  const vector=await ui.actionRouter.route({type:'wave13.resource.connect',payload:{role:'VECTORING',resourceId:'vector:local',endpoint:'http://127.0.0.1:8090',modelId:'embed-local',capabilities:[]}});
  assert.equal(vector.ok,true);const vectorAdd=host.calls.find(x=>x[0]==='add'&&x[1].resourceId==='vector:local');assert.deepEqual(vectorAdd[1].capabilities,['RETRIEVAL','EMBED']);
  read=ui.operator.resources.read();const vectorRow=read.data.resources.find(x=>x.id==='vector:local');assert.equal(vectorRow.kind,'VECTORING');assert.equal(vectorRow.connected,true);
  ui.destroy();assert.equal(host.listenerCount(),0);
});

test('Worker 2 configured resource reconnect uses resourceId and does not duplicate addResource',async()=>{
  const owner=liveOwner(),host=worker2ResourceHost({configured:true});owner.bindings.resourceHost=host;
  const{ui}=mount(owner);const row=ui.operator.resources.read().data.resources[0];assert.equal(row.connected,false);
  const result=await ui.actionRouter.route({type:'wave13.resource.connect',target:row});assert.equal(result.ok,true);
  assert.deepEqual(host.calls,[['connect','sidecar:configured']]);ui.destroy();
});

test('native LoreStudyRuntime object can be projected and driven through its existing public methods',async()=>{
  const owner=liveOwner(),runtime=directLoreRuntime();delete owner.bindings.readLoreStatus;owner.bindings.loreStudyRuntime=runtime;
  const{ui}=mount(owner);assert.equal(runtime.listenerCount,undefined);
  let read=ui.operator.loreStudy.read();assert.equal(read.data.entries.length,0);
  const accepted=await ui.actionRouter.route({type:'wave13.lore.accept',payload:{id:'harbor',title:'Harbor',entries:[{uid:'captain',content:'Vale keeps the blue ledger.',metadata:{}}],fullSnapshot:true}});
  assert.equal(accepted.ok,true);read=ui.operator.loreStudy.read();assert.equal(read.data.entries[0].freshness,'STALE_OR_UNLEARNED');assert.equal(read.data.lifecycle.due,1);
  const studied=await ui.actionRouter.route({type:'wave13.lore.run',payload:{scope:'DUE'}});assert.equal(studied.ok,true);
  read=ui.operator.loreStudy.read();assert.equal(read.data.entries[0].freshness,'CURRENT');assert.equal(read.data.retrievalReady,1);assert.equal(read.data.lifecycle.due,0);
  ui.destroy();
});

function worker2ResourceHost({configured=false,discoveryState='READY'}={}){
  const calls=[],listeners=new Set();let sequence=0;
  const rows=[];
  const diagnostic=(row,code,message,details={})=>{row.diagnostics??=[];row.diagnostics.push({sequence:++sequence,at:sequence,code,message,details});};
  if(configured){const row={kind:'CoprocessorResourceReadModel',resourceId:'sidecar:configured',displayName:'Configured sidecar',state:'CONFIGURED',reasonCode:'CONFIGURED',reason:'Resource configured but not connected.',providerProfileId:'profile:sidecar:configured',providerId:'provider:sidecar:configured',modelId:'local',workerId:'resource:sidecar:configured',declaredCapabilities:['STRUCTURED_EXTRACTION'],activeCapabilities:[],measurementClass:'MEASURED_LIVE',health:'UNAVAILABLE',availability:'UNAVAILABLE',local:true,maxConcurrency:1,activeExecutions:0,callable:false,diagnostics:[]};diagnostic(row,'CONFIGURED','Resource configuration accepted.');rows.push(row);}
  const emit=(type,row)=>{sequence+=1;for(const listener of [...listeners])listener({kind:'CoprocessorResourceConnectionEvent',sequence,type,resource:{...row}});};
  return{
    calls,
    actions:{
      async discoverModels(config){const safe={kind:config.kind,endpoint:config.endpoint,capabilities:[...(config.capabilities??[])],credentialConfigured:Boolean(config.apiKey)};calls.push(['discover',safe]);
        if(discoveryState==='UNAUTHORIZED')return{kind:'ResourceModelDiscoveryResult',state:'UNAUTHORIZED',models:[],manualModelEntryAllowed:false,reasonCode:'CREDENTIAL_REQUIRED',reason:'A session credential is required before model discovery.',credentialConfigured:false};
        if(discoveryState==='UNSUPPORTED')return{kind:'ResourceModelDiscoveryResult',state:'UNSUPPORTED',models:[],manualModelEntryAllowed:true,reasonCode:'MODEL_DISCOVERY_UNSUPPORTED',reason:'Provider does not support discovery.',credentialConfigured:Boolean(config.apiKey)};
        if(discoveryState==='EMPTY')return{kind:'ResourceModelDiscoveryResult',state:'EMPTY',models:[],manualModelEntryAllowed:false,reasonCode:'MODEL_DISCOVERY_EMPTY',reason:'Provider returned no models.',credentialConfigured:Boolean(config.apiKey)};
        if(discoveryState==='UNREACHABLE')return{kind:'ResourceModelDiscoveryResult',state:'UNREACHABLE',models:[],manualModelEntryAllowed:false,reasonCode:'MODEL_DISCOVERY_UNREACHABLE',reason:'Provider endpoint is unreachable.',credentialConfigured:Boolean(config.apiKey)};
        return{kind:'ResourceModelDiscoveryResult',state:'READY',models:[{id:'owner/model-a',displayName:'Owner Model A'}],manualModelEntryAllowed:false,reasonCode:'MODEL_DISCOVERY_READY',reason:'Provider model discovery completed.',credentialConfigured:Boolean(config.apiKey)};},
      addResource(config){const safe={...config,capabilities:[...config.capabilities]};delete safe.apiKey;safe.credentialConfigured=Boolean(config.apiKey);calls.push(['add',safe]);const row={kind:'CoprocessorResourceReadModel',resourceId:config.resourceId,displayName:config.displayName,state:'CONFIGURED',reasonCode:'CONFIGURED',reason:'Resource configured but not connected.',providerProfileId:config.providerProfileId,providerId:config.providerId,modelId:config.modelId,workerId:config.workerId,declaredCapabilities:[...config.capabilities],activeCapabilities:[],measurementClass:'MEASURED_LIVE',health:'UNAVAILABLE',availability:'UNAVAILABLE',credentialConfigured:Boolean(config.apiKey),local:Boolean(config.local),maxConcurrency:config.maxConcurrency,activeExecutions:0,callable:false,diagnostics:[]};diagnostic(row,'CONFIGURED','Resource configuration accepted.');rows.push(row);emit('RESOURCE_CONFIGURED',row);return{...row};},
      async connectResource(id){calls.push(['connect',id]);const row=rows.find(x=>x.resourceId===id);row.state='READY';row.reasonCode='HEALTH_CHECK_PASSED';row.reason='Health probe passed.';row.health='HEALTHY';row.availability='AVAILABLE';row.activeCapabilities=[...row.declaredCapabilities];row.callable=true;diagnostic(row,'HEALTH_CHECK_PASSED','Health probe passed.');emit('RESOURCE_READY',row);return{...row};},
      disconnectResource(id){calls.push(['disconnect',id]);const row=rows.find(x=>x.resourceId===id);row.state='DISCONNECTED';row.reasonCode='OPERATOR_DISCONNECT';row.reason='Operator disconnected resource.';row.health='UNAVAILABLE';row.availability='UNAVAILABLE';row.activeCapabilities=[];row.callable=false;diagnostic(row,'DISCONNECTED','Operator disconnected resource.');emit('RESOURCE_DISCONNECTED',row);return{...row};},
      async testResource(id){calls.push(['test',id]);const row=rows.find(x=>x.resourceId===id);row.lastTest={status:'PASS',mode:'PROBE',latencyMs:3};diagnostic(row,'TEST_PASSED','Resource test passed.',{latencyMs:3});emit('RESOURCE_TESTED',row);return{resource:{...row},result:{kind:'ResourceProbeResult',ok:true,latencyMs:3,measurementClass:'MEASURED_LIVE'}};},
    },
    read:{resources:()=>({kind:'CoprocessorResourceConnectionReadModel',contractVersion:'1.0.0',sequence,resources:rows.map(x=>({...x,declaredCapabilities:[...x.declaredCapabilities],activeCapabilities:[...x.activeCapabilities]})),readyResourceCount:rows.filter(x=>x.state==='READY').length,nativePathRequired:!rows.some(x=>x.state==='READY')})},
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    listenerCount:()=>listeners.size,
  };
}

function directLoreRuntime(){
  const entries=[],revisions=new Map(),learned=new Map(),artifacts=new Map(),obligations=[];
  const registry={
    sequence:0,
    listEntries(){return entries.map(x=>({...x}));},
    currentRevision(sourceId,{allowMissing=false}={}){const row=revisions.get(sourceId);if(!row&&!allowMissing)throw new Error('missing');return row?{...row}:null;},
  };
  const store={
    publicationSequence:0,
    currentLearnedRevision(sourceId){const row=learned.get(sourceId);return row?{...row}:null;},
    artifactsForLearnedRevision(id){return (artifacts.get(id)??[]).map(x=>structuredClone(x));},
    currentArtifacts(){return [...artifacts.values()].flat().map(x=>structuredClone(x));},
    conflicts(){return[];},
  };
  return{
    registry,store,
    ingestLorebook(book){
      for(const entry of book.entries){const sourceId='lore:'+book.id+':'+entry.uid,revision={id:sourceId+'@r1',sourceId,state:'CURRENT'};entries.push({sourceId,lorebookId:book.id,uid:entry.uid});revisions.set(sourceId,revision);obligations.push({id:'obligation:'+entry.uid,sourceId,sourceRevisionId:revision.id,state:'DUE'});registry.sequence+=1;}
      return entries.map(x=>({...x}));
    },
    listObligations(){return obligations.map(x=>({...x}));},
    dueObligations(){return obligations.filter(x=>['DUE','PENDING','CHECKPOINTED'].includes(x.state)).map(x=>({...x}));},
    run(id){
      const obligation=obligations.find(x=>x.id===id);obligation.state='COMPLETED';const revision=revisions.get(obligation.sourceId),learnedId='learned:'+obligation.sourceId;
      learned.set(obligation.sourceId,{id:learnedId,sourceId:obligation.sourceId,sourceRevisionId:revision.id,state:'CURRENT'});
      artifacts.set(learnedId,[{kind:'LoreLearnedArtifact',artifactType:'RETRIEVAL',id:'retrieval:'+obligation.sourceId,sourceId:obligation.sourceId,sourceRevisionId:revision.id,authorityClass:'DERIVED',temporalClass:'CURRENT',freshness:'CURRENT',unresolved:false,provenance:{sourceId:obligation.sourceId,sourceRevisionId:revision.id}}]);store.publicationSequence+=1;
      return{obligation:{...obligation},learnedRevision:{...learned.get(obligation.sourceId)},checkpointed:false};
    },
  };
}
