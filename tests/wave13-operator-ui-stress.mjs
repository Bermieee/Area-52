import assert from 'node:assert/strict';
import { UIStateStore, createWave6ProductInterface } from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

class Node extends FakeNode{constructor(tag,doc){super(tag,doc);this.id='';this.value='';}getAttribute(n){return this.attributes?.[n]??null;}}
class Doc extends FakeDocument{
  constructor(width,height){super();this.body=new Node('body',this);this.documentElement=new Node('html',this);this.documentElement.clientWidth=width;this.documentElement.clientHeight=height;this.body.clientWidth=width;this.body.clientHeight=height;this.defaultView={innerWidth:width,innerHeight:height};}
  createElement(tag){return new Node(tag,this);}createDocumentFragment(){return new Node('fragment',this);}
  dispatch(type,event={}){for(const fn of this.listeners.get(type)??[])fn({type,target:this,preventDefault(){},...event});}
}
const mem=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
const all=n=>[n,...(n?.children??[]).flatMap(all)];

let selection={chatId:'chat:stress-0',turnId:'turn:0',generationId:'gen:0',correlationId:'corr:0',worldRevision:1,sceneRevision:1,sourceRevisionRefs:['scene:0@1']};
let location='North Archive';const listeners=new Set();
const identity=()=>({...selection});
const host={
  readSelection:identity,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  readScene:()=>({kind:'SceneUiReadModel',sceneId:'scene:'+selection.chatId,revision:selection.sceneRevision,lifecycle:'ACTIVE',location:{value:{name:location},authority:'OBSERVED'},narrativeTime:{value:'night'},activeCast:['Rin'],objects:[],activeThreads:[],uncertainFields:[],provenanceRefs:['scene'],health:{state:'READY',reasons:[]},...identity()}),
  readScatter:()=>({kind:'RuntimeScatterReceipt',jobs:[{taskId:'job:'+selection.turnId,capability:'CPU_ANALYSIS'}],admittedJobCount:1,resourceCount:1,resourceIds:['native:1'],requiredFallback:0,opportunisticPending:0,...identity()}),
  readCognitiveChoice:()=>({kind:'CognitiveChoiceReceipt',id:'choice:'+selection.turnId,receiptRevision:1,status:'COMPLETE',paths:['HOT_ONLY'],functionDecisions:[],admittedJobs:[],skippedJobs:[],deferredJobs:[],consideredCognitionOptions:[],reasonCodes:[],retrievalIntents:[],sensoryChannelsRequested:[],sensoryChannelsUsed:[],candidateCounts:{},measurements:{},...identity()}),
  readLoreStatus:()=>({kind:'LorePublicIntegrationSurface',entries:[],artifacts:[],conflicts:[],lifecycle:{counts:{DUE:0,ACTIVE:0,INVALID:0},due:0,active:0},...identity()}),
  readMemoryStatus:()=>({kind:'MemoryStatus',state:'READY',...identity()}),
};
const emit=()=>{for(const fn of [...listeners])fn({kind:'STRESS_UPDATE',selection:identity()});};

let maxPending=0,maxCards=0,maxRails=0;
for(const [width,height,cycles] of [[1440,900,240],[420,640,160]]){
  const document=new Doc(width,height),root=new Node('aside',document);document.body.append(root);
  const ui=createWave6ProductInterface({root,stateStore:new UIStateStore({storage:mem(),namespace:'wave13-stress-'+width}),hostBindings:host,floatingNavigation:true,viewportProvider:()=>({width,height})});
  const product=['home','story','characters','lore','memory-product','world-product','brain'];
  for(let i=0;i<cycles;i++){
    selection={chatId:'chat:stress-'+(i%7),turnId:'turn:'+i,generationId:'gen:'+i,correlationId:'corr:'+i,worldRevision:i+2,sceneRevision:i+2,sourceRevisionRefs:['scene:'+(i%7)+'@'+(i+2)]};
    location='Setting '+(i%11);emit();
    ui.floatingController.open(product[i%product.length]);
    if(i%4===0)ui.floatingController.nodes.railHandle.dispatch('keydown',{key:i%8===0?'ArrowLeft':'ArrowRight'});
    if(i%5===0)ui.floatingController.nodes.cardHandle.dispatch('keydown',{key:i%10===0?'ArrowUp':'ArrowDown'});
    if(i%11===0)ui.floatingController.resize(i%22===0?-120:120);
    if(i%17===0){ui.floatingController.toggleMinimized();ui.floatingController.toggleMinimized();}
    ui.scheduler.flush(i+1);
    const d=ui.floatingController.diagnostics();
    assert.ok(d.rail.x>=10&&d.rail.x+64<=width-10);
    assert.ok(d.card.x>=10&&d.card.x+d.card.width<=width-10);
    maxPending=Math.max(maxPending,ui.scheduler.pendingCount);
    maxCards=Math.max(maxCards,all(document.body).filter(x=>String(x.className).split(/\\s+/).includes('a52-wave13-popout')).length);
    maxRails=Math.max(maxRails,all(document.body).filter(x=>String(x.className).split(/\\s+/).includes('a52-wave13-rail')).length);
    assert.ok(ui.scheduler.pendingCount<=5);
    assert.equal(listeners.size,1);
  }
  ui.destroy();assert.equal(listeners.size,0);assert.equal(root.children.length,0);
}
assert.equal(maxCards,1);assert.equal(maxRails,1);
console.log(JSON.stringify({wideCycles:240,narrowCycles:160,maxPending,maxCards,maxRails,ownerListenersAfterDestroy:listeners.size},null,2));
