import assert from 'node:assert/strict';
import { FrontFaceMode, ProductDetailLevel, UIStateStore, createWave12SillyTavernHostAdapter } from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';
import { createWave11LiveHost, makeWave11Turn } from './fixtures/wave11-live-receipts.mjs';

class Node extends FakeNode{
  constructor(tag,doc){super(tag,doc);this.id='';}
  get nextSibling(){const a=this.parentNode?.children??[],i=a.indexOf(this);return i>=0?a[i+1]??null:null;}
  insertBefore(node,before){const i=this.children.indexOf(before);if(i<0)return this.append(node);this.children.splice(i,0,node);node.parentNode=this;return node;}
  remove(){const p=this.parentNode,i=p?.children?.indexOf(this)??-1;if(i>=0)p.children.splice(i,1);this.parentNode=null;}
}
class Doc extends FakeDocument{
  constructor(){super();this.body=new Node('body',this);}
  createElement(tag){return new Node(tag,this);}
  createDocumentFragment(){return new Node('fragment',this);}
  getElementById(id){return all(this.body).find(x=>x.id===id)??null;}
  querySelector(selector){return selector?.startsWith('#')?this.getElementById(selector.slice(1)):null;}
}
class Events{
  constructor(){this.m=new Map();}
  on(k,f){if(!this.m.has(k))this.m.set(k,new Set());this.m.get(k).add(f);}
  removeListener(k,f){this.m.get(k)?.delete(f);}
  emit(k){for(const f of [...(this.m.get(k)??[])])f();}
  count(){return [...this.m.values()].reduce((n,s)=>n+s.size,0);}
}
const all=node=>[node,...(node?.children??[]).flatMap(all)];
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
const types={CHAT_CHANGED:'chat_id_changed',MESSAGE_RECEIVED:'message_received',MESSAGE_UPDATED:'message_updated',GENERATION_STARTED:'generation_started',GENERATION_ENDED:'generation_ended'};

const turns=Array.from({length:4},(_,i)=>makeWave11Turn({
  selection:{chatId:'chat:stress',turnId:'turn:'+i,generationId:'gen:'+i,correlationId:'corr:'+i,worldRevision:100+i,sceneRevision:50+i,sourceRevisionRefs:['scene:stress@'+(50+i)]},
  scenario:i===0?'hot':i===1?'retrieval':'ambiguous',resourceCount:i%2?4:1,late:i===3,
}));
const owner=createWave11LiveHost(turns,'turn:0'),document=new Doc(),sheld=document.createElement('div'),events=new Events();
sheld.id='sheld';sheld.append(document.createElement('div'));document.body.append(sheld);
let chatId='chat:stress';
const adapter=createWave12SillyTavernHostAdapter({
  document,getContext:()=>({chatId,eventSource:events,eventTypes:types}),
  hostBindings:owner.bundle,stateStore:new UIStateStore({storage:memory(),namespace:'wave12-stress'}),
}).mount();

adapter.ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:420,inspectorVisible:true});
adapter.ui.productAdapter.setDetailLevel(ProductDetailLevel.ADVANCED);
adapter.ui.shell.selectWorkspace('brain');adapter.ui.scheduler.flush(0);

let maxPending=0,maxRoots=0;
for(let i=0;i<600;i++){
  owner.switchTo('turn:'+(i%turns.length));
  if(i%2===0)events.emit(types.MESSAGE_UPDATED);
  if(i%3===0)adapter.ui.presentation.setWidth([420,560,720,900][i%4]);
  if(i%7===0)adapter.ui.productAdapter.setDetailLevel([ProductDetailLevel.NORMAL,ProductDetailLevel.DETAIL,ProductDetailLevel.ADVANCED][i%3]);
  maxPending=Math.max(maxPending,adapter.ui.scheduler.pendingCount);
  maxRoots=Math.max(maxRoots,all(document.body).filter(x=>x.id==='area52-ui-core-host').length);
  assert.ok(adapter.ui.scheduler.pendingCount<=5,'render queue must remain bounded');
  if(i%25===24){
    adapter.ui.scheduler.flush(i+1);
    adapter.remount();
    adapter.ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:420});
    adapter.ui.shell.selectWorkspace('brain');
  }
  assert.equal(owner.listenerCount(),1,'one composite owner subscription');
}
adapter.ui.scheduler.flush(1000);
assert.equal(maxRoots,1,'destroy/remount must never retain duplicate product roots');
assert.ok(maxPending<=5);
assert.equal(owner.listenerCount(),1);
adapter.destroy();
assert.equal(owner.listenerCount(),0);
assert.equal(events.count(),0);
assert.equal(all(document.body).filter(x=>x.id==='area52-ui-core-host').length,0);
assert.equal(sheld.children.length,1);
console.log(JSON.stringify({switches:600,remounts:24,maxPending,maxRoots,hostListenersAfterDestroy:events.count(),ownerListenersAfterDestroy:owner.listenerCount()},null,2));
