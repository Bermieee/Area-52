import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GreenRoomStore,
  NativeHotDeepScheduler,
  SpeculativeWarmCoordinator,
} from '../src/coprocessor/index.js';

function identity(i=0){return{
  chatId:'stress-chat',sceneRevision:1,worldRevision:1,characterStateRevision:1,
  sourceRevisionSet:['stress:1'],intentFingerprint:'stress:intent:'+i,retrievalPolicyRevision:'r1',
};}
function recommendation(i=0){return{
  kind:'PrefetchRecommendation',recommendationId:'stress:rec:'+i,sceneId:'stress:scene',sceneRevision:1,trigger:'LIKELY_NEXT_LOCATION',
  entityRefs:['stress:char'],locationRefs:['stress:loc:'+i],threadRefs:[],sceneRefs:['stress:scene'],priority:'NORMAL',expiryRevision:2,
  evidenceRefs:['stress:e'],sourceRevisionRefs:['stress:1'],sourceRevisionSet:['stress:1'],authority:'NONE',status:'ACTIVE',
};}

test('Wave18 stress keeps Deep work bounded and completes many logical jobs on one physical slot',async()=>{
  let now=0;
  const scheduler=new NativeHotDeepScheduler({resourceSlots:1,foregroundReserve:1,now:()=>now,maxHistory:32});
  for(let i=0;i<64;i++){
    scheduler.enqueueDeep({
      workId:'stress:deep:'+i,
      metadata:{owner:'MEMORY'},
      async runSlice(){now+=1;return{state:'COMPLETED',done:true,ownerAccepted:i%2===0,ownerPublishedArtifactIds:i%2===0?['artifact:'+i]:[]};},
    });
  }
  for(let i=0;i<64;i++){
    const out=await scheduler.runDeepSlice('stress:deep:'+i);
    assert.equal(out.status,'COMPLETED');
  }
  const read=scheduler.readModel();
  assert.equal(read.metrics.deepCompleted,64);
  assert.equal(read.metrics.totalDeepExecutionMs,64);
  assert.equal(read.activeDeep,0);
  assert.ok(read.history.length<=32);
  assert.equal(read.deepWork.length,64);
});

test('Wave18 stress bounds queued speculative work and cancels divergent predictions without leaks',async()=>{
  const warmer=new SpeculativeWarmCoordinator({limits:{maxActivePreparations:1,maxQueuedPreparations:4,maxIntents:8}});
  warmer.onForegroundStart({turnId:'stress:fg'});
  const handles=[];
  for(let i=0;i<10;i++)handles.push(warmer.enqueuePreparation({recommendation:recommendation(i),identity:identity(i),turnSequence:1}));
  const queued=handles.filter(x=>x.status==='QUEUED');
  const full=handles.filter(x=>x.status==='QUEUE_FULL');
  assert.equal(queued.length,5);
  assert.equal(full.length,5);
  const cancelled=warmer.invalidateActiveWork({
    currentIdentity:{...identity(999),sceneRevision:2,sourceRevisionSet:['stress:2']},
    reason:'STRESS_DIVERGENCE',
  });
  assert.equal(cancelled,5);
  warmer.onForegroundEnd();
  const results=await Promise.all(queued.map(x=>x.promise));
  assert.ok(results.every(x=>x.status==='CANCELLED'));
  const metrics=warmer.metrics();
  assert.equal(metrics.preparationsCancelled,5);
  assert.equal(metrics.queueFullFallbacks,5);
  assert.equal(metrics.activePreparations,0);
  assert.equal(metrics.queuedPreparations,0);
});

test('Wave18 Green Room stress retains bounded active/history state',()=>{
  const store=new GreenRoomStore({maxCharacters:4,maxHistory:10,defaultTtlTurns:4});
  for(let turn=0;turn<40;turn++){
    store.putBatch({sceneRevision:1,characters:[{
      characterRef:'c'+(turn%6),evidenceRefs:['e:'+turn],sourceRevisionSet:['s:'+turn],confidence:.5,dimensions:{uncertainty:.5},
    }]},{turnSequence:turn});
  }
  assert.ok(store.size()<=4);
  assert.ok(store.historySize()<=10);
  assert.ok(store.metrics().evictions>0);
});
