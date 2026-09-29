import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryExperienceStore,memoryReferenceValues} from '../src/memory-experience-store.js';

function fakeGraph(){
  const evidence=new Map();
  return {
    sourceRevisionState:new Map(),
    addEvidence(id,sourceRevisionId='source@1'){
      evidence.set(id,{id,sourceRevisionId,exactContent:'exact '+id});
      this.sourceRevisionState.set(sourceRevisionId,{state:'ACTIVE'});
    },
    evidenceRecord(id){return evidence.get(id)??null;},
    hasEvidence(id){return evidence.has(id);},
    evidenceFresh(id){return evidence.has(id);},
    exactEvidence(id){return evidence.get(id)??null;},
    isSourceRevisionActive(id){return this.sourceRevisionState.get(id)?.state==='ACTIVE';},
  };
}

test('row 45: episode refs segment at 128/64 while exact drillback keeps every reference',()=>{
  const graph=fakeGraph();
  const evidenceRefs=Array.from({length:129},(_,i)=>'evidence:'+i);
  const sourceRevisionRefs=Array.from({length:65},(_,i)=>'source:'+i+'@1');
  evidenceRefs.forEach((id,i)=>graph.addEvidence(id,sourceRevisionRefs[i%sourceRevisionRefs.length]));
  for(const ref of sourceRevisionRefs)graph.sourceRevisionState.set(ref,{state:'ACTIVE'});
  const store=new MemoryExperienceStore({graph});

  const episode=store.publishEpisode({
    logicalId:'episode:segmented',
    evidenceRefs,
    sourceRevisionRefs,
    summary:'segmented evidence',
  });

  assert.equal(episode.evidenceRefs.length,128);
  assert.equal(episode.sourceRevisionRefs.length,64);
  assert.equal(episode.referenceManifests.evidenceRefs.total,129);
  assert.equal(episode.referenceManifests.sourceRevisionRefs.total,65);
  assert.equal(episode.referenceManifests.evidenceRefs.coverageComplete,true);
  assert.equal(episode.referenceManifests.evidenceRefs.canonicalKnowledgeDropped,false);
  assert.equal(memoryReferenceValues(episode,'evidenceRefs').length,129);
  assert.equal(memoryReferenceValues(episode,'sourceRevisionRefs').length,65);
  assert.equal(store.exactDrillback(episode.id).length,129);
});

test('row 45: failed replacement validation cannot partially retire the current episode',()=>{
  const graph=fakeGraph();
  graph.addEvidence('evidence:1','source:1@1');
  const store=new MemoryExperienceStore({graph});
  const first=store.publishEpisode({
    logicalId:'episode:atomic',
    evidenceRefs:['evidence:1'],
    sourceRevisionRefs:['source:1@1'],
    summary:'first',
  });

  assert.throws(()=>store.publishEpisode({
    logicalId:'episode:atomic',
    evidenceRefs:['evidence:1'],
    sourceRevisionRefs:['source:1@1'],
    summary:'invalid replacement',
    significance:2,
  }),/episode\.significance/);

  const current=store.currentEpisodes({freshOnly:false}).find((row)=>row.logicalId==='episode:atomic');
  assert.equal(current.id,first.id);
  assert.equal(current.state,'CURRENT');
  assert.equal(current.replacedByEpisodeId,null);
  assert.equal(store.episodeHistory('episode:atomic').length,1);
});

test('row 45: reflection episode/support refs segment and invalid revision input leaves the prior reflection current',()=>{
  const graph=fakeGraph();
  const store=new MemoryExperienceStore({graph});
  const evidenceRefs=[];
  const episodeIds=[];
  for(let i=0;i<129;i+=1){
    const evidenceId='reflection-evidence:'+i;
    const source='reflection-source:'+i+'@1';
    graph.addEvidence(evidenceId,source);
    evidenceRefs.push(evidenceId);
    if(i<65){
      const ep=store.publishEpisode({
        logicalId:'support-episode:'+i,
        evidenceRefs:[evidenceId],
        sourceRevisionRefs:[source],
        summary:'support '+i,
      });
      episodeIds.push(ep.id);
    }
  }
  const reflection=store.reviseReflection({
    reflectionKey:'pattern:segmented',
    statement:'The pattern repeats.',
    supportEvidenceRefs:evidenceRefs,
    episodeRefs:episodeIds,
    sourceRevisionRefs:evidenceRefs.map((_,i)=>'reflection-source:'+i+'@1'),
    confidence:0.7,
  });
  assert.equal(reflection.supportEvidenceRefs.length,128);
  assert.equal(reflection.episodeRefs.length,64);
  assert.equal(reflection.referenceManifests.supportEvidenceRefs.total,129);
  assert.equal(reflection.referenceManifests.episodeRefs.total,65);

  assert.throws(()=>store.reviseReflection({
    reflectionKey:'pattern:segmented',
    statement:'Invalid confidence replacement.',
    supportEvidenceRefs:['reflection-evidence:0'],
    episodeRefs:[episodeIds[0]],
    confidence:4,
  }),/reflection\.confidence/);
  const current=store.currentReflections({freshOnly:false}).find((row)=>row.reflectionKey==='pattern:segmented');
  assert.equal(current.id,reflection.id);
  assert.equal(current.state,'CURRENT');
  assert.equal(current.supersededByReflectionId,null);
});

test('row 46: 4,097 consolidation jobs and source refs resume once across snapshot without reselecting work',()=>{
  const graph=fakeGraph();
  const sourceRefs=Array.from({length:4097},(_,i)=>'consolidation-source:'+i+'@1');
  for(const ref of sourceRefs)graph.sourceRevisionState.set(ref,{state:'ACTIVE'});
  const jobs=Array.from({length:4097},(_,i)=>({type:'UNSUPPORTED_TEST_JOB',input:{marker:i}}));
  const store=new MemoryExperienceStore({graph});
  const session=store.startConsolidation(jobs,{sourceRevisionRefs:sourceRefs});

  assert.equal(session.jobs.length,4096);
  assert.equal(session.pendingJobSegments.length,1);
  assert.equal(session.totalJobs,4097);
  assert.equal(session.inputRevisionFence.sourceRevisionRefs.length,4096);
  assert.equal(session.inputRevisionFence.sourceRevisionManifest.total,4097);
  assert.equal(store.consolidationFenceStatus(session,{currentSourceRevisionRefs:sourceRefs}).ok,true);

  let state=session;
  for(let i=0;i<127;i+=1)state=store.runConsolidation(session.id,{maxUnits:32,currentSourceRevisionRefs:sourceRefs});
  state=store.runConsolidation(session.id,{maxUnits:31,currentSourceRevisionRefs:sourceRefs});
  assert.equal(state.processedJobs,4095);
  assert.equal(state.state,'CHECKPOINTED');
  assert.equal(state.checkpoint.cursor,4095);

  const restored=new MemoryExperienceStore({graph,snapshot:JSON.parse(JSON.stringify(store.snapshot()))});
  const before=restored.consolidationWorkUnits(session.id,{maxUnits:32});
  assert.equal(before.length,1);
  assert.equal(before[0].cursor,4095);

  const completed=restored.runConsolidation(session.id,{maxUnits:32,currentSourceRevisionRefs:sourceRefs});
  assert.equal(completed.state,'COMPLETED');
  assert.equal(completed.processedJobs,4097);
  assert.equal(completed.outcomes.length,4097);
  assert.deepEqual(completed.outcomes.map((row)=>row.cursor),Array.from({length:4097},(_,i)=>i));
  assert.equal(completed.pendingJobSegments.length,0);
  assert.equal(completed.continuationAvailable,false);
});
