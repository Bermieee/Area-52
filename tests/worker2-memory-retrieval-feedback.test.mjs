import test from 'node:test';
import assert from 'node:assert/strict';

import {Area52NativeBrain} from '../src/native-brain.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';
import {createMemoryIntegrationSurface} from '../src/memory-integration-surface.js';
import {NativeLearningFeedback} from '../src/native-learning-feedback.js';
import {buildMemoryRetrievalFeedbackBatch} from '../src/memory-retrieval-feedback.js';

function scene(sceneId,sceneRevision,{location=null,activeCast=[]}={}){
  return{
    sceneId,sceneRevision,location,narrativeTime:'turn '+sceneRevision,
    activeCast,activeThreads:[],objects:[],activeRelationships:[],
    sourceRevisionRefs:[],provenance:['worker2-feedback:'+sceneId+':'+sceneRevision],
  };
}

function episode(memory,{chatId='chat:feedback',index=1,text='Mira stores the amber seal beneath the eastern desk.'}={}){
  const ev=memory.appendEvidence({
    id:'feedback:e:'+index,sourceId:'feedback:s:'+index,sourceRevisionId:'feedback:s:'+index+'@r1',
    exactContent:text,kind:'EXPERIENCE',occurredAt:index,worldRevision:index,sceneRevision:index,
    participants:['Mira'],knownBy:['Mira'],metadata:{chatId,turnId:'feedback:t:'+index,generationId:'feedback:g:'+index,correlationId:'feedback:c:'+index},
    provenance:['worker2-feedback'],
  });
  const ep=memory.publishEpisode({
    logicalId:'feedback:episode:'+index,chatId,turnId:'feedback:t:'+index,generationId:'feedback:g:'+index,
    sceneId:'feedback-scene-'+index,sceneRevision:index,sourceRevisionRefs:[ev.sourceRevisionId],
    evidenceRefs:[ev.id],summary:ev.exactContent,provenance:['worker2-feedback'],
  });
  memory.rebuildHistorian();
  return{ev,ep};
}

function nomination(ep,ev,{candidateId='memory:candidate:1',nominationId='memory:nomination:1',freshness='FRESH'}={}){
  return{
    candidateId,freshness,
    channelNominations:[{
      nominationId,channelId:'OWNER_MEMORY',freshness,
      artifactRef:{kind:'ArtifactReference',artifactId:ep.id,revision:ep.revision,owner:'MEMORY',sourceRevisionSet:[ev.sourceRevisionId]},
      artifactRevision:ep.revision,sourceRevisionRefs:[ev.sourceRevisionId],dependencyRevisions:[],
      representationRef:ep.id,representationRevision:ep.revision,
    }],
  };
}

function batchFor({selection,candidates,truthResults,admittedCandidateIds=[],traceRows=[]}){
  return buildMemoryRetrievalFeedbackBatch({
    selection,
    candidateEnvelope:{candidates},
    assessment:{truthResults},
    publicationAssessment:{admittedCandidateIds,supportCandidateIds:[]},
    candidateTraceReceipt:{rows:traceRows},
  });
}

test('Worker 2 #39: exact accepted Memory outcome applies once, survives reload dedupe, and changes later owner-backed rank only',()=>{
  let memory=new MemoryTemporalProducer();
  const {ev,ep}=episode(memory,{});
  const beforeQuery=memory.queryHistorian({query:'amber seal eastern desk',selection:{chatId:'chat:feedback'}});
  const beforeNomination=beforeQuery.nominations.find(row=>row.artifactRef?.artifactId===ep.id);
  assert.ok(beforeNomination);
  const priorityBefore=beforeNomination.rankSignals.plasticityPriority;

  const candidate=nomination(ep,ev,{candidateId:'memory:candidate:accepted'});
  candidate.channelNominations.push({...structuredClone(candidate.channelNominations[0]),nominationId:'memory:nomination:accepted:duplicate'});
  const batch=batchFor({
    selection:{chatId:'chat:feedback',turnId:'feedback:use',generationId:'feedback:use:g',correlationId:'feedback:use:c',worldRevision:2,sceneRevision:2},
    candidates:[candidate],
    truthResults:[{candidateId:candidate.candidateId,usableForIntent:true,classification:'HISTORICAL',reasons:['historical-usable-for-historical']}],
    admittedCandidateIds:[candidate.candidateId],
    traceRows:[{candidateId:candidate.candidateId,gathered:true,sealed:true}],
  });
  assert.equal(batch.outcomes.length,1);
  assert.equal(batch.outcomes[0].signal,'ACCEPTED');
  assert.equal(batch.outcomes[0].includedInSeal,true);
  assert.equal(batch.deliveryKnown,false);

  const before=memory.plasticity.record(ep.id,ep.revision);
  const receipt=memory.admitRetrievalFeedback(batch);
  const after=memory.plasticity.record(ep.id,ep.revision);
  assert.equal(receipt.counts.applied,1);
  assert.equal(after.acceptedUses,before.acceptedUses+1);
  assert.equal(after.rejectedUses,before.rejectedUses);
  assert.equal(receipt.supportAdded,false);
  assert.equal(receipt.authorityChanged,false);
  assert.equal(after.authorityClass,before.authorityClass);

  const afterQuery=memory.queryHistorian({query:'amber seal eastern desk',selection:{chatId:'chat:feedback'}});
  const afterNomination=afterQuery.nominations.find(row=>row.artifactRef?.artifactId===ep.id);
  assert.ok(afterNomination.rankSignals.plasticityPriority>priorityBefore);
  assert.equal(afterNomination.metadata.retrievalFeedbackIsEvidence,false);

  const acceptedUses=memory.plasticity.record(ep.id,ep.revision).acceptedUses;
  const replay=memory.admitRetrievalFeedback(batch);
  assert.equal(replay.status,'REPLAYED');
  assert.equal(memory.plasticity.record(ep.id,ep.revision).acceptedUses,acceptedUses);

  memory=MemoryTemporalProducer.fromSnapshot(memory.snapshot());
  const reloadReplay=memory.admitRetrievalFeedback(batch);
  assert.equal(reloadReplay.status,'REPLAYED');
  assert.equal(memory.plasticity.record(ep.id,ep.revision).acceptedUses,acceptedUses);
  assert.equal(memory.graph.evidenceRecord(ev.id).exactContent,'Mira stores the amber seal beneath the eastern desk.');
});

test('Worker 2 #39: quality rejection is bounded while omission, missing evidence, foreign story, and stale revision never become false negative learning',()=>{
  const memory=new MemoryTemporalProducer();
  const {ev,ep}=episode(memory,{index:11});
  const baseCandidate=nomination(ep,ev,{candidateId:'memory:candidate:quality',nominationId:'memory:nomination:quality'});

  const quality=batchFor({
    selection:{chatId:'chat:feedback',turnId:'quality',generationId:'quality:g',correlationId:'quality:c'},
    candidates:[baseCandidate],
    truthResults:[{candidateId:baseCandidate.candidateId,usableForIntent:false,classification:'UNRESOLVED',reasons:['claim-missing-or-invalid']}],
  });
  assert.equal(quality.outcomes[0].signal,'REJECTED');
  const rejectedBefore=memory.plasticity.record(ep.id,ep.revision).rejectedUses;
  const qualityReceipt=memory.admitRetrievalFeedback(quality);
  assert.equal(qualityReceipt.counts.applied,1);
  assert.equal(memory.plasticity.record(ep.id,ep.revision).rejectedUses,rejectedBefore+1);
  assert.equal(qualityReceipt.outcomes[0].effect.retrievalCounted,false);

  const neutralCandidate=nomination(ep,ev,{candidateId:'memory:candidate:budget',nominationId:'memory:nomination:budget'});
  const neutral=batchFor({
    selection:{chatId:'chat:feedback',turnId:'budget',generationId:'budget:g',correlationId:'budget:c'},
    candidates:[neutralCandidate],
    truthResults:[{candidateId:neutralCandidate.candidateId,usableForIntent:true,classification:'CURRENT',reasons:['current-usable-for-current']}],
    admittedCandidateIds:[],
  });
  assert.equal(neutral.outcomes[0].signal,'NONE');
  assert.equal(neutral.outcomes[0].outcome,'OMITTED_OR_DEFERRED_NEUTRAL');
  const negativeBeforeNeutral=memory.plasticity.record(ep.id,ep.revision).rejectedUses;
  const neutralReceipt=memory.admitRetrievalFeedback(neutral);
  assert.equal(neutralReceipt.counts.deferred,1);
  assert.equal(memory.plasticity.record(ep.id,ep.revision).rejectedUses,negativeBeforeNeutral);

  const unknownCandidate=nomination(ep,ev,{candidateId:'memory:candidate:unknown',nominationId:'memory:nomination:unknown'});
  const unknown=batchFor({
    selection:{chatId:'chat:feedback',turnId:'unknown',generationId:'unknown:g',correlationId:'unknown:c'},
    candidates:[unknownCandidate],truthResults:[],
  });
  assert.equal(unknown.outcomes[0].signal,'NONE');
  memory.admitRetrievalFeedback(unknown);
  assert.equal(memory.plasticity.record(ep.id,ep.revision).rejectedUses,negativeBeforeNeutral);

  const acceptedBeforeForeign=memory.plasticity.record(ep.id,ep.revision).acceptedUses;
  const foreignCandidate=nomination(ep,ev,{candidateId:'memory:candidate:foreign',nominationId:'memory:nomination:foreign'});
  const foreign=batchFor({
    selection:{chatId:'chat:other-story',turnId:'foreign',generationId:'foreign:g',correlationId:'foreign:c'},
    candidates:[foreignCandidate],
    truthResults:[{candidateId:foreignCandidate.candidateId,usableForIntent:true,classification:'CURRENT',reasons:['current-usable-for-current']}],
    admittedCandidateIds:[foreignCandidate.candidateId],traceRows:[{candidateId:foreignCandidate.candidateId,gathered:true,sealed:true}],
  });
  const foreignReceipt=memory.admitRetrievalFeedback(foreign);
  assert.equal(foreignReceipt.status,'REJECTED');
  assert.ok(foreignReceipt.outcomes[0].reasonCodes.includes('MEMORY_FOREIGN_STORY_MAPPING'));
  assert.equal(memory.plasticity.record(ep.id,ep.revision).acceptedUses,acceptedBeforeForeign);

  memory.invalidateSourceRevision(ev.sourceRevisionId,{reason:'WORKER2_FEEDBACK_STALE_TEST'});
  const staleCandidate=nomination(ep,ev,{candidateId:'memory:candidate:stale',nominationId:'memory:nomination:stale'});
  const stale=batchFor({
    selection:{chatId:'chat:feedback',turnId:'stale',generationId:'stale:g',correlationId:'stale:c'},
    candidates:[staleCandidate],
    truthResults:[{candidateId:staleCandidate.candidateId,usableForIntent:true,classification:'CURRENT',reasons:['current-usable-for-current']}],
    admittedCandidateIds:[staleCandidate.candidateId],traceRows:[{candidateId:staleCandidate.candidateId,gathered:true,sealed:true}],
  });
  const staleReceipt=memory.admitRetrievalFeedback(stale);
  assert.equal(staleReceipt.status,'REJECTED');
  assert.ok(staleReceipt.outcomes[0].reasonCodes.includes('MEMORY_ARTIFACT_REVISION_STALE'));
  assert.equal(memory.graph.evidenceRecord(ev.id).exactContent,'Mira stores the amber seal beneath the eastern desk.');
});

test('Worker 2 #39: merged exact artifacts update once and co-retrieval uses existing nomination association without creating support',()=>{
  const memory=new MemoryTemporalProducer();
  const first=episode(memory,{index:21,text:'Mira places the tide key beside the brass compass.'});
  const second=episode(memory,{index:22,text:'Mira stores the brass compass beside the tide key.'});
  memory.recordCoRetrieval({artifactRefs:[
    {artifactId:first.ep.id,artifactRevision:first.ep.revision},
    {artifactId:second.ep.id,artifactRevision:second.ep.revision},
  ],reasonCode:'HISTORIAN_CO_RETRIEVAL'});
  const pairBefore=memory.plasticity.association(first.ep.id,second.ep.id,first.ep.revision,second.ep.revision);
  assert.ok(pairBefore);

  const c1=nomination(first.ep,first.ev,{candidateId:'memory:candidate:pair:1',nominationId:'memory:nomination:pair:1'});
  c1.channelNominations.push({...structuredClone(c1.channelNominations[0]),nominationId:'memory:nomination:pair:1:again'});
  const c2=nomination(second.ep,second.ev,{candidateId:'memory:candidate:pair:2',nominationId:'memory:nomination:pair:2'});
  const batch=batchFor({
    selection:{chatId:'chat:feedback',turnId:'pair',generationId:'pair:g',correlationId:'pair:c'},
    candidates:[c1,c2],
    truthResults:[
      {candidateId:c1.candidateId,usableForIntent:true,classification:'CURRENT',reasons:['current-usable-for-current']},
      {candidateId:c2.candidateId,usableForIntent:true,classification:'CURRENT',reasons:['current-usable-for-current']},
    ],
    admittedCandidateIds:[c1.candidateId,c2.candidateId],
    traceRows:[{candidateId:c1.candidateId,gathered:true,sealed:true},{candidateId:c2.candidateId,gathered:true,sealed:true}],
  });
  assert.equal(batch.outcomes.length,2);
  const receipt=memory.admitRetrievalFeedback(batch);
  assert.equal(receipt.counts.applied,2);
  const pairAfter=memory.plasticity.association(first.ep.id,second.ep.id,first.ep.revision,second.ep.revision);
  assert.equal(pairAfter.retrievalUses,pairBefore.retrievalUses);
  assert.equal(pairAfter.usefulUses,pairBefore.usefulUses+1);
  assert.equal(receipt.coRetrieval.retrievalCounted,false);
  assert.equal(receipt.coRetrieval.retrievalUseIsEvidence,false);
  assert.equal(receipt.supportAdded,false);
});

test('Worker 2 #39: installed Brain schedules exact Memory feedback after response completion and recovery cannot amplify it',async()=>{
  let memory=new MemoryTemporalProducer();
  let surface=createMemoryIntegrationSurface(memory);
  let brain=new Area52NativeBrain({memoryInterface:surface});

  await brain.prepareTurn({
    chatId:'chat:brain-feedback',turnId:'brain-feedback:A',generationId:'brain-feedback:gen:A',
    query:'Continue.',intent:'CURRENT',scene:scene('archive',1,{location:'Archive',activeCast:['Mira']}),executionLabel:'DETERMINISTIC',
  });
  const learnedA=await brain.completeTurn({
    turnId:'brain-feedback:A',response:'Mira leaves the brass astrolabe inside the cedar cabinet beneath the western window.',knownBy:['Mira'],
  });
  const episodeId=learnedA.memoryPostTurn?.episodeId;
  assert.ok(episodeId);

  const prepared=await brain.prepareTurn({
    chatId:'chat:brain-feedback',turnId:'brain-feedback:B',generationId:'brain-feedback:gen:B',
    query:'Where did Mira leave the brass astrolabe?',intent:'HISTORICAL',
    scene:scene('archive-return',2,{location:'Archive',activeCast:['Mira']}),executionLabel:'DETERMINISTIC',
  });
  const ownerCandidates=(prepared.candidateEnvelope?.candidates??[]).filter(candidate=>(candidate.channelNominations??[]).some(row=>row.channelId==='OWNER_MEMORY'));
  assert.ok(ownerCandidates.length>0);
  assert.ok(ownerCandidates.some(candidate=>(candidate.channelNominations??[]).some(row=>row.artifactRef?.artifactId===episodeId&&Number(row.artifactRevision)===Number(row.artifactRef?.revision))));
  assert.ok(prepared.gatherReceipt?.admittedCandidateIds?.some(id=>ownerCandidates.some(candidate=>candidate.candidateId===id)));
  assert.ok(prepared.contextSealReceipt?.sealedState);

  const before=memory.plasticity.record(episodeId);
  const completion=await brain.completeTurn({
    turnId:'brain-feedback:B',response:'Mira recalls that the brass astrolabe remained in the cedar cabinet.',knownBy:['Mira'],autoDrain:false,
  });
  assert.equal(completion.responseCompletion.status,'COMPLETED');
  assert.ok(completion.memoryFeedbackRuntimeTaskId);
  assert.ok(completion.memoryRetrievalFeedbackBatch?.outcomeCount>=1);
  assert.equal(completion.memoryRetrievalFeedback??null,null);
  assert.equal(completion.responseCompletion.responseRecordedBeforeBackgroundExecution,true);

  await brain.drainBackgroundLearning({maxCycles:128});
  const learnedB=brain.readTurn('brain-feedback:B');
  assert.equal(learnedB.memoryRetrievalFeedback?.status,'COMPLETED');
  assert.ok((learnedB.memoryRetrievalFeedback?.counts?.applied??0)>=1);
  const after=memory.plasticity.record(episodeId);
  assert.equal(after.acceptedUses,before.acceptedUses+1);
  assert.equal(learnedB.memoryRetrievalFeedback.supportAdded,false);
  assert.equal(learnedB.memoryRetrievalFeedback.authorityChanged,false);
  assert.equal(learnedB.memoryRetrievalFeedback.deliveryKnown,false);

  await brain.drainBackgroundLearning({maxCycles:128});
  assert.equal(memory.plasticity.record(episodeId).acceptedUses,after.acceptedUses);

  const selected=brain.uiBindings().readSelectedTurnReceipt(prepared.selection);
  assert.equal(selected.memoryRetrievalFeedback.status,'COMPLETED');
  assert.equal(selected.producers.memoryRetrievalFeedback.metadata.supportAdded,false);
  assert.equal(selected.producers.memoryRetrievalFeedback.metadata.deliveryKnown,false);

  const brainSnapshot=brain.snapshot(),memorySnapshot=memory.snapshot(),acceptedUses=after.acceptedUses;
  memory=MemoryTemporalProducer.fromSnapshot(memorySnapshot);
  surface=createMemoryIntegrationSurface(memory);
  brain=Area52NativeBrain.fromSnapshot(brainSnapshot,{memoryInterface:surface});
  await brain.drainBackgroundLearning({maxCycles:128});
  assert.equal(memory.plasticity.record(episodeId).acceptedUses,acceptedUses);
});

test('Worker 2 #39: generic channel learning treats unadmitted-but-not-rejected candidates as neutral',()=>{
  const learning=new NativeLearningFeedback();
  const receipt=learning.observeTurn({
    turnId:'neutral:1',
    candidateEnvelope:{candidates:[{candidateId:'neutral:candidate',freshness:'FRESH',channelNominations:[{channelId:'OWNER_MEMORY'}]}]},
    assessment:{truthResults:[{candidateId:'neutral:candidate',usableForIntent:true}]},
    publicationAssessment:{admittedCandidateIds:[],supportCandidateIds:[]},
  });
  const row=receipt.channelOutcomes.find(item=>item.channelId==='OWNER_MEMORY');
  assert.equal(row.rejected,0);
  assert.equal(row.neutral,1);
  assert.equal(row.bias,0);
});
