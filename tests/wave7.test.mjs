import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ActionRouter, ContextSectionState, ExplainabilityPresentationState, ExplainabilityView, ForensicMetadataIndex, ForensicStage,
  ForensicsProductionUIAdapter, InspectorRegistry, LazyForensicDetailCache, ProductDataMode, ProductPresentationState,
  PromptPlanProductionUIAdapter, UIStateStore, Wave6ProductAdapter, WorkspaceRegistry,
  authorityDescriptor, buildForensicTimeline, buildGenerationExplainability, createForensicBookmark,
  createWave7ProductionBindings, describeWave7BindingAvailability, diffGenerationContext, explainContextSeal, explainContextSection,
  forensicWhy, normalizeCognitiveTransaction, normalizeContextReceiptReadModel, normalizeForensicReadModel, normalizePromptPlanReadModel,
  registerWave7Actions, registerWave7Inspectors, registerWave7Workspaces, unresolvedConflictModel,
} from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

class Doc extends FakeDocument { createDocumentFragment(){return new FakeNode('fragment',this);} }
const mem=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const textOf=node=>[node?.textContent??'',...(node?.children??[]).map(textOf)].filter(Boolean).join(' ');
const walk=node=>[node,...(node?.children??[]).flatMap(walk)];

const plan=(gen='gen:418',sceneRevision=19)=>({
  kind:'PromptPlanReadModel',contractVersion:'1.0.0',promptPlanId:`plan:${gen}`,generationId:gen,turnId:`turn:${gen}`,contextSealId:`seal:${gen}`,
  sealedPacketHash:`hash:${gen}`,modelProfileId:'CACHE_STABLE',modelProfileRevision:'3',deliveryPolicyRevision:'7',worldRevision:52,sceneRevision,
  sourceRevisionRefs:[`world:r52`,`scene:r${sceneRevision}`],
  slotAllocation:[
    {slot:'WORLD_FOUNDATION',representation:'COMPACT',estimatedTokens:4000,required:true,protected:true},
    {slot:'CHARACTER_FOUNDATION',representation:'COMPACT',estimatedTokens:3600,required:true,protected:true},
    {slot:'CURRENT_SCENE',representation:'RICH',estimatedTokens:4400,required:true,protected:true},
    {slot:'HISTORICAL_SUPPORT',representation:'COMPACT',estimatedTokens:1600,required:false,protected:false},
    {slot:'UNRESOLVED_EVIDENCE',representation:'RICH',estimatedTokens:1200,required:true,protected:true},
  ],
  sectionOrder:['WORLD_FOUNDATION','CHARACTER_FOUNDATION','CURRENT_SCENE','HISTORICAL_SUPPORT','UNRESOLVED_EVIDENCE'],
  reuseDecisions:[
    {slot:'WORLD_FOUNDATION',state:'NO_CHANGE',reason:'source revisions unchanged',cacheEligible:true,priority:100},
    {slot:'CHARACTER_FOUNDATION',state:'NO_CHANGE',reason:'source revisions unchanged',cacheEligible:true,priority:95},
    {slot:'CURRENT_SCENE',state:'REBUILD',reason:'scene revision changed',cacheEligible:true,priority:100,revisionIdentity:{sceneRevision}},
    {slot:'HISTORICAL_SUPPORT',state:'REBUILD',reason:'retrieval intent requested prior possession history',cacheEligible:false,priority:60},
    {slot:'UNRESOLVED_EVIDENCE',state:'PATCH',reason:'competing evidence preserved',cacheEligible:false,priority:100},
  ],
  cacheDecisions:[{slot:'WORLD_FOUNDATION',cacheEligible:true},{slot:'CHARACTER_FOUNDATION',cacheEligible:true}],
  reusedSegments:[{segmentId:'seg:world',slot:'WORLD_FOUNDATION',reuseState:'NO_CHANGE',cacheEligible:true},{segmentId:'seg:char',slot:'CHARACTER_FOUNDATION',reuseState:'NO_CHANGE',cacheEligible:true},{segmentId:'seg:unresolved',slot:'UNRESOLVED_EVIDENCE',reuseState:'PATCH',cacheEligible:false}],
  rebuiltSegments:[{segmentId:'seg:scene',slot:'CURRENT_SCENE',reuseState:'REBUILD',cacheEligible:true},{segmentId:'seg:history',slot:'HISTORICAL_SUPPORT',reuseState:'REBUILD',cacheEligible:false}],
  dropped:[],deferred:[{slot:'RELEVANT_LORE',reason:'budget exhausted after higher-priority required sections',priority:20}],
  fallbackDecisions:[],representationDensity:[],budget:{total:32000,allocated:27800,remaining:4200,estimatedTokens:27800},estimatedTokens:27800,integrityStatus:'READY',
  health:{state:'READY',reasons:['CONTENT_DEFERRED']},authority:'READ_ONLY',mutationAuthority:false,previousPromptPlanId:gen==='gen:418'?'plan:gen:417':null,
});
const plan417=()=>({
  ...plan('gen:417',18),previousPromptPlanId:null,
  slotAllocation:plan('gen:417',18).slotAllocation.filter(x=>x.slot!=='HISTORICAL_SUPPORT'),
  sectionOrder:['WORLD_FOUNDATION','CHARACTER_FOUNDATION','CURRENT_SCENE','UNRESOLVED_EVIDENCE'],
  reuseDecisions:[
    {slot:'WORLD_FOUNDATION',state:'REBUILD',reason:'initial build',cacheEligible:true},
    {slot:'CHARACTER_FOUNDATION',state:'REBUILD',reason:'initial build',cacheEligible:true},
    {slot:'CURRENT_SCENE',state:'REBUILD',reason:'initial build',cacheEligible:true},
    {slot:'UNRESOLVED_EVIDENCE',state:'REBUILD',reason:'initial evidence set',cacheEligible:false},
  ],
  reusedSegments:[],rebuiltSegments:[
    {slot:'WORLD_FOUNDATION',reuseState:'REBUILD'},{slot:'CHARACTER_FOUNDATION',reuseState:'REBUILD'},{slot:'CURRENT_SCENE',reuseState:'REBUILD'},{slot:'UNRESOLVED_EVIDENCE',reuseState:'REBUILD'},
  ],deferred:[],
});
const receipt=(gen='gen:418')=>({
  kind:'ContextReceiptReadModel',contractVersion:'1.0.0',turnId:`turn:${gen}`,generationId:gen,contextSealId:`seal:${gen}`,promptPlanId:`plan:${gen}`,
  packetId:`packet:${gen}`,packetHash:`hash:${gen}`,modelProfileId:'CACHE_STABLE',worldRevision:52,sceneRevision:19,sourceRevisionRefs:['world:r52','scene:r19'],
  includedSections:['WORLD_FOUNDATION','CHARACTER_FOUNDATION','CURRENT_SCENE','HISTORICAL_SUPPORT','UNRESOLVED_EVIDENCE'],
  omittedSections:[],deferredSections:[{slot:'RELEVANT_LORE',reason:'budget exhausted after higher-priority required sections'}],
  unresolvedEvidence:[{artifactId:'claim:sun-blade:fate',subjectId:'Sun Blade',predicate:'current status/location',value:'unknown',authority:'UNRESOLVED',status:'UNRESOLVED',provenanceRefs:['src:blade-left','src:tavern-burn','src:removed-rumor']}],
  reusedSegments:[{slot:'WORLD_FOUNDATION'},{slot:'CHARACTER_FOUNDATION'}],rebuiltSegments:[{slot:'CURRENT_SCENE'},{slot:'HISTORICAL_SUPPORT'}],
  budget:{total:32000,allocated:27800},estimatedTokens:27800,fallbackState:'NONE',provenanceRefs:['src:blade-left','src:tavern-burn'],health:{state:'READY',reasons:['CONTENT_DEFERRED']},authority:'READ_ONLY',mutationAuthority:false,
});
const seal=(gen='gen:418',fallbackState='NONE')=>({
  kind:'ContextSealReceipt',id:`seal:${gen}`,turnId:`turn:${gen}`,correlationId:`corr:${gen}`,packetId:`packet:${gen}`,packetHash:`hash:${gen}`,
  sourceRevisionIds:['world:r52','scene:r19'],worldRevision:52,sceneRevision:19,admittedResultIds:['result:historian','result:truth'],
  rejectedResultIds:['result:bad-structured'],staleResultIds:['result:scene-r18'],fallbackState,deadline:{foregroundMs:1200},sequence:418,sealedAt:4180,dependencies:['world:r52','scene:r19'],sealedState:true,
});
const forensic=(gen='gen:418',complete=true)=>({
  kind:'ForensicReadModel',contractVersion:'1.0.0',bundleId:`bundle:${gen}`,turnId:`turn:${gen}`,generationId:gen,worldRevision:52,sceneRevision:19,
  sourceRevisionRefs:['src:blade-left','src:tavern-burn','src:removed-rumor'],turnEventRef:`turn-event:${gen}`,
  runtimeWorkRefs:['runtime:historian','runtime:green-room'],workerResultRefs:['result:historian','result:green-room'],truthDecisionRefs:['truth:sun-blade'],precisionRefs:['precision:1'],
  gatherRef:'gather:418',transactionRefs:['tx:source','tx:contradiction','tx:seal','tx:plan'],settlementRefs:['settlement:tavern-destroyed'],contextSealRef:`seal:${gen}`,promptPlanRef:`plan:${gen}`,
  lateResultRefs:['result:green-room'],staleResultRefs:['result:scene-r18'],diagnosticRefs:['diag:418'],diagnosticReasons:[],assemblyProvenanceRefs:['assembly:1'],complete,
  health:{state:complete?'READY':'DEGRADED',reasons:complete?[]:['FORENSIC_BUNDLE_INCOMPLETE']},authority:'READ_ONLY',mutationAuthority:false,
});
const txs=()=>[
  {kind:'CognitiveTransaction',transactionId:'tx:source',transactionType:'SOURCE_REVISION_ADMITTED',sequence:1,timestamp:1,correlationId:'corr:gen:418',turnId:'turn:gen:418',generationId:'gen:418',subsystem:'SOURCE',owner:'SOURCE',sourceRevisionIds:['src:blade-left'],affectedArtifactIds:['claim:blade-history'],authorityContext:{authorityClass:'SOURCE_CANON'},decision:null,outcome:{status:'RECORDED'},receiptRefs:[],reasonCode:'SOURCE_CURRENT',provenance:{},metadata:{},retentionClass:'LIGHTWEIGHT_METADATA'},
  {kind:'CognitiveTransaction',transactionId:'tx:reflection',transactionType:'REFLECTION_CREATED',sequence:2,timestamp:2,correlationId:'corr:gen:418',turnId:'turn:gen:418',generationId:'gen:418',subsystem:'MEMORY',owner:'MEMORY',sourceRevisionIds:['src:removed-rumor'],affectedArtifactIds:['reflection:blade'],authorityContext:{authorityClass:'INFERRED',confidence:.99},decision:null,outcome:{status:'RECORDED'},receiptRefs:[],reasonCode:'REFLECTION_EVIDENCE',provenance:{},metadata:{},retentionClass:'LIGHTWEIGHT_METADATA'},
  {kind:'CognitiveTransaction',transactionId:'tx:contradiction',transactionType:'STATE_CONTRADICTED',sequence:3,timestamp:3,correlationId:'corr:gen:418',turnId:'turn:gen:418',generationId:'gen:418',subsystem:'TRUTH',owner:'SETTLEMENT',sourceRevisionIds:['src:tavern-burn','src:removed-rumor'],affectedArtifactIds:['claim:sun-blade:fate'],authorityContext:{authorityClass:'UNRESOLVED'},decision:{status:'UNRESOLVED'},outcome:{summary:'Destroyed-vs-removed conflict preserved'},receiptRefs:['truth:sun-blade'],reasonCode:'COMPETING_EVIDENCE',provenance:{},metadata:{},retentionClass:'FORENSIC_REFERENCE'},
  {kind:'CognitiveTransaction',transactionId:'tx:stale',transactionType:'RESULT_STALE',sequence:4,timestamp:4,correlationId:'corr:gen:418',turnId:'turn:gen:418',generationId:'gen:418',taskId:'task:scene-r18',subsystem:'RESULT_BUS',owner:'RESULT_BUS',beforeRevision:18,afterRevision:19,sourceRevisionIds:['scene:r18'],affectedArtifactIds:[],authorityContext:{authorityClass:'UNRESOLVED'},decision:{status:'REJECTED'},outcome:null,receiptRefs:['result:scene-r18'],reasonCode:'SCENE_REVISION_MISMATCH',provenance:{},metadata:{},retentionClass:'LIGHTWEIGHT_METADATA'},
  {kind:'CognitiveTransaction',transactionId:'tx:seal',transactionType:'CONTEXT_SEALED',sequence:5,timestamp:5,correlationId:'corr:gen:418',turnId:'turn:gen:418',generationId:'gen:418',subsystem:'CONTEXT',owner:'CONTEXT',sourceRevisionIds:['scene:r19'],affectedArtifactIds:['packet:gen:418'],authorityContext:{authorityClass:'UNRESOLVED'},decision:null,outcome:{status:'ACCEPTED'},receiptRefs:['seal:gen:418'],reasonCode:'PUBLICATION_BOUNDARY',provenance:{},metadata:{},retentionClass:'FORENSIC_REFERENCE'},
  {kind:'CognitiveTransaction',transactionId:'tx:late',transactionType:'RESULT_LATE',sequence:6,timestamp:6,correlationId:'corr:gen:418',turnId:'turn:gen:418',generationId:'gen:418',taskId:'task:green-room',subsystem:'GREEN_ROOM',owner:'COPROCESSOR',sourceRevisionIds:['scene:r19'],affectedArtifactIds:[],authorityContext:{authorityClass:'INFERRED'},decision:{status:'ROUTED_FORWARD'},outcome:{summary:'Green Room routed to future cognition'},receiptRefs:['result:green-room'],reasonCode:'CONTEXT_ALREADY_SEALED',provenance:{},metadata:{},retentionClass:'LIGHTWEIGHT_METADATA'},
  {kind:'CognitiveTransaction',transactionId:'tx:plan',transactionType:'CONTEXT_DELIVERY_PLANNED',sequence:7,timestamp:7,correlationId:'corr:gen:418',turnId:'turn:gen:418',generationId:'gen:418',subsystem:'CONTEXT',owner:'CONTEXT',sourceRevisionIds:['scene:r19'],affectedArtifactIds:['plan:gen:418'],authorityContext:{authorityClass:'UNRESOLVED'},decision:null,outcome:{status:'ACCEPTED'},receiptRefs:['plan:gen:418'],reasonCode:'PLAN_READY',provenance:{},metadata:{},retentionClass:'FORENSIC_REFERENCE'},
];
const readers=()=>({
  readPromptPlanReadModel:({generationId}={})=>generationId==='gen:417'?plan417():plan(),
  readContextReceiptReadModel:({generationId}={})=>receipt(generationId??'gen:418'),
  readSealReceipt:({generationId}={})=>seal(generationId??'gen:418'),
  listGenerations:()=>[{generationId:'gen:417',turnId:'turn:gen:417'},{generationId:'gen:418',turnId:'turn:gen:418'}],
  readForensicReadModel:(arg)=>forensic(typeof arg==='string'?arg:arg?.generationId??'gen:418'),
  listForensicReadModels:()=>[forensic()],
  listTransactions:()=>txs(),
  readTransaction:id=>txs().find(x=>x.transactionId===id)??null,
  reconstructGeneration:id=>({kind:'ReconstructionChain',targetType:'generation',targetId:id,complete:true,status:'OK',transactions:txs(),links:[],missingRefs:[],cycles:[],truncated:false,totalTransactions:txs().length}),
  readRuntimeWork:id=>({id,taskType:id.includes('green')?'GREEN_ROOM':'HISTORIAN',state:'COMPLETE'}),
  readLazyPayload:id=>({id,rawDiagnosticCode:'DETAIL_ON_DEMAND'}),
});

test('PromptPlanReadModel normalization preserves backend reuse/rebuild/defer semantics and owner reasons',()=>{
  const x=normalizePromptPlanReadModel(plan());const by=new Map(x.sections.map(s=>[s.slot,s]));
  assert.equal(by.get('WORLD_FOUNDATION').state,ContextSectionState.REUSED);
  assert.equal(by.get('CURRENT_SCENE').state,ContextSectionState.REBUILT);
  assert.equal(by.get('UNRESOLVED_EVIDENCE').state,ContextSectionState.UPDATED);
  assert.equal(by.get('RELEVANT_LORE').state,ContextSectionState.DEFERRED);
  assert.equal(by.get('CURRENT_SCENE').reason,'scene revision changed');
});

test('section explanation never invents a missing reason',()=>{
  const x=explainContextSection({slot:'CURRENT_SCENE',state:'REBUILT',included:true});
  assert.equal(x.reason,null);assert.equal(x.reasonAvailable,false);assert.match(x.impact,/rebuilt/i);
});

test('intentional deferred content does not by itself mark a healthy generation degraded',()=>{
  const x=buildGenerationExplainability({promptPlan:plan(),contextReceipt:receipt(),sealReceipt:seal()});
  assert.equal(x.source.mode,ProductDataMode.LIVE);assert.equal(x.sectionCounts.DEFERRED,1);assert.equal(x.integrityState,'READY');
});

test('fallback state degrades explainability health without claiming generation failure',()=>{
  const x=buildGenerationExplainability({promptPlan:plan(),contextReceipt:{...receipt(),fallbackState:'PRECISION_FALLBACK'},sealReceipt:seal('gen:418','PRECISION_FALLBACK')});
  assert.equal(x.source.mode,ProductDataMode.DEGRADED);assert.equal(x.fallbackState,'PRECISION_FALLBACK');assert.match(x.source.impact,/fallback|degraded/i);
});

test('ContextReceiptReadModel normalization preserves unresolved evidence and no mutation authority',()=>{
  const x=normalizeContextReceiptReadModel(receipt());assert.equal(x.unresolvedEvidence[0].authority,'UNRESOLVED');assert.equal(x.mutationAuthority,false);assert.deepEqual(x.deferredSections.map(r=>r.slot),['RELEVANT_LORE']);
});

test('Context Seal explainer describes stale rejected late and fallback in operator language',()=>{
  const x=explainContextSeal({...seal(),lateResultIds:['result:green-room']});assert.equal(x.stale,1);assert.equal(x.rejected,1);assert.equal(x.late,1);assert.match(x.summary,/stale/);assert.match(x.summary,/after this generation/);assert.doesNotMatch(x.summary,/task-9182/);
});

test('adjacent-generation diff uses explicit reuse evidence and does not claim unknown semantics',()=>{
  const a=buildGenerationExplainability({promptPlan:plan417(),contextReceipt:receipt('gen:417'),sealReceipt:seal('gen:417')});
  const b=buildGenerationExplainability({promptPlan:plan(),contextReceipt:receipt(),sealReceipt:seal()});
  const diff=diffGenerationContext(a,b);assert.equal(diff.available,true);
  assert.ok(diff.groups.UNCHANGED.some(x=>x.slot==='WORLD_FOUNDATION'));assert.ok(diff.groups.REBUILT.some(x=>x.slot==='CURRENT_SCENE'));assert.ok(diff.groups.ADDED.some(x=>x.slot==='HISTORICAL_SUPPORT'));assert.ok(diff.groups.DEFERRED.some(x=>x.slot==='RELEVANT_LORE'));
});

test('generation diff exposes insufficient comparison data instead of inventing UPDATED',()=>{
  const a={generationId:'a',sections:[{slot:'X',state:'INCLUDED'}]},b={generationId:'b',sections:[{slot:'X',state:'INCLUDED'}]};const d=diffGenerationContext(a,b);assert.equal(d.insufficient,true);assert.equal(d.groups.UNKNOWN[0].slot,'X');
});

test('forensic bookmark is presentation-only serializable identity',()=>{
  const b=createForensicBookmark({turnId:'t',generationId:'g',transactionId:'tx',objectId:'o',view:ExplainabilityView.FORENSICS});assert.deepEqual(Object.keys(b).sort(),['generationId','kind','objectId','transactionId','turnId','view'].sort());assert.equal(JSON.stringify(b).includes('payload'),false);
});

test('ExplainabilityPresentationState persists IDs filters and view but not cognitive payloads',()=>{
  const storage=mem(),store=new UIStateStore({storage,namespace:'wave7'}),p=new ExplainabilityPresentationState({stateStore:store});p.patch({view:'FORENSICS',bookmark:createForensicBookmark({generationId:'gen:418'}),filters:{status:'STALE',bad:{payload:'no'}}});
  const restored=new ExplainabilityPresentationState({stateStore:store}).get();assert.equal(restored.view,'FORENSICS');assert.equal(restored.bookmark.generationId,'gen:418');assert.equal(restored.filters.status,'STALE');assert.equal('bad' in restored.filters,false);assert.doesNotMatch(storage.m.get('wave7'),/rawDiagnostic|ContextSeal content/i);
});

test('accepted ForensicReadModel normalization preserves stable refs and partial health',()=>{
  const x=normalizeForensicReadModel(forensic('gen:418',false));assert.equal(x.generationId,'gen:418');assert.equal(x.complete,false);assert.deepEqual(x.runtimeWorkRefs,['runtime:historian','runtime:green-room']);assert.equal(x.mutationAuthority,false);
});

test('actual cognitive transaction type maps to semantic forensic stage',()=>{
  const x=normalizeCognitiveTransaction(txs()[0]);assert.equal(x.eventType,'SOURCE_REVISION_ADMITTED');assert.equal(x.stage,ForensicStage.SOURCE);assert.equal(x.authority.authority,'SOURCE_CANON');
});

test('unknown future transaction stays inspectable through UNKNOWN fallback',()=>{
  const x=normalizeCognitiveTransaction({...txs()[0],transactionId:'tx:future',transactionType:'FUTURE_EVENT'});assert.equal(x.stage,ForensicStage.UNKNOWN);assert.equal(x.eventType,'FUTURE_EVENT');assert.match(x.impact,/SOURCE_CURRENT|Recorded/);
});

test('high-confidence Reflection remains INFERRED authority',()=>{
  const x=normalizeCognitiveTransaction(txs()[1]);assert.equal(x.authority.authority,'INFERRED');assert.equal(x.authority.label,'INFERRED');
});

test('forensic timeline preserves Runtime Work Ledger as cross-links rather than cognitive rows',()=>{
  const x=buildForensicTimeline({forensic:forensic(),transactions:txs()});assert.deepEqual(x.runtimeWorkRefs,['runtime:historian','runtime:green-room']);assert.equal(x.rows.some(r=>r.id==='runtime:historian'),false);
});

test('sparse forensic model exposes missing stages instead of fabricating them',()=>{
  const sparse={...forensic(),workerResultRefs:[],truthDecisionRefs:[],precisionRefs:[],gatherRef:null,settlementRefs:[],transactionRefs:[],contextSealRef:null,promptPlanRef:null,lateResultRefs:[],staleResultRefs:[],complete:false};
  const x=buildForensicTimeline({forensic:sparse,transactions:[txs()[0]]});assert.equal(x.complete,false);assert.ok(x.missingStages.includes('CONTEXT'));assert.equal(x.rows.some(r=>r.eventType==='CONTEXT_SEALED'),false);
});

test('forensic timeline marks late/stale/contradicted semantics without making lateness a system failure',()=>{
  const x=buildForensicTimeline({forensic:forensic(),transactions:txs()});assert.equal(x.rows.find(r=>r.id==='tx:late').status,'LATE');assert.equal(x.rows.find(r=>r.id==='tx:stale').status,'STALE');assert.equal(x.rows.find(r=>r.id==='tx:contradiction').status,'UNRESOLVED');assert.doesNotMatch(x.rows.find(r=>r.id==='tx:late').impact,/system failure/i);
});

test('forensic Why explains revision mismatch from recorded transaction fields',()=>{
  const item=normalizeCognitiveTransaction(txs()[3]),why=forensicWhy(item);assert.match(why.summary,/SCENE_REVISION_MISMATCH/);assert.match(why.summary,/18 → 19/);assert.match(why.summary,/stale/i);
});

test('unresolved conflict model preserves UNRESOLVED and does not choose an alternative',()=>{
  const x=unresolvedConflictModel(normalizeContextReceiptReadModel(receipt()))[0];assert.equal(x.settlement,'UNRESOLVED');assert.equal(x.authority,'UNRESOLVED');assert.equal(x.currentValue,'unknown');
});

test('forensic metadata index filters pre-indexed metadata by status authority source and search',()=>{
  const timeline=buildForensicTimeline({forensic:forensic(),transactions:txs()}),idx=new ForensicMetadataIndex(timeline.rows);
  assert.ok(idx.query({status:'STALE'}).every(x=>x.status==='STALE'));assert.ok(idx.query({authority:'INFERRED'}).some(x=>x.id==='tx:reflection'));assert.ok(idx.query({search:'green room'}).some(x=>x.id==='tx:late'));
});

test('lazy forensic detail is not loaded until explicit request and cache is bounded',async()=>{
  let calls=0;const cache=new LazyForensicDetailCache({loader:async ref=>{calls++;return{ref};},maxEntries:2});assert.equal(calls,0);await cache.load('a');await cache.load('b');await cache.load('c');assert.equal(calls,3);assert.equal(cache.size,2);await cache.load('c');assert.equal(calls,3);cache.destroy();assert.equal(cache.size,0);await assert.rejects(cache.load('d'),/destroyed/);
});

test('PromptPlan production adapter prefers accepted read models and exposes explainability',()=>{
  const rds=readers(),a=new PromptPlanProductionUIAdapter(rds),r=a.read({generationId:'gen:418'});assert.equal(r.source.mode,ProductDataMode.LIVE);assert.equal(r.data.readModelKind,'PromptPlanReadModel');assert.equal(r.data.explainability.generationId,'gen:418');assert.equal(r.data.sections.find(x=>x.slot==='CURRENT_SCENE').state,'REBUILT');
});

test('PromptPlan adapter generation selector supports current previous recent and direct read',()=>{
  const a=new PromptPlanProductionUIAdapter(readers());assert.deepEqual(a.listGenerations().map(x=>x.generationId),['gen:417','gen:418']);const prev=a.readPrevious({generationId:'gen:418'});assert.equal(prev.generationId,'gen:417');assert.equal(a.explain({generationId:'gen:417'}).promptPlanId,'plan:gen:417');
});

test('PromptPlan missing producer remains UNAVAILABLE not FIXTURE',()=>{
  const r=new PromptPlanProductionUIAdapter({}).read();assert.equal(r.source.mode,ProductDataMode.UNAVAILABLE);assert.equal(r.source.fixture,false);
});

test('Forensics production adapter consumes accepted ForensicReadModel and transaction readers',()=>{
  const rds=readers(),a=new ForensicsProductionUIAdapter(rds),r=a.readGeneration('gen:418');assert.equal(r.source.mode,ProductDataMode.LIVE);assert.equal(r.data.forensic.kind,'NormalizedForensicReadModel');assert.ok(r.data.timeline.rows.length>=txs().length);
});

test('Forensics adapter exposes reconstruction Runtime cross-link and lazy detail without mixing them',async()=>{
  const a=new ForensicsProductionUIAdapter(readers());assert.equal(a.getReconstruction({generationId:'gen:418'}).status,'OK');assert.equal(a.getRuntimeWork('runtime:green-room').taskType,'GREEN_ROOM');assert.deepEqual(await a.loadDetail('tx:contradiction'),{id:'tx:contradiction',rawDiagnosticCode:'DETAIL_ON_DEMAND'});a.destroy();
});

test('typed Wave 7 production binding seam validates optional dependencies and reports availability',()=>{
  const rds=readers(),b=createWave7ProductionBindings({readPromptPlanReadModel:rds.readPromptPlanReadModel,readContextReceiptReadModel:rds.readContextReceiptReadModel,readContextSealReceipt:rds.readSealReceipt,listGenerations:rds.listGenerations,readForensicReadModel:rds.readForensicReadModel,listCognitiveTransactions:rds.listTransactions,readRuntimeWork:rds.readRuntimeWork});
  const a=describeWave7BindingAvailability(b);assert.equal(a.promptPlan,true);assert.equal(a.contextReceipt,true);assert.equal(a.contextSeal,true);assert.equal(a.forensics,true);assert.equal(a.cognitiveTransactions,true);assert.equal(a.runtimeWork,true);
  assert.throws(()=>createWave7ProductionBindings({readPromptPlanReadModel:'not-a-function'}),/must be a function/);
});

test('Wave 7 actions are observational and generation selection changes only presentation state',async()=>{
  const storage=mem(),p=new ExplainabilityPresentationState({stateStore:new UIStateStore({storage,namespace:'actions'})}),router=new ActionRouter(),release=registerWave7Actions(router,{presentation:p});
  const result=await router.route({type:'wave7.selectGeneration',target:{generationId:'gen:418',turnId:'turn:418'}});assert.equal(result.ok,true);assert.equal(p.get().bookmark.generationId,'gen:418');
  assert.equal(router.hasAction('wave7.why'),true);assert.equal(router.listActions().some(x=>/settle|mutate/i.test(x)),false);release();
});

test('Why action returns section explanation through Action Router',async()=>{
  const p=new ExplainabilityPresentationState(),router=new ActionRouter();registerWave7Actions(router,{presentation:p});const section=normalizePromptPlanReadModel(plan()).sections.find(x=>x.slot==='CURRENT_SCENE');const r=await router.route({type:'wave7.why',target:{section}});assert.equal(r.ok,true);assert.equal(r.result.reason,'scene revision changed');assert.equal(r.result.state,'REBUILT');
});

test('Wave 7 registers hidden Brain explainability workspace and upgrades existing Forensics workspace',()=>{
  const registry=new WorkspaceRegistry();registry.register({id:'forensics',title:'Forensics',navigation:{level:'advanced'},render(){}});const p=new PromptPlanProductionUIAdapter(readers()),f=new ForensicsProductionUIAdapter(readers());registerWave7Workspaces(registry,{promptPlan:p,forensics:f,presentation:new ExplainabilityPresentationState(),scheduler:{invalidate(){}}});
  assert.equal(registry.get('generation-explainability').navigation.level,'advanced');assert.equal(registry.get('generation-explainability').category,'Brain');assert.equal(registry.get('forensics').category,'Brain');
});

test('Wave 7 Inspector registrations reuse existing Inspector Registry and do not add a second panel',()=>{
  const registry=new InspectorRegistry(),f=new ForensicsProductionUIAdapter(readers());const release=registerWave7Inspectors(registry,{forensics:f});assert.ok(registry.has('wave7-generation'));assert.ok(registry.has('wave7-context-section'));assert.ok(registry.has('wave7-forensic-item'));release();assert.equal(registry.has('wave7-generation'),false);
});

test('Wave 7 generation workspace Normal view explains meaning before IDs/raw machinery',()=>{
  const registry=new WorkspaceRegistry(),p=new PromptPlanProductionUIAdapter(readers()),f=new ForensicsProductionUIAdapter(readers()),presentation=new ExplainabilityPresentationState();registerWave7Workspaces(registry,{promptPlan:p,forensics:f,presentation,scheduler:{invalidate(){}}});
  const doc=new Doc(),host=new FakeNode('main',doc),router=new ActionRouter();registerWave7Actions(router,{presentation});const product=new Wave6ProductAdapter({presentationState:new ProductPresentationState()});
  const scope={listen(t,type,h){t.addEventListener(type,h);},add(){},cleanup(){}};registry.get('generation-explainability').render(host,{scope,actionRouter:router,productAdapter:product,promptPlan:p,forensics:f,presentation,scheduler:{invalidate(){}},inspect(){},navigate(){},refresh(){}});
  const t=textOf(host);assert.match(t,/Why This Generation/);assert.match(t,/Context plan/);assert.match(t,/Current Scene/);assert.doesNotMatch(t,/rawDiagnosticCode/);
});

test('Wave 7 Forensics workspace carries accessible timeline/filter labels and uses virtual list',()=>{
  const registry=new WorkspaceRegistry();registry.register({id:'forensics',title:'Forensics',navigation:{level:'advanced'},render(){}});const p=new PromptPlanProductionUIAdapter(readers()),f=new ForensicsProductionUIAdapter(readers()),presentation=new ExplainabilityPresentationState();presentation.selectGeneration({generationId:'gen:418'});registerWave7Workspaces(registry,{promptPlan:p,forensics:f,presentation,scheduler:{invalidate(){}}});
  const doc=new Doc(),host=new FakeNode('main',doc),router=new ActionRouter();registerWave7Actions(router,{presentation});const product=new Wave6ProductAdapter({presentationState:new ProductPresentationState()});const scope={listen(t,type,h){t.addEventListener(type,h);},add(){},cleanup(){}};
  registry.get('forensics').render(host,{scope,actionRouter:router,productAdapter:product,promptPlan:p,forensics:f,presentation,scheduler:{invalidate(key,fn){fn();}},inspect(){},navigate(){},refresh(){}});
  const nodes=walk(host);assert.ok(nodes.some(n=>n.attributes?.['aria-label']==='Cognitive forensic timeline'));assert.ok(nodes.some(n=>n.attributes?.['aria-label']==='Search forensic timeline'));assert.ok(nodes.some(n=>String(n.className).includes('a52-virtual-list')));
});

test('authority/status rendering remains non-color encoded in Wave 7 CSS',async()=>{
  const css=await readFile(new URL('../styles/ui-core-wave7.css',import.meta.url),'utf8');assert.match(css,/border-left/);assert.match(css,/data-status=STALE/);assert.match(css,/prefers-reduced-motion:reduce/);assert.doesNotMatch(css,/font-family\s*:/);
});

test('Wave 7 production source remains browser-safe with Node globals unavailable',async()=>{
  const names=['wave7-explainability.js','wave7-forensics.js','wave7-workspaces.js','wave7-bindings.js'];for(const name of names){const src=await readFile(new URL(`../src/ui-core/${name}`,import.meta.url),'utf8');assert.doesNotMatch(src,/from ['"]node:/);assert.doesNotMatch(src,/\brequire\s*\(/);assert.doesNotMatch(src,/\bprocess\./);}
  const prior=globalThis.Buffer;try{globalThis.Buffer=undefined;const mod=await import('../src/ui-core/wave7-explainability.js?browser-wave7');assert.equal(mod.ContextSectionState.REUSED,'REUSED');}finally{globalThis.Buffer=prior;}
});
