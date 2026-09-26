import { UIStateStore, mountWave12SillyTavernInterface } from '../../src/ui-core/index.js';

class Events{constructor(){this.m=new Map()}on(k,f){if(!this.m.has(k))this.m.set(k,new Set());this.m.get(k).add(f)}removeListener(k,f){this.m.get(k)?.delete(f)}emit(k,...a){for(const f of [...(this.m.get(k)??[])])f(...a)}}
const eventTypes={CHAT_CHANGED:'chat_id_changed',MESSAGE_UPDATED:'message_updated',GENERATION_STARTED:'generation_started',GENERATION_ENDED:'generation_ended'};
const stories={
  moon:{chatId:'chat:moon',location:'Moon Harbor',cast:['Captain Vale'],thread:'missing blue ledger',line:'Fog rolls across Moon Harbor while Captain Vale searches for a missing ledger.'},
  orchard:{chatId:'chat:orchard',location:'Glass Orchard',cast:['Ilya'],thread:'cracked north dome',line:'Ilya crosses the Glass Orchard and finds a crack spreading across the north dome.'},
};
const events=new Events(),listeners=new Set(),storage=new Map();
let story=stories.moon,turnCounter=1,selection={chatId:story.chatId,turnId:null,generationId:null,correlationId:null,worldRevision:null,sceneRevision:null,sourceRevisionRefs:[]};
let resources=[],lore={kind:'LorePublicIntegrationSurface',entries:[],artifacts:[],conflicts:[],lifecycle:{counts:{DUE:0,PENDING:0,ACTIVE:0,CHECKPOINTED:0,COMPLETED:0,SUPERSEDED:0,STALE:0,INVALID:0},due:0,active:0}};
const identity=()=>({...selection});
const emit=kind=>{for(const fn of [...listeners])fn({kind,selection:identity()})};
const bindings={
  readSelection:identity,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
  readScene:()=>selection.turnId?{kind:'SceneUiReadModel',sceneId:'scene:'+story.chatId,revision:selection.sceneRevision,lifecycle:'ACTIVE',location:{value:{name:story.location},authority:'OBSERVED'},narrativeTime:{value:'evening'},activeCast:story.cast,objects:[],activeThreads:[story.thread],uncertainFields:[],provenanceRefs:['host:'+selection.turnId],health:{state:'READY',reasons:[]},...identity()}:null,
  readScatter:()=>selection.turnId?{kind:'RuntimeScatterReceipt',jobs:[{taskId:'job:'+selection.turnId,capability:'CPU_ANALYSIS'}],admittedJobCount:1,resourceCount:1,resourceIds:['native:1'],requiredFallback:0,opportunisticPending:0,...identity()}:null,
  readCognitiveChoice:()=>selection.turnId?{kind:'CognitiveChoiceReceipt',id:'choice:'+selection.turnId,receiptRevision:1,status:'COMPLETE',paths:['HOT_ONLY'],functionDecisions:[],admittedJobs:[],skippedJobs:[],deferredJobs:[],consideredCognitionOptions:[],reasonCodes:['HOT_SUFFICIENT'],retrievalIntents:[],sensoryChannelsRequested:[],sensoryChannelsUsed:[],candidateCounts:{},measurements:{},...identity()}:null,
  readLoreStatus:()=>({...lore,...identity()}),readMemoryStatus:()=>({kind:'MemoryStatus',state:'READY',...identity()}),
  listResourceProfiles:()=>resources.map(x=>({...x})),
  connectResource:async c=>{resources.push({profileId:c.profileId||c.kind.toLowerCase()+':local',kind:c.kind,providerId:'harness-local',modelId:c.modelId||'operator-selected',local:true,health:'HEALTHY',availability:'AVAILABLE',connected:true,capabilities:c.kind==='JEV'?['SEMANTIC_JUDGMENT']:['CPU_ANALYSIS','GRAPH'],placements:['FOREGROUND','BACKGROUND'],currentLoad:0,concurrencyCapacity:2});emit('RESOURCE_CHANGED');return{ok:true}},
  disconnectResource:async r=>{resources=resources.filter(x=>x.profileId!==(r.id??r.profileId));emit('RESOURCE_CHANGED');return{ok:true}},
  testResource:async()=>({ok:true,status:'HEALTHY'}),
  acceptLorebook:async book=>{lore={...lore,entries:book.entries.map(e=>({sourceId:'lore:'+book.id+':'+e.uid,lorebookId:book.id,uid:e.uid,sourceRevisionId:'lore:'+book.id+':'+e.uid+'@r1',sourceState:'CURRENT',learnedRevisionId:null,freshness:'STALE_OR_UNLEARNED',artifactIds:[],retrievalRepresentations:[]})),lifecycle:{...lore.lifecycle,counts:{...lore.lifecycle.counts,DUE:book.entries.length},due:book.entries.length}};emit('LORE_ACCEPTED');return{accepted:true}},
  runLoreStudy:async()=>{lore={...lore,entries:lore.entries.map(e=>({...e,learnedRevisionId:'learned:'+e.sourceId,freshness:'CURRENT',artifactIds:['retrieval:'+e.uid],retrievalRepresentations:[{artifactId:'retrieval:'+e.uid,sourceRevisionId:e.sourceRevisionId,authorityClass:'DERIVED',temporalClass:'CURRENT',unresolved:false,provenance:{sourceRevisionId:e.sourceRevisionId}}]})),lifecycle:{...lore.lifecycle,counts:{...lore.lifecycle.counts,DUE:0,COMPLETED:lore.entries.length},due:0}};emit('LORE_LEARNED');return{completed:true}},
};
const getContext=()=>({chatId:story.chatId,eventSource:events,eventTypes,getCurrentChatId:()=>story.chatId,chat:[]});
let host=mountWave12SillyTavernInterface({document,getContext,hostBindings:bindings,stateStore:new UIStateStore({storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},namespace:'wave13-harness'})});
function renderChat(){document.querySelector('#chat').innerHTML='<article><strong>'+story.location+'</strong><p>'+story.line+'</p></article><article><strong>Harness note</strong><p>This is a generic host harness. Use the red vertical rail to open Area-52 cards; drag the rail or card handle, resize/minimize it, connect a simulated optional resource in Brain, or submit arbitrary Lore in Lore.</p></article>'}
function report(){const d=host.ui.operator.operations.read();document.querySelector('#status').textContent=(selection.turnId?'turn '+selection.turnId:'waiting for turn')+' · '+d.active+' observed producers'}
function setStory(key){story=stories[key];selection={chatId:story.chatId,turnId:null,generationId:null,correlationId:null,worldRevision:null,sceneRevision:null,sourceRevisionRefs:[]};events.emit(eventTypes.CHAT_CHANGED);emit('SELECTION_CHANGED');renderChat();report()}
function publishTurn(){const n=turnCounter++;selection={chatId:story.chatId,turnId:'turn:'+n,generationId:'gen:'+n,correlationId:'corr:'+n,worldRevision:n,sceneRevision:n,sourceRevisionRefs:['scene:'+story.chatId+'@'+n]};events.emit(eventTypes.GENERATION_STARTED);emit('TURN_COMMITTED');events.emit(eventTypes.GENERATION_ENDED);host.ui.scheduler.flush(performance.now());report()}
document.querySelector('#story').addEventListener('change',e=>setStory(e.target.value));
document.querySelector('#idle').addEventListener('click',()=>setStory(document.querySelector('#story').value));
document.querySelector('#turn').addEventListener('click',publishTurn);
window.addEventListener('beforeunload',()=>host.destroy(),{once:true});renderChat();report();