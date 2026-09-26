import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  Capability, CapabilityProfileRegistry, CandidateAuthorityClass, CandidateTruthStatus,
  DeterministicProviderAdapter, DynamicFanOutPlanner, FailureCode, HistorianMemoryChannel,
  HistorianMemoryResolver, HistorianPerspectiveScope, HistorianRetrievalMode, HistorianRetrievalWorker,
  HistorianResolverStatus, Placement, ProviderAdapterRegistry, ResultClass, ResultDestination,
  SpecialistExecutionLayer, createHistorianMemoryRequest, createHistorianProviderInput,
  createHistorianTask, createTurnEnvelope, evaluateHistorianFreshness, historianUrgency,
  validateHistorianProviderOutput, validateHistorianResolverResponse,
} from '../src/coprocessor/index.js';

function artifact(id, revision=1, extra={}) {
  return {
    candidateId:id,
    artifactRef:{
      kind:'ArtifactReference',artifactId:id,artifactType:extra.artifactType??'SceneEpisode',
      owner:'MEMORY',revision,storageDomain:'memory',sourceRevisionSet:extra.sourceRevisionSet??['src:1'],
      worldRevision:5,sceneRevision:7,provenanceRef:'prov:'+id,
    },
    channel:extra.channel??HistorianMemoryChannel.SCENE_EPISODE,
    retrievalIntentIds:extra.retrievalIntentIds??['intent:history'],
    entityRefs:extra.entityRefs??['A','B'],
    relationshipRefs:extra.relationshipRefs??[],
    eventRefs:extra.eventRefs??['event:'+id],
    claimRefs:extra.claimRefs??[],
    temporalHints:extra.temporalHints??['HISTORICAL'],
    authorityClass:extra.authorityClass??CandidateAuthorityClass.OBSERVED,
    truthStatusHint:extra.truthStatusHint??CandidateTruthStatus.HISTORICAL,
    provenance:extra.provenance??[{ref:'prov:'+id}],
    evidenceRefs:extra.evidenceRefs??['e:'+id],
    sourceRevisionRefs:extra.sourceRevisionRefs??['src:1'],
    dependencyRevisions:extra.dependencyRevisions??['mem:7'],
    perspective:extra.perspective??{scope:HistorianPerspectiveScope.WORLD},
    representationText:extra.representationText??('episode '+id),
    rankSignals:extra.rankSignals??{intentMatch:.9,temporalFit:.9,recency:.1},
    sceneRelevance:extra.sceneRelevance??.6,
    semanticKey:extra.semanticKey??id,
  };
}

function task(overrides={}) {
  return createHistorianTask({
    turnId:'turn:hist',correlationId:'corr:hist',causationId:'send:hist',
    retrievalIntents:[{intentId:'intent:history',mode:HistorianRetrievalMode.EXPLICIT_HISTORY,query:'what happened last time?',required:true,entityRefs:['A','B']}],
    activeEntityIds:['A','B'],activeThreadIds:['promise'],locationRef:'loc:tavern',sceneRef:'scene:7',
    temporalConstraint:{historicalOnly:true},perspectiveConstraint:{scope:HistorianPerspectiveScope.WORLD},
    sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3,memoryRevisionRefs:['mem:7'],
    intentFingerprint:'intentfp:hist',...overrides,
  });
}

function resolution(t, artifacts=[artifact('episode:1')], extra={}) {
  return validateHistorianResolverResponse({
    status:HistorianResolverStatus.OK,artifacts,memoryRevisionRefs:['mem:7'],unavailableChannels:[],...extra,
  },createHistorianMemoryRequest(t));
}

function layer(handler, {workerId='slot:shared-cognition',providerId='fixture:cognition'}={}) {
  const profiles=new CapabilityProfileRegistry();
  profiles.register({
    profileId:'historian-profile',workerId,providerId,
    capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT,Capability.SEMANTIC_JUDGMENT,Capability.RERANK,Capability.REFLECTION],
    foregroundEligible:true,backgroundEligible:true,placements:[Placement.HOT],supportedLayers:['L1'],
  });
  const adapters=new ProviderAdapterRegistry();
  adapters.register(new DeterministicProviderAdapter({
    providerId,
    capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT,Capability.SEMANTIC_JUDGMENT,Capability.RERANK,Capability.REFLECTION],
    handlers:{HISTORIAN_RETRIEVAL:handler},
  }));
  return new SpecialistExecutionLayer({profiles,adapters});
}

test('Historian task is HOT/L1 capability-defined and carries retrieval/revision/perspective bounds',()=>{
  const t=task();
  assert.equal(t.taskType,'HISTORIAN_RETRIEVAL');assert.equal(t.placement,Placement.HOT);assert.equal(t.cognitiveLayer,'L1');
  assert.equal(t.resultClass,ResultClass.OPPORTUNISTIC);
  assert.deepEqual(t.requiredCapabilities,[Capability.RETRIEVAL,Capability.LONG_CONTEXT]);
  assert.deepEqual(t.metadata.retrievalIntentIds,['intent:history']);
  assert.equal(t.metadata.perspectiveConstraint.scope,HistorianPerspectiveScope.WORLD);
  assert.deepEqual(t.metadata.memoryRevisionRefs,['mem:7']);
  assert.equal(t.metadata.maxArtifacts,48);assert.equal(t.metadata.maxEvidenceBytes,65536);
  assert.equal(t.metadata.durableMutationAllowed,false);assert.equal(t.metadata.truthAuthorityGranted,false);
});

test('Historian Memory request is storage-neutral, reference-first and includes freshness fences',()=>{
  const req=createHistorianMemoryRequest(task());
  assert.equal(req.kind,'HistorianMemoryRequest');assert.equal(req.referenceFirst,true);
  assert.equal(req.memoryMutation,false);assert.equal(req.authorityGranted,false);
  assert.deepEqual(req.freshnessFence.sourceRevisionSet,['src:1']);assert.equal(req.freshnessFence.intentFingerprint,'intentfp:hist');
  assert.match(req.freshnessFence.perspectiveFingerprint,/WORLD/);
});

test('resolver normalizes revisioned ArtifactReferences and keeps historical evidence historical',()=>{
  const t=task();const out=resolution(t,[artifact('old-promise')]);
  assert.equal(out.status,'OK');assert.equal(out.artifacts[0].artifactRef.artifactId,'old-promise');
  assert.equal(out.artifacts[0].artifactRef.revision,1);assert.equal(out.artifacts[0].truthStatusHint,'HISTORICAL');
  assert.equal(out.authorityGranted,false);assert.equal(out.memoryMutation,false);
});

test('resolver rejects stale Memory revision fences',()=>{
  const t=task();const req=createHistorianMemoryRequest(t);
  assert.throws(()=>validateHistorianResolverResponse({status:'OK',artifacts:[],memoryRevisionRefs:['mem:8']},req),(e)=>e.code===FailureCode.STALE_RESULT);
});

test('character perspective refuses world-omniscient evidence rather than leaking it',()=>{
  const t=task({perspectiveConstraint:{scope:HistorianPerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'B'}});
  const req=createHistorianMemoryRequest(t);
  assert.throws(()=>validateHistorianResolverResponse({status:'OK',memoryRevisionRefs:['mem:7'],artifacts:[artifact('secret')]},req),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
});

test('character perspective accepts evidence explicitly fenced to the requested character',()=>{
  const t=task({perspectiveConstraint:{scope:HistorianPerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'B'}});
  const req=createHistorianMemoryRequest(t);
  const out=validateHistorianResolverResponse({status:'OK',memoryRevisionRefs:['mem:7'],artifacts:[
    artifact('b-memory',1,{perspective:{scope:HistorianPerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'B'}}),
  ]},req);
  assert.equal(out.artifacts[0].perspective.characterRef,'B');
});

test('PERSPECTIVE_UNAVAILABLE is a valid resolver result and does not fabricate omniscient evidence',()=>{
  const t=task({perspectiveConstraint:{scope:HistorianPerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'B'}});
  const req=createHistorianMemoryRequest(t);
  const out=validateHistorianResolverResponse({status:'PERSPECTIVE_UNAVAILABLE',memoryRevisionRefs:['mem:7'],artifacts:[],unavailableChannels:['CHARACTER_MEMORY']},req);
  assert.equal(out.status,HistorianResolverStatus.PERSPECTIVE_UNAVAILABLE);assert.equal(out.artifacts.length,0);
});

test('Reflection retrieval is permanently INFERRED and cannot arrive settled/source-canon',()=>{
  const t=task();
  const reflected=resolution(t,[artifact('reflection:1',1,{artifactType:'ReflectionArtifact',channel:HistorianMemoryChannel.REFLECTION,authorityClass:CandidateAuthorityClass.INFERRED})]);
  assert.equal(reflected.artifacts[0].authorityClass,CandidateAuthorityClass.INFERRED);
  assert.throws(()=>resolution(t,[artifact('reflection:bad',1,{artifactType:'ReflectionArtifact',channel:HistorianMemoryChannel.REFLECTION,authorityClass:CandidateAuthorityClass.SETTLED})]),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
});

test('Historian provider payload is bounded and does not include whole conversation/Memory/Lore',()=>{
  const t=task();const r=resolution(t,[artifact('episode:1'),artifact('episode:2')]);
  const payload=createHistorianProviderInput(t,{request:createHistorianMemoryRequest(t),resolution:r,conversation:'SECRET',memory:'SECRET',lorebook:'SECRET'});
  const encoded=JSON.stringify(payload);
  assert.equal(payload.minimumNecessary,true);assert.equal(payload.referenceFirst,true);
  assert.equal(payload.candidates.length,2);assert.doesNotMatch(encoded,/SECRET/);assert.ok(encoded.length<30000);
});

test('Historian provider may rank/select known refs but cannot rewrite temporal/authority metadata',()=>{
  const t=task();const r=resolution(t,[artifact('episode:1')]);const providerInput={data:createHistorianProviderInput(t,{resolution:r})};
  const out=validateHistorianProviderOutput({nominations:[{candidateId:'episode:1',retrievalIntentIds:['intent:history'],rankSignals:{intentMatch:.95,recency:.01}}],uncertainty:'LOW',reasoningSummary:'relevant'},
    {task:t,input:{resolution:r},providerInput});
  assert.equal(out.candidateSet.candidates[0].truthStatus,CandidateTruthStatus.HISTORICAL);
  assert.equal(out.candidateSet.candidates[0].authorityClass,CandidateAuthorityClass.OBSERVED);
  assert.throws(()=>validateHistorianProviderOutput({nominations:[{candidateId:'episode:1',truthStatus:'CURRENT'}],uncertainty:'LOW',reasoningSummary:'bad'},
    {task:t,input:{resolution:r},providerInput}),(e)=>e.code===FailureCode.AUTHORITY_VIOLATION);
});

test('unknown provider nominations fail closed',()=>{
  const t=task();const r=resolution(t,[artifact('episode:1')]);const providerInput={data:createHistorianProviderInput(t,{resolution:r})};
  assert.throws(()=>validateHistorianProviderOutput({nominations:[{candidateId:'missing'}],uncertainty:'LOW',reasoningSummary:'x'},
    {task:t,input:{resolution:r},providerInput}),(e)=>e.code===FailureCode.UNKNOWN_REFERENCE);
});

test('Candidate Bus-compatible Historian output retains intent, event, claim, perspective and dependency metadata',()=>{
  const t=task();const a=artifact('episode:rich',1,{relationshipRefs:['rel:A:B'],claimRefs:['claim:promise'],perspective:{scope:HistorianPerspectiveScope.WORLD}});
  const r=resolution(t,[a]);const providerInput={data:createHistorianProviderInput(t,{resolution:r})};
  const out=validateHistorianProviderOutput({nominations:[{candidateId:'episode:rich',retrievalIntentIds:['intent:history'],rankSignals:{intentMatch:.9}}],uncertainty:'LOW',reasoningSummary:'x'},
    {task:t,input:{resolution:r},providerInput});
  const c=out.candidateSet.candidates[0];
  assert.deepEqual(c.retrievalIntentIds,['intent:history']);assert.deepEqual(c.relationshipRefs,['rel:A:B']);
  assert.deepEqual(c.claimRefs,['claim:promise']);assert.deepEqual(c.dependencyRevisions,['mem:7']);assert.equal(c.perspective.scope,'WORLD');
  assert.equal(c.authorityGranted,false);assert.equal(c.admissionAuthority,false);
});

test('Historian freshness rejects source/world/scene/intent/perspective/Memory/artifact changes and turn supersession',()=>{
  const t=task();const a=artifact('episode:1');const r=resolution(t,[a]);
  const payload={candidateSet:{candidates:[{artifactRef:a.artifactRef}]}};
  const good={sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3,intentFingerprint:'intentfp:hist',
    perspectiveConstraint:{scope:'WORLD'},memoryRevisionRefs:['mem:7'],memoryArtifactRevisions:{'episode:1':1}};
  assert.equal(evaluateHistorianFreshness(t,payload,good).freshness,'FRESH');
  for(const patch of [
    {sourceRevisionSet:['src:new']},{worldRevision:6},{sceneRevision:8},{intentFingerprint:'different'},
    {perspectiveConstraint:{scope:'CHARACTER_KNOWLEDGE',characterRef:'B'}},{memoryRevisionRefs:['mem:8']},
    {memoryArtifactRevisions:{'episode:1':2}},{retiredArtifactIds:['episode:1']},{turnSuperseded:true},
  ]) assert.equal(evaluateHistorianFreshness(t,payload,{...good,...patch}).freshness,'STALE');
});

test('post-Seal Historian output routes NEXT_TURN and never mutates active generation',()=>{
  const t=task();const a=artifact('episode:1');const receipt=evaluateHistorianFreshness(t,{candidateSet:{candidates:[{artifactRef:a.artifactRef}]}},{
    sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3,intentFingerprint:'intentfp:hist',perspectiveConstraint:{scope:'WORLD'},
    memoryRevisionRefs:['mem:7'],memoryArtifactRevisions:{'episode:1':1},sealed:true,
  });
  assert.equal(receipt.destination,ResultDestination.NEXT_TURN);assert.equal(receipt.foregroundEligible,false);
});

test('real Historian worker executes through provider-neutral SpecialistExecutionLayer',async()=>{
  const t=task();const memoryResolver=new HistorianMemoryResolver({resolve:async()=>({status:'OK',memoryRevisionRefs:['mem:7'],artifacts:[artifact('episode:1')]})});
  const executionLayer=layer(({input})=>({payload:{nominations:input.data.candidates.map((c)=>({candidateId:c.candidateId,retrievalIntentIds:['intent:history'],rankSignals:{intentMatch:.95,recency:.05}})),uncertainty:'LOW',reasoningSummary:'history match'}}));
  const worker=new HistorianRetrievalWorker({executionLayer,memoryResolver});
  const out=await worker.run({task:t});
  assert.equal(out.status,'SUCCESS');assert.equal(out.candidateSet.candidateCount,1);assert.equal(out.destination,ResultDestination.FOREGROUND);
  assert.equal(out.workerResult.providerId,'fixture:cognition');assert.equal(out.authorityGranted,false);assert.equal(out.memoryMutation,false);
});

test('Memory provider outage degrades recall without fabricating evidence or stalling generation',async()=>{
  const worker=new HistorianRetrievalWorker({executionLayer:layer(()=>({payload:{nominations:[],uncertainty:'HIGH',reasoningSummary:'none'}})),
    memoryResolver:new HistorianMemoryResolver({resolve:async()=>{throw Object.assign(new Error('down'),{code:FailureCode.PROVIDER_UNAVAILABLE});}})});
  const out=await worker.run({task:task()});
  assert.equal(out.status,'DEGRADED');assert.equal(out.candidateSet,null);assert.equal(out.authorityGranted,false);
});

test('perspective-unavailable worker response abstains without invoking Historian provider',async()=>{
  let calls=0;
  const worker=new HistorianRetrievalWorker({executionLayer:layer(()=>{calls++;return{payload:{nominations:[]}};}),
    memoryResolver:new HistorianMemoryResolver({resolve:async()=>({status:'PERSPECTIVE_UNAVAILABLE',memoryRevisionRefs:['mem:7'],artifacts:[],unavailableChannels:['CHARACTER_MEMORY']})})});
  const out=await worker.run({task:task({perspectiveConstraint:{scope:'CHARACTER_KNOWLEDGE',characterRef:'B'}})});
  assert.equal(out.status,'ABSTAINED');assert.equal(calls,0);assert.equal(out.candidateSet.candidateCount,0);
});

test('dynamic Historian urgency supports REQUIRED, OPPORTUNISTIC and SKIPPED turns',()=>{
  assert.equal(historianUrgency({text:'What happened last time?',activeThreads:[]}).resultClass,ResultClass.REQUIRED);
  assert.equal(historianUrgency({text:'Where is the Blade?',queryIntent:'LOCATION',physical:true}).resultClass,ResultClass.OPPORTUNISTIC);
  assert.equal(historianUrgency({text:'Continue this thread with some texture.',activeThreads:['thread']}).resultClass,ResultClass.OPPORTUNISTIC);
  assert.equal(historianUrgency({text:'Thanks!',hotStateSufficient:true}).wake,false);
});

test('Fan-Out uses dynamic Historian class without assigning physical sidecar identity',()=>{
  const event=createTurnEnvelope({turnId:'fan:hist',eventId:'event:fan',correlationId:'corr:fan',dedupeKey:'fan',sourceRevisionSet:['src:1'],worldRevision:5,sceneRevision:7,characterStateRevision:3});
  const required=new DynamicFanOutPlanner().plan({turnEvent:event,text:'What happened last time?',queryIntent:'HISTORY'});
  const h=required.tasks.find((x)=>x.metadata.roleId==='historian');assert.ok(h);assert.equal(h.resultClass,ResultClass.REQUIRED);
  assert.equal('workerId' in h,false);assert.equal('providerId' in h,false);
  const optional=new DynamicFanOutPlanner().plan({turnEvent:event,text:'Where is the Blade?',queryIntent:'LOCATION'});
  assert.equal(optional.tasks.find((x)=>x.metadata.roleId==='historian').resultClass,ResultClass.OPPORTUNISTIC);
});

test('one physical execution resource may service logical Historian and other cognition identities',()=>{
  const sharedWorker='slot:shared-cognition';
  const execution=layer(()=>({payload:{refs:[],relevance:[],uncertainty:'LOW',reasoningSummary:'x'}}),{workerId:sharedWorker});
  assert.equal(execution.profiles.get('historian-profile').workerId,sharedWorker);
});

test('Wave 7 Historian production path is browser-safe',async()=>{
  for(const rel of ['../src/coprocessor/historian-retrieval.js','../src/coprocessor/retrieval-control-policy.js','../src/coprocessor/precision-retrieval-pipeline.js']){
    const source=await readFile(new URL(rel,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\bBuffer\b/);assert.doesNotMatch(source,/from\s+['"]node:/);assert.doesNotMatch(source,/\brequire\s*\(/);
    assert.doesNotMatch(source,/\bprocess\./);assert.doesNotMatch(source,/from\s+['"](?:fs|path|worker_threads|crypto)['"]/);
  }
});
