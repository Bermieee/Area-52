import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ActionRouter,CognitionStageState,ExplainabilityPresentationState,ProductDataMode,ProductDetailLevel,ProductPresentationState,
  UIStateStore,Wave6ProductAdapter,Wave8CognitionProductionAdapter,buildLiveCognitionPath,computeVirtualWindow,
  createWave6ProductInterface,createWave8ProductionBindings,describeWave8BindingAvailability,explainCognitionWhy,
  normalizeCognitiveChoiceReceipt,normalizeCorrectiveRetrievalReceipt,normalizeGatherReceipt,normalizeJevDecisionReceipt,
  normalizePrecisionReceipt,normalizeScatterReceipt,normalizeSensoryReceipt,normalizeTruthAssessment,registerWave8Actions,
  renderLiveBrainCognition,resolveResponsiveMode,ResponsiveMode,
} from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';
import {
  wave8AmbiguousFixture,wave8DegradedFixture,wave8HotOnlyFixture,wave8LargeFixture,wave8MultiResourceFixture,wave8RetrievalHeavyFixture,
} from './fixtures/wave8-cognition-fixtures.mjs';

class Doc extends FakeDocument { createDocumentFragment(){return new FakeNode('fragment',this);} }
const textOf=node=>[node?.textContent??'',...(node?.children??[]).map(textOf)].filter(Boolean).join(' ');
const walk=node=>[node,...(node?.children??[]).flatMap(walk)];
const mem=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const fixtureAdapter=f=>new Wave8CognitionProductionAdapter({fixture:f});
const stage=(path,id)=>path.stages.find(x=>x.id===id);

function renderFixture(f,{detail=ProductDetailLevel.NORMAL}={}){
  const doc=new Doc(),host=new FakeNode('main',doc),actionRouter=new ActionRouter();registerWave8Actions(actionRouter);
  const productAdapter=new Wave6ProductAdapter({presentationState:new ProductPresentationState()});productAdapter.setDetailLevel(detail);
  const cognition=fixtureAdapter(f),presentation=new ExplainabilityPresentationState();
  const listeners=[];
  const scope={listen(target,type,handler){target.addEventListener(type,handler);listeners.push(()=>target.removeEventListener?.(type,handler));},add(fn){listeners.push(fn);},cleanup(){for(const fn of listeners.splice(0).reverse())try{fn?.();}catch{}}};
  const ctx={scope,actionRouter,productAdapter,cognition,presentation,scheduler:{invalidate(_k,fn){fn();}},inspect(){},navigate(){},refresh(){},forensics:null};
  renderLiveBrainCognition(host,ctx);return{doc,host,ctx,scope,cognition,productAdapter};
}

test('Hot-only path renders explicit Retrieval/Jev/Precision skips from Cognitive Choice evidence',()=>{
  const r=fixtureAdapter(wave8HotOnlyFixture()).read(),p=r.data;
  assert.equal(stage(p,'RETRIEVAL_QUALITY').state,CognitionStageState.SKIPPED);
  assert.equal(stage(p,'JEV').state,CognitionStageState.SKIPPED);
  assert.equal(stage(p,'PRECISION').state,CognitionStageState.SKIPPED);
  assert.match(stage(p,'RETRIEVAL_QUALITY').reason,/CURRENT_WORKING_STATE_SUFFICIENT/);
  assert.equal(p.choice.brainChoice,'Hot Cognition');
});

test('absence never becomes SKIPPED without a real decision/receipt',()=>{
  const path=buildLiveCognitionPath({});
  assert.equal(stage(path,'COGNITIVE_CHOICE').state,CognitionStageState.UNAVAILABLE);
  assert.equal(stage(path,'SENSORY').state,CognitionStageState.UNAVAILABLE);
  assert.equal(stage(path,'JEV').state,CognitionStageState.UNAVAILABLE);
  assert.equal(stage(path,'PRECISION').state,CognitionStageState.UNAVAILABLE);
});

test('retrieval-heavy path preserves job admission, Sensory, Truth, Precision, Gather and Seal',()=>{
  const p=fixtureAdapter(wave8RetrievalHeavyFixture()).read().data;
  assert.equal(p.choice.candidateJobs.length,10);assert.equal(p.choice.admitted.length,4);assert.equal(p.choice.skipped.length,5);assert.equal(p.choice.deferred.length,1);
  assert.equal(p.sensory.inputNominationCount,18);assert.equal(p.sensory.uniqueCandidateCount,7);
  assert.equal(p.truth.retrievalQuality,'HIGH');assert.equal(p.precision.inputCount,7);assert.equal(p.precision.outputCount,5);
  assert.equal(p.gather.counts.ADMITTED,5);assert.equal(p.seal.sealedState,true);assert.equal(p.promptPlan.promptPlanId,'plan:418');
});

test('ambiguous path invokes Jev but preserves ABSTAINED and UNRESOLVED without owner mutation',()=>{
  const p=fixtureAdapter(wave8AmbiguousFixture()).read().data;
  assert.equal(p.truth.retrievalQuality,'MIXED');assert.ok(p.truth.counts.UNRESOLVED>0);
  assert.equal(p.jev.outcome,'ABSTAINED');assert.equal(p.jev.requiresOwnerSettlement,true);assert.equal(p.jev.ownerSettlement.status,'NO_MUTATION');
  assert.equal(stage(p,'JEV').state,CognitionStageState.COMPLETE);
});

test('Jev skipped case is distinct from unavailable',()=>{
  const p=fixtureAdapter(wave8RetrievalHeavyFixture()).read().data;
  assert.equal(p.jev.outcome,'SKIPPED');assert.equal(p.jev.state,CognitionStageState.SKIPPED);
  assert.match(p.jev.reason,/DETERMINISTIC_EVIDENCE_SUFFICIENT/);
});

test('JEV_NOT_REQUIRED is an intentional Jev skip rather than an INVALID provider failure',()=>{
  const x=normalizeJevDecisionReceipt({kind:'JevDecisionReceipt',reason:'JEV_NOT_REQUIRED',reasonCodes:['JEV_NOT_REQUIRED'],selectedOptionIds:[],rejectedOptionIds:[],evidenceUsed:[]});
  assert.equal(x.state,CognitionStageState.SKIPPED);assert.equal(x.outcome,'SKIPPED');assert.equal(x.invoked,false);assert.equal(x.reason,'JEV_NOT_REQUIRED');
});

test('Jev confidence stays metadata and does not become authority',()=>{
  const p=fixtureAdapter(wave8AmbiguousFixture()).read().data;
  assert.equal(p.jev.confidence,.63);assert.equal(p.jev.authority,'READ_ONLY');assert.equal(p.jev.mutationAuthority,false);
  assert.equal(p.truth.truthRows.find(x=>x.classification==='UNRESOLVED').classification,'UNRESOLVED');
});

test('single physical resource may execute multiple logical jobs without degradation',()=>{
  const p=fixtureAdapter(wave8RetrievalHeavyFixture()).read().data;
  assert.equal(p.scatter.resourceCount,1);assert.equal(p.scatter.jobs.length,4);assert.equal(stage(p,'SCATTER').state,CognitionStageState.COMPLETE);
});

test('multiple resources preserve logical job identity and concurrency',()=>{
  const p=fixtureAdapter(wave8MultiResourceFixture()).read().data;
  assert.equal(p.scatter.resourceCount,2);assert.equal(new Set(p.scatter.jobs.map(x=>x.capability)).size,4);assert.equal(stage(p,'SCATTER').state,CognitionStageState.COMPLETE);
});

test('candidate jobs admitted skipped deferred keep recorded reason codes',()=>{
  const x=normalizeCognitiveChoiceReceipt(wave8RetrievalHeavyFixture().cognitiveChoiceReceipt);
  assert.equal(x.admitted.find(j=>j.capability==='Historian').reason,'TEMPORAL_EVIDENCE_REQUIRED');
  assert.equal(x.skipped.find(j=>j.capability==='Jev').reason,'DETERMINISTIC_EVIDENCE_SUFFICIENT');
  assert.equal(x.deferred[0].reason,'BACKGROUND_SAFE');
});

test('Sensory receipt exposes 18 nominations 7 unique and channel counts without authority promotion',()=>{
  const x=normalizeSensoryReceipt(wave8RetrievalHeavyFixture().sensory);
  assert.equal(x.inputNominationCount,18);assert.equal(x.uniqueCandidateCount,7);assert.equal(x.duplicateNominationCount,11);
  assert.deepEqual(x.perChannelCounts,{SPARSE:6,DENSE:5,GRAPH:4,HISTORIAN:3});
  assert.equal(x.candidates.find(c=>c.candidateId==='cand:1').authority,'SOURCE_CANON');
  assert.equal(x.candidates.find(c=>c.candidateId==='cand:1').channelCount,2);
});

test('MIXED retrieval shows one bounded corrective pass',()=>{
  const f=wave8AmbiguousFixture(),truth=normalizeTruthAssessment(f.truth),correction=normalizeCorrectiveRetrievalReceipt(f.corrective,truth);
  assert.equal(truth.retrievalQuality,'MIXED');assert.equal(truth.corrective.maxAttempts,1);assert.equal(correction.executed,true);assert.equal(correction.attempt,1);assert.equal(correction.maxAttempts,1);assert.equal(correction.finalQuality,'MIXED');
});

test('LOW retrieval is a valid no-memory outcome rather than failure',()=>{
  const f=wave8RetrievalHeavyFixture();f.truth={...f.truth,confidence:'LOW',reason:'no useful current long-term memory is available',truthResults:[],admittedCandidateIds:[],supportCandidateIds:[]};f.sensory=null;f.precision=null;
  const p=fixtureAdapter(f).read().data;assert.equal(p.truth.retrievalQuality,'LOW');assert.equal(stage(p,'RETRIEVAL_QUALITY').state,CognitionStageState.COMPLETE);assert.notEqual(stage(p,'RETRIEVAL_QUALITY').state,CognitionStageState.FAILED);
});

test('Truth categories remain explicit across CURRENT HISTORICAL and UNRESOLVED',()=>{
  const x=normalizeTruthAssessment(wave8RetrievalHeavyFixture().truth);
  assert.equal(x.counts.CURRENT,3);assert.equal(x.counts.HISTORICAL,1);assert.equal(x.counts.UNRESOLVED,3);
});

test('Ember Tavern / Sun Blade acceptance preserves current historical and conflicting evidence',()=>{
  const p=fixtureAdapter(wave8AmbiguousFixture()).read().data;
  const texts=p.sensory.candidates.map(x=>x.representationText).filter(Boolean).join(' ');
  assert.match(texts,/Sun Blade was left at Ember Tavern/);assert.match(texts,/Ember Tavern was destroyed/);assert.match(texts,/removed before the fire/);assert.match(texts,/location is unknown/);
  assert.ok(p.truth.counts.UNRESOLVED>=1);assert.equal(p.jev.outcome,'ABSTAINED');
});

test('Precision used and skipped remain distinct',()=>{
  const used=fixtureAdapter(wave8RetrievalHeavyFixture()).read().data.precision,skipped=fixtureAdapter(wave8HotOnlyFixture()).read().data.precision;
  assert.equal(used.state,CognitionStageState.COMPLETE);assert.equal(used.inputCount,7);assert.equal(used.outputCount,5);
  assert.equal(skipped.state,CognitionStageState.SKIPPED);
});

test('Precision scores never become authority badges',()=>{
  const x=normalizePrecisionReceipt(wave8RetrievalHeavyFixture().precision);
  assert.equal(x.results[0].normalizedScore,1);assert.equal(x.authority,'READ_ONLY');assert.equal(x.results[0].authority,undefined);
});

test('Gather distinguishes admitted stale late rejected and invalid',()=>{
  const x=normalizeGatherReceipt(wave8DegradedFixture().gather);
  assert.equal(x.counts.ADMITTED,1);assert.equal(x.counts.STALE,1);assert.equal(x.counts.LATE,1);assert.equal(x.counts.INVALID,1);
  assert.equal(x.results.find(r=>r.status==='LATE').accepted,false);assert.equal(x.results.find(r=>r.status==='STALE').accepted,false);
});

test('stale Scene result is excluded from active generation',()=>{
  const p=fixtureAdapter(wave8DegradedFixture()).read().data,row=p.gather.results.find(x=>x.resultId==='result:scene-r18');
  assert.equal(row.status,'STALE');assert.equal(row.accepted,false);assert.equal(row.sceneRevision,18);assert.equal(p.seal.sceneRevision,19);
});

test('late Green Room result never becomes generation contributor',()=>{
  const p=fixtureAdapter(wave8DegradedFixture()).read().data,row=p.gather.results.find(x=>x.resultId==='result:green-late');
  assert.equal(row.status,'LATE');assert.equal(row.accepted,false);assert.equal(row.destination,'NEXT_TURN');assert.equal(p.seal.admittedResultIds.includes(row.resultId),false);
});

test('malformed result is INVALID and not admitted',()=>{
  const row=fixtureAdapter(wave8DegradedFixture()).read().data.gather.results.find(x=>x.resultId==='result:malformed');
  assert.equal(row.status,'INVALID');assert.equal(row.accepted,false);assert.match(row.reason,/failed validation/i);
});

test('Context Seal reports immutable generation boundary separately from late work',()=>{
  const p=fixtureAdapter(wave8DegradedFixture()).read().data;
  assert.equal(p.seal.sealedState,true);assert.deepEqual(p.seal.admittedResultIds,['result:historian']);assert.deepEqual(p.seal.staleResultIds,['result:scene-r18']);assert.ok(p.seal.lateResultIds.includes('result:green-late'));
});

test('PromptPlan contribution remains linked after Gather and Seal',()=>{
  const p=fixtureAdapter(wave8RetrievalHeavyFixture()).read().data;
  assert.equal(stage(p,'GATHER').state,CognitionStageState.COMPLETE);assert.equal(stage(p,'CONTEXT_SEAL').state,CognitionStageState.COMPLETE);assert.equal(stage(p,'PROMPT_PLAN').state,CognitionStageState.COMPLETE);assert.equal(p.summary.promptPlan.id,'plan:418');
});

test('production missing producers render UNAVAILABLE rather than synthetic cognition',()=>{
  const r=new Wave8CognitionProductionAdapter({}).read();
  assert.equal(r.source.mode,ProductDataMode.UNAVAILABLE);assert.equal(stage(r.data,'COGNITIVE_CHOICE').state,CognitionStageState.UNAVAILABLE);assert.equal(stage(r.data,'JEV').state,CognitionStageState.UNAVAILABLE);
});

test('explicit fixture path is marked FIXTURE at adapter and cognitive-path layers',()=>{
  const r=fixtureAdapter(wave8RetrievalHeavyFixture()).read();
  assert.equal(r.source.mode,ProductDataMode.FIXTURE);assert.equal(r.data.source.mode,ProductDataMode.FIXTURE);assert.equal(r.sources.choice.mode,ProductDataMode.FIXTURE);
});

test('Jev unavailable during degraded path does not force false adjudication or catastrophic state',()=>{
  const r=fixtureAdapter(wave8DegradedFixture()).read(),p=r.data;
  assert.equal(stage(p,'JEV').state,CognitionStageState.UNAVAILABLE);assert.ok(p.truth.counts.UNRESOLVED>0);assert.notEqual(p.source.health,'BLOCKED');
});

test('receipt-grounded Why never invents backend reasoning',()=>{
  const withReason=explainCognitionWhy({disposition:'SKIPPED',reason:'DETERMINISTIC_EVIDENCE_SUFFICIENT'}),without=explainCognitionWhy({disposition:'SKIPPED'});
  assert.match(withReason.summary,/DETERMINISTIC_EVIDENCE_SUFFICIENT/);assert.equal(without.available,true);assert.doesNotMatch(without.summary,/because|likely|probably/i);
});

test('Normal Brain cognition UI is meaning-first and hides provider/model IDs',()=>{
  const {host,scope}=renderFixture(wave8RetrievalHeavyFixture(),{detail:ProductDetailLevel.NORMAL});const t=textOf(host);
  assert.match(t,/Brain chose/);assert.match(t,/18 nominations/);assert.match(t,/Retrieval/);assert.match(t,/Truth/);assert.match(t,/Gather/);assert.match(t,/SEALED/);
  assert.doesNotMatch(t,/fixture-reranker|provider|model xyz|resource:1/);scope.cleanup();
});

test('Normal Hot-only UI says skipped rather than unavailable for explicit skipped stages',()=>{
  const {host,scope}=renderFixture(wave8HotOnlyFixture());const t=textOf(host);assert.match(t,/Hot Cognition/);assert.match(t,/Skipped/);assert.match(t,/CURRENT_WORKING_STATE_SUFFICIENT/);scope.cleanup();
});

test('Detail UI exposes cognitive mechanics and reason codes without worker wall',()=>{
  const {host,scope}=renderFixture(wave8RetrievalHeavyFixture(),{detail:ProductDetailLevel.DETAIL});const t=textOf(host);
  assert.match(t,/Cognitive Choice & job admission/);assert.match(t,/TEMPORAL_EVIDENCE_REQUIRED/);assert.match(t,/DETERMINISTIC_EVIDENCE_SUFFICIENT/);assert.match(t,/SPARSE/);assert.match(t,/HISTORIAN/);
  assert.doesNotMatch(t,/SC-01|SC-02|queue 213/);scope.cleanup();
});

test('Detail ambiguous UI separates Jev recommendation from owner settlement',()=>{
  const {host,scope}=renderFixture(wave8AmbiguousFixture(),{detail:ProductDetailLevel.DETAIL});const t=textOf(host);
  assert.match(t,/ABSTAINED/);assert.match(t,/Owner settlement/);assert.match(t,/NO_MUTATION/);assert.match(t,/not automatically canon or Settlement/);scope.cleanup();
});

test('degraded UI explains stale late invalid impact without fake catastrophic failure',()=>{
  const {host,scope}=renderFixture(wave8DegradedFixture(),{detail:ProductDetailLevel.DETAIL});const t=textOf(host);
  assert.match(t,/STALE/);assert.match(t,/LATE/);assert.match(t,/INVALID/);assert.match(t,/not included in this generation|excluded/i);scope.cleanup();
});

test('pipeline is keyboard-addressable and carries semantic aria labels',()=>{
  const {host,scope}=renderFixture(wave8RetrievalHeavyFixture());const stages=walk(host).filter(n=>String(n.className).split(/\s+/).includes('a52-wave8-stage'));
  assert.ok(stages.length>=10);assert.ok(stages.every(n=>n.tagName==='BUTTON'));assert.ok(stages.every(n=>String(n.attributes?.['aria-label']??'').length>0));scope.cleanup();
});

test('responsive WIDE COMPACT STACKED remain valid for Brain cognition workspace',()=>{
  assert.equal(resolveResponsiveMode(1440),ResponsiveMode.WIDE);assert.equal(resolveResponsiveMode(900),ResponsiveMode.COMPACT);assert.equal(resolveResponsiveMode(600),ResponsiveMode.STACKED);
});

test('large candidate/result collections remain virtualizable instead of 10k DOM rows',()=>{
  const f=wave8LargeFixture(10000),r=fixtureAdapter(f).read();assert.equal(r.data.sensory.candidates.length,10000);assert.equal(r.data.gather.results.length,10000);
  const win=computeVirtualWindow({count:10000,itemSize:54,viewportSize:540,scrollOffset:270000,overscan:8});assert.ok(win.end-win.start<=26);
});

test('typed Wave 8 binding seam reports real optional producers and validates functions',()=>{
  const bindings=createWave8ProductionBindings({readCognitiveChoiceReceipt:()=>({}),readCandidateBusEnvelope:()=>({}),readTruthAssessment:()=>({}),readJevDecisionReceipt:()=>({}),readPrecisionReceipt:()=>({}),readGatherReceipt:()=>({}),readContextSealReceipt:()=>({})});
  const a=describeWave8BindingAvailability(bindings);assert.equal(a.choice,true);assert.equal(a.sensory,true);assert.equal(a.truth,true);assert.equal(a.jev,true);assert.equal(a.precision,true);assert.equal(a.gather,true);assert.equal(a.contextSeal,true);
  assert.throws(()=>createWave8ProductionBindings({readJevDecisionReceipt:'bad'}),/must be a function/);
});

test('Action Router handles Wave 8 Why/Inspect/Open without mutation actions',async()=>{
  const router=new ActionRouter(),release=registerWave8Actions(router);const why=await router.route({type:'wave8.why',target:{item:{reason:'RECORDED',status:'SKIPPED'}}});
  assert.equal(why.ok,true);assert.match(why.result.summary,/RECORDED/);assert.equal(router.listActions().some(x=>/settle|mutate|canonize/i.test(x)),false);release();
});

test('full UI.Core runtime reuses one Brain workspace and cleans cognition subscription on destroy',()=>{
  let listener=null,releases=0;const fixture=wave8RetrievalHeavyFixture(),doc=new Doc(),root=new FakeNode('div',doc);
  const ui=createWave6ProductInterface({root,bridges:{cognition:{...readersFromFixture(fixture),subscribe(fn){listener=fn;return()=>{releases++;listener=null;};}}}});
  assert.ok(ui.workspaceRegistry.has('brain'));ui.shell.selectWorkspace('brain');assert.equal(ui.shell.currentWorkspace,'brain');assert.ok(ui.productionAdapters.cognition);
  listener?.({type:'COGNITION_UPDATED'});assert.ok(ui.scheduler.pendingCount<=2);ui.scheduler.flush(1);ui.destroy();assert.equal(releases,1);assert.equal(listener,null);assert.equal(root.children.length,0);
});

test('500 generation selections persist IDs only and avoid cognitive payload retention',()=>{
  const storage=mem(),stateStore=new UIStateStore({storage,namespace:'wave8-selection'}),p=new ExplainabilityPresentationState({stateStore});
  for(let i=0;i<500;i++)p.selectGeneration({generationId:'gen:'+i,turnId:'turn:'+i});
  const raw=storage.m.get('wave8-selection');assert.match(raw,/gen:499/);assert.doesNotMatch(raw,/representationText|rankSignals|rawDiagnostic/);
});

test('Wave 8 CSS preserves structural status grammar and reduced motion',async()=>{
  const css=await readFile(new URL('../styles/ui-core-wave8.css',import.meta.url),'utf8');
  assert.match(css,/data-state=SKIPPED/);assert.match(css,/border-left-style:dashed/);assert.match(css,/data-status=LATE/);assert.match(css,/prefers-reduced-motion:reduce/);assert.doesNotMatch(css,/font-family\s*:/);
});

test('Wave 8 production modules are browser-facing and execute with Buffer unavailable',async()=>{
  const names=['wave8-cognition.js','wave8-production-adapters.js','wave8-bindings.js','wave8-workspace.js'];
  for(const name of names){const src=await readFile(new URL(`../src/ui-core/${name}`,import.meta.url),'utf8');assert.doesNotMatch(src,/from ['"]node:/);assert.doesNotMatch(src,/\brequire\s*\(/);assert.doesNotMatch(src,/\bprocess\./);}
  const prior=globalThis.Buffer;try{globalThis.Buffer=undefined;const mod=await import('../src/ui-core/wave8-cognition.js?browser-wave8');assert.equal(mod.CognitionStageState.SKIPPED,'SKIPPED');}finally{globalThis.Buffer=prior;}
});

function readersFromFixture(f){
  return{
    readCognitiveChoiceReceipt:()=>f.cognitiveChoiceReceipt??f.choice??null,readScatterReceipt:()=>f.scatter??null,readSensoryTrace:()=>f.sensory??null,
    readTruthAssessment:()=>f.truth??null,readCorrectiveRetrievalReceipt:()=>f.corrective??null,readJevDecisionReceipt:()=>f.jev??null,
    readPrecisionReceipt:()=>f.precision??null,readGatherReceipt:()=>f.gather??null,readContextSealReceipt:()=>f.seal??null,readLoreStatus:()=>f.lore??null,
  };
}


const canonicalChoiceReceipt=()=>({
  kind:'CognitiveChoiceReceipt',contractVersion:'1.0.0',id:'cognitive-choice:canonical',receiptRevision:1,turnId:'turn:canonical',turnRevision:4,correlationId:'corr:canonical',
  paths:['STANDARD_RETRIEVAL','BOUNDED_AMBIGUITY'],
  consideredCognitionOptions:['CONTEXT_COMPILER','CONTEXT_SEAL','RETRIEVAL','TRUTH','GATHER','JEV','PRECISION','HISTORIAN','DEEP_COGNITION'],
  admittedJobs:['CONTEXT_COMPILER','CONTEXT_SEAL','RETRIEVAL','TRUTH','GATHER','JEV'],
  skippedJobs:['PRECISION','HISTORIAN'],deferredJobs:['DEEP_COGNITION'],
  reasonCodes:['RETRIEVAL_MIXED','JEV_REQUIRED','JEV_ABSTAINED','PRECISION_NOT_REQUIRED','DEFER_BACKGROUND'],
  retrievalIntents:['intent:possession'],sensoryChannelsRequested:['SPARSE','DENSE','GRAPH'],sensoryChannelsUsed:['SPARSE','DENSE'],
  candidateCounts:{nominated:18,normalized:18,deduplicated:7,truthAdmitted:7,precisionAdmitted:7,finalGenerationFacing:5},
  retrievalQuality:'MIXED',correctiveRetrieval:{requested:true,executed:true,correctionCount:1,maxCorrections:1,failed:false,result:'MIXED'},
  truthGate:{considered:true,invoked:true,skipped:false,outcomeCounts:{CURRENT:5,HISTORICAL:1,SUPERSEDED:0,CONTRADICTED:0,UNCERTAIN:0,UNRESOLVED:1},admittedCandidateIds:['cand:1'],supportCandidateIds:['cand:2']},
  jev:{considered:true,invoked:true,skipped:false,unavailable:false,abstained:true,action:'JEV_ABSTAINED',reason:'JEV_ABSTAINED',alternativeCount:2,request:{kind:'JevInvocationRequest'},decisionRevision:3,resultRef:'jev:canonical'},
  precision:{considered:true,invoked:false,skipped:true,required:false,available:true,fallback:false,failed:false,resultCount:0,reason:'PRECISION_NOT_REQUIRED'},
  finalEvidenceRefs:['e:1','e:2','e:3','e:4','e:5'],abstained:false,unresolved:true,
  latencyResourceBudget:{budgetBytes:64000,controllerOverheadMs:3},revisions:{turnRevision:4,sceneRevision:19,worldRevision:52,sourceRevisionRefs:['scene:r19','lore:r6'],candidateRevisionRefs:['cand@1'],retrievalRepresentationRevisionRefs:['rep@6'],truthInputCandidateIds:['cand:1'],jevDecisionRevision:3,contextSealRevision:418},
  freshness:{candidateSet:'FRESH',staleNominationCount:0,invalidNominationCount:0,staleResultCount:0,invalidResultCount:0},
  seal:{sealed:true,sealReceiptId:'seal:canonical',sequence:418,packetId:'packet:canonical',packetHash:'hash:canonical',publicationBoundary:'CLOSED'},
  lateResultIds:[],staleResultIds:[],invalidResultIds:[],metadata:{intent:'CURRENT'},
  truthAuthority:false,settlementAuthority:false,canonicalMutationAuthority:false,contextSealBypass:false,
});

const canonicalJevReceipt=(overrides={})=>({
  kind:'JevDecisionReceipt',contractVersion:'1.0.0',decisionId:'jev:canonical',decisionType:'POSSESSION_AMBIGUITY',decisionShape:'CHOOSE_ONE',
  selectedOptionIds:[],rejectedOptionIds:[],decisionCode:'ABSTAIN',classification:null,reasonCodes:['INSUFFICIENT_EVIDENCE'],evidenceUsed:['e:3','e:4'],
  unresolvedFactors:['No fresh possession observation'],confidence:.44,abstained:true,outcome:'ABSTAINED',serviceStatus:'JEV_ABSTAINED',
  escalationTarget:null,requiresOwnerSettlement:false,requiresOperator:false,
  revisionFence:{sourceRevisionSet:['lore:r6'],worldRevision:52,sceneRevision:19,characterStateRevision:8,domainRevisions:{LORE:6}},
  freshnessToken:'fresh:jev:canonical',providerProvenance:{providerProfileId:'profile:1',providerId:'provider:1',modelId:'model:1',workerId:'resource:1'},
  validationStatus:{schema:'PASS',deterministic:'PASS',freshness:'FRESH'},latencyMetadata:{providerLatencyMs:30,validationLatencyMs:1,totalLatencyMs:31,attempts:1},
  admission:{foregroundEligible:true,late:false,destination:'FOREGROUND',reasonCode:null},explanation:'Evidence cannot safely decide between the surviving options.',
  requestFingerprint:'jev:fingerprint',authorityGranted:false,canonicalMutation:false,settlementPerformed:false,...overrides,
});

test('canonical Worker-1 CognitiveChoiceReceipt v1 maps exact fields without per-job reason invention',()=>{
  const x=normalizeCognitiveChoiceReceipt(canonicalChoiceReceipt());
  assert.equal(x.contractVersion,'1.0.0');assert.equal(x.receiptId,'cognitive-choice:canonical');assert.equal(x.turnRevision,4);
  assert.match(x.brainChoice,/Standard Retrieval/);assert.match(x.brainChoice,/Bounded Ambiguity/);
  assert.equal(x.candidateJobs.length,9);assert.equal(x.admitted.length,6);assert.equal(x.skipped.length,2);assert.equal(x.deferred.length,1);
  assert.equal(x.admitted.find(j=>j.capability==='Retrieval').reason,null);
  assert.equal(x.retrievalDecision.invoked,true);assert.equal(x.truthDecision.outcomeCounts.CURRENT,5);
  assert.equal(x.jevDecision.action,'JEV_ABSTAINED');assert.equal(x.precisionDecision.skipped,true);assert.equal(x.gatherDecision.invoked,true);
  assert.equal(x.candidateCounts.deduplicated,7);assert.deepEqual(x.sensoryChannelsUsed,['SPARSE','DENSE']);
  assert.equal(x.truthAuthority,false);assert.equal(x.settlementAuthority,false);assert.equal(x.mutationAuthority,false);
});

test('canonical CognitiveChoiceReceipt alone can drive honest Normal-stage summaries while deep receipts remain optional',()=>{
  const a=new Wave8CognitionProductionAdapter({readCognitiveChoiceReceipt:canonicalChoiceReceipt}),r=a.read(),p=r.data;
  assert.equal(r.sources.choice.mode,ProductDataMode.LIVE);assert.equal(r.sources.sensory.mode,ProductDataMode.LIVE);assert.equal(r.sources.truth.mode,ProductDataMode.LIVE);
  assert.equal(p.sensory.inputNominationCount,18);assert.equal(p.sensory.uniqueCandidateCount,7);assert.equal(p.sensory.summaryOnly,true);
  assert.equal(p.truth.retrievalQuality,'MIXED');assert.equal(p.truth.counts.CURRENT,5);assert.equal(p.truth.counts.UNRESOLVED,1);assert.equal(p.truth.summaryOnly,true);
  assert.equal(p.corrective.executed,true);assert.equal(p.corrective.maxAttempts,1);
  assert.equal(p.jev.outcome,'ABSTAINED');assert.equal(p.precision.state,CognitionStageState.SKIPPED);
  assert.equal(p.gather.counts.ADMITTED,5);assert.equal(p.gather.summaryOnly,true);assert.equal(p.seal.sealedState,true);assert.equal(p.seal.admittedEvidenceCount,5);
  assert.equal(stage(p,'SCATTER').state,CognitionStageState.UNAVAILABLE);
});

test('canonical Worker-2 JevDecisionReceipt v1 preserves service status evidence provenance and non-authority flags',()=>{
  const x=normalizeJevDecisionReceipt(canonicalJevReceipt());
  assert.equal(x.receiptId,'jev:canonical');assert.equal(x.state,CognitionStageState.COMPLETE);assert.equal(x.outcome,'ABSTAINED');
  assert.deepEqual(x.evidenceRefs,['e:3','e:4']);assert.equal(x.reasonCodes[0],'INSUFFICIENT_EVIDENCE');assert.match(x.reason,/cannot safely decide/);
  assert.equal(x.requiresOwnerSettlement,false);assert.equal(x.requiresOperatorReview,false);assert.equal(x.provider,'provider:1');assert.equal(x.model,'model:1');assert.equal(x.resourceId,'resource:1');
  assert.equal(x.admission.foregroundEligible,true);assert.equal(x.settlementPerformed,false);assert.equal(x.authorityGranted,false);assert.equal(x.mutationAuthority,false);
});

test('canonical Jev service SKIPPED and UNAVAILABLE remain distinct and recorded outage degrades the path safely',()=>{
  const skipped=normalizeJevDecisionReceipt(canonicalJevReceipt({outcome:'UNRESOLVED',serviceStatus:'JEV_SKIPPED',decisionCode:'UNRESOLVED',reasonCodes:['DETERMINISTIC_RESULT_SUFFICIENT'],abstained:false,explanation:''}));
  const unavailableReceipt=canonicalJevReceipt({outcome:'UNRESOLVED',serviceStatus:'JEV_UNAVAILABLE',decisionCode:'UNRESOLVED',reasonCodes:['PROVIDER_UNAVAILABLE'],abstained:false,explanation:'Jev provider execution unavailable'});
  const unavailable=normalizeJevDecisionReceipt(unavailableReceipt);
  assert.equal(skipped.state,CognitionStageState.SKIPPED);assert.equal(unavailable.state,CognitionStageState.UNAVAILABLE);
  const choice=canonicalChoiceReceipt(),a=new Wave8CognitionProductionAdapter({readCognitiveChoiceReceipt:()=>choice,readJevDecisionReceipt:()=>unavailableReceipt}),p=a.read().data;
  assert.equal(stage(p,'JEV').state,CognitionStageState.UNAVAILABLE);assert.equal(p.source.mode,ProductDataMode.DEGRADED);assert.equal(p.source.health,'DEGRADED');
});
