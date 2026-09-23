import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { hashPacket } from '../src/context-seal.js';
import {
  PromptSlot, ContributionSource, ReuseState, DeliveryStatus,
  createModelProfile, deliveryHash,
} from '../src/adaptive-context-contracts.js';
import {
  AdaptiveContextRuntime, PromptSlotRegistry, ModelProfileRegistry,
} from '../src/adaptive-context-runtime.js';
import {
  benchmarkAdaptiveDelivery, compareProfileDeliveries,
} from '../src/adaptive-context-benchmarks.js';
import { runWave4AdaptiveContextGoldenWorld } from './wave4-golden-harness.js';

function fixture(revision=1, unresolved='unknown'){
  const dependencies=revision===1
    ? ['src:tavern@1','src:blade@1','src:journal@1']
    : ['src:tavern@1','src:blade@1','src:journal@2'];
  const packet={
    kind:'CompiledContextPacket', id:`packet:${revision}`, query:'Where is the Sun Blade now?', intent:'CURRENT',
    current:[{id:'claim:tavern',e:'ember-tavern',p:'state',v:'destroyed',a:'SOURCE_CANON',cf:1}],
    historical:[{id:'claim:blade-location',e:'sun-blade',p:'location',v:'ember-tavern',a:'SOURCE_CANON',cf:1,t:[10,20,'HISTORICAL']}],
    unresolved:[{id:'claim:blade-fate',e:'sun-blade',p:'state',v:unresolved,a:'UNRESOLVED',cf:0,t:[20,null,'UNRESOLVED']}],
    provenanceIndex:{
      'claim:tavern':['src:tavern@1'],
      'claim:blade-location':['src:blade@1'],
      'claim:blade-fate':[revision===1?'src:journal@1':'src:journal@2'],
    },
    dependencies,
  };
  const receipt={
    kind:'ContextSealReceipt', id:`seal:${revision}`, turnId:`turn:${revision}`,
    packetId:packet.id, packetHash:hashPacket(packet), sourceRevisionIds:dependencies,
    worldRevision:revision, sceneRevision:1, dependencies, sealedState:true,
  };
  return {packet,receipt};
}
function input(extra={}){
  const {packet,receipt}=fixture();
  return {
    sealedPacket:packet, sealReceipt:receipt, generationId:'g1',
    modelProfileId:'RECENCY_WEIGHTED', intent:'LOCATION',
    systemPolicy:'Preserve truth and temporal qualifiers.',
    userInput:'Where is the Sun Blade now?', ...extra,
  };
}

test('slot registry is typed, rejects raw bypass, and permits explicit EXT slots',()=>{
  const slots=new PromptSlotRegistry();
  for(const slot of Object.values(PromptSlot))assert.equal(slots.has(slot),true);
  assert.throws(()=>slots.normalizeContribution({
    id:'raw',slot:'RAW_APPEND',sourceCategory:ContributionSource.GENERATION_ENVELOPE,
    owner:'X',semantic:false,content:'x',role:'context',
  }),/Unregistered prompt slot/);
  slots.registerExtensionSlot('EXT_TEST',{owner:'TEST',allowedSources:[ContributionSource.PRESENTATION_METADATA],role:'context',semantic:false});
  assert.equal(slots.has('EXT_TEST'),true);
});

test('post-seal semantic injection and role misuse are rejected',()=>{
  const runtime=new AdaptiveContextRuntime();
  const attacked=runtime.deliver(input({contributions:[{
    id:'attack',slot:PromptSlot.CURRENT_WORLD_STATE,sourceCategory:ContributionSource.GENERATION_ENVELOPE,
    owner:'ATTACK',semantic:true,semanticRefs:[],content:'Blade is in cellar',sourceRevisionIds:[],
    role:'context',required:true,priority:99,metadata:{},
  }]}));
  assert.equal(attacked.ok,false);
  assert.equal(attacked.failure.code,'POST_SEAL_SEMANTIC_INJECTION');
  assert.throws(()=>runtime.slotRegistry.normalizeContribution({
    id:'role',slot:PromptSlot.RECENT_NARRATIVE,sourceCategory:ContributionSource.GENERATION_ENVELOPE,
    owner:'GENERATION_ENVELOPE',semantic:false,content:'x',role:'system',
  }),/requires role context/);
});

test('PromptPlan identity is deterministic, seal-bound, frozen, disposable and noncanonical',()=>{
  const runtime=new AdaptiveContextRuntime(), args=input();
  const a=runtime.createPlan(args), b=runtime.createPlan(args);
  assert.equal(a.ok,true); assert.equal(b.ok,true);
  assert.equal(a.plan.promptPlanId,b.plan.promptPlanId);
  assert.equal(deliveryHash(a.plan),deliveryHash(b.plan));
  assert.equal(a.plan.contextSealId,args.sealReceipt.id);
  assert.equal(a.plan.sealedPacketHash,args.sealReceipt.packetHash);
  assert.equal(Object.isFrozen(a.plan),true);
  assert.equal('memory' in a.plan,false);
  assert.equal('settlement' in a.plan,false);
});

test('reference profiles render one sealed meaning differently without semantic drift',()=>{
  const runtime=new AdaptiveContextRuntime(), args=input();
  const a=runtime.deliver({...args,generationId:'ga',modelProfileId:'CACHE_STABLE'});
  const b=runtime.deliver({...args,generationId:'gb',modelProfileId:'RECENCY_WEIGHTED'});
  const compared=compareProfileDeliveries([a,b]);
  assert.equal(a.ok,true); assert.equal(b.ok,true);
  assert.equal(compared.semanticEquivalent,true);
  assert.equal(compared.presentationDiffers,true);
  assert.notEqual(a.plan.placement.segmentStrategy,b.plan.placement.segmentStrategy);
});

test('intent changes budget targets only; protected floors survive optional pressure and impossible floors fail visibly',()=>{
  const runtime=new AdaptiveContextRuntime();
  const location=runtime.deliver(input({generationId:'loc',intent:'LOCATION'}));
  const description=runtime.deliver(input({generationId:'desc',intent:'DESCRIPTION'}));
  assert.notDeepEqual(location.plan.budget.targetsBySlot,description.plan.budget.targetsBySlot);
  assert.equal(deliveryHash(location.plan.segments.flatMap(s=>s.semanticManifest)),deliveryHash(description.plan.segments.flatMap(s=>s.semanticManifest)));
  const pressure=runtime.deliver(input({
    generationId:'pressure',budgetTokens:650,
    contributions:[{id:'bulk',slot:PromptSlot.RECENT_NARRATIVE,sourceCategory:ContributionSource.GENERATION_ENVELOPE,
      owner:'GENERATION_ENVELOPE',semantic:false,semanticRefs:[],content:'bulk '.repeat(3000),
      sourceRevisionIds:[],role:'context',required:false,priority:0,metadata:{}}],
  }));
  assert.equal(pressure.ok,true);
  assert.ok(pressure.plan.dropped.some(x=>x.slot===PromptSlot.RECENT_NARRATIVE));
  for(const slot of [PromptSlot.CURRENT_WORLD_STATE,PromptSlot.HISTORICAL_SUPPORT,PromptSlot.UNRESOLVED_EVIDENCE,PromptSlot.USER_INPUT])
    assert.ok(pressure.plan.sections.some(s=>s.slot===slot&&s.representation!=='OMITTED'),slot);
  const impossible=runtime.deliver(input({generationId:'tiny',budgetTokens:1}));
  assert.equal(impossible.ok,false);
  assert.equal(impossible.status,DeliveryStatus.DELIVERY_BUDGET_UNSATISFIABLE);
});

test('Change Gate emits NO_CHANGE/PATCH/REBUILD/OMIT with dependency-cone invalidation',()=>{
  const runtime=new AdaptiveContextRuntime();
  const first=runtime.deliver(input({generationId:'r1',modelProfileId:'CACHE_STABLE'}));
  const same=runtime.deliver(input({generationId:'r2',modelProfileId:'CACHE_STABLE',previousPlan:first.plan}));
  const sameStates=Object.fromEntries(same.plan.segments.map(s=>[s.segmentKey,s.reuseState]));
  assert.ok(Object.values(sameStates).includes(ReuseState.NO_CHANGE));
  assert.equal(sameStates['band:VOLATILE_TAIL'],ReuseState.REBUILD);

  const f2=fixture(2,'possibly survived');
  const changed=runtime.deliver({
    ...input(),sealedPacket:f2.packet,sealReceipt:f2.receipt,generationId:'r3',
    modelProfileId:'CACHE_STABLE',previousPlan:first.plan,
  });
  assert.ok(changed.plan.segments.some(s=>s.segmentKey==='band:REVISIONED_MIDDLE'&&s.reuseState===ReuseState.PATCH));

  const atomic1=runtime.deliver(input({generationId:'a1',modelProfileId:'RECENCY_WEIGHTED'}));
  const atomic2=runtime.deliver({
    ...input(),sealedPacket:f2.packet,sealReceipt:f2.receipt,generationId:'a2',
    modelProfileId:'RECENCY_WEIGHTED',previousPlan:atomic1.plan,
  });
  const atomic=Object.fromEntries(atomic2.plan.segments.map(s=>[s.segmentKey,s.reuseState]));
  assert.equal(atomic['slot:UNRESOLVED_EVIDENCE'],ReuseState.REBUILD);
  assert.equal(atomic['slot:CURRENT_WORLD_STATE'],ReuseState.NO_CHANGE);

  const omit=runtime.deliver(input({
    generationId:'omit',budgetTokens:600,
    contributions:[{id:'optional',slot:PromptSlot.RECENT_NARRATIVE,sourceCategory:ContributionSource.GENERATION_ENVELOPE,
      owner:'GENERATION_ENVELOPE',semantic:false,semanticRefs:[],content:'x'.repeat(20000),sourceRevisionIds:[],role:'context'}],
  }));
  assert.ok(omit.plan.reuseDecisions.some(x=>x.state===ReuseState.OMIT));
});

test('cache metadata is revision/profile/policy safe and volatile content is never reusable',()=>{
  const runtime=new AdaptiveContextRuntime();
  const out=runtime.deliver(input({generationId:'cache',modelProfileId:'CACHE_STABLE'}));
  assert.ok(out.plan.cacheDecisions.some(x=>x.cacheEligible&&x.cacheKey));
  assert.ok(out.plan.segments.filter(s=>s.band==='VOLATILE_TAIL').every(s=>!s.cacheEligible));
});

test('integrity guard catches stale seal, duplicate fact, authority escalation, temporal stripping and budget domination',()=>{
  const runtime=new AdaptiveContextRuntime(), args=input(), valid=runtime.deliver(args);
  const f2=fixture(2,'changed');
  const stale=runtime.integrityGuard.validatePlan({plan:valid.plan,sealedPacket:f2.packet,sealReceipt:f2.receipt});
  assert.equal(stale.valid,false);
  assert.ok(stale.violations.some(v=>v.code==='STALE_CONTEXT_SEAL'));

  const mutate=(fn)=>{const plan=structuredClone(valid.plan);fn(plan);return runtime.integrityGuard.validatePlan({plan,sealedPacket:args.sealedPacket,sealReceipt:args.sealReceipt});};
  const dup=mutate(plan=>plan.sections.find(s=>s.semanticManifest.length).semanticManifest.push(structuredClone(plan.sections.find(s=>s.semanticManifest.length).semanticManifest[0])));
  assert.ok(dup.violations.some(v=>v.code==='DUPLICATE_SEMANTIC_CONTENT'));
  const auth=mutate(plan=>{plan.sections.find(s=>s.slot===PromptSlot.CURRENT_WORLD_STATE).semanticManifest[0].authorityClass='INFERRED';});
  assert.ok(auth.violations.some(v=>v.code==='AUTHORITY_ESCALATION'));
  const temporal=mutate(plan=>{plan.sections.find(s=>s.slot===PromptSlot.HISTORICAL_SUPPORT).semanticManifest[0].temporalStatus='CURRENT';});
  assert.ok(temporal.violations.some(v=>v.code==='TEMPORAL_STRIPPING'));
  const budget=mutate(plan=>{plan.budget.allocated=plan.budget.available+1;});
  assert.ok(budget.violations.some(v=>v.code==='BUDGET_DOMINATION'));
});

test('adapter mutation/throw are contained before accepted Main delivery',()=>{
  const runtime=new AdaptiveContextRuntime(), planned=runtime.createPlan(input());
  const mutated=runtime.render({plan:planned.plan,profile:planned.profile,adapterOverride:{render(plan){
    const semanticManifest=structuredClone(plan.segments.flatMap(s=>s.semanticManifest));
    semanticManifest[0].temporalStatus='CORRUPTED';
    return {contextSealId:plan.contextSealId,sealedPacketHash:plan.sealedPacketHash,semanticManifest};
  }}});
  assert.equal(mutated.ok,false);
  assert.equal(mutated.failure.code,'ADAPTER_SEMANTIC_MUTATION');
  const thrown=runtime.render({plan:planned.plan,profile:planned.profile,adapterOverride:{render(){throw new Error('boom');}}});
  assert.equal(thrown.ok,false);
  assert.equal(thrown.status,DeliveryStatus.ADAPTER_FAILED);
});

test('explicit compatible profile fallback and approximate estimator fallback are recorded',()=>{
  const profiles=new ModelProfileRegistry();
  profiles.register(createModelProfile({
    modelProfileId:'ALT_ESTIMATOR',contextWindow:4096,reservedTokens:128,
    positionOrder:Object.values(PromptSlot),bandBySlot:{},segmentStrategy:'SLOT_ATOMIC',
    tokenEstimatorId:'provider-exact-unavailable',adapterId:'structured-blocks-v1',
  }));
  const runtime=new AdaptiveContextRuntime({profileRegistry:profiles});
  const profileFallback=runtime.deliver(input({generationId:'pf',modelProfileId:'MISSING',fallbackProfileId:'CACHE_STABLE'}));
  assert.equal(profileFallback.ok,true);
  assert.ok(profileFallback.plan.fallbackDecisions.some(x=>x.startsWith('PROFILE_FALLBACK:')));
  const estimatorFallback=runtime.deliver(input({generationId:'ef',modelProfileId:'ALT_ESTIMATOR'}));
  assert.equal(estimatorFallback.ok,true);
  assert.ok(estimatorFallback.plan.fallbackDecisions.some(x=>x.startsWith('TOKEN_ESTIMATOR_FALLBACK:')));
  assert.equal(estimatorFallback.plan.diagnosticReceipt.estimator.exact,false);
});

test('benchmark requires semantic retention and accepts provider-neutral cost hook',()=>{
  const runtime=new AdaptiveContextRuntime(), args=input(), delivery=runtime.deliver(args);
  const required=['claim:tavern','claim:blade-location','claim:blade-fate'];
  const bench=benchmarkAdaptiveDelivery({delivery,requiredSemanticKeys:required,costEstimator:({allocatedTokens})=>allocatedTokens*2});
  assert.equal(bench.pass,true);
  assert.equal(bench.semanticRetention,1);
  assert.equal(bench.costEstimate,delivery.plan.budget.allocated*2);
});

test('stress: 1,200 contributions remain deterministic, bounded, compact and unretained',()=>{
  const runtime=new AdaptiveContextRuntime();
  const contributions=Array.from({length:1200},(_,i)=>({
    id:`stress:${i}`,slot:PromptSlot.RECENT_NARRATIVE,sourceCategory:ContributionSource.GENERATION_ENVELOPE,
    owner:'GENERATION_ENVELOPE',semantic:false,semanticRefs:[],content:`optional-${i}`,
    sourceRevisionIds:[],role:'context',required:false,priority:0,metadata:{i},
  }));
  const args=input({generationId:'stress',budgetTokens:1000,contributions});
  const start=performance.now(), a=runtime.createPlan(args), elapsed=performance.now()-start, b=runtime.createPlan(args);
  assert.equal(a.ok,true); assert.equal(b.ok,true);
  assert.equal(a.plan.promptPlanId,b.plan.promptPlanId);
  assert.ok(elapsed<5000,`planning took ${elapsed}ms`);
  assert.ok(a.plan.sections.length<20);
  assert.equal('plans' in runtime,false);
});

test('integrated Wave 4 Golden World passes delivery, reuse, pressure and attack acceptance',()=>{
  const scored=runWave4AdaptiveContextGoldenWorld();
  assert.equal(scored.pass,true,JSON.stringify(scored.metrics,null,2));
});
