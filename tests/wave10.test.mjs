import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ForensicsProductionUIAdapter, FrontFaceMode, ProductDataMode, ProductDetailLevel, PromptPlanProductionUIAdapter,
  UIStateStore, Wave6Health, buildForensicPath, createWave6ProductInterface,
} from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';
import { createReviewScenarios } from '../demo/phase2-shell/scenarios/index.js';
import { createWave10TraceFixture } from '../demo/phase2-shell/scenarios/wave10-context-trace.js';
import { installPhase2ReviewWorkspaces } from '../demo/phase2-shell/review-workspaces.js';

class Doc extends FakeDocument{createDocumentFragment(){return new FakeNode('fragment',this);}}
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const textOf=node=>[node?.textContent??'',...(node?.children??[]).map(textOf)].filter(Boolean).join(' ');
const walk=node=>[node,...(node?.children??[]).flatMap(walk)];

function mount(id='ambiguous'){
  const rec=createReviewScenarios().get(id),doc=new Doc(),root=new FakeNode('div',doc),stateStore=new UIStateStore({storage:memory(),namespace:`wave10:${id}`});
  const ui=createWave6ProductInterface({root,stateStore,fixture:rec.product,bridges:{...(rec.bridges??{}),cognition:rec.cognition?{fixture:rec.cognition}:{}}});
  installPhase2ReviewWorkspaces(ui);ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:720});ui.productAdapter.setDetailLevel(ProductDetailLevel.NORMAL);ui.shell.selectWorkspace('brain');ui.scheduler.flush(0);
  return{rec,doc,root,ui};
}

test('#145 Brain normal view answers why this generation received its context',()=>{
  const{ui}=mount('ambiguous'),t=textOf(ui.shell.nodes.workspace);
  assert.match(t,/Why did this generation receive this context/);assert.match(t,/27,800 \/ 32,000/);assert.match(t,/reused/);assert.match(t,/rebuilt/);assert.match(t,/dropped/);assert.match(t,/deferred/);
  assert.match(t,/RP-LONG-CONTEXT-v3/);assert.match(t,/Final packet estimate/);assert.match(t,/Unresolved evidence/);assert.match(t,/FIXTURE/);ui.destroy();
});

test('#145 generation workspace shows ordered allocations and owner-published reasons without raw payloads',()=>{
  const{ui}=mount('ambiguous');ui.shell.selectWorkspace('generation-explainability');ui.scheduler.flush(1);const t=textOf(ui.shell.nodes.workspace);
  assert.match(t,/Available budget/);assert.match(t,/32,000 tokens/);assert.match(t,/Current Scene/);assert.match(t,/4,200 tokens/);assert.match(t,/scene revision changed/i);
  assert.match(t,/Ambient Lore/);assert.match(t,/Background Reflection/);assert.doesNotMatch(t,/providerDetail|rawDiagnosticCode/);ui.destroy();
});

test('#145 Brain Inspector drills from summary into evidence revisions authority and decision trail',()=>{
  const{ui}=mount('ambiguous');ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);ui.shell.refreshCurrentWorkspace();ui.scheduler.flush(1);
  const button=walk(ui.shell.nodes.workspace).find(n=>n.tagName==='BUTTON'&&textOf(n).includes('Inspect context plan'));assert.ok(button);button.dispatch('click');ui.scheduler.flush(2);
  const t=textOf(ui.shell.nodes.inspectorHost);assert.match(t,/Ordered context sections/);assert.match(t,/Evidence and revision fences/);assert.match(t,/Source revisions/);assert.match(t,/Decision trail/);assert.match(t,/Owner Settlement/);assert.match(t,/UNRESOLVED/);assert.match(t,/Late work stayed outside/);ui.destroy();
});

test('#152 Ember Tavern trace reconstructs the recorded source-to-seal path and preserves UNRESOLVED settlement',()=>{
  const fixture=createWave10TraceFixture('ambiguous'),adapter=new ForensicsProductionUIAdapter(fixture.bindings.forensics),read=adapter.readGeneration('gen:418'),path=buildForensicPath(read.data.timeline);
  assert.equal(read.source.mode,ProductDataMode.FIXTURE);assert.deepEqual(path.steps.map(x=>x.label),['Source','Proposal','Validation','Owner Settlement','State / Reflection','Retrieval','Compiled Context','Context Seal']);
  assert.equal(path.steps.find(x=>x.key==='settlement').status,'UNRESOLVED');assert.equal(path.steps.find(x=>x.key==='settlement').authority.authority,'UNRESOLVED');assert.equal(path.steps.find(x=>x.key==='seal').status,'ACCEPTED');
  assert.deepEqual(path.lateAfterSeal,['tx:late']);adapter.destroy();
});

test('#152 sealed ContextReceipt keeps competing Sun Blade claims unresolved and excludes late work',()=>{
  const fixture=createWave10TraceFixture('ambiguous'),adapter=new PromptPlanProductionUIAdapter(fixture.bindings.promptPlan),read=adapter.read({generationId:'gen:418'}),x=read.data.explainability;
  assert.equal(read.source.mode,ProductDataMode.FIXTURE);assert.equal(x.unresolvedEvidence[0].authority,'UNRESOLVED');assert.equal(x.unresolvedEvidence[0].alternatives.length,2);
  assert.equal(x.sections.find(s=>s.slot==='UNRESOLVED_EVIDENCE').authority,'UNRESOLVED');assert.equal(fixture.contextSeal.admittedResultIds.includes('result:green-room'),false);assert.equal(fixture.contextSeal.lateResultIds.includes('result:green-room'),true);
});

test('#152 workspace presents the connected path and explicitly contains late work',()=>{
  const{ui}=mount('ambiguous');ui.shell.selectWorkspace('forensics');ui.scheduler.flush(1);const t=textOf(ui.shell.nodes.workspace);
  for(const label of ['Generation path','Source','Proposal','Validation','Owner Settlement','State / Reflection','Retrieval','Compiled Context','Context Seal'])assert.match(t,new RegExp(label.replace('/','\\/')));
  assert.match(t,/Late result contained/);assert.match(t,/did not alter the sealed generation/);assert.match(t,/Cognitive timeline/);ui.destroy();
});

test('loading stale degraded and missing-provider states remain distinct and fixture-safe',()=>{
  const scenarios=createReviewScenarios();
  const loading=new PromptPlanProductionUIAdapter(scenarios.get('loading').bridges.promptPlan).read();assert.equal(loading.source.mode,ProductDataMode.FIXTURE);assert.equal(loading.source.health,Wave6Health.WORKING);assert.equal(loading.data.seal,null);
  const stale=new PromptPlanProductionUIAdapter(scenarios.get('stale').bridges.promptPlan).read();assert.equal(stale.source.mode,ProductDataMode.FIXTURE);assert.equal(stale.source.health,Wave6Health.STALE);
  const degraded=new PromptPlanProductionUIAdapter(scenarios.get('degraded').bridges.promptPlan).read();assert.equal(degraded.source.mode,ProductDataMode.FIXTURE);assert.equal(degraded.source.health,Wave6Health.DEGRADED);assert.equal(degraded.data.explainability.fallbackState,'COPROCESSOR_TIMEOUT');
  const empty=new PromptPlanProductionUIAdapter(scenarios.get('empty').bridges.promptPlan).read();assert.equal(empty.source.mode,ProductDataMode.UNAVAILABLE);
});

test('partial forensic reader shows missing semantic steps rather than fabricating completion',()=>{
  const rec=createReviewScenarios().get('loading'),adapter=new ForensicsProductionUIAdapter(rec.bridges.forensics),read=adapter.readGeneration('gen:418'),path=buildForensicPath(read.data.timeline);
  assert.equal(read.source.mode,ProductDataMode.FIXTURE);assert.equal(read.data.timeline.complete,false);assert.ok(path.steps.some(x=>x.status==='MISSING'));assert.equal(path.steps.find(x=>x.key==='seal').status,'MISSING');adapter.destroy();
});

test('raw forensic/provider payload remains hidden until Advanced inspection',()=>{
  const{ui,rec}=mount('ambiguous'),adapter=new ForensicsProductionUIAdapter(rec.bridges.forensics),item=adapter.readGeneration('gen:418').data.timeline.rows.find(x=>x.id==='tx:validation');assert.equal(item.rawPayloadAvailable,true);
  const select=()=>{ui.signals.publish('UI_INSPECT_SELECTION_CHANGED',{object:{kind:'wave7-forensic-item',id:item.id,title:'Proposal Validated',item}},{source:'wave10-test'});ui.scheduler.flush(2);};
  select();let t=textOf(ui.shell.nodes.inspectorHost);assert.match(t,/Raw diagnostic detail is available in Advanced view only/);assert.doesNotMatch(t,/providerDetail|rawDiagnosticCode/);
  ui.productAdapter.setDetailLevel(ProductDetailLevel.ADVANCED);select();t=textOf(ui.shell.nodes.inspectorHost);assert.match(t,/Load raw diagnostic detail/);assert.doesNotMatch(t,/providerDetail|rawDiagnosticCode/);
  adapter.destroy();ui.destroy();
});

test('Wave 10 remains observational: no correction/settlement mutation action is registered by the explainability layer',()=>{
  const{ui}=mount('ambiguous'),actions=ui.actionRouter.listActions().filter(x=>x.startsWith('wave7.'));
  assert.deepEqual(actions.sort(),['wave7.inspect','wave7.openWorkspace','wave7.selectGeneration','wave7.why'].sort());assert.equal(actions.some(x=>/correct|mutat|settle|override/i.test(x)),false);ui.destroy();
});

test('Wave 10 adds whole-shell loading/stale review states without removing Wave 9 scenarios',()=>{
  const s=createReviewScenarios();for(const id of ['healthy','hot-only','retrieval-heavy','ambiguous','degraded','empty','loading','stale'])assert.ok(s.has(id));for(const x of s.values())assert.equal(x.mode,'FIXTURE');
});
