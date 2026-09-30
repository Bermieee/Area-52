import test from 'node:test';
import assert from 'node:assert/strict';

import {Area52NativeBrain} from '../src/native-brain.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';
import {createMemoryIntegrationSurface} from '../src/memory-integration-surface.js';
import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {
  ConsolidationProposalKind,createConsolidationProposalBundle,createMemoryOwnerHandoff,
} from '../src/coprocessor/continuous-consolidation.js';
import {admitConsolidationBundleToMemoryOwner} from '../src/coprocessor/owner-integration.js';
import {
  Capability,ResourceKind,
} from '../src/coprocessor/index.js';

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
  const targetHistoryBefore=memory.summaryHistory('SCENE:brain:chat:target:target-scene').length;

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
  assert.ok(memory.summaryHistory('SCENE:brain:chat:target:target-scene').length>targetHistoryBefore);

  const unrelatedAfter=memory.summaryHierarchy.currentArtifact(unrelatedScope,{freshOnly:true});
  assert.equal(unrelatedAfter.id,unrelatedBefore.id);
});


test('Memory cognition: bounded post-turn work survives reload and resumes without duplicate episode publication',async()=>{
  let memory=new MemoryTemporalProducer();
  let surface=createMemoryIntegrationSurface(memory);
  let brain=new Area52NativeBrain({memoryInterface:surface});

  await brain.prepareTurn({
    chatId:'chat:resume-memory',turnId:'resume-memory:1',generationId:'gen:resume-memory:1',
    query:'Continue.',intent:'CURRENT',
    scene:scene('resume-dock',1,{location:'Resume Dock',activeCast:['Sol']}),
    executionLabel:'DETERMINISTIC',
  });
  const learned=await brain.completeTurn({
    turnId:'resume-memory:1',
    response:'Sol leaves the copper token beneath the third dock lantern.',
    knownBy:['Sol'],
    autoDrain:false,
  });
  assert.ok(learned.memoryRuntimeTaskId);
  assert.equal(brain.readTurn('resume-memory:1').memoryPostTurn??null,null);
  assert.equal(memory.experienceStore.currentEpisodes().length,0);

  const brainSnapshot=brain.snapshot();
  const memorySnapshot=memory.snapshot();
  memory=MemoryTemporalProducer.fromSnapshot(memorySnapshot);
  surface=createMemoryIntegrationSurface(memory);
  brain=Area52NativeBrain.fromSnapshot(brainSnapshot,{memoryInterface:surface});

  await brain.runtimeDirector.drain({maxCycles:128});
  const resumed=brain.readTurn('resume-memory:1').memoryPostTurn;
  assert.equal(resumed?.status,'COMPLETED');
  assert.ok(resumed?.episodeId);
  assert.equal(memory.experienceStore.currentEpisodes().filter(row=>row.logicalId==='brain-turn:chat:resume-memory:resume-memory:1').length,1);

  const episodeId=resumed.episodeId;
  await brain.runtimeDirector.drain({maxCycles:128});
  assert.equal(brain.readTurn('resume-memory:1').memoryPostTurn.episodeId,episodeId);
  assert.equal(memory.experienceStore.episodeHistory('brain-turn:chat:resume-memory:resume-memory:1').length,1);
});


test('Memory cognition: deployment Memory owner snapshot restores durable episodes',async()=>{
  const deploymentA=new DevelopmentDeploymentBrain();
  const brain=new Area52NativeBrain({memoryInterface:deploymentA.memorySurface});
  await brain.prepareTurn({
    chatId:'chat:deployment-memory',turnId:'deployment-memory:A',generationId:'gen:deployment-memory:A',
    query:'Continue.',intent:'CURRENT',
    scene:scene('archive-room',1,{location:'Archive Room',activeCast:['Tess']}),
    executionLabel:'DETERMINISTIC',
  });
  const learned=await brain.completeTurn({
    turnId:'deployment-memory:A',
    response:'Tess stores the ivory ledger in the lower archive drawer.',
    knownBy:['Tess'],
  });
  assert.equal(learned.memoryPostTurn?.status,'COMPLETED');
  const ownerSnapshot=deploymentA.snapshotMemoryOwner();
  assert.equal(ownerSnapshot.kind,'MemoryTemporalProducerSnapshot');

  const deploymentB=new DevelopmentDeploymentBrain({memoryOwnerSnapshot:ownerSnapshot});
  const restored=deploymentB.memory.experienceStore.currentEpisodes({freshOnly:true});
  assert.equal(restored.length,1);
  assert.equal(restored[0].turnId,'deployment-memory:A');
  assert.match(JSON.stringify(deploymentB.memory.experienceStore.exactDrillback(restored[0].id)),/ivory ledger/i);
  const historian=deploymentB.memory.queryHistorian({
    query:'Where is the ivory ledger?',
    mode:'EXPLICIT_HISTORY',
    selection:{chatId:'chat:deployment-memory',turnId:'deployment-memory:B',generationId:'gen:deployment-memory:B'},
  });
  assert.ok((historian.nominations??[]).length>=1);
  assert.match(JSON.stringify(historian.nominations),/ivory ledger/i);
});


test('Memory cognition: correcting supporting evidence revises the inferred reflection and rebuilds dependent summaries',async()=>{
  const memory=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(memory);
  const brain=new Area52NativeBrain({memoryInterface:surface});
  const reflection={
    reflectionKey:'vale:checks-beacon',
    statement:'Vale may habitually check the harbor beacon before departing.',
    subjectRefs:['Vale'],
    confidence:.72,
  };

  for(const [index,response] of [
    [1,'Vale checks the harbor beacon before leaving the north pier.'],
    [2,'Vale checks the harbor beacon again before leaving the south pier.'],
  ]){
    await brain.prepareTurn({
      chatId:'chat:reflection-correction',turnId:'reflection-correction:'+index,generationId:'gen:reflection-correction:'+index,
      query:'Continue.',intent:'CURRENT',
      scene:scene('pier-'+index,index,{location:'Harbor',activeCast:['Vale'],relationship:index===1?null:'PRECEDES'}),
      executionLabel:'DETERMINISTIC',
    });
    await brain.completeTurn({
      turnId:'reflection-correction:'+index,
      response,
      knownBy:['Vale'],
      reflections:[{...reflection,polarity:'SUPPORT'}],
    });
  }

  const before=memory.experienceStore.currentReflections()[0];
  assert.equal(before.truthStatus,'INFERRED');
  const beforeConfidence=before.confidence;
  const sessionRef='SESSION:brain:chat:reflection-correction';
  const summaryBefore=memory.summaryHierarchy.currentArtifact(sessionRef,{freshOnly:true});
  assert.ok(summaryBefore);

  const corrected=brain.correctTurn({
    turnId:'reflection-correction:2',
    response:'Correction: Vale leaves the south pier without checking the harbor beacon.',
    knownBy:['Vale'],
    reflections:[{...reflection,polarity:'CONTRADICT'}],
  });
  assert.equal(corrected.memoryPostTurn?.status,'COMPLETED');

  const after=memory.experienceStore.currentReflections()[0];
  assert.equal(after.authorityClass,'INFERRED');
  assert.ok(after.confidence<beforeConfidence);
  assert.ok(['CONTESTED','UNRESOLVED'].includes(after.resolutionStatus));
  assert.ok(after.contradictionEvidenceRefs.length>=1);
  assert.equal(memory.experienceStore.reflectionHistory('vale:checks-beacon').length,2);

  const summaryAfter=memory.summaryHierarchy.currentArtifact(sessionRef,{freshOnly:true});
  assert.ok(summaryAfter);
  assert.notEqual(summaryAfter.id,summaryBefore.id);
  assert.match(JSON.stringify(memory.experienceStore.exactDrillback(
    memory.experienceStore.currentEpisodes().find(row=>row.turnId==='reflection-correction:2').id
  )),/without checking the harbor beacon/i);
});


test('Memory cognition: validated Continuous Consolidation reflection evidence is owner-gated by repeated fresh episodes',async()=>{
  const memory=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(memory);
  const brain=new Area52NativeBrain({memoryInterface:surface});

  for(const [index,response] of [
    [1,'Rin checks the western gate latch before leaving the courtyard.'],
    [2,'Rin checks the western gate latch again before departing at dusk.'],
  ]){
    await brain.prepareTurn({
      chatId:'chat:consolidation-owner',turnId:'consolidation-owner:'+index,generationId:'gen:consolidation-owner:'+index,
      query:'Continue.',intent:'CURRENT',
      scene:scene('courtyard-'+index,index,{location:'Courtyard',activeCast:['Rin'],relationship:index===1?null:'PRECEDES'}),
      executionLabel:'DETERMINISTIC',
    });
    const learned=await brain.completeTurn({turnId:'consolidation-owner:'+index,response,knownBy:['Rin']});
    assert.equal(learned.memoryPostTurn?.status,'COMPLETED');
  }

  const episodes=memory.experienceStore.currentEpisodes({freshOnly:true}).filter(row=>row.chatId==='chat:consolidation-owner');
  assert.equal(episodes.length,2);
  const ref=(episode)=>({
    kind:'ArtifactReference',artifactId:episode.id,artifactType:'MemoryEpisode',owner:'MEMORY',
    revision:episode.revision,storageDomain:'episodes',provenanceRef:'memory:'+episode.id,
  });
  const sourceRevisionSet=[...new Set(episodes.flatMap(row=>row.sourceRevisionRefs))].sort();
  const proposal=(refs)=>({
    proposalKind:ConsolidationProposalKind.REFLECTION_EVIDENCE,
    semanticIdentity:'reflection:rin:checks-western-gate',
    sourceArtifactRefs:refs,
    confidence:.91,
    authority:'INFERRED',
    payload:{
      directObservations:refs.map(row=>row.artifactId),
      repeatedPatterns:['Rin repeatedly checks the western gate latch before departing.'],
      inferredInterpretations:['Rin may habitually verify the western gate latch before departure.'],
      contradictingEvidence:[],
      uncertainty:'MEDIUM',
    },
  });
  const makeBundle=(refs,id)=>createConsolidationProposalBundle({
    kind:'ConsolidationProposalBundle',unitId:id,sourceRevisionSet,
    proposals:[proposal(refs)],authority:'UNRESOLVED',
  },{
    unitId:id,sourceArtifactRefs:refs,sourceRevisionSet,worldRevision:2,sceneRevision:2,characterStateRevision:0,
  });

  const single=makeBundle([ref(episodes[0])],'unit:memory-owner-single');
  const singleReceipt=admitConsolidationBundleToMemoryOwner({
    bundle:single,handoff:createMemoryOwnerHandoff(single),memoryOwner:surface,
    selection:{chatId:'chat:consolidation-owner',turnId:'consolidation-owner:2',generationId:'gen:consolidation-owner:2',worldRevision:2,sceneRevision:2},
  });
  assert.equal(singleReceipt.ownerAccepted,false);
  assert.equal(singleReceipt.results[0].reasonCode,'MEMORY_REFLECTION_REPETITION_INSUFFICIENT');
  assert.equal(memory.experienceStore.currentReflections().length,0);

  const repeated=makeBundle(episodes.map(ref),'unit:memory-owner-repeated');
  const repeatedReceipt=admitConsolidationBundleToMemoryOwner({
    bundle:repeated,handoff:createMemoryOwnerHandoff(repeated),memoryOwner:surface,
    selection:{chatId:'chat:consolidation-owner',turnId:'consolidation-owner:2',generationId:'gen:consolidation-owner:2',worldRevision:2,sceneRevision:2},
  });
  assert.equal(repeatedReceipt.status,'COMPLETED');
  assert.equal(repeatedReceipt.ownerAccepted,true);
  const reflection=memory.experienceStore.currentReflections()[0];
  assert.equal(reflection.authorityClass,'INFERRED');
  assert.equal(reflection.worldTruthAuthority,false);
  assert.equal(reflection.settlementAuthority,false);
  assert.equal(reflection.reflectionKey,'reflection:rin:checks-western-gate');
  assert.equal(reflection.episodeRefs.length,2);
  assert.match(reflection.statement,/habitually verify the western gate latch/i);

  const restored=MemoryTemporalProducer.fromSnapshot(memory.snapshot());
  const restoredSurface=createMemoryIntegrationSurface(restored);
  const historyCount=restored.experienceStore.reflectionHistory('reflection:rin:checks-western-gate').length;
  const replay=admitConsolidationBundleToMemoryOwner({
    bundle:repeated,handoff:createMemoryOwnerHandoff(repeated),memoryOwner:restoredSurface,
    selection:{chatId:'chat:consolidation-owner',turnId:'consolidation-owner:2',generationId:'gen:consolidation-owner:2',worldRevision:2,sceneRevision:2},
  });
  assert.equal(replay.status,'REPLAYED');
  assert.equal(replay.ownerAccepted,true);
  assert.equal(replay.results[0].status,'REPLAYED');
  assert.equal(restored.experienceStore.reflectionHistory('reflection:rin:checks-western-gate').length,historyCount);
});


test('Memory cognition: consolidation owner review accepts exact current Scene episode refs and rejects stale Scene revisions',async()=>{
  const memory=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(memory);

  const evidence=[];
  for(const [i,text] of [
    [1,'Kara checks the eastern bell before dawn patrol.'],
    [2,'Kara checks the eastern bell before the next dawn patrol.'],
  ]){
    const ev=memory.appendEvidence({
      id:'scene-owner-consolidation:e'+i,
      sourceId:'scene-owner-consolidation:s'+i,
      sourceRevisionId:'scene-owner-consolidation:s'+i+'@r1',
      exactContent:text,kind:'EXPERIENCE',occurredAt:i,worldRevision:i,sceneRevision:i,
      participants:['Kara'],knownBy:['Kara'],
      metadata:{chatId:'chat:scene-owner-consolidation',turnId:'scene-owner:'+i,generationId:'gen:scene-owner:'+i},
      provenance:['scene-owner-test'],
    });
    evidence.push(ev);
    memory.publishEpisode({
      logicalId:'scene-owner-episode:'+i,
      chatId:'chat:scene-owner-consolidation',turnId:'scene-owner:'+i,generationId:'gen:scene-owner:'+i,
      sceneId:'scene-owner-'+i,sceneRevision:i,sourceRevisionRefs:[ev.sourceRevisionId],evidenceRefs:[ev.id],
      summary:text,
      sceneEpisodeRef:{
        kind:'ArtifactReference',artifactId:'scene-artifact:'+i,artifactType:'SceneEpisode',
        owner:'SCENE_INTELLIGENCE',revision:i,sourceRevisionSet:[ev.sourceRevisionId],sceneRevision:i,
      },
    });
  }

  const episodes=memory.experienceStore.currentEpisodes({freshOnly:true});
  const sceneRefs=episodes.map((episode)=>episode.sceneEpisodeRef);
  const sourceRevisionSet=[...new Set(episodes.flatMap(row=>row.sourceRevisionRefs))].sort();
  const makeBundle=(refs,id)=>createConsolidationProposalBundle({
    unitId:id,sourceRevisionSet,proposals:[{
      proposalKind:ConsolidationProposalKind.REFLECTION_EVIDENCE,
      semanticIdentity:'reflection:kara:eastern-bell',
      sourceArtifactRefs:refs,confidence:.8,authority:'INFERRED',
      payload:{
        directObservations:refs.map(row=>row.artifactId),
        repeatedPatterns:['Kara repeatedly checks the eastern bell before dawn patrol.'],
        inferredInterpretations:['Kara may habitually verify the eastern bell before dawn patrol.'],
        contradictingEvidence:[],
      },
    }],
  },{
    unitId:id,sourceArtifactRefs:refs,sourceRevisionSet,worldRevision:2,sceneRevision:2,characterStateRevision:0,
  });

  const good=makeBundle(sceneRefs,'unit:scene-owner-good');
  const goodReceipt=admitConsolidationBundleToMemoryOwner({
    bundle:good,handoff:createMemoryOwnerHandoff(good),memoryOwner:surface,
    selection:{chatId:'chat:scene-owner-consolidation',turnId:'scene-owner:2',generationId:'gen:scene-owner:2',worldRevision:2,sceneRevision:2},
  });
  assert.equal(goodReceipt.status,'COMPLETED');
  assert.equal(goodReceipt.ownerAccepted,true);

  const staleRefs=sceneRefs.map((row,index)=>index===1?{...row,revision:row.revision+1}:row);
  const stale=makeBundle(staleRefs,'unit:scene-owner-stale');
  const staleReceipt=admitConsolidationBundleToMemoryOwner({
    bundle:stale,handoff:createMemoryOwnerHandoff(stale),memoryOwner:surface,
    selection:{chatId:'chat:scene-owner-consolidation',turnId:'scene-owner:2',generationId:'gen:scene-owner:2',worldRevision:2,sceneRevision:2},
  });
  assert.equal(staleReceipt.ownerAccepted,false);
  assert.equal(staleReceipt.results[0].status,'STALE');
  assert.equal(staleReceipt.results[0].reasonCode,'MEMORY_CONSOLIDATION_SOURCE_EPISODE_REVISION_MISMATCH');
});


function deterministicReflectionProducer(memory){
  return Object.freeze({
    kind:'TestMemoryConsolidationProducer',contractVersion:'1.0.0',
    async propose(input={}){
      const selection=input.selection??{};
      const episodes=memory.experienceStore.currentEpisodes({freshOnly:true})
        .filter(row=>row.chatId===selection.chatId)
        .sort((a,b)=>a.createdSequence-b.createdSequence)
        .slice(-6);
      if(episodes.length<2)return{
        kind:'DeploymentMemoryConsolidationProposalReceipt',contractVersion:'1.0.0',
        status:'SKIPPED',reasonCode:'MEMORY_CONSOLIDATION_REPETITION_WINDOW_INSUFFICIENT',
        selection,episodeId:input.episodeId??null,providerAttempted:false,
      };
      const refs=episodes.map(episode=>({
        kind:'ArtifactReference',artifactId:episode.id,artifactType:'MemoryEpisode',owner:'MEMORY',
        revision:episode.revision,storageDomain:'episodes',provenanceRef:'memory:'+episode.id,
      }));
      const sourceRevisionSet=[...new Set(episodes.flatMap(row=>row.sourceRevisionRefs))].sort();
      const bundle=createConsolidationProposalBundle({
        unitId:'test-native-auto:'+selection.generationId,sourceRevisionSet,
        proposals:[{
          proposalKind:ConsolidationProposalKind.REFLECTION_EVIDENCE,
          semanticIdentity:'reflection:orin:lamp-check',
          sourceArtifactRefs:refs,confidence:.77,authority:'INFERRED',
          payload:{
            directObservations:refs.map(row=>row.artifactId),
            repeatedPatterns:['Orin repeatedly checks the signal lamp before departure.'],
            inferredInterpretations:['Orin may habitually verify the signal lamp before departure.'],
            contradictingEvidence:[],
          },
        }],
      },{
        unitId:'test-native-auto:'+selection.generationId,sourceArtifactRefs:refs,sourceRevisionSet,
        worldRevision:selection.worldRevision??0,sceneRevision:selection.sceneRevision??0,characterStateRevision:0,
      });
      return{
        kind:'DeploymentMemoryConsolidationProposalReceipt',contractVersion:'1.0.0',
        status:'PROPOSED',reasonCode:null,selection,episodeId:input.episodeId??null,
        episodeCount:episodes.length,bundle,memoryHandoff:createMemoryOwnerHandoff(bundle),
        providerAttempted:true,rawChatIncluded:false,canonicalMutation:false,settlementAuthority:false,
      };
    },
  });
}

test('Memory cognition: real Brain episodes trigger durable consolidation without hand-authored reflection inputs',async()=>{
  const memory=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(memory);
  const producer=deterministicReflectionProducer(memory);
  const brain=new Area52NativeBrain({memoryInterface:surface,memoryConsolidationInterface:producer});

  for(const [index,response] of [
    [1,'Orin checks the signal lamp before leaving the quay.'],
    [2,'Orin checks the signal lamp again before the evening departure.'],
  ]){
    await brain.prepareTurn({
      chatId:'chat:auto-consolidation',turnId:'auto-consolidation:'+index,generationId:'gen:auto-consolidation:'+index,
      query:'Continue.',intent:'CURRENT',
      scene:scene('quay-'+index,index,{location:'Quay',activeCast:['Orin'],relationship:index===1?null:'PRECEDES'}),
      executionLabel:'DETERMINISTIC',
    });
    const learned=await brain.completeTurn({
      turnId:'auto-consolidation:'+index,response,knownBy:['Orin'],
    });
    assert.equal(learned.memoryPostTurn?.status,'COMPLETED');
    if(index===1){
      assert.equal(learned.memoryConsolidation?.status,'SKIPPED');
      assert.equal(memory.experienceStore.currentReflections().length,0);
    }else{
      assert.equal(learned.memoryConsolidation?.status,'COMPLETED');
    }
  }

  const reflection=memory.experienceStore.currentReflections()[0];
  assert.ok(reflection);
  assert.equal(reflection.reflectionKey,'reflection:orin:lamp-check');
  assert.equal(reflection.authorityClass,'INFERRED');
  assert.equal(reflection.worldTruthAuthority,false);
  assert.equal(reflection.settlementAuthority,false);
  assert.equal(reflection.episodeRefs.length,2);
  assert.match(reflection.statement,/habitually verify the signal lamp/i);
});

test('Memory cognition: an admitted episode can checkpoint before L3 consolidation and resume that task after reload',async()=>{
  let memory=new MemoryTemporalProducer();
  let surface=createMemoryIntegrationSurface(memory);
  const deferredProducer=Object.freeze({
    kind:'TestDeferredMemoryConsolidationProducer',contractVersion:'1.0.0',
    propose:async(input)=>({
      kind:'DeploymentMemoryConsolidationProposalReceipt',contractVersion:'1.0.0',
      status:'DEFERRED',reasonCode:'TEST_PROVIDER_UNAVAILABLE',
      selection:input.selection,episodeId:input.episodeId,providerAttempted:false,
      rawChatIncluded:false,canonicalMutation:false,settlementAuthority:false,
    }),
  });
  let brain=new Area52NativeBrain({memoryInterface:surface,memoryConsolidationInterface:deferredProducer});

  await brain.prepareTurn({
    chatId:'chat:l3-resume',turnId:'l3-resume:1',generationId:'gen:l3-resume:1',
    query:'Continue.',intent:'CURRENT',
    scene:scene('l3-dock',1,{location:'Dock',activeCast:['Mara']}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'l3-resume:1',
    response:'Mara places the brass marker beside the dock clock.',
    knownBy:['Mara'],autoDrain:false,
  });
  for(let cycle=0;cycle<16&&!brain.readTurn('l3-resume:1')?.memoryPostTurn;cycle+=1){
    await brain.runtimeDirector.runCycle();
  }
  const afterEpisode=brain.readTurn('l3-resume:1');
  assert.equal(afterEpisode.memoryPostTurn?.status,'COMPLETED');
  assert.ok(afterEpisode.memoryConsolidationRuntimeTaskId);
  assert.equal(afterEpisode.memoryConsolidation??null,null);

  const brainSnapshot=brain.snapshot();
  const memorySnapshot=memory.snapshot();
  memory=MemoryTemporalProducer.fromSnapshot(memorySnapshot);
  surface=createMemoryIntegrationSurface(memory);
  brain=Area52NativeBrain.fromSnapshot(brainSnapshot,{
    memoryInterface:surface,memoryConsolidationInterface:deferredProducer,
  });
  await brain.runtimeDirector.drain({maxCycles:128});
  const resumed=brain.readTurn('l3-resume:1');
  assert.equal(resumed.memoryConsolidation?.status,'DEFERRED');
  assert.equal(resumed.memoryConsolidation?.reasonCode,'TEST_PROVIDER_UNAVAILABLE');
  const runtime=brain.runtimeDirector.ledger.list().find(row=>row.obligation?.taskType==='MEMORY_CONSOLIDATION_PROPOSAL');
  assert.ok(runtime);
  assert.equal(runtime.lifecycleStatus,'SATISFIED');
});


test('Memory cognition: deployment Continuous Consolidation producer closes real turn-to-reflection path',async()=>{
  const deployment=new DevelopmentDeploymentBrain();
  let consolidationProviderInput=null;
  deployment.resourceConnections.addResource({
    resourceId:'memory-consolidation-test-resource',
    providerProfileId:'memory-consolidation-test-profile',
    workerId:'memory-consolidation-test-worker',
    providerId:'memory-consolidation-test-provider',
    kind:ResourceKind.DETERMINISTIC_LOCAL,
    modelId:'memory-consolidation-test-model',
    capabilities:[Capability.CONSOLIDATION,Capability.COMPRESSION,Capability.REFLECTION,Capability.STRUCTURED_EXTRACTION],
    foregroundEligible:false,backgroundEligible:true,supportedLayers:['L3'],placements:['DEEP'],
    resourceClass:'DEEP_BACKGROUND',
    handler:async({input})=>{
        consolidationProviderInput=structuredClone(input);
        const refs=(input.data.sourceReferences??[]).map(ref=>({
          kind:'ArtifactReference',artifactId:ref.artifactId,artifactType:ref.artifactType,
          owner:ref.owner,revision:ref.revision,storageDomain:ref.storageDomain,provenanceRef:ref.provenanceRef,
        }));
        return{
          payload:{
            kind:'ConsolidationProposalBundle',
            unitId:input.data.taskSlice.unitId,
            sourceRevisionSet:[...input.data.taskSlice.sourceRevisionSet],
            proposals:[{
              proposalKind:ConsolidationProposalKind.REFLECTION_EVIDENCE,
              semanticIdentity:'reflection:sera:compass-check',
              sourceArtifactRefs:refs,confidence:.79,authority:'INFERRED',
              payload:{
                directObservations:refs.map(row=>row.artifactId),
                repeatedPatterns:['Sera repeatedly checks the brass compass before sailing.'],
                inferredInterpretations:['Sera may habitually verify the brass compass before sailing.'],
                contradictingEvidence:[],
              },
            }],
            authority:'UNRESOLVED',
          },
          metadata:{requestId:'sidecar:req:memory-consolidation-fixture'},
          latencyMs:3,
          usage:{prompt_tokens:37,completion_tokens:19},
        };
      },
  });
  const connected=await deployment.resourceConnections.connectResource('memory-consolidation-test-resource');
  assert.equal(connected.state,'READY');

  const bindings=deployment.hostBindings();
  const brain=new Area52NativeBrain({
    memoryInterface:deployment.memorySurface,
    memoryConsolidationInterface:bindings.memoryConsolidationProducer,
  });
  const longEvidence='Sera checks the brass compass again before the next departure. '+('Detailed observed compass evidence. '.repeat(120));
  for(const [index,response] of [
    [1,'Sera checks the brass compass before sailing from the inlet.'],
    [2,longEvidence],
  ]){
    await brain.prepareTurn({
      chatId:'chat:real-consolidation',turnId:'real-consolidation:'+index,generationId:'gen:real-consolidation:'+index,
      query:'Continue.',intent:'CURRENT',
      scene:scene('inlet-'+index,index,{location:'Inlet',activeCast:['Sera'],relationship:index===1?null:'PRECEDES'}),
      executionLabel:'DETERMINISTIC',
    });
    const learned=await brain.completeTurn({turnId:'real-consolidation:'+index,response,knownBy:['Sera']});
    assert.equal(learned.memoryPostTurn?.status,'COMPLETED');
    if(index===1){
      assert.equal(learned.memoryConsolidation?.status,'SKIPPED');
    }else{
      assert.equal(learned.memoryConsolidation?.producerStatus,'PROPOSED');
      assert.equal(learned.memoryConsolidation?.status,'COMPLETED');
      assert.equal(learned.memoryConsolidation?.providerAttempted,true);
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.requestPurpose,'COGNITIVE_EXECUTION');
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.dispatchStatus,'DISPATCHED');
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.returnStatus,'RETURNED');
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.providerRequestId,'sidecar:req:memory-consolidation-fixture');
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.providerLatencyMs,3);
      assert.ok(learned.memoryConsolidation?.sidecarExecution?.queueWaitMs>=0);
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.foregroundBlockedMs,0);
      assert.ok(['XS','S','M','L','XL'].includes(learned.memoryConsolidation?.sidecarExecution?.payloadSizeClass));
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.payloadBodyRetained,false);
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.ownerDestination,'MEMORY_OWNER_REVIEW');
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.ownerDecision,'COMPLETED');
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.ownerAccepted,true);
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.gatherDestination,'NOT_ELIGIBLE_POST_TURN');
      assert.equal(learned.memoryConsolidation?.sidecarExecution?.sealDestination,'NOT_ELIGIBLE_POST_TURN');
    }
  }

  assert.ok(consolidationProviderInput,'deployment consolidation consumer must dispatch a provider request');
  const transportedSlices=consolidationProviderInput.data.selectedContext??[];
  assert.ok(transportedSlices.length>=2);
  const partialSlice=transportedSlices.find(row=>row.excerpt?.length===2400);
  assert.ok(partialSlice,'long exact evidence must retain the existing 2400-character physical boundary');
  const coverageFact=(partialSlice.structuredFacts??[]).find(row=>row?.kind==='MemoryTransportCoverage');
  const drillbackFact=(partialSlice.structuredFacts??[]).find(row=>row?.kind==='MemoryTransportDrillback');
  assert.equal(coverageFact?.coverageComplete,false);
  assert.ok(coverageFact?.omittedCharacters>0);
  assert.equal(coverageFact?.canonicalKnowledgeDropped,false);
  assert.equal(drillbackFact?.exactSourceDrillback,true);
  assert.equal(drillbackFact?.artifactRevision,partialSlice.revision);
  assert.equal(drillbackFact?.provenanceRef,partialSlice.provenanceRef);
  assert.match(partialSlice.ref,/^memory-episode:.*@\d+$/);
  assert.ok((consolidationProviderInput.data.taskSlice?.sourceRevisionSet??[]).length>=1,'complete source revision fence must survive into the provider task slice');

  const trace=brain.uiBindings().readSelectedTurnReceipt({chatId:'chat:real-consolidation',turnId:'real-consolidation:2',generationId:'gen:real-consolidation:2'});
  assert.equal(trace.producers.memory.status,'ADMITTED');
  assert.equal(trace.producers.memory.stageSemantics,'EXACT_EVIDENCE_MAPPING_ONLY');
  assert.equal(trace.producers.memoryEpisode.status,'COMPLETED');
  assert.equal(trace.producers.memoryEpisode.ownerAccepted,true);
  assert.equal(trace.producers.memoryConsolidation.status,'COMPLETED');
  assert.equal(trace.producers.memoryConsolidation.ownerAccepted,true);
  assert.equal(trace.producers.memoryConsolidation.providerAttempted,true);
  const turn=brain.readTurn('real-consolidation:2');
  assert.equal(turn.memoryConsolidation.sidecarExecution.requestPurpose,'COGNITIVE_EXECUTION');
  assert.equal(turn.memoryConsolidation.sidecarExecution.ownerAccepted,true);

  const reflection=deployment.memory.experienceStore.currentReflections()[0];
  assert.ok(reflection);
  assert.equal(reflection.reflectionKey,'reflection:sera:compass-check');
  assert.equal(reflection.authorityClass,'INFERRED');
  assert.equal(reflection.worldTruthAuthority,false);
  assert.equal(reflection.settlementAuthority,false);
  assert.equal(reflection.episodeRefs.length,2);
  assert.match(reflection.statement,/habitually verify the brass compass/i);
});


test('Memory cognition: over-bound owner review resumes through the persisted Runtime batch after reload without re-invoking the provider', {timeout:300000}, async()=>{
  let memory=new MemoryTemporalProducer();
  let surface=createMemoryIntegrationSurface(memory);
  let proposeCalls=0;
  const pagedProducer=Object.freeze({
    kind:'TestPagedMemoryConsolidationProducer',contractVersion:'1.0.0',
    async propose(input={}){
      proposeCalls+=1;
      if(proposeCalls===1)return{
        kind:'DeploymentMemoryConsolidationProposalReceipt',contractVersion:'1.0.0',
        status:'SKIPPED',reasonCode:'TEST_FIRST_EPISODE_ONLY',
        selection:cloneForPagedTest(input.selection),episodeId:input.episodeId??null,providerAttempted:false,
        rawChatIncluded:false,canonicalMutation:false,settlementAuthority:false,
      };
      const proposals=Array.from({length:4097},(_,index)=>({
        proposalId:'runtime-page-proposal:'+String(index).padStart(5,'0'),
        proposalKind:'REFLECTION_EVIDENCE',
        semanticIdentity:'runtime-page-reflection:'+String(index).padStart(5,'0'),
        sourceArtifactRefs:[],
        confidence:0.5,
        authority:'INFERRED',
        payload:{},
      }));
      return{
        kind:'DeploymentMemoryConsolidationProposalReceipt',contractVersion:'1.0.0',
        status:'PROPOSED',reasonCode:null,
        selection:cloneForPagedTest(input.selection),episodeId:input.episodeId??null,providerAttempted:true,
        bundle:{
          kind:'ConsolidationProposalBundle',contractVersion:'1.1.0',
          bundleId:'bundle:runtime-page-resume',unitId:'unit:runtime-page-resume',
          sourceArtifactRefs:[],sourceRevisionSet:[],
          worldRevision:Number(input.selection?.worldRevision??2),sceneRevision:Number(input.selection?.sceneRevision??2),
          characterStateRevision:0,
          proposals,
          validationReceipt:{syntax:'PASS',schema:'PASS',semantic:'PASS'},
        },
        memoryHandoff:null,
        rawChatIncluded:false,canonicalMutation:false,settlementAuthority:false,
      };
    },
  });
  let brain=new Area52NativeBrain({memoryInterface:surface,memoryConsolidationInterface:pagedProducer});

  await brain.prepareTurn({
    chatId:'chat:runtime-page',turnId:'runtime-page:1',generationId:'gen:runtime-page:1',
    query:'Continue.',intent:'CURRENT',
    scene:scene('runtime-page-scene-1',1,{location:'Archive',activeCast:['Mira']}),
    executionLabel:'DETERMINISTIC',
  });
  const first=await brain.completeTurn({
    turnId:'runtime-page:1',response:'Mira records the first archive marker.',knownBy:['Mira'],
  });
  assert.equal(first.memoryPostTurn?.status,'COMPLETED');
  assert.equal(first.memoryConsolidation?.status,'SKIPPED');
  assert.equal(proposeCalls,1);

  await brain.prepareTurn({
    chatId:'chat:runtime-page',turnId:'runtime-page:2',generationId:'gen:runtime-page:2',
    query:'Continue.',intent:'CURRENT',
    scene:scene('runtime-page-scene-2',2,{location:'Archive',activeCast:['Mira'],relationship:'PRECEDES'}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'runtime-page:2',response:'Mira records the second archive marker.',knownBy:['Mira'],autoDrain:false,
  });

  let runtime=null;
  for(let cycle=0;cycle<64;cycle+=1){
    await brain.runtimeDirector.runCycle();
    const turn=brain.readTurn('runtime-page:2');
    runtime=turn?.memoryConsolidationRuntimeTaskId?brain.runtimeDirector.ledger.get(turn.memoryConsolidationRuntimeTaskId):null;
    if(runtime?.batch?.units?.length===2&&runtime.batch.completedUnitIds.length===1)break;
  }
  const afterPageOne=brain.readTurn('runtime-page:2');
  runtime=brain.runtimeDirector.ledger.get(afterPageOne.memoryConsolidationRuntimeTaskId);
  assert.ok(runtime);
  assert.equal(runtime.batch.units.length,2,'page 2 is persisted in the existing Runtime batch');
  assert.equal(runtime.batch.completedUnitIds.length,1);
  assert.equal(afterPageOne.memoryConsolidation?.status,'DEFERRED');
  assert.equal(afterPageOne.memoryConsolidation?.reasonCode,'MEMORY_CONSOLIDATION_REVIEW_PAGE_BOUND');
  assert.equal(afterPageOne.memoryConsolidation?.reviewProgress?.processed,4096);
  assert.equal(afterPageOne.memoryConsolidation?.reviewProgress?.remaining,1);
  assert.equal(afterPageOne.memoryConsolidation?.reviewProgress?.coverageComplete,false);
  assert.equal(afterPageOne.memoryConsolidation?.reviewProgress?.runtimeOwnedContinuation,true);
  assert.equal(proposeCalls,2);
  const pagedDiagnostic=memory.status().diagnostics.filter((row)=>row.kind==='MemoryConsolidationBundleReviewReceipt').at(-1);
  assert.equal(pagedDiagnostic?.resultsSampled,true);
  assert.equal(pagedDiagnostic?.resultCount,4096);
  assert.equal(pagedDiagnostic?.results?.length,16);
  assert.equal(pagedDiagnostic?.resultStatusCounts?.SKIPPED,4096);

  const brainSnapshot=brain.snapshot();
  const memorySnapshot=memory.snapshot();
  memory=MemoryTemporalProducer.fromSnapshot(memorySnapshot);
  surface=createMemoryIntegrationSurface(memory);
  brain=Area52NativeBrain.fromSnapshot(brainSnapshot,{
    memoryInterface:surface,memoryConsolidationInterface:pagedProducer,
  });
  await brain.runtimeDirector.drain({maxCycles:128});

  const resumed=brain.readTurn('runtime-page:2');
  runtime=brain.runtimeDirector.ledger.get(resumed.memoryConsolidationRuntimeTaskId);
  assert.equal(runtime.lifecycleStatus,'SATISFIED');
  assert.equal(runtime.batch.units.length,2);
  assert.equal(runtime.batch.completedUnitIds.length,2);
  assert.equal(proposeCalls,2,'the continuation reviews persisted proposals without a second provider call');
  assert.equal(resumed.memoryConsolidation?.status,'SKIPPED');
  assert.equal(resumed.memoryConsolidation?.producerStatus,'REVIEW_CONTINUATION');
  assert.equal(resumed.memoryConsolidation?.reviewProgress?.processed,4097);
  assert.equal(resumed.memoryConsolidation?.reviewProgress?.remaining,0);
  assert.equal(resumed.memoryConsolidation?.reviewProgress?.coverageComplete,true);
  assert.equal(resumed.memoryConsolidation?.reviewProgress?.runtimeOwnedContinuation,false);
  assert.equal(resumed.memoryConsolidation?.reviewProgress?.providerReinvokedForContinuation,false);
});

function cloneForPagedTest(value){
  return value==null?value:structuredClone(value);
}
