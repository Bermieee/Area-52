import { ProductPresentationState } from './wave5-product-model.js';
import { ProductDataMode, Wave6Health, createProductSourceStatus, deepFreeze, clone, normalizeWave6Health, assertFixtureNotLive } from './wave6-contracts.js';

const required=(fn,name)=>{if(typeof fn!=='function')throw new TypeError(`${name} is required`);return fn;};
const optional=(fn)=>typeof fn==='function'?fn:null;
const valueOfField=(field)=>field&&typeof field==='object'&&'value'in field?field.value:field;
const idOf=(x,...keys)=>{for(const key of keys){const value=x?.[key];if(typeof value==='string'&&value)return value;}return null;};

export class SceneProductionUIAdapter{
  constructor({readModel,subscribe=null}={}){this.readModel=required(readModel,'SceneProductionUIAdapter.readModel');this.subscribeFn=optional(subscribe);this.kind='SceneProductionUIAdapter';}
  read(){
    const model=this.readModel();
    if(!model)return unavailable('Scene','Scene read model is not connected.');
    if(model.kind!=='SceneUiReadModel')return degraded('Scene','Scene producer returned an unsupported read-model shape.',{rawKind:model.kind??null});
    const location=valueOfField(model.location),time=valueOfField(model.narrativeTime),atmosphere=model.atmosphere;
    const health=normalizeWave6Health(model.health?.state??model.health?.productHealth??model.health?.generalStatus,{fallback:Wave6Health.READY});
    const mode=health===Wave6Health.UNAVAILABLE?ProductDataMode.UNAVAILABLE:[Wave6Health.DEGRADED,Wave6Health.STALE,Wave6Health.BLOCKED].includes(health)?ProductDataMode.DEGRADED:ProductDataMode.LIVE;
    return deepFreeze({
      source:createProductSourceStatus({mode,health,label:'Scene',impact:impactForScene(health),reason:(model.health?.reasons??[]).join(', '),producer:'SceneUiReadModel',revision:model.revision}),
      data:{
        id:model.sceneId,revision:model.revision,lifecycle:model.lifecycle,title:sceneTitle(location,model.sceneId),
        location:normalizeLocation(location),narrativeTime:normalizeTime(time),cast:(model.activeCast??[]).map(character),
        objects:(model.objects??[]).map(objectState),activeThreads:(model.activeThreads??[]).map(threadLabel),
        atmosphere:atmosphere?{label:atmosphereLabel(atmosphere),authority:atmosphere.authority??'INFERRED',inferred:Boolean(atmosphere.inferred),canonical:Boolean(atmosphere.canonical),evidenceRefs:[...(atmosphere.evidenceRefs??[])]}:null,
        boundary:normalizeBoundary(model.boundaryState),relationshipToPrior:model.relationshipToPrior??null,
        latestEpisodeRef:clone(model.latestEpisodeRef),latestDeltaSummary:clone(model.latestDeltaSummary),
        prefetchState:clone(model.prefetchState??{active:[],count:0}),uncertainFields:[...(model.uncertainFields??[])],
        provenanceRefs:[...(model.provenanceRefs??[])],diagnosticRefs:clone(model.diagnosticRefs??{}),
      },
    });
  }
  subscribe(handler){return this.subscribeFn?this.subscribeFn(handler):()=>{};}
}

export class RuntimeProductionUIAdapter{
  constructor(adapter=null){this.adapter=adapter;this.kind='RuntimeProductionUIAdapter';}
  read(){
    if(!this.adapter?.getTelemetrySummary)return unavailable('Runtime','Runtime telemetry producer is not connected.');
    try{
      const x=this.adapter.getTelemetrySummary();
      const health=x.blockedRecoveringWork>0?Wave6Health.DEGRADED:x.hotActivity+x.deepActivity>0?Wave6Health.WORKING:Wave6Health.READY;
      return deepFreeze({source:createProductSourceStatus({mode:health===Wave6Health.DEGRADED?ProductDataMode.DEGRADED:ProductDataMode.LIVE,health,label:'Runtime',impact:health===Wave6Health.DEGRADED?'Some cognition is blocked or recovering; generation may continue with reduced assistance.':'Runtime work is available.',producer:'RuntimeUIAdapter'}),data:clone(x)});
    }catch(error){return degraded('Runtime','Runtime telemetry could not be read.',{error:String(error?.message??error)});}
  }
  subscribe(handler){return this.adapter?.subscribeRuntime?.(handler)??(()=>{});}
  getLedgerPage(options){return this.adapter?.getLedgerPage?.(options)??{items:[],total:0};}
  getLedgerTaskDetail(id){return this.adapter?.getLedgerTaskDetail?.(id)??null;}
  getRecoveryPage(options){return this.adapter?.getRecoveryPage?.(options)??{items:[],total:0};}
}

export class CoprocessorProductionUIAdapter{
  constructor(bridge=null){this.bridge=bridge;this.kind='CoprocessorProductionUIAdapter';}
  read(){
    if(!this.bridge)return unavailable('Coprocessor','Coprocessor telemetry producer is not connected.');
    try{
      if(typeof this.bridge.snapshot==='function'){
        const x=this.bridge.snapshot();
        const stale=Number(x.staleDrop??0),fallback=Number(x.fallback??0),health=stale||fallback?Wave6Health.DEGRADED:Wave6Health.READY;
        return deepFreeze({source:createProductSourceStatus({mode:health===Wave6Health.DEGRADED?ProductDataMode.DEGRADED:ProductDataMode.LIVE,health,label:'Coprocessor',impact:health===Wave6Health.DEGRADED?'Generation continues; some cognitive assistance used fallback or was dropped stale.':'Cognitive specialists are available.',producer:'CoprocessorTelemetry'}),data:clone(x)});
      }
      if(typeof this.bridge.getCoprocessorTelemetry==='function'){
        const x=this.bridge.getCoprocessorTelemetry();
        if(!x)return deepFreeze({source:createProductSourceStatus({mode:ProductDataMode.LIVE,health:Wave6Health.IDLE,label:'Coprocessor',impact:'No active cognitive swarm.',producer:'CoprocessorUIAdapter'}),data:null});
        const workers=x.workers??[],degraded=workers.some(w=>w.fallbackUsed||w.freshness==='STALE'||w.validationResult==='FAILED');
        return deepFreeze({source:createProductSourceStatus({mode:degraded?ProductDataMode.DEGRADED:ProductDataMode.LIVE,health:degraded?Wave6Health.DEGRADED:Wave6Health.WORKING,label:'Coprocessor',impact:degraded?'Generation continues with contained fallback/stale work.':'Cognitive specialists are active.',producer:'CoprocessorUIAdapter'}),data:clone(x)});
      }
      return unavailable('Coprocessor','No supported Coprocessor telemetry read method is connected.');
    }catch(error){return degraded('Coprocessor','Coprocessor telemetry could not be read.',{error:String(error?.message??error)});}
  }
  subscribe(handler){
    if(typeof this.bridge?.subscribe==='function')return this.bridge.subscribe(handler);
    if(typeof this.bridge?.subscribeCoprocessor==='function')return this.bridge.subscribeCoprocessor(handler);
    return ()=>{};
  }
}

export class PromptPlanProductionUIAdapter{
  constructor({readPlan,readSealReceipt=null,readContextReceipt=null,readIntegrityReceipt=null}={}){
    this.readPlan=optional(readPlan);this.readSealReceipt=optional(readSealReceipt);this.readContextReceipt=optional(readContextReceipt);this.readIntegrityReceipt=optional(readIntegrityReceipt);this.kind='PromptPlanProductionUIAdapter';
  }
  read(){
    if(!this.readPlan)return unavailable('PromptPlan','Adaptive Context / PromptPlan read producer is not connected.');
    try{
      const plan=this.readPlan();if(!plan)return unavailable('PromptPlan','No completed PromptPlan is available.');
      if(!plan.promptPlanId)return degraded('PromptPlan','PromptPlan producer returned an unsupported contract.',{kind:plan.kind??null});
      const seal=this.readSealReceipt?.()??null,receipt=this.readContextReceipt?.()??null,integrity=this.readIntegrityReceipt?.()??null;
      const segments=plan.segments??[],reuse=segments.filter(x=>x.reuseState==='NO_CHANGE').length,rebuild=segments.filter(x=>x.reuseState==='REBUILD'||x.reuseState==='PATCH').length;
      const allocated=Number(plan.budget?.allocated??sum(plan.sections??[],'allocatedTokens')),total=Number(plan.budget?.total??plan.budget?.available??allocated);
      const health=plan.status==='READY'&&(!seal||seal.sealedState!==false)?Wave6Health.READY:Wave6Health.DEGRADED;
      return deepFreeze({
        source:createProductSourceStatus({mode:health===Wave6Health.READY?ProductDataMode.LIVE:ProductDataMode.DEGRADED,health,label:'Context Delivery',impact:health===Wave6Health.READY?'Generation context is prepared and revision-fenced.':'Context delivery is degraded; inspect omissions, fallback, or seal state.',producer:'PromptPlan/ContextSeal',revision:plan.promptPlanId}),
        data:{
          promptPlanId:plan.promptPlanId,generationId:plan.generationId??receipt?.generationId??null,turnId:plan.turnId??seal?.turnId??null,
          totalTokens:allocated,budgetTotal:total,budgetUsage:total?allocated/total:0,reusedSegments:reuse,updatedSegments:rebuild,
          dropped:[...(plan.dropped??[])],deferred:[...(plan.deferred??[])],segments:clone(segments),sections:clone(plan.sections??[]),
          modelProfileId:plan.modelProfileId??null,ordering:[...(plan.ordering??[])],cacheDecisions:clone(plan.cacheDecisions??[]),
          fallbackDecisions:[...(plan.fallbackDecisions??[])],integrityReceipt:clone(integrity),seal:clone(seal),contextReceipt:clone(receipt),
          sourceRevisionDependencies:[...(plan.sourceRevisionDependencies??[])],worldRevision:plan.worldRevision??null,sceneRevision:plan.sceneRevision??null,status:plan.status??null,
        },
      });
    }catch(error){return degraded('PromptPlan','Context delivery read failed.',{error:String(error?.message??error)});}
  }
}

export class ForensicsProductionUIAdapter{
  constructor({listTransactions=null,listBundles=null}={}){this.listTransactions=optional(listTransactions);this.listBundles=optional(listBundles);this.kind='ForensicsProductionUIAdapter';}
  read({limit=100}={}){
    if(!this.listTransactions&&!this.listBundles)return unavailable('Forensics','Cognitive transaction / forensic read producer is not connected.');
    try{
      const transactions=(this.listTransactions?.()??[]).slice(-Math.max(1,limit));const bundles=(this.listBundles?.()??[]).slice(-Math.max(1,limit));
      return deepFreeze({source:createProductSourceStatus({mode:ProductDataMode.LIVE,health:Wave6Health.READY,label:'Forensics',impact:'Decision and context trails are available for inspection.',producer:'CognitiveTransactionLedger/ForensicBundle'}),data:{transactions:clone(transactions),bundles:clone(bundles)}});
    }catch(error){return degraded('Forensics','Forensic read failed.',{error:String(error?.message??error)});}
  }
}

export class Wave6ProductAdapter{
  constructor({scene=null,runtime=null,coprocessor=null,promptPlan=null,forensics=null,story=null,characters=null,lore=null,memory=null,world=null,presentationState=null,fixture=null}={}){
    this.sources={scene,runtime,coprocessor,promptPlan,forensics,story,characters,lore,memory,world};this.presentationState=presentationState??new ProductPresentationState();this.fixture=fixture;
  }
  getDetailLevel(){return this.presentationState.get();}
  setDetailLevel(level){return this.presentationState.set(level);}
  subscribeDetailLevel(listener){return this.presentationState.subscribe(listener);}
  getSnapshot(){
    if(this.fixture){
      const status=createProductSourceStatus({mode:ProductDataMode.FIXTURE,health:Wave6Health.READY,label:'Fixture',impact:'Deterministic test/demo data only.',producer:'Wave6 fixture'});
      assertFixtureNotLive(status);return deepFreeze({...clone(this.fixture),wave6:{mode:ProductDataMode.FIXTURE,sources:{fixture:status}}});
    }
    const scene=read(this.sources.scene),runtime=read(this.sources.runtime),coprocessor=read(this.sources.coprocessor),promptPlan=read(this.sources.promptPlan),forensics=read(this.sources.forensics);
    const story=readGeneric('Story',this.sources.story),characters=readGeneric('Characters',this.sources.characters),lore=readGeneric('Lore',this.sources.lore),memory=readGeneric('Memory',this.sources.memory),world=readGeneric('World',this.sources.world);
    const sources={scene:scene.source,runtime:runtime.source,coprocessor:coprocessor.source,promptPlan:promptPlan.source,forensics:forensics.source,story:story.source,characters:characters.source,lore:lore.source,memory:memory.source,world:world.source};
    for(const x of Object.values(sources))assertFixtureNotLive(x);
    const attention=Object.entries(sources).filter(([name,s])=>['scene','runtime','coprocessor','promptPlan'].includes(name)&&[Wave6Health.DEGRADED,Wave6Health.STALE,Wave6Health.BLOCKED,Wave6Health.UNAVAILABLE].includes(s.health)).map(([name,s])=>({id:`source:${name}`,source:name,status:s.statusToken,title:s.label,message:s.impact||s.reason}));
    const overall=aggregateHealth([scene.source,runtime.source,coprocessor.source,promptPlan.source]);
    return deepFreeze({
      wave6:{mode:aggregateMode(Object.values(sources)),sources,attention},
      story:story.data,scene:scene.data,characters:characters.data,lore:lore.data,memory:memory.data,world:world.data,
      runtime:runtime.data,coprocessor:coprocessor.data,promptPlan:promptPlan.data,forensics:forensics.data,
      brain:{overall,components:Object.entries(sources).filter(([n])=>['scene','runtime','coprocessor','promptPlan'].includes(n)).map(([id,s])=>({id,label:s.label,status:s.health,detail:s.impact||s.reason,mode:s.mode}))},
    });
  }
}

function read(source){
  if(!source)return unavailable('Subsystem','Producer is not connected.');
  if(typeof source.read==='function')return source.read();
  return unavailable('Subsystem','Producer does not expose read().');
}
function readGeneric(label,source){
  if(!source)return unavailable(label,`${label} producer is not connected.`);
  try{
    const data=typeof source==='function'?source():typeof source.read==='function'?source.read():null;
    if(data?.source&&'data'in data)return data;
    if(data==null)return unavailable(label,`No ${label} read model is available.`);
    return deepFreeze({source:createProductSourceStatus({mode:ProductDataMode.LIVE,health:Wave6Health.READY,label,impact:`${label} state is available.`,producer:`${label} read model`}),data:clone(data)});
  }catch(error){return degraded(label,`${label} read failed.`,{error:String(error?.message??error)});}
}
function unavailable(label,reason){return deepFreeze({source:createProductSourceStatus({mode:ProductDataMode.UNAVAILABLE,health:Wave6Health.UNAVAILABLE,label,impact:`${label} is unavailable.`,reason,connected:false}),data:null});}
function degraded(label,impact,extra={}){return deepFreeze({source:createProductSourceStatus({mode:ProductDataMode.DEGRADED,health:Wave6Health.DEGRADED,label,impact,reason:extra.error??'',connected:true}),data:extra.raw??null});}
function aggregateHealth(statuses){if(statuses.length&&statuses.every(x=>x.health===Wave6Health.UNAVAILABLE))return'UNAVAILABLE';if(statuses.some(x=>x.health===Wave6Health.BLOCKED))return'BLOCKED';if(statuses.some(x=>x.health===Wave6Health.UNAVAILABLE))return'DEGRADED';if(statuses.some(x=>[Wave6Health.DEGRADED,Wave6Health.STALE].includes(x.health)))return'DEGRADED';if(statuses.some(x=>x.health===Wave6Health.WORKING))return'STUDYING';return'READY';}
function aggregateMode(statuses){if(statuses.length&&statuses.every(x=>x.mode===ProductDataMode.UNAVAILABLE))return ProductDataMode.UNAVAILABLE;if(statuses.some(x=>x.mode===ProductDataMode.DEGRADED))return ProductDataMode.DEGRADED;return ProductDataMode.LIVE;}\nfunction sceneTitle(location,sceneId){const name=normalizeLocation(location);return name&&name!=='—'?name:`Scene ${sceneId}`;}
function normalizeLocation(x){if(x==null)return'—';if(typeof x==='string')return x;return x.name??x.location??x.label??x.id??'—';}
function normalizeTime(x){if(x==null)return'—';if(typeof x==='string')return x;return x.label??x.anchor??x.display??x.mode??'—';}
function character(x){if(typeof x==='string')return{id:x,name:x,state:'PRESENT'};const id=idOf(x,'characterId','characterRef','ref','id')??'unknown';return{id,name:x.name??id,state:x.state??x.presence??'PRESENT',authority:x.authority??x.observationClass??'OBSERVED'};}
function objectState(x){if(typeof x==='string')return{id:x,name:x,state:'PRESENT'};const id=idOf(x,'objectId','objectRef','ref','id')??'unknown';return{id,name:x.name??id,state:x.state??'PRESENT',holderId:x.holderId??null,authority:x.authority??x.observationClass??'OBSERVED'};}
function threadLabel(x){return typeof x==='string'?x:x?.label??x?.objective??x?.threadId??x?.id??'Thread';}
function atmosphereLabel(a){const v=valueOfField(a);if(v==null)return'No inferred atmosphere';if(typeof v==='string')return v;if(v.label)return v.label;const dims=Object.entries(v).filter(([,x])=>x&&typeof x==='object'&&Number.isFinite(Number(x.score))).sort((a,b)=>Number(b[1].score)-Number(a[1].score));return dims.length?dims.slice(0,2).map(([k])=>k.replace(/_/g,' ')).join(' · '):'Inferred atmosphere';}
function normalizeBoundary(x){const v=valueOfField(x);if(v==null)return{state:'STABLE',confidence:null,supportingSignals:[],contradictoryEvidence:[]};if(typeof v==='string')return{state:v,confidence:null,supportingSignals:[],contradictoryEvidence:[]};return{state:v.state??v.status??v.type??'STABLE',confidence:v.confidence??null,supportingSignals:[...(v.supportingSignals??[])],contradictoryEvidence:[...(v.contradictoryEvidence??[])]};}
function impactForScene(health){if(health===Wave6Health.DEGRADED)return'Scene state is usable with unresolved or degraded fields.';if(health===Wave6Health.STALE)return'Scene state is stale; generation should rely on fresh context fences.';if(health===Wave6Health.BLOCKED)return'Scene cognition requires rebuild before it is trustworthy.';if(health===Wave6Health.UNAVAILABLE)return'Scene cognition is unavailable.';return'Current Scene state is available.';}
function sum(rows,key){return rows.reduce((n,x)=>n+Number(x?.[key]??0),0);}
