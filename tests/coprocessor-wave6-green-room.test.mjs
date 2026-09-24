import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  Capability, CapabilityProfileRegistry, CharacterCognitionWorker, DeterministicProviderAdapter,
  FailureCode, GreenRoomStore, Placement, ProviderAdapterRegistry, ResultClass, ResultDestination,
  SpecialistExecutionLayer, buildGreenRoomInput, createGreenRoomBatch, createGreenRoomInference,
  createGreenRoomProviderInput, createGreenRoomTask, createRevisionSet, projectGreenRoomForGeneration,
  selectActiveGreenRoomBatch, validateGreenRoomProviderOutput,
} from '../src/coprocessor/index.js';

function profileLayer(handler,{available=true}={}){
  const profiles=new CapabilityProfileRegistry();
  profiles.register({
    profileId:'green-profile',workerId:'green-slot',providerId:'green-provider',
    capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.CHARACTER_INFERENCE,Capability.FAST_CLASSIFICATION],
    foregroundEligible:true,backgroundEligible:false,placements:[Placement.HOT],supportedLayers:['L1'],
    available,
  });
  const adapters=new ProviderAdapterRegistry();
  adapters.register(new DeterministicProviderAdapter({
    providerId:'green-provider',
    capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.CHARACTER_INFERENCE,Capability.FAST_CLASSIFICATION],
    handlers:{GREEN_ROOM:handler},
  }));
  return new SpecialistExecutionLayer({profiles,adapters});
}

function turn(overrides={}){
  return {
    turnId:'turn:wave6:green',correlationId:'corr:wave6:green',causationId:'send:wave6:green',
    sceneRevision:7,worldRevision:11,characterStateRevision:5,sourceRevisionSet:['scene:7','dialogue:20'],
    intentFingerprint:'intent:green',...overrides,
  };
}
function characters(){
  return [
    {characterRef:'Mara',presence:'PRESENT',evidenceRefs:['e:mara:1'],relationshipEvidenceRefs:['rel:mara:eris']},
    {characterRef:'Eris',presence:'UNCERTAIN',evidenceRefs:['e:eris:1']},
    {characterRef:'Tomas',presence:'MENTIONED_ONLY',evidenceRefs:['e:tomas:mention']},
  ];
}
function providerRows(input){
  return input.data.characters.map((c)=>({
    characterId:c.characterId,
    guardedness:c.characterId==='Mara'?.8:.2,
    warmth:c.characterId==='Mara'?.3:.7,
    anger:c.characterId==='Mara'?.4:.1,
    trustTrend:'STABLE',
    anxiety:c.characterId==='Mara'?.6:.2,
    latentIntent:c.characterId==='Mara'?'hold position':'observe',
    attentionTarget:c.characterId==='Mara'?'Eris':'Mara',
    socialPressure:.4,
    uncertainty:.2,
    confidence:.76,
    evidenceRefs:c.evidenceRefs,
    sceneRevision:7,
    expiry:{ttlTurns:2,onSceneRevisionChange:true,onCharacterExit:true},
  }));
}

test('Wave 6 Green Room task is HOT, normally OPPORTUNISTIC, revision-fenced and capability-defined',()=>{
  const t=createGreenRoomTask({
    ...turn(),activeCast:characters(),evidenceRefs:['e:mara:1','e:eris:1'],
    relationshipEvidenceRefs:['rel:mara:eris'],unresolvedEvidenceRefs:['u:1'],
  });
  assert.equal(t.taskType,'GREEN_ROOM');assert.equal(t.placement,Placement.HOT);assert.equal(t.resultClass,ResultClass.OPPORTUNISTIC);
  assert.equal(t.cognitiveLayer,'L1');assert.deepEqual(t.requiredCapabilities,[Capability.SEMANTIC_JUDGMENT,Capability.CHARACTER_INFERENCE]);
  assert.ok(t.optionalCapabilities.includes(Capability.FAST_CLASSIFICATION));
  assert.deepEqual(t.metadata.activeCharacterRefs,['Mara','Eris']);
  assert.equal(t.sceneRevision,7);assert.equal(t.worldRevision,11);assert.equal(t.characterStateRevision,5);
  assert.equal(t.causationId,'send:wave6:green');assert.equal(t.metadata.durableMutationAllowed,false);
});

test('active-cast batching includes PRESENT/UNCERTAIN, excludes mentioned-only and rejects duplicates/unbounded casts',()=>{
  assert.deepEqual(selectActiveGreenRoomBatch(characters()),['Mara','Eris']);
  assert.throws(()=>selectActiveGreenRoomBatch([
    {characterRef:'Mara',presence:'PRESENT'},{characterRef:'Mara',presence:'UNCERTAIN'},
  ]),(error)=>error.code===FailureCode.SCHEMA_INVALID);
  assert.throws(()=>selectActiveGreenRoomBatch(Array.from({length:17},(_,i)=>({characterRef:'C'+i,presence:'PRESENT'})),{maxCharacters:16}),/exceeds 16/);
});

test('Green Room provider input is bounded/reference-first and strips whole-brain fields',()=>{
  const t=createGreenRoomTask({...turn(),activeCast:characters(),evidenceRefs:['e:mara:1','e:eris:1','rel:mara:eris']});
  const payload=createGreenRoomProviderInput(t,{
    characters:characters(),
    evidenceSlices:[
      {ref:'e:mara:1',excerpt:'Mara folds her arms and watches Eris.'},
      {ref:'e:eris:1',excerpt:'Eris answers softly.'},
    ],
    conversation:'DO_NOT_SEND',memory:'DO_NOT_SEND',lorebook:'DO_NOT_SEND',
  });
  const text=JSON.stringify(payload);
  assert.equal(payload.minimumNecessary,true);assert.equal(payload.referenceFirst,true);
  assert.deepEqual(payload.taskSlice.characters.map((c)=>c.characterRef),['Mara','Eris']);
  assert.match(text,/e:mara:1/);assert.doesNotMatch(text,/DO_NOT_SEND/);
  assert.ok(text.length<12000);
});

test('legacy foreground provider envelope now delegates through canonical bounded Green Room contract',()=>{
  const t=createGreenRoomTask({...turn(),activeCast:characters(),evidenceRefs:['e:mara:1','e:eris:1','rel:mara:eris']});
  const envelope=buildGreenRoomInput(t,{characters:characters(),conversation:'DO_NOT_SEND'});
  assert.deepEqual(envelope.data.characters.map((c)=>c.characterId),['Mara','Eris']);
  assert.ok(envelope.data.taskSlice);assert.doesNotMatch(JSON.stringify(envelope),/DO_NOT_SEND/);
});

test('Green Room micro-state supports canonical dimensions while remaining INFERRED and non-durable',()=>{
  const row=createGreenRoomInference({
    characterRef:'Mara',sceneRevision:7,evidenceRefs:['e1'],sourceRevisionSet:['s1'],confidence:.8,
    dimensions:{guardedness:.9,warmth:.2,anger:.4,anxiety:.6,trustTrend:'DOWN',attentionTarget:'Eris',socialPressure:.7,latentIntent:'leave',uncertainty:.3},
  });
  assert.equal(row.authority,'INFERRED');assert.equal(row.canonical,false);assert.equal(row.memoryMutation,false);assert.equal(row.characterStateMutation,false);
  assert.equal(row.dimensions.attentionTarget,'Eris');assert.equal(row.dimensions.uncertainty,.3);
});

test('Green Room strict validation rejects unknown evidence/character, stale scene and authority escalation',()=>{
  const base={sceneRevision:7,characters:[{characterRef:'Mara',evidenceRefs:['e1'],confidence:.7,dimensions:{anger:.5},expiryCondition:{ttlTurns:1}}]};
  assert.throws(()=>validateGreenRoomProviderOutput(base,{sceneRevision:7,knownCharacterRefs:['Eris'],knownEvidenceRefs:['e1']}),(e)=>e.code===FailureCode.UNKNOWN_REFERENCE);
  assert.throws(()=>validateGreenRoomProviderOutput(base,{sceneRevision:7,knownCharacterRefs:['Mara'],knownEvidenceRefs:['other']}),(e)=>e.code===FailureCode.UNKNOWN_REFERENCE);
  assert.throws(()=>validateGreenRoomProviderOutput({...base,sceneRevision:6,characters:[{...base.characters[0],sceneRevision:6}]},{sceneRevision:7,knownCharacterRefs:['Mara'],knownEvidenceRefs:['e1']}),(e)=>e.code===FailureCode.STALE_RESULT);
  assert.throws(()=>validateGreenRoomProviderOutput({...base,authority:'SETTLED'},{sceneRevision:7}),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
  assert.throws(()=>validateGreenRoomProviderOutput({...base,characterStateMutation:true},{sceneRevision:7}),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
});

test('Green Room lifecycle deterministically expires scene, time, departure, contradiction, revision, chat and correction state',()=>{
  const cases=[
    {sceneClosed:true},{sceneReplaced:true},{majorTimeShift:true},{departedCharacterRefs:['Mara']},
    {contradictoryCharacterRefs:['Mara']},{invalidatedSourceRevisionIds:['src:old']},{chatSwitch:true},{sceneCorrection:true},
  ];
  for(const reason of cases){
    const store=new GreenRoomStore({defaultTtlTurns:10});
    store.putBatch({sceneRevision:7,characters:[{characterRef:'Mara',evidenceRefs:['e1'],sourceRevisionSet:['src:old'],confidence:.7,dimensions:{guardedness:.6}}]},{turnSequence:1,activeCharacterRefs:['Mara']});
    assert.equal(store.invalidate(reason),1);assert.equal(store.size(),0);
  }
  const ttl=new GreenRoomStore({defaultTtlTurns:1});
  ttl.putBatch({sceneRevision:7,characters:[{characterRef:'Mara',evidenceRefs:['e1'],confidence:.7,dimensions:{}}]},{turnSequence:1});
  assert.equal(ttl.get('Mara',{sceneRevision:7,turnSequence:3}),null);
});

test('prior Green Room inference cannot self-reinforce without new direct evidence',()=>{
  const store=new GreenRoomStore({maxHistory:16});
  for(let i=0;i<3;i++){
    store.putBatch({sceneRevision:7,characters:[{
      characterRef:'Mara',evidenceRefs:['e1'],priorInferenceRefs:i?['green-room:prior']:[],sourceRevisionSet:['src:1'],
      confidence:.7+i*.05,dimensions:{anger:.6},
    }]},{turnSequence:i});
  }
  assert.equal(store.createReflectionCandidate('Mara',{minCompatibleObservations:3}),null);
  store.putBatch({sceneRevision:7,characters:[{characterRef:'Mara',evidenceRefs:['e2'],sourceRevisionSet:['src:2'],confidence:.7,dimensions:{anger:.6}}]},{turnSequence:4});
  store.putBatch({sceneRevision:7,characters:[{characterRef:'Mara',evidenceRefs:['e3'],sourceRevisionSet:['src:3'],confidence:.7,dimensions:{anger:.5}}]},{turnSequence:5});
  const candidate=store.createReflectionCandidate('Mara',{minCompatibleObservations:3,contradictingEvidenceRefs:['e:contra']});
  assert.equal(candidate.observationCount,3);assert.deepEqual(candidate.evidenceRefs.sort(),['e1','e2','e3']);assert.equal(candidate.durableMutation,false);
  assert.deepEqual(candidate.contradictingEvidence,['e:contra']);
});

test('generation projection is compact, evidence-backed and explicitly INFERRED',()=>{
  const batch=createGreenRoomBatch({sceneRevision:7,characters:[
    {characterRef:'Mara',evidenceRefs:['e1'],sourceRevisionSet:['s1'],confidence:.8,dimensions:{guardedness:.9,uncertainty:.2}},
  ]});
  const out=projectGreenRoomForGeneration(batch,{sceneRevision:7});
  assert.equal(out.lane,'greenRoom');assert.equal(out.authority,'INFERRED');assert.equal(out.durableMutation,false);
  assert.equal(out.characters[0].characterRef,'Mara');assert.deepEqual(out.characters[0].evidenceRefs,['e1']);
  assert.equal(out.characters[0].guardedness,.9);assert.equal(out.characters[0].uncertainty,.2);
});

test('real CharacterCognitionWorker batches active cast into one provider call and stores only fresh inferred state',async()=>{
  let calls=0;
  const worker=new CharacterCognitionWorker({
    executionLayer:profileLayer(({input})=>{calls+=1;return{payload:{characters:providerRows(input)}};}),
    store:new GreenRoomStore({maxHistory:16}),
  });
  const out=await worker.run({turn:turn(),input:{characters:characters()},turnSequence:10});
  assert.equal(calls,1);assert.equal(out.status,'SUCCESS');assert.equal(out.destination,ResultDestination.FOREGROUND);
  assert.deepEqual(out.batch.characters.map((c)=>c.characterRef),['Mara','Eris']);assert.equal(out.projection.characters.length,2);
  assert.equal(out.projection.characters.every((c)=>c.authority==='INFERRED'),true);assert.equal(out.canonicalMutation,false);
});

test('Green Room provider failure degrades OPPORTUNISTIC cognition instead of stopping generation',async()=>{
  const profiles=new CapabilityProfileRegistry();
  profiles.register({profileId:'none',providerId:'missing',capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.CHARACTER_INFERENCE]});
  const worker=new CharacterCognitionWorker({executionLayer:new SpecialistExecutionLayer({profiles,adapters:new ProviderAdapterRegistry()})});
  const out=await worker.run({turn:turn(),input:{characters:characters()}});
  assert.equal(out.status,'DEGRADED');assert.equal(out.projection,null);assert.equal(out.canonicalMutation,false);
});

test('post-Seal Green Room result routes to NEXT_TURN and cannot mutate ephemeral foreground state',async()=>{
  const store=new GreenRoomStore();
  const worker=new CharacterCognitionWorker({
    executionLayer:profileLayer(({input})=>({payload:{characters:providerRows(input)}})),
    store,
  });
  const out=await worker.run({turn:turn(),input:{characters:characters()},turnSequence:10,sealed:true});
  assert.equal(out.destination,ResultDestination.NEXT_TURN);assert.equal(store.size(),0);assert.equal(out.canonicalMutation,false);
});

test('Wave 6 Green Room production path remains browser-safe',async()=>{
  for(const rel of ['../src/coprocessor/green-room.js','../src/coprocessor/cognitive-worker-pipelines.js','../src/coprocessor/provider-payload-boundary.js']){
    const source=await readFile(new URL(rel,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\bBuffer\b/);assert.doesNotMatch(source,/from\s+['"]node:/);assert.doesNotMatch(source,/\brequire\s*\(/);
    assert.doesNotMatch(source,/\bprocess\./);assert.doesNotMatch(source,/from\s+['"](?:fs|path|worker_threads)['"]/);
  }
});
