import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ActionRouter,
  ApplicationShell,
  FrontFaceUIAdapter,
  InspectorRegistry,
  KnowledgeStatus,
  NotificationCenter,
  ProductActivityFeed,
  ProductDetailLevel,
  ProductPresentationState,
  ResourceScope,
  SignalHub,
  Signals,
  UIExtensionAvailability,
  UIExtensionRegistry,
  WorkspaceRegistry,
  createWave5ProductFixture,
  normalizeProductSnapshot,
  registerWave5FrontFaceWorkspaces,
  translateProductActivity,
} from '../src/ui-core/index.js';
import { createSyntheticUnknownExtension, FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

function adapter(name = 'healthy-active-story', stateStore = null) {
  return new FrontFaceUIAdapter({ snapshot:createWave5ProductFixture(name), presentationState:new ProductPresentationState({ stateStore }) });
}
function render(id, productAdapter, { registry = null, extensionRegistry = null, extra = {} } = {}) {
  const workspaceRegistry = registry ?? new WorkspaceRegistry();
  if (!workspaceRegistry.has(id)) registerWave5FrontFaceWorkspaces(workspaceRegistry, { adapter:productAdapter, extensionRegistry });
  const doc = new FakeDocument(); const host = new FakeNode('main', doc); const scope = new ResourceScope(); const inspected=[]; const navigated=[];
  workspaceRegistry.get(id).render(host, { scope, signals:new SignalHub(), productActivity:{list(){return[];}}, inspect:(o)=>inspected.push(o), navigate:(x)=>navigated.push(x), ...extra });
  return { doc, host, scope, inspected, navigated, workspaceRegistry };
}
function textOf(node) { return [node?.textContent ?? '', ...(node?.children ?? []).map(textOf)].filter(Boolean).join(' '); }
function walk(node) { return [node, ...(node?.children ?? []).flatMap(walk)]; }
function extensionHarness() {
  const workspaceRegistry=new WorkspaceRegistry(); const inspectorRegistry=new InspectorRegistry(); const actionRouter=new ActionRouter();
  const registry=new UIExtensionRegistry({ workspaceRegistry, inspectorRegistry, actionRouter, scheduler:{cancelPrefix(){}} });
  return { workspaceRegistry, inspectorRegistry, actionRouter, registry };
}

test('Wave 5 detail level is presentation-only and persists through UI state', () => {
  const saved=[]; const store={ load(){return{};}, save(p){saved.push(p);return p;} }; const p=new ProductPresentationState({stateStore:store});
  const before=createWave5ProductFixture(); const a=new FrontFaceUIAdapter({snapshot:before,presentationState:p});
  assert.equal(a.getDetailLevel(),ProductDetailLevel.NORMAL); a.setDetailLevel(ProductDetailLevel.ADVANCED);
  assert.equal(a.getDetailLevel(),ProductDetailLevel.ADVANCED); assert.deepEqual(saved.at(-1),{productDetailLevel:'ADVANCED'}); assert.equal(a.getSnapshot().world.conflict.current,'Unknown');
});

test('invalid detail level and inferred-as-canonical atmosphere fail safely', () => {
  assert.throws(()=>new ProductPresentationState({defaultLevel:'RAW'}),/Invalid default detail level/);
  const s=createWave5ProductFixture(); s.scene.atmosphere={...s.scene.atmosphere,authority:KnowledgeStatus.CANONICAL,inferred:true};
  assert.throws(()=>normalizeProductSnapshot(s),/Inferred atmosphere cannot be marked canonical/);
});

test('required Wave 5 fixtures cover healthy, background, uncertainty, degraded, conflict, no-scene and large-world states', () => {
  for(const name of ['healthy-active-story','background-work','legitimate-uncertainty','degraded-subsystem','conflict','no-active-scene','large-world']) assert.equal(createWave5ProductFixture(name).fixtureId,`wave5.${name}`);
  assert.equal(createWave5ProductFixture('no-active-scene').scene,null); assert.equal(createWave5ProductFixture('degraded-subsystem').coprocessor.available,false);
});

test('Ember Tavern acceptance never promotes historical Sun Blade location to current truth', () => {
  const s=createWave5ProductFixture(); const blade=s.world.entities.find(x=>x.id==='sun-blade');
  assert.equal(blade.current,'Unknown'); assert.deepEqual(blade.history,['Left at Ember Tavern']); assert.equal(s.world.conflict.settlement,KnowledgeStatus.UNRESOLVED);
  assert.deepEqual(s.world.conflict.evidence.map(x=>x.claim),['Destroyed in fire','Removed before fire']);
});

test('large-world fixture stays summary-shaped instead of materializing backing records', () => {
  const s=createWave5ProductFixture('large-world'); assert.equal(s.world.counts.knowledgeArtifacts,10000); assert.equal(s.runtime.backingCounts.workLedgerTasks,12000);
  assert.equal(Array.isArray(s.world.records),false); assert.equal(Array.isArray(s.runtime.ledger),false);
});

test('Brain Activity translates runtime lifecycle into product language', () => {
  assert.match(translateProductActivity({type:Signals.WORKER_STATE_CHANGED,payload:{workerId:'w',state:'PARKED',layer:'L3'}}).message,/Background work paused/);
  assert.match(translateProductActivity({type:Signals.WORKER_STATE_CHANGED,payload:{workerId:'w',state:'ACTIVE',layer:'L1'}}).message,/Foreground cognition/);
});

test('1,500 rapid activity transitions coalesce to one product render invalidation', () => {
  const jobs=new Map(); const scheduler={invalidate(key,fn){jobs.set(key,fn);}}; let renders=0; const feed=new ProductActivityFeed({scheduler,onUpdate(){renders+=1;}});
  for(let i=0;i<1500;i+=1) feed.push({key:'worker:w1',status:'active',message:`Background transition ${i}`});
  assert.equal(jobs.size,1); assert.equal(feed.pendingCount,1); jobs.get('wave5:product-activity')(); assert.equal(renders,1); assert.equal(feed.list().length,1); assert.match(feed.list()[0].message,/1499/);
});

test('Front Face registers ordered product navigation without unregistering engineering workspaces', () => {
  const r=new WorkspaceRegistry(); r.register({id:'runtime',title:'Runtime',render(){}}); registerWave5FrontFaceWorkspaces(r,{adapter:adapter()});
  assert.deepEqual(r.list({navigationLevel:'product'}).map(x=>x.id),['home','story','characters','lore','memory-product','world-product','brain']); assert.equal(r.has('runtime'),true);
});

test('ApplicationShell starts on Home when product navigation exists even if old persisted workspace is engineering-only', () => {
  const r=new WorkspaceRegistry(); r.register({id:'runtime',title:'Runtime',render(){}}); registerWave5FrontFaceWorkspaces(r,{adapter:adapter()});
  const doc=new FakeDocument(),root=new FakeNode('div',doc),signals=new SignalHub(); let rendered=null;
  const shell=new ApplicationShell({root,workspaceRegistry:r,inspector:{host:null,mount(){},destroy(){}},signals,stateStore:{load(){return{selectedWorkspace:'runtime'};},save(){}},renderWorkspace(e){rendered=e.id;}}).mount();
  assert.equal(shell.currentWorkspace,'home'); assert.equal(rendered,'home'); assert.deepEqual(shell.nodes.nav.querySelectorAll('[data-workspace-id]').map(x=>x.dataset.workspaceId),['home','story','characters','lore','memory-product','world-product','brain']); shell.destroy();
});

test('Scene Normal stays concise and marks inferred tone; Advanced exposes inspection path', () => {
  const a=adapter(); let r=render('story',a); let t=textOf(r.host); assert.match(t,/East Tower/); assert.match(t,/inferred/i); assert.equal(t.includes('Scene ID'),false); r.scope.cleanup();
  a.setDetailLevel(ProductDetailLevel.ADVANCED); r=render('story',a); t=textOf(r.host); assert.match(t,/Scene ID/); const button=walk(r.host).find(n=>n.textContent==='Inspect Scene Intelligence'); button.dispatch('click'); assert.equal(r.inspected[0].kind,'current-scene'); r.scope.cleanup();
});

test('Characters visibly retain inferred relationship authority', () => { const r=render('characters',adapter()); const t=textOf(r.host); assert.match(t,/Growing trust/); assert.match(t,/inferred/i); r.scope.cleanup(); });

test('Lore Front Face preserves tree representation and progressively discloses semantic fixture data', () => {
  const a=adapter(); let r=render('lore',a); assert.match(textOf(r.host),/Characters/); assert.match(textOf(r.host),/Nanahoshi/); r.scope.cleanup();
  a.setDetailLevel(ProductDetailLevel.ADVANCED); r=render('lore',a); const t=textOf(r.host); assert.match(t,/Brain Understanding/); assert.match(t,/Lore change impact/); assert.match(t,/FIXTURE/); r.scope.cleanup();
});

test('Memory Front Face exposes inference and says reconsolidation did not change canonical truth', () => {
  const a=adapter(); a.setDetailLevel(ProductDetailLevel.ADVANCED); const r=render('memory-product',a); const t=textOf(r.host); assert.match(t,/Area-52 learned a pattern/); assert.match(t,/inferred/i); assert.match(t,/Canonical truth changed/); assert.match(t,/NO/); r.scope.cleanup();
});

test('World Front Face keeps current and historical Sun Blade state separate', () => {
  const a=adapter(); a.setDetailLevel(ProductDetailLevel.DETAIL); const r=render('world-product',a); const t=textOf(r.host); assert.match(t,/Sun Blade/); assert.match(t,/Current Unknown/); assert.match(t,/History Left at Ember Tavern/); assert.match(t,/Historically Left at Ember Tavern/); assert.match(t,/Settlement UNRESOLVED/); r.scope.cleanup();
});

test('Brain gateway discovers engineering workspaces generically instead of hardcoding subsystem names', () => {
  const a=adapter(),registry=new WorkspaceRegistry(); registry.register({id:'future-engine',title:'Future Engine',category:'Synthetic',render(){}}); registerWave5FrontFaceWorkspaces(registry,{adapter:a}); const r=render('brain',a,{registry});
  assert.match(textOf(r.host),/Future Engine/); const open=walk(r.host).find(n=>n.textContent==='Open'); open.dispatch('click'); assert.equal(r.navigated[0],'future-engine'); r.scope.cleanup();
});

test('unknown extension contributes a lightweight Front Face summary and unregister removes it', () => {
  const h=extensionHarness(),signals=new SignalHub(),x=createSyntheticUnknownExtension(signals); h.registry.register(x.descriptor,x.binding);
  const list=h.registry.listFrontFaceContributions('summaries'); assert.equal(list.length,1); assert.equal(list[0].contribution.id,x.ids.frontFaceSummaryId);
  const value=h.registry.readFrontFaceContribution(x.ids.extensionId,'summaries',x.ids.frontFaceSummaryId); assert.equal(value.value,'Market stable'); assert.equal(Object.isFrozen(value),true);
  h.registry.unregister(x.ids.extensionId); assert.equal(h.registry.listFrontFaceContributions('summaries').length,0);
});

test('unavailable extension summary returns null without removing extension registration', () => {
  const h=extensionHarness(),x=createSyntheticUnknownExtension(new SignalHub()); h.registry.register(x.descriptor,x.binding); h.registry.update(x.ids.extensionId,{availability:UIExtensionAvailability.UNAVAILABLE});
  assert.equal(h.registry.readFrontFaceContribution(x.ids.extensionId,'summaries',x.ids.frontFaceSummaryId),null); assert.equal(h.registry.has(x.ids.extensionId),true); h.registry.destroy();
});

test('Front Face descriptor remains data-only and executable manifest logic is rejected', () => {
  const h=extensionHarness(),x=createSyntheticUnknownExtension(new SignalHub()); const bad={...x.descriptor,frontFace:{summaries:[{...x.descriptor.frontFace.summaries[0],run(){}}]}};
  assert.throws(()=>h.registry.register(bad,x.binding),/Executable function/);
});

test('Home consumes an unknown extension summary generically without shell hardcoding', () => {
  const h=extensionHarness(),signals=new SignalHub(),x=createSyntheticUnknownExtension(signals); h.registry.register(x.descriptor,x.binding); const product=adapter(); registerWave5FrontFaceWorkspaces(h.workspaceRegistry,{adapter:product,extensionRegistry:h.registry});
  const doc=new FakeDocument(),host=new FakeNode('main',doc),scope=new ResourceScope(); h.workspaceRegistry.get('home').render(host,{scope,productActivity:{list(){return[];}}});
  assert.match(textOf(host),/World Economy/); assert.match(textOf(host),/Market stable/); scope.cleanup(); h.registry.destroy();
});

test('NotificationCenter supports acknowledge, dismiss and cleanup without replaying toast notifications', () => {
  const signals=new SignalHub(),center=new NotificationCenter({signals}); const changes=[]; let toasts=0; signals.subscribe(Signals.UI_NOTIFICATION,()=>toasts+=1); signals.subscribe(Signals.UI_NOTIFICATION_CHANGED,e=>changes.push(e.payload.action));
  center.push({id:'n1',title:'Conflict found'}); center.acknowledge('n1'); assert.equal(center.list()[0].acknowledged,true); assert.equal(toasts,1); center.dismiss('n1'); assert.equal(center.list().length,0); center.push({id:'n2'}); center.clear(); assert.deepEqual(changes,['acknowledged','dismissed','cleared']);
});

test('Home exposes acknowledge and dismiss controls for live operator notifications', () => {
  const signals=new SignalHub(),center=new NotificationCenter({signals}); center.push({id:'live-1',status:'warning',title:'Conflict found',message:'Two sources disagree.'});
  const a=adapter(); const r=render('home',a,{extra:{notifications:center}}); const ack=walk(r.host).find(n=>n.textContent==='Acknowledge'); const dismiss=walk(r.host).find(n=>n.textContent==='Dismiss');
  assert.ok(ack); assert.ok(dismiss); ack.dispatch('click'); assert.equal(center.list()[0].acknowledged,true); dismiss.dispatch('click'); assert.equal(center.list().length,0); r.scope.cleanup();
});

test('PromptPlan presentation is explicitly fixture-backed and does not claim #145 integration', () => {
  const a=adapter(); a.setDetailLevel(ProductDetailLevel.ADVANCED); const r=render('brain',a); const t=textOf(r.host); assert.match(t,/FIXTURE/); assert.match(t,/until the Adaptive Context Runtime production contract is integrated/); r.scope.cleanup();
});

test('Wave 5 CSS retains compact, stacked and reduced-motion product behavior', async () => {
  const css=await readFile(new URL('../styles/ui-core-wave5.css',import.meta.url),'utf8'); assert.match(css,/data-layout=COMPACT/); assert.match(css,/data-layout=STACKED/); assert.match(css,/prefers-reduced-motion:reduce/);
});

test('Wave 5 source does not hardcode synthetic World Economy subsystem routing', async () => {
  const [shell,front]=await Promise.all([readFile(new URL('../src/ui-core/shell.js',import.meta.url),'utf8'),readFile(new URL('../src/ui-core/wave5-front-face.js',import.meta.url),'utf8')]); assert.equal(shell.includes('world-economy'),false); assert.equal(front.includes('world-economy'),false);
});
