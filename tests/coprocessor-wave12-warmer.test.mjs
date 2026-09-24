import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CoprocessorTelemetry,
  SpeculativeWarmCoordinator,
  WarmPacketCache,
  WarmState,
} from '../src/coprocessor/index.js';

const recommendation = ({
  id='rec:1', sceneId='scene:tavern', sceneRevision=7, trigger='SCENE_PREFETCH',
  entityRefs=['char:Mara'], locationRefs=['loc:ember-tavern'], threadRefs=['thread:blade'],
  sceneRefs=['scene:tavern'], evidenceRefs=['ev:1'], sourceRevisionSet=['src:scene:7'],
}={})=>({
  kind:'PrefetchRecommendation',recommendationId:id,sceneId,sceneRevision,trigger,
  entityRefs,locationRefs,threadRefs,sceneRefs,priority:'NORMAL',expiryRevision:sceneRevision+2,
  evidenceRefs,sourceRevisionRefs:sourceRevisionSet,sourceRevisionSet,authority:'NONE',status:'ACTIVE',
});

const identity = ({
  sceneRevision=7,worldRevision=12,characterStateRevision=4,
  sourceRevisionSet=['src:scene:7'],intentFingerprint='intent:tavern',
  retrievalPolicyRevision='policy:1',
}={})=>({sceneRevision,worldRevision,characterStateRevision,sourceRevisionSet,intentFingerprint,retrievalPolicyRevision});

const artifactRef=(id='compiled:tavern',revision=1,ident=identity())=>({
  kind:'ArtifactReference',artifactId:id,artifactType:'CompiledContextCandidate',owner:'CORE',
  revision,storageDomain:'compiled',sourceRevisionSet:[...ident.sourceRevisionSet],
  worldRevision:ident.worldRevision,sceneRevision:ident.sceneRevision,
});

function fullAdapters({delay=null,compileValue=null,truthValue=null}={}){
  const wait=delay??(async()=>{});
  return {
    providerMode:'DETERMINISTIC_TEST',
    retrieve:async({intentSlice,recommendation:rec})=>{
      await wait('retrieval');
      return {
        status:'OK',
        candidateRefs:intentSlice.map((x)=>x.ref),
        evidenceRefs:rec.evidenceRefs,
        receipt:{status:'OK',retrieved:intentSlice.length},
      };
    },
    evaluateQuality:async(refs)=>{await wait('quality');return{status:'OK',quality:refs.candidateRefs.length?'HIGH':'LOW'};},
    truthCheck:async()=>{await wait('truth');return truthValue??{status:'VERIFIED',checked:true,conflictState:'RESOLVED'};},
    precisionRank:async(refs)=>{await wait('precision');return{status:'RANKED',ranked:true,count:refs.candidateRefs.length};},
    compile:async({identity:ident})=>{await wait('compile');return compileValue??{compiledRef:artifactRef('compiled:tavern',1,ident)};},
  };
}

test('confirmed location move warms reference-first material and fresh send still requires Core revalidation/admission',async()=>{
  const telemetry=new CoprocessorTelemetry();
  const warmer=new SpeculativeWarmCoordinator({adapters:fullAdapters(),telemetry});
  const rec=recommendation({
    id:'rec:move',sceneId:'scene:blade-shrine',sceneRevision:8,trigger:'LOCATION_TRANSITION_CONFIRMED',
    locationRefs:['loc:sun-blade-shrine'],sceneRefs:['scene:blade-shrine'],evidenceRefs:['ev:door-crossed'],
    sourceRevisionSet:['src:scene:8'],
  });
  const ident=identity({
    sceneRevision:8,worldRevision:13,characterStateRevision:5,sourceRevisionSet:['src:scene:8'],
    intentFingerprint:'intent:enter-sun-blade',retrievalPolicyRevision:'policy:1',
  });
  const prepared=await warmer.prepare({recommendation:rec,identity:ident,turnSequence:10});
  assert.equal(prepared.status,'WARMED');
  assert.equal(prepared.packet.authority,'NONE');
  assert.ok(prepared.packet.candidateRefs.includes('loc:sun-blade-shrine'));
  assert.equal(prepared.packet.compiledRepresentation.kind,'WarmCompiledReference');

  const use=warmer.consumeForSend({identity:ident,turnSequence:10,turnId:'turn:10'});
  assert.equal(use.status,'REVALIDATE_FOR_CORE_ADMISSION');
  assert.equal(use.freshness,WarmState.FRESH);
  assert.equal(use.admissionAllowed,false);
  assert.ok(use.requiredForegroundStages.includes('CORE_FRESHNESS_REVALIDATION'));
  assert.ok(use.requiredForegroundStages.includes('CORE_TRUTH_RECEIPT_REVALIDATION'));
  assert.ok(use.requiredForegroundStages.includes('CORE_ADMISSION'));
  assert.equal(use.compiledReference.artifactId,'compiled:tavern');

  const admitted=warmer.recordCoreRevalidation({consumptionId:use.consumptionId,accepted:true});
  assert.equal(admitted.status,'CORE_REVALIDATED');
  assert.equal(admitted.admissionAuthority,'CORE_ONLY');
  assert.equal(warmer.metrics().usefulFreshHits,1);
  assert.equal(warmer.metrics().falseWarmHits,0);
});

test('false doorway or mentioned-only location cannot admit wrong-location context',async()=>{
  const warmer=new SpeculativeWarmCoordinator({adapters:fullAdapters()});
  const predicted=identity({intentFingerprint:'intent:maybe-doorway'});
  await warmer.prepare({
    recommendation:recommendation({
      id:'rec:false-door',trigger:'MENTIONED_LOCATION',locationRefs:['loc:sun-blade-shrine'],
      evidenceRefs:['ev:mentioned-only'],sourceRevisionSet:['src:scene:7'],
    }),
    identity:predicted,turnSequence:4,
  });

  const actual=identity({intentFingerprint:'intent:remain-ember-tavern'});
  const use=warmer.consumeForSend({identity:actual,turnSequence:4,turnId:'turn:4'});
  assert.equal(use.status,'FOREGROUND_FALLBACK');
  assert.equal(use.reason,'MISS');
  assert.equal(use.admissionAllowed,false);
  assert.equal(warmer.metrics().usefulFreshHits,0);
  assert.equal(warmer.metrics().falseWarmHits,0);
});

test('source edit and character change are partial; Scene, world and policy changes are stale',async()=>{
  const cache=new WarmPacketCache({capacity:8,maxCandidateRefs:128,defaultTtlTurns:3});
  const warmer=new SpeculativeWarmCoordinator({adapters:fullAdapters(),cache});
  const base=identity({sourceRevisionSet:['src:scene:7','src:lore:1']});
  await warmer.prepare({
    recommendation:recommendation({sourceRevisionSet:['src:scene:7']}),
    identity:base,turnSequence:2,
  });

  const sourceEdit=warmer.consumeForSend({
    identity:identity({sourceRevisionSet:['src:scene:7','src:lore:2']}),turnSequence:2,turnId:'source-edit',
  });
  assert.equal(sourceEdit.freshness,WarmState.PARTIALLY_STALE);
  assert.deepEqual(sourceEdit.requiredForegroundStages,['RERANK','TRUTH_RECHECK','RECOMPILE','CORE_ADMISSION']);
  assert.equal(sourceEdit.compiledReference,null);

  const characterChange=warmer.consumeForSend({
    identity:identity({sourceRevisionSet:['src:scene:7','src:lore:1'],characterStateRevision:5}),turnSequence:2,turnId:'char-edit',
  });
  assert.equal(characterChange.freshness,WarmState.PARTIALLY_STALE);

  const sceneChange=warmer.consumeForSend({
    identity:identity({sceneRevision:8,sourceRevisionSet:['src:scene:7','src:lore:1']}),turnSequence:2,turnId:'scene-edit',
  });
  assert.equal(sceneChange.freshness,WarmState.STALE);

  const worldChange=warmer.consumeForSend({
    identity:identity({worldRevision:13,sourceRevisionSet:['src:scene:7','src:lore:1']}),turnSequence:2,turnId:'world-edit',
  });
  assert.equal(worldChange.freshness,WarmState.STALE);

  const policyChange=warmer.consumeForSend({
    identity:identity({sourceRevisionSet:['src:scene:7','src:lore:1'],retrievalPolicyRevision:'policy:2'}),turnSequence:2,turnId:'policy-edit',
  });
  assert.equal(policyChange.freshness,WarmState.STALE);
});

test('Blade fate conflict remains UNRESOLVED and certain-sounding compile output is not cached as reusable prompt material',async()=>{
  const warmer=new SpeculativeWarmCoordinator({adapters:fullAdapters({
    truthValue:{status:'UNRESOLVED',checked:true,conflictState:'UNRESOLVED',reason:'conflicting Blade fate evidence'},
    compileValue:{summary:'The Sun Blade is certainly destroyed.',confidence:1},
  })});
  const prepared=await warmer.prepare({
    recommendation:recommendation({id:'rec:blade-conflict',evidenceRefs:['ev:blade-destroyed','ev:blade-seen-later']}),
    identity:identity(),turnSequence:5,
  });
  assert.equal(prepared.packet.truthReceipt.status,'UNRESOLVED');
  assert.equal(prepared.packet.truthReceipt.conflictState,'UNRESOLVED');
  assert.equal(prepared.packet.compiledRepresentation.kind,'WarmCompiledReceipt');
  assert.equal(prepared.packet.compiledRepresentation.reusable,false);
  assert.equal('summary' in prepared.packet.compiledRepresentation,false);

  const use=warmer.consumeForSend({identity:identity(),turnSequence:5,turnId:'turn:blade'});
  assert.equal(use.truthReceipt.status,'UNRESOLVED');
  assert.equal(use.compiledReference,null);
  assert.ok(use.requiredForegroundStages.includes('COMPILE'));
  assert.equal(use.admissionAllowed,false);
});

test('native/default path is honest reference-only work and cannot claim retrieval, Truth, Precision or compile avoidance',async()=>{
  const warmer=new SpeculativeWarmCoordinator();
  const prepared=await warmer.prepare({recommendation:recommendation(),identity:identity(),turnSequence:1});
  assert.equal(prepared.status,'WARMED');
  assert.equal(prepared.packet.metadata.providerMode,'NATIVE_REFERENCE_ONLY');
  const use=warmer.consumeForSend({identity:identity(),turnSequence:1,turnId:'native'});
  assert.equal(use.status,'REVALIDATE_FOR_CORE_ADMISSION');
  assert.ok(use.requiredForegroundStages.includes('RETRIEVAL'));
  assert.ok(use.requiredForegroundStages.includes('TRUTH_CHECK'));
  assert.ok(use.requiredForegroundStages.includes('OPTIONAL_PRECISION'));
  assert.ok(use.requiredForegroundStages.includes('COMPILE'));
  const admitted=warmer.recordCoreRevalidation({consumptionId:use.consumptionId,accepted:true});
  assert.deepEqual(admitted.avoidedWork,{retrieval:false,truth:false,precision:false,compile:false});
});

test('missing recommendation, worker failure and timeout all preserve normal foreground fallback',async()=>{
  const warmer=new SpeculativeWarmCoordinator({adapters:fullAdapters()});
  const missing=await warmer.prepare({identity:identity()});
  assert.equal(missing.status,'REJECTED');
  assert.equal(missing.foregroundFallback,'NORMAL_FOREGROUND_RETRIEVAL');

  const failed=new SpeculativeWarmCoordinator({adapters:{
    providerMode:'FAILING_TEST',
    retrieve:async()=>{throw new Error('worker exploded');},
    evaluateQuality:async()=>({quality:'LOW'}),
  }});
  const failResult=await failed.prepare({recommendation:recommendation(),identity:identity()});
  assert.equal(failResult.status,'WARMER_FAILED');
  assert.equal(failResult.foregroundFallback,'NORMAL_FOREGROUND_RETRIEVAL');

  const timed=new SpeculativeWarmCoordinator({adapters:{
    providerMode:'TIMEOUT_TEST',
    retrieve:async()=>{throw new Error('PROVIDER_TIMEOUT');},
    evaluateQuality:async()=>({quality:'LOW'}),
  }});
  const timeout=await timed.prepare({recommendation:recommendation(),identity:identity()});
  assert.equal(timeout.status,'WARMER_FAILED');
  assert.match(timeout.reason,/PROVIDER_TIMEOUT/);
});

test('cache eviction and TTL expiry fall back without fabricated evidence',async()=>{
  const cache=new WarmPacketCache({capacity:1,maxCandidateRefs:128,defaultTtlTurns:1});
  const warmer=new SpeculativeWarmCoordinator({adapters:fullAdapters(),cache});
  const first=identity({intentFingerprint:'intent:first'});
  const second=identity({intentFingerprint:'intent:second'});
  await warmer.prepare({recommendation:recommendation({id:'r:first'}),identity:first,turnSequence:1});
  await warmer.prepare({recommendation:recommendation({id:'r:second'}),identity:second,turnSequence:1});
  const evicted=warmer.consumeForSend({identity:first,turnSequence:1,turnId:'evicted'});
  assert.equal(evicted.status,'FOREGROUND_FALLBACK');
  assert.equal(evicted.reason,'MISS');

  const ttl=warmer.consumeForSend({identity:second,turnSequence:3,turnId:'expired'});
  assert.equal(ttl.status,'FOREGROUND_FALLBACK');
  assert.equal(ttl.freshness,WarmState.STALE);
  assert.equal(ttl.reason,'TTL_EXPIRED');
});

test('prepared result arriving after Context Seal is unavailable to that generation but may remain future-safe',async()=>{
  let release;
  const gate=new Promise((resolve)=>{release=resolve;});
  const adapters=fullAdapters({delay:async(stage)=>{if(stage==='retrieval')await gate;}});
  const warmer=new SpeculativeWarmCoordinator({adapters});
  const handle=warmer.enqueuePreparation({
    recommendation:recommendation({id:'late'}),identity:identity(),turnSequence:9,context:{targetTurnId:'turn:9'},
  });
  warmer.markTurnSealed('turn:9');
  release();
  const prepared=await handle.promise;
  assert.equal(prepared.status,'LATE_CACHED_FOR_FUTURE');
  assert.equal(prepared.usableForTargetTurn,false);

  const sealedUse=warmer.consumeForSend({identity:identity(),turnSequence:9,turnId:'turn:9'});
  assert.equal(sealedUse.status,'LATE_REJECTED');
  assert.equal(sealedUse.admissionAllowed,false);

  const futureUse=warmer.consumeForSend({identity:identity(),turnSequence:9,turnId:'turn:10'});
  assert.equal(futureUse.status,'REVALIDATE_FOR_CORE_ADMISSION');
});

test('one-resource scheduling coalesces repeats, yields at a batch boundary and resumes without an unbounded queue',async()=>{
  let releaseFirst;
  const firstGate=new Promise((resolve)=>{releaseFirst=resolve;});
  let retrievalCalls=0;
  const adapters=fullAdapters({delay:async(stage)=>{
    if(stage==='retrieval'&&retrievalCalls++===0)await firstGate;
  }});
  const warmer=new SpeculativeWarmCoordinator({
    adapters,
    limits:{maxActivePreparations:1,maxQueuedPreparations:3,retrievalBatchSize:1,maxIntents:8},
  });
  const rec=recommendation({id:'repeat',entityRefs:['e:1','e:2','e:3'],locationRefs:[],threadRefs:[],sceneRefs:[]});
  const first=warmer.enqueuePreparation({recommendation:rec,identity:identity(),turnSequence:1});
  const repeat=warmer.enqueuePreparation({
    recommendation:{...rec,recommendationId:'repeat:2'},identity:identity(),turnSequence:1,
  });
  assert.equal(repeat.status,'COALESCED');
  assert.equal(repeat.preparationId,first.preparationId);

  const unique=[];
  for(let i=0;i<6;i++){
    unique.push(warmer.enqueuePreparation({
      recommendation:recommendation({id:'unique:'+i,entityRefs:['u:'+i],locationRefs:[],threadRefs:[],sceneRefs:[]}),
      identity:identity({intentFingerprint:'intent:u:'+i}),turnSequence:1,
    }));
  }
  assert.ok(unique.some((x)=>x.status==='QUEUE_FULL'));
  assert.ok(warmer.metrics().queuedPreparations<=3);

  warmer.onForegroundStart({turnId:'foreground'});
  releaseFirst();
  await new Promise((resolve)=>setTimeout(resolve,0));
  assert.ok(warmer.metrics().preparationsYielded>=1);
  warmer.onForegroundEnd();
  const result=await first.promise;
  assert.equal(result.status,'WARMED');
  assert.ok(warmer.metrics().preparationsResumed>=1);
  assert.ok(warmer.metrics().activePreparations<=1);
  assert.ok(warmer.metrics().queuedPreparations<=3);
});
