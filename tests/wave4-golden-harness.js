import { runWave3PublicationGoldenWorld } from './wave3-golden-harness.js';
import { AdaptiveContextRuntime } from '../src/adaptive-context-runtime.js';
import { PromptSlot,ContributionSource,deliveryHash } from '../src/adaptive-context-contracts.js';
import { compareProfileDeliveries,benchmarkAdaptiveDelivery } from '../src/adaptive-context-benchmarks.js';

function semanticKeys(packet){return [...(packet.current??[]),...(packet.historical??[]),...(packet.unresolved??[])].map(f=>f.id).sort();}

export function runWave4AdaptiveContextGoldenWorld(){
  const wave3=runWave3PublicationGoldenWorld();
  const runtime=new AdaptiveContextRuntime();
  const base={
    sealedPacket:wave3.published.packet,sealReceipt:wave3.published.sealReceipt,
    turnId:'turn:w3:1',intent:'LOCATION',systemPolicy:'Preserve sealed truth, temporal qualifiers, and unresolved uncertainty.',
    userInput:'Where can Eris find the Sun Blade now?',
  };
  const cacheStable=runtime.deliver({...base,generationId:'generation:w4:a',modelProfileId:'CACHE_STABLE'});
  const recency=runtime.deliver({...base,generationId:'generation:w4:b',modelProfileId:'RECENCY_WEIGHTED'});
  const profileComparison=compareProfileDeliveries([cacheStable,recency]);
  const repeated=runtime.deliver({...base,generationId:'generation:w4:b2',modelProfileId:'RECENCY_WEIGHTED',previousPlan:recency.plan});
  const revised=runtime.deliver({
    sealedPacket:wave3.future.packet,sealReceipt:wave3.future.sealReceipt,turnId:'turn:w3:2',generationId:'generation:w4:c',modelProfileId:'RECENCY_WEIGHTED',
    intent:'LOCATION',systemPolicy:'Preserve sealed truth, temporal qualifiers, and unresolved uncertainty.',userInput:'Where can Eris find the Sun Blade now?',previousPlan:recency.plan,
  });
  const pressure=runtime.deliver({...base,generationId:'generation:w4:pressure',modelProfileId:'RECENCY_WEIGHTED',budgetTokens:700,contributions:[{
    id:'recent:bulk',slot:PromptSlot.RECENT_NARRATIVE,sourceCategory:ContributionSource.GENERATION_ENVELOPE,owner:'GENERATION_ENVELOPE',semantic:false,semanticRefs:[],
    content:'optional recent narrative '.repeat(500),sourceRevisionIds:[],role:'context',required:false,priority:0,metadata:{fixture:'budget-pressure'},
  }]});
  const impossible=runtime.deliver({...base,generationId:'generation:w4:impossible',modelProfileId:'RECENCY_WEIGHTED',budgetTokens:1});
  const postSealAttack=runtime.deliver({...base,generationId:'generation:w4:attack2',modelProfileId:'RECENCY_WEIGHTED',contributions:[{
    id:'attack:unsupported-fact',slot:PromptSlot.CURRENT_WORLD_STATE,sourceCategory:ContributionSource.GENERATION_ENVELOPE,owner:'ATTACK',semantic:true,semanticRefs:[],
    content:[{id:'fabricated',e:'sun-blade',p:'location',v:'cellar',a:'SOURCE_CANON'}],sourceRevisionIds:[],role:'context',required:true,priority:99,metadata:{},
  }]});
  const adapterMutation=runtime.render({plan:recency.plan,profile:recency.profile,adapterOverride:{render(plan){
    const manifest=structuredClone(plan.segments.flatMap(s=>s.semanticManifest??[]));
    const historical=manifest.find(x=>x.slot===PromptSlot.HISTORICAL_SUPPORT);if(historical)historical.temporalStatus='CURRENT';
    return{kind:'RenderedModelInput',adapterId:'attack-adapter',format:'attack',contextSealId:plan.contextSealId,sealedPacketHash:plan.sealedPacketHash,blocks:[],semanticManifest:manifest};
  }}});

  const currentTavern=cacheStable.plan.sections.some(s=>s.slot===PromptSlot.CURRENT_WORLD_STATE&&s.semanticManifest.some(x=>x.semanticKey&&s.content.some?.(f=>f.e==='ember-tavern'&&f.p==='state'&&f.v==='destroyed')));
  const historicalBlade=cacheStable.plan.sections.some(s=>s.slot===PromptSlot.HISTORICAL_SUPPORT&&s.content.some?.(f=>f.e==='sun-blade'&&f.p==='location'&&f.v==='ember-tavern'));
  const unresolvedBlade=cacheStable.plan.sections.some(s=>s.slot===PromptSlot.UNRESOLVED_EVIDENCE&&s.content.some?.(f=>f.e==='sun-blade'&&f.p==='location'&&f.v==='unknown'));
  const falseCurrentBlade=cacheStable.plan.sections.some(s=>s.slot===PromptSlot.CURRENT_WORLD_STATE&&s.content.some?.(f=>f.e==='sun-blade'&&f.p==='location'&&f.v==='ember-tavern'));
  const repeatStates=Object.fromEntries(repeated.plan.segments.map(s=>[s.segmentKey,s.reuseState]));
  const revisedStates=Object.fromEntries(revised.plan.segments.map(s=>[s.segmentKey,s.reuseState]));
  const expectedKeys=semanticKeys(wave3.published.packet);
  const cacheBenchmark=benchmarkAdaptiveDelivery({delivery:cacheStable,requiredSemanticKeys:expectedKeys});
  const recencyBenchmark=benchmarkAdaptiveDelivery({delivery:recency,requiredSemanticKeys:expectedKeys});
  const oldPacketAfter=JSON.stringify(wave3.core.publication.seal.getPacket('turn:w3:1'));

  const metrics={
    profileAReady:cacheStable.ok,profileBReady:recency.ok,profilePresentationDiffers:profileComparison.presentationDiffers,profileSemanticEquivalent:profileComparison.semanticEquivalent,
    profileSegmentBoundariesDiffer:cacheStable.plan.segments.length!==recency.plan.segments.length||cacheStable.plan.placement.segmentStrategy!==recency.plan.placement.segmentStrategy,
    currentTavern,historicalBlade,unresolvedBlade,falseCurrentBlade,
    cacheBenchmarkPass:cacheBenchmark.pass,recencyBenchmarkPass:recencyBenchmark.pass,
    repeatedStableReuse:Object.entries(repeatStates).some(([k,v])=>k!=='slot:USER_INPUT'&&v==='NO_CHANGE'),
    repeatedVolatileRebuild:repeatStates['slot:USER_INPUT']==='REBUILD',
    revisedAffectedRebuild:Object.entries(revisedStates).some(([k,v])=>/HISTORICAL_SUPPORT|UNRESOLVED_EVIDENCE/.test(k)&&['REBUILD','PATCH'].includes(v)),
    revisedUnrelatedReuse:revisedStates['slot:CURRENT_WORLD_STATE']==='NO_CHANGE',
    pressureReady:pressure.ok,pressureOptionalDropped:(pressure.plan?.dropped??[]).some(x=>x.slot===PromptSlot.RECENT_NARRATIVE),
    pressureCurrentSurvives:pressure.plan?.sections.some(s=>s.slot===PromptSlot.CURRENT_WORLD_STATE&&s.representation!=='OMITTED')??false,
    pressureHistoricalSurvives:pressure.plan?.sections.some(s=>s.slot===PromptSlot.HISTORICAL_SUPPORT&&s.representation!=='OMITTED')??false,
    pressureUnresolvedSurvives:pressure.plan?.sections.some(s=>s.slot===PromptSlot.UNRESOLVED_EVIDENCE&&s.representation!=='OMITTED')??false,
    pressureUserSurvives:pressure.plan?.sections.some(s=>s.slot===PromptSlot.USER_INPUT&&s.representation!=='OMITTED')??false,
    impossibleFailsExplicitly:!impossible.ok&&impossible.status==='DELIVERY_BUDGET_UNSATISFIABLE',
    postSealAttackRejected:!postSealAttack.ok&&postSealAttack.failure?.code==='POST_SEAL_SEMANTIC_INJECTION',
    adapterMutationRejected:!adapterMutation.ok&&adapterMutation.failure?.code==='ADAPTER_SEMANTIC_MUTATION',
    oldSealUnchanged:deliveryHash(JSON.parse(oldPacketAfter))===deliveryHash(wave3.published.packet),
    promptPlanNoncanonical:!('memory' in cacheStable.plan)&&!('settlement' in cacheStable.plan),
  };
  const pass=Object.values(metrics).every(Boolean);
  return{pass,metrics,wave3,runtime,cacheStable,recency,repeated,revised,pressure,impossible,postSealAttack,adapterMutation,profileComparison,cacheBenchmark,recencyBenchmark};
}
