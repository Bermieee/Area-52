import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SpeculativeWarmCoordinator, WarmPacketCache, WarmState,
} from '../src/coprocessor/index.js';

const rec=(i,sceneRevision=7)=>({
  kind:'PrefetchRecommendation',recommendationId:'stress:'+i,sceneId:'scene:'+sceneRevision,sceneRevision,
  trigger:'STRESS_PREFETCH',entityRefs:['entity:'+(i%16)],locationRefs:['loc:'+(i%5)],
  threadRefs:['thread:'+(i%9)],sceneRefs:['scene:'+sceneRevision],priority:'NORMAL',
  expiryRevision:sceneRevision+3,evidenceRefs:['ev:'+i],sourceRevisionRefs:['src:scene:'+sceneRevision],
  sourceRevisionSet:['src:scene:'+sceneRevision],authority:'NONE',status:'ACTIVE',
});
const ident=(i,overrides={})=>({
  sceneRevision:7,worldRevision:20,characterStateRevision:5,
  sourceRevisionSet:['src:scene:7','src:lore:'+(i%4)],intentFingerprint:'intent:'+(i%24),
  retrievalPolicyRevision:'policy:1',...overrides,
});
const adapters={
  providerMode:'STRESS_DETERMINISTIC',
  retrieve:async({intentSlice,recommendation})=>({candidateRefs:intentSlice.map(x=>x.ref),evidenceRefs:recommendation.evidenceRefs,status:'OK'}),
  evaluateQuality:async()=>({quality:'HIGH',status:'OK'}),
  truthCheck:async()=>({status:'VERIFIED',checked:true}),
  precisionRank:async()=>({status:'RANKED',ranked:true}),
  compile:async({identity})=>({compiledRef:{
    kind:'ArtifactReference',artifactId:'compiled:'+identity.intentFingerprint,artifactType:'CompiledContextCandidate',owner:'CORE',
    revision:1,storageDomain:'compiled',sourceRevisionSet:[...identity.sourceRevisionSet],
    worldRevision:identity.worldRevision,sceneRevision:identity.sceneRevision,
  }}),
};

test('Wave 12 warmer stress stays bounded across repeated scenes, stale fences and cache pressure',async()=>{
  const cache=new WarmPacketCache({capacity:24,maxCandidateRefs:128,defaultTtlTurns:2});
  const warmer=new SpeculativeWarmCoordinator({
    adapters,cache,
    limits:{maxActivePreparations:1,maxQueuedPreparations:8,maxDiagnostics:64,maxSealedTurns:16},
  });
  let fresh=0,partial=0,stale=0,miss=0;
  for(let i=0;i<300;i++){
    const id=ident(i);
    await warmer.prepare({recommendation:rec(i),identity:id,turnSequence:i});
    const mode=i%4;
    const current=mode===0?id
      :mode===1?{...id,characterStateRevision:id.characterStateRevision+1}
      :mode===2?{...id,worldRevision:id.worldRevision+1}
      :{...id,intentFingerprint:'actual:'+i};
    const use=warmer.consumeForSend({identity:current,turnSequence:i,turnId:'turn:'+i});
    if(use.freshness===WarmState.FRESH){fresh++;warmer.recordCoreRevalidation({consumptionId:use.consumptionId,accepted:true});}
    else if(use.freshness===WarmState.PARTIALLY_STALE)partial++;
    else if(use.freshness===WarmState.STALE)stale++;
    else miss++;
    assert.ok(cache.size()<=24);
    assert.ok(warmer.metrics().retainedDiagnostics<=64);
    assert.ok(warmer.metrics().activePreparations<=1);
    assert.ok(warmer.metrics().queuedPreparations<=8);
  }
  assert.equal(fresh,75);
  assert.equal(partial,75);
  assert.equal(stale,75);
  assert.equal(miss,75);
  assert.equal(warmer.metrics().falseWarmHits,0);
  assert.ok(warmer.metrics().cache.evictions>0);
});

test('Wave 12 burst scheduling coalesces identical predictions and rejects excess work instead of growing without bound',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  let first=true;
  const gated={...adapters,retrieve:async(args)=>{if(first){first=false;await gate;}return adapters.retrieve(args);}};
  const warmer=new SpeculativeWarmCoordinator({
    adapters:gated,limits:{maxActivePreparations:1,maxQueuedPreparations:4,maxDiagnostics:32},
  });
  const handles=[];
  for(let i=0;i<100;i++){
    const duplicate=i<25;
    const n=duplicate?0:i;
    handles.push(warmer.enqueuePreparation({recommendation:rec(n),identity:ident(n),turnSequence:1}));
  }
  assert.ok(handles.filter(x=>x.status==='COALESCED').length>=24);
  assert.ok(handles.some(x=>x.status==='QUEUE_FULL'));
  assert.ok(warmer.metrics().queuedPreparations<=4);
  assert.ok(warmer.metrics().activePreparations<=1);
  release();
  await Promise.all(handles.map(x=>x.promise));
  assert.equal(warmer.metrics().activePreparations,0);
  assert.equal(warmer.metrics().queuedPreparations,0);
});
