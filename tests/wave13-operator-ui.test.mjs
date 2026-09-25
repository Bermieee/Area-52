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
function scatter(selection){return{kind:'RuntimeScatterReceipt',jobs:[{taskId:'job:1',capability:'GRAPH'}],admittedJobCount:1,resourceCount:1,resourceIds:['local:1'],requiredFallback:0,opportunisticPending:0,...selection};}
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

test('Wave 13 rail is vertical, edge-aware and opens the existing workspace card',()=>{
  const owner=liveOwner(),{ui}=mount(owner,{width:1280,height:800});
  assert.ok(ui.floatingController);
  let d=ui.floatingController.diagnostics();
  assert.equal(d.card.side,'LEFT');
  assert.equal(ui.shell.currentWorkspace,'home');
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
  assert.ok(d.rail.x<=20);assert.equal(d.card.side,'RIGHT');assert.ok(d.card.x>d.rail.x);
  ui.destroy();
});

test('rail and card keyboard movement, shrink, minimize, restore and close remain reachable',()=>{
  const owner=liveOwner(),{ui}=mount(owner,{width:920,height:680});
  const c=ui.floatingController;c.open('story');ui.scheduler.flush(1);
  const before=c.diagnostics();c.nodes.railHandle.dispatch('keydown',{key:'ArrowLeft'});c.nodes.cardHandle.dispatch('keydown',{key:'ArrowUp'});ui.scheduler.flush(2);
  const moved=c.diagnostics();assert.ok(moved.rail.x<=before.rail.x);assert.ok(moved.card.y<=before.card.y);
  const width=ui.presentation.get().frontFaceWidth;c.nodes.shrink.dispatch('click');assert.ok(ui.presentation.get().frontFaceWidth<=width);
  c.nodes.minimize.dispatch('click');assert.equal(c.diagnostics().card.minimized,true);assert.equal(ui.shell.currentWorkspace,'story');
  c.nodes.minimize.dispatch('click');assert.equal(c.diagnostics().card.minimized,false);
  c.nodes.close.dispatch('click');assert.equal(ui.presentation.get().frontFaceMode,FrontFaceMode.COLLAPSED);
  c.open();assert.equal(ui.shell.currentWorkspace,'story');ui.destroy();
});

test('narrow viewport clamps rail and card to reachable bounds',()=>{
  const owner=liveOwner(),{ui}=mount(owner,{width:420,height:620});ui.floatingController.open('brain');ui.presentation.setWidth(720);ui.scheduler.flush(2);
  const d=ui.floatingController.diagnostics();
  assert.ok(d.rail.x>=10&&d.rail.x+64<=410);
  assert.ok(d.card.x>=10);assert.ok(d.card.x+d.card.width<=410);
  assert.ok(d.card.y>=10&&d.card.y<620);
  ui.destroy();
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

test('Brain resource controls are keyboard buttons and native Brain remains visible with no optional resource',()=>{
  const owner=liveOwner(),{ui}=mount(owner);ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);ui.shell.selectWorkspace('brain');ui.scheduler.flush(1);
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/Jev \/ sidecar resources/);assert.match(body,/Native Brain remains available|native Brain remains usable/i);
  const buttons=walk(ui.shell.nodes.workspace).filter(x=>x.tagName==='BUTTON');assert.ok(buttons.length>0);assert.ok(buttons.every(x=>x.attributes?.type==='button'));
  ui.destroy();
});

test('two unrelated stories remain generic through the same UI surface',()=>{
  const owner=liveOwner(),{ui}=mount(owner);ui.shell.selectWorkspace('story');ui.scheduler.flush(1);assert.match(textOf(ui.shell.nodes.workspace),/Moon Harbor/);
  owner.switchStory({chatId:'chat:desert',turnId:'turn:desert',generationId:'gen:desert',location:'Saffron Observatory'});ui.scheduler.flush(2);
  const text=textOf(ui.shell.nodes.workspace);assert.match(text,/Saffron Observatory/);assert.doesNotMatch(text,/Ember Tavern|Sun Blade/);ui.destroy();
});
