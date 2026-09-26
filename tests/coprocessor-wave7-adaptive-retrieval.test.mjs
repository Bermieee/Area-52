import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AdaptiveRetrievalController, CorrectiveRetrievalAction, CorrectiveRetrievalDispatcher,
  PrecisionRetrievalPipeline, RetrievalQuality, createCandidateBusEnvelope, createCorrectiveRetrievalPlan,
  createRetrievalAbstentionReceipt, evaluateCandidateSetQuality, evaluateRetrievalQuality,
  mergeCorrectiveCandidateSets, retrievalControlDecision,
} from '../src/coprocessor/index.js';

function candidate(id, intents=['i1'], extra={}) {
  return {
    candidateId:id,evidenceIdentity:extra.evidenceIdentity??id,channel:extra.channel??'HISTORIAN_SCENE_EPISODE',
    sourceRevisionRefs:extra.sourceRevisionRefs??['src:1'],worldRevision:5,sceneRevision:7,
    rankSignals:extra.rankSignals??{intentMatch:.9},retrievalIntentIds:intents,
    authorityClass:extra.authorityClass??'OBSERVED',truthStatus:extra.truthStatus??'HISTORICAL',
    freshness:extra.freshness??'FRESH',provenance:extra.provenance??[{ref:'prov:'+id}],
    evidenceRefs:extra.evidenceRefs??['e:'+id],representationText:extra.text??id,
    metadata:extra.metadata??{},
  };
}
function set(candidates, extra={}) {
  return createCandidateBusEnvelope({
    candidateSetId:extra.id??'set',query:extra.query??'q',intentFingerprint:'intent:1',
    sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,candidates,
    unavailableChannels:extra.unavailableChannels??[],maxCandidates:64,
  });
}

test('intent coverage HIGH requires all required intents represented with clean evidence',()=>{
  const q=evaluateRetrievalQuality({requiredIntents:['i1','i2'],candidates:[candidate('a',['i1']),candidate('b',['i2'])],confidence:.9});
  assert.equal(q.quality,RetrievalQuality.HIGH);assert.deepEqual(q.missingIntentIds,[]);assert.equal(q.coverage,1);assert.equal(q.canonicalTruthGranted,false);
});

test('intent coverage MIXED preserves useful evidence when one required facet is missing',()=>{
  const q=evaluateRetrievalQuality({requiredIntents:['i1','i2'],candidates:[candidate('a',['i1'])],confidence:.9});
  assert.equal(q.quality,RetrievalQuality.MIXED);assert.deepEqual(q.satisfiedIntentIds,['i1']);assert.deepEqual(q.missingIntentIds,['i2']);
});

test('intent coverage LOW when no required intent is satisfied',()=>{
  const q=evaluateRetrievalQuality({requiredIntents:['i1'],candidates:[candidate('x',['other'])],confidence:.9});
  assert.equal(q.quality,RetrievalQuality.LOW);
});

test('stale, contradictory, unresolved, temporal, perspective and provenance defects prevent HIGH quality',()=>{
  for(const input of [
    {candidates:[candidate('x',['i1'],{freshness:'STALE'})]},
    {candidates:[candidate('x',['i1'],{truthStatus:'CONTRADICTED'})]},
    {candidates:[candidate('x',['i1'],{truthStatus:'UNRESOLVED'})]},
    {candidates:[candidate('x',['i1'],{metadata:{temporalMismatch:true}})]},
    {candidates:[candidate('x',['i1'],{metadata:{perspectiveMismatch:true}})]},
    {candidates:[candidate('x',['i1'],{provenance:[]})]},
  ]) {
    const q=evaluateRetrievalQuality({requiredIntents:['i1'],...input,confidence:.9});
    assert.notEqual(q.quality,RetrievalQuality.HIGH);
  }
});

test('retrieval quality does not perform Truth Gate classification',()=>{
  const q=evaluateRetrievalQuality({requiredIntents:['i1'],candidates:[candidate('x',['i1'])],confidence:.95});
  assert.equal(q.truthClassificationPerformed,false);assert.equal(q.canonicalTruthGranted,false);
});

test('CorrectiveRetrievalPlan is bounded, revision-fenced and attempt is permanently one',()=>{
  const p=createCorrectiveRetrievalPlan({turnId:'t',intentFingerprint:'fp',reason:'missing entity',targetIntentIds:['i1'],missingEvidence:['entity:B'],
    action:CorrectiveRetrievalAction.ENTITY_CONSTRAINED_SEARCH,entityConstraints:['B'],sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,maxCandidates:12,maxEvidenceBytes:4096,attempt:1});
  assert.equal(p.attempt,1);assert.equal(p.maxCandidates,12);assert.equal(p.maxEvidenceBytes,4096);assert.equal(p.authorityGranted,false);
  assert.throws(()=>createCorrectiveRetrievalPlan({turnId:'t',intentFingerprint:'fp',action:CorrectiveRetrievalAction.SPARSE_RETRY,attempt:2}));
});

test('corrective dispatcher reports unavailable providers explicitly instead of inventing evidence',async()=>{
  const d=new CorrectiveRetrievalDispatcher();
  const p=createCorrectiveRetrievalPlan({turnId:'t',intentFingerprint:'fp',action:CorrectiveRetrievalAction.GRAPH_EXPANSION});
  const out=await d.dispatch(p);
  assert.equal(out.status,'UNAVAILABLE');assert.equal(out.candidateSet,null);assert.equal(out.authorityGranted,false);
});

test('corrective dispatcher can execute each registered provider class neutrally',async()=>{
  for(const action of Object.values(CorrectiveRetrievalAction)){
    const d=new CorrectiveRetrievalDispatcher().register(action,async(plan)=>({candidateSet:set([candidate('c:'+action,['i1'])]),planId:plan.planId}));
    const p=createCorrectiveRetrievalPlan({turnId:'t',intentFingerprint:'fp:'+action,action});
    const out=await d.dispatch(p);assert.equal(out.status,'SUCCESS');assert.equal(out.action,action);assert.equal(out.authorityGranted,false);
  }
});

test('merge keeps valid first-pass evidence, adds correction and dedupes exact identity',()=>{
  const first=set([candidate('a',['i1']),candidate('dup',['i1'],{evidenceIdentity:'same'})]);
  const correction=set([candidate('b',['i2']),candidate('dup2',['i2'],{evidenceIdentity:'same',channel:'DENSE'})]);
  const out=mergeCorrectiveCandidateSets(first,correction,{maxCandidates:16});
  assert.equal(out.candidateCount,3);assert.ok(out.candidates.some((x)=>x.candidateId==='a'));assert.ok(out.candidates.some((x)=>x.candidateId==='b'));
  const merged=out.candidates.find((x)=>x.evidenceIdentity==='same');assert.ok(merged.nominatedBy.length>=2);
});

test('LOW retrieval creates inspectable abstention receipt',()=>{
  const a=createRetrievalAbstentionReceipt({reason:'LOW_QUALITY',quality:'LOW',retrievalIntentIds:['i1'],missingIntents:['i1'],attemptedChannels:['HISTORIAN'],unavailableChannels:['GRAPH'],correctiveAttemptUsed:false,revisionFence:{sceneRevision:7}});
  assert.equal(a.kind,'RetrievalAbstentionReceipt');assert.equal(a.authorityGranted,false);assert.deepEqual(a.missingIntents,['i1']);
});

test('HIGH control proceeds immediately with zero corrections',async()=>{
  const controller=new AdaptiveRetrievalController();
  const out=await controller.run({query:'q',retrieve:async()=>set([candidate('a',['i1'])]),evaluate:async(r)=>evaluateCandidateSetQuality(r,{requiredIntents:['i1']})});
  assert.equal(out.action,'PROCEED');assert.equal(out.correctivePasses,0);assert.equal(out.abstention,null);
});

test('MIXED receives exactly one corrective pass and preserves first-pass evidence when corrected HIGH',async()=>{
  let corrections=0;
  const controller=new AdaptiveRetrievalController({maxCorrectiveAttempts:99,chooseCorrectiveAction:()=>CorrectiveRetrievalAction.ENTITY_CONSTRAINED_SEARCH});
  const out=await controller.run({
    query:'history',context:{turnId:'t',intentFingerprint:'fp',retrievalIntentIds:['i1','i2'],sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7},
    retrieve:async({attempt})=>{
      if(attempt===0)return set([candidate('a',['i1'])]);
      corrections++;return set([candidate('b',['i2'])]);
    },
    evaluate:async(r)=>evaluateCandidateSetQuality(r,{requiredIntents:['i1','i2']}),
  });
  assert.equal(corrections,1);assert.equal(out.correctivePasses,1);assert.equal(out.action,'PROCEED');
  assert.ok(out.result.candidates.some((x)=>x.candidateId==='a'));assert.ok(out.result.candidates.some((x)=>x.candidateId==='b'));
});

test('MIXED that remains inadequate after one correction abstains and never loops',async()=>{
  let corrections=0;
  const controller=new AdaptiveRetrievalController({maxCorrectiveAttempts:9});
  const out=await controller.run({
    query:'q',context:{turnId:'t',intentFingerprint:'fp',retrievalIntentIds:['i1','i2']},
    retrieve:async({attempt})=>{if(attempt)corrections++;return set([candidate('a'+attempt,['i1'])]);},
    evaluate:async(r)=>evaluateCandidateSetQuality(r,{requiredIntents:['i1','i2']}),
  });
  assert.equal(corrections,1);assert.equal(out.correctivePasses,1);assert.equal(out.action,'NO_LONG_TERM_MEMORY');
  assert.equal(out.abstention.correctiveAttemptUsed,true);
});

test('LOW retrieval abstains without spending corrective budget',async()=>{
  let calls=0;
  const controller=new AdaptiveRetrievalController();
  const out=await controller.run({query:'q',context:{retrievalIntentIds:['i1']},retrieve:async()=>{calls++;return set([]);},evaluate:async(r)=>evaluateCandidateSetQuality(r,{requiredIntents:['i1']})});
  assert.equal(calls,1);assert.equal(out.correctivePasses,0);assert.equal(out.action,'NO_LONG_TERM_MEMORY');assert.ok(out.abstention);
});

test('correction action selection maps missing entity to ENTITY_CONSTRAINED_SEARCH',async()=>{
  let action;
  const controller=new AdaptiveRetrievalController();
  const out=await controller.run({
    query:'q',context:{turnId:'t',intentFingerprint:'fp',retrievalIntentIds:['i1','i2']},
    retrieve:async({attempt,correctiveAction})=>{if(attempt)action=correctiveAction;return attempt?set([candidate('b',['i2'])]):set([candidate('a',['i1'])]);},
    evaluate:async(r,{attempt})=>attempt===0?evaluateRetrievalQuality({requiredIntents:['i1','i2'],candidates:r.candidates,confidence:.9,missingEntityRefs:['B']}):evaluateCandidateSetQuality(r,{requiredIntents:['i1','i2']}),
  });
  assert.equal(action,CorrectiveRetrievalAction.ENTITY_CONSTRAINED_SEARCH);assert.equal(out.action,'PROCEED');
});

test('precision corridor receives only HIGH retrieval after correction',async()=>{
  const calls=[];
  const gateway={run:async({candidateSet})=>{calls.push(candidateSet.candidateCount);return{results:candidateSet.candidates.map((x)=>({candidateRef:x.candidateId}))};}};
  const pipeline=new PrecisionRetrievalPipeline({precisionGateway:gateway});
  const out=await pipeline.run({
    query:'q',initialCandidateSet:set([candidate('a',['i1'])]),retrievalIntentIds:['i1','i2'],
    correctiveRetrieve:async()=>set([candidate('b',['i2'])]),
  });
  assert.equal(out.action,'PRECISION_COMPLETE');assert.equal(out.correctivePasses,1);assert.deepEqual(calls,[2]);assert.equal(out.authorityGranted,false);
});

test('precision corridor keeps LOW/MIXED-abstained retrieval out of Precision',async()=>{
  let precision=0;
  const pipeline=new PrecisionRetrievalPipeline({precisionGateway:{run:async()=>{precision++;return{};}}});
  const low=await pipeline.run({query:'q',initialCandidateSet:set([]),retrievalIntentIds:['i1']});
  assert.equal(low.action,'NO_LONG_TERM_MEMORY');assert.equal(precision,0);assert.ok(low.abstention);
});

test('legacy ratio evaluator remains compatible for accepted Wave 1-6 callers',()=>{
  const q=evaluateRetrievalQuality({candidateCount:4,relevantCount:4,confidence:.9,requiredCoverage:.75});
  assert.equal(q.quality,RetrievalQuality.HIGH);
  assert.equal(retrievalControlDecision({quality:q.quality}).action,'PROCEED');
});
