import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryExperienceStore,memoryReferenceValues} from '../src/memory-experience-store.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';

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

test('row 46: 4,097 consolidation jobs remain page-bounded and resume through Runtime continuation after reload',()=>{
  const graph=fakeGraph();
  const sourceRefs=Array.from({length:4097},(_,i)=>'consolidation-source:'+i+'@1');
  for(const ref of sourceRefs)graph.sourceRevisionState.set(ref,{state:'ACTIVE'});
  const jobs=Array.from({length:4097},(_,i)=>({
    type:'UNSUPPORTED_TEST_JOB',
    input:{marker:i,sourceRevisionRefs:[sourceRefs[i]]},
  }));
  const store=new MemoryExperienceStore({graph});
  const session=store.startConsolidation(jobs);

  assert.equal(session.jobs.length,4096);
  assert.equal(session.totalJobs,4097);
  assert.equal(session.jobOffset,0);
  assert.equal(session.jobPageEnd,4096);
  assert.equal(session.nextJobOffset,4096);
  assert.equal(session.continuationAvailable,true);
  assert.equal(session.continuation.nextJobOffset,4096);
  assert.equal(session.continuation.remaining,1);
  assert.equal(session.continuation.runtimeSchedulingAuthority,false);
  assert.equal('pendingJobSegments' in session,false,'Memory must not retain an unbounded overflow queue');
  assert.equal(session.inputRevisionFence.sourceRevisionRefs.length,4096);
  assert.equal(store.consolidationFenceStatus(session,{currentSourceRevisionRefs:sourceRefs}).ok,true);

  let state=session;
  for(let i=0;i<127;i+=1)state=store.runConsolidation(session.id,{maxUnits:32,currentSourceRevisionRefs:sourceRefs});
  state=store.runConsolidation(session.id,{maxUnits:31,currentSourceRevisionRefs:sourceRefs});
  assert.equal(state.processedJobs,4095);
  assert.equal(state.state,'CHECKPOINTED');
  assert.equal(state.checkpoint.cursor,4095);
  assert.equal(state.checkpoint.pageCursor,4095);
  assert.equal(state.checkpoint.nextJobOffset,4096);

  const restored=new MemoryExperienceStore({graph,snapshot:JSON.parse(JSON.stringify(store.snapshot()))});
  const before=restored.consolidationWorkUnits(session.id,{maxUnits:32});
  assert.equal(before.length,1);
  assert.equal(before[0].cursor,4095);

  const pageOneDone=restored.runConsolidation(session.id,{maxUnits:32,currentSourceRevisionRefs:sourceRefs});
  assert.equal(pageOneDone.state,'CHECKPOINTED');
  assert.equal(pageOneDone.processedJobs,4096);
  assert.equal(pageOneDone.outcomes.length,4096);
  assert.equal(pageOneDone.nextJobOffset,4096);
  assert.equal(pageOneDone.continuationAvailable,true);
  assert.deepEqual(pageOneDone.outcomes.map((row)=>row.cursor),Array.from({length:4096},(_,i)=>i));

  const pageTwo=restored.startConsolidation(jobs,{
    jobOffset:pageOneDone.continuation.nextJobOffset,
    jobSetToken:pageOneDone.continuation.jobSetToken,
  });
  assert.equal(pageTwo.jobs.length,1);
  assert.equal(pageTwo.jobOffset,4096);
  assert.equal(pageTwo.nextJobOffset,null);
  assert.equal(pageTwo.processedJobs,4096);
  assert.equal(pageTwo.continuationAvailable,false);

  const completed=restored.runConsolidation(pageTwo.id,{maxUnits:32,currentSourceRevisionRefs:sourceRefs});
  assert.equal(completed.state,'COMPLETED');
  assert.equal(completed.processedJobs,4097);
  assert.equal(completed.outcomes.length,1);
  assert.equal(completed.outcomes[0].cursor,4096);
  assert.equal(completed.continuationAvailable,false);

  assert.throws(()=>restored.startConsolidation(jobs,{jobOffset:4096,jobSetToken:'wrong-token'}),/MEMORY_CONSOLIDATION_JOB_SET_CHANGED/);
});

test('row 46: bundle review exposes Runtime-owned continuation instead of silently dropping proposal 4,097',()=>{
  const producer=new MemoryTemporalProducer();
  const proposals=Array.from({length:4097},(_,i)=>({
    proposalId:'proposal:page:'+i,
    proposalKind:'EPISODE_SUMMARY',
    authority:'UNRESOLVED',
    sourceArtifactRefs:[],
    payload:{},
  }));
  const bundle={
    kind:'ConsolidationProposalBundle',
    contractVersion:'1.1.0',
    bundleId:'bundle:page',
    unitId:'unit:page',
    proposals,
    validationReceipt:{syntax:'PASS',schema:'PASS',semantic:'PASS'},
  };

  const first=producer.reviewConsolidationBundle({bundle,selection:{chatId:'chat:page'}});
  assert.equal(first.status,'DEFERRED');
  assert.equal(first.reasonCode,'MEMORY_CONSOLIDATION_REVIEW_PAGE_BOUND');
  assert.equal(first.reviewOffset,0);
  assert.equal(first.processed,4096);
  assert.equal(first.remaining,1);
  assert.equal(first.continuationAvailable,true);
  assert.equal(first.nextReviewOffset,4096);
  assert.equal(first.continuation.nextProposalId,'proposal:page:4096');
  assert.equal(first.continuation.runtimeSchedulingAuthority,false);
  assert.equal(first.results[0].proposalId,'proposal:page:0');
  assert.equal(first.results.at(-1).proposalId,'proposal:page:4095');

  const second=producer.reviewConsolidationBundle({
    bundle,
    selection:{chatId:'chat:page'},
    reviewOffset:first.nextReviewOffset,
  });
  assert.equal(second.reviewOffset,4096);
  assert.equal(second.processed,1);
  assert.equal(second.remaining,0);
  assert.equal(second.continuationAvailable,false);
  assert.equal(second.nextReviewOffset,null);
  assert.equal(second.results.length,1);
  assert.equal(second.results[0].proposalId,'proposal:page:4096');
  assert.equal(new Set(first.results.map((row)=>row.proposalId)).has(second.results[0].proposalId),false);
});
