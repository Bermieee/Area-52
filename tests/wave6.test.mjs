import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ActionRouter,
  BrainPulseModel,
  CoprocessorProductionUIAdapter,
  ForensicsProductionUIAdapter,
  FrontFaceDensity,
  FrontFaceMode,
  FrontFacePresentationState,
  HostAdjacentMountAdapter,
  ProductDataMode,
  ProductDetailLevel,
  ProductPresentationState,
  PromptPlanProductionUIAdapter,
  RenderScheduler,
  RuntimeProductionUIAdapter,
  SceneProductionUIAdapter,
  SignalHub,
  UIStateStore,
  Wave6Health,
  Wave6ProductAdapter,
  WorkspaceRegistry,
  assertFixtureNotLive,
  authorityDescriptor,
  createAuthorityPill,
  createKnowledgeActionBar,
  createProductHealthSurface,
  createProductSourceStatus,
  createWave6ProductInterface,
  healthStatusToken,
  normalizeWave6Health,
  registerWave6FrontFaceWorkspaces,
  resolveResponsiveMode,
  ResponsiveMode,
  computeVirtualWindow,
} from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

class Wave6Document extends FakeDocument {
  createDocumentFragment(){ return new FakeNode('fragment',this); }
}
const textOf=(node)=>[node?.textContent??'',...(node?.children??[]).map(textOf)].filter(Boolean).join(' ');
const walk=(node)=>[node,...(node?.children??[]).flatMap(walk)];
const memoryStore=()=>{
  const map=new Map();
  return {
    getItem(k){return map.has(k)?map.get(k):null;},
    setItem(k,v){map.set(k,String(v));},
    removeItem(k){map.delete(k);},
    map,
  };
};
const sceneReadModel=()=>({
  kind:'SceneUiReadModel',contractVersion:'1.0.0',sceneId:'scene-live-7',revision:7,lifecycle:'OPEN',
  sourceRevisionRefs:['src:7'],
  location:{value:{location:'East Tower — Workshop'},observationClass:'OBSERVED',evidenceRefs:['e:loc']},
  narrativeTime:{value:{label:'Late evening'},observationClass:'OBSERVED',evidenceRefs:['e:time']},
  activeCast:[{characterId:'Akira',name:'Akira',state:'PRESENT',observationClass:'OBSERVED'},{characterId:'Nanahoshi',name:'Nanahoshi',state:'PRESENT',observationClass:'OBSERVED'},{characterId:'Darius',name:'Darius',state:'MENTIONED_ONLY',observationClass:'OBSERVED'}],
  activeThreads:['Recalibrate summoning geometry','Review 47 questions'],
  objects:[{objectId:'circle-notes',name:'Circle notes',state:'PRESENT',observationClass:'OBSERVED'},{objectId:'old-key',name:'Old key',state:'MENTIONED_ONLY',observationClass:'OBSERVED'}],
  atmosphere:{value:{tension:{score:.55},trust:{score:.72}},observationClass:'INFERRED',authority:'INFERRED_CONTEXT',canonical:false,inferred:true,evidenceRefs:['e:vibe']},
  boundaryState:{value:{state:'STABLE',confidence:.82,supportingSignals:['same-room'],contradictoryEvidence:[]}},
  relationshipToPrior:'CONTINUES',latestEpisodeRef:{artifactId:'ep:6',revision:6},
  latestDeltaSummary:{fromRevision:6,toRevision:7,changedFields:['activeThreads'],reason:'NEW_EVIDENCE',fullRefreshRequired:false},
  uncertainFields:[],prefetchState:{active:[{recommendationId:'pref:1'}],count:1},
  health:{state:'READY',productHealth:'READY',generalStatus:'ready',reasons:[]},
  provenanceRefs:['e:loc','e:time','e:vibe'],diagnosticRefs:{evidenceRefs:['e:loc'],eventIds:['evt:7']},
  authority:'READ_ONLY',authorityGranted:false,mutationAuthority:false,settlementAuthority:false,contextSealBypass:false,
});
const degradedScene=()=>({...sceneReadModel(),revision:8,uncertainFields:['location'],health:{state:'DEGRADED',productHealth:'DEGRADED',generalStatus:'warning',reasons:['UNRESOLVED_FIELDS']}});
const runtimeAdapter=(subscribe=null)=>({
  getTelemetrySummary(){return{mode:'FOREGROUND GENERATION',hotActivity:2,deepActivity:3,utilization:{L0:1,L1:1,L2:1,L3:1,L4:1},queueDepth:{L0:0,L1:1,L2:2,L3:0,L4:0},reservedForegroundCapacity:{CPU:1},borrowedBackgroundCapacity:1,activeWorkerCount:5,parkedWorkerCount:1,queuedObligations:3,blockedRecoveringWork:0,activeBatches:2,foregroundDeadlineState:'ACTIVE'};},
  subscribeRuntime(handler){return subscribe?.(handler)??(()=>{});},
  getLedgerPage(){return{items:[{id:'task:1'}],total:1};},
  getLedgerTaskDetail(id){return{id,taskType:'LORE_STUDY'};},
  getRecoveryPage(){return{items:[],total:0};},
});
const degradedRuntimeAdapter=()=>({...runtimeAdapter(),getTelemetrySummary(){return{...runtimeAdapter().getTelemetrySummary(),blockedRecoveringWork:2};}});
const coprocessorTelemetry=(subscribe=null)=>({
  snapshot(){return{totalEvents:12,warm:{hit:5,miss:1},retrieval:{HIGH:3,MIXED:1,LOW:0},precision:{requests:2},retry:0,fallback:1,staleDrop:2,resultDestinations:{FOREGROUND:3,BACKGROUND:2},providerHealth:{}};},
  subscribe(handler){return subscribe?.(handler)??(()=>{});},
});
const promptPlan=()=>({
  promptPlanId:'prompt-plan:7',generationId:'gen:7',turnId:'turn:7',modelProfileId:'CACHE_STABLE',status:'READY',
  budget:{total:32000,available:30000,allocated:27400,remaining:2600},
  sections:[{slot:'CURRENT_SCENE',allocatedTokens:4400,representation:'RICH'},{slot:'ACTIVE_THREADS',allocatedTokens:1800,representation:'COMPACT'}],
  segments:[{segmentId:'seg:scene',segmentKey:'CURRENT_SCENE',reuseState:'NO_CHANGE',cacheEligible:true},{segmentId:'seg:threads',segmentKey:'ACTIVE_THREADS',reuseState:'PATCH',cacheEligible:true}],
  dropped:[{slot:'OPTIONAL_STYLE',reason:'OPTIONAL_BUDGET_PRESSURE'}],deferred:[{slot:'HISTORICAL_SUPPORT',reason:'OPTIONAL_DEFERRED_BY_BUDGET'}],
  ordering:['CURRENT_SCENE','ACTIVE_THREADS'],cacheDecisions:[{segmentId:'seg:scene',cacheEligible:true}],fallbackDecisions:[],
  sourceRevisionDependencies:['src:7'],worldRevision:44,sceneRevision:7,
});
const sealReceipt=()=>({kind:'ContextSealReceipt',id:'seal:7',turnId:'turn:7',correlationId:'corr:7',packetId:'packet:7',packetHash:'hash',sourceRevisionIds:['src:7'],worldRevision:44,sceneRevision:7,admittedResultIds:['r1'],rejectedResultIds:[],staleResultIds:[],fallbackState:'NONE',sequence:7,sealedState:true,dependencies:['src:7']});
const contextReceipt=()=>({generationId:'gen:7',finalContextSize:27400,reuseRatio:.5,primarySections:['CURRENT_SCENE','ACTIVE_THREADS'],requiredOmissions:[],optionalLateResults:1,contextSealValid:true});
const forensics=()=>({transactions:[
  {transactionId:'tx:1',sequence:1,transactionType:'SOURCE_REVISION_ADMITTED',reasonCode:'SOURCE_CURRENT'},
  {transactionId:'tx:2',sequence:2,transactionType:'PROPOSAL_CREATED',reasonCode:'SCENE_CHANGE'},
],bundles:[{bundleId:'fb:1',turnId:'turn:7',generationId:'gen:7',complete:true}]});
const generic=(name)=>()=>({kind:`${name}ReadModel`,status:'READY',count:2,items:[`${name} A`,`${name} B`]});

function productionAdapter({scene=sceneReadModel,runtime=runtimeAdapter(),coprocessor=coprocessorTelemetry(),withPrompt=true,withForensics=true,allProduct=true}={}){
  return new Wave6ProductAdapter({
    scene:scene?new SceneProductionUIAdapter({readModel:scene}):null,
    runtime:new RuntimeProductionUIAdapter(runtime),
    coprocessor:new CoprocessorProductionUIAdapter(coprocessor),
    promptPlan:new PromptPlanProductionUIAdapter(withPrompt?{readPlan:promptPlan,readSealReceipt:sealReceipt,readContextReceipt:contextReceipt,readIntegrityReceipt:()=>({valid:true})}:{}),
    forensics:new ForensicsProductionUIAdapter(withForensics?{listTransactions:()=>forensics().transactions,listBundles:()=>forensics().bundles}:{}),
    story:allProduct?()=>({title:'Akira Kagenou World'}):null,
    characters:allProduct?generic('Characters'):null,lore:allProduct?generic('Lore'):null,memory:allProduct?generic('Memory'):null,world:allProduct?generic('World'):null,
    presentationState:new ProductPresentationState(),
  });
}

test('Wave 6 source modes are explicit and fixture cannot masquerade as LIVE',()=>{
  for(const mode of Object.values(ProductDataMode))assert.equal(createProductSourceStatus({mode}).mode,mode);
  assert.throws(()=>assertFixtureNotLive({mode:ProductDataMode.LIVE,fixture:true}),/Fixture-backed state cannot report LIVE/);
  assert.equal(assertFixtureNotLive(createProductSourceStatus({mode:ProductDataMode.FIXTURE})),true);
});

test('canonical health grammar maps backend/product states into one Wave 6 vocabulary',()=>{
  assert.equal(normalizeWave6Health('ACTIVE'),Wave6Health.WORKING);
  assert.equal(normalizeWave6Health('DEGRADED'),Wave6Health.DEGRADED);
  assert.equal(normalizeWave6Health('offline'),Wave6Health.UNAVAILABLE);
  assert.equal(healthStatusToken('STALE'),'stale');
});

test('authority grammar is text/glyph/status based and confidence is not authority',()=>{
  const inferred=authorityDescriptor('INFERRED_CONTEXT'),current=authorityDescriptor('CURRENT'),history=authorityDescriptor('HISTORICAL');
  assert.equal(inferred.label,'INFERRED');assert.equal(inferred.glyph,'✦');assert.equal(inferred.status,'inferred');
  assert.equal(current.label,'CURRENT');assert.equal(history.glyph,'◷');assert.equal('confidence' in inferred,false);
  const doc=new Wave6Document(),pill=createAuthorityPill(doc,'UNRESOLVED');
  assert.match(pill.textContent,/UNRESOLVED/);assert.match(pill.attributes['aria-label'],/Competing evidence/);
});

test('Scene production adapter consumes SceneUiReadModel and preserves read-only epistemology',()=>{
  const a=new SceneProductionUIAdapter({readModel:sceneReadModel}),r=a.read();
  assert.equal(r.source.mode,ProductDataMode.LIVE);assert.equal(r.data.id,'scene-live-7');assert.equal(r.data.location,'East Tower — Workshop');
  assert.equal(r.data.cast.find(x=>x.id==='Darius').state,'MENTIONED_ONLY');
  assert.equal(r.data.objects.find(x=>x.id==='old-key').state,'MENTIONED_ONLY');
  assert.equal(r.data.atmosphere.inferred,true);assert.equal(r.data.atmosphere.canonical,false);assert.match(r.data.atmosphere.authority,/INFERRED/);
  assert.deepEqual(r.data.provenanceRefs,['e:loc','e:time','e:vibe']);
});

test('Scene degraded read model becomes impact-first DEGRADED rather than fake healthy',()=>{
  const r=new SceneProductionUIAdapter({readModel:degradedScene}).read();
  assert.equal(r.source.mode,ProductDataMode.DEGRADED);assert.equal(r.source.health,Wave6Health.DEGRADED);assert.match(r.source.impact,/unresolved|degraded/i);
});

test('unsupported Scene producer contract degrades visibly instead of guessing',()=>{
  const r=new SceneProductionUIAdapter({readModel:()=>({kind:'FutureSceneShape'})}).read();
  assert.equal(r.source.mode,ProductDataMode.DEGRADED);assert.match(r.source.impact,/unsupported/i);
});

test('Runtime production adapter presents useful impact before machinery',()=>{
  const live=new RuntimeProductionUIAdapter(runtimeAdapter()).read(),bad=new RuntimeProductionUIAdapter(degradedRuntimeAdapter()).read();
  assert.equal(live.source.mode,ProductDataMode.LIVE);assert.equal(live.data.hotActivity,2);assert.equal(live.data.deepActivity,3);
  assert.equal(bad.source.mode,ProductDataMode.DEGRADED);assert.match(bad.source.impact,/reduced assistance/i);
});

test('missing Runtime producer is honest UNAVAILABLE',()=>{
  const r=new RuntimeProductionUIAdapter(null).read();assert.equal(r.source.mode,ProductDataMode.UNAVAILABLE);assert.match(r.source.reason,/not connected/i);
});

test('Coprocessor production adapter consumes sanitized telemetry summary and reports contained fallback/stale impact',()=>{
  const r=new CoprocessorProductionUIAdapter(coprocessorTelemetry()).read();
  assert.equal(r.source.mode,ProductDataMode.DEGRADED);assert.equal(r.data.warm.hit,5);assert.equal(r.data.staleDrop,2);assert.match(r.source.impact,/fallback|stale/i);
});

test('PromptPlan production adapter projects budget reuse omissions cache and seal without reimplementing compiler',()=>{
  const r=new PromptPlanProductionUIAdapter({readPlan:promptPlan,readSealReceipt:sealReceipt,readContextReceipt:contextReceipt,readIntegrityReceipt:()=>({valid:true})}).read();
  assert.equal(r.source.mode,ProductDataMode.LIVE);assert.equal(r.data.totalTokens,27400);assert.equal(r.data.budgetTotal,32000);assert.equal(r.data.reusedSegments,1);assert.equal(r.data.updatedSegments,1);
  assert.equal(r.data.dropped.length,1);assert.equal(r.data.deferred.length,1);assert.equal(r.data.seal.sealedState,true);assert.equal(r.data.contextReceipt.contextSealValid,true);
});

test('PromptPlan and Context Receipt remain unavailable when Core producer is not bound',()=>{
  const r=new PromptPlanProductionUIAdapter({}).read();assert.equal(r.source.mode,ProductDataMode.UNAVAILABLE);assert.match(r.source.reason,/not connected/i);
  const noReceipt=new PromptPlanProductionUIAdapter({readPlan:promptPlan,readSealReceipt:sealReceipt}).read();assert.equal(noReceipt.data.contextReceipt,null);
});

test('Forensics adapter consumes Cognitive Transaction Ledger and Forensic Bundle read seams',()=>{
  const r=new ForensicsProductionUIAdapter({listTransactions:()=>forensics().transactions,listBundles:()=>forensics().bundles}).read();
  assert.equal(r.source.mode,ProductDataMode.LIVE);assert.equal(r.data.transactions.length,2);assert.equal(r.data.bundles[0].turnId,'turn:7');
});

test('production product snapshot never silently substitutes missing Memory Lore or World fixture data',()=>{
  const a=productionAdapter({allProduct:false}),s=a.getSnapshot();
  assert.equal(s.wave6.sources.memory.mode,ProductDataMode.UNAVAILABLE);assert.equal(s.wave6.sources.lore.mode,ProductDataMode.UNAVAILABLE);assert.equal(s.wave6.sources.world.mode,ProductDataMode.UNAVAILABLE);
  assert.equal(s.memory,null);assert.equal(s.lore,null);assert.equal(s.world,null);
});

test('all disconnected production sources make overall product availability UNAVAILABLE',()=>{
  const a=new Wave6ProductAdapter({presentationState:new ProductPresentationState()}),s=a.getSnapshot();
  assert.equal(s.wave6.mode,ProductDataMode.UNAVAILABLE);assert.equal(s.brain.overall,'UNAVAILABLE');
});

test('explicit fixture snapshot remains visibly FIXTURE and never reports live source state',()=>{
  const a=new Wave6ProductAdapter({fixture:{story:{title:'Demo'},brain:{overall:'READY'}}}),s=a.getSnapshot();
  assert.equal(s.wave6.mode,ProductDataMode.FIXTURE);assert.equal(s.wave6.sources.fixture.mode,ProductDataMode.FIXTURE);assert.equal(s.wave6.sources.fixture.fixture,true);
});

test('Front Face presentation persists UI-only state and clamps dimensions',()=>{
  const storage=memoryStore(),store=new UIStateStore({storage,namespace:'wave6-test'}),p=new FrontFacePresentationState({stateStore:store});
  p.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:5000,frontFaceDensity:FrontFaceDensity.COMFORTABLE,inspectorVisible:true,inspectorWidth:50,lastProductWorkspace:'brain'});
  const v=p.get();assert.equal(v.frontFaceMode,FrontFaceMode.EXPANDED);assert.equal(v.frontFaceWidth,960);assert.equal(v.inspectorWidth,240);assert.equal(v.lastProductWorkspace,'brain');
  const restored=new FrontFacePresentationState({stateStore:store}).get();assert.deepEqual(restored,v);assert.equal('sceneRevision' in restored,false);assert.equal('worldRevision' in restored,false);
});

test('1,000 collapse/expand cycles cannot mutate cognitive snapshot',()=>{
  const a=productionAdapter(),before=a.getSnapshot(),p=new FrontFacePresentationState();
  for(let i=0;i<1000;i++)p.toggle();
  const after=a.getSnapshot();assert.deepEqual(after,before);assert.equal(p.get().frontFaceMode,FrontFaceMode.COLLAPSED);
});

test('host-adjacent mount seam reserves collapsed/expanded widths and releases cleanly',()=>{
  const calls=[],h=new HostAdjacentMountAdapter({reserveWidth:(n)=>calls.push(['reserve',n]),releaseWidth:(n)=>calls.push(['release',n])});
  assert.equal(h.apply({mode:FrontFaceMode.COLLAPSED,width:620}),76);assert.equal(h.apply({mode:FrontFaceMode.EXPANDED,width:620}),620);h.destroy();
  assert.deepEqual(calls,[['reserve',76],['reserve',620],['release',620]]);
});

test('Wave 6 registers one shared set of product workspaces plus Advanced Forensics',()=>{
  const r=new WorkspaceRegistry();registerWave6FrontFaceWorkspaces(r,{adapter:productionAdapter()});
  assert.deepEqual(r.list({navigationLevel:'product'}).map(x=>x.id),['home','story','characters','lore','memory-product','world-product','brain']);
  assert.equal(r.get('forensics').navigation.level,'advanced');
});

test('Quick Dash and Expanded views use the same ApplicationShell runtime and never render a fake chat column',()=>{
  const doc=new Wave6Document(),root=new FakeNode('div',doc),storage=memoryStore(),stateStore=new UIStateStore({storage,namespace:'wave6-ui'});
  const ui=createWave6ProductInterface({root,stateStore,bridges:{
    scene:{readModel:sceneReadModel},runtimeAdapter:runtimeAdapter(),coprocessorTelemetry:coprocessorTelemetry(),
    promptPlan:{readPlan:promptPlan,readSealReceipt:sealReceipt,readContextReceipt:contextReceipt,readIntegrityReceipt:()=>({valid:true})},
    forensics:{listTransactions:()=>forensics().transactions,listBundles:()=>forensics().bundles},
    story:()=>({title:'Akira Kagenou World'}),characters:generic('Characters'),lore:generic('Lore'),memory:generic('Memory'),world:generic('World'),
  }});
  assert.equal(ui.presentation.get().frontFaceMode,FrontFaceMode.COLLAPSED);assert.match(textOf(ui.controller.nodes.quick),/Area-52/);assert.match(textOf(ui.controller.nodes.quick),/Brain/);assert.match(textOf(ui.controller.nodes.quick),/East Tower/);assert.match(textOf(ui.controller.nodes.quick),/Attention/);
  assert.equal(textOf(root).includes('Live Story Chat'),false);assert.equal(walk(root).some(n=>/chat/i.test(n.className)&&!String(n.className).includes('front-face')),false);
  const shellIdentity=ui.shell;ui.presentation.toggle();assert.equal(ui.presentation.get().frontFaceMode,FrontFaceMode.EXPANDED);assert.equal(ui.shell,shellIdentity);assert.equal(ui.controller.nodes.expanded.style.display,'');
  ui.destroy();assert.equal(root.children.length,0);
});

test('Quick Dash rerender cleans detached button listeners instead of accumulating them',()=>{
  const doc=new Wave6Document(),root=new FakeNode('div',doc),ui=createWave6ProductInterface({root,bridges:{scene:{readModel:sceneReadModel},runtimeAdapter:runtimeAdapter(),coprocessorTelemetry:coprocessorTelemetry()}});
  for(let i=0;i<200;i++){ui.signals.publish('TEST_WAVE6',{i});ui.scheduler.flush(i);}
  assert.ok(ui.controller.quickScope.size<=1);ui.destroy();assert.equal(ui.signals.listenerCount('*'),0);
});

test('Brain Pulse coalesces 5,000 raw lifecycle updates into one scheduled render and bounded product activity',()=>{
  let frame;const jobs=new Map();const scheduler=new RenderScheduler({requestFrame:(cb)=>{frame=cb;return 1;},cancelFrame(){}});
  const model=new BrainPulseModel({runtime:new RuntimeProductionUIAdapter(runtimeAdapter()),coprocessor:new CoprocessorProductionUIAdapter(coprocessorTelemetry()),scheduler,maxActivity:20});
  for(let i=0;i<5000;i++)model.ingestRuntime({type:'WORK_STARTED',payload:{taskId:`task-${i%64}`,workerId:`w-${i%64}`,layer:i%3?'L3':'L1'}});
  assert.equal(scheduler.pendingCount,1);assert.equal(model.pendingCount,64);frame(1);assert.equal(model.getSnapshot().activity.length,20);
});

test('2,000 Coprocessor activity updates coalesce and retain product meaning not provider identity',()=>{
  let frame;const scheduler=new RenderScheduler({requestFrame:(cb)=>{frame=cb;return 1;},cancelFrame(){}});const model=new BrainPulseModel({scheduler});
  for(let i=0;i<2000;i++)model.ingestCoprocessor({type:i%3===0?'WARM_HIT':i%3===1?'STALE_DROPPED':'FALLBACK_USED',payload:{taskId:`t-${i%32}`,providerProfileId:'provider-secret'}});
  assert.equal(scheduler.pendingCount,1);frame(1);const text=model.getSnapshot().activity.map(x=>x.meaning).join(' ');assert.doesNotMatch(text,/provider-secret/);assert.match(text,/warm|Stale|fallback/i);
});

test('Brain Pulse mount/destroy releases Runtime and Coprocessor subscriptions exactly once',()=>{
  let r=0,c=0;const runtime={read(){return{source:createProductSourceStatus({mode:'LIVE'}),data:{hotActivity:0,deepActivity:0}};},subscribe(){r++;return()=>r--;}};const cop={read(){return{source:createProductSourceStatus({mode:'LIVE'}),data:{}};},subscribe(){c++;return()=>c--;}};const scheduler={invalidate(){}};
  const m=new BrainPulseModel({runtime,coprocessor:cop,scheduler}).mount();assert.equal(r,1);assert.equal(c,1);m.destroy();assert.equal(r,0);assert.equal(c,0);m.destroy();assert.equal(r,0);assert.equal(c,0);
});

test('Brain Pulse distinguishes foreground and background cognition without a worker wall',()=>{
  const m=new BrainPulseModel({runtime:new RuntimeProductionUIAdapter(runtimeAdapter()),coprocessor:new CoprocessorProductionUIAdapter(coprocessorTelemetry()),scheduler:{invalidate(){}}});
  const p=m.getSnapshot();assert.equal(p.hotCount,2);assert.equal(p.deepCount,3);assert.match(p.currentFocus,/Foreground/);assert.equal('workers' in p,false);
});

test('health surface answers availability and impact in visible text independent of color',()=>{
  const doc=new Wave6Document(),source=createProductSourceStatus({mode:'DEGRADED',health:'DEGRADED',label:'Character cognition',impact:'Generation continues without Green Room assistance.'});
  const node=createProductHealthSurface(doc,{source});const text=textOf(node);assert.match(text,/Character cognition/);assert.match(text,/DEGRADED/);assert.match(text,/Generation continues/);assert.equal(node.dataset.status,'warning');
});

test('knowledge action bar disables unconnected Source/History/Evidence actions instead of fake success',()=>{
  const doc=new Wave6Document(),router=new ActionRouter(),node=createKnowledgeActionBar(doc,{ref:{id:'scene-7'},actionRouter:router});
  const buttons=walk(node).filter(x=>x.tagName==='BUTTON');assert.equal(buttons.length,6);assert.ok(buttons.every(x=>x.disabled===true));assert.ok(buttons.every(x=>x.dataset.availability==='UNAVAILABLE'));
});

test('knowledge action bar becomes enabled only for deliberately registered Action Router paths',()=>{
  const doc=new Wave6Document(),router=new ActionRouter();router.registerSubsystem('test',async()=>({ok:true}));router.registerAction('knowledge.inspectSource',{subsystem:'test'});
  const node=createKnowledgeActionBar(doc,{ref:{id:'scene-7'},actionRouter:router});const source=walk(node).find(x=>x.dataset?.action==='knowledge.inspectSource'),history=walk(node).find(x=>x.dataset?.action==='knowledge.inspectHistory');
  assert.equal(source.disabled,false);assert.equal(source.dataset.availability,'LIVE');assert.equal(history.disabled,true);
});

test('PromptPlan Normal is concise while Advanced contains exact plan/profile/integrity detail',()=>{
  const a=productionAdapter(),r=new WorkspaceRegistry();registerWave6FrontFaceWorkspaces(r,{adapter:a});
  const doc=new Wave6Document(),host=new FakeNode('main',doc),scope={listen(t,type,h){t.addEventListener(type,h);},add(){},cleanup(){}};
  a.setDetailLevel(ProductDetailLevel.NORMAL);r.get('brain').render(host,{scope,navigate(){},inspect(){},actionRouter:new ActionRouter()});let t=textOf(host);assert.match(t,/27,400/);assert.doesNotMatch(t,/prompt-plan:7/);assert.doesNotMatch(t,/CACHE_STABLE/);
  host.replaceChildren();a.setDetailLevel(ProductDetailLevel.ADVANCED);r.get('brain').render(host,{scope,navigate(){},inspect(){},actionRouter:new ActionRouter()});t=textOf(host);assert.match(t,/prompt-plan:7/);assert.match(t,/CACHE_STABLE/);assert.match(t,/Integrity VALID/);assert.match(t,/Context Receipt/);
});

test('Forensics timeline is Advanced-only and its large collection remains virtualizable',()=>{
  const a=productionAdapter(),r=new WorkspaceRegistry();registerWave6FrontFaceWorkspaces(r,{adapter:a});assert.equal(r.get('forensics').navigation.level,'advanced');
  const window=computeVirtualWindow({count:10000,itemSize:46,viewportSize:460,scrollOffset:23000,overscan:6});assert.ok(window.end-window.start<=22);assert.ok(window.totalSize>=460000);
});

test('responsive resolver still covers WIDE COMPACT STACKED for host-constrained layout',()=>{
  assert.equal(resolveResponsiveMode(1440),ResponsiveMode.WIDE);assert.equal(resolveResponsiveMode(900),ResponsiveMode.COMPACT);assert.equal(resolveResponsiveMode(600),ResponsiveMode.STACKED);
});

test('250 host resize transitions remain deterministic with no cognitive mutation',()=>{
  const before=productionAdapter().getSnapshot();for(let i=0;i<250;i++){const width=i%3===0?1440:i%3===1?900:600;assert.ok(Object.values(ResponsiveMode).includes(resolveResponsiveMode(width)));}assert.deepEqual(productionAdapter().getSnapshot(),before);
});

test('Wave 6 CSS carries canonical design language, authority structure, compact host modes and reduced motion',async()=>{
  const css=await readFile(new URL('../styles/ui-core-wave6.css',import.meta.url),'utf8');
  assert.match(css,/a52-front-face/);assert.match(css,/COLLAPSED/);assert.match(css,/EXPANDED/);assert.match(css,/a52-authority-pill/);assert.match(css,/border-style:dotted/);assert.match(css,/border-style:dashed/);assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/data-layout=STACKED/);
  assert.equal(/font-familys*:/.test(css),false);
});

test('Wave 6 source remains browser-facing with no Node-only production imports or host-global mutation',async()=>{
  const names=['wave6-contracts.js','wave6-production-adapters.js','wave6-brain-pulse.js','wave6-presentation.js','wave6-front-face.js','wave6-runtime.js'];
  for(const name of names){const src=await readFile(new URL(`../src/ui-core/${name}`,import.meta.url),'utf8');assert.doesNotMatch(src,/from ['"]node:/);assert.doesNotMatch(src,/\brequire\s*\(/);assert.doesNotMatch(src,/\bprocess\./);assert.doesNotMatch(src,/globalThis\.[A-Za-z_$][\w$]*\s*=/);}
});

test('Wave 6 production modules execute with Buffer unavailable',async()=>{
  const prior=globalThis.Buffer;try{globalThis.Buffer=undefined;const mod=await import('../src/ui-core/wave6-contracts.js?browser-wave6');assert.equal(mod.ProductDataMode.LIVE,'LIVE');const a=new SceneProductionUIAdapter({readModel:sceneReadModel});assert.equal(a.read().data.revision,7);}finally{globalThis.Buffer=prior;}
});

test('source health / authority UI carries semantic status labels for screen readers',()=>{
  const doc=new Wave6Document(),health=createProductHealthSurface(doc,{source:createProductSourceStatus({mode:'UNAVAILABLE',label:'Memory',impact:'Memory is unavailable.'})}),auth=createAuthorityPill(doc,'HISTORICAL');
  assert.equal(health.attributes.role,'status');assert.equal(auth.attributes.role,'status');assert.match(auth.attributes['aria-label'],/Historically valid/);
});

test('production bootstrap supports brand rename configuration without cognitive contract changes',()=>{
  const doc=new Wave6Document(),root=new FakeNode('div',doc),ui=createWave6ProductInterface({root,productName:'Nexus',productTagline:'Cognitive Story System',bridges:{}});
  assert.match(textOf(ui.controller.nodes.quick),/Nexus/);assert.equal(ui.productAdapter.getSnapshot().wave6.mode,ProductDataMode.UNAVAILABLE);ui.destroy();
});
