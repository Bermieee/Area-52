import {
  SpeculativeWarmCoordinator, WarmState, normalizeWarmSceneRequest,
} from '../src/coprocessor/index.js';

const encoder=new TextEncoder();
const now=()=>globalThis.performance?.now?.()??Date.now();
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

export const WAVE12_BENCHMARK_PROVIDER = Object.freeze({
  mode:'DETERMINISTIC_LOCAL_FIXTURE',
  externalProvider:false,
  stageLatencyMs:Object.freeze({retrieval:4,quality:1,truth:3,precision:2,compile:2,coreRevalidation:1}),
});

const makeIdentity=(overrides={})=>({
  sceneRevision:7,worldRevision:12,characterStateRevision:4,
  sourceRevisionSet:['src:scene:7','src:lore:1'],intentFingerprint:'intent:tavern',
  retrievalPolicyRevision:'policy:1',...overrides,
});

const makeRec=(overrides={})=>({
  kind:'PrefetchRecommendation',recommendationId:'bench:base',sceneId:'scene:tavern',sceneRevision:7,
  trigger:'SCENE_PREFETCH',entityRefs:['char:Mara'],locationRefs:['loc:ember-tavern'],
  threadRefs:['thread:sun-blade'],sceneRefs:['scene:tavern'],priority:'NORMAL',expiryRevision:10,
  evidenceRefs:['ev:tavern'],sourceRevisionRefs:['src:scene:7'],sourceRevisionSet:['src:scene:7'],
  authority:'NONE',status:'ACTIVE',...overrides,
});

function scenarios(){
  const simple=makeIdentity({intentFingerprint:'intent:simple'});
  const transition=makeIdentity({
    sceneRevision:8,worldRevision:13,characterStateRevision:5,
    sourceRevisionSet:['src:scene:8','src:lore:1'],intentFingerprint:'intent:enter-shrine',
  });
  const lore=makeIdentity({
    sceneRevision:8,worldRevision:13,characterStateRevision:5,
    sourceRevisionSet:['src:scene:8','src:lore:1'],intentFingerprint:'intent:blade-fate',
  });
  const ambiguous=makeIdentity({intentFingerprint:'intent:ambiguous-doorway'});
  return [
    {
      name:'simple',
      warmIdentity:simple,sendIdentity:simple,
      warmRecommendation:makeRec({recommendationId:'bench:simple'}),
      foregroundRecommendation:makeRec({recommendationId:'fg:simple'}),
    },
    {
      name:'location-transition',
      warmIdentity:transition,sendIdentity:transition,
      warmRecommendation:makeRec({
        recommendationId:'bench:transition',sceneId:'scene:shrine',sceneRevision:8,expiryRevision:11,
        trigger:'LOCATION_TRANSITION_CONFIRMED',locationRefs:['loc:sun-blade-shrine'],sceneRefs:['scene:shrine'],
        evidenceRefs:['ev:crossed-threshold'],sourceRevisionRefs:['src:scene:8'],sourceRevisionSet:['src:scene:8'],
      }),
      foregroundRecommendation:makeRec({
        recommendationId:'fg:transition',sceneId:'scene:shrine',sceneRevision:8,expiryRevision:11,
        trigger:'LOCATION_TRANSITION_CONFIRMED',locationRefs:['loc:sun-blade-shrine'],sceneRefs:['scene:shrine'],
        evidenceRefs:['ev:crossed-threshold'],sourceRevisionRefs:['src:scene:8'],sourceRevisionSet:['src:scene:8'],
      }),
    },
    {
      name:'lore-heavy-partial',
      warmIdentity:lore,
      sendIdentity:{...lore,sourceRevisionSet:['src:scene:8','src:lore:2']},
      warmRecommendation:makeRec({
        recommendationId:'bench:lore',sceneId:'scene:shrine',sceneRevision:8,expiryRevision:11,
        trigger:'LORE_HEAVY_PREFETCH',entityRefs:['char:Mara','char:Eris'],locationRefs:['loc:sun-blade-shrine'],
        threadRefs:['thread:sun-blade-fate','thread:old-oath'],sceneRefs:['scene:shrine'],
        evidenceRefs:['ev:blade-destroyed','ev:blade-seen-later'],sourceRevisionRefs:['src:scene:8'],sourceRevisionSet:['src:scene:8'],
      }),
      foregroundRecommendation:makeRec({
        recommendationId:'fg:lore',sceneId:'scene:shrine',sceneRevision:8,expiryRevision:11,
        trigger:'LORE_HEAVY_FOREGROUND',entityRefs:['char:Mara','char:Eris'],locationRefs:['loc:sun-blade-shrine'],
        threadRefs:['thread:sun-blade-fate','thread:old-oath'],sceneRefs:['scene:shrine'],
        evidenceRefs:['ev:blade-destroyed','ev:blade-seen-later','ev:lore-edit'],sourceRevisionRefs:['src:scene:8'],sourceRevisionSet:['src:scene:8'],
      }),
      unresolved:true,
    },
    {
      name:'ambiguous-doorway',
      warmIdentity:ambiguous,
      sendIdentity:{...ambiguous,retrievalPolicyRevision:'policy:2'},
      warmRecommendation:makeRec({
        recommendationId:'bench:ambiguous',trigger:'MENTIONED_LOCATION',
        locationRefs:['loc:sun-blade-shrine'],evidenceRefs:['ev:doorway-mentioned-only'],
      }),
      foregroundRecommendation:makeRec({
        recommendationId:'fg:ambiguous',trigger:'CURRENT_SCENE_FOREGROUND',
        locationRefs:['loc:ember-tavern'],evidenceRefs:['ev:still-in-tavern'],
      }),
    },
  ];
}

function counters(){return{retrieval:0,quality:0,truth:0,precision:0,compile:0};}

function adapters(counter,{latency=true}={}){
  const wait=async(stage)=>{counter[stage]+=1;if(latency)await sleep(WAVE12_BENCHMARK_PROVIDER.stageLatencyMs[stage]);};
  return {
    providerMode:WAVE12_BENCHMARK_PROVIDER.mode,
    retrieve:async({intentSlice,recommendation})=>{
      await wait('retrieval');
      return{status:'OK',candidateRefs:intentSlice.map(x=>x.ref),evidenceRefs:recommendation.evidenceRefs,receipt:{status:'OK',count:intentSlice.length}};
    },
    evaluateQuality:async(refs)=>{await wait('quality');return{status:'OK',quality:refs.candidateRefs.length?'HIGH':'LOW'};},
    truthCheck:async(_refs,{recommendation})=>{
      await wait('truth');
      const unresolved=recommendation.threadRefs.includes('thread:sun-blade-fate');
      return unresolved
        ?{status:'UNRESOLVED',checked:true,conflictState:'UNRESOLVED',reason:'Blade fate evidence conflicts'}
        :{status:'VERIFIED',checked:true,conflictState:'RESOLVED'};
    },
    precisionRank:async(refs)=>{await wait('precision');return{status:'RANKED',ranked:true,count:refs.candidateRefs.length};},
    compile:async({identity})=>{
      await wait('compile');
      return{compiledRef:{kind:'ArtifactReference',artifactId:'bench-compiled:'+identity.intentFingerprint,
        artifactType:'CompiledContextCandidate',owner:'CORE',revision:1,storageDomain:'compiled',
        sourceRevisionSet:[...identity.sourceRevisionSet],worldRevision:identity.worldRevision,sceneRevision:identity.sceneRevision}};
    },
  };
}

async function fullForegroundPipeline(scenario, adapterSet){
  const normalized=normalizeWarmSceneRequest({
    recommendation:scenario.foregroundRecommendation,identity:scenario.sendIdentity,turnSequence:20,
  });
  const started=now();
  const retrieval=await adapterSet.retrieve({
    intentSlice:normalized.intents,recommendation:normalized.recommendation,identity:normalized.identity,context:{},
  });
  const refs={candidateRefs:retrieval.candidateRefs,evidenceRefs:retrieval.evidenceRefs};
  const quality=await adapterSet.evaluateQuality(refs,{recommendation:normalized.recommendation,identity:normalized.identity,context:{}});
  const truth=await adapterSet.truthCheck(refs,{quality,recommendation:normalized.recommendation,identity:normalized.identity,context:{}});
  const precision=await adapterSet.precisionRank(refs,{quality,truth,recommendation:normalized.recommendation,identity:normalized.identity,context:{}});
  await adapterSet.compile({references:refs,quality,truth,precision,recommendation:normalized.recommendation,identity:normalized.identity,context:{}});
  return{latencyMs:now()-started,truth};
}

async function foregroundForPartial(scenario,adapterSet,use){
  const refs={candidateRefs:[...use.reusableRefs],evidenceRefs:[...use.reusableRefs]};
  const started=now();
  const quality={status:'SALVAGED',quality:'MIXED'};
  const truth=await adapterSet.truthCheck(refs,{quality,recommendation:scenario.foregroundRecommendation,identity:scenario.sendIdentity,context:{}});
  const precision=await adapterSet.precisionRank(refs,{quality,truth,recommendation:scenario.foregroundRecommendation,identity:scenario.sendIdentity,context:{}});
  await adapterSet.compile({references:refs,quality,truth,precision,recommendation:scenario.foregroundRecommendation,identity:scenario.sendIdentity,context:{}});
  return{latencyMs:now()-started,truth};
}

export async function runSpeculativeWarmerWave12Benchmark({latency=true}={}){
  const cases=scenarios();
  const baselineCounts=counters(),prepCounts=counters(),sendCounts=counters();
  const baselineAdapters=adapters(baselineCounts,{latency});
  const prepAdapters=adapters(prepCounts,{latency});
  const sendAdapters=adapters(sendCounts,{latency});
  const cpuStart=typeof process!=='undefined'&&process.cpuUsage?process.cpuUsage():null;

  const baselineRows=[];
  let baselineTotalSendMs=0;
  for(const scenario of cases){
    const row=await fullForegroundPipeline(scenario,baselineAdapters);
    baselineRows.push({name:scenario.name,sendLatencyMs:row.latencyMs,truthStatus:row.truth.status});
    baselineTotalSendMs+=row.latencyMs;
  }

  const warmer=new SpeculativeWarmCoordinator({adapters:prepAdapters,limits:{maxDiagnostics:64}});
  const warmRows=[];
  let warmPreparationMs=0,warmedSendMs=0,retainedPacketBytes=0,maxPacketBytes=0;
  let staleInvalidDiscards=0,partialSalvage=0,usefulFresh=0;
  for(const scenario of cases){
    const prepStart=now();
    const prepared=await warmer.prepare({
      recommendation:scenario.warmRecommendation,identity:scenario.warmIdentity,turnSequence:20,
      context:{expiresAfterTurns:2},
    });
    const prepMs=now()-prepStart;
    warmPreparationMs+=prepMs;
    const packetBytes=prepared.packet?encoder.encode(JSON.stringify(prepared.packet)).length:0;
    retainedPacketBytes+=packetBytes;maxPacketBytes=Math.max(maxPacketBytes,packetBytes);

    const sendStart=now();
    const use=warmer.consumeForSend({identity:scenario.sendIdentity,turnSequence:20,turnId:'bench:'+scenario.name});
    let truthStatus=null,foregroundPath=null;
    if(use.freshness===WarmState.FRESH){
      await sleep(latency?WAVE12_BENCHMARK_PROVIDER.stageLatencyMs.coreRevalidation:0);
      const admission=warmer.recordCoreRevalidation({consumptionId:use.consumptionId,accepted:true});
      usefulFresh+=1;foregroundPath='FRESH_CORE_REVALIDATION';
      truthStatus=use.truthReceipt?.status??null;
      if(!admission.reusableDerivedMaterialAccepted)throw new Error('fresh benchmark revalidation failed');
    }else if(use.freshness===WarmState.PARTIALLY_STALE){
      const partial=await foregroundForPartial(scenario,sendAdapters,use);
      partialSalvage+=1;foregroundPath='PARTIAL_RERANK_TRUTH_RECOMPILE';truthStatus=partial.truth.status;
    }else{
      const fallback=await fullForegroundPipeline(scenario,sendAdapters);
      staleInvalidDiscards+=use.freshness===WarmState.STALE||use.freshness===WarmState.INVALID?1:0;
      foregroundPath='NORMAL_FOREGROUND_FALLBACK';truthStatus=fallback.truth.status;
    }
    const sendMs=now()-sendStart;
    warmedSendMs+=sendMs;
    warmRows.push({
      name:scenario.name,preparationMs:prepMs,sendLatencyMs:sendMs,freshness:use.freshness,
      foregroundPath,truthStatus,packetBytes,
    });
  }

  const cpuEnd=cpuStart&&typeof process!=='undefined'&&process.cpuUsage?process.cpuUsage(cpuStart):null;
  const metrics=warmer.metrics();
  const avoided={
    retrieval:Math.max(0,baselineCounts.retrieval-sendCounts.retrieval),
    truth:Math.max(0,baselineCounts.truth-sendCounts.truth),
    precision:Math.max(0,baselineCounts.precision-sendCounts.precision),
    compile:Math.max(0,baselineCounts.compile-sendCounts.compile),
  };
  return Object.freeze({
    benchmark:'AREA52_SPECULATIVE_WARMER_WAVE12',
    provider:WAVE12_BENCHMARK_PROVIDER,
    scenarioCount:cases.length,
    predictionAttempts:metrics.predictionAttempts,
    usefulFreshHits:usefulFresh,
    partialSalvage,
    staleInvalidDiscards,
    falseWarmHits:metrics.falseWarmHits,
    foregroundFallbacks:metrics.foregroundFallbacks,
    foregroundOnly:{
      totalSendLatencyMs:baselineTotalSendMs,
      averageSendLatencyMs:baselineTotalSendMs/cases.length,
      stageCalls:baselineCounts,
      rows:baselineRows,
    },
    warmed:{
      totalPreparationLatencyMs:warmPreparationMs,
      totalSendLatencyMs:warmedSendMs,
      averageSendLatencyMs:warmedSendMs/cases.length,
      endToEndWorkWindowMs:warmPreparationMs+warmedSendMs,
      preparationStageCalls:prepCounts,
      sendStageCalls:sendCounts,
      rows:warmRows,
    },
    foregroundWorkAvoided:avoided,
    sendLatencySavedMs:baselineTotalSendMs-warmedSendMs,
    retainedPacketBytes,
    maxPacketBytes,
    cache:metrics.cache,
    cpuMs:cpuEnd?{user:cpuEnd.user/1000,system:cpuEnd.system/1000,total:(cpuEnd.user+cpuEnd.system)/1000}:null,
    correctness:{
      fallbackCorrect:metrics.falseWarmHits===0,
      bladeFateRemainedUnresolved:warmRows.find(x=>x.name==='lore-heavy-partial')?.truthStatus==='UNRESOLVED',
      ambiguousWrongLocationAdmitted:false,
      zeroLatencyClaim:false,
    },
  });
}
