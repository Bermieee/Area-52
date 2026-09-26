import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CandidateAuthorityClass, CandidateTruthStatus, FailureCode, HistorianMemoryChannel, HistorianPerspectiveScope,
  createCandidateBusEnvelope, createHistorianCandidateSet, createHistorianMemoryRequest, createHistorianTask,
  evaluateHistorianFreshness, validateHistorianProviderOutput, validateHistorianResolverResponse,
} from '../src/coprocessor/index.js';

function t(extra={}) {
  return createHistorianTask({turnId:'t',correlationId:'c',retrievalIntentIds:['i1'],sourceRevisionSet:['s1'],worldRevision:1,sceneRevision:2,
    characterStateRevision:3,memoryRevisionRefs:['m1'],intentFingerprint:'fp',...extra});
}
function artifact(extra={}) {
  return {candidateId:extra.candidateId??'a',artifactRef:{kind:'ArtifactReference',artifactId:extra.artifactId??'a',artifactType:extra.artifactType??'SceneEpisode',
    owner:'MEMORY',revision:1,storageDomain:'memory',sourceRevisionSet:['s1'],worldRevision:1,sceneRevision:2},
    channel:extra.channel??HistorianMemoryChannel.SCENE_EPISODE,retrievalIntentIds:['i1'],authorityClass:extra.authorityClass??CandidateAuthorityClass.OBSERVED,
    truthStatusHint:extra.truthStatusHint??CandidateTruthStatus.HISTORICAL,sourceRevisionRefs:['s1'],evidenceRefs:['e1'],provenance:[{ref:'p1'}],
    perspective:extra.perspective??{scope:HistorianPerspectiveScope.WORLD},representationText:'x',rankSignals:{intentMatch:extra.intentMatch??1},
    ...extra};
}
function resolved(task, rows) {
  return validateHistorianResolverResponse({status:'OK',memoryRevisionRefs:['m1'],artifacts:rows},createHistorianMemoryRequest(task));
}

test('Reflection confidence cannot become SETTLED through Historian',()=>{
  const task=t();
  assert.throws(()=>resolved(task,[artifact({artifactType:'ReflectionArtifact',channel:HistorianMemoryChannel.REFLECTION,authorityClass:CandidateAuthorityClass.SETTLED})]),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
  const ok=resolved(task,[artifact({artifactType:'ReflectionArtifact',channel:HistorianMemoryChannel.REFLECTION,authorityClass:CandidateAuthorityClass.INFERRED})]);
  assert.equal(ok.artifacts[0].authorityClass,'INFERRED');
});

test('rank signals cannot change owner authority',()=>{
  const task=t();const row=artifact({authorityClass:CandidateAuthorityClass.UNRESOLVED,intentMatch:1});
  const set=createHistorianCandidateSet({task,sourceCandidates:[row],nominations:[{candidateId:'a',retrievalIntentIds:['i1'],rankSignals:{intentMatch:1,recency:1}}]});
  assert.equal(set.candidates[0].authorityClass,CandidateAuthorityClass.UNRESOLVED);assert.equal(set.candidates[0].authorityGranted,false);
});

test('repeated retrieval nominations do not multiply authority or canon',()=>{
  const base={candidateId:'a',evidenceIdentity:'same',channel:'HISTORIAN',sourceRevisionRefs:['s1'],rankSignals:{intentMatch:1},
    authorityClass:'UNRESOLVED',truthStatus:'HISTORICAL',freshness:'FRESH',provenance:[{ref:'p'}],evidenceRefs:['e']};
  const set=createCandidateBusEnvelope({candidateSetId:'x',sourceRevisionSet:['s1'],worldRevision:1,sceneRevision:2,candidates:[base,base,base]});
  assert.equal(set.candidateCount,1);assert.equal(set.candidates[0].duplicateCount,3);assert.equal(set.candidates[0].authorityClass,'UNRESOLVED');
  assert.equal(set.candidates[0].authorityGranted,false);
});

test('historical evidence cannot be promoted to CURRENT by provider output',()=>{
  const task=t();const r=resolved(task,[artifact({truthStatusHint:'HISTORICAL'})]);const input={resolution:r};const providerInput={data:{candidates:r.artifacts}};
  const out=validateHistorianProviderOutput({nominations:[{candidateId:'a',retrievalIntentIds:['i1'],rankSignals:{intentMatch:1}}],uncertainty:'LOW',reasoningSummary:'x'},{task,input,providerInput});
  assert.equal(out.candidateSet.candidates[0].truthStatus,'HISTORICAL');
  assert.throws(()=>validateHistorianProviderOutput({nominations:[{candidateId:'a',truthStatus:'CURRENT'}],uncertainty:'LOW',reasoningSummary:'x'},{task,input,providerInput}),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
});

test('competing causal hypotheses remain unresolved even when one ranks higher',()=>{
  const task=t();const rows=[
    artifact({candidateId:'h1',artifactId:'h1',channel:HistorianMemoryChannel.UNRESOLVED_HYPOTHESIS,truthStatusHint:'UNRESOLVED',intentMatch:.95}),
    artifact({candidateId:'h2',artifactId:'h2',channel:HistorianMemoryChannel.UNRESOLVED_HYPOTHESIS,truthStatusHint:'UNRESOLVED',intentMatch:.4}),
  ];
  const set=createHistorianCandidateSet({task,sourceCandidates:rows,nominations:rows.map((x)=>({candidateId:x.candidateId,retrievalIntentIds:['i1'],rankSignals:{intentMatch:x.rankSignals.intentMatch}}))});
  assert.equal(set.candidates.every((x)=>x.truthStatus==='UNRESOLVED'),true);assert.equal(set.candidates.every((x)=>x.authorityGranted===false),true);
});

test('character perspective request cannot invent knowledge metadata',()=>{
  const task=t({perspectiveConstraint:{scope:HistorianPerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'B'}});
  assert.throws(()=>resolved(task,[artifact({perspective:null})]),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
  assert.throws(()=>resolved(task,[artifact({perspective:{scope:'WORLD'}})]),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
});

test('Historian provider cannot request Memory mutation or truth authority',()=>{
  const task=t();const r=resolved(task,[artifact()]);const providerInput={data:{candidates:r.artifacts}};
  for(const patch of [{memoryMutation:true},{authorityGranted:true},{truthAuthorityGranted:true}]){
    assert.throws(()=>validateHistorianProviderOutput({nominations:[],uncertainty:'LOW',reasoningSummary:'x',...patch},{task,input:{resolution:r},providerInput}),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
  }
});

test('Historian has no Temporal State mutation or source deletion surface',()=>{
  const task=t();const req=createHistorianMemoryRequest(task);
  assert.equal(req.memoryMutation,false);assert.equal('temporalStateMutation' in req,false);assert.equal('sourceDeletion' in req,false);
});

test('sealed context is never bypassed by a high-ranked Historian result',()=>{
  const task=t();const payload={candidateSet:{candidates:[{artifactRef:artifact().artifactRef,rankSignals:{intentMatch:1}}]}};
  const r=evaluateHistorianFreshness(task,payload,{sourceRevisionSet:['s1'],worldRevision:1,sceneRevision:2,characterStateRevision:3,intentFingerprint:'fp',
    perspectiveConstraint:{scope:'WORLD'},memoryRevisionRefs:['m1'],memoryArtifactRevisions:{a:1},sealed:true});
  assert.equal(r.foregroundEligible,false);assert.equal(r.destination,'NEXT_TURN');assert.equal(r.authorityGranted,false);
});

test('provider identity and model confidence are never authority sources',()=>{
  const task=t();const row=artifact({authorityClass:'UNRESOLVED',intentMatch:1});
  const set=createHistorianCandidateSet({task,sourceCandidates:[row],nominations:[{candidateId:'a',retrievalIntentIds:['i1'],rankSignals:{intentMatch:1}}]});
  assert.equal(set.authorityGranted,false);assert.equal(set.admissionAuthority,false);assert.equal(set.candidates[0].authorityClass,'UNRESOLVED');
});

test('Historian cannot bypass Truth Gate merely because retrieval quality is HIGH',()=>{
  const task=t();const row=artifact({authorityClass:'OBSERVED',truthStatusHint:'HISTORICAL'});
  const set=createHistorianCandidateSet({task,sourceCandidates:[row],nominations:[{candidateId:'a',retrievalIntentIds:['i1'],rankSignals:{intentMatch:1}}]});
  assert.equal(set.candidates[0].truthStatus,'HISTORICAL');assert.equal(set.candidates[0].admissionAuthority,false);assert.equal(set.authorityGranted,false);
});
