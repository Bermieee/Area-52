import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FrontFaceMode, ProductDataMode, ProductDetailLevel, UIStateStore,
  createWave12SillyTavernHostAdapter, mountWave12SillyTavernInterface,
} from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';
import { createWave11LiveHost, makeWave11Turn } from './fixtures/wave11-live-receipts.mjs';
import { createWave12SillyTavernHostBindings, discoverSelectedSillyTavernLorebook } from '../src/ui-core/wave12-sillytavern-host.js';

class HostNode extends FakeNode{
  constructor(tag,doc){super(tag,doc);this.id='';}
  setAttribute(name,value){super.setAttribute(name,value);if(name==='id')this.id=String(value);}
  getAttribute(name){return this.attributes?.[name]??null;}
  get nextSibling(){const rows=this.parentNode?.children??[],i=rows.indexOf(this);return i>=0?rows[i+1]??null:null;}
  insertBefore(node,before){
    const i=this.children.indexOf(before);
    if(i<0){this.append(node);return node;}
    this.children.splice(i,0,node);node.parentNode=this;return node;
  }
  remove(){
    const p=this.parentNode;if(!p)return;const i=p.children.indexOf(this);if(i>=0)p.children.splice(i,1);this.parentNode=null;
  }
}

class HostDocument extends FakeDocument{
  constructor(){
    super();this.body=new HostNode('body',this);this.documentElement=new HostNode('html',this);this.documentElement.append(this.body);
  }
  createElement(tag){return new HostNode(tag,this);}
  createDocumentFragment(){return new HostNode('fragment',this);}
  querySelector(selector){
    if(selector?.startsWith('#'))return this.getElementById(selector.slice(1));
    if(selector==='[data-area52-ui-host]')return walk(this.body).find(x=>x.attributes?.['data-area52-ui-host']!=null)??null;
    return null;
  }
  getElementById(id){return walk(this.body).find(x=>x.id===id||x.attributes?.id===id)??null;}
}

class EventSource{
  constructor(){this.listeners=new Map();}
  on(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,...args){for(const fn of [...(this.listeners.get(type)??[])])fn(...args);}
  listenerCount(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0);}
}

const EVENT_TYPES=Object.freeze({
  CHAT_CHANGED:'chat_id_changed',CHAT_LOADED:'chatLoaded',
  MESSAGE_SENT:'message_sent',MESSAGE_RECEIVED:'message_received',MESSAGE_EDITED:'message_edited',
  MESSAGE_DELETED:'message_deleted',MESSAGE_UPDATED:'message_updated',MESSAGE_SWIPED:'message_swiped',
  GENERATION_STARTED:'generation_started',GENERATION_STOPPED:'generation_stopped',GENERATION_ENDED:'generation_ended',
});

const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
const walk=node=>[node,...(node?.children??[]).flatMap(walk)];

function hostDocument(){
  const document=new HostDocument(),sheld=document.createElement('div'),chat=document.createElement('div'),form=document.createElement('div');
  sheld.id='sheld';chat.id='chat';form.id='form_sheld';sheld.append(chat,form);document.body.append(sheld);
  return{document,sheld,chat,form};
}

function turns(){
  const a=makeWave11Turn({selection:{chatId:'chat:a',turnId:'turn:a',generationId:'gen:a',correlationId:'corr:a',worldRevision:52,sceneRevision:19,sourceRevisionRefs:['lore:a@4','scene:a@19']},scenario:'hot'});
  const b=makeWave11Turn({selection:{chatId:'chat:b',turnId:'turn:b',generationId:'gen:b',correlationId:'corr:b',worldRevision:53,sceneRevision:20,sourceRevisionRefs:['lore:ember@6','scene:ember@20','memory:ember@12']},scenario:'ambiguous',resourceCount:2,late:true});
  return{a,b};
}

function environment({records=null,initialTurnId=null,bindings=null,initialChatId=null,externalRoot=false}={}){
  const{document,sheld}=hostDocument(),events=new EventSource(),items=records??Object.values(turns());
  const owner=bindings?null:createWave11LiveHost(items,initialTurnId??items[0]?.selection.turnId);
  let chatId=initialChatId??owner?.current?.().chatId??items[0]?.selection.chatId??'chat:none';
  const getContext=()=>({chatId,getCurrentChatId:()=>chatId,eventSource:events,eventTypes:EVENT_TYPES,chat:[]});
  const mountRoot=externalRoot?document.createElement('aside'):null;
  if(mountRoot){mountRoot.setAttribute('data-area52-ui-host','approved');document.body.append(mountRoot);}
  const adapter=createWave12SillyTavernHostAdapter({
    document,getContext,hostBindings:bindings??owner.bundle,mountRoot,
    stateStore:new UIStateStore({storage:memory(),namespace:'wave12-host-test'}),
  });
  return{document,sheld,events,owner,adapter,mountRoot,setChatId:value=>{chatId=value;}};
}

test('SillyTavern selected Lorebook discovery preserves editor identity and exact authored entries',async()=>{
  const{document}=hostDocument(),select=document.createElement('select');select.id='world_editor_select';select.value='1';
  const none=document.createElement('option');none.textContent='--- None ---';none.value='';
  const book=document.createElement('option');book.textContent='Moon Harbor';book.value='1';book.selected=true;
  select.append(none,book);document.body.append(select);
  const result=await discoverSelectedSillyTavernLorebook({document,getContext:()=>({
    chatId:'chat:moon',
    loadWorldInfo:async(name)=>{assert.equal(name,'Moon Harbor');return{entries:{
      7:{uid:7,comment:'Captain Vale',content:'Captain Vale keeps the blue ledger.',key:['Vale'],keysecondary:[]},
      9:{uid:9,comment:'East Dock',content:'The east dock closes at midnight.',key:['dock'],keysecondary:[]},
    }};},
  })});
  assert.equal(result.id,'Moon Harbor');assert.equal(result.title,'Moon Harbor');assert.equal(result.entries.length,2);
  assert.equal(result.entries[0].content,'Captain Vale keeps the blue ledger.');
  assert.deepEqual(result.discovery,{kind:'SillyTavernLorebookDiscoveryReceipt',contractVersion:1,source:'SILLYTAVERN_WORLD_INFO_EDITOR',lorebookId:'Moon Harbor',title:'Moon Harbor',entryCount:2,chatId:'chat:moon',exactAuthoredSource:true});
});

test('SillyTavern host bindings preserve Worker 4 Lore operator service ownership',()=>{
  const service={operatorInterface(){return{kind:'LoreStudyOperatorHost',read:{status:()=>({entries:[],counts:{}})},actions:{acceptLorebook(){},runLoreStudy(){}}};}};
  const bound=createWave12SillyTavernHostBindings({getContext:()=>({chatId:'chat:lore'}),hostBindings:{loreIntelligenceService:service}});
  assert.equal(bound.hostBindings.loreIntelligenceService,service);bound.destroy();
});

test('Wave 12 mounts one floating UI.Core product beside verified #sheld without cloning host chat',()=>{
  const{a}=turns(),env=environment({records:[a],initialTurnId:'turn:a'});
  env.sheld.style.right='13px';
  env.adapter.mount();
  assert.ok(env.adapter.ui);
  assert.equal(walk(env.document.body).filter(x=>x.id==='sheld').length,1);
  assert.equal(env.adapter.mountRoot.parentNode,env.sheld.parentNode);
  assert.equal(env.adapter.mountRoot.attributes['data-area52-host-adapter'],'wave12');
  assert.equal(env.sheld.style.right,'13px');
  env.adapter.ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:420});
  assert.equal(env.sheld.style.right,'13px');
  env.adapter.destroy();
  assert.equal(env.sheld.style.right,'13px');
  assert.equal(env.document.getElementById('area52-ui-core-host'),null);
  assert.equal(env.events.listenerCount(),0);
  assert.equal(env.owner.listenerCount(),0);
});

test('host-approved external mount root is reused and survives destroy empty',()=>{
  const{a}=turns(),env=environment({records:[a],initialTurnId:'turn:a',externalRoot:true});
  env.adapter.mount();assert.equal(env.adapter.mountRoot,env.mountRoot);assert.ok(env.mountRoot.children.length>0);
  env.adapter.destroy();assert.equal(env.mountRoot.parentNode,env.document.body);assert.equal(env.mountRoot.children.length,0);
});

test('mount, duplicate mount, destroy and remount are idempotent with one composite owner subscription',()=>{
  const{a}=turns(),env=environment({records:[a],initialTurnId:'turn:a'});
  env.adapter.mount();const root=env.adapter.mountRoot;
  env.adapter.mount();assert.equal(env.adapter.mountRoot,root);assert.equal(env.owner.listenerCount(),1);
  env.adapter.remount();assert.equal(env.owner.listenerCount(),1);assert.equal(walk(env.document.body).filter(x=>x.id==='sheld').length,1);
  env.adapter.destroy();env.adapter.destroy();assert.equal(env.owner.listenerCount(),0);assert.equal(env.events.listenerCount(),0);
  assert.equal(env.adapter.diagnostics().polling,false);
});

test('host unavailable is reported honestly and leaves no Area-52 root behind',()=>{
  const document=new HostDocument(),events=new EventSource();
  const adapter=createWave12SillyTavernHostAdapter({document,getContext:()=>({chatId:'chat:x',eventSource:events,eventTypes:EVENT_TYPES})});
  assert.throws(()=>adapter.mount(),error=>error?.code==='SILLYTAVERN_CHAT_ROOT_UNAVAILABLE');
  assert.equal(document.getElementById('area52-ui-core-host'),null);
  assert.equal(events.listenerCount(),0);
});

test('SillyTavern-only selection publishes chat identity and invents no turn/generation/revision fields',()=>{
  const listeners=new Set(),bindings={subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const env=environment({bindings,initialChatId:'chat:host'});
  env.adapter.mount();const s=env.adapter.ui.liveReceiptBinding.selection();
  assert.equal(s.chatId,'chat:host');assert.equal(s.turnId,null);assert.equal(s.generationId,null);assert.equal(s.correlationId,null);
  assert.equal(s.worldRevision,null);assert.equal(s.sceneRevision,null);assert.deepEqual(s.sourceRevisionRefs,[]);
  env.adapter.destroy();
});

test('chat switch drops stale owner turn identity until owner catches up, then rebinds coherently',()=>{
  const{a,b}=turns(),env=environment({records:[a,b],initialTurnId:'turn:a'});
  env.adapter.mount();
  env.adapter.ui.shell.inspector.select({kind:'wave8-stage',id:'old',title:'Old',item:{state:'COMPLETE'}});
  env.setChatId('chat:b');env.events.emit(EVENT_TYPES.CHAT_CHANGED);env.adapter.ui.scheduler.flush(1);
  let s=env.adapter.ui.liveReceiptBinding.selection();
  assert.equal(s.chatId,'chat:b');assert.equal(s.turnId,null);assert.equal(s.generationId,null);
  assert.equal(env.adapter.ui.shell.inspector.selection,null);
  assert.ok(env.adapter.selectionBridge.diagnostics().chatMismatchDrops>=1);
  env.owner.switchTo('turn:b');env.adapter.ui.scheduler.flush(2);s=env.adapter.ui.liveReceiptBinding.selection();
  assert.equal(s.chatId,'chat:b');assert.equal(s.turnId,'turn:b');assert.equal(s.generationId,'gen:b');
  env.adapter.destroy();
});

test('same-turn owner receipt update refreshes without clearing operator Inspector location',()=>{
  const{b}=turns(),env=environment({records:[b],initialTurnId:'turn:b'});
  env.adapter.mount();env.adapter.ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED});
  env.adapter.ui.shell.inspector.select({kind:'wave8-stage',id:'keep',title:'Keep',item:{state:'COMPLETE'}});
  env.owner.emit();env.adapter.ui.scheduler.flush(3);
  assert.equal(env.adapter.ui.shell.inspector.selection?.id,'keep');
  assert.equal(env.adapter.ui.liveReceiptBinding.selection().turnId,'turn:b');
  env.adapter.destroy();
});

test('production missing Choice Truth and Seal remain UNAVAILABLE and Sensory is not relabeled SKIPPED',()=>{
  const listeners=new Set(),bindings={
    readSelection:()=>({chatId:'chat:none',turnId:'turn:none',generationId:'gen:none',correlationId:'corr:none'}),
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  };
  const env=environment({bindings,initialChatId:'chat:none'});env.adapter.mount();
  const read=env.adapter.ui.productionAdapters.cognition.read();
  assert.equal(read.sources.choice.mode,ProductDataMode.UNAVAILABLE);
  assert.equal(read.sources.truth.mode,ProductDataMode.UNAVAILABLE);
  assert.equal(read.sources.seal.mode,ProductDataMode.UNAVAILABLE);
  assert.equal(read.data.stages.find(x=>x.id==='SENSORY').state,'UNAVAILABLE');
  env.adapter.destroy();assert.equal(listeners.size,0);
});

test('Hot-only optimization is shown as SKIPPED only because Cognitive Choice published it',()=>{
  const{a}=turns(),env=environment({records:[a],initialTurnId:'turn:a'});env.adapter.mount();
  const read=env.adapter.ui.productionAdapters.cognition.read();
  assert.equal(read.data.choice.paths.includes('HOT_ONLY'),true);
  assert.equal(read.data.sensory,null);
  assert.equal(read.data.stages.find(x=>x.id==='SENSORY').state,'SKIPPED');
  assert.equal(read.data.jev.state,'SKIPPED');
  env.adapter.destroy();
});

test('invoked Jev without typed Jev receipt stays unavailable while other owner receipts remain healthy',()=>{
  const{b}=turns(),owner=createWave11LiveHost([b],'turn:b');
  const bindings={...owner.bundle,readJev:()=>null};
  const env=environment({bindings,initialChatId:'chat:b'});env.adapter.mount();
  const read=env.adapter.ui.productionAdapters.cognition.read();
  assert.equal(read.data.jev,null);assert.equal(read.sources.jev.mode,ProductDataMode.UNAVAILABLE);
  assert.ok(read.data.truth);assert.ok(read.data.gather);
  env.adapter.destroy();assert.equal(owner.listenerCount(),0);
});

test('wrong-generation Cognitive Choice is contained at Choice without blanking healthy Gather',()=>{
  const{b}=turns(),owner=createWave11LiveHost([b],'turn:b'),wrong=structuredClone(b.choice);wrong.generationId='gen:foreign';
  const bindings={...owner.bundle,readCognitiveChoice:()=>wrong};
  const env=environment({bindings,initialChatId:'chat:b'});env.adapter.mount();
  const read=env.adapter.ui.productionAdapters.cognition.read();
  assert.equal(read.data.choice,null);assert.equal(read.sources.choice.mode,ProductDataMode.DEGRADED);assert.ok(read.data.gather);
  env.adapter.destroy();
});

test('future Scene revision is rejected only at affected Truth stage',()=>{
  const{b}=turns(),owner=createWave11LiveHost([b],'turn:b'),future=structuredClone(b.truth);future.sceneRevision=b.selection.sceneRevision+1;
  const bindings={...owner.bundle,readTruth:()=>future};
  const env=environment({bindings,initialChatId:'chat:b'});env.adapter.mount();
  const read=env.adapter.ui.productionAdapters.cognition.read();
  assert.equal(read.data.truth,null);assert.equal(read.sources.truth.mode,ProductDataMode.DEGRADED);assert.ok(read.data.gather);
  env.adapter.destroy();
});

test('foreign source revision is rejected at Truth while coherent Gather and Seal remain inspectable',()=>{
  const{b}=turns(),owner=createWave11LiveHost([b],'turn:b'),foreign=structuredClone(b.truth);foreign.sourceRevisionRefs=['lore:foreign@99'];
  const bindings={...owner.bundle,readTruth:()=>foreign};
  const env=environment({bindings,initialChatId:'chat:b'});env.adapter.mount();
  const read=env.adapter.ui.productionAdapters.cognition.read();
  assert.equal(read.data.truth,null);assert.equal(read.sources.truth.mode,ProductDataMode.DEGRADED);
  assert.ok(read.data.gather);assert.ok(read.data.seal);
  env.adapter.destroy();
});

test('Gather late/Seal admission conflict remains degraded and excluded from safe admission',()=>{
  const t=makeWave11Turn({selection:{chatId:'chat:late',turnId:'turn:late',generationId:'gen:late',correlationId:'corr:late',worldRevision:80,sceneRevision:31,sourceRevisionRefs:['scene:late@31']},scenario:'ambiguous',late:true,conflictingAdmission:true});
  const env=environment({records:[t],initialTurnId:'turn:late'});env.adapter.mount();
  const read=env.adapter.ui.productionAdapters.cognition.read(),seal=read.data.seal;
  assert.deepEqual(seal.coherenceConflictIds,['result:green-room']);
  assert.equal(seal.effectiveAdmittedResultIds.includes('result:green-room'),false);
  assert.equal(read.sources.seal.mode,ProductDataMode.DEGRADED);
  env.adapter.destroy();
});

test('420px host-adjacent path remains keyboard-addressable through Brain Detail',()=>{
  const{b}=turns(),env=environment({records:[b],initialTurnId:'turn:b'});env.adapter.mount();
  env.adapter.ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:420,inspectorVisible:true});
  env.adapter.ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);env.adapter.ui.shell.selectWorkspace('brain');env.adapter.ui.scheduler.flush(4);
  const buttons=walk(env.adapter.ui.shell.nodes.workspace).filter(x=>x.tagName==='BUTTON');
  assert.ok(buttons.length>5);assert.ok(buttons.every(x=>x.attributes?.type==='button'));
  assert.equal(env.adapter.ui.presentation.get().frontFaceWidth,420);
  env.adapter.destroy();
});

test('routine host telemetry records only event identity and never forwards message or prompt payloads',()=>{
  const{a}=turns(),env=environment({records:[a],initialTurnId:'turn:a'});env.adapter.mount();
  env.events.emit(EVENT_TYPES.MESSAGE_RECEIVED,{mes:'SECRET PROMPT BODY',prompt:'DO NOT RETAIN'});
  const d=env.adapter.selectionBridge.diagnostics(),json=JSON.stringify(d);
  assert.equal(d.lastHostEvent,'MESSAGE_RECEIVED');assert.equal(d.rawPromptTelemetry,false);
  assert.doesNotMatch(json,/SECRET PROMPT BODY|DO NOT RETAIN/);
  env.adapter.destroy();
});
