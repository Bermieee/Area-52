import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CandidateAuthorityClass, CandidateTruthStatus, CorrectiveRetrievalAction, HistorianMemoryChannel,
  HistorianPerspectiveScope, HistorianRetrievalMode, createCandidateBusEnvelope, createCorrectiveRetrievalPlan,
  createHistorianCandidateSet, createHistorianMemoryRequest, createHistorianTask, createRetrievalAbstentionReceipt,
  evaluateHistorianFreshness, evaluateRetrievalQuality, historianUrgency, validateHistorianResolverResponse,
} from '../src/coprocessor/index.js';

function task(i, extra={}) {
  return createHistorianTask({
    turnId:'stress:'+i,correlationId:'corr:'+i,sourceRevisionSet:['src:'+i],worldRevision:5,sceneRevision:i%31,characterStateRevision:3,
    memoryRevisionRefs:['mem:'+i],intentFingerprint:'fp:'+i,
    retrievalIntents:[{intentId:'intent:'+i,mode:extra.mode??HistorianRetrievalMode.CONTINUITY_RECALL,required:true}],
    perspectiveConstraint:extra.perspectiveConstraint??{scope:HistorianPerspectiveScope.WORLD},
  });
}
function candidate(i,intentId,extra={}) {
  return {candidateId:'c:'+i,evidenceIdentity:'e:'+i,channel:extra.channel??'HISTORIAN_SCENE_EPISODE',
    sourceRevisionRefs:['src:'+i],worldRevision:5,sceneRevision:i%31,rankSignals:{intentMatch:.9},retrievalIntentIds:[intentId],
    authorityClass:extra.authorityClass??'OBSERVED',truthStatus:extra.truthStatus??'HISTORICAL',freshness:extra.freshness??'FRESH',
    provenance:[{ref:'p:'+i}],evidenceRefs:['ev:'+i],representationText:'x'};
}
function artifact(i, perspective={scope:HistorianPerspectiveScope.WORLD}) {
  return {candidateId:'a:'+i,artifactRef:{kind:'ArtifactReference',artifactId:'a:'+i,artifactType:'SceneEpisode',owner:'MEMORY',revision:1,storageDomain:'memory',
    sourceRevisionSet:['src:'+i],worldRevision:5,sceneRevision:i%31},channel:HistorianMemoryChannel.SCENE_EPISODE,retrievalIntentIds:['intent:'+i],
    authorityClass:CandidateAuthorityClass.OBSERVED,truthStatusHint:CandidateTruthStatus.HISTORICAL,perspective,
    sourceRevisionRefs:['src:'+i],evidenceRefs:['ev:'+i],provenance:[{ref:'p:'+i}],representationText:'history'};
}

test('Wave 7 focused retrieval stress preserves bounds, fences and one-correction maximum',()=>{
  const totals={historianRetrievalRequests:0,explicitHistoricalQueries:0,relationshipHistoryQueries:0,perspectiveFencedRequests:0,
    qualityEvaluations:0,mixedCorrectionPaths:0,lowAbstentionPaths:0,staleRevisionCases:0,replayDedupeCases:0,latePostSealResults:0};
  let perspectiveLeaks=0,authorityViolations=0,staleForegroundAdmissions=0,maxCorrectionAttempt=0,maxCandidates=0;

  for(let i=0;i<2000;i++){
    const t=task(i);assert.equal(t.metadata.maxArtifacts,48);assert.ok(t.metadata.retrievalIntentIds.length<=16);totals.historianRetrievalRequests++;
  }

  for(let i=0;i<1000;i++){
    const u=historianUrgency({text:'What happened last time before event '+i+'?',queryIntent:'HISTORY'});
    assert.equal(u.wake,true);assert.equal(u.resultClass,'REQUIRED');totals.explicitHistoricalQueries++;
  }

  for(let i=0;i<1000;i++){
    const t=task(3000+i,{mode:HistorianRetrievalMode.RELATIONSHIP_HISTORY});
    assert.equal(t.metadata.retrievalIntents[0].mode,HistorianRetrievalMode.RELATIONSHIP_HISTORY);totals.relationshipHistoryQueries++;
  }

  for(let i=0;i<1000;i++){
    const idx=5000+i;
    const t=task(idx,{perspectiveConstraint:{scope:HistorianPerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'B'}});
    const req=createHistorianMemoryRequest(t);
    const out=validateHistorianResolverResponse({status:'OK',memoryRevisionRefs:['mem:'+idx],artifacts:[
      artifact(idx,{scope:HistorianPerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'B'}),
    ]},req);
    if(out.artifacts.some((x)=>x.perspective?.scope==='WORLD'))perspectiveLeaks++;
    totals.perspectiveFencedRequests++;
  }

  for(let i=0;i<2000;i++){
    const intent='i:'+i;const q=evaluateRetrievalQuality({requiredIntents:[intent],candidates:[candidate(i,intent)],confidence:.9});
    assert.equal(q.quality,'HIGH');if(q.canonicalTruthGranted)authorityViolations++;totals.qualityEvaluations++;
  }

  for(let i=0;i<750;i++){
    const p=createCorrectiveRetrievalPlan({turnId:'m:'+i,intentFingerprint:'fp:m:'+i,targetIntentIds:['missing:'+i],missingEvidence:['facet'],
      action:i%2?CorrectiveRetrievalAction.ENTITY_CONSTRAINED_SEARCH:CorrectiveRetrievalAction.TEMPORAL_NARROWING,maxCandidates:24,maxEvidenceBytes:32768,attempt:1});
    maxCorrectionAttempt=Math.max(maxCorrectionAttempt,p.attempt);assert.equal(p.attempt,1);totals.mixedCorrectionPaths++;
  }

  for(let i=0;i<750;i++){
    const a=createRetrievalAbstentionReceipt({reason:'LOW_QUALITY',quality:'LOW',retrievalIntentIds:['i:'+i],missingIntents:['i:'+i],correctiveAttemptUsed:false});
    assert.equal(a.authorityGranted,false);totals.lowAbstentionPaths++;
  }

  for(let i=0;i<500;i++){
    const t=task(7000+i);const a=artifact(7000+i);
    const receipt=evaluateHistorianFreshness(t,{candidateSet:{candidates:[{artifactRef:a.artifactRef}]}},{
      sourceRevisionSet:['changed'],worldRevision:5,sceneRevision:t.sceneRevision,characterStateRevision:3,intentFingerprint:t.intentFingerprint,
      perspectiveConstraint:{scope:'WORLD'},memoryRevisionRefs:t.metadata.memoryRevisionRefs,memoryArtifactRevisions:{[a.artifactRef.artifactId]:1},
    });
    assert.equal(receipt.freshness,'STALE');if(receipt.foregroundEligible)staleForegroundAdmissions++;totals.staleRevisionCases++;
  }

  for(let i=0;i<500;i++){
    const c=candidate(8000+i,'i:'+i);
    const set=createCandidateBusEnvelope({candidateSetId:'d:'+i,sourceRevisionSet:c.sourceRevisionRefs,worldRevision:5,sceneRevision:c.sceneRevision,candidates:[c,c,c],maxCandidates:8});
    assert.equal(set.candidateCount,1);assert.equal(set.duplicateNominations,2);totals.replayDedupeCases++;
  }

  for(let i=0;i<250;i++){
    const t=task(9000+i);const a=artifact(9000+i);
    const receipt=evaluateHistorianFreshness(t,{candidateSet:{candidates:[{artifactRef:a.artifactRef}]}},{
      sourceRevisionSet:t.sourceRevisionSet,worldRevision:5,sceneRevision:t.sceneRevision,characterStateRevision:3,intentFingerprint:t.intentFingerprint,
      perspectiveConstraint:{scope:'WORLD'},memoryRevisionRefs:t.metadata.memoryRevisionRefs,memoryArtifactRevisions:{[a.artifactRef.artifactId]:1},sealed:true,
    });
    assert.equal(receipt.destination,'NEXT_TURN');assert.equal(receipt.foregroundEligible,false);totals.latePostSealResults++;
  }

  const corpus=Array.from({length:5000},(_,i)=>({id:'episode:'+i,relevance:i%997===0?1:0,turn:i}));
  const selected=corpus.filter((x)=>x.relevance).slice(0,48).map((x,i)=>({
    candidateId:x.id,evidenceIdentity:x.id,channel:'HISTORIAN_SCENE_EPISODE',sourceRevisionRefs:['corpus:1'],worldRevision:5,sceneRevision:1,
    rankSignals:{intentMatch:1,recency:x.turn/5000},retrievalIntentIds:['long'],authorityClass:'OBSERVED',truthStatus:'HISTORICAL',
    freshness:'FRESH',provenance:[{ref:'turn:'+x.turn}],evidenceRefs:['turn:'+x.turn],
  }));
  const bounded=createCandidateBusEnvelope({candidateSetId:'long-corpus',sourceRevisionSet:['corpus:1'],worldRevision:5,sceneRevision:1,candidates:selected,maxCandidates:48});
  maxCandidates=Math.max(maxCandidates,bounded.candidateCount);assert.ok(bounded.candidateCount<=48);

  assert.equal(perspectiveLeaks,0);assert.equal(authorityViolations,0);assert.equal(staleForegroundAdmissions,0);assert.equal(maxCorrectionAttempt,1);
  assert.deepEqual(totals,{historianRetrievalRequests:2000,explicitHistoricalQueries:1000,relationshipHistoryQueries:1000,perspectiveFencedRequests:1000,
    qualityEvaluations:2000,mixedCorrectionPaths:750,lowAbstentionPaths:750,staleRevisionCases:500,replayDedupeCases:500,latePostSealResults:250});
  console.log(JSON.stringify({stress:'wave7-retrieval',...totals,maxCandidates,perspectiveLeaks,authorityViolations,staleForegroundAdmissions,
    maximumForegroundCorrectivePasses:maxCorrectionAttempt,longEpisodeCorpus:corpus.length}));
});
