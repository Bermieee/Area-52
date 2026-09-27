import test from 'node:test';
import assert from 'node:assert/strict';

import {Area52NativeBrain} from '../src/native-brain.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';
import {createMemoryIntegrationSurface} from '../src/memory-integration-surface.js';

function scene(sceneId,sceneRevision,{location=null,activeCast=[],relationship=null}={}){
  return{
    sceneId,sceneRevision,location,narrativeTime:'day '+sceneRevision,
    activeCast,activeThreads:[],objects:[],sceneRelationship:relationship,
    sourceRevisionRefs:[],provenance:['memory-cognition-test:'+sceneId+':'+sceneRevision],
  };
}

function channelIds(prepared){
  return new Set((prepared.candidateEnvelope?.candidates??[]).flatMap(candidate=>(candidate.channelNominations??[]).map(row=>row.channelId)));
}

test('Memory cognition: completed turn survives reload and later Historian evidence crosses Candidate Bus, Truth, Gather, Seal and observed delivery',async()=>{
  let memory=new MemoryTemporalProducer();
  let surface=createMemoryIntegrationSurface(memory);
  let brain=new Area52NativeBrain({memoryInterface:surface});

  await brain.prepareTurn({
    chatId:'chat:memory-loop',turnId:'memory-loop:A',generationId:'gen:memory-loop:A',
    query:'Continue from the observatory.',intent:'CURRENT',
    scene:scene('observatory',1,{location:'Observatory',activeCast:['Mira']}),
    executionLabel:'DETERMINISTIC',
  });
  const learnedA=await brain.completeTurn({
    turnId:'memory-loop:A',
    response:'Mira leaves the brass astrolabe inside the cedar cabinet beneath the western window.',
    knownBy:['Mira'],
    reflections:[{
      reflectionKey:'mira:checks-cabinet',
      statement:'Mira may habitually verify the cedar cabinet before leaving the observatory.',
      subjectRefs:['Mira'],
      polarity:'SUPPORT',
      confidence:.58,
    }],
  });
  assert.equal(learnedA.memoryPostTurn?.status,'COMPLETED');
  assert.ok(learnedA.memoryPostTurn?.episodeId);
  assert.equal(learnedA.memoryPostTurn?.reflectionReceipts?.[0]?.status,'SKIPPED');
  assert.equal(learnedA.memoryPostTurn?.reflectionReceipts?.[0]?.reasonCode,'MEMORY_REFLECTION_REPETITION_INSUFFICIENT');

  const episodeA=memory.experienceStore.artifact(learnedA.memoryPostTurn.episodeId);
  assert.equal(episodeA.chatId,'chat:memory-loop');
  assert.equal(episodeA.turnId,'memory-loop:A');
  assert.equal(episodeA.generationId,'gen:memory-loop:A');
  assert.equal(episodeA.sceneId,'observatory');
  assert.equal(episodeA.sceneRevision,1);
  assert.match(JSON.stringify(memory.experienceStore.exactDrillback(episodeA.id)),/brass astrolabe/i);
  assert.ok(memory.summaryHierarchy.currentArtifact('SCENE:brain:chat:memory-loop:observatory',{freshOnly:true}));
  assert.ok(memory.summaryHierarchy.currentArtifact('SESSION:brain:chat:memory-loop',{freshOnly:true}));
  assert.ok(memory.summaryHierarchy.currentArtifact('ARC:brain:chat:memory-loop',{freshOnly:true}));

  const brainSnapshot=brain.snapshot();
  const memorySnapshot=memory.snapshot();
  memory=MemoryTemporalProducer.fromSnapshot(memorySnapshot);
  surface=createMemoryIntegrationSurface(memory);
  brain=Area52NativeBrain.fromSnapshot(brainSnapshot,{memoryInterface:surface});

  const reloadedEpisode=memory.experienceStore.artifact(episodeA.id);
  assert.equal(reloadedEpisode.turnId,'memory-loop:A');
  assert.match(JSON.stringify(memory.experienceStore.exactDrillback(reloadedEpisode.id)),/cedar cabinet/i);

  const preparedB=await brain.prepareTurn({
    chatId:'chat:memory-loop',turnId:'memory-loop:B',generationId:'gen:memory-loop:B',
    query:'Where did Mira leave the brass astrolabe?',intent:'HISTORICAL',
    scene:scene('observatory-return',2,{location:'Observatory',activeCast:['Mira'],relationship:'PRECEDES'}),
    executionLabel:'DETERMINISTIC',
  });
  assert.equal(preparedB.memorySync?.status,'SYNCED');
  assert.ok(channelIds(preparedB).has('OWNER_MEMORY'));
  const memoryCandidates=(preparedB.candidateEnvelope?.candidates??[]).filter(candidate=>(candidate.channelNominations??[]).some(row=>row.channelId==='OWNER_MEMORY'));
  assert.ok(memoryCandidates.length>=1);
  assert.match(JSON.stringify(memoryCandidates),/brass astrolabe/i);

  const ownerSourceRef=episodeA.sourceRevisionRefs[0];
  assert.match(JSON.stringify(preparedB.truthAssessment),/HISTORICAL|CURRENT/);
  assert.ok(JSON.stringify(preparedB.truthAssessment).includes(ownerSourceRef));
  assert.ok(preparedB.gatherReceipt);
  assert.ok(preparedB.contextSealReceipt?.sealedState);
  assert.ok((preparedB.contextSealReceipt?.sourceRevisionIds??[]).includes(ownerSourceRef));
  assert.match(JSON.stringify(preparedB.promptPlan),/brass astrolabe/i);

  const delivery=preparedB.promptDeliveryReceipt;
  const observed=brain.recordObservedHostPromptEvidence('memory-loop:B',{
    host:'TEST_PROVIDER_BOUNDARY',requestId:'provider:req:memory-loop:B',live:true,
    chatId:'chat:memory-loop',turnId:'memory-loop:B',generationId:'gen:memory-loop:B',
    correlationId:preparedB.selection.correlationId,contextSealId:delivery.contextSealId,
    sealedPacketHash:delivery.sealedPacketHash,semanticManifestIdentity:delivery.semanticManifestIdentity,
    observedRoles:delivery.providerRoles,observedSections:(delivery.plannedSections??[]).map(row=>row.slot),
  });
  assert.equal(observed.status,'OBSERVED_MATCH');

  const trace=brain.uiBindings().readSelectedTurnReceipt(preparedB.selection);
  assert.equal(trace.producers.sensory.status,'PUBLISHED');
  assert.equal(trace.producers.truth.status,'PUBLISHED');
  assert.equal(trace.producers.gather.status,'PUBLISHED');
  assert.equal(trace.producers.contextSeal.status,'PUBLISHED');
  assert.equal(trace.producers.compiledDelivery.status,'PUBLISHED');
  assert.equal(trace.producers.delivery.status,'OBSERVED');
  assert.equal(trace.producers.delivery.matching,true);
});

test('Memory cognition: repetition establishes only INFERRED reflection and contradiction weakens it',async()=>{
  const memory=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(memory);
  const brain=new Area52NativeBrain({memoryInterface:surface});
  const reflection={
    reflectionKey:'nara:tide-check',
    statement:'Nara may habitually check the tide compass before a difficult crossing.',
    subjectRefs:['Nara'],
    confidence:.7,
  };

  for(const [index,response] of [
    [1,'Nara checks the tide compass before entering the reef channel.'],
    [2,'Before the storm channel, Nara checks the tide compass again.'],
  ]){
    await brain.prepareTurn({
      chatId:'chat:reflection',turnId:'reflection:'+index,generationId:'gen:reflection:'+index,
      query:'Continue.',intent:'CURRENT',
      scene:scene('reef-'+index,index,{location:'Reef Channel',activeCast:['Nara'],relationship:index===1?null:'PRECEDES'}),
      executionLabel:'DETERMINISTIC',
    });
    const learned=await brain.completeTurn({
      turnId:'reflection:'+index,response,knownBy:['Nara'],
      reflections:[{...reflection,polarity:'SUPPORT'}],
    });
    const receipt=learned.memoryPostTurn.reflectionReceipts[0];
    if(index===1){
      assert.equal(receipt.status,'SKIPPED');
      assert.equal(memory.experienceStore.currentReflections().length,0);
    }else{
      assert.equal(receipt.status,'COMPLETED');
    }
  }

  const established=memory.experienceStore.currentReflections()[0];
  assert.equal(established.authorityClass,'INFERRED');
  assert.equal(established.worldTruthAuthority,false);
  assert.equal(established.settlementAuthority,false);
  assert.equal(established.truthStatus,'INFERRED');
  const establishedConfidence=established.confidence;

  await brain.prepareTurn({
    chatId:'chat:reflection',turnId:'reflection:3',generationId:'gen:reflection:3',
    query:'Continue.',intent:'CURRENT',
    scene:scene('reef-3',3,{location:'Reef Channel',activeCast:['Nara'],relationship:'PRECEDES'}),
    executionLabel:'DETERMINISTIC',
  });
  const contradicted=await brain.completeTurn({
    turnId:'reflection:3',
    response:'Nara deliberately crosses the calm inlet without looking at the tide compass.',
    knownBy:['Nara'],
    reflections:[{...reflection,polarity:'CONTRADICT'}],
  });
  assert.equal(contradicted.memoryPostTurn.reflectionReceipts[0].status,'COMPLETED');
  const revised=memory.experienceStore.currentReflections()[0];
  assert.equal(revised.authorityClass,'INFERRED');
  assert.ok(revised.confidence<establishedConfidence);
  assert.ok(['CONTESTED','UNRESOLVED'].includes(revised.resolutionStatus));
  assert.ok(revised.contradictionEvidenceRefs.length>=1);
  assert.equal(memory.experienceStore.reflectionHistory('nara:tide-check').length,2);
});

test('Memory cognition: source correction revises one logical episode and only its dependent hierarchy cone',async()=>{
  const memory=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(memory);
  const brain=new Area52NativeBrain({memoryInterface:surface});

  for(const [turn,chat,sceneId,response] of [
    ['target:1','chat:target','target-scene','Iris leaves the silver key on the north shelf.'],
    ['other:1','chat:other','other-scene','Pell leaves a blue ribbon beside the garden gate.'],
  ]){
    await brain.prepareTurn({
      chatId:chat,turnId:turn,generationId:'gen:'+turn,query:'Continue.',intent:'CURRENT',
      scene:scene(sceneId,1,{location:sceneId,activeCast:[chat==='chat:target'?'Iris':'Pell']}),
      executionLabel:'DETERMINISTIC',
    });
    await brain.completeTurn({turnId:turn,response,knownBy:[chat==='chat:target'?'Iris':'Pell']});
  }

  const targetBefore=memory.experienceStore.currentEpisodes().find(row=>row.chatId==='chat:target');
  const unrelatedScope='SCENE:brain:chat:other:other-scene';
  const unrelatedBefore=memory.summaryHierarchy.currentArtifact(unrelatedScope,{freshOnly:true});
  const targetHistoryBefore=memory.summaryHierarchy.summaryHistory('SCENE:brain:chat:target:target-scene').length;

  const correction=brain.correctTurn({
    turnId:'target:1',
    response:'Correction: Iris moved the silver key to the south cabinet instead.',
    knownBy:['Iris'],
  });
  assert.equal(correction.memoryPostTurn?.status,'COMPLETED');

  const targetAfter=memory.experienceStore.currentEpisodes().find(row=>row.chatId==='chat:target');
  assert.equal(targetAfter.logicalId,targetBefore.logicalId);
  assert.equal(targetAfter.revision,targetBefore.revision+1);
  assert.notEqual(targetAfter.sourceRevisionRefs[0],targetBefore.sourceRevisionRefs[0]);
  assert.match(JSON.stringify(memory.experienceStore.exactDrillback(targetAfter.id)),/south cabinet/i);
  assert.equal(memory.experienceStore.episodeHistory(targetAfter.logicalId).length,2);
  assert.ok(memory.summaryHierarchy.summaryHistory('SCENE:brain:chat:target:target-scene').length>targetHistoryBefore);

  const unrelatedAfter=memory.summaryHierarchy.currentArtifact(unrelatedScope,{freshOnly:true});
  assert.equal(unrelatedAfter.id,unrelatedBefore.id);
});
