import {
  FrontFaceMode, ProductDetailLevel, UIStateStore, mountWave12SillyTavernInterface,
} from '../../src/ui-core/index.js';
import { createWave11LiveHost, makeWave11Turn } from '../../tests/fixtures/wave11-live-receipts.mjs';

class HarnessEvents{
  constructor(){this.listeners=new Map();}
  on(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,...args){for(const fn of [...(this.listeners.get(type)??[])])fn(...args);}
}
const eventTypes={
  CHAT_CHANGED:'chat_id_changed',CHAT_LOADED:'chatLoaded',MESSAGE_SENT:'message_sent',MESSAGE_RECEIVED:'message_received',
  MESSAGE_EDITED:'message_edited',MESSAGE_DELETED:'message_deleted',MESSAGE_UPDATED:'message_updated',MESSAGE_SWIPED:'message_swiped',
  GENERATION_STARTED:'generation_started',GENERATION_STOPPED:'generation_stopped',GENERATION_ENDED:'generation_ended',
};
const base={chatId:'chat:harness',worldRevision:52,sceneRevision:19,sourceRevisionRefs:['lore:ember@6','scene:ember@19','memory:ember@12']};
const turns=[
  makeWave11Turn({selection:{...base,turnId:'turn:hot',generationId:'gen:hot',correlationId:'corr:hot'},scenario:'hot'}),
  makeWave11Turn({selection:{...base,turnId:'turn:retrieval',generationId:'gen:retrieval',correlationId:'corr:retrieval'},scenario:'retrieval',resourceCount:1}),
  makeWave11Turn({selection:{...base,turnId:'turn:ambiguous',generationId:'gen:ambiguous',correlationId:'corr:ambiguous'},scenario:'ambiguous',resourceCount:2,late:true}),
];
const owner=createWave11LiveHost(turns,'turn:hot'),events=new HarnessEvents(),storage=new Map();
const stateStore=new UIStateStore({storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},namespace:'wave12-host-harness'});
let host=null;
const getContext=()=>({chatId:'chat:harness',chat:[],eventSource:events,eventTypes,getCurrentChatId:()=> 'chat:harness'});

function mount(){
  host=mountWave12SillyTavernInterface({document,getContext,hostBindings:owner.bundle,stateStore});
  host.ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:Number(document.querySelector('#width').value),inspectorVisible:true});
  host.ui.productAdapter.setDetailLevel(document.querySelector('#detail').value);
  host.ui.shell.selectWorkspace('brain');host.ui.scheduler.flush(performance.now());
  report();
}
function report(){
  const d=host?.diagnostics();document.querySelector('#status').textContent=d?.mounted?`mounted · turn ${host.ui.liveReceiptBinding.selection().turnId??'—'} · owner sub ${owner.listenerCount()}`:'destroyed';
}
document.querySelector('#turn').addEventListener('change',event=>{owner.switchTo(event.target.value);host.ui.scheduler.flush(performance.now());report();});
document.querySelector('#detail').addEventListener('change',event=>{host.ui.productAdapter.setDetailLevel(event.target.value);host.ui.shell.refreshCurrentWorkspace();host.ui.scheduler.flush(performance.now());});
document.querySelector('#width').addEventListener('change',event=>{host.ui.presentation.patch({frontFaceWidth:Number(event.target.value),frontFaceMode:FrontFaceMode.EXPANDED});host.ui.scheduler.flush(performance.now());});
document.querySelector('#toggle').addEventListener('click',event=>{host.ui.presentation.toggle();host.ui.scheduler.flush(performance.now());event.target.textContent=host.ui.presentation.get().frontFaceMode===FrontFaceMode.EXPANDED?'Collapse':'Expand';});
document.querySelector('#remount').addEventListener('click',()=>{host.destroy();mount();});
window.addEventListener('beforeunload',()=>host?.destroy(),{once:true});
mount();
