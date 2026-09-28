import test from 'node:test';
import assert from 'node:assert/strict';

import {Area52NativeBrain} from '../src/native-brain.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';
import {createMemoryIntegrationSurface} from '../src/memory-integration-surface.js';

function scene(sceneId,sceneRevision,{location='Test Location',activeCast=['Ari'],relationship=null}={}){
  return{
    sceneId,sceneRevision,location,narrativeTime:'turn '+sceneRevision,
    activeCast,activeThreads:[],objects:[],sceneRelationship:relationship,
    sourceRevisionRefs:[],provenance:['worker1-execution:'+sceneId+':'+sceneRevision],
  };
}

function selected(brain,prepared){
  return brain.uiBindings().readSelectedTurnReceipt(prepared.selection);
}

test('Worker 1 dense eligibility: Hot-sufficient turn performs zero dense provider attempts',async()=>{
  const memory=new MemoryTemporalProducer();
  let attempts=0;
  memory.attachVectorExecutor(async()=>{attempts+=1;return{embeddings:[[1,0]],executionId:'unexpected'};});
  const brain=new Area52NativeBrain({memoryInterface:createMemoryIntegrationSurface(memory)});

  const prepared=await brain.prepareTurn({
    chatId:'chat:hot-only',turnId:'hot-only:1',generationId:'gen:hot-only:1',
    query:'Where are we?',intent:'CURRENT',scene:scene('hot-room',1,{location:'Hot Room'}),
    executionLabel:'DETERMINISTIC',
  });

  assert.ok(prepared.cognitiveChoice.paths.includes('HOT_ONLY'));
  assert.equal(attempts,0);
  const dense=selected(brain,prepared).denseRetrieval;
  assert.equal(dense.status,'SKIPPED');
  assert.equal(dense.reasonCode,'HOT_SUFFICIENT');
  assert.equal(dense.requested,false);
  assert.equal(dense.providerAttempted,false);
  assert.equal(dense.providerReturned,false);
  assert.equal(dense.ownerAdmitted,false);
  assert.equal(dense.resultClass,'OPPORTUNISTIC');
});

test('Worker 1 dense eligibility: retrieval-required turn executes dense Memory through the owner interface',async()=>{
  const memory=new MemoryTemporalProducer();
  let attempts=0;
  memory.attachVectorExecutor(async(request)=>{
    attempts+=1;
    assert.equal(request.operation,'EMBED_QUERY');
    return{
      embeddings:[[1,0]],executionId:'exec:dense:1',providerRequestId:'provider:dense:1',
      providerId:'test-vector',actualModelId:'test-embed',latencyMs:2,
      providerAttempted:true,providerReturned:true,
    };
  });
  const brain=new Area52NativeBrain({memoryInterface:createMemoryIntegrationSurface(memory)});

  const prepared=await brain.prepareTurn({
    chatId:'chat:dense',turnId:'dense:1',generationId:'gen:dense:1',
    query:'Recall what happened before we reached this room.',intent:'HISTORICAL',
    scene:scene('dense-room',1),executionLabel:'DETERMINISTIC',
  });

  assert.equal(attempts,1);
  assert.ok(prepared.cognitiveChoice.admittedJobs.includes('RETRIEVAL'));
  const dense=selected(brain,prepared).denseRetrieval;
  assert.equal(dense.status,'READY');
  assert.equal(dense.requested,true);
  assert.equal(dense.providerAttempted,true);
  assert.equal(dense.providerReturned,true);
  assert.equal(dense.ownerAdmitted,true);
  assert.equal(dense.executionId,'exec:dense:1');
  assert.equal(brain.core.publication.seal.verify('dense:1').sealed,true);
});

test('Worker 1 dense eligibility: unavailable and stale dense results fall back without crossing selected-state fences',async()=>{
  {
    const memory=new MemoryTemporalProducer();
    const brain=new Area52NativeBrain({memoryInterface:createMemoryIntegrationSurface(memory)});
    const prepared=await brain.prepareTurn({
      chatId:'chat:dense-unavailable',turnId:'dense-unavailable:1',generationId:'gen:dense-unavailable:1',
      query:'Recall an earlier event.',intent:'HISTORICAL',scene:scene('unavailable-room',1),executionLabel:'DETERMINISTIC',
    });
    const dense=selected(brain,prepared).denseRetrieval;
    assert.equal(dense.status,'UNAVAILABLE');
    assert.equal(dense.reasonCode,'VECTOR_PROVIDER_UNAVAILABLE');
    assert.equal(dense.requested,true);
    assert.equal(dense.providerAttempted,false);
    assert.equal(dense.ownerAdmitted,false);
    assert.equal(brain.core.publication.seal.verify('dense-unavailable:1').sealed,true);
  }

  {
    const memory=new MemoryTemporalProducer();
    let brain=null,attempts=0;
    memory.attachVectorExecutor(async()=>{
      attempts+=1;
      brain.observeScene('chat:dense-stale',scene('stale-room-new',2,{location:'New Room',relationship:'PRECEDES'}));
      return{
        embeddings:[[1,0]],executionId:'exec:stale:1',providerRequestId:'provider:stale:1',
        providerId:'test-vector',actualModelId:'test-embed',providerAttempted:true,providerReturned:true,
      };
    });
    brain=new Area52NativeBrain({memoryInterface:createMemoryIntegrationSurface(memory)});
    const prepared=await brain.prepareTurn({
      chatId:'chat:dense-stale',turnId:'dense-stale:1',generationId:'gen:dense-stale:1',
      query:'Recall the old room.',intent:'HISTORICAL',scene:scene('stale-room-old',1),
      executionLabel:'DETERMINISTIC',
    });
    assert.equal(attempts,1);
    const dense=selected(brain,prepared).denseRetrieval;
    assert.equal(dense.status,'STALE');
    assert.equal(dense.reasonCode,'DENSE_PRIME_STALE_SELECTED_STATE');
    assert.equal(dense.requested,true);
    assert.equal(dense.providerAttempted,true);
    assert.equal(dense.providerReturned,true);
    assert.equal(dense.ownerAdmitted,false);
    assert.equal(dense.executionId,'exec:stale:1');
    assert.equal(brain.core.publication.seal.verify('dense-stale:1').sealed,true);
  }
});

test('Worker 1 response boundary: slow L3 consolidation cannot hold response completion open and cannot mutate the sealed generation',async()=>{
  const memory=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(memory);
  let releaseConsolidation=null,startConsolidation=null;
  const consolidationStarted=new Promise(resolve=>{startConsolidation=resolve;});
  const gate=new Promise(resolve=>{releaseConsolidation=resolve;});
  const consolidator={
    kind:'Worker1SlowConsolidator',contractVersion:'1.0.0',
    async propose(input){
      startConsolidation(input);
      await gate;
      return{
        kind:'DeploymentMemoryConsolidationProposalReceipt',contractVersion:'1.0.0',
        status:'DEFERRED',reasonCode:'TEST_BACKGROUND_GATE_RELEASED',
        selection:input.selection,episodeId:input.episodeId,providerAttempted:true,
        rawChatIncluded:false,canonicalMutation:false,settlementAuthority:false,
      };
    },
  };
  const brain=new Area52NativeBrain({memoryInterface:surface,memoryConsolidationInterface:consolidator});
  const input={
    chatId:'chat:bg',turnId:'bg:1',generationId:'gen:bg:1',query:'Continue.',intent:'CURRENT',
    scene:scene('bg-room',1),executionLabel:'DETERMINISTIC',
  };
  const response='Ari places the brass marker beside the north window.';
  const runPromise=brain.runTurn(input,{
    generate:async()=>response,
    completeOptions:{autoDrain:false,knownBy:['Ari']},
  });
  const race=await Promise.race([
    runPromise.then(result=>({kind:'RESOLVED',result})),
    new Promise(resolve=>setTimeout(()=>resolve({kind:'TIMEOUT'}),500)),
  ]);
  assert.equal(race.kind,'RESOLVED','foreground runTurn waited for background consolidation');
  const result=race.result;
  assert.equal(result.completion?.status,'COMPLETED');
  assert.equal(result.completion?.responseRecordedBeforeBackgroundExecution,true);
  const sealedBefore=brain.readTurn('bg:1').published.sealReceipt.packetHash;

  await Promise.race([
    consolidationStarted,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('background consolidation did not start')),1000)),
  ]);
  const running=brain.uiBindings().readSelectedTurnReceipt(result.prepared.selection);
  assert.equal(running.completionLifecycle.responseCompletion.status,'COMPLETED');
  assert.equal(running.completionLifecycle.background.status,'RUNNING');
  assert.equal(running.completionLifecycle.background.backgroundPending,true);

  const duplicate=await brain.completeTurn({turnId:'bg:1',response,autoDrain:false});
  assert.equal(duplicate.responseCompletion.status,'COMPLETED');

  await brain.prepareTurn({
    chatId:'chat:other',turnId:'other:1',generationId:'gen:other:1',
    query:'Where are we?',intent:'CURRENT',scene:scene('other-room',1),executionLabel:'DETERMINISTIC',
  });

  releaseConsolidation();
  await brain.drainBackgroundLearning({maxCycles:128});

  const finished=brain.uiBindings().readSelectedTurnReceipt(result.prepared.selection);
  assert.equal(finished.completionLifecycle.responseCompletion.status,'COMPLETED');
  assert.equal(finished.completionLifecycle.background.status,'DEFERRED');
  assert.equal(finished.completionLifecycle.background.reasonCode,'BACKGROUND_LEARNING_DEFERRED');
  assert.equal(brain.readTurn('bg:1').published.sealReceipt.packetHash,sealedBefore);
  assert.equal(brain.readTurn('other:1').memoryConsolidation??null,null);
  assert.equal(memory.experienceStore.currentEpisodes().filter(row=>row.logicalId==='brain-turn:chat:bg:bg:1').length,1);
});
