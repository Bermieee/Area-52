import test from 'node:test';
import assert from 'node:assert/strict';

import {Area52NativeBrain} from '../src/native-brain.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';
import {createMemoryIntegrationSurface} from '../src/memory-integration-surface.js';

function scene(id,revision,activeCast=['Mira']){
  return{sceneId:id,sceneRevision:revision,location:id,narrativeTime:'day '+revision,activeCast,activeThreads:[],objects:[],sourceRevisionRefs:[],provenance:['worker2:'+id+':'+revision]};
}

function embeddingExecutor(){
  let sequence=0;
  return async(request)=>{
    sequence+=1;
    const input=String(request.input??'').toLowerCase();
    const semantic=input.includes('astrolabe')||input.includes('celestial instrument')?[1,0,0]:[0,1,0];
    return{
      kind:'ResourceEmbeddingResult',status:'SUCCESS',requestPurpose:'COGNITIVE_EXECUTION',
      providerRequestId:'vector:req:'+sequence,providerId:'vector:fixture',actualModelId:'vector-fixture-v1',
      embeddings:[semantic],vectorCount:1,dimensions:3,latencyMs:2,measurementClass:'FIXTURE',
      usageReceipt:{measurementClass:'FIXTURE',cost:{status:'UNAVAILABLE'}},
    };
  };
}

test('Worker 2: selected generation sees post-turn exact evidence even when pre-generation source fence omits the assistant revision',async()=>{
  const memory=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(memory);
  const brain=new Area52NativeBrain({memoryInterface:surface});

  const prepared=await brain.prepareTurn({
    chatId:'chat:selection-fence',turnId:'selection-fence:A',generationId:'gen:selection-fence:A',
    query:'Continue.',intent:'CURRENT',scene:scene('fence-room',1),executionLabel:'DETERMINISTIC',
  });
  const learned=await brain.completeTurn({
    turnId:'selection-fence:A',response:'Mira places the brass astrolabe in the cedar cabinet.',knownBy:['Mira'],
  });
  assert.equal(learned.memoryPostTurn?.status,'COMPLETED');

  const selected=memory.readMemoryUi({...prepared.selection,sourceRevisionRefs:['source:known-before-generation@r1']});
  assert.equal(selected.health.state,'READY');
  assert.equal(selected.evidence.length,1);
  assert.equal(selected.episodes.length,1);
  assert.equal(selected.episodes[0].id,learned.memoryPostTurn.episodeId);
  assert.doesNotMatch(JSON.stringify(selected.health.reasons),/MEMORY_NO_EVIDENCE_FOR_SELECTED_GENERATION/);

  const otherChat=memory.readMemoryUi({chatId:'chat:other',turnId:'selection-fence:A',generationId:'gen:selection-fence:A'});
  assert.equal(otherChat.evidence.length,0);
  assert.equal(otherChat.episodes.length,0);
});

test('Worker 2: Turn A vectorizes durably, reload survives, and Turn B paraphrase recall enters existing Memory owner Candidate Bus',async()=>{
  let memory=new MemoryTemporalProducer();
  memory.attachVectorExecutor(embeddingExecutor());
  let surface=createMemoryIntegrationSurface(memory);
  let brain=new Area52NativeBrain({memoryInterface:surface});

  await brain.prepareTurn({
    chatId:'chat:dense-loop',turnId:'dense-loop:A',generationId:'gen:dense-loop:A',
    query:'Continue.',intent:'CURRENT',scene:scene('observatory',1),executionLabel:'DETERMINISTIC',
  });
  const learned=await brain.completeTurn({
    turnId:'dense-loop:A',response:'Mira leaves the brass astrolabe inside the cedar cabinet beneath the western window.',knownBy:['Mira'],
  });
  assert.equal(learned.memoryPostTurn?.status,'COMPLETED');
  assert.ok(learned.memoryPostTurn?.vectorWorkId);

  const maintenance=await memory.runVectorMaintenance({maxUnits:1});
  assert.equal(maintenance.status,'COMPLETED');
  assert.equal(maintenance.outcomes[0].status,'ACCEPTED');
  assert.equal(maintenance.outcomes[0].requestPurpose,'COGNITIVE_EXECUTION');
  assert.match(maintenance.outcomes[0].providerRequestId,/^vector:req:/);
  assert.equal(maintenance.outcomes[0].ownerDecision,'ACCEPTED');
  assert.equal(maintenance.outcomes[0].rawPayloadRetained,false);

  const brainSnapshot=brain.snapshot(),memorySnapshot=memory.snapshot();
  memory=MemoryTemporalProducer.fromSnapshot(memorySnapshot);
  memory.attachVectorExecutor(embeddingExecutor());
  surface=createMemoryIntegrationSurface(memory);
  brain=Area52NativeBrain.fromSnapshot(brainSnapshot,{memoryInterface:surface});

  const preparedB=await brain.prepareTurn({
    chatId:'chat:dense-loop',turnId:'dense-loop:B',generationId:'gen:dense-loop:B',
    query:'Where is the celestial instrument?',intent:'HISTORICAL',
    scene:scene('observatory-return',2),executionLabel:'DETERMINISTIC',
  });
  assert.equal(preparedB.memoryDensePrime?.status,'READY');
  assert.equal(preparedB.memoryDensePrime?.requestPurpose,'COGNITIVE_EXECUTION');
  assert.match(preparedB.memoryDensePrime?.providerRequestId,/^vector:req:/);
  assert.equal(preparedB.memorySync?.densePrime?.status,'READY');

  const memoryCandidates=(preparedB.candidateEnvelope?.candidates??[]).filter(candidate=>(candidate.channelNominations??[]).some(row=>row.channelId==='OWNER_MEMORY'));
  assert.ok(memoryCandidates.length>=1);
  assert.match(JSON.stringify(memoryCandidates),/brass astrolabe/i);
  assert.match(JSON.stringify(memoryCandidates),/denseExecution/i);
  assert.ok(preparedB.gatherReceipt);
  assert.ok(preparedB.contextSealReceipt?.sealedState);
  assert.match(JSON.stringify(preparedB.promptPlan),/brass astrolabe/i);
});

test('Worker 2: vector unavailable is truthful and a late stale vector is rejected without disabling sparse Memory',async()=>{
  const memory=new MemoryTemporalProducer();
  const ev=memory.appendEvidence({
    id:'vector-late:e1',sourceId:'vector-late:s1',sourceRevisionId:'vector-late:s1@r1',
    exactContent:'Tarin stores the amber seal under the eastern desk.',kind:'EXPERIENCE',occurredAt:1,worldRevision:1,sceneRevision:1,
    participants:['Tarin'],knownBy:['Tarin'],metadata:{chatId:'chat:vector-late',turnId:'vector-late:1',generationId:'gen:vector-late:1'},provenance:['worker2'],
  });
  const episode=memory.publishEpisode({
    logicalId:'vector-late:episode',chatId:'chat:vector-late',turnId:'vector-late:1',generationId:'gen:vector-late:1',
    sceneId:'desk',sceneRevision:1,sourceRevisionRefs:[ev.sourceRevisionId],evidenceRefs:[ev.id],summary:ev.exactContent,provenance:['worker2'],
  });
  memory.rebuildHistorian();
  const record=[...memory.historian.records.values()].find(row=>row.artifactId===episode.id);
  memory.vectorIndex.enqueueArtifact({artifactId:episode.id,artifactRevision:episode.revision,chatId:episode.chatId,sourceRevisionRefs:episode.sourceRevisionRefs,historianRecordRef:record.id});

  memory.attachVectorExecutor(null);
  const unavailable=await memory.runVectorMaintenance({maxUnits:1});
  assert.equal(unavailable.status,'UNAVAILABLE');
  assert.equal(unavailable.outcomes[0].reasonCode,'VECTOR_PROVIDER_UNAVAILABLE');
  const sparse=memory.queryHistorian({query:'amber seal eastern desk',selection:{chatId:'chat:vector-late'}});
  assert.ok(sparse.nominations.length>=1);
  assert.equal(sparse.diagnostics.denseExecution,'NOT_PRIMED');

  let resolveExecution;
  memory.attachVectorExecutor(()=>new Promise(resolve=>{resolveExecution=resolve;}));
  const pending=memory.runVectorMaintenance({maxUnits:1});
  await Promise.resolve();
  memory.invalidateSourceRevision(ev.sourceRevisionId,{reason:'STALE_EDIT'});
  resolveExecution({
    requestPurpose:'COGNITIVE_EXECUTION',providerRequestId:'vector:req:late',providerId:'vector:fixture',actualModelId:'vector-fixture-v1',
    embeddings:[[1,0,0]],latencyMs:25,measurementClass:'FIXTURE',
  });
  const late=await pending;
  assert.equal(late.outcomes[0].status,'REJECTED_LATE');
  assert.equal(late.outcomes[0].ownerDecision,'REJECTED');
  assert.equal(memory.graph.evidenceRecord(ev.id).freshness,'STALE');
});

test('Worker 2: retrieval use enables bounded plasticity but adds no support or authority, and only rebuildable derived state can be evicted',()=>{
  const memory=new MemoryTemporalProducer();
  const evidence=[];
  for(const [index,text] of [[1,'Nara checks the tide compass.'],[2,'Nara checks the tide compass again.'],[3,'Nara deliberately skips the tide compass.']]){
    evidence.push(memory.appendEvidence({
      id:'plasticity:e'+index,sourceId:'plasticity:s'+index,sourceRevisionId:'plasticity:s'+index+'@r1',
      exactContent:text,kind:'EXPERIENCE',occurredAt:index,worldRevision:index,sceneRevision:index,participants:['Nara'],knownBy:['Nara'],
      metadata:{chatId:'chat:plasticity',turnId:'plasticity:'+index,generationId:'gen:plasticity:'+index},provenance:['worker2'],
    }));
  }
  const artifact={id:'derived:nara:tide',revision:1,artifactType:'REFLECTION',authorityClass:'INFERRED',
    supportEvidenceRefs:[evidence[0].id,evidence[1].id],contradictionEvidenceRefs:[],sourceRevisionRefs:[evidence[0].sourceRevisionId,evidence[1].sourceRevisionId]};
  memory.plasticity.observeArtifact(artifact);
  const use=memory.recordRetrievalUse({artifactId:artifact.id,artifactRevision:1,accepted:true});
  assert.equal(use.supportAdded,false);
  assert.equal(use.authorityChanged,false);
  const strengthened=memory.runReconsolidation({maxUnits:1}).outcomes[0];
  assert.equal(strengthened.independentSupportCount,2);
  assert.equal(strengthened.authorityChanged,false);
  assert.equal(strengthened.retrievalUseCreatedSupport,false);
  const strongValue=strengthened.strength;

  memory.plasticity.observeArtifact({...artifact,contradictionEvidenceRefs:[evidence[2].id],sourceRevisionRefs:evidence.map(row=>row.sourceRevisionId)});
  memory.recordRetrievalUse({artifactId:artifact.id,artifactRevision:1,rejected:true});
  const weakened=memory.runReconsolidation({maxUnits:1}).outcomes[0];
  assert.ok(weakened.strength<strongValue);
  assert.equal(memory.plasticity.record(artifact.id).authorityClass,'INFERRED');

  const disposable={id:'derived:disposable',revision:1,artifactType:'SUMMARY',authorityClass:'DERIVED',supportEvidenceRefs:[],sourceRevisionRefs:[]};
  memory.plasticity.observeArtifact(disposable);
  for(let i=0;i<5;i++)memory.recordRetrievalUse({artifactId:disposable.id,artifactRevision:1,rejected:true});
  memory.runReconsolidation({maxUnits:4});
  assert.equal(memory.plasticity.record(disposable.id).residency,'EVICTED');
  assert.equal(memory.graph.evidenceRecord(evidence[0].id).exactContent,'Nara checks the tide compass.');
});

test('Worker 2: events keep temporal order separate from unresolved competing causal hypotheses and correction invalidates only dependents',()=>{
  const memory=new MemoryTemporalProducer();
  const first=memory.appendEvidence({
    id:'causal:e1',sourceId:'causal:s1',sourceRevisionId:'causal:s1@r1',exactContent:'The bridge alarm sounds before the gate closes.',kind:'EXPERIENCE',
    occurredAt:1,worldRevision:1,sceneRevision:1,participants:['Ari'],knownBy:['Ari'],metadata:{chatId:'chat:causal',turnId:'causal:1',generationId:'gen:causal:1'},provenance:['worker2'],
  });
  const second=memory.appendEvidence({
    id:'causal:e2',sourceId:'causal:s2',sourceRevisionId:'causal:s2@r1',exactContent:'The gate closes after the alarm.',kind:'EXPERIENCE',
    occurredAt:2,worldRevision:2,sceneRevision:2,participants:['Ari'],knownBy:['Ari'],metadata:{chatId:'chat:causal',turnId:'causal:2',generationId:'gen:causal:2'},provenance:['worker2'],
  });
  const alarm=memory.recordEventMemory({eventId:'event:alarm',description:'The bridge alarm sounds.',evidenceRefs:[first.id],entityRefs:['bridge-alarm'],perspective:{scope:'CHARACTER_KNOWLEDGE',characterRef:'Ari'}});
  const gate=memory.recordEventMemory({eventId:'event:gate',description:'The gate closes.',evidenceRefs:[second.id],entityRefs:['gate'],temporalOrderRefs:[{relation:'FOLLOWS',eventRef:alarm.eventId}]});
  assert.equal(gate.temporalOrderRefs[0].relation,'FOLLOWS');
  assert.equal(gate.causalClaim,false);

  const h1=memory.recordCausalHypothesis({hypothesisId:'hyp:alarm-triggered-gate',hypothesisSetId:'why:gate',causeEventRefs:[alarm.eventId],effectEventRef:gate.eventId,
    statement:'The alarm may have triggered the gate closure.',supportEvidenceRefs:[first.id,second.id],confidence:.99,perspective:{scope:'CHARACTER_KNOWLEDGE',characterRef:'Ari'}});
  const h2=memory.recordCausalHypothesis({hypothesisId:'hyp:operator-triggered-gate',hypothesisSetId:'why:gate',causeEventRefs:['event:operator'],effectEventRef:gate.eventId,
    statement:'An operator may have independently triggered the gate closure.',supportEvidenceRefs:[second.id],confidence:.92,perspective:{scope:'CHARACTER_KNOWLEDGE',characterRef:'Ari'}});
  assert.equal(h1.status,'UNRESOLVED');
  assert.equal(h2.status,'UNRESOLVED');
  assert.equal(h1.confidenceGrantsCanon,false);
  assert.equal(h2.repetitionGrantsCanon,false);

  const query=memory.queryHistorian({query:'why did the gate close',mode:'EVENT_CAUSAL_RECALL',selection:{chatId:'chat:causal'},maxCandidates:12});
  const hypotheses=query.nominations.filter(row=>row.metadata?.historianChannel==='UNRESOLVED_HYPOTHESIS');
  assert.equal(hypotheses.length,2);
  assert.ok(hypotheses.every(row=>row.truthStatusHint==='UNRESOLVED'));
  assert.ok(memory.drillDown(hypotheses[0],{selection:{chatId:'chat:causal'}}).length>=1);

  const invalidation=memory.invalidateSourceRevision(first.sourceRevisionId,{reason:'CORRECTION'});
  assert.ok(invalidation.causalAffectedEventIds.includes(alarm.id));
  assert.ok(invalidation.causalAffectedHypothesisIds.includes(h1.id));
  assert.ok(!invalidation.causalAffectedEventIds.includes(gate.id));
  assert.equal(memory.causalEvents.events.get(gate.id).freshness,'FRESH');
});
