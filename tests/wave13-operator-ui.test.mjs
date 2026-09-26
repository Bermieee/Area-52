import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DemoEvidenceJournal, FrontFaceMode, ProductDetailLevel, UIStateStore,
  Wave13LoreAuthoringUIAdapter, Wave13LoreStudyUIAdapter, Wave13ResourceControlAdapter,
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
  constructor(width=1280,height=800){super();this.body=new Node('body',this);this.documentElement=new Node('html',this);this.documentElement.clientWidth=width;this.documentElement.clientHeight=height;this.body.clientWidth=width;this.body.clientHeight=height;const listeners=new Map();this.defaultView={innerWidth:width,innerHeight:height,addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},dispatch(type,event={}){for(const fn of listeners.get(type)??[])fn({type,...event});},listenerCount(type){return listeners.get(type)?.size??0;}};}
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

function mount(owner,{width=1280,height=800,floating=true,storage=null}={}){
  const document=new Doc(width,height),root=new Node('aside',document);document.body.append(root);
  const stateStore=new UIStateStore({storage:storage??memory(),namespace:'wave13-test'});
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

test('browser viewport resize automatically reclamps the floating rail and attached panel',()=>{
  let viewport={width:1100,height:760};
  const owner=liveOwner(),{ui,document}=mount(owner,{width:1100,height:760});
  ui.floatingController.viewportProvider=()=>viewport;
  ui.floatingController.open('brain');ui.scheduler.flush(1);
  viewport={width:390,height:560};document.defaultView.dispatch('resize');ui.scheduler.flush(2);
  const d=ui.floatingController.diagnostics();
  assert.ok(d.rail.x>=8&&d.rail.x+d.rail.width<=382);
  assert.ok(d.card.x>=8&&d.card.x+d.card.width<=382);
  assert.ok(d.card.y>=8&&d.card.y+d.card.height<=552);
  assert.equal(d.card.attached,true);
  assert.equal(document.defaultView.listenerCount('resize'),1);
  ui.destroy();assert.equal(document.defaultView.listenerCount('resize'),0);
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

test('Brain activity distinguishes sealed generation delivery from post-response learning',()=>{
  const owner=liveOwner();
  const selection=owner.bindings.readSelection();
  let learned=false;
  owner.bindings.readGeneration=({generationId})=>generationId===selection.generationId?{
    kind:'NativeBrainGenerationReadModel',...selection,state:learned?'LEARNED':'SEALED_FOR_GENERATION',
    promptPlan:{promptPlanId:'plan:1'},contextSeal:{id:'seal:1'},
    identityResolution:{kind:'NativeBrainIdentityResolutionReadModel',status:'READY',entities:['captain'],resolved:['captain'],unresolved:[],secretText:'must not surface'},
    graphTraversal:{kind:'GraphTraversalReceipt',status:'COMPLETE',visitedNodeIds:['n1','n2'],visitedEdgeIds:['e1'],rawEvidence:'must not surface'},
    retrievalBudget:{kind:'RetrievalBudgetReceipt',status:'COMPLETE',admitted:['a'],deferred:['b'],query:'must not surface'},
    rejectedEvidence:{kind:'RejectedEvidenceReadModel',items:[{id:'bad',content:'must not surface'}],reasonCode:'STALE_SOURCE'},
    learningReceipt:learned?{kind:'NativeBrainLearningReceipt',sourceRevisionId:'narrative:r1'}:null,
  }:null;
  owner.bindings.readContextSeal=()=>({kind:'ContextSealReceipt',id:'seal:1',sealedState:true,effectiveAdmittedResultIds:[],...selection});
  const{ui}=mount(owner);ui.shell.selectWorkspace('brain');ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(2);
  let pipeline=ui.operator.operations.read().pipeline,body=textOf(ui.shell.nodes.workspace);
  assert.equal(pipeline.deliveryReceipt,true);assert.equal(pipeline.learningReceipt,false);assert.match(body,/Generation delivery/);assert.match(body,/No learning receipt yet/);
  learned=true;ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(3);pipeline=ui.operator.operations.read().pipeline;body=textOf(ui.shell.nodes.workspace);
  assert.equal(pipeline.learningReceipt,true);assert.match(body,/Learning receipt recorded/);
  ui.productAdapter.setDetailLevel(ProductDetailLevel.ADVANCED);ui.shell.selectWorkspace('settings');ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(4);
  const diagnostics=ui.operator.diagnostics.read(),advanced=textOf(ui.shell.nodes.workspace);
  assert.equal(diagnostics.generationInspection.identityResolution.counts.entities,1);assert.equal(diagnostics.generationInspection.graphTraversal.counts.visitedNodeIds,2);assert.equal(diagnostics.generationInspection.rejectedEvidence.count,1);
  assert.match(advanced,/Owner generation inspection/);assert.match(advanced,/Rejected evidence 1 rejected/);
  assert.doesNotMatch(JSON.stringify(diagnostics),/must not surface/);assert.doesNotMatch(advanced,/must not surface/);
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

test('Lore READY CURRENT entry with semanticDiff does not show stale source revision warning',()=>{
  const owner=liveOwner();
  owner.bindings.readLoreStatus=()=>({
    kind:'LorePublicIntegrationSurface',
    entries:[{
      sourceId:'lore:moon:captain',lorebookId:'moon',uid:'captain',
      sourceRevisionId:'lore:moon:captain@r2',sourceState:'CURRENT',
      learnedRevisionId:'learned:lore:moon:captain@r2',freshness:'CURRENT',
      operatorState:'READY',studyState:'COMPLETED',studyAttempts:1,studyError:null,
      semanticDiff:{changed:true,claims:{added:['claim:2'],removed:['claim:1']}},
      artifactIds:['retrieval:captain'],
      retrievalRepresentations:[{artifactId:'retrieval:captain',sourceRevisionId:'lore:moon:captain@r2',authorityClass:'DERIVED',temporalClass:'CURRENT',unresolved:false,provenance:{sourceRevisionId:'lore:moon:captain@r2'}}],
      representations:[],representationReady:true,retrievalReady:true,
    }],
    artifacts:[],conflicts:[],counts:{READY:1,ACCEPTED:0,STUDYING:0,FAILED:0,REMOVED:0},
    lifecycle:{counts:{DUE:0,PENDING:0,ACTIVE:0,CHECKPOINTED:0,COMPLETED:1,SUPERSEDED:0,STALE:0,INVALID:0},due:0,active:0},
  });
  const{ui}=mount(owner);ui.shell.selectWorkspace('lore');ui.scheduler.flush(1);
  const body=textOf(ui.shell.nodes.workspace);
  assert.match(body,/Learned representations are current and the Lore owner reports this entry retrieval-ready/);
  assert.doesNotMatch(body,/Source revision changed/);
  ui.destroy();
});

test('Lore stale learned revision still shows source revision warning',()=>{
  const owner=liveOwner();
  owner.bindings.readLoreStatus=()=>({
    kind:'LorePublicIntegrationSurface',
    entries:[{
      sourceId:'lore:moon:captain',lorebookId:'moon',uid:'captain',
      sourceRevisionId:'lore:moon:captain@r2',sourceState:'CURRENT',
      learnedRevisionId:'learned:lore:moon:captain@r1',freshness:'STALE_OR_UNLEARNED',
      operatorState:'ACCEPTED',studyState:'DUE',studyAttempts:1,studyError:null,
      semanticDiff:{changed:true},
      artifactIds:[],retrievalRepresentations:[],representations:[],representationReady:false,retrievalReady:false,
    }],
    artifacts:[],conflicts:[],counts:{READY:0,ACCEPTED:1,STUDYING:0,FAILED:0,REMOVED:0},
    lifecycle:{counts:{DUE:1,PENDING:0,ACTIVE:0,CHECKPOINTED:0,COMPLETED:0,SUPERSEDED:0,STALE:0,INVALID:0},due:1,active:0},
  });
  const{ui}=mount(owner);ui.shell.selectWorkspace('lore');ui.scheduler.flush(1);
  const body=textOf(ui.shell.nodes.workspace);
  assert.match(body,/Source revision changed/);
  assert.match(body,/not treated as current until the Lore owner re-studies and publishes readiness/);
  ui.destroy();
});

test('Lore owner lifecycle distinguishes accepted source from learned retrieval-ready state',async()=>{
  const owner=liveOwner({withLore:true}),adapter=new Wave13LoreStudyUIAdapter({bindings:owner.bindings,selectionProvider:owner.bindings.readSelection});
  let read=adapter.read();assert.equal(read.data.entries.length,0);
  await adapter.accept({id:'orchard-lore',title:'Glass Orchard',entries:[{uid:'keeper',content:'Ilya tends the Glass Orchard.',metadata:{title:'Ilya'}}],fullSnapshot:true});
  read=adapter.read();assert.equal(read.data.entries[0].freshness,'STALE_OR_UNLEARNED');assert.equal(read.data.entries[0].learnedRevisionId,null);assert.equal(read.data.retrievalReady,0);assert.equal(read.source.operationalState,'WORKING');
  await adapter.run({scope:'DUE'});read=adapter.read();assert.equal(read.data.entries[0].freshness,'CURRENT');assert.ok(read.data.entries[0].learnedRevisionId);assert.equal(read.data.retrievalReady,1);assert.equal(read.source.operationalState,'LIVE');
});

test('Lore workspace uses SillyTavern selection instead of manual ID or pasted JSON in the normal flow',()=>{
  const owner=liveOwner({withLore:true}),{ui}=mount(owner);ui.shell.selectWorkspace('lore');ui.scheduler.flush(1);
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/SillyTavern selected Lorebook/);assert.match(body,/No Lorebook selected|discovery unavailable/i);
  assert.doesNotMatch(body,/Submit Lore for study|Authored Lore/);
  const inputs=walk(ui.shell.nodes.workspace).filter(x=>x.tagName==='INPUT'||x.tagName==='TEXTAREA');
  assert.ok(inputs.every(x=>x.getAttribute?.('aria-label')!=='Lorebook ID'&&x.getAttribute?.('aria-label')!=='Lore content'));
  const buttons=walk(ui.shell.nodes.workspace).filter(x=>x.tagName==='BUTTON');assert.ok(buttons.every(x=>x.attributes?.type==='button'));
  ui.destroy();
});

test('Lore selected-book discovery shows real title ID and entry count before acceptance',async()=>{
  const owner=liveOwner({withLore:true});
  owner.bindings.readSelectedLorebookSelection=()=>({kind:'SillyTavernLorebookSelection',selected:true,lorebookId:'Moon Harbor',title:'Moon Harbor',source:'SILLYTAVERN_WORLD_INFO_EDITOR'});
  owner.bindings.discoverSelectedLorebook=async()=>({id:'Moon Harbor',title:'Moon Harbor',entries:[
    {uid:'captain',content:'Captain Vale keeps the blue ledger.',metadata:{title:'Captain Vale'}},
    {uid:'dock',content:'The east dock closes at midnight.',metadata:{title:'East Dock'}},
  ],fullSnapshot:true,discovery:{kind:'SillyTavernLorebookDiscoveryReceipt',contractVersion:1,source:'SILLYTAVERN_WORLD_INFO_EDITOR',lorebookId:'Moon Harbor',title:'Moon Harbor',entryCount:2}});
  const{ui}=mount(owner);await ui.operator.loreStudy.discoverSelectedLorebook();ui.shell.selectWorkspace('lore');ui.scheduler.flush(1);
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/Moon Harbor/);assert.match(body,/Entry count 2/);assert.match(body,/Accept for study/);
  const snapshot=ui.operator.loreStudy.selectedLorebook().snapshot;assert.equal(snapshot.id,'Moon Harbor');assert.equal(snapshot.discovery.entryCount,2);
  assert.equal((await ui.actionRouter.route({type:'wave13.lore.accept',payload:snapshot})).ok,true);
  ui.destroy();
});

test('Brain operations distinguish producer availability execution results and context admission',()=>{
  const owner=liveOwner({withResources:true});
  const{ui}=mount(owner),read=ui.operator.operations.read();
  assert.ok(read.pipeline.registeredProducers>=1);assert.equal(read.pipeline.mappingReceipt,true);assert.equal(read.pipeline.logicalJobsMapped,1);assert.equal(read.pipeline.mappedResourceCount,1);
  assert.equal(read.pipeline.executionReceipt,false);assert.equal(read.pipeline.physicalExecutionAttempts,0);
  assert.equal(typeof read.pipeline.resultReceipt,'boolean');assert.equal(typeof read.pipeline.admissionReceipt,'boolean');
  ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);ui.shell.selectWorkspace('brain');ui.scheduler.flush(1);
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/Execution \/ admission|Jobs mapped/);assert.match(body,/Physical execution/);assert.match(body,/Returned results/);assert.match(body,/Context-admitted results|Context admitted/);
  ui.destroy();
});

test('Home Inspect details opens the visible inspector with exact selected-turn owner receipts',()=>{
  const owner=liveOwner(),selection=owner.bindings.readSelection();
  owner.bindings.readTruth=()=>({kind:'TruthAssessment',id:'truth:1',truthResults:[{candidateId:'candidate:1',classification:'CURRENT',usableForIntent:true}],...selection});
  owner.bindings.readJev=()=>({kind:'JevDecisionReceipt',receiptId:'jev:1',outcome:'UNRESOLVED',serviceStatus:'JEV_READY',selectedOptionIds:[],rejectedOptionIds:[],evidenceUsed:[],...selection});
  owner.bindings.readGather=()=>({kind:'GatherReceipt',receiptId:'gather:inspect',results:[{resultId:'result:inspect',capability:'GRAPH',status:'ADMITTED',accepted:true,resourceId:'local:1',destination:'CONTEXT'}],...selection});
  owner.bindings.readContextSeal=()=>({kind:'ContextSealReceipt',sealId:'seal:inspect',sealed:true,admittedResultIds:['result:inspect'],...selection});
  owner.bindings.readCognitionUiState=()=>({kind:'CognitionUiState',physicalExecution:{attempts:1,succeeded:1,failed:0},configuredResources:1,connectedResources:1,physicallyExecutedResources:1,ownerAcceptedResources:1,...selection});
  const{ui}=mount(owner);ui.shell.selectWorkspace('home');ui.scheduler.flush(1);
  const stage=(id)=>walk(ui.shell.nodes.workspace).find(x=>String(x.className??'').includes('a52-wave13-stage')&&x.dataset?.producerId===id);
  for(const id of ['scene','runtime','coprocessor','choice','truth','jev','gather','seal']){
    const card=stage(id);assert.ok(card,'missing '+id+' producer card');
    const button=walk(card).find(x=>x.tagName==='BUTTON'&&x.textContent==='Inspect details');assert.ok(button,'missing '+id+' Inspect details');
    button.dispatch('click');ui.scheduler.flush(2);
    const selected=ui.shell.inspector.selection;assert.equal(ui.presentation.get().inspectorVisible,true);assert.equal(selected.producerId,id);assert.equal(selected.selection.chatId,selection.chatId);assert.equal(selected.selection.turnId,selection.turnId);assert.equal(selected.selection.generationId,selection.generationId);assert.equal(selected.available,true,id);
    assert.match(textOf(ui.shell.nodes.inspectorHost),/detail/i);
  }
  ui.destroy();
});

test('Inspect details explains unavailable owner receipts instead of manufacturing success',()=>{
  const owner=liveOwner(),{ui}=mount(owner);ui.shell.selectWorkspace('home');ui.scheduler.flush(1);
  const jev=walk(ui.shell.nodes.workspace).find(x=>String(x.className??'').includes('a52-wave13-stage')&&x.dataset?.producerId==='jev');
  const button=walk(jev).find(x=>x.tagName==='BUTTON'&&x.textContent==='Inspect details');button.dispatch('click');ui.scheduler.flush(2);
  assert.equal(ui.presentation.get().inspectorVisible,true);assert.equal(ui.shell.inspector.selection.available,false);
  assert.equal(ui.shell.inspector.selection.payload.status,'UNAVAILABLE');assert.match(ui.shell.inspector.selection.reason,/not connected|not published|unavailable/i);
  ui.destroy();
});

test('activity feed is exact-selection fenced and old-chat notices cannot inspect as current',()=>{
  const owner=liveOwner(),storage=memory(),{ui}=mount(owner,{storage});ui.scheduler.flush(1);ui.operator.captureEvidence();ui.operator.activityFeed.render();
  const oldSelection=owner.bindings.readSelection(),oldButton=walk(ui.shell.nodes.strip).find(x=>x.tagName==='BUTTON');assert.ok(oldButton);
  owner.switchStory({chatId:'chat:new-feed',turnId:'turn:new-feed',generationId:'gen:new-feed',location:'Copper Basin'});ui.scheduler.flush(2);ui.operator.captureEvidence();ui.operator.activityFeed.render();
  assert.doesNotMatch(textOf(ui.shell.nodes.strip),new RegExp(oldSelection.turnId.replace(':','\\:')));
  assert.equal(ui.shell.inspector.selection,null);oldButton.dispatch('click');ui.scheduler.flush(3);assert.equal(ui.shell.inspector.selection,null);
  const currentButton=walk(ui.shell.nodes.strip).find(x=>x.tagName==='BUTTON');assert.ok(currentButton);currentButton.dispatch('click');ui.scheduler.flush(4);
  assert.equal(ui.shell.inspector.selection.selection.turnId,'turn:new-feed');assert.equal(ui.presentation.get().inspectorVisible,true);
  ui.destroy();
});


test('local evidence journal survives UI reload with the same browser storage and remains exportable',()=>{
  const owner=liveOwner(),storage=memory(),selection=owner.bindings.readSelection();
  const first=mount(owner,{storage});first.ui.scheduler.flush(1);first.ui.operator.captureEvidence();
  const before=first.ui.operator.evidenceJournal.readTurn(selection);assert.ok(before);assert.ok(before.entries.length>0);first.ui.destroy();
  const second=mount(owner,{storage});second.ui.scheduler.flush(2);
  const after=second.ui.operator.evidenceJournal.readTurn(selection);assert.ok(after);assert.equal(after.key,before.key);assert.ok(after.entries.length>=before.entries.length);
  second.ui.shell.selectWorkspace('settings');second.ui.scheduler.flush(3);
  const body=textOf(second.ui.shell.nodes.workspace);assert.match(body,/Local evidence journal/);assert.match(body,/Export selected turn evidence/);
  const exported=second.ui.operator.evidenceJournal.exportEvidence({selection});assert.equal(exported.turns.length,1);assert.equal(exported.safety.rawPromptsPersisted,false);
  second.ui.destroy();
});


test('Memory no-evidence owner code is translated to plain language while the code remains inspectable',()=>{
  const owner=liveOwner();owner.bindings.readMemoryStatus=()=>({kind:'MemoryStatus',reasonCode:'MEMORY_NO_EVIDENCE_FOR_SELECTED_CHAT',...owner.bindings.readSelection()});
  const{ui}=mount(owner),stage=ui.operator.operations.read().stages.find(x=>x.id==='memory');
  assert.equal(stage.state,'IDLE');assert.equal(stage.reason,'No memories recorded for this chat yet.');assert.equal(stage.errorCode,'MEMORY_NO_EVIDENCE_FOR_SELECTED_CHAT');
  ui.destroy();
});

test('Connections cards use panel-width responsive tracks instead of fixed three-column squeezing',()=>{
  const css=readFileSync(new URL('../styles/ui-core-wave13.css',import.meta.url),'utf8');
  assert.match(css,/\.a52-wave13-connection-slots\{[^}]*repeat\(auto-fit,minmax\(min\(100%,280px\),1fr\)\)/);
});

test('Connections is first-class, keyboard addressable, and native Brain remains usable without optional resources',()=>{
  const owner=liveOwner(),{ui}=mount(owner);ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);ui.shell.selectWorkspace('connections');ui.scheduler.flush(1);
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/Connections/);assert.match(body,/Jev/);assert.match(body,/Sidecar/);assert.match(body,/Vectoring/);assert.match(body,/Fan-out → Gather/);assert.match(body,/Native Brain remains available|native cognition remains available|native Brain remains usable/i);
  assert.match(body,/Connection setup unavailable/);
  const passwordFields=walk(ui.shell.nodes.workspace).filter(x=>x.tagName==='INPUT'&&x.attributes?.type==='password');assert.equal(passwordFields.length,0);
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
  assert.match(textOf(jev),/CONFIG LOCKED/);assert.match(textOf(jev),/Qualification/);assert.match(textOf(vector),/CONFIG LOCKED/);assert.match(textOf(vector),/Qualification/);assert.match(textOf(sidecar),/Load \/ Refresh Models/);assert.match(textOf(sidecar),/Model/);assert.doesNotMatch(textOf(sidecar),/Manual model fallback/);assert.match(textOf(sidecar),/Test Connection/);
  const passwordFields=walk(sidecar).filter(x=>x.tagName==='INPUT'&&x.attributes?.type==='password');assert.equal(passwordFields.length,1);
  ui.destroy();
});

test('Connections model input stays editable and discovered models are suggestions rather than a whitelist',async()=>{
  const owner=liveOwner(),host=worker2ResourceHost();owner.bindings.resourceHost=host;
  const{ui}=mount(owner);ui.shell.selectWorkspace('connections');ui.scheduler.flush(1);
  const sidecar=walk(ui.shell.nodes.workspace).find(x=>x.dataset?.slot==='SIDECAR');
  const fieldByLabel=(root,label)=>walk(root).find(x=>x.getAttribute?.('aria-label')===label);
  const buttonByLabel=(root,label)=>walk(root).find(x=>x.tagName==='BUTTON'&&x.textContent===label);
  const endpoint=fieldByLabel(sidecar,'Sidecar endpoint'),model=fieldByLabel(sidecar,'Sidecar model');
  assert.equal(model.tagName,'INPUT');assert.equal(model.disabled,false);assert.ok(model.getAttribute('list'));
  endpoint.value='https://openrouter.ai/api/v1';endpoint.dispatch('input');
  buttonByLabel(sidecar,'Load / Refresh Models').dispatch('click');await Promise.resolve();await Promise.resolve();
  const suggestions=walk(sidecar).find(x=>x.tagName==='DATALIST');
  assert.ok(suggestions);assert.ok(walk(suggestions).some(x=>x.tagName==='OPTION'&&x.value==='owner/model-a'));
  model.value='owner/manual-not-in-list';model.dispatch('input');
  buttonByLabel(sidecar,'Test Connection').dispatch('click');await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.ok(host.calls.some(x=>x[0]==='add'&&x[1]?.modelId==='owner/manual-not-in-list'));
  ui.destroy();
});

test('Connections preserves independent non-secret drafts when another slot becomes configured',async()=>{
  const owner=liveOwner(),host=worker2ResourceHost();owner.bindings.resourceHost=host;
  const{ui}=mount(owner);ui.shell.selectWorkspace('connections');ui.scheduler.flush(1);
  const slot=(id)=>walk(ui.shell.nodes.workspace).find(x=>x.dataset?.slot===id);
  const fieldByLabel=(root,label)=>walk(root).find(x=>x.getAttribute?.('aria-label')===label);
  let sidecar=slot('SIDECAR'),vector=slot('VECTORING');
  const sideName=fieldByLabel(sidecar,'Sidecar connection name'),sideEndpoint=fieldByLabel(sidecar,'Sidecar endpoint'),sideKey=fieldByLabel(sidecar,'Sidecar API key');
  const vectorName=fieldByLabel(vector,'Vectoring connection name'),vectorEndpoint=fieldByLabel(vector,'Vectoring endpoint'),vectorKey=fieldByLabel(vector,'Vectoring API key');
  sideName.value='Draft Sidecar';sideName.dispatch('input');sideEndpoint.value='https://openrouter.ai/api/v1';sideEndpoint.dispatch('input');sideKey.value='sk-side-secret';sideKey.dispatch('input');
  vectorName.value='Draft Vector';vectorName.dispatch('input');vectorEndpoint.value='https://vector.example/v1';vectorEndpoint.dispatch('input');vectorKey.value='sk-vector-secret';vectorKey.dispatch('input');

  const jev=await ui.actionRouter.route({type:'wave13.resource.connect',payload:{role:'JEV',displayName:'Connected Jev',endpoint:'http://127.0.0.1:8080',modelId:'jev-model',capabilities:['SEMANTIC_JUDGMENT']}});
  assert.equal(jev.ok,true);ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(2);

  assert.equal(slot('JEV').dataset.locked,'true');sidecar=slot('SIDECAR');vector=slot('VECTORING');
  assert.equal(fieldByLabel(sidecar,'Sidecar connection name').value,'Draft Sidecar');assert.equal(fieldByLabel(sidecar,'Sidecar endpoint').value,'https://openrouter.ai/api/v1');
  assert.equal(fieldByLabel(vector,'Vectoring connection name').value,'Draft Vector');assert.equal(fieldByLabel(vector,'Vectoring endpoint').value,'https://vector.example/v1');
  assert.equal(fieldByLabel(sidecar,'Sidecar API key').value,'');assert.equal(fieldByLabel(vector,'Vectoring API key').value,'');
  assert.match(textOf(sidecar),/API key cleared on refresh/);assert.match(textOf(vector),/API key cleared on refresh/);
  const serialized=JSON.stringify({read:ui.operator.resources.read(),diagnostics:ui.operator.diagnostics.read(),calls:host.calls});
  assert.doesNotMatch(serialized,/sk-side-secret|sk-vector-secret/);
  ui.destroy();
});

test('Connections maps logical fan-out to resource identities and shows owner Gather disposition',()=>{
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
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/3 logical jobs → 2 mapped resource identities/);assert.match(body,/LORE RETRIEVAL|Lore Retrieval/);assert.match(body,/SEALED/);assert.match(body,/LATE/);
  const inspectScatter=walk(ui.shell.nodes.workspace).find(x=>x.tagName==='BUTTON'&&x.textContent==='Inspect Scatter receipt');
  const inspectGather=walk(ui.shell.nodes.workspace).find(x=>x.tagName==='BUTTON'&&x.textContent==='Inspect Gather receipt');
  assert.ok(inspectScatter);assert.ok(inspectGather);inspectScatter.dispatch('click');ui.scheduler.flush(2);
  assert.equal(ui.presentation.get().inspectorVisible,true);assert.equal(ui.shell.inspector.selection.kind,'wave13-scatter-trace');assert.equal(ui.shell.inspector.selection.selection.turnId,selection.turnId);
  inspectGather.dispatch('click');ui.scheduler.flush(3);assert.equal(ui.shell.inspector.selection.kind,'wave13-gather-trace');assert.match(textOf(ui.shell.nodes.inspectorHost),/gather:1/);
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
  let body=textOf(ui.shell.nodes.workspace);
  assert.match(body,/Diagnostics Center/);assert.match(body,/Jev \/ Sidecar \/ Vectoring wiring/);assert.match(body,/Current turn activity/);assert.match(body,/Recent owner resource telemetry/);assert.match(body,/not a complete forensic transaction timeline/i);assert.match(body,/raw prompts and credentials are never collected/i);
  assert.doesNotMatch(body,/jev:diag|sidecar:diag|vector:diag/);
  ui.productAdapter.setDetailLevel(ProductDetailLevel.ADVANCED);ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(3);body=textOf(ui.shell.nodes.workspace);
  assert.match(body,/jev:diag/);assert.match(body,/sidecar:diag/);assert.match(body,/vector:diag/);
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
  const snap=ui.operator.diagnostics.read(),operations=ui.operator.operations.read();
  assert.equal(snap.selection.chatId,'chat:diagnostics-new');assert.equal(snap.selection.turnId,'turn:diagnostics-new');
  assert.equal(snap.cognition.jobs.length,0);assert.equal(snap.cognition.errors.scatter.code,'LIVE_RECEIPT_IDENTITY_MISMATCH');
  assert.equal(operations.pipeline.executedJobs,0);assert.equal(operations.pipeline.returnedResults,0);assert.equal(operations.pipeline.contextAdmitted,0);
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

test('Connections overlays selected-turn execution and owner acceptance onto configured resource state',async()=>{
  const owner=liveOwner(),host=worker2ResourceHost({configured:true});owner.bindings.resourceHost=host;
  host.read.cognition=(selection={})=>({kind:'CognitionUiState',contractVersion:'2.0.0',...selection,activeTasks:0,hotTasks:0,deepTasks:0,health:'READY',
    queue:{queued:0,yields:0,parks:0,resumes:0},physicalExecution:{attempts:1,succeeded:1,failed:0},lifecycle:{configured:1,connected:1,physicallyExecuted:1,ownerAccepted:1},
    resources:[{resourceId:'sidecar:configured',configured:true,connected:true,qualified:true,callable:true,physicalExecutionAttempted:true,physicalExecutionSucceeded:true,ownerAccepted:true}],
    ownerAcceptance:[{kind:'NativeSidecarSwarmOwnerHandoffReceipt',ownerAdmissionPerformed:true,admissions:[{resourceId:'sidecar:configured',acceptedByOwner:true,destination:'CONTEXT'}]}],
    rawPromptIncluded:false,rawPayloadIncluded:false,credentialIncluded:false});
  await uiConnectConfigured(host);
  const{ui}=mount(owner);ui.shell.selectWorkspace('connections');ui.scheduler.flush(2);
  const sidecar=walk(ui.shell.nodes.workspace).find(x=>x.dataset?.slot==='SIDECAR'),body=textOf(sidecar);
  assert.match(body,/Physical execution Succeeded/);assert.match(body,/Owner accepted Yes/);assert.match(body,/Qualified callable by owner/);
  ui.destroy();
});

test('Worker 2 resourceHost cognition v2 is consumed directly with lifecycle and owner-admission distinctions',()=>{
  const owner=liveOwner(),host=worker2ResourceHost({configured:true});owner.bindings.resourceHost=host;
  const{ui}=mount(owner),read=ui.productionAdapters.coprocessor.read();
  assert.equal(read.data.queue.queued,4);assert.equal(read.data.queue.yields,2);assert.equal(read.data.queue.parks,1);assert.equal(read.data.queue.resumes,1);
  assert.deepEqual(read.data.physicalExecution,{attempts:3,succeeded:2,failed:1});assert.equal(read.data.lifecycle.ownerAccepted,1);
  assert.equal(read.data.validationFailures,1);assert.equal(read.data.lateResults,1);assert.equal(read.data.rawPromptIncluded,false);assert.equal(read.data.credentialIncluded,false);
  ui.shell.selectWorkspace('coprocessor-live');ui.scheduler.flush(2);const body=textOf(ui.shell.nodes.workspace);
  assert.match(body,/Worker lifecycle signals/);assert.match(body,/Execution \/ owner admission/);assert.match(body,/Physically executed resources/);assert.match(body,/Owner-accepted resources/);
  ui.destroy();
});

test('resource read model keeps configured connected qualified executed and owner-accepted states separate',()=>{
  const adapter=new Wave13ResourceControlAdapter({bindings:{resourceHost:{
    actions:{connectResource(){},disconnectResource(){},testResource(){}},
    read:{resources:()=>({kind:'CoprocessorResourceConnectionReadModel',resources:[{resourceId:'sidecar:wave19',displayName:'Wave19 Sidecar',kind:'OPENAI_COMPATIBLE',state:'READY',health:'HEALTHY',availability:'AVAILABLE',connected:true,selectedModelQualified:true,qualifiedAt:44,qualification:{qualified:true,evidence:{discoveryState:'READY'}},physicalExecutionAttempted:true,physicalExecutionSucceeded:true,ownerAccepted:null,ownerAcceptanceSource:'OWNER_RECEIPT_REQUIRED',declaredCapabilities:['STRUCTURED_EXTRACTION'],activeCapabilities:['STRUCTURED_EXTRACTION'],qualifiedCapabilities:['STRUCTURED_EXTRACTION'],routableCapabilities:['STRUCTURED_EXTRACTION'],callable:true}]})},
  }}});
  const row=adapter.read().data.resources[0];
  assert.equal(row.connected,true);assert.equal(row.selectedModelQualified,true);assert.equal(row.physicalExecutionAttempted,true);assert.equal(row.physicalExecutionSucceeded,true);assert.equal(row.ownerAccepted,null);assert.equal(row.ownerAcceptanceSource,'OWNER_RECEIPT_REQUIRED');
  assert.deepEqual(row.qualifiedCapabilities,['STRUCTURED_EXTRACTION']);assert.equal(row.qualification.evidence.discoveryState,'READY');
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
  assert.equal(deniedResult.state,'UNAUTHORIZED');assert.equal(deniedResult.manualModelEntryAllowed,true);
});

test('Worker 2 typed provider failure remains visibly failed even when the UI action itself completes',async()=>{
  const owner=liveOwner(),host=worker2ResourceHost({testFailureMessage:"Failed to execute 'fetch' on 'Window': Illegal invocation"});owner.bindings.resourceHost=host;
  const{ui}=mount(owner);assert.equal((await ui.actionRouter.route({type:'wave13.resource.connect',payload:{role:'SIDECAR',resourceId:'sidecar:fail',endpoint:'https://openrouter.ai/api/v1',modelId:'owner/model-a',capabilities:['STRUCTURED_EXTRACTION']}})).ok,true);
  const row=ui.operator.resources.read().data.resources[0],tested=await ui.actionRouter.route({type:'wave13.resource.test',target:row});assert.equal(tested.ok,true);assert.ok(tested.result.failure);
  ui.shell.selectWorkspace('connections');ui.scheduler.flush(1);const body=textOf(ui.shell.nodes.workspace);
  assert.match(body,/Latest connection test: FAIL/);assert.match(body,/Illegal invocation/);assert.doesNotMatch(body,/Connection test passed/);
  ui.destroy();
});

test('Worker 4 operator lifecycle states are preserved instead of inferred from acceptance',async()=>{
  const status={kind:'LoreIntelligenceStatus',counts:{ACCEPTED:1,STUDYING:1,READY:1,FAILED:1,REMOVED:1},entries:[
    {sourceId:'lore:book:a',lorebookId:'book',uid:'a',sourceRevisionId:'a@1',sourceState:'CURRENT',operatorState:'ACCEPTED',studyState:'DUE',retrievalReady:false,retrievalRepresentations:[]},
    {sourceId:'lore:book:b',lorebookId:'book',uid:'b',sourceRevisionId:'b@1',sourceState:'CURRENT',operatorState:'STUDYING',studyState:'ACTIVE',retrievalReady:false,retrievalRepresentations:[]},
    {sourceId:'lore:book:c',lorebookId:'book',uid:'c',sourceRevisionId:'c@1',sourceState:'CURRENT',learnedRevisionId:'learned:c',freshness:'CURRENT',operatorState:'READY',studyState:'COMPLETED',retrievalReady:true,retrievalRepresentations:[{artifactId:'r:c'}]},
    {sourceId:'lore:book:d',lorebookId:'book',uid:'d',sourceRevisionId:'d@1',sourceState:'CURRENT',operatorState:'FAILED',studyState:'FAILED',studyError:{code:'COMPILE_FAILED',message:'Compilation failed.'},retrievalReady:false,retrievalRepresentations:[]},
    {sourceId:'lore:book:e',lorebookId:'book',uid:'e',sourceRevisionId:'e@2',sourceState:'REMOVED',operatorState:'REMOVED',studyState:'COMPLETED',retrievalReady:false,retrievalRepresentations:[]},
  ],lifecycle:{counts:{DUE:1,ACTIVE:1,INVALID:0},due:1,active:1}};
  let accepted=null;
  const host={read:{status:()=>status},actions:{acceptLorebook(input){if(!input.discovery)throw new Error('discovery required');accepted=input;return{kind:'LoreSourceAcceptanceReceipt',lorebookId:input.id};},runLoreStudy:()=>({kind:'LoreStudyRun'})}};
  const bindings={loreStudyHost:host,readSelectedLorebookSelection:()=>({selected:true,lorebookId:'book',title:'Book'}),discoverSelectedLorebook:async()=>({id:'book',title:'Book',entries:[{uid:'a',content:'A',metadata:{}}],fullSnapshot:true,discovery:{kind:'SillyTavernLorebookDiscoveryReceipt',lorebookId:'book',entryCount:1}})};
  const adapter=new Wave13LoreStudyUIAdapter({bindings});await adapter.discoverSelectedLorebook();await adapter.accept(adapter.selectedLorebook().snapshot);
  assert.ok(accepted.discovery);const read=adapter.read();assert.deepEqual(read.data.operatorCounts,{ACCEPTED:1,STUDYING:1,READY:1,FAILED:1,REMOVED:1});assert.equal(read.data.retrievalReady,1);assert.equal(read.source.operationalState,'DEGRADED');
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

test('configured Worker 2 resources can recover credential model selection and qualification without exposing secrets',async()=>{
  const owner=liveOwner(),host=worker2ResourceHost({configured:true});owner.bindings.resourceHost=host;
  const{ui}=mount(owner);ui.shell.selectWorkspace('connections');ui.scheduler.flush(1);
  const slot=()=>walk(ui.shell.nodes.workspace).find(x=>x.dataset?.slot==='SIDECAR');
  const fieldByLabel=(root,label)=>walk(root).find(x=>x.getAttribute?.('aria-label')===label);
  const button=(root,label)=>walk(root).find(x=>x.tagName==='BUTTON'&&x.textContent===label);

  let sidecar=slot();assert.match(textOf(sidecar),/Resource is not callable/);
  let key=fieldByLabel(sidecar,'Sidecar session credential');key.value='sk-recovery-secret';key.dispatch('input');
  button(sidecar,'Save session credential').dispatch('click');await Promise.resolve();ui.scheduler.flush(2);
  assert.doesNotMatch(JSON.stringify(host.calls),/sk-recovery-secret/);assert.ok(host.calls.some(x=>x[0]==='setCredential'&&x[2].credentialConfigured===true));

  sidecar=slot();button(sidecar,'Refresh models').dispatch('click');await Promise.resolve();ui.scheduler.flush(3);
  sidecar=slot();const model=fieldByLabel(sidecar,'Sidecar qualified model');assert.equal(model.disabled,false);model.value='owner/model-b';
  button(sidecar,'Select model').dispatch('click');await Promise.resolve();ui.scheduler.flush(4);
  assert.ok(host.calls.some(x=>x[0]==='selectModel'&&x[2]==='owner/model-b'));

  sidecar=slot();button(sidecar,'Connect / qualify').dispatch('click');await Promise.resolve();ui.scheduler.flush(5);
  let read=ui.operator.resources.read(),row=read.data.resources.find(x=>x.id==='sidecar:configured');
  assert.equal(row.selectedModelQualified,true);assert.equal(row.callable,true);assert.equal(row.actualModelId,'owner/model-b');
  sidecar=slot();assert.match(textOf(sidecar),/Qualified callable by owner/);

  key=fieldByLabel(sidecar,'Sidecar session credential');key.value='sk-unsubmitted';key.dispatch('input');
  ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(6);sidecar=slot();
  assert.equal(fieldByLabel(sidecar,'Sidecar session credential').value,'');assert.match(textOf(sidecar),/API key cleared on refresh/);
  assert.doesNotMatch(JSON.stringify({calls:host.calls,read:ui.operator.resources.read(),diagnostics:ui.operator.diagnostics.read()}),/sk-recovery-secret|sk-unsubmitted/);
  ui.destroy();
});

test('Runtime detail consumes Worker 1 lifecycle queue and capacity telemetry without inventing missing histories',()=>{
  const owner=liveOwner();
  owner.bindings.readRuntimeStatus=()=>({
    lifecycle:[
      {taskId:'hot:1',lifecycleStatus:'ELIGIBLE',executionStatus:'ACTIVE',layer:'L0',degradation:null},
      {taskId:'deep:1',lifecycleStatus:'ELIGIBLE',executionStatus:'YIELDING',layer:'L3',degradation:null},
      {taskId:'parked:1',lifecycleStatus:'ELIGIBLE',executionStatus:'PARKED',layer:'L2',degradation:null},
      {taskId:'recover:1',lifecycleStatus:'ELIGIBLE',executionStatus:'RECOVERING',layer:'L2',degradation:{reason:'checkpoint'}},
      {taskId:'done:1',lifecycleStatus:'SATISFIED',executionStatus:'COMPLETE',layer:'L1',degradation:null},
    ],
    queueDepth:{L0:2,L1:0,L2:1,L3:1,L4:0},
    resources:{borrowedBackgroundLeases:1},workers:{},dependencies:{},eventTypes:['WORK_PARKED','WORK_RECOVERING'],
    telemetry:{retainedSignals:17,sinkFailures:0,latestSequence:22},
  });
  const{ui}=mount(owner);ui.shell.selectWorkspace('runtime-live');ui.scheduler.flush(2);
  const body=textOf(ui.shell.nodes.workspace);
  assert.match(body,/Runtime Detail/);assert.match(body,/Lifecycle signals/);assert.match(body,/Yielding 1/);assert.match(body,/Parked 1/);assert.match(body,/Recovering 1/);assert.match(body,/Complete 1/);
  assert.match(body,/Borrowed background leases 1/);assert.match(body,/Retained telemetry signals 17/);assert.match(body,/Owner snapshot does not publish batch history/);assert.match(body,/Owner snapshot does not publish late-result history/);
  ui.destroy();
});

test('Memory workspace renders owner-backed hierarchical compaction and keeps derived summaries non-authoritative',()=>{
  const owner=liveOwner();
  owner.bindings.memoryIntegrationSurface={adapters:{
    readMemory(selection){return{
      kind:'MemoryUiReadModel',health:{state:'READY',reasons:[]},...selection,revision:'memory-ui:r9',sourceRevisionRefs:['mem:r1','mem:r2'],readOnly:true,mutationAuthority:false,settlementAuthority:false,contextSealAuthority:false,
      evidence:[{id:'ev:1',freshness:'FRESH'},{id:'ev:2',freshness:'FRESH'}],
      state:{current:[{id:'claim:current'}],historical:[{id:'claim:old'}],unresolved:[{id:'claim:conflict'}]},
      episodes:[{id:'episode:1',freshness:'FRESH'}],reflections:[{id:'reflection:1',freshness:'FRESH'}],
      summaries:[{id:'summary:arc',scopeRef:'ARC:harbor',scopeLevel:'ARC',revision:3,freshness:'FRESH',state:'CURRENT',authorityClass:'DERIVED',navigationOnly:true,independentEvidence:false,sourceRange:{start:1,end:42},exactEvidenceRefs:['ev:1','ev:2'],exactSourceRevisionSet:['mem:r1','mem:r2'],representativeEvidenceRefs:['ev:2'],unresolvedSetRefs:['claim:conflict'],knowledgeFence:{worldRevision:8},representationText:'Mira and Oren crossed the harbor while the Tideglass remained disputed.',summaryPolicyRevision:'policy:1',compilerRevision:'compiler:1'}],
      retrieval:{status:'READY'},freshness:{freshEvidence:2,staleEvidence:0,freshEpisodes:1,staleEpisodes:0,freshReflections:1,staleReflections:0,freshSummaries:1,staleSummaries:0},provenance:{evidenceRefs:['ev:1','ev:2']},
    };},
    summaryStatus(){return{kind:'MemorySummaryStatus',pending:0};},
  }};
  const{ui}=mount(owner);ui.shell.selectWorkspace('memory');ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(2);
  const body=textOf(ui.shell.nodes.workspace);
  assert.match(body,/Owner-backed selected-chat/);assert.match(body,/Story \/ arc \/ scene compaction/);assert.match(body,/Derived \/ Navigation/i);assert.match(body,/ARC/);assert.match(body,/1 → 42/);assert.match(body,/Unresolved memory preserved/);
  assert.doesNotMatch(body,/Apply summary|Set canonical|Promote summary/i);
  ui.destroy();
});

test('Lore workspace shows Worker 4 multi-resolution and hierarchical summaries as derived non-source artifacts',()=>{
  const owner=liveOwner();
  const service={
    operatorInterface(){return{kind:'LoreStudyOperatorHost',contractVersion:1,read:{status:()=>({
      kind:'LoreIntelligenceStatus',counts:{ACCEPTED:0,STUDYING:0,READY:1,FAILED:0,REMOVED:0},lifecycle:{counts:{},due:0,active:0},conflicts:[],
      entries:[{sourceId:'lore:harbor:mira',lorebookId:'harbor',uid:'mira',sourceRevisionId:'lore:harbor:mira@r2',sourceState:'CURRENT',exactSourceHash:'hash:mira',exactSourceRecoverable:true,learnedRevisionId:'learned:mira@r2',freshness:'CURRENT',studyState:'COMPLETED',operatorState:'READY',representationReady:true,retrievalReady:true,retrievalRepresentations:[{artifactId:'ret:mira'}],representations:[
        {profile:'LEAN',representationRef:'rep:lean',representationRevision:'r2:lean',qualityStatus:'PASS'},
        {profile:'BALANCED',representationRef:'rep:balanced',representationRevision:'r2:balanced',qualityStatus:'PASS'},
        {profile:'HEAVY',representationRef:'rep:heavy',representationRevision:'r2:heavy',qualityStatus:'PASS'},
      ]}],
    })},actions:{acceptLorebook(){return{};},runLoreStudy(){return{};}}};},
    summarySurface(){return{kind:'LoreMultiLevelSummarySurface',exactSourceDrillbackAvailable:true,sourceAuthority:false,truthAuthority:false,settlementAuthority:false,summaries:[
      {summaryRef:'summary:harbor',level:'BOOK',scopeId:'book:harbor',label:'Harbor Lore',sourceRevisionRefs:['lore:harbor:mira@r2'],childSummaryRefs:['summary:mira'],content:'Derived navigation summary of Harbor Lore.',qualityReceipt:{status:'PASS'},authorityClass:'DERIVED'},
    ]};},
  };
  owner.bindings.loreIntelligenceService=service;
  const{ui}=mount(owner);ui.shell.selectWorkspace('lore');ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(2);
  const body=textOf(ui.shell.nodes.workspace);
  assert.match(body,/Derived Lore representations/);assert.match(body,/Lean/);assert.match(body,/Balanced/);assert.match(body,/Heavy/);assert.match(body,/Hierarchical navigation summaries/);assert.match(body,/DERIVED \/ NO SOURCE AUTHORITY/);assert.match(body,/Exact source drillback Available/);
  ui.destroy();
});

test('Lore UI marks edited source revisions stale until the owner re-studies them',()=>{
  const owner=liveOwner({withLore:true});
  owner.bindings.readLoreStatus=()=>({kind:'LoreIntelligenceStatus',counts:{ACCEPTED:1,STUDYING:0,READY:0,FAILED:0,REMOVED:0},entries:[{
    sourceId:'lore:moon:captain',lorebookId:'moon',uid:'captain',sourceRevisionId:'r2',sourceState:'CURRENT',learnedRevisionId:'learned:r1',freshness:'STALE_OR_UNLEARNED',operatorState:'ACCEPTED',studyState:'DUE',semanticDiff:{kind:'LoreSemanticDiff',changed:true},retrievalReady:false,retrievalRepresentations:[],
  }],artifacts:[],conflicts:[],lifecycle:{counts:{DUE:1},due:1,active:0},...owner.bindings.readSelection()});
  const{ui}=mount(owner);ui.shell.selectWorkspace('lore');ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(2);
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/Source revision changed/);assert.match(body,/not treated as current until the Lore owner re-studies/i);assert.doesNotMatch(body,/retrieval-ready.*Yes/i);
  ui.destroy();
});

test('Worker 4 v2 lifecycle gates Settlement behind review Final Preview and explicit approval',async()=>{
  const calls=[];let stage='DRAFT_REVIEW',decision=null,finalPreview=null,settlement=null;
  const progress=()=>({kind:'LoreAuthoringProgressReadModel',sessionId:'session:tree',type:'TREE',stage,draftRevision:1,build:{cursor:1,total:1,complete:true},decisions:decision?{[decision]:1}:{PENDING:1},totalActions:1,materializedActions:1,stale:null,lastError:null,finalPreviewId:finalPreview?.finalPreviewId??null,finalPreviewReady:Boolean(finalPreview?.validation?.ok),approval:stage==='READY_TO_SETTLE'?{operatorApprovalId:'ui:approval'}:null,settlement:settlement?{settlementId:settlement.settlementId,state:settlement.state,cursor:settlement.cursor,operationCount:1,appliedCount:settlement.cursor}:null});
  const safe=value=>({ok:true,value,error:null});
  const authoringHost={kind:'LoreAuthoringOperatorContract',contractVersion:2,
    read:{
      sourceDiscoveryIdentity:()=>safe({kind:'LoreSourceDiscoverySurface',books:[{lorebookId:'Moon Harbor',title:'Moon Harbor',discoveryIdentityPersisted:true,sources:[{sourceId:'lore:moon:captain',uid:'captain',sourceRevisionId:'r1',contentHash:'h1',metadata:{title:'Captain'}}]}]}),
      reviewStates:()=>safe({states:['DRAFT_REVIEW','FINAL_PREVIEW','READY_TO_SETTLE','SETTLED']}),worker1InvalidationContract:()=>safe({integrationStatus:'PUBLISHED'}),
      worker3AuthoringContract:()=>safe({checkpointResumeSupported:true,restorationSupported:true}),
      progress:()=>safe(progress()),
      draftReview:()=>safe({kind:'LoreDraftReview',sessionId:'session:tree',actions:[{id:'action:1',action:'MOVE_ENTRY',rationale:'Move Captain into Characters.',inputSourceRevisions:[{sourceRevisionId:'r1'}],affectedTreeNodes:['Characters'],materialized:true,decision}]}),
      finalPreview:()=>safe(finalPreview),
      settlement:()=>safe(settlement),
      worker1Receipts:()=>safe({revisionEvents:settlement?.revisionEvents??[],invalidationReceipts:settlement?.invalidationReceipts??[]}),
    },
    actions:{
      previewEditImpact:()=>safe(null),proposeTree:()=>safe({proposals:[],reviewItems:[],sourceRevisionFence:['r1'],mutationAuthority:false}),previewMerge:()=>safe(null),
      startTreeBuild:()=>{calls.push('start');stage='DRAFT_REVIEW';return safe(progress());},
      startMergeBuild:()=>safe(progress()),resumeAuthoringBuild:()=>safe({progress:progress()}),
      recordDraftDecision(input){calls.push(input.decision);decision=input.decision;return safe({actions:[{id:'action:1',decision}]});},
      computeFinalPreview(){calls.push('preview');stage='FINAL_PREVIEW';finalPreview={kind:'LoreFinalPreview',finalPreviewId:'final:1',validation:{ok:true},operations:[{id:'op:1'}],authoritativeSemanticPreflight:true,explicitApprovalRequired:true};return safe(finalPreview);},
      approveFinalPreview(){calls.push('approve');stage='READY_TO_SETTLE';return safe({stage,approval:{operatorApprovalId:'ui:approval'}});},
      applySettlement(){calls.push('settle');stage='SETTLED';settlement={kind:'LoreSettlementReadModel',settlementId:'settlement:1',state:'SETTLED',cursor:1,operationCount:1,revisionEvents:[{sourceId:'lore:moon:captain',sourceRevisionId:'r2'}],invalidationReceipts:[{sourceId:'lore:moon:captain',unrelatedSourcesInvalidated:false}],originalSourcesDeleted:false,reconstructable:true};return safe(settlement);},
      restoreSettlement(){calls.push('restore');settlement={...settlement,state:'RESTORED'};stage='RESTORED';return safe(settlement);},
    },
  };
  const owner=liveOwner({withLore:true});Object.assign(owner.bindings,{loreAuthoringHost:authoringHost,readSelectedLorebookSelection:()=>({selected:true,lorebookId:'Moon Harbor',title:'Moon Harbor'}),discoverSelectedLorebook:async()=>({id:'Moon Harbor',title:'Moon Harbor',entries:[{uid:'captain',content:'Captain watches the harbor.',metadata:{title:'Captain'}}],fullSnapshot:true,discovery:{kind:'SillyTavernLorebookDiscoveryReceipt',lorebookId:'Moon Harbor',title:'Moon Harbor',entryCount:1}})});
  const{ui}=mount(owner);await ui.operator.loreStudy.discoverSelectedLorebook();ui.operator.loreAuthoring.sourceDiscoveryIdentity({});ui.shell.selectWorkspace('lore');ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(2);
  const findButton=label=>walk(ui.shell.nodes.workspace).find(x=>x.tagName==='BUTTON'&&x.textContent===label);
  assert.equal(Boolean(findButton('Apply approved Settlement')),false);
  findButton('Start reviewed Tree build').dispatch('click');await Promise.resolve();ui.scheduler.flush(3);
  assert.equal(Boolean(findButton('Apply approved Settlement')),false);findButton('Accept').dispatch('click');await Promise.resolve();ui.scheduler.flush(4);
  findButton('Compute revision-fenced Final Preview').dispatch('click');await Promise.resolve();ui.scheduler.flush(5);
  assert.equal(Boolean(findButton('Apply approved Settlement')),false);findButton('Approve current Final Preview').dispatch('click');await Promise.resolve();ui.scheduler.flush(6);
  assert.ok(findButton('Apply approved Settlement'));findButton('Apply approved Settlement').dispatch('click');await Promise.resolve();ui.scheduler.flush(7);
  assert.match(textOf(ui.shell.nodes.workspace),/Settlement receipt/);assert.match(textOf(ui.shell.nodes.workspace),/Reconstructable Yes/);assert.ok(findButton('Restore settled revisions'));
  assert.deepEqual(calls.slice(0,5),['start','ACCEPT','preview','approve','settle']);ui.destroy();
});

test('Worker 4 Wave 6 authoring contract stays review-only and renders Tree / merge previews without Apply',async()=>{
  const calls=[];
  const authoringHost={
    kind:'LoreAuthoringOperatorContract',contractVersion:1,
    read:{
      sourceDiscoveryIdentity:()=>({ok:true,value:{kind:'LoreSourceDiscoverySurface',books:[
        {lorebookId:'Moon Harbor',title:'Moon Harbor',discoveryIdentityPersisted:true,sources:[
          {sourceId:'lore:Moon Harbor:captain',uid:'captain',sourceRevisionId:'lore:Moon Harbor:captain@r1',contentHash:'hash-1',metadata:{title:'Captain Vale'}},
        ]},
        {lorebookId:'Mirror Archive',title:'Mirror Archive',discoveryIdentityPersisted:true,sources:[
          {sourceId:'lore:Mirror Archive:mirror',uid:'mirror',sourceRevisionId:'lore:Mirror Archive:mirror@r1',contentHash:'hash-2',metadata:{title:'Mirror Record'}},
        ]},
      ]},error:null}),
      reviewStates:()=>({ok:true,value:{states:['PROPOSED','NEEDS_REVIEW','APPROVED','REJECTED','DEFERRED','BLOCKED']},error:null}),
      worker1InvalidationContract:()=>({ok:true,value:{integrationStatus:'PUBLISHED_NOT_CLAIMED_WIRED'},error:null}),
    },
    actions:{
      previewEditImpact:(input)=>{calls.push(['edit',structuredClone(input)]);return{ok:true,value:{kind:'LoreEditImpactPreview',baseSourceRevisionId:'r1',proposedSourceRevisionId:'r2',originalServiceMutated:false,allPreviouslyReadyUnrelatedSourcesRemainReady:true,semanticChange:{claims:{added:[],altered:[{}],superseded:[{}]},relationships:{added:[],removed:[]},invalidationPlan:{targets:[{target:'REPRESENTATIONS'},{target:'RETRIEVAL_INDEX'}]}}},error:null};},
      proposeTree:(input)=>{calls.push(['tree',structuredClone(input)]);return{ok:true,value:{kind:'LoreStructurePlan',planId:'plan:1',sourceRevisionFence:['r1'],proposals:[{id:'p1',action:'CREATE_NODE',state:'NEEDS_REVIEW',rationale:'Repeated semantic membership suggests a useful navigation node.'}],reviewItems:[],mutationAuthority:false},error:null};},
      previewMerge:(input)=>{calls.push(['merge',structuredClone(input)]);return{ok:true,value:{kind:'LoreMergePreview',previewId:'merge:1',sourceRevisionFence:['r1','r2'],classifications:{exactDuplicates:[{}],likelyOverlap:[],complementary:[{}],titleKeyCollisions:[],unresolvedContradictions:[{}]},validation:{retainedEverySemanticFact:true,mappedEveryCurrentSource:true,preservedContradictionsSeparately:true},destructiveApplyImplemented:false,mutationAuthority:false},error:null};},
    },
    destructiveMergeApply:null,destructiveTreeApply:null,exactSourceMutationAuthority:false,
  };
  const direct=new Wave13LoreAuthoringUIAdapter({bindings:{loreAuthoringHost:authoringHost}});
  assert.equal(direct.capabilities().destructiveApply,false);assert.equal(direct.sourceDiscoveryIdentity({}).ok,true);
  assert.equal(direct.previewEditImpact({sourceId:'lore:Moon Harbor:captain',content:'Vale carries the revised ledger.'}).ok,true);
  assert.equal(direct.proposeTree({lorebookIds:['Moon Harbor']}).ok,true);
  assert.equal(direct.previewMerge({lorebookIds:['Moon Harbor','Mirror Archive']}).ok,true);

  const owner=liveOwner({withLore:true});
  Object.assign(owner.bindings,{
    loreAuthoringHost:authoringHost,
    readSelectedLorebookSelection:()=>({kind:'SillyTavernLorebookSelection',selected:true,lorebookId:'Moon Harbor',title:'Moon Harbor'}),
    discoverSelectedLorebook:async()=>({id:'Moon Harbor',title:'Moon Harbor',entries:[{uid:'captain',content:'Vale keeps the blue ledger.',metadata:{title:'Captain Vale'}}],fullSnapshot:true,discovery:{kind:'SillyTavernLorebookDiscoveryReceipt',lorebookId:'Moon Harbor',title:'Moon Harbor',entryCount:1,exactAuthoredSource:true}}),
  });
  const{ui}=mount(owner);await ui.operator.loreStudy.discoverSelectedLorebook();ui.operator.loreAuthoring.sourceDiscoveryIdentity({});
  ui.shell.selectWorkspace('lore');ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(3);
  const body=textOf(ui.shell.nodes.workspace);
  assert.match(body,/Lore authoring review/);assert.match(body,/Source identity/);assert.match(body,/Edit-impact preview/);assert.match(body,/Tree Builder proposal/);assert.match(body,/Merge \/ reconciliation preview/);assert.match(body,/No destructive Apply action/);
  const buttons=walk(ui.shell.nodes.workspace).filter(x=>x.tagName==='BUTTON');assert.equal(buttons.some(x=>x.textContent==='Apply'),false);
  const mergeSelect=walk(ui.shell.nodes.workspace).find(x=>x.getAttribute?.('aria-label')==='Merge comparison lorebook'),mergeButton=buttons.find(x=>x.textContent==='Preview merge reconciliation');
  assert.equal(mergeButton.disabled,true);mergeSelect.value='Mirror Archive';mergeSelect.dispatch('change');assert.equal(mergeButton.disabled,false);
  ui.destroy();
});

test('Worker 4 Lore intelligence service is consumed through operatorInterface with discovery provenance intact',async()=>{
  const calls=[];let operatorCalls=0;
  const service={
    operatorInterface(){
      operatorCalls+=1;
      return{
        kind:'LoreStudyOperatorHost',contractVersion:1,
        read:{status:()=>({kind:'LoreIntelligenceStatus',counts:{ACCEPTED:0,STUDYING:0,READY:0,FAILED:0,REMOVED:0},entries:[],artifacts:[],conflicts:[],lifecycle:{counts:{},due:0,active:0}})},
        actions:{
          acceptLorebook(input){calls.push(['accept',structuredClone(input)]);return{accepted:true};},
          runLoreStudy(input){calls.push(['run',structuredClone(input)]);return{completed:true};},
          retryLoreStudy(input){calls.push(['retry',structuredClone(input)]);return{retried:true};},
        },
      };
    },
  };
  const selection={chatId:'chat:lore',turnId:'turn:lore',generationId:'gen:lore'};
  let legacyCalls=0;
  const adapter=new Wave13LoreStudyUIAdapter({bindings:{
    loreIntelligenceService:service,
    readLoreStatus(){legacyCalls+=1;throw new Error('legacy read should not win');},
    acceptLorebook(){legacyCalls+=1;throw new Error('legacy accept should not win');},
    runLoreStudy(){legacyCalls+=1;throw new Error('legacy run should not win');},
  },selectionProvider:()=>selection});
  assert.equal(operatorCalls,1);assert.equal(adapter.capabilities().read,true);assert.equal(adapter.capabilities().accept,true);assert.equal(adapter.capabilities().run,true);assert.equal(adapter.capabilities().retry,true);
  assert.equal(adapter.read().data.entries.length,0);assert.equal(legacyCalls,0);
  const discovered={id:'Moon Harbor',title:'Moon Harbor',entries:[{uid:'captain',content:'Vale keeps the blue ledger.',metadata:{title:'Captain Vale'}}],fullSnapshot:true,discovery:{kind:'SillyTavernLorebookDiscoveryReceipt',lorebookId:'Moon Harbor',title:'Moon Harbor',entryCount:1,exactAuthoredSource:true}};
  await adapter.accept(discovered);await adapter.run({scope:'DUE'});
  assert.equal(calls[0][0],'accept');assert.equal(calls[0][1].id,'Moon Harbor');assert.equal(calls[0][1].entries[0].uid,'captain');assert.equal(calls[0][1].discovery.kind,'SillyTavernLorebookDiscoveryReceipt');
  assert.equal(calls[1][0],'run');assert.deepEqual(calls[1][1],{scope:'DUE'});assert.equal(legacyCalls,0);
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

function worker2ResourceHost({configured=false,discoveryState='READY',testFailureMessage=null}={}){
  const calls=[],listeners=new Set();let sequence=0;
  const rows=[];
  const diagnostic=(row,code,message,details={})=>{row.diagnostics??=[];row.diagnostics.push({sequence:++sequence,at:sequence,code,message,details});};
  if(configured){const row={kind:'CoprocessorResourceReadModel',resourceId:'sidecar:configured',displayName:'Configured sidecar',state:'CONFIGURED',reasonCode:'CONFIGURED',reason:'Resource configured but not connected.',providerProfileId:'profile:sidecar:configured',providerId:'provider:sidecar:configured',modelId:'local',actualModelId:null,selectedModelQualified:false,qualifiedAt:null,modelSelectionMode:'CONFIGURED_UNQUALIFIED',modelDiscovery:{state:'IDLE',models:[],manualModelEntryAllowed:true},workerId:'resource:sidecar:configured',declaredCapabilities:['STRUCTURED_EXTRACTION'],activeCapabilities:[],measurementClass:'MEASURED_LIVE',health:'UNAVAILABLE',availability:'UNAVAILABLE',credentialConfigured:false,local:true,maxConcurrency:1,activeExecutions:0,callable:false,diagnostics:[]};diagnostic(row,'CONFIGURED','Resource configuration accepted.');rows.push(row);}
  const emit=(type,row)=>{sequence+=1;for(const listener of [...listeners])listener({kind:'CoprocessorResourceConnectionEvent',sequence,type,resource:{...row}});};
  return{
    calls,
    actions:{
      async discoverModels(config){const safe={kind:config.kind,endpoint:config.endpoint,capabilities:[...(config.capabilities??[])],credentialConfigured:Boolean(config.apiKey)};calls.push(['discover',safe]);
        if(discoveryState==='UNAUTHORIZED')return{kind:'ResourceModelDiscoveryResult',state:'UNAUTHORIZED',models:[],manualModelEntryAllowed:true,reasonCode:'CREDENTIAL_REQUIRED',reason:'A session credential is required before model discovery.',credentialConfigured:false};
        if(discoveryState==='UNSUPPORTED')return{kind:'ResourceModelDiscoveryResult',state:'UNSUPPORTED',models:[],manualModelEntryAllowed:true,reasonCode:'MODEL_DISCOVERY_UNSUPPORTED',reason:'Provider does not support discovery.',credentialConfigured:Boolean(config.apiKey)};
        if(discoveryState==='EMPTY')return{kind:'ResourceModelDiscoveryResult',state:'EMPTY',models:[],manualModelEntryAllowed:true,reasonCode:'MODEL_DISCOVERY_EMPTY',reason:'Provider returned no models.',credentialConfigured:Boolean(config.apiKey)};
        if(discoveryState==='UNREACHABLE')return{kind:'ResourceModelDiscoveryResult',state:'UNREACHABLE',models:[],manualModelEntryAllowed:true,reasonCode:'MODEL_DISCOVERY_UNREACHABLE',reason:'Provider endpoint is unreachable.',credentialConfigured:Boolean(config.apiKey)};
        return{kind:'ResourceModelDiscoveryResult',state:'READY',models:[{id:'owner/model-a',displayName:'Owner Model A'}],manualModelEntryAllowed:true,reasonCode:'MODEL_DISCOVERY_READY',reason:'Provider model discovery completed.',credentialConfigured:Boolean(config.apiKey)};},
      addResource(config){const safe={...config,capabilities:[...config.capabilities]};delete safe.apiKey;safe.credentialConfigured=Boolean(config.apiKey);calls.push(['add',safe]);const row={kind:'CoprocessorResourceReadModel',resourceId:config.resourceId,displayName:config.displayName,state:'CONFIGURED',reasonCode:'CONFIGURED',reason:'Resource configured but not connected.',providerProfileId:config.providerProfileId,providerId:config.providerId,modelId:config.modelId,workerId:config.workerId,declaredCapabilities:[...config.capabilities],activeCapabilities:[],measurementClass:'MEASURED_LIVE',health:'UNAVAILABLE',availability:'UNAVAILABLE',credentialConfigured:Boolean(config.apiKey),local:Boolean(config.local),maxConcurrency:config.maxConcurrency,activeExecutions:0,callable:false,diagnostics:[]};diagnostic(row,'CONFIGURED','Resource configuration accepted.');rows.push(row);emit('RESOURCE_CONFIGURED',row);return{...row};},
      async refreshModels(id){calls.push(['refreshModels',id]);const row=rows.find(x=>x.resourceId===id);row.modelDiscovery={state:'READY',models:[{id:'owner/model-a',displayName:'Owner Model A'},{id:'owner/model-b',displayName:'Owner Model B'}],manualModelEntryAllowed:true};diagnostic(row,'MODEL_DISCOVERY_READY','Model discovery completed.',{modelCount:2});emit('RESOURCE_MODELS_REFRESHED',row);return structuredClone(row.modelDiscovery);},
      setCredential(id,credential){calls.push(['setCredential',id,{credentialConfigured:Boolean(credential)}]);const row=rows.find(x=>x.resourceId===id);row.credentialConfigured=true;row.selectedModelQualified=false;row.qualifiedAt=null;row.callable=false;row.state='CONFIGURED';row.health='UNAVAILABLE';row.availability='UNAVAILABLE';diagnostic(row,'CREDENTIAL_UPDATED','Session credential replaced.');emit('RESOURCE_CREDENTIAL',row);return{...row};},
      clearCredential(id){calls.push(['clearCredential',id]);const row=rows.find(x=>x.resourceId===id);row.credentialConfigured=false;row.selectedModelQualified=false;row.qualifiedAt=null;row.callable=false;row.state='UNAVAILABLE';row.health='UNAVAILABLE';row.availability='UNAVAILABLE';diagnostic(row,'CREDENTIAL_REVOKED','Session credential revoked.');emit('RESOURCE_CREDENTIAL',row);return{...row};},
      selectModel(id,modelId){calls.push(['selectModel',id,modelId]);const row=rows.find(x=>x.resourceId===id);row.modelId=modelId;row.modelSelectionMode='DISCOVERED';row.selectedModelQualified=false;row.qualifiedAt=null;row.callable=false;row.state='CONFIGURED';row.health='UNAVAILABLE';row.availability='UNAVAILABLE';diagnostic(row,'MODEL_SELECTED','Model selection updated.');emit('RESOURCE_MODEL_SELECTED',row);return{...row};},
      async connectResource(id){calls.push(['connect',id]);const row=rows.find(x=>x.resourceId===id);row.state='READY';row.reasonCode='HEALTH_CHECK_PASSED';row.reason='Authenticated model qualification passed.';row.health='HEALTHY';row.availability='AVAILABLE';row.activeCapabilities=[...row.declaredCapabilities];row.selectedModelQualified=true;row.qualifiedAt=sequence+1;row.actualModelId=row.modelId;row.callable=true;diagnostic(row,'HEALTH_CHECK_PASSED','Authenticated model qualification passed.');emit('RESOURCE_READY',row);return{...row};},
      disconnectResource(id){calls.push(['disconnect',id]);const row=rows.find(x=>x.resourceId===id);row.state='DISCONNECTED';row.reasonCode='OPERATOR_DISCONNECT';row.reason='Operator disconnected resource.';row.health='UNAVAILABLE';row.availability='UNAVAILABLE';row.activeCapabilities=[];row.callable=false;diagnostic(row,'DISCONNECTED','Operator disconnected resource.');emit('RESOURCE_DISCONNECTED',row);return{...row};},
      async testResource(id){calls.push(['test',id]);const row=rows.find(x=>x.resourceId===id);
        if(testFailureMessage){row.state='UNAVAILABLE';row.reasonCode='HEALTH_CHECK_FAILED';row.reason=testFailureMessage;row.health='UNAVAILABLE';row.availability='UNAVAILABLE';row.callable=false;row.lastFailure={code:'PROVIDER_UNAVAILABLE',message:testFailureMessage};row.lastTest={status:'FAIL',mode:'PROBE',failureCode:'PROVIDER_UNAVAILABLE'};diagnostic(row,'TEST_FAILED',testFailureMessage);emit('RESOURCE_TESTED',row);return{resource:{...row},result:null,failure:{code:'PROVIDER_UNAVAILABLE',message:testFailureMessage}};}
        row.selectedModelQualified=true;row.qualifiedAt=sequence+1;row.actualModelId=row.modelId;row.callable=true;row.state='READY';row.health='HEALTHY';row.availability='AVAILABLE';row.lastTest={status:'PASS',mode:'PROBE',latencyMs:3};diagnostic(row,'TEST_PASSED','Resource test passed.',{latencyMs:3});emit('RESOURCE_TESTED',row);return{resource:{...row},result:{kind:'ResourceProbeResult',ok:true,latencyMs:3,measurementClass:'MEASURED_LIVE'}};},
    },
    read:{
      resources:()=>({kind:'CoprocessorResourceConnectionReadModel',contractVersion:'1.0.0',sequence,resources:rows.map(x=>({...x,declaredCapabilities:[...x.declaredCapabilities],activeCapabilities:[...x.activeCapabilities]})),readyResourceCount:rows.filter(x=>x.state==='READY').length,nativePathRequired:!rows.some(x=>x.state==='READY')}),
      cognition:(selection={})=>({kind:'CognitionUiState',contractVersion:'2.0.0',...selection,activeTasks:1,hotTasks:0,deepTasks:1,lateResults:1,staleDrops:2,warmHits:3,warmMisses:1,fallbackCount:1,retryCount:2,validationFailures:1,health:'DEGRADED',queue:{queued:4,yields:2,parks:1,resumes:1,pressure:{activeDeep:1}},physicalExecution:{attempts:3,succeeded:2,failed:1},resultDestinations:{CONTEXT:1,LATE:1},lifecycle:{configured:rows.length,connected:rows.filter(x=>x.state==='READY').length,physicallyExecuted:1,ownerAccepted:1},ownerAcceptance:[{kind:'NativeSidecarSwarmOwnerHandoffReceipt',ownerAdmissionPerformed:true,admissions:[{taskId:'task:1',resourceId:rows[0]?.resourceId??'sidecar:configured',acceptedByOwner:true,destination:'CONTEXT'}]}],resources:rows.map(x=>({resourceId:x.resourceId,configured:true,connected:x.state==='READY',qualified:Boolean(x.selectedModelQualified),callable:Boolean(x.callable),physicalExecutionAttempted:Boolean(x.lastExecution),physicalExecutionSucceeded:x.lastExecution?.status==='SUCCESS',ownerAccepted:false})),rawPromptIncluded:false,rawPayloadIncluded:false,credentialIncluded:false}),
    },
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    listenerCount:()=>listeners.size,
  };
}

async function uiConnectConfigured(host){
  const row=host.read.resources().resources.find(x=>x.resourceId==='sidecar:configured');
  if(row?.state!=='READY')await host.actions.connectResource('sidecar:configured');
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
