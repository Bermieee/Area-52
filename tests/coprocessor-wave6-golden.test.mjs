import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Capability, CapabilityProfileRegistry, CharacterCognitionWorker, ConsolidationBacklog,
  ConsolidationProposalKind, ContinuousConsolidationWorker, DeterministicProviderAdapter,
  FailureCode, GreenRoomStore, Placement, ProviderAdapterRegistry, ResultDestination,
  SpecialistExecutionLayer, createConsolidationCheckpoint, createConsolidationUnit,
  createRevisionSet, validateGreenRoomProviderOutput,
} from '../src/coprocessor/index.js';

const artifact=(id='episode:gold',revision=1)=>({kind:'ArtifactReference',artifactId:id,artifactType:'SceneEpisode',owner:'SCENE_INTELLIGENCE',revision,storageDomain:'episodes'});
const revision=(sourceRevisionSet=['src:gold'])=>createRevisionSet({sourceRevisionSet,worldRevision:10,sceneRevision:4,characterStateRevision:3});

function combinedLayer({slowDeep=false}={}){
  const profiles=new CapabilityProfileRegistry();
  profiles.register({
    profileId:'cognition',workerId:'slot:cognition',providerId:'cognition-provider',
    capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.CHARACTER_INFERENCE,Capability.FAST_CLASSIFICATION,Capability.CONSOLIDATION,Capability.COMPRESSION,Capability.REFLECTION,Capability.STRUCTURED_EXTRACTION],
    resourceClass:'DEEP_BACKGROUND',foregroundEligible:true,backgroundEligible:true,placements:[Placement.HOT,Placement.DEEP],supportedLayers:['L1','L3'],
  });
  const adapters=new ProviderAdapterRegistry();
  adapters.register(new DeterministicProviderAdapter({
    providerId:'cognition-provider',
    capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.CHARACTER_INFERENCE,Capability.FAST_CLASSIFICATION,Capability.CONSOLIDATION,Capability.COMPRESSION,Capability.REFLECTION,Capability.STRUCTURED_EXTRACTION],
    handlers:{
      GREEN_ROOM:async({input})=>({payload:{characters:input.data.characters.map((c)=>({
        characterId:c.characterId,guardedness:c.characterId==='Mara'?.8:.3,warmth:c.characterId==='Mara'?.3:.7,
        anger:.2,trustTrend:'STABLE',anxiety:.4,latentIntent:c.characterId==='Mara'?'watch Eris':'listen',
        attentionTarget:c.characterId==='Mara'?'Eris':'Mara',socialPressure:.3,uncertainty:.2,confidence:.75,
        evidenceRefs:c.evidenceRefs,sceneRevision:input.data.sceneRevision,expiry:{ttlTurns:2,onSceneRevisionChange:true,onCharacterExit:true},
      }))}}),
      CONSOLIDATION:async({input})=>{
        if(slowDeep)await new Promise((resolve)=>setTimeout(resolve,120));
        const source=input.data.sourceReferences[0];
        return{payload:{kind:'ConsolidationProposalBundle',unitId:input.data.taskSlice.unitId,sourceRevisionSet:['src:gold'],proposals:[
          {proposalKind:ConsolidationProposalKind.EPISODE_SUMMARY,semanticIdentity:'gold:episode',sourceArtifactRefs:[{kind:'ArtifactReference',artifactId:source.artifactId,artifactType:source.artifactType,revision:source.revision,storageDomain:source.storageDomain}],confidence:.9,authority:'UNRESOLVED',
            payload:{participants:['Mara','Eris'],location:'Ember Tavern',salientEvents:['Mara hid the key'],unresolvedOutcomes:['why the key matters'],sourceRanges:['turn:1-5'],chronology:['arrival','key hidden']}},
          {proposalKind:ConsolidationProposalKind.CLAIM_CANDIDATE,semanticIdentity:'gold:key',sourceArtifactRefs:[{kind:'ArtifactReference',artifactId:source.artifactId,artifactType:source.artifactType,revision:source.revision,storageDomain:source.storageDomain}],confidence:.8,authority:'UNRESOLVED',
            payload:{subjectRef:'Mara',predicate:'possesses',object:'brass-key',supportingRefs:['turn:4']}},
          {proposalKind:ConsolidationProposalKind.RELATIONSHIP_UPDATE,semanticIdentity:'gold:relationship',sourceArtifactRefs:[{kind:'ArtifactReference',artifactId:source.artifactId,artifactType:source.artifactType,revision:source.revision,storageDomain:source.storageDomain}],confidence:.65,authority:'INFERRED',
            payload:{fromRef:'Mara',toRef:'Eris',relation:'protective-tension',supportingRefs:['turn:2','turn:5']}},
          {proposalKind:ConsolidationProposalKind.REFLECTION_EVIDENCE,semanticIdentity:'gold:reflection',sourceArtifactRefs:[{kind:'ArtifactReference',artifactId:source.artifactId,artifactType:source.artifactType,revision:source.revision,storageDomain:source.storageDomain}],confidence:.6,authority:'INFERRED',
            payload:{directObservations:['turn:2','turn:5'],repeatedPatterns:['Mara deflects direct questions'],inferredInterpretations:['possible protective motive'],contradictingEvidence:['turn:3'],uncertainty:'MEDIUM'}},
        ],authority:'UNRESOLVED'}};
      },
    },
  }));
  return new SpecialistExecutionLayer({profiles,adapters});
}

function sceneTurn(n,sceneRevision=7){
  return {turnId:'turn:char:'+n,correlationId:'corr:char:'+n,causationId:'send:'+n,sceneRevision,worldRevision:12,characterStateRevision:4,sourceRevisionSet:['scene:'+sceneRevision,'turn:'+n],intentFingerprint:'intent:'+n};
}

test('Character golden: multi-turn active cast stays evidence-backed, expiring and INFERRED',async()=>{
  const store=new GreenRoomStore({maxCharacters:8,maxHistory:32,defaultTtlTurns:3});
  const worker=new CharacterCognitionWorker({executionLayer:combinedLayer(),store});

  const t1=await worker.run({turn:sceneTurn(1),turnSequence:1,input:{characters:[
    {characterRef:'Mara',presence:'PRESENT',evidenceRefs:['m1']},
    {characterRef:'Eris',presence:'PRESENT',evidenceRefs:['e1']},
    {characterRef:'Tomas',presence:'MENTIONED_ONLY',evidenceRefs:['mention:t']},
  ]}});
  assert.deepEqual(t1.batch.characters.map((c)=>c.characterRef),['Mara','Eris']);
  assert.equal(t1.projection.characters.every((c)=>c.authority==='INFERRED'),true);

  await worker.run({turn:sceneTurn(2),turnSequence:2,input:{characters:[
    {characterRef:'Mara',presence:'PRESENT',evidenceRefs:['m2']},{characterRef:'Eris',presence:'PRESENT',evidenceRefs:['e2']},
  ]}});
  const t3=await worker.run({turn:sceneTurn(3),turnSequence:3,input:{characters:[
    {characterRef:'Mara',presence:'PRESENT',evidenceRefs:['m3']},{characterRef:'Eris',presence:'PRESENT',evidenceRefs:['e3']},
    {characterRef:'Tomas',presence:'PRESENT',evidenceRefs:['t3']},
  ]}});
  assert.ok(t3.projection.characters.some((c)=>c.characterRef==='Tomas'));

  const t4=await worker.run({turn:sceneTurn(4),turnSequence:4,input:{characters:[
    {characterRef:'Mara',presence:'PRESENT',evidenceRefs:['m4']},{characterRef:'Tomas',presence:'PRESENT',evidenceRefs:['t4']},
  ]}});
  assert.equal(t4.projection.characters.some((c)=>c.characterRef==='Eris'),false);

  assert.equal(worker.invalidate({contradictoryCharacterRefs:['Mara']}),1);
  assert.equal(store.get('Mara',{sceneRevision:7,turnSequence:4,activeCharacterRefs:['Mara','Tomas']}),null);

  const t5=await worker.run({turn:sceneTurn(5,8),turnSequence:5,input:{characters:[
    {characterRef:'Tomas',presence:'PRESENT',evidenceRefs:['t5']},
  ]}});
  assert.equal(t5.projection.characters.every((c)=>c.sceneRevision===8),true);

  assert.throws(()=>validateGreenRoomProviderOutput({
    sceneRevision:7,characters:[{characterRef:'Tomas',sceneRevision:7,evidenceRefs:['t5'],confidence:.7,dimensions:{guardedness:.5}}],
  },{sceneRevision:8,knownCharacterRefs:['Tomas'],knownEvidenceRefs:['t5']}),(e)=>e.code===FailureCode.STALE_RESULT);

  const before=store.size();
  const late=await worker.run({turn:sceneTurn(6,8),turnSequence:6,sealed:true,input:{characters:[
    {characterRef:'Tomas',presence:'PRESENT',evidenceRefs:['late:t6']},
  ]}});
  assert.equal(late.destination,ResultDestination.NEXT_TURN);assert.equal(store.size(),before);
});

test('Consolidation golden: checkpoint, yield/resume, revision invalidation and duplicate replay preserve lineage',async()=>{
  const backlog=new ConsolidationBacklog({capacity:8});
  const worker=new ContinuousConsolidationWorker({executionLayer:combinedLayer(),backlog});
  const u=worker.enqueue(createConsolidationUnit({
    unitId:'gold-unit',artifactRefs:[artifact()],sourceRevisionSet:['src:gold'],worldRevision:10,sceneRevision:4,characterStateRevision:3,resumeIdentity:'resume:gold',
  }));
  const cp=createConsolidationCheckpoint(u,{completedArtifactRefs:[],completedProposalIds:[],nextOffset:0});
  worker.yield(u.unitId,cp);
  assert.equal(worker.resume(u.unitId,revision()).action,'RESUME_FROM_CHECKPOINT');

  const result=await worker.processUnit(u.unitId,{
    currentRevisionSet:revision(),
    inputResolver:async(unit)=>({unit,evidenceSlices:[{artifactRef:artifact(),excerpt:'Mara hid the brass key after the argument.',structuredFacts:[
      {subjectRef:'Mara',predicate:'possesses',object:'brass-key'},{subjectRef:'Mara',predicate:'relationship',object:'protective-tension:Eris'},
    ]}]}),
  });
  assert.equal(result.status,'SUCCESS');assert.equal(result.bundle.proposals.length,4);
  assert.equal(result.memoryHandoff.memoryPersistence,false);assert.equal(result.memoryHandoff.sourceDeletion,false);
  const replay=result.dedupe;assert.equal(replay.duplicateCount,0);

  const affected=backlog.enqueue(createConsolidationUnit({
    unitId:'revision-test',artifactRefs:[artifact('episode:affected',1)],sourceRevisionSet:['src:old'],worldRevision:10,sceneRevision:4,characterStateRevision:3,
  }));
  const unrelated=backlog.enqueue(createConsolidationUnit({
    unitId:'unrelated',artifactRefs:[artifact('episode:unrelated',1)],sourceRevisionSet:['src:other'],worldRevision:10,sceneRevision:4,characterStateRevision:3,
  }));
  assert.equal(backlog.discardStale(createRevisionSet({sourceRevisionSet:['src:new','src:other'],worldRevision:10,sceneRevision:4,characterStateRevision:3})),1);
  assert.equal(backlog.list().find((x)=>x.unitId===affected.unitId).status,'STALE');
  assert.equal(backlog.list().find((x)=>x.unitId===unrelated.unitId).status,'PENDING');

  const revised=backlog.enqueue(createConsolidationUnit({
    unitId:'revision-test',artifactRefs:[artifact('episode:affected',2)],sourceRevisionSet:['src:new'],worldRevision:10,sceneRevision:4,characterStateRevision:3,
  }));
  assert.notEqual(revised.lineageId,affected.lineageId);

  const duplicate=backlog.enqueue(createConsolidationUnit({
    unitId:'revision-test',artifactRefs:[artifact('episode:affected',2)],sourceRevisionSet:['src:new'],worldRevision:10,sceneRevision:4,characterStateRevision:3,
  }));
  assert.equal(duplicate.unitId,revised.unitId);assert.ok(backlog.metrics().duplicateEnqueue>=1);
});

test('Combined cognition golden: HOT Green Room assists current generation while DEEP consolidation remains background',async()=>{
  const executionLayer=combinedLayer({slowDeep:true});
  const green=new CharacterCognitionWorker({executionLayer,store:new GreenRoomStore()});
  const deep=new ContinuousConsolidationWorker({executionLayer,backlog:new ConsolidationBacklog({capacity:4})});
  const u=deep.enqueue(createConsolidationUnit({
    unitId:'combined-deep',artifactRefs:[artifact()],sourceRevisionSet:['src:gold'],worldRevision:10,sceneRevision:4,characterStateRevision:3,
  }));
  let deepDone=false;
  const deepPromise=deep.processUnit(u.unitId,{
    currentRevisionSet:revision(),
    inputResolver:async(unit)=>({unit,evidenceSlices:[{artifactRef:artifact(),excerpt:'prior experience'}]}),
  }).then((value)=>{deepDone=true;return value;});

  const hot=await green.run({
    turn:{turnId:'combined-hot',correlationId:'combined-hot:c',sceneRevision:7,worldRevision:12,characterStateRevision:4,sourceRevisionSet:['scene:7']},
    turnSequence:1,
    input:{characters:[{characterRef:'Mara',presence:'PRESENT',evidenceRefs:['hot:e1']}]},
  });
  assert.equal(hot.status,'SUCCESS');assert.equal(hot.destination,ResultDestination.FOREGROUND);
  assert.equal(deepDone,false,'foreground Green Room must not wait for DEEP consolidation');
  const background=await deepPromise;
  assert.equal(background.status,'SUCCESS');assert.equal(background.destination,ResultDestination.BACKGROUND);
  assert.equal(hot.canonicalMutation,false);assert.equal(background.canonicalMutation,false);
});
