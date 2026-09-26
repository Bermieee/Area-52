import test from 'node:test';
import assert from 'node:assert/strict';
import {Area52NativeBrain} from '../src/native-brain.js';

function scene(sceneId,sceneRevision,{location='Neutral Annex',activeCast=[],objects=[],relationship='CONTINUES'}={}){
  return{
    sceneId,sceneRevision,location,narrativeTime:'tick '+sceneRevision,activeCast,activeThreads:[],objects,
    sceneRelationship:relationship,sourceRevisionRefs:[],provenance:['worker1:sensory-hot:'+sceneId+':'+sceneRevision],
  };
}
function channel(manifest,id){return manifest.channels.find(row=>row.channelId===id);}
function candidateForClaim(envelope,claimId){return (envelope?.candidates??[]).find(row=>(row.claimRefs??[]).includes(claimId));}

test('DETERMINISTIC: #6 capability manifest is truthful and every unavailable optional channel names a fallback or skip reason',()=>{
  const brain=new Area52NativeBrain(),manifest=brain.core.sensoryManifest();
  for(const id of ['DENSE_EMBEDDINGS','LATE_INTERACTION','HIERARCHY_RAPTOR','GRAPHRAG_COMMUNITY']){
    const row=channel(manifest,id);
    assert.ok(row,'missing declared channel '+id);
    assert.equal(row.available,false);
    assert.equal(row.health,'UNAVAILABLE');
    assert.equal(row.metadata?.executionState,'UNAVAILABLE');
    assert.ok(row.metadata?.unavailableReason);
    assert.ok((row.metadata?.fallbackChannelIds??[]).length>0);
  }
  const legacy=channel(manifest,'CORE_DENSE');
  assert.ok(legacy);
  assert.equal(legacy.metadata?.providesDenseEmbeddings,false);
  assert.ok(legacy.metadata?.fallbackFor==='DENSE');
  assert.equal((legacy.capabilities??[]).includes('DENSE'),false);
});

test('DETERMINISTIC: #6 source, identity and temporal lineage survives nomination through Truth, Precision and Cognitive Choice',async()=>{
  const brain=new Area52NativeBrain();
  brain.registerEntityIdentity({entityId:'entity:neutral:beacon',canonicalLabel:'Neutral Beacon',entityType:'OBJECT',worldId:'world:neutral'});
  const identityRef=brain.identityReferences(['entity:neutral:beacon']).references[0].revisionRef;

  await brain.prepareTurn({
    chatId:'chat:lineage',turnId:'lineage:1',generationId:'gen:lineage:1',query:'Observe the neutral beacon.',
    scene:scene('neutral-annex',1,{objects:[{entityId:'entity:neutral:beacon',canonicalEntityId:'entity:neutral:beacon',name:'Neutral Beacon'}]}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'lineage:1',response:'The neutral beacon is active.',
    observations:[{subjectId:'entity:neutral:beacon',predicate:'state',value:'ACTIVE',at:1}],
  });
  const claimId=brain.readTurn('lineage:1').settlements[0].claimId;

  const prepared=await brain.prepareTurn({
    chatId:'chat:lineage',turnId:'lineage:2',generationId:'gen:lineage:2',
    query:'What is the neutral beacon state?',intent:'CURRENT',anchorEntityIds:['entity:neutral:beacon'],
    scene:scene('neutral-annex',2,{objects:[{entityId:'entity:neutral:beacon',canonicalEntityId:'entity:neutral:beacon',name:'Neutral Beacon'}]}),
    candidateBudget:16,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  const record=brain.readTurn('lineage:2'),candidate=candidateForClaim(prepared.candidateEnvelope,claimId);
  assert.ok(candidate);
  assert.ok(candidate.identityRevisionRefs.includes(identityRef));
  assert.equal(candidate.settlementAuthority,false);
  assert.equal(candidate.admissionAuthority,false);

  const truth=record.published.assessment.truthResults.find(row=>row.candidateId===candidate.candidateId);
  assert.ok(truth);
  assert.ok(truth.identityRevisionRefs.includes(identityRef));
  assert.equal(truth.temporalStatus,'CURRENT');

  const precision=record.published.precisionResults.find(row=>row.candidateId===candidate.candidateId);
  assert.ok(precision);
  assert.ok(precision.identityRevisionRefs.includes(identityRef));
  assert.equal(precision.temporalStatus,'CURRENT');

  const receipt=prepared.cognitiveChoice;
  assert.ok(receipt.revisions.identityRevisionRefs.includes(identityRef));
  const temporal=receipt.revisions.temporalEvidenceRefs.find(row=>row.candidateId===candidate.candidateId);
  assert.ok(temporal);
  assert.ok(temporal.identityRevisionRefs.includes(identityRef));
  assert.equal(temporal.temporalStatus,'CURRENT');
  assert.equal(receipt.truthAuthority,false);
  assert.equal(receipt.settlementAuthority,false);
});

test('DETERMINISTIC: graph provider failure and stale provider output degrade independently without losing sparse, Lore or episodic nominations',async()=>{
  const brain=new Area52NativeBrain();
  brain.registerEntityIdentity({entityId:'entity:neutral:marker',canonicalLabel:'Neutral Marker',entityType:'OBJECT',worldId:'world:neutral'});
  brain.acceptLore({
    sourceId:'lore:neutral:marker',sourceType:'LORE_ENTRY',
    exactContent:'Neutral Marker protocol: the silver sigil identifies the active state marker.',
    semantic:{subjectId:'entity:neutral:marker',predicate:'protocol',value:'SILVER_SIGIL'},
    metadata:{representationText:'Neutral Marker protocol uses a silver sigil for the active state marker.'},
  });

  await brain.prepareTurn({
    chatId:'chat:degrade',turnId:'degrade:1',generationId:'gen:degrade:1',query:'Observe the Neutral Marker.',
    scene:scene('neutral-marker-room',1,{objects:[{entityId:'entity:neutral:marker',canonicalEntityId:'entity:neutral:marker',name:'Neutral Marker'}]}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'degrade:1',response:'The Neutral Marker active state glows beside the silver sigil.',knownBy:['observer:one'],
    observations:[{subjectId:'entity:neutral:marker',predicate:'state',value:'ACTIVE',at:1}],
  });

  brain.registerGraphProvider({providerId:'BROKEN_GRAPH_NEUTRAL',owner:'SCENE_GRAPH_PROVIDER',isRevisionCurrent:()=>true,query(){throw new Error('GRAPH_PROVIDER_OFFLINE');}});
  brain.registerGraphProvider({
    providerId:'STALE_GRAPH_NEUTRAL',owner:'SCENE_GRAPH_PROVIDER',isRevisionCurrent:()=>false,
    query:()=>({providerRevision:'stale:1',edges:[{
      edgeId:'stale-marker-edge',fromEntityId:'entity:neutral:marker',toEntityId:'entity:neutral:other',
      edgeMeaning:'RELATED_TO',sourceKind:'SCENE_GRAPH',temporalStatus:'CURRENT',authorityClass:'OBSERVED',
      sourceRevisionRefs:['scene-graph:neutral@old'],provenanceRefs:['scene-graph:neutral@old'],
    }]}),
  });

  const prepared=await brain.prepareTurn({
    chatId:'chat:degrade',turnId:'degrade:2',generationId:'gen:degrade:2',
    query:'Neutral Marker active state silver sigil: what do we remember?',intent:'CURRENT',anchorEntityIds:['entity:neutral:marker'],
    scene:scene('neutral-marker-room',2,{objects:[{entityId:'entity:neutral:marker',canonicalEntityId:'entity:neutral:marker',name:'Neutral Marker'}]}),
    candidateBudget:24,latencyBudgetMs:1000,graphTraversal:{maxDepth:2,maxNodes:24,maxEdges:48,maxCandidates:16},
    executionLabel:'DETERMINISTIC',
  });

  const used=new Set(prepared.used.sensoryChannelsUsed);
  for(const id of ['CORE_SPARSE','NATIVE_LORE','NATIVE_MEMORY'])assert.ok(used.has(id),'expected valid nomination channel '+id);
  assert.ok(prepared.graphTraversalReceipt.providers.some(row=>row.providerId==='BROKEN_GRAPH_NEUTRAL'&&row.status==='DEGRADED'));
  assert.ok(prepared.graphTraversalReceipt.staleRejected.some(row=>row.edgeId==='stale-marker-edge'));
  assert.ok(prepared.candidateEnvelope.candidateCount<=24);
  assert.equal(prepared.graphTraversalReceipt.authority.truth,false);
  assert.equal(prepared.graphTraversalReceipt.authority.settlement,false);
});

test('DETERMINISTIC: #27 identity/source correction invalidates the smallest Hot dependency cone and survives reload',async()=>{
  const brain=new Area52NativeBrain();
  const lore=brain.acceptLore({
    sourceId:'lore:neutral:keeper',sourceType:'LORE_ENTRY',
    exactContent:'The neutral keeper identity is explicitly bound to the Keeper marker.',
    semantic:{subjectId:'entity:neutral:keeper',predicate:'identityMarker',value:'KEEPER'},
  });
  brain.registerEntityIdentity({
    entityId:'entity:neutral:keeper',canonicalLabel:'Neutral Keeper',entityType:'PERSON',worldId:'world:neutral',
    providerId:'LORE_NEUTRAL',sourceEntityId:'neutral-keeper-owner',
    sourceRevisionRefs:[lore.sourceRevisionId],provenanceRefs:[lore.evidenceId],authorityOrigin:'SOURCE_EXPLICIT',
  });

  await brain.prepareTurn({
    chatId:'chat:invalidate',turnId:'invalidate:1',generationId:'gen:invalidate:1',query:'Observe the neutral keeper.',
    scene:scene('neutral-keeper-room',1,{activeCast:[{entityId:'entity:neutral:keeper',canonicalEntityId:'entity:neutral:keeper',name:'Neutral Keeper'}]}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'invalidate:1',response:'The neutral keeper stands in the annex.',knownBy:['entity:neutral:keeper'],
    observations:[{subjectId:'entity:neutral:keeper',predicate:'location',value:'neutral-annex',at:1}],
  });

  const before=brain.core.hotCognitionSnapshot('chat:invalidate');
  const locationRevision=before.segments.LOCATION.revision;
  assert.equal(before.segments.WORLD_REFERENCES.freshness,'FRESH');
  assert.ok((before.segments.WORLD_REFERENCES.dependencyRevisionRefs??[]).length>0);

  brain.correctLore('lore:neutral:keeper','Correction: the neutral keeper identity owner issued a new explicit revision.',{
    semantic:{subjectId:'entity:neutral:keeper',predicate:'identityMarker',value:'KEEPER_V2'},
  });
  const after=brain.core.hotCognitionSnapshot('chat:invalidate');
  assert.notEqual(after.segments.WORLD_REFERENCES.freshness,'FRESH');
  assert.equal(after.segments.LOCATION.freshness,'FRESH');
  assert.equal(after.segments.LOCATION.revision,locationRevision);

  const restored=Area52NativeBrain.fromSnapshot(brain.snapshot());
  const reload=restored.core.hotCognitionSnapshot('chat:invalidate');
  assert.notEqual(reload.segments.WORLD_REFERENCES.freshness,'FRESH');
  assert.equal(reload.segments.LOCATION.freshness,'FRESH');
});

test('DETERMINISTIC: #27 stale Hot snapshot is rejected before a new Context Seal while quiet current Hot remains usable',async()=>{
  const brain=new Area52NativeBrain();
  await brain.prepareTurn({
    chatId:'chat:hot-fence',turnId:'hot-fence:1',generationId:'gen:hot-fence:1',query:'Begin.',
    scene:scene('hot-fence-room',1,{activeCast:['observer:one']}),executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({turnId:'hot-fence:1',response:'The observer waits quietly.',knownBy:['observer:one']});

  const quiet=await brain.prepareTurn({
    chatId:'chat:hot-fence',turnId:'hot-fence:2',generationId:'gen:hot-fence:2',query:'Continue.',executionLabel:'DETERMINISTIC',
  });
  assert.ok(quiet.used.paths.includes('HOT_ONLY'));

  const state=brain.core.graph.exportState();
  state.revision+=1;
  brain.core.graph.restoreState(state);

  const stale=await brain.prepareTurn({
    chatId:'chat:hot-fence',turnId:'hot-fence:3',generationId:'gen:hot-fence:3',query:'Continue.',executionLabel:'DETERMINISTIC',
  });
  const record=brain.readTurn('hot-fence:3');
  assert.equal(record.published.hotFreshnessReceipt.accepted,false);
  assert.equal(record.published.hotFreshnessReceipt.reason,'HOT_REVISION_MISMATCH');
  assert.equal(record.published.hotCognition,null);
  assert.equal(stale.used.paths.includes('HOT_ONLY'),false);
  assert.equal(stale.contextSealReceipt.sealedState,true);

  assert.deepEqual(brain.diagnostics().nativeRequirements,{
    jevRequired:false,sidecarRequired:false,externalDatabaseRequired:false,sqlRequired:false,remoteModelRequired:false,userOrchestratorRequired:false,
  });
});

test('DETERMINISTIC: long-session Hot, retrieval and prompt work remain bounded with an unavailable optional provider',async()=>{
  const brain=new Area52NativeBrain();
  brain.registerEntityIdentity({entityId:'entity:long:anchor',canonicalLabel:'Long Session Anchor',entityType:'OBJECT',worldId:'world:neutral'});
  await brain.prepareTurn({
    chatId:'chat:long',turnId:'long:0',generationId:'gen:long:0',query:'Begin the neutral long-session fixture.',
    scene:scene('long-session-room',1,{objects:[{entityId:'entity:long:anchor',canonicalEntityId:'entity:long:anchor',name:'Long Session Anchor'}]}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'long:0',response:'The long session anchor is present.',
    observations:[{subjectId:'entity:long:anchor',predicate:'state',value:'PRESENT',at:1}],
  });

  for(let index=1;index<=96;index++){
    brain.core.consumeNarrativeEvidence({
      kind:'NarrativeEvidence',activity:'APPEND',chatId:'chat:long',messageId:'long:'+index,messageRevision:1,
      turnId:'synthetic:'+index,sourceRevisionId:'long-session:message:'+index+'@1',sequence:index,current:true,historical:false,
      content:'Neutral long-session episode '+index+' concerning the anchor.',role:index%2?'user':'assistant',
      invalidates:[],knownBy:['observer:long'],publicToAll:false,
    });
  }
  for(let index=0;index<48;index++)brain.acceptLore({
    sourceId:'lore:long:'+index,sourceType:'LORE_ENTRY',
    exactContent:'Long Session Anchor archival detail '+index+' '+('bounded context detail '.repeat(8)),
    semantic:{subjectId:'entity:long:anchor',predicate:'archiveDetail'+index,value:'DETAIL_'+index},
    metadata:{representationText:'Long Session Anchor archival detail '+index},
  });

  const prepared=await brain.prepareTurn({
    chatId:'chat:long',turnId:'long:1',generationId:'gen:long:1',
    query:'Long Session Anchor archival detail and current state?',intent:'CURRENT',anchorEntityIds:['entity:long:anchor'],
    channelIds:['CORE_SPARSE','NATIVE_LORE','NATIVE_MEMORY','DENSE_EMBEDDINGS'],
    candidateBudget:12,latencyBudgetMs:1000,budgetTokens:2048,executionLabel:'DETERMINISTIC',
  });

  const hot=brain.core.hotCognitionSnapshot('chat:long');
  assert.ok(hot.segments.RECENT_EPISODE_TAIL.value.length<=32);
  assert.ok(prepared.candidateEnvelope.candidateCount<=12);
  assert.equal(prepared.candidateEnvelope.unavailableChannels.includes('DENSE_EMBEDDINGS'),true);
  const unavailable=prepared.candidateEnvelope.metadata.channelReceipts.find(row=>row.channelId==='DENSE_EMBEDDINGS');
  assert.equal(unavailable.status,'UNAVAILABLE');
  assert.ok(unavailable.reason);
  assert.ok((unavailable.fallbackChannelIds??[]).length>0);
  assert.ok(Number.isFinite(prepared.retrievalBudgetReceipt.elapsedMs));
  assert.equal(prepared.retrievalBudgetReceipt.latencyBudgetMs,1000);
  assert.ok(prepared.promptPlan.budget.allocated<=prepared.promptPlan.budget.available);
  assert.ok(prepared.candidateEnvelope.fusionReceipt.diagnostics.candidatePayloadBytes>=0);
});

