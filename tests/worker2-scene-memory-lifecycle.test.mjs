import test from 'node:test';
import assert from 'node:assert/strict';

import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {extractDevelopmentDeploymentScene} from '../src/deployment/sillytavern-live.js';
import {Area52NativeBrain} from '../src/native-brain.js';
import {HostActivity,SceneEventType} from '../src/scene/lifecycle-contracts.js';

function hostEvent({
  chatId='worker2-scene-memory',id='m1',revision=1,activity=HostActivity.USER_SEND,content='',
  turnId='turn:worker2',generationId='gen:worker2',role='user',
}={}){
  return{
    activity,chatId,hostEventId:`host:${chatId}:${id}:r${revision}:${activity}`,
    messageId:id,messageRevision:revision,turnId,generationId,correlationId:'corr:'+turnId,
    causationId:'host-cause:'+turnId,content,role,
  };
}

function ingestDeterministic(brain,input){
  return brain.ingestSceneHostEvent(input,{
    extract:(e,scene)=>extractDevelopmentDeploymentScene(e.content,{
      revision:scene.revision+1,evidenceRef:e.sourceRevisionId,currentScene:scene,sceneRuntime:brain.scene,
    }),
  });
}

function finalizedEpisode(brain,{chatId='worker2-scene-memory',suffix='a'}={}){
  const start=ingestDeterministic(brain,hostEvent({
    chatId,id:'start-'+suffix,content:'At North Gallery, Mara enters beside the brass astrolabe.',
    turnId:'turn:'+suffix+':start',generationId:'gen:'+suffix+':start',
  }));
  const closed=ingestDeterministic(brain,hostEvent({
    chatId,id:'move-'+suffix,content:'We arrive at South Courtyard.',
    turnId:'turn:'+suffix+':close',generationId:'gen:'+suffix+':close',
  }));
  const ready=closed.dispatchTimeline.find(row=>row.type==='EVENT'&&row.value?.eventType===SceneEventType.SCENE_EPISODE_READY)?.value??null;
  assert.ok(ready,'deterministic Scene transition must publish SCENE_EPISODE_READY');
  return{start,closed,ready};
}

function sealHistoricalTurn(brain,event){
  return brain.core.publication.seal.seal({
    turnId:event.turnId,correlationId:event.correlationId,
    packet:{id:'packet:'+event.turnId,dependencies:[]},
    sourceRevisionIds:[...(event.sourceRevisionSet??[])],
    worldRevision:brain.core.graph.revision,sceneRevision:event.sceneRevision,
  });
}

function nativeScene(id='return-scene',revision=1){
  return{
    sceneId:id,sceneRevision:revision,location:'North Gallery',narrativeTime:'later',
    activeCast:['Mara'],activeThreads:[],objects:[],sourceRevisionRefs:[],provenance:['worker2-scene-memory'],
  };
}

test('Worker 2: installed finalized Scene/Episode mapping survives Seal, dedupes replay, shares exact Memory evidence, reloads, and is retrieved through the existing Native Brain path',async()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const {ready}=finalizedEpisode(brain,{suffix:'installed'});
  const scheduled=brain.readSceneEventObligationReceipts({limit:256}).filter(row=>
    row.producerId==='MEMORY_SCENE_LIFECYCLE_OWNER'&&row.eventId===ready.eventId&&row.status==='ADMITTED'
  );
  assert.equal(scheduled.length,1,'one finalized Episode must schedule one installed Memory owner obligation');
  assert.ok(scheduled[0].taskId);

  const seal=sealHistoricalTurn(brain,ready);
  assert.ok(seal);
  assert.equal(brain.core.publication.seal.isTurnSealed(ready.turnId),true);
  await brain.runtimeDirector.drain({maxCycles:128});
  assert.equal(brain.core.publication.seal.isTurnSealed(ready.turnId),true,'historical Memory work cannot unseal or rewrite the generation');

  const lifecycle=brain.readSceneMemoryLifecycleReceipts({limit:256});
  assert.ok(lifecycle.some(row=>row.eventId===ready.eventId&&row.stage==='WORK_SCHEDULED'&&row.status==='SCHEDULED'));
  assert.ok(lifecycle.some(row=>row.eventId===ready.eventId&&row.stage==='EXECUTION_ATTEMPTED'&&row.status==='ATTEMPTED'));
  const accepted=lifecycle.find(row=>row.eventId===ready.eventId&&row.stage==='MEMORY_OWNER_DECISION'&&row.status==='ACCEPTED');
  const persisted=lifecycle.find(row=>row.eventId===ready.eventId&&row.stage==='EXPERIENCE_PERSISTED'&&row.status==='PERSISTED');
  assert.ok(accepted);
  assert.ok(persisted);
  assert.equal(persisted.sealedGeneration,true);
  assert.equal(persisted.destination,'BACKGROUND');

  const episode=brain.memory.experienceStore.artifact(persisted.memoryEpisodeId);
  assert.ok(episode);
  assert.equal(episode.chatId,ready.chatId);
  assert.equal(episode.sceneId,ready.sceneId);
  assert.equal(episode.sceneRevision,ready.sceneRevision);
  assert.equal(episode.freshness,'FRESH');
  assert.equal(episode.bridgeResolutionStatus,'RESOLVED');
  assert.deepEqual([...episode.sceneEpisodeRef.sourceRevisionSet].sort(),[...ready.payload.episodeRef.sourceRevisionSet].sort());

  const episodeCount=brain.memory.experienceStore.episodes.size;
  brain.scene.publisher.publish({
    eventType:ready.eventType,sceneId:ready.sceneId,sceneRevision:ready.sceneRevision,
    sourceRevisionRefs:ready.sourceRevisionSet,payload:ready.payload,chatId:ready.chatId,turnId:ready.turnId,
    generationId:ready.generationId,correlationId:ready.correlationId,causationId:ready.causationId,
    dedupeKey:'worker2-replay:'+ready.eventId,eventId:'worker2-replay:'+ready.eventId,
  });
  const replayDisposition=brain.readSceneEventObligationReceipts({limit:256}).find(row=>
    row.producerId==='MEMORY_SCENE_LIFECYCLE_OWNER'&&row.eventId==='worker2-replay:'+ready.eventId
  );
  assert.equal(replayDisposition?.status,'DEDUPED');
  await brain.runtimeDirector.drain({maxCycles:128});
  assert.equal(brain.memory.experienceStore.episodes.size,episodeCount,'replayed lifecycle evidence must not duplicate the durable episode');

  const exactSourceRef=episode.sourceRevisionRefs[0];
  const exactSource=brain.scene.narrativeFeed.findSourceRevision(ready.chatId,exactSourceRef);
  assert.ok(exactSource?.content);
  const evidenceCountBefore=brain.memory.graph.evidence.size;
  const narrativeMapping=brain.admitMemoryEvidenceMapping({
    kind:'MemoryExternalEvidenceMappingRequest',contractVersion:'1.0.0',
    ownerArtifactRef:{
      kind:'ArtifactReference',artifactId:'core-narrative:'+ready.chatId+':shared',artifactType:'NarrativeExperience',
      owner:'COGNITIVE_CORE',revision:1,sourceRevisionSet:[exactSourceRef],sceneRevision:ready.sceneRevision,
    },
    externalEvidenceRef:'core-narrative:'+ready.chatId+':shared',
    source:{
      sourceId:'narrative:'+ready.chatId+':shared',sourceRevisionId:exactSourceRef,exactContent:exactSource.content,
      evidenceKind:'NARRATIVE_EXPERIENCE',occurredAt:exactSource.sequence??1,sceneRevision:ready.sceneRevision,
      participants:[],knownBy:[],perspective:'WORLD',
      metadata:{chatId:ready.chatId,turnId:exactSource.turnId??ready.turnId,generationId:exactSource.generationId??ready.generationId},
      provenance:['native-narrative:'+exactSourceRef],
    },
    revisionProof:{sourceRevisionId:exactSourceRef,ownerArtifactRevision:1,sceneRevision:ready.sceneRevision},
    provenanceRefs:['worker2-coherent-lineage'],
  });
  assert.ok(['ADMITTED','REPLAYED'].includes(narrativeMapping.receipt.status));
  assert.equal(brain.memory.graph.evidence.size,evidenceCountBefore,'ordinary narrative and Scene mappings of one exact source revision must share durable Memory evidence');

  const memorySnapshot=brain.snapshotMemoryOwner();
  const reloaded=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false,memoryOwnerSnapshot:memorySnapshot});
  const native=new Area52NativeBrain({memoryInterface:reloaded.hostBindings().memoryIntegrationSurface});
  const prepared=await native.prepareTurn({
    chatId:ready.chatId,turnId:'turn:retrieval',generationId:'gen:retrieval',
    query:'What happened at North Gallery with Mara?',intent:'HISTORICAL',
    scene:nativeScene(),executionLabel:'DETERMINISTIC',
  });
  const memoryCandidates=(prepared.candidateEnvelope?.candidates??[]).filter(candidate=>
    (candidate.channelNominations??[]).some(row=>row.channelId==='OWNER_MEMORY')
  );
  assert.ok(memoryCandidates.length>=1,'reloaded Scene-derived Memory must enter the existing Memory owner Candidate Bus');
  assert.ok(prepared.truthAssessment);
  assert.ok(prepared.gatherReceipt);
  assert.ok(prepared.contextSealReceipt?.sealedState);
  const retrieved=reloaded.readSceneMemoryLifecycleReceipts({limit:128}).filter(row=>row.stage==='EXPERIENCE_RETRIEVED');
  assert.ok(retrieved.some(row=>row.memoryEpisodeId===episode.id&&row.chatId===ready.chatId));
  assert.equal(reloaded.memory.readMemoryUi({chatId:'foreign-story'}).episodes.length,0,'Scene Memory identity must not bleed into another story');

  const diagnostics=reloaded.diagnostics().sceneMemory;
  assert.ok(diagnostics.experienceRetrieved>=1);
  assert.equal(diagnostics.rawStoryTextIncluded,false);
});

test('Worker 2: edited Scene source invalidates dependent durable Memory while preserving historical evidence and exact prior revisions',async()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const {start,ready}=finalizedEpisode(brain,{suffix:'edit'});
  await brain.runtimeDirector.drain({maxCycles:128});
  const persisted=brain.readSceneMemoryLifecycleReceipts({limit:256}).find(row=>
    row.eventId===ready.eventId&&row.stage==='EXPERIENCE_PERSISTED'&&row.status==='PERSISTED'
  );
  assert.ok(persisted);
  const oldEpisode=brain.memory.experienceStore.artifact(persisted.memoryEpisodeId);
  assert.equal(oldEpisode.freshness,'FRESH');

  const edited=brain.ingestSceneHostEvent(hostEvent({
    chatId:ready.chatId,id:'start-edit',revision:2,activity:HostActivity.EDIT,
    content:'At North Gallery, Mara enters after the brass astrolabe has already been removed.',
    turnId:'turn:edit:source',generationId:'gen:edit:source',
  }),{extract:()=>({fields:{}})});
  assert.ok(edited.invalidatedSourceRevisionRefs.includes(start.evidence.sourceRevisionId));
  assert.ok(edited.memoryInvalidations.some(row=>row.sourceRevisionId===start.evidence.sourceRevisionId));

  const stale=brain.memory.experienceStore.artifact(oldEpisode.id);
  assert.equal(stale.freshness,'STALE');
  assert.ok(brain.memory.graph.evidenceRecord(oldEpisode.evidenceRefs.find(id=>brain.memory.graph.evidenceRecord(id)?.sourceRevisionId===start.evidence.sourceRevisionId)));
  const historical=brain.scene.narrativeFeed.findSourceRevision(ready.chatId,start.evidence.sourceRevisionId);
  assert.ok(historical);
  assert.equal(historical.current,false);
  assert.ok(brain.readSceneMemoryLifecycleReceipts({limit:256}).some(row=>
    row.stage==='SOURCE_INVALIDATED'&&row.sourceRevisionRefs.includes(start.evidence.sourceRevisionId)
  ));
});

test('Worker 2: installed Scene Memory owner returns an honest deferred outcome when Memory admission becomes unavailable',async()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const {ready}=finalizedEpisode(brain,{suffix:'unavailable'});
  brain.memorySurface.adapters.acceptSceneExperience=null;
  await brain.runtimeDirector.drain({maxCycles:128});

  const decision=brain.readSceneMemoryLifecycleReceipts({limit:256}).find(row=>
    row.eventId===ready.eventId&&row.stage==='MEMORY_OWNER_DECISION'
  );
  assert.equal(decision?.status,'DEFERRED');
  assert.equal(decision?.reasonCode,'SCENE_MEMORY_OWNER_UNAVAILABLE');
  assert.equal(brain.memory.experienceStore.currentEpisodes({freshOnly:false}).length,0);
});

test('Worker 2: no eligible Scene lifecycle event produces no installed Memory owner work',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  ingestDeterministic(brain,hostEvent({
    id:'non-final',content:'At North Gallery, Mara waits.',
    turnId:'turn:non-final',generationId:'gen:non-final',
  }));
  const tasks=brain.runtimeDirector.ledger.list().filter(row=>row.obligation?.producerId==='MEMORY_SCENE_LIFECYCLE_OWNER');
  assert.equal(tasks.length,0);
  assert.equal(brain.diagnostics().sceneMemory.experiencePersisted,0);
});
