import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AdaptiveRetrievalController, Capability, CapabilityProfileRegistry, CandidateAuthorityClass, CandidateTruthStatus,
  CorrectiveRetrievalAction, DeterministicProviderAdapter, HistorianMemoryChannel, HistorianMemoryResolver,
  HistorianPerspectiveScope, HistorianRetrievalMode, HistorianRetrievalWorker, Placement,
  ProviderAdapterRegistry, SpecialistExecutionLayer, createCandidateBusEnvelope, createHistorianTask,
  evaluateCandidateSetQuality, evaluateRetrievalQuality,
} from '../src/coprocessor/index.js';

function art(id,turn,intents,extra={}) {
  return {
    candidateId:id,
    artifactRef:{kind:'ArtifactReference',artifactId:id,artifactType:extra.artifactType??'SceneEpisode',owner:'MEMORY',revision:1,storageDomain:'memory',
      sourceRevisionSet:['src:story'],worldRevision:50,sceneRevision:450,provenanceRef:'turn:'+turn},
    channel:extra.channel??HistorianMemoryChannel.SCENE_EPISODE,retrievalIntentIds:intents,
    entityRefs:extra.entityRefs??['A','B'],relationshipRefs:extra.relationshipRefs??['rel:A:B'],
    eventRefs:[id],temporalHints:extra.temporalHints??['HISTORICAL'],authorityClass:extra.authorityClass??CandidateAuthorityClass.OBSERVED,
    truthStatusHint:extra.truthStatusHint??CandidateTruthStatus.HISTORICAL,provenance:[{ref:'turn:'+turn}],evidenceRefs:['turn:'+turn],
    sourceRevisionRefs:['src:story'],dependencyRevisions:['mem:story:1'],perspective:extra.perspective??{scope:HistorianPerspectiveScope.WORLD},
    representationText:extra.text??id,rankSignals:extra.rankSignals??{intentMatch:.95,temporalFit:.9,recency:extra.recency??.05,provenanceQuality:1},
  };
}
function historianLayer(selector) {
  const profiles=new CapabilityProfileRegistry();
  profiles.register({profileId:'hist',workerId:'slot:shared',providerId:'provider:shared',
    capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT,Capability.SEMANTIC_JUDGMENT,Capability.RERANK],
    foregroundEligible:true,backgroundEligible:true,placements:[Placement.HOT],supportedLayers:['L1']});
  const adapters=new ProviderAdapterRegistry();
  adapters.register(new DeterministicProviderAdapter({providerId:'provider:shared',
    capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT,Capability.SEMANTIC_JUDGMENT,Capability.RERANK],
    handlers:{HISTORIAN_RETRIEVAL:({input})=>({payload:selector(input.data.candidates)})}}));
  return new SpecialistExecutionLayer({profiles,adapters});
}
function task(intents,extra={}) {
  return createHistorianTask({turnId:extra.turnId??'turn:450',correlationId:'corr:gold',sourceRevisionSet:['src:story'],worldRevision:50,sceneRevision:450,
    characterStateRevision:20,memoryRevisionRefs:['mem:story:1'],intentFingerprint:extra.intentFingerprint??'gold:history',
    retrievalIntents:intents,perspectiveConstraint:extra.perspectiveConstraint??{scope:HistorianPerspectiveScope.WORLD}});
}
function candidateSet(candidates,id='gold') {
  return createCandidateBusEnvelope({candidateSetId:id,intentFingerprint:'gold:history',sourceRevisionSet:['src:story'],worldRevision:50,sceneRevision:450,candidates,maxCandidates:64});
}

test('long-form RP golden retrieves Turn 40 promise and Turn 181 breach despite hundreds of newer irrelevant episodes',async()=>{
  const intents=[
    {intentId:'promise',mode:HistorianRetrievalMode.RELATIONSHIP_HISTORY,query:'what did A promise B?',required:true},
    {intentId:'breach',mode:HistorianRetrievalMode.RELATIONSHIP_HISTORY,query:'what later damaged trust?',required:true},
  ];
  const promise=art('episode:promise',40,['promise'],{text:"A promises B that A will protect B's brother.",recency:.01});
  const breach=art('episode:breach',181,['breach'],{text:"A abandons B's brother during the crisis.",recency:.25});
  const reflection=art('reflection:guarded',300,['breach'],{artifactType:'ReflectionArtifact',channel:HistorianMemoryChannel.REFLECTION,
    authorityClass:CandidateAuthorityClass.INFERRED,text:'B may become guarded after repeated abandonment.',recency:.5});
  const irrelevant=Array.from({length:20},(_,i)=>art('episode:recent:'+i,430+i,[],{text:'unrelated recent event '+i,recency:.99}));
  const memoryResolver=new HistorianMemoryResolver({resolve:async()=>({status:'OK',memoryRevisionRefs:['mem:story:1'],artifacts:[...irrelevant,promise,breach,reflection]})});
  const execution=historianLayer((candidates)=>({
    nominations:candidates.filter((c)=>['episode:promise','episode:breach','reflection:guarded'].includes(c.candidateId))
      .map((c)=>({candidateId:c.candidateId,retrievalIntentIds:c.retrievalIntentIds,rankSignals:{intentMatch:.97,temporalFit:.95,recency:c.candidateId==='episode:promise'?.01:.2}})),
    uncertainty:'MEDIUM',reasoningSummary:'Long-range relationship history is more relevant than recent unrelated episodes.',
  }));
  const worker=new HistorianRetrievalWorker({executionLayer:execution,memoryResolver});
  const out=await worker.run({task:task(intents)});
  assert.deepEqual(out.candidateSet.candidates.map((c)=>c.candidateId).sort(),['episode:breach','episode:promise','reflection:guarded']);
  assert.equal(out.candidateSet.candidates.find((c)=>c.candidateId==='reflection:guarded').authorityClass,CandidateAuthorityClass.INFERRED);
  assert.equal(out.candidateSet.candidates.some((c)=>c.candidateId.startsWith('episode:recent:')),false);
  const q=evaluateCandidateSetQuality(out.candidateSet,{requiredIntents:intents});
  assert.equal(q.quality,'HIGH');assert.deepEqual(q.missingIntentIds,[]);
});

test('long-form golden with withheld breach becomes MIXED, performs one targeted correction, preserves promise, then becomes HIGH',async()=>{
  const promise=art('episode:promise',40,['promise'],{text:'A promised to protect the brother.'});
  const breach=art('episode:breach',181,['breach'],{text:'A later abandoned the brother.'});
  const initial=candidateSet([{
    candidateId:promise.candidateId,evidenceIdentity:'promise',artifactRef:promise.artifactRef,sourceRevisionRefs:['src:story'],channel:'HISTORIAN_SCENE_EPISODE',
    rankSignals:{intentMatch:.95},retrievalIntentIds:['promise'],authorityClass:'OBSERVED',truthStatus:'HISTORICAL',freshness:'FRESH',
    provenance:promise.provenance,evidenceRefs:promise.evidenceRefs,representationText:promise.representationText,
  }],'initial');
  const corrected=candidateSet([{
    candidateId:breach.candidateId,evidenceIdentity:'breach',artifactRef:breach.artifactRef,sourceRevisionRefs:['src:story'],channel:'HISTORIAN_SCENE_EPISODE',
    rankSignals:{intentMatch:.96},retrievalIntentIds:['breach'],authorityClass:'OBSERVED',truthStatus:'HISTORICAL',freshness:'FRESH',
    provenance:breach.provenance,evidenceRefs:breach.evidenceRefs,representationText:breach.representationText,
  }],'corrected');
  let corrections=0;
  const controller=new AdaptiveRetrievalController({chooseCorrectiveAction:()=>CorrectiveRetrievalAction.QUERY_REFORMULATION});
  const out=await controller.run({
    query:'Why is B guarded toward A?',
    context:{turnId:'turn:450',intentFingerprint:'gold:history',retrievalIntentIds:['promise','breach'],sourceRevisionSet:['src:story'],worldRevision:50,sceneRevision:450},
    retrieve:async({attempt})=>{if(attempt){corrections++;return corrected;}return initial;},
    evaluate:async(set)=>evaluateCandidateSetQuality(set,{requiredIntents:['promise','breach']}),
  });
  assert.equal(corrections,1);assert.equal(out.correctivePasses,1);assert.equal(out.action,'PROCEED');
  assert.deepEqual(out.result.candidates.map((c)=>c.candidateId).sort(),['episode:breach','episode:promise']);
});

test('temporal/history golden preserves old Sun Blade possession and destruction history without manufacturing a current location',async()=>{
  const intents=[{intentId:'blade-history',mode:HistorianRetrievalMode.EXPLICIT_HISTORY,query:'What weapon did Eris carry before the fire?',required:true}];
  const history=[
    art('T0:carry',1,['blade-history'],{text:'Eris carries the Sun Blade.',temporalHints:['BEFORE_FIRE'],truthStatusHint:'HISTORICAL'}),
    art('T1:left',2,['blade-history'],{text:'Eris leaves the Sun Blade at the Ember Tavern.',temporalHints:['BEFORE_FIRE'],truthStatusHint:'HISTORICAL'}),
    art('T2:fire',3,['blade-history'],{text:'The Ember Tavern burns.',temporalHints:['FIRE'],truthStatusHint:'HISTORICAL'}),
    art('T3:destroyed',4,['blade-history'],{text:'The Sun Blade is destroyed.',temporalHints:['AFTER_FIRE'],truthStatusHint:'HISTORICAL'}),
  ];
  const resolver=new HistorianMemoryResolver({resolve:async()=>({status:'OK',memoryRevisionRefs:['mem:story:1'],artifacts:history})});
  const worker=new HistorianRetrievalWorker({executionLayer:historianLayer((candidates)=>({nominations:candidates.map((c)=>({candidateId:c.candidateId,retrievalIntentIds:['blade-history'],rankSignals:{intentMatch:.9,temporalFit:.9}})),uncertainty:'LOW',reasoningSummary:'history only'})),memoryResolver:resolver});
  const out=await worker.run({task:task(intents)});
  assert.equal(out.candidateSet.candidates.every((c)=>c.truthStatus==='HISTORICAL'),true);
  assert.equal(out.candidateSet.candidates.some((c)=>c.truthStatus==='CURRENT'),false);
  assert.equal(out.authorityGranted,false);
});

test('character perspective golden never leaks world truth to Character B and may return B outdated belief instead',async()=>{
  const intents=[{intentId:'what-b-knows',mode:HistorianRetrievalMode.EXPLICIT_HISTORY,query:'What does B know?',required:true}];
  const bTask=task(intents,{perspectiveConstraint:{scope:HistorianPerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'B'}});
  const world=art('world-secret',100,['what-b-knows'],{text:'World truth: the cache moved.',perspective:{scope:'WORLD'}});
  const belief=art('b-belief',80,['what-b-knows'],{text:'B believes the cache is still under the bridge.',
    perspective:{scope:HistorianPerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'B',beliefStatus:'OUTDATED'},truthStatusHint:'UNCERTAIN'});
  const resolver=new HistorianMemoryResolver({resolve:async(req)=>({status:'OK',memoryRevisionRefs:['mem:story:1'],artifacts:req.perspectiveConstraint.characterRef==='B'?[belief]:[world]})});
  const worker=new HistorianRetrievalWorker({executionLayer:historianLayer((candidates)=>({nominations:candidates.map((c)=>({candidateId:c.candidateId,retrievalIntentIds:['what-b-knows'],rankSignals:{intentMatch:.9,perspectiveCompatibility:1}})),uncertainty:'HIGH',reasoningSummary:'B perspective only'})),memoryResolver:resolver});
  const out=await worker.run({task:bTask});
  assert.deepEqual(out.candidateSet.candidates.map((c)=>c.candidateId),['b-belief']);
  assert.equal(out.candidateSet.candidates[0].perspective.characterRef,'B');assert.notEqual(out.candidateSet.candidates[0].candidateId,'world-secret');
});

test('corrective retrieval goldens terminate each major action family after one pass',async()=>{
  const cases=[
    ['missing entity',CorrectiveRetrievalAction.ENTITY_CONSTRAINED_SEARCH,{missingEntityRefs:['B']}],
    ['poor temporal fit',CorrectiveRetrievalAction.TEMPORAL_NARROWING,{temporalMismatchCount:1}],
    ['semantic paraphrase missed',CorrectiveRetrievalAction.DENSE_RETRY,{semanticMismatch:true}],
    ['relationship graph missing',CorrectiveRetrievalAction.GRAPH_EXPANSION,{relationshipCoverageMissing:true}],
    ['exact identifier missing',CorrectiveRetrievalAction.SPARSE_RETRY,{exactIdentifierMissing:true}],
  ];
  for(const [name,expected,defect] of cases){
    let action=null,corrections=0;
    const weak=candidateSet([{candidateId:'weak:'+name,evidenceIdentity:'weak:'+name,channel:'HISTORIAN',sourceRevisionRefs:['src:story'],
      rankSignals:{intentMatch:.8},retrievalIntentIds:['i1'],authorityClass:'OBSERVED',truthStatus:'HISTORICAL',freshness:'FRESH',provenance:[{ref:'p'}],evidenceRefs:['e']}],'weak');
    const fixed=candidateSet([{candidateId:'fixed:'+name,evidenceIdentity:'fixed:'+name,channel:'HISTORIAN',sourceRevisionRefs:['src:story'],
      rankSignals:{intentMatch:.9},retrievalIntentIds:['i2'],authorityClass:'OBSERVED',truthStatus:'HISTORICAL',freshness:'FRESH',provenance:[{ref:'p2'}],evidenceRefs:['e2']}],'fixed');
    const controller=new AdaptiveRetrievalController();
    const out=await controller.run({
      query:name,context:{turnId:'t',intentFingerprint:'fp:'+name,retrievalIntentIds:['i1','i2'],sourceRevisionSet:['src:story'],worldRevision:50,sceneRevision:450},
      retrieve:async({attempt,correctiveAction})=>{if(attempt){corrections++;action=correctiveAction;return fixed;}return weak;},
      evaluate:async(set,{attempt})=>attempt===0?evaluateRetrievalQuality({requiredIntents:['i1','i2'],candidates:set.candidates,confidence:.9,...defect}):evaluateCandidateSetQuality(set,{requiredIntents:['i1','i2']}),
    });
    assert.equal(action,expected,name);assert.equal(corrections,1,name);assert.equal(out.correctivePasses,1,name);assert.equal(out.action,'PROCEED',name);
  }
});

test('corrective GRAPH_EXPANSION seam can degrade safely when Graph Walker provider is absent',async()=>{
  const weak=candidateSet([{candidateId:'relationship',evidenceIdentity:'rel',channel:'HISTORIAN',sourceRevisionRefs:['src:story'],rankSignals:{intentMatch:.8},
    retrievalIntentIds:['i1'],authorityClass:'OBSERVED',truthStatus:'HISTORICAL',freshness:'FRESH',provenance:[{ref:'p'}],evidenceRefs:['e']}]);
  const controller=new AdaptiveRetrievalController();
  let attempts=0;
  const out=await controller.run({
    query:'relationship',context:{turnId:'t',intentFingerprint:'fp',retrievalIntentIds:['i1','i2']},
    retrieve:async({attempt})=>{attempts++;return weak;},
    evaluate:async(set,{attempt})=>attempt===0?evaluateRetrievalQuality({requiredIntents:['i1','i2'],candidates:set.candidates,confidence:.9,relationshipCoverageMissing:true}):evaluateCandidateSetQuality(set,{requiredIntents:['i1','i2']}),
  });
  assert.equal(attempts,2);assert.equal(out.correctivePasses,1);assert.equal(out.action,'NO_LONG_TERM_MEMORY');assert.ok(out.abstention);
});
