import {
  ProductDataMode, Wave6Health, clone, createProductSourceStatus, deepFreeze, normalizeWave6Health,
} from './wave6-contracts.js';

export const OperatorProducerState=Object.freeze({
  LIVE:'LIVE',
  WORKING:'WORKING',
  IDLE:'IDLE',
  WAITING_FOR_TURN:'WAITING_FOR_TURN',
  DISCONNECTED:'DISCONNECTED',
  UNAVAILABLE:'UNAVAILABLE',
  DEGRADED:'DEGRADED',
});

const text=v=>v==null||v===''?null:String(v);
const fn=(x,names)=>{for(const name of names)if(typeof x?.[name]==='function')return x[name].bind(x);return null;};
const cloneSafe=v=>v==null?v:clone(v);

export class Wave13OwnerReadModelAdapter{
  constructor({label,producer,read,selectionProvider=()=>({}),turnBound=false,unavailableReason=null}={}){
    this.label=String(label||'Owner state');this.producer=producer??this.label;this.readFn=typeof read==='function'?read:null;
    this.selectionProvider=selectionProvider;this.turnBound=Boolean(turnBound);this.unavailableReason=unavailableReason;
  }
  read(){
    const selection=this.selectionProvider?.()??{};
    if(!this.readFn)return unavailable(this.label,this.unavailableReason??(this.label+' read contract is not exported by the host assembly.'),this.producer);
    if(this.turnBound&&selection.chatId&&!selection.turnId)return waiting(this.label,'Waiting for the selected chat to publish an active turn.',this.producer,selection);
    try{
      const raw=this.readFn(selection);
      if(raw==null)return idle(this.label,this.turnBound?'No owner receipt has been published for the selected turn.':'The producer is connected but has no current record.',this.producer,selection);
      assertSelection(raw,selection,this.label);
      const health=normalizeWave6Health(raw.health?.state??raw.health??raw.status??Wave6Health.READY,{fallback:Wave6Health.READY});
      const degraded=[Wave6Health.DEGRADED,Wave6Health.STALE,Wave6Health.BLOCKED].includes(health);
      return deepFreeze({
        source:createProductSourceStatus({
          mode:degraded?ProductDataMode.DEGRADED:ProductDataMode.LIVE,health,label:this.label,
          operationalState:degraded?OperatorProducerState.DEGRADED:health===Wave6Health.WORKING?OperatorProducerState.WORKING:OperatorProducerState.LIVE,
          impact:degraded?this.label+' owner state is degraded.':this.label+' owner state is current for the selected context.',
          reason:reasonOf(raw),producer:this.producer,revision:revisionOf(raw),connected:true,selection,freshness:freshnessOf(raw),
        }),
        data:cloneSafe(raw),
      });
    }catch(error){
      return degraded(this.label,this.label+' owner read failed for the selected context.',this.producer,selection,error);
    }
  }
}


export class Wave13RuntimeReceiptUIAdapter{
  constructor({readScatter=null,selectionProvider=()=>({})}={}){this.readScatter=typeof readScatter==='function'?readScatter:null;this.selectionProvider=selectionProvider;}
  read(){
    const selection=this.selectionProvider?.()??{};
    if(!this.readScatter)return unavailable('Runtime','Runtime scheduler telemetry and selected-turn scatter readers are not exported by the host assembly.','Runtime');
    if(selection.chatId&&!selection.turnId)return waiting('Runtime','Runtime is connected; waiting for an active turn.','RuntimeTurnReceipt',selection);
    try{
      const raw=this.readScatter(selection);
      if(raw==null)return idle('Runtime','No Runtime execution receipt exists for the selected turn.','RuntimeTurnReceipt',selection);
      assertSelection(raw,selection,'Runtime',{allowMissingIdentity:true});
      const jobs=raw.jobs??raw.admittedJobs??[],resourceCount=Number(raw.resourceCount??raw.executionResourceCount??(raw.resourceIds??[]).length??0);
      const fallback=Number(raw.requiredFallback??raw.fallbackCount??0),pending=Number(raw.opportunisticPending??raw.pending??0);
      return deepFreeze({
        source:createProductSourceStatus({mode:fallback?ProductDataMode.DEGRADED:ProductDataMode.LIVE,health:fallback?Wave6Health.DEGRADED:pending?Wave6Health.WORKING:Wave6Health.READY,label:'Runtime',operationalState:fallback?OperatorProducerState.DEGRADED:pending?OperatorProducerState.WORKING:OperatorProducerState.LIVE,impact:(Array.isArray(jobs)?jobs.length:Number(raw.admittedJobCount??0))+' logical jobs · '+resourceCount+' physical execution resources for the selected turn.',reason:fallback?'Runtime reports required fallback.':'',producer:raw.kind??'RuntimeTurnReceipt',revision:raw.receiptRevision??null,connected:true,selection,freshness:raw.freshness??'TURN_CURRENT'}),
        data:{mode:'TURN_RECEIPT',hotActivity:pending?1:0,deepActivity:0,queuedObligations:pending,blockedRecoveringWork:fallback,activeBatches:pending?1:0,resourceCount,admittedJobCount:Number(raw.admittedJobCount??(Array.isArray(jobs)?jobs.length:0)),resourceIds:[...(raw.resourceIds??[])],jobs:cloneSafe(jobs),receipt:cloneSafe(raw)},
      });
    }catch(error){return degraded('Runtime','Runtime selected-turn receipt failed coherence or read.','RuntimeTurnReceipt',selection,error);}
  }
  subscribe(){return()=>{};}
}

export class Wave13LoreStudyUIAdapter{
  constructor({bindings={},selectionProvider=()=>({})}={}){
    this.bindings=bindings;this.selectionProvider=selectionProvider;
    this.readFn=fn(bindings,['readLoreStudySurface','readLoreStatus','readLoreStudyStatus']);
    this.acceptFn=fn(bindings,['acceptLorebook','submitLorebook','enqueueLorebook','ingestLorebook']);
    this.runFn=fn(bindings,['runLoreStudy','startLoreStudy','runDueLoreStudy']);
    this.retryFn=fn(bindings,['retryLoreStudy']);
    this.lastAction=null;this.lastError=null;
  }
  capabilities(){return deepFreeze({read:Boolean(this.readFn),accept:Boolean(this.acceptFn),run:Boolean(this.runFn),retry:Boolean(this.retryFn)});}
  read(){
    const selection=this.selectionProvider?.()??{};
    if(!this.readFn)return unavailable('Lore Study','Lore Study read contract is not exported by the host assembly.','LoreStudyRuntime');
    try{
      const raw=this.readFn(selection);
      if(raw==null)return idle('Lore Study','Lore Study is connected; no Lore has been accepted yet.','LoreStudyRuntime',selection);
      if(selection.turnId)assertSelection(raw,selection,'Lore Study',{allowMissingIdentity:true});
      const data=normalizeLoreSurface(raw);
      const invalid=Number(data.lifecycle?.counts?.INVALID??0),active=Number(data.lifecycle?.active??data.lifecycle?.counts?.ACTIVE??0),due=Number(data.lifecycle?.due??0);
      const stale=data.entries.some(x=>x.freshness==='STALE_OR_UNLEARNED');
      const health=invalid?Wave6Health.DEGRADED:active||due?Wave6Health.WORKING:Wave6Health.READY;
      const op=invalid?OperatorProducerState.DEGRADED:active||due?OperatorProducerState.WORKING:data.entries.length?OperatorProducerState.LIVE:OperatorProducerState.IDLE;
      const learned=data.entries.filter(x=>['CURRENT','REMOVED'].includes(x.freshness)&&x.learnedRevisionId).length;
      return deepFreeze({
        source:createProductSourceStatus({
          mode:invalid?ProductDataMode.DEGRADED:ProductDataMode.LIVE,health,label:'Lore Study',operationalState:op,
          impact:invalid?'One or more Lore study obligations are invalid.':active||due?'Lore is accepted; study is still in progress.':data.entries.length?learned===data.entries.length?'Accepted Lore is learned and retrieval-facing.':'Lore is accepted but not all entries are learned yet.':'No Lore has been accepted.',
          reason:stale?'One or more accepted source revisions are stale or not learned.':'',producer:raw.kind??'LoreStudyRuntime',revision:data.revision,connected:true,selection,freshness:stale?'STALE_OR_UNLEARNED':'CURRENT',
        }),
        data,
      });
    }catch(error){return degraded('Lore Study','Lore Study read failed.','LoreStudyRuntime',selection,error);}
  }
  async accept(input){
    this.lastError=null;
    if(!this.acceptFn){const e=new Error('Lore acceptance action is not exported by the host assembly.');e.code='LORE_ACCEPT_ACTION_UNAVAILABLE';this.lastError=e;throw e;}
    try{const result=await this.acceptFn(cloneSafe(input));this.lastAction={type:'ACCEPT',result:cloneSafe(result)};return cloneSafe(result);}
    catch(error){this.lastError=error;throw error;}
  }
  async run(input={}){
    this.lastError=null;
    if(!this.runFn){const e=new Error('Lore study execution action is not exported by the host assembly.');e.code='LORE_RUN_ACTION_UNAVAILABLE';this.lastError=e;throw e;}
    try{const result=await this.runFn(cloneSafe(input));this.lastAction={type:'RUN',result:cloneSafe(result)};return cloneSafe(result);}
    catch(error){this.lastError=error;throw error;}
  }
}

export class Wave13ResourceControlAdapter{
  constructor({bindings={}}={}){
    this.bindings=bindings;
    this.listFn=fn(bindings,['listResources','listResourceProfiles','listCapabilityProfiles','readResourceStatus']);
    this.configFn=fn(bindings,['listResourceConfigurations','listAvailableResources']);
    this.connectFn=fn(bindings,['connectResource','mountResource']);
    this.disconnectFn=fn(bindings,['disconnectResource','unmountResource']);
    this.testFn=fn(bindings,['testResource','probeResource','testConnection']);
    this.lastAction=null;this.lastError=null;this.tests=new Map();
  }
  capabilities(){return deepFreeze({read:Boolean(this.listFn),configurations:Boolean(this.configFn),connect:Boolean(this.connectFn),disconnect:Boolean(this.disconnectFn),test:Boolean(this.testFn)});}
  read(){
    if(!this.listFn)return deepFreeze({
      source:createProductSourceStatus({mode:ProductDataMode.UNAVAILABLE,health:Wave6Health.UNAVAILABLE,label:'Optional resources',operationalState:OperatorProducerState.UNAVAILABLE,impact:'Native Brain remains available. Optional resource control is not exported by this assembly.',reason:'Worker 2 currently publishes capability/health contracts but the assembly does not expose list/connect/test/disconnect actions.',producer:'OptionalResourceControl',connected:false}),
      data:{resources:[],configurations:this.configurations(),nativePathAvailable:true},
    });
    try{
      const raw=this.listFn();
      const resources=normalizeResources(raw);
      const connected=resources.filter(x=>x.connected).length;
      const degradedRows=resources.filter(x=>['DEGRADED','SATURATED','COOLDOWN','UNAVAILABLE'].includes(x.health));
      const health=degradedRows.length?Wave6Health.DEGRADED:Wave6Health.READY;
      const op=connected?degradedRows.length?OperatorProducerState.DEGRADED:OperatorProducerState.LIVE:OperatorProducerState.DISCONNECTED;
      return deepFreeze({
        source:createProductSourceStatus({mode:degradedRows.length?ProductDataMode.DEGRADED:ProductDataMode.LIVE,health,label:'Optional resources',operationalState:op,impact:connected?connected+' optional execution resource'+(connected===1?' is':'s are')+' connected.':'No optional Jev or sidecar resource is connected; native Brain remains usable.',producer:'Worker2ResourceStatus',connected:true}),
        data:{resources,configurations:this.configurations(),nativePathAvailable:true},
      });
    }catch(error){return degraded('Optional resources','Resource status could not be read.','Worker2ResourceStatus',{},error,{resources:[],configurations:[],nativePathAvailable:true});}
  }
  configurations(){
    if(!this.configFn)return[];
    try{const rows=this.configFn()??[];return Array.isArray(rows)?rows.map(normalizeConfiguration):[];}catch{return[];}
  }
  async connect(config){
    return this.#action('CONNECT',this.connectFn,config,'Resource connect action is not exported by the host assembly.');
  }
  async disconnect(resource){
    return this.#action('DISCONNECT',this.disconnectFn,resource,'Resource disconnect action is not exported by the host assembly.');
  }
  async test(resource){
    const result=await this.#action('TEST',this.testFn,resource,'Resource connection-test action is not exported by the host assembly.');
    const id=resourceId(resource);if(id)this.tests.set(id,cloneSafe(result));return result;
  }
  testResult(id){return cloneSafe(this.tests.get(String(id))??null);}
  async #action(type,action,payload,message){
    this.lastError=null;
    if(!action){const e=new Error(message);e.code='RESOURCE_ACTION_UNAVAILABLE';this.lastError=e;throw e;}
    try{const result=await action(cloneSafe(payload));this.lastAction={type,result:cloneSafe(result)};return cloneSafe(result);}
    catch(error){this.lastError=error;throw error;}
  }
}

export class Wave13OperationalStatusAdapter{
  constructor({hostBindings={},liveReceiptBinding=null,productionAdapters={},loreStudy=null,resources=null}={}){
    this.hostBindings=hostBindings;this.live=liveReceiptBinding;this.adapters=productionAdapters;this.loreStudy=loreStudy;this.resources=resources;
  }
  read(){
    const selection=this.live?.selection?.()??{};
    const cognition=this.#cognition(selection);
    const stages=[
      this.#adapterStage('scene','Scene',this.adapters.scene,selection,{turnBound:true}),
      this.#runtimeStage(selection,cognition),
      this.#coprocessorStage(selection),
      this.#cognitionStage('choice','Cognitive Choice',cognition,selection),
      this.#cognitionStage('truth','Truth',cognition,selection),
      this.#cognitionStage('jev','Jev',cognition,selection,{optional:true}),
      this.#cognitionStage('gather','Gather',cognition,selection),
      this.#cognitionStage('seal','Context Seal',cognition,selection),
      this.#adapterStage('promptPlan','PromptPlan',this.adapters.promptPlan,selection,{turnBound:true}),
      this.#sourceStage('lore','Lore Study',this.loreStudy?.read?.(),selection),
      this.#memoryStage(selection),
      this.#forensicsStage(selection),
    ];
    const active=stages.filter(x=>[OperatorProducerState.LIVE,OperatorProducerState.WORKING,OperatorProducerState.IDLE].includes(x.state)).length;
    const failures=stages.filter(x=>x.state===OperatorProducerState.DEGRADED).length;
    return deepFreeze({kind:'Wave13OperationalStatus',selection:cloneSafe(selection),stages,active,failures,waitingForTurn:Boolean(selection.chatId&&!selection.turnId),hostConnected:Boolean(selection.chatId),rawPromptTelemetry:false});
  }
  #cognition(selection){try{return this.adapters.cognition?.read?.(selection)??null;}catch{return null;}}
  #adapterStage(id,label,adapter,selection,{turnBound=false}={}){
    if(!adapter)return this.#missing(id,label,selection,turnBound);
    if(turnBound&&selection.chatId&&!selection.turnId)return stage(id,label,OperatorProducerState.WAITING_FOR_TURN,'Waiting for an active turn.',selection,null,'HOST_SELECTION');
    let read;try{read=adapter.read?.(selection)??adapter.read?.();}catch(error){return stage(id,label,OperatorProducerState.DEGRADED,String(error?.message??error),selection,null,'READ_ERROR');}
    return stageFromSource(id,label,read?.source,selection,{readerPresent:true});
  }
  #runtimeStage(selection,cognition){
    const hasRuntime=Boolean(this.hostBindings.runtimeAdapter||this.hostBindings.readRuntimeStatus||this.hostBindings.readScatter||this.hostBindings.readRuntimeTurn);
    if(selection.chatId&&!selection.turnId&&hasRuntime)return stage('runtime','Runtime',OperatorProducerState.WAITING_FOR_TURN,'Runtime is available; waiting for an active turn.',selection,null,'HOST_SELECTION');
    const normal=this.#adapterStage('runtime','Runtime',this.adapters.runtime,selection);
    if(normal.state!==OperatorProducerState.UNAVAILABLE)return normal;
    const scatter=cognition?.data?.scatter,source=cognition?.sources?.scatter;
    if(scatter)return stageFromSource('runtime','Runtime',source,selection,{readerPresent:true,reason:'Selected-turn Runtime scatter receipt is available; scheduler telemetry is not exported separately.'});
    if(hasRuntime)return stage('runtime','Runtime',OperatorProducerState.IDLE,'Runtime boundary is exported but no selected-turn execution receipt is available.',selection,null,'NO_TURN_RECEIPT');
    return normal;
  }
  #coprocessorStage(selection){
    const has=Boolean(this.hostBindings.coprocessorTelemetry||this.hostBindings.coprocessorAdapter||this.hostBindings.readCognitionUiState||this.hostBindings.readCoprocessorChoiceContribution);
    if(selection.chatId&&!selection.turnId&&has)return stage('coprocessor','Coprocessor',OperatorProducerState.WAITING_FOR_TURN,'Coprocessor is available; waiting for an active turn.',selection,null,'HOST_SELECTION');
    const normal=this.#adapterStage('coprocessor','Coprocessor',this.adapters.coprocessor,selection);
    if(normal.state!==OperatorProducerState.UNAVAILABLE)return normal;
    return has?stage('coprocessor','Coprocessor',OperatorProducerState.IDLE,'Coprocessor boundary is exported but has no selected-turn telemetry.',selection,null,'NO_TELEMETRY'):stage('coprocessor','Coprocessor',OperatorProducerState.UNAVAILABLE,'Assembly does not export Worker 2 CognitionUiState or Coprocessor choice contribution.',selection,null,'ASSEMBLY_CONTRACT_MISSING');
  }
  #cognitionStage(key,label,cognition,selection,{optional=false}={}){
    const source=cognition?.sources?.[key]??null,data=cognition?.data?.[key]??null;
    if(selection.chatId&&!selection.turnId)return stage(key,label,OperatorProducerState.WAITING_FOR_TURN,'Waiting for an active turn.',selection,null,'HOST_SELECTION');
    if(data)return stageFromSource(key,label,source,selection,{readerPresent:true});
    if(source?.mode===ProductDataMode.DEGRADED)return stageFromSource(key,label,source,selection,{readerPresent:true});
    if(source?.mode===ProductDataMode.UNAVAILABLE){
      const exported=readerExported(this.hostBindings,key);
      return stage(key,label,exported?OperatorProducerState.IDLE:optional?OperatorProducerState.DISCONNECTED:OperatorProducerState.UNAVAILABLE,exported?'No receipt was published for the selected turn.':optional?'Optional '+label+' reader/resource is not connected.':'Assembly does not export the '+label+' owner reader.',selection,null,exported?'NO_RECEIPT':'ASSEMBLY_CONTRACT_MISSING');
    }
    return stageFromSource(key,label,source,selection,{readerPresent:Boolean(source)});
  }
  #sourceStage(id,label,read,selection){
    if(!read)return this.#missing(id,label,selection,false);
    return stageFromSource(id,label,read.source,selection,{readerPresent:true});
  }
  #memoryStage(selection){
    const reader=fn(this.hostBindings,['readMemoryStatus','readMemory','readMemoryReadModel']);
    if(!reader)return stage('memory','Memory',OperatorProducerState.UNAVAILABLE,'Assembly does not export a Memory status reader.',selection,null,'ASSEMBLY_CONTRACT_MISSING');
    if(selection.chatId&&!selection.turnId)return stage('memory','Memory',OperatorProducerState.IDLE,'Memory producer is available; no active turn is required to inspect retained state.',selection,null,'NO_ACTIVE_TURN');
    try{const raw=reader(selection);if(!raw)return stage('memory','Memory',OperatorProducerState.IDLE,'Memory producer has no current status record.',selection,null,'NO_STATUS');assertSelection(raw,selection,'Memory',{allowMissingIdentity:true});return stage('memory','Memory',OperatorProducerState.LIVE,'Memory owner status is available.',selection,freshnessOf(raw),'OWNER_STATUS');}
    catch(error){return stage('memory','Memory',OperatorProducerState.DEGRADED,String(error?.message??error),selection,null,error?.code??'READ_ERROR');}
  }
  #forensicsStage(selection){
    const exported=Boolean(this.hostBindings.readForensic||this.hostBindings.readForensicReadModel||this.hostBindings.listForensics||this.hostBindings.listTransactions);
    if(!exported)return stage('forensics','Forensics',OperatorProducerState.UNAVAILABLE,'Assembly does not export Forensics/transaction readers.',selection,null,'ASSEMBLY_CONTRACT_MISSING');
    if(selection.chatId&&!selection.turnId)return stage('forensics','Forensics',OperatorProducerState.WAITING_FOR_TURN,'Waiting for an active turn.',selection,null,'HOST_SELECTION');
    try{const read=this.adapters.forensics?.readGeneration?.(selection.generationId)??null;return read?.data?stage('forensics','Forensics',OperatorProducerState.LIVE,'Forensic reconstruction is available for this generation.',selection,null,'OWNER_RECEIPT'):stage('forensics','Forensics',OperatorProducerState.IDLE,'No forensic bundle is available for the selected generation.',selection,null,'NO_RECEIPT');}
    catch(error){return stage('forensics','Forensics',OperatorProducerState.DEGRADED,String(error?.message??error),selection,null,error?.code??'READ_ERROR');}
  }
  #missing(id,label,selection,turnBound){if(turnBound&&selection.chatId&&!selection.turnId)return stage(id,label,OperatorProducerState.WAITING_FOR_TURN,'Waiting for an active turn.',selection,null,'HOST_SELECTION');return stage(id,label,OperatorProducerState.UNAVAILABLE,'Producer is not exported by the host assembly.',selection,null,'ASSEMBLY_CONTRACT_MISSING');}
}

export function parseLoreSubmission({id,title,text}={}){
  const body=String(text??'').trim();
  if(!body){const e=new TypeError('Lore content is required.');e.code='LORE_INPUT_EMPTY';throw e;}
  let parsed;
  if(body.startsWith('{')||body.startsWith('[')){
    try{parsed=JSON.parse(body);}catch(error){const e=new TypeError('Lore JSON is invalid: '+error.message);e.code='LORE_INPUT_INVALID_JSON';throw e;}
  }else parsed={entries:[{uid:'entry-1',content:body,metadata:{title:String(title||'Lore entry')}}]};
  const book=Array.isArray(parsed)?{entries:parsed}:parsed;
  const entries=book.entries;
  if(!Array.isArray(entries)||!entries.length){const e=new TypeError('Lore submission requires a non-empty entries array.');e.code='LORE_INPUT_NO_ENTRIES';throw e;}
  const normalized=entries.map((entry,index)=>{
    const uid=text(entry?.uid??entry?.id);const content=text(entry?.content);
    if(!uid||!content){const e=new TypeError('Lore entry '+(index+1)+' requires uid and content.');e.code='LORE_INPUT_INVALID_ENTRY';throw e;}
    return{uid,content,metadata:entry.metadata&&typeof entry.metadata==='object'?cloneSafe(entry.metadata):{}};
  });
  return deepFreeze({id:text(book.id??id)??'operator-lore',title:text(book.title??title)??text(book.id??id)??'Operator Lore',metadata:book.metadata&&typeof book.metadata==='object'?cloneSafe(book.metadata):{},entries:normalized,fullSnapshot:book.fullSnapshot!==false});
}

function normalizeLoreSurface(raw){
  const x=raw.study?.kind==='LorePublicIntegrationSurface'?raw.study:raw.kind==='LorePublicIntegrationSurface'?raw:raw.publicSurface??raw.study??raw;
  const entries=(x.entries??[]).map(row=>({
    sourceId:row.sourceId??null,lorebookId:row.lorebookId??null,uid:row.uid??null,sourceRevisionId:row.sourceRevisionId??null,sourceState:row.sourceState??null,
    learnedRevisionId:row.learnedRevisionId??null,freshness:row.freshness??'STALE_OR_UNLEARNED',artifactIds:[...(row.artifactIds??[])],
    retrievalRepresentations:(row.retrievalRepresentations??[]).map(rep=>({artifactId:rep.artifactId,sourceRevisionId:rep.sourceRevisionId,authorityClass:rep.authorityClass,temporalClass:rep.temporalClass,unresolved:Boolean(rep.unresolved),provenance:cloneSafe(rep.provenance)})),
  }));
  return{
    kind:'Wave13LoreStudySurface',entries,artifacts:(x.artifacts??[]).map(a=>({artifactId:a.artifactId,artifactType:a.artifactType,sourceId:a.sourceId,sourceRevisionId:a.sourceRevisionId,temporalClass:a.temporalClass,authorityClass:a.authorityClass,freshness:a.freshness,unresolved:Boolean(a.unresolved),provenance:cloneSafe(a.provenance)})),
    conflicts:cloneSafe(x.conflicts??[]),lifecycle:cloneSafe(x.lifecycle??raw.lifecycle??{}),revision:raw.hierarchyRevision??raw.revision??null,
    retrievalReady:entries.filter(e=>e.learnedRevisionId&&e.freshness==='CURRENT'&&e.retrievalRepresentations.length>0).length,
  };
}

function normalizeResources(raw){
  const rows=Array.isArray(raw)?raw:Array.isArray(raw?.resources)?raw.resources:Array.isArray(raw?.profiles)?raw.profiles:raw&&typeof raw==='object'?[raw]:[];
  return rows.map((row,index)=>{
    const id=resourceId(row)??'resource:'+index;const health=String(row.providerHealth??row.health??row.state??'UNAVAILABLE').toUpperCase();
    const available=row.available!==false&&String(row.availability??'AVAILABLE').toUpperCase()!=='UNAVAILABLE';
    const connected=row.connected??row.mounted??(available&&!['UNAVAILABLE','DISCONNECTED'].includes(health));
    return deepFreeze({id,kind:String(row.kind??row.resourceKind??(row.capabilities?.includes?.('SEMANTIC_JUDGMENT')?'JEV':'SIDECAR')).toUpperCase(),providerId:row.providerId??null,modelId:row.modelId??null,workerId:row.workerId??null,local:Boolean(row.local),health,availability:row.availability??(available?'AVAILABLE':'UNAVAILABLE'),connected:Boolean(connected),capabilities:[...(row.capabilities??[])],placements:[...(row.placements??[])],currentLoad:Number(row.currentLoad??0),concurrencyCapacity:Number(row.concurrencyCapacity??row.maxConcurrency??1),lastError:row.lastError??row.reason??null});
  });
}
function normalizeConfiguration(row,index=0){return deepFreeze({id:text(row?.id??row?.configurationId??row?.profileId)??'config:'+index,label:text(row?.label??row?.name??row?.id)??'Resource configuration',kind:text(row?.kind??row?.resourceKind)??'SIDECAR',endpoint:text(row?.endpoint),modelId:text(row?.modelId),local:Boolean(row?.local),capabilities:[...(row?.capabilities??[])]});}
function resourceId(row){return text(row?.id??row?.resourceId??row?.profileId??row?.providerProfileId??row?.workerId);}
function readerExported(x,key){return({
  choice:['readCognitiveChoice','readCognitiveChoiceReceipt'],truth:['readTruth','readTruthAssessment'],jev:['readJev','readJevDecisionReceipt'],gather:['readGather','readGatherReceipt'],seal:['readContextSeal','readContextSealReceipt','readSealReceipt'],
}[key]??[]).some(name=>typeof x?.[name]==='function');}
function stageFromSource(id,label,source,selection,{readerPresent=false,reason=null}={}){
  if(!source)return stage(id,label,readerPresent?OperatorProducerState.IDLE:OperatorProducerState.UNAVAILABLE,reason??(readerPresent?'No current owner data.':'Producer not connected.'),selection,null,readerPresent?'NO_DATA':'ASSEMBLY_CONTRACT_MISSING');
  const explicit=source.operationalState;if(explicit&&Object.values(OperatorProducerState).includes(explicit))return stage(id,label,explicit,reason??source.impact??source.reason,selection,source.freshness,source.errorCode??null,source);
  if(source.mode===ProductDataMode.DEGRADED||[Wave6Health.DEGRADED,Wave6Health.STALE,Wave6Health.BLOCKED].includes(source.health))return stage(id,label,OperatorProducerState.DEGRADED,reason??source.impact??source.reason,selection,source.freshness,source.errorCode??null,source);
  if(source.mode===ProductDataMode.UNAVAILABLE)return stage(id,label,readerPresent?OperatorProducerState.IDLE:OperatorProducerState.UNAVAILABLE,reason??source.reason??source.impact,selection,source.freshness,source.errorCode??null,source);
  if(source.health===Wave6Health.WORKING)return stage(id,label,OperatorProducerState.WORKING,reason??source.impact,selection,source.freshness,null,source);
  if(source.health===Wave6Health.IDLE)return stage(id,label,OperatorProducerState.IDLE,reason??source.impact,selection,source.freshness,null,source);
  return stage(id,label,OperatorProducerState.LIVE,reason??source.impact??'Current owner state available.',selection,source.freshness,null,source);
}
function stage(id,label,stateValue,reason,selection,freshness,errorCode,source=null){return deepFreeze({id,label,state:stateValue,reason:String(reason??''),chatId:selection?.chatId??null,turnId:selection?.turnId??null,generationId:selection?.generationId??null,freshness:freshness??null,errorCode:errorCode??null,producer:source?.producer??null});}
function unavailable(label,reason,producer){return deepFreeze({source:createProductSourceStatus({mode:ProductDataMode.UNAVAILABLE,health:Wave6Health.UNAVAILABLE,label,operationalState:OperatorProducerState.UNAVAILABLE,impact:label+' is unavailable.',reason,producer,connected:false}),data:null});}
function waiting(label,reason,producer,selection){return deepFreeze({source:createProductSourceStatus({mode:ProductDataMode.LIVE,health:Wave6Health.IDLE,label,operationalState:OperatorProducerState.WAITING_FOR_TURN,impact:reason,producer,connected:true,selection}),data:null});}
function idle(label,reason,producer,selection){return deepFreeze({source:createProductSourceStatus({mode:ProductDataMode.LIVE,health:Wave6Health.IDLE,label,operationalState:OperatorProducerState.IDLE,impact:reason,producer,connected:true,selection}),data:null});}
function degraded(label,impact,producer,selection,error,data=null){return deepFreeze({source:createProductSourceStatus({mode:ProductDataMode.DEGRADED,health:Wave6Health.DEGRADED,label,operationalState:OperatorProducerState.DEGRADED,impact,reason:String(error?.message??error??''),producer,connected:true,selection,errorCode:error?.code??'READ_ERROR'}),data:cloneSafe(data)});}
function reasonOf(raw){return Array.isArray(raw?.health?.reasons)?raw.health.reasons.join(', '):text(raw?.reason??raw?.error??'')??'';}
function revisionOf(raw){return raw?.revision??raw?.receiptRevision??raw?.sourceRevisionId??raw?.learnedRevisionId??null;}
function freshnessOf(raw){return raw?.freshness??raw?.revisionFence?.freshness??null;}
function assertSelection(raw,selection,label,{allowMissingIdentity=false}={}){
  const x=raw?.data??raw??{};
  for(const key of ['chatId','turnId','generationId','correlationId']){
    const expected=selection?.[key],actual=x?.[key]??x?.metadata?.[key];
    if(expected==null||actual==null){if(!allowMissingIdentity&&expected!=null&&actual==null)continue;else continue;}
    if(String(expected)!==String(actual)){const e=new Error(label+' belongs to '+key+' '+actual+', not selected '+expected);e.code='LIVE_RECEIPT_IDENTITY_MISMATCH';throw e;}
  }
}
