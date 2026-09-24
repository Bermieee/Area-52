import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ForensicsProductionUIAdapter, FrontFaceMode, ProductDataMode, ProductDetailLevel, UIStateStore, Wave6Health,
  Wave8CognitionProductionAdapter, createWave6ProductInterface, createWave11LiveReceiptBinding,
} from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';
import { createWave11LiveHost, makeWave11Turn } from './fixtures/wave11-live-receipts.mjs';

class Doc extends FakeDocument{createDocumentFragment(){return new FakeNode('fragment',this);}}
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const textOf=node=>[node?.textContent??'',...(node?.children??[]).map(textOf)].filter(Boolean).join(' ');
const walk=node=>[node,...(node?.children??[]).flatMap(walk)];

function turns(){
  const a=makeWave11Turn({selection:{chatId:'chat:a',turnId:'turn:a',generationId:'gen:a',correlationId:'corr:a',worldRevision:52,sceneRevision:19},scenario:'hot'});
  const b=makeWave11Turn({selection:{chatId:'chat:b',turnId:'turn:b',generationId:'gen:b',correlationId:'corr:b',worldRevision:53,sceneRevision:20,sourceRevisionRefs:['lore:ember@6','scene:ember@20','memory:ember@12']},scenario:'ambiguous',resourceCount:2,late:true});
  return{a,b};
}
function mount(host,{turnId=null}={}){
  const doc=new Doc(),root=new FakeNode('div',doc),stateStore=new UIStateStore({storage:memory(),namespace:'wave11-live'});
  const ui=createWave6ProductInterface({root,stateStore,hostBindings:host.bundle});
  ui.presentation.patch({frontFaceMode:FrontFaceMode.EXPANDED,frontFaceWidth:420});ui.productAdapter.setDetailLevel(ProductDetailLevel.DETAIL);ui.shell.selectWorkspace('brain');ui.scheduler.flush(0);
  return{doc,root,ui};
}

test('Wave 11 exposes one production live binding point and never marks production records FIXTURE',()=>{
  const{a}=turns(),host=createWave11LiveHost([a],'turn:a'),binding=createWave11LiveReceiptBinding(host.bundle);
  const cognition=new Wave8CognitionProductionAdapter({scene:null,promptPlan:null,...binding.bridges.cognition});
  const read=cognition.read();
  assert.equal(read.source.mode,ProductDataMode.LIVE);
  assert.equal(read.sources.choice.mode,ProductDataMode.LIVE);
  assert.notEqual(read.source.mode,ProductDataMode.FIXTURE);
  assert.equal(binding.selection().turnId,'turn:a');
  binding.destroy();
});

test('Hot-only live turn shows explicit skips and measured avoided work without inventing Sensory/Jev execution',()=>{
  const{a}=turns(),host=createWave11LiveHost([a],'turn:a'),{ui}=mount(host),read=ui.productionAdapters.cognition.read();
  assert.equal(read.data.choice.paths.includes('HOT_ONLY'),true);
  assert.equal(read.data.sensory,null);
  assert.equal(read.data.truth,null);
  assert.equal(read.data.jev.state,'SKIPPED');
  assert.equal(read.data.precision.state,'SKIPPED');
  assert.equal(read.data.choice.measurements.avoidedJobs,6);
  assert.equal(read.data.stages.find(x=>x.id==='SENSORY').state,'SKIPPED');
  const t=textOf(ui.shell.nodes.workspace);
  assert.match(t,/Measured avoided work/);assert.match(t,/6/);assert.match(t,/avoided channel calls/i);assert.doesNotMatch(t,/18 nominations/);
  ui.destroy();
});

test('Retrieval-heavy live turn displays actual scatter, Candidate Bus, Truth, Gather and Seal receipts',()=>{
  const t=makeWave11Turn({selection:{turnId:'turn:r',generationId:'gen:r',correlationId:'corr:r',worldRevision:60,sceneRevision:24},scenario:'retrieval',resourceCount:1});
  const host=createWave11LiveHost([t],'turn:r'),{ui}=mount(host),read=ui.productionAdapters.cognition.read();
  assert.equal(read.data.scatter.jobs.length,4);assert.equal(read.data.scatter.resourceCount,1);
  assert.equal(read.data.sensory.inputNominationCount,18);assert.equal(read.data.sensory.uniqueCandidateCount,7);
  assert.equal(read.data.truth.retrievalQuality,'HIGH');assert.equal(read.data.gather.counts.ADMITTED,3);assert.equal(read.data.seal.sealedState,true);
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/18 nominations/);assert.match(body,/4 logical jobs used 1 physical execution resource/);
  ui.destroy();
});

test('Ambiguous live turn keeps Jev advisory and Sun Blade evidence UNRESOLVED',()=>{
  const t=makeWave11Turn({selection:{turnId:'turn:amb',generationId:'gen:amb',correlationId:'corr:amb',worldRevision:61,sceneRevision:25},scenario:'ambiguous',resourceCount:2});
  const host=createWave11LiveHost([t],'turn:amb'),{ui}=mount(host),read=ui.productionAdapters.cognition.read();
  assert.equal(read.data.jev.outcome,'ABSTAINED');assert.equal(read.data.jev.settlementPerformed,false);
  assert.equal(read.data.truth.counts.UNRESOLVED,1);
  assert.equal(read.data.promptPlan.contextReceipt.unresolvedEvidence[0].authority,'UNRESOLVED');
  const body=textOf(ui.shell.nodes.workspace);assert.match(body,/Jev is advisory cognition/);assert.match(body,/Owner settlement/);assert.doesNotMatch(body,/Jev.*SETTLED/i);
  ui.destroy();
});

test('one versus several execution resources changes physical mapping, not semantic cognition',()=>{
  const base={turnId:'turn:res1',generationId:'gen:res1',correlationId:'corr:res1',worldRevision:70,sceneRevision:30};
  const one=makeWave11Turn({selection:base,scenario:'retrieval',resourceCount:1});
  const many=makeWave11Turn({selection:{...base,turnId:'turn:res4',generationId:'gen:res4',correlationId:'corr:res4'},scenario:'retrieval',resourceCount:4});
  const a=createWave11LiveReceiptBinding(createWave11LiveHost([one],'turn:res1').bundle),b=createWave11LiveReceiptBinding(createWave11LiveHost([many],'turn:res4').bundle);
  const ra=new Wave8CognitionProductionAdapter({...a.bridges.cognition}).read(),rb=new Wave8CognitionProductionAdapter({...b.bridges.cognition}).read();
  assert.equal(ra.data.scatter.resourceCount,1);assert.equal(rb.data.scatter.resourceCount,4);
  assert.deepEqual(ra.data.choice.admitted.map(x=>x.capability),rb.data.choice.admitted.map(x=>x.capability));
  assert.equal(ra.data.sensory.inputNominationCount,rb.data.sensory.inputNominationCount);
  assert.deepEqual(ra.data.truth.counts,rb.data.truth.counts);assert.deepEqual(ra.data.gather.counts,rb.data.gather.counts);
  a.destroy();b.destroy();
});

test('receipt from a previous turn is rejected instead of filling the selected live stage',()=>{
  const{a,b}=turns(),host=createWave11LiveHost([a,b],'turn:b');
  host.bundle.readCognitiveChoice=()=>structuredClone(a.choice);
  const binding=createWave11LiveReceiptBinding(host.bundle),adapter=new Wave8CognitionProductionAdapter({...binding.bridges.cognition});
  const read=adapter.read();
  assert.equal(read.data.choice,null);assert.equal(read.sources.choice.mode,ProductDataMode.DEGRADED);
  assert.match(read.sources.choice.reason,/not selected|belongs to/i);
  assert.equal(read.data.gather.turnId,'turn:b');
  binding.destroy();
});

test('stale selected revision remains STALE/DEGRADED and cannot populate Truth',()=>{
  const{b}=turns(),host=createWave11LiveHost([b],'turn:b');
  const stale=structuredClone(b.truth);stale.sceneRevision=b.selection.sceneRevision-1;host.bundle.readTruth=()=>stale;
  const binding=createWave11LiveReceiptBinding(host.bundle),adapter=new Wave8CognitionProductionAdapter({...binding.bridges.cognition});
  const read=adapter.read();
  assert.equal(read.data.truth,null);assert.equal(read.sources.truth.mode,ProductDataMode.DEGRADED);assert.equal(read.sources.truth.health,Wave6Health.STALE);
  assert.equal(read.data.stages.find(x=>x.id==='TRUTH').state,'UNAVAILABLE');
  binding.destroy();
});

test('failed optional Jev producer degrades only Jev and leaves native path inspectable',()=>{
  const{b}=turns(),host=createWave11LiveHost([b],'turn:b');host.fail('jev',Object.assign(new Error('provider timeout'),{code:'PROVIDER_TIMEOUT'}));
  const binding=createWave11LiveReceiptBinding(host.bundle),adapter=new Wave8CognitionProductionAdapter({...binding.bridges.cognition});
  const read=adapter.read();
  assert.equal(read.data.jev,null);assert.equal(read.sources.jev.mode,ProductDataMode.DEGRADED);assert.match(read.sources.jev.reason,/provider timeout/);
  assert.ok(read.data.truth);assert.ok(read.data.gather);assert.ok(read.data.seal);
  binding.destroy();
});

test('late Gather result conflicting with Seal admission is never displayed as safely admitted',()=>{
  const t=makeWave11Turn({selection:{turnId:'turn:late',generationId:'gen:late',correlationId:'corr:late',worldRevision:80,sceneRevision:31},scenario:'ambiguous',late:true,conflictingAdmission:true});
  const binding=createWave11LiveReceiptBinding(createWave11LiveHost([t],'turn:late').bundle),adapter=new Wave8CognitionProductionAdapter({...binding.bridges.cognition});
  const read=adapter.read(),seal=read.data.seal;
  assert.deepEqual(seal.coherenceConflictIds,['result:green-room']);assert.equal(seal.effectiveAdmittedResultIds.includes('result:green-room'),false);
  assert.equal(read.sources.seal.mode,ProductDataMode.DEGRADED);assert.equal(read.data.stages.find(x=>x.id==='CONTEXT_SEAL').state,'DEGRADED');
  binding.destroy();
});

test('Forensics binding filters cross-turn rows and leaves missing stages explicit',()=>{
  const{a,b}=turns();b.forensic={...b.forensic,complete:false,health:{state:'DEGRADED',reasons:['PARTIAL']}};b.transactions=b.transactions.filter(x=>x.transactionType!=='CONTEXT_SEALED');
  const binding=createWave11LiveReceiptBinding(createWave11LiveHost([a,b],'turn:b').bundle),adapter=new ForensicsProductionUIAdapter(binding.bridges.forensics);
  const read=adapter.readGeneration('gen:b');
  assert.ok(read.data.transactions.length>0);assert.ok(read.data.transactions.every(x=>x.turnId==='turn:b'));
  assert.equal(read.data.timeline.complete,false);assert.ok(read.data.timeline.missingStages.length>0);
  adapter.destroy();binding.destroy();
});

test('chat/turn switch rebinds generation, clears Inspector, coalesces render work, and cleans host subscription',()=>{
  const{a,b}=turns(),host=createWave11LiveHost([a,b],'turn:a'),{ui,root}=mount(host);
  ui.shell.inspector.select({kind:'wave8-stage',id:'old',title:'Old turn',item:{state:'COMPLETE'}});ui.scheduler.flush(1);assert.ok(ui.shell.inspector.selection);
  host.switchTo('turn:b');assert.ok(ui.scheduler.pendingCount<=4);ui.scheduler.flush(2);
  assert.equal(ui.liveReceiptBinding.selection().chatId,'chat:b');assert.equal(ui.explainabilityPresentation.get().bookmark.generationId,'gen:b');assert.equal(ui.shell.inspector.selection,null);
  assert.equal(ui.productionAdapters.cognition.read().data.turnId,'turn:b');assert.equal(host.listenerCount(),1);
  ui.destroy();assert.equal(host.listenerCount(),0);assert.equal(root.children.length,0);assert.equal(ui.signals.listenerCount('*'),0);
});

test('production mode with missing producers is UNAVAILABLE and never falls back to Ember fixtures',()=>{
  const listeners=new Set(),host={bundle:{
    readSelection:()=>({chatId:'chat:none',turnId:'turn:none',generationId:'gen:none',correlationId:'corr:none'}),
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  },listenerCount:()=>listeners.size};
  const{ui}=mount(host),read=ui.productionAdapters.cognition.read();
  assert.equal(read.source.mode,ProductDataMode.UNAVAILABLE);assert.equal(read.sources.choice.mode,ProductDataMode.UNAVAILABLE);assert.equal(ui.productAdapter.getSnapshot().wave6.mode,ProductDataMode.UNAVAILABLE);
  assert.doesNotMatch(textOf(ui.shell.nodes.workspace),/DEMO \/ FIXTURE DATA|Ember Tavern/);
  ui.destroy();assert.equal(host.listenerCount(),0);
});

test('fixture review mode and live host binding cannot be mixed',()=>{
  const{a}=turns(),host=createWave11LiveHost([a],'turn:a'),doc=new Doc(),root=new FakeNode('div',doc);
  assert.throws(()=>createWave6ProductInterface({root,fixture:{story:{title:'fixture'}},hostBindings:host.bundle}),/mutually exclusive/);
});

test('narrow 420px live dock keeps keyboard-addressable Brain controls',()=>{
  const{b}=turns(),host=createWave11LiveHost([b],'turn:b'),{ui}=mount(host);
  assert.equal(ui.presentation.get().frontFaceWidth,420);
  const buttons=walk(ui.shell.nodes.workspace).filter(x=>x.tagName==='BUTTON');assert.ok(buttons.length>5);assert.ok(buttons.every(x=>x.attributes?.type==='button'||x.getAttribute?.('type')==='button'));
  ui.destroy();
});
