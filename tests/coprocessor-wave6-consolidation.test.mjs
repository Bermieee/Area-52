import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  Capability, CapabilityProfileRegistry, ConsolidationBacklog, ConsolidationProposalDeduper,
  ConsolidationProposalKind, ContinuousConsolidationWorker, DeterministicProviderAdapter,
  FailureCode, Placement, ProviderAdapterRegistry, ResultClass, SpecialistExecutionLayer,
  createConsolidationCheckpoint, createConsolidationProposal, createConsolidationProposalBundle,
  createConsolidationProviderInput, createConsolidationTask, createConsolidationUnit,
  createMemoryOwnerHandoff, createRevisionSet, deriveConsolidationProposalIdentity,
  evaluateConsolidationResume, validateConsolidationProviderOutput,
} from '../src/coprocessor/index.js';

function artifact(id='episode:1',revision=1){
  return {kind:'ArtifactReference',artifactId:id,artifactType:'SceneEpisode',owner:'SCENE_INTELLIGENCE',revision,storageDomain:'episodes',provenanceRef:'prov:'+id};
}
function unit(overrides={}){
  return createConsolidationUnit({
    unitId:'unit:wave6',artifactRefs:[artifact()],sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,
    characterStateRevision:3,priority:2,createdAt:10,resumeIdentity:'resume:wave6',provenance:{eventRef:'event:1'},...overrides,
  });
}
function revision(overrides={}){
  return createRevisionSet({sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3,...overrides});
}
function layer(handler){
  const profiles=new CapabilityProfileRegistry();
  profiles.register({
    profileId:'deep-profile',workerId:'deep-slot',providerId:'deep-provider',
    capabilities:[Capability.CONSOLIDATION,Capability.COMPRESSION,Capability.REFLECTION,Capability.STRUCTURED_EXTRACTION],
    foregroundEligible:false,backgroundEligible:true,placements:[Placement.DEEP],supportedLayers:['L3'],
  });
  const adapters=new ProviderAdapterRegistry();
  adapters.register(new DeterministicProviderAdapter({
    providerId:'deep-provider',
    capabilities:[Capability.CONSOLIDATION,Capability.COMPRESSION,Capability.REFLECTION,Capability.STRUCTURED_EXTRACTION],
    handlers:{CONSOLIDATION:handler},
  }));
  return new SpecialistExecutionLayer({profiles,adapters});
}
function bundlePayload(){
  return {
    kind:'ConsolidationProposalBundle',unitId:'unit:wave6',sourceRevisionSet:['src:1'],
    proposals:[
      {proposalKind:ConsolidationProposalKind.EPISODE_SUMMARY,semanticIdentity:'episode:summary:1',sourceArtifactRefs:[artifact()],confidence:.9,authority:'UNRESOLVED',
        payload:{participants:['Mara','Eris'],location:'Ember Tavern',time:'night',salientEvents:['Mara confronted Eris'],unresolvedOutcomes:['blade fate'],sourceRanges:['turn:10-14'],chronology:['arrival','argument'],authorityClass:'OBSERVED'}},
      {proposalKind:ConsolidationProposalKind.CLAIM_CANDIDATE,semanticIdentity:'claim:mara:possesses:key',sourceArtifactRefs:[artifact()],confidence:.82,authority:'UNRESOLVED',
        payload:{subjectRef:'Mara',predicate:'possesses',object:'brass-key',temporal:{status:'CURRENT'},supportingRefs:['turn:12']}},
      {proposalKind:ConsolidationProposalKind.RELATIONSHIP_UPDATE,semanticIdentity:'relationship:mara:eris:tension',sourceArtifactRefs:[artifact()],confidence:.7,authority:'INFERRED',
        payload:{fromRef:'Mara',toRef:'Eris',relation:'tension-increased',supportingRefs:['turn:13']}},
      {proposalKind:ConsolidationProposalKind.STATE_CHANGE_PROPOSAL,semanticIdentity:'state:key:location',sourceArtifactRefs:[artifact()],confidence:.72,authority:'UNRESOLVED',
        payload:{entityRef:'brass-key',changeType:'LOCATION',from:'table',to:'Mara'}},
      {proposalKind:ConsolidationProposalKind.REFLECTION_EVIDENCE,semanticIdentity:'reflection:mara:avoidance',sourceArtifactRefs:[artifact()],confidence:.65,authority:'INFERRED',
        payload:{directObservations:['turn:10','turn:13'],repeatedPatterns:['avoids direct answer'],inferredInterpretations:['possible distrust'],contradictingEvidence:['turn:11'],uncertainty:'MEDIUM'}},
      {proposalKind:ConsolidationProposalKind.CROSS_EPISODE_LINK,semanticIdentity:'hypothesis:key:motive',sourceArtifactRefs:[artifact()],confidence:.45,authority:'UNRESOLVED',
        payload:{hypotheses:['Mara hid the key to protect Eris','Mara hid the key for leverage'],causalCertainty:'UNRESOLVED'}},
    ],
    authority:'UNRESOLVED',
  };
}

test('Consolidation unit is revisioned ArtifactReference-first with provenance and deterministic lineage',()=>{
  const u=unit();
  assert.equal(u.artifactRefs[0].artifactId,'episode:1');assert.equal(u.artifactRefs[0].revision,1);
  assert.equal(u.artifactRefs[0].owner,'SCENE_INTELLIGENCE');assert.equal(u.resumeIdentity,'resume:wave6');
  assert.match(u.lineageId,/lineage:/);assert.match(u.dedupeKey,/consolidation-unit/);assert.equal(u.durableMutation,false);
});

test('Consolidation task is DEEP/L3/DEFERRED, checkpointable and capability-defined',()=>{
  const t=createConsolidationTask(unit(),{turnId:'background:1',correlationId:'corr:deep'});
  assert.equal(t.placement,Placement.DEEP);assert.equal(t.cognitiveLayer,'L3');assert.equal(t.resultClass,ResultClass.DEFERRED);
  assert.deepEqual(t.requiredCapabilities,[Capability.CONSOLIDATION,Capability.COMPRESSION]);
  assert.ok(t.optionalCapabilities.includes(Capability.REFLECTION));assert.equal(t.metadata.durableMutationAllowed,false);
  assert.equal(t.batchMetadata.yieldSafety,'CHECKPOINT_ONLY');
});

test('Consolidation provider payload is bounded, reference-first and preserves structured evidence slices',()=>{
  const t=createConsolidationTask(unit());
  const payload=createConsolidationProviderInput(t,{
    unit:unit(),
    evidenceSlices:[{artifactRef:artifact(),excerpt:'Mara pockets the brass key.',structuredFacts:[{subjectRef:'Mara',predicate:'possesses',object:'brass-key'}],provenanceRef:'turn:12'}],
    conversation:'DO_NOT_SEND',memory:'DO_NOT_SEND',
  });
  const text=JSON.stringify(payload);
  assert.equal(payload.referenceFirst,true);assert.match(text,/episode:1/);assert.match(text,/possesses/);
  assert.doesNotMatch(text,/DO_NOT_SEND/);assert.ok(text.length<16000);
});

test('proposal bundle supports multiple semantic families with per-proposal confidence and provenance',()=>{
  const out=validateConsolidationProviderOutput(bundlePayload(),{
    unitId:'unit:wave6',sourceArtifactRefs:[artifact()],knownArtifactRefs:[artifact()],
    sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3,currentRevisionSet:revision(),
  });
  assert.equal(out.kind,'ConsolidationProposalBundle');assert.equal(out.proposals.length,6);
  assert.deepEqual([...new Set(out.proposals.map((p)=>p.proposalKind))].sort(),[
    'CLAIM_CANDIDATE','CROSS_EPISODE_LINK','EPISODE_SUMMARY','REFLECTION_EVIDENCE','RELATIONSHIP_UPDATE','STATE_CHANGE_PROPOSAL',
  ]);
  assert.notEqual(out.proposals[0].confidence,out.proposals[5].confidence);
  assert.equal(out.proposals.every((p)=>p.memoryMutation===false&&p.deleteSourceTurns===false),true);
});

test('episode summary preserves unresolved outcomes and raw-source lineage without inventing settlement',()=>{
  const p=createConsolidationProposal(bundlePayload().proposals[0],{
    sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3,
  });
  assert.deepEqual(p.payload.unresolvedOutcomes,['blade fate']);assert.deepEqual(p.payload.sourceRanges,['turn:10-14']);
  assert.equal(p.authority,'UNRESOLVED');assert.equal(p.settlementAuthority,false);assert.equal(p.deleteSourceTurns,false);
});

test('atomic claim supports subject/predicate/object and historical-to-current promotion is rejected',()=>{
  const good=createConsolidationProposal(bundlePayload().proposals[1],{sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3});
  assert.equal(good.payload.subjectRef,'Mara');assert.equal(good.payload.predicate,'possesses');
  assert.throws(()=>createConsolidationProposal({
    ...bundlePayload().proposals[1],semanticIdentity:'bad-history',
    payload:{subjectRef:'Mara',predicate:'location',object:'tavern',sourceTemporalStatus:'HISTORICAL',temporalStatus:'CURRENT'},
  },{sourceRevisionSet:['src:1']}),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
});

test('relationship/state-change/reflection proposals remain proposal-only and Memory-owned',()=>{
  for(const i of [2,3,4]){
    const p=createConsolidationProposal(bundlePayload().proposals[i],{sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3});
    assert.equal(p.destination,'MEMORY_SETTLEMENT_REVIEW');assert.equal(p.memoryMutation,false);assert.equal(p.settlementAuthority,false);
  }
  const reflection=createConsolidationProposal(bundlePayload().proposals[4],{sourceRevisionSet:['src:1']});
  assert.equal(reflection.payload.directObservations.length,2);assert.equal(reflection.payload.contradictingEvidence.length,1);
});

test('unsupported causal certainty is rejected while unresolved competing hypotheses survive',()=>{
  const unresolved=createConsolidationProposal(bundlePayload().proposals[5],{sourceRevisionSet:['src:1']});
  assert.equal(unresolved.payload.hypotheses.length,2);assert.equal(unresolved.payload.causalCertainty,'UNRESOLVED');
  assert.throws(()=>createConsolidationProposal({
    ...bundlePayload().proposals[5],semanticIdentity:'bad-cause',
    payload:{hypotheses:['A caused B'],causalCertainty:'CERTAIN'},
  },{sourceRevisionSet:['src:1']}),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
});

test('authority-negative consolidation rejects SETTLED/SOURCE_CANON, direct Memory mutation and source deletion',()=>{
  const base=bundlePayload().proposals[1];
  for(const patch of [{authority:'SETTLED'},{authority:'SOURCE_CANON'},{memoryMutation:true},{deleteSourceTurns:true},{durableMutation:true}]){
    assert.throws(()=>createConsolidationProposal({...base,...patch},{sourceRevisionSet:['src:1']}),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
  }
});

test('unknown source artifacts and stale revisions are rejected before owner handoff',()=>{
  const payload=bundlePayload();
  assert.throws(()=>validateConsolidationProviderOutput(payload,{
    unitId:'unit:wave6',sourceArtifactRefs:[artifact()],knownArtifactRefs:[artifact('other')],
    sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3,currentRevisionSet:revision(),
  }),(e)=>e.code===FailureCode.UNKNOWN_REFERENCE);
  assert.throws(()=>validateConsolidationProviderOutput(payload,{
    unitId:'unit:wave6',sourceArtifactRefs:[artifact()],knownArtifactRefs:[artifact()],
    sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3,
    currentRevisionSet:revision({sourceRevisionSet:['src:new']}),
  }),(e)=>e.code===FailureCode.STALE_RESULT);
});

test('proposal identity/dedupe is deterministic and changed source revision creates a new lineage',()=>{
  const p=bundlePayload().proposals[1];
  const id1=deriveConsolidationProposalIdentity({sourceArtifactRefs:[artifact('episode:1',1)],proposalKind:p.proposalKind,semanticIdentity:p.semanticIdentity});
  const id2=deriveConsolidationProposalIdentity({sourceArtifactRefs:[artifact('episode:1',1)],proposalKind:p.proposalKind,semanticIdentity:p.semanticIdentity});
  const id3=deriveConsolidationProposalIdentity({sourceArtifactRefs:[artifact('episode:1',2)],proposalKind:p.proposalKind,semanticIdentity:p.semanticIdentity});
  assert.equal(id1,id2);assert.notEqual(id1,id3);
  const bundle=createConsolidationProposalBundle(bundlePayload(),{
    unitId:'unit:wave6',sourceArtifactRefs:[artifact()],sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3,
  });
  const deduper=new ConsolidationProposalDeduper();
  assert.equal(deduper.accept(bundle).acceptedCount,6);assert.equal(deduper.accept(bundle).duplicateCount,6);
  const restored=new ConsolidationProposalDeduper().importState(deduper.exportState());
  assert.equal(restored.accept(bundle).duplicateCount,6);
});

test('checkpoint/yield/resume continues only against the same revision fence',()=>{
  const u=unit();
  const cp=createConsolidationCheckpoint(u,{completedArtifactRefs:[artifact()],completedProposalIds:['p1'],nextOffset:1,createdAt:20});
  assert.equal(evaluateConsolidationResume(cp,revision()).action,'RESUME_FROM_CHECKPOINT');
  assert.equal(evaluateConsolidationResume(cp,revision({sceneRevision:8})).action,'INVALIDATE_AND_REPLAN');
});

test('ConsolidationBacklog is bounded, deterministic, idempotent and restart-safe',()=>{
  const backlog=new ConsolidationBacklog({capacity:3});
  const first=backlog.enqueue(unit({unitId:'u1',priority:1}));
  const duplicate=backlog.enqueue(unit({unitId:'u1',priority:1}));
  assert.equal(first.unitId,duplicate.unitId);assert.equal(backlog.metrics().duplicateEnqueue,1);
  backlog.enqueue(unit({unitId:'u2',artifactRefs:[artifact('e2')],priority:3}));
  backlog.enqueue(unit({unitId:'u3',artifactRefs:[artifact('e3')],priority:2}));
  assert.deepEqual(backlog.pending().map((u)=>u.originalUnitId),['u2','u3','u1']);
  backlog.checkpoint('u2',{completedArtifactRefs:[],nextOffset:0});assert.equal(backlog.resume('u2',revision()).action,'RESUME_FROM_CHECKPOINT');
  const restored=new ConsolidationBacklog({capacity:3}).importState(backlog.exportState());
  assert.equal(restored.metrics().pendingUnits,3);assert.equal(restored.enqueue(unit({unitId:'u1',priority:1})).originalUnitId,'u1');
});

test('changed source revision supersedes old lineage without overwriting historical work',()=>{
  const backlog=new ConsolidationBacklog({capacity:4});
  const old=backlog.enqueue(unit({unitId:'same',artifactRefs:[artifact('ep',1)],sourceRevisionSet:['src:1']}));
  const newer=backlog.enqueue(unit({unitId:'same',artifactRefs:[artifact('ep',2)],sourceRevisionSet:['src:2']}));
  const rows=backlog.list();
  assert.equal(rows.find((r)=>r.unitId===old.unitId).status,'SUPERSEDED');
  assert.notEqual(newer.unitId,old.unitId);assert.notEqual(newer.lineageId,old.lineageId);
});

test('Memory owner handoff exposes validated proposals but no persistence/settlement authority',()=>{
  const bundle=createConsolidationProposalBundle(bundlePayload(),{
    unitId:'unit:wave6',sourceArtifactRefs:[artifact()],sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3,
  });
  const handoff=createMemoryOwnerHandoff(bundle,{currentRevisionSet:revision()});
  assert.equal(handoff.destination,'MEMORY_SETTLEMENT_REVIEW');assert.equal(handoff.memoryPersistence,false);
  assert.equal(handoff.temporalSettlement,false);assert.equal(handoff.reflectionAdmission,false);assert.equal(handoff.sourceDeletion,false);
  assert.equal(handoff.proposalRefs.length,6);
});

test('real ContinuousConsolidationWorker executes provider-neutral cognition and returns proposal-only Memory handoff',async()=>{
  const worker=new ContinuousConsolidationWorker({
    executionLayer:layer(()=>({payload:bundlePayload()})),
    backlog:new ConsolidationBacklog({capacity:8}),
  });
  const stored=worker.enqueue(unit());
  const out=await worker.processUnit(stored.unitId,{
    currentRevisionSet:revision(),
    inputResolver:async(u)=>({unit:u,evidenceSlices:[{artifactRef:artifact(),excerpt:'bounded episode',structuredFacts:[{subjectRef:'Mara',predicate:'possesses',object:'key'}]}]}),
  });
  assert.equal(out.status,'SUCCESS');assert.equal(out.bundle.proposals.length,6);assert.equal(out.memoryHandoff.memoryPersistence,false);
  assert.equal(out.canonicalMutation,false);assert.equal(worker.backlog.metrics().completed,1);
});

test('completed valid consolidation slice survives sibling provider failure',async()=>{
  let calls=0;
  const worker=new ContinuousConsolidationWorker({
    executionLayer:layer(()=>{calls+=1;if(calls===2)throw new Error('slice failed');return{payload:bundlePayload()};}),
    backlog:new ConsolidationBacklog({capacity:8}),
  });
  const a=worker.enqueue(unit({unitId:'a'}));const b=worker.enqueue(unit({unitId:'b',artifactRefs:[artifact('episode:2')]}));
  const resolver=async(u)=>({unit:u,evidenceSlices:[{artifactRef:u.artifactRefs[0],excerpt:'bounded'}]});
  const first=await worker.processUnit(a.unitId,{currentRevisionSet:revision(),inputResolver:resolver});
  const second=await worker.processUnit(b.unitId,{currentRevisionSet:revision(),inputResolver:resolver});
  assert.equal(first.status,'SUCCESS');assert.equal(second.status,'DEGRADED');
  assert.equal(worker.backlog.list().find((u)=>u.unitId===a.unitId).status,'COMPLETE');
});

test('Wave 6 consolidation production path remains browser-safe',async()=>{
  for(const rel of ['../src/coprocessor/continuous-consolidation.js','../src/coprocessor/cognitive-worker-pipelines.js','../src/coprocessor/wave3-specialists.js']){
    const source=await readFile(new URL(rel,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\bBuffer\b/);assert.doesNotMatch(source,/from\s+['"]node:/);assert.doesNotMatch(source,/\brequire\s*\(/);
    assert.doesNotMatch(source,/\bprocess\./);assert.doesNotMatch(source,/from\s+['"](?:fs|path|worker_threads)['"]/);
  }
});
