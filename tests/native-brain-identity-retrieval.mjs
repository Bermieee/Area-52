import test from 'node:test';
import assert from 'node:assert/strict';
import {Area52NativeBrain} from '../src/native-brain.js';

function scene(sceneId,sceneRevision,{location=null,activeCast=[],objects=[],relationship=null}={}){
  return{
    sceneId,sceneRevision,location,narrativeTime:'day '+sceneRevision,activeCast,activeThreads:[],objects,
    sceneRelationship:relationship,sourceRevisionRefs:[],provenance:['identity-wave:'+sceneId+':'+sceneRevision],
  };
}
function graphMetadata(envelope){
  return (envelope?.candidates??[]).flatMap(candidate=>(candidate.graphMetadata??[]).map(row=>({...row,candidateId:candidate.candidateId,authorityClass:candidate.authorityClass,truthStatusHint:candidate.truthStatusHint,representationText:candidate.representationText})));
}
function slots(plan){return new Set((plan?.sections??[]).filter(row=>row.representation!=='OMITTED').map(row=>row.slot));}
function currentAlias(entity,label){return (entity?.aliases??[]).find(row=>row.alias===label&&row.current!==false);}

test('DETERMINISTIC: cross-source entity identity links explicit aliases but defers guesses and rejects false friends',async()=>{
  const brain=new Area52NativeBrain();
  const oldLore=brain.acceptLore({
    sourceId:'lore:aster:ash',sourceType:'LORE_ENTRY',
    exactContent:'In Aster Vale, the person Ash is explicitly called Silver Ash.',
    semantic:{subjectId:'entity:aster:ash',predicate:'alias',value:'Silver Ash'},
    metadata:{representationText:'Ash of Aster Vale is explicitly called Silver Ash.'},
  });

  brain.registerEntityIdentity({entityId:'entity:aster:ash',canonicalLabel:'Ash',entityType:'PERSON',worldId:'world:aster',providerId:'LORE_ASTER',provenanceRefs:['owner:aster']});
  brain.registerEntityIdentity({entityId:'entity:ember:ash',canonicalLabel:'Ash',entityType:'PERSON',worldId:'world:ember',providerId:'LORE_EMBER',provenanceRefs:['owner:ember']});
  brain.registerEntityIdentity({entityId:'entity:aster:ash-relic',canonicalLabel:'Ash',entityType:'OBJECT',worldId:'world:aster',providerId:'LORE_ASTER',provenanceRefs:['owner:aster:relic']});

  const aliasProposal=brain.proposeEntityIdentity({
    action:'ALIAS_ADD',providerId:'LORE_ASTER',sourceEntityId:'aster-person-ash',alias:'Silver Ash',
    targetEntityId:'entity:aster:ash',worldId:'world:aster',entityType:'PERSON',
    authorityOrigin:'SOURCE_EXPLICIT',explicit:true,sourceRevisionRefs:[oldLore.sourceRevisionId],
    provenanceRefs:[oldLore.evidenceId,'lore:explicit-alias'],
  });
  assert.equal(aliasProposal.canonicalMutation,false);
  assert.equal(brain.core.entities.resolveSource({providerId:'LORE_ASTER',sourceEntityId:'aster-person-ash'}),null);
  const aliasSettled=brain.settleEntityIdentity(aliasProposal.proposalId,{decision:'ACCEPT'});
  assert.equal(aliasSettled.state,'ALIAS_ADDED');
  assert.equal(aliasSettled.applied,true);
  assert.equal(brain.core.entities.resolveMention({label:'Silver Ash',worldId:'world:aster',entityType:'PERSON'}).entity.entityId,'entity:aster:ash');

  const falseFriend=brain.proposeEntityIdentity({
    action:'LINK',providerId:'LORE_ASTER',sourceEntityId:'aster-object-ash',label:'Ash',
    targetEntityId:'entity:aster:ash',worldId:'world:aster',entityType:'OBJECT',
    authorityOrigin:'SOURCE_EXPLICIT',explicit:true,sourceRevisionRefs:[oldLore.sourceRevisionId],
    provenanceRefs:['lore:false-friend-object'],
  });
  assert.equal(falseFriend.recommendation,'REJECT');
  assert.equal(falseFriend.recommendationCode,'ENTITY_TYPE_MISMATCH');
  assert.equal(brain.settleEntityIdentity(falseFriend.proposalId,{decision:'ACCEPT'}).state,'REJECTED');

  const relicLink=brain.proposeEntityIdentity({
    action:'LINK',providerId:'LORE_ASTER',sourceEntityId:'aster-object-ash',label:'Ash',
    targetEntityId:'entity:aster:ash-relic',worldId:'world:aster',entityType:'OBJECT',
    authorityOrigin:'SOURCE_EXPLICIT',explicit:true,sourceRevisionRefs:[oldLore.sourceRevisionId],
    provenanceRefs:['lore:relic-explicit'],
  });
  assert.equal(brain.settleEntityIdentity(relicLink.proposalId,{decision:'ACCEPT'}).state,'LINKED');

  const ambiguous=brain.proposeEntityIdentity({
    action:'AMBIGUOUS',providerId:'SCENE',label:'Ash',
    candidateEntityIds:['entity:aster:ash','entity:ember:ash','entity:aster:ash-relic'],
    authorityOrigin:'HEURISTIC',explicit:false,confidence:.91,
    provenanceRefs:['scene:mention:ash'],
  });
  const ambiguousReceipt=brain.settleEntityIdentity(ambiguous.proposalId,{decision:'ACCEPT'});
  assert.equal(ambiguousReceipt.state,'UNRESOLVED');
  assert.equal(ambiguousReceipt.applied,false);

  const modelGuess=brain.proposeEntityIdentity({
    action:'LINK',providerId:'MODEL',sourceEntityId:'guess:ash',label:'Ash',
    targetEntityId:'entity:aster:ash',worldId:'world:aster',entityType:'PERSON',
    authorityOrigin:'MODEL_GUESS',explicit:false,confidence:.999,
    provenanceRefs:['model:high-confidence-guess'],
  });
  assert.equal(modelGuess.recommendation,'DEFER');
  assert.equal(brain.settleEntityIdentity(modelGuess.proposalId,{decision:'ACCEPT'}).state,'DEFERRED');
  assert.equal(brain.core.entities.resolveSource({providerId:'MODEL',sourceEntityId:'guess:ash'}),null);

  const beforeCorrection=brain.entityIdentityReadModel();
  const emberBefore=beforeCorrection.identities.find(row=>row.entityId==='entity:ember:ash');
  const corrected=brain.correctLore('lore:aster:ash','Correction: In Aster Vale, Ash is now explicitly called Argent Ash.',{
    semantic:{subjectId:'entity:aster:ash',predicate:'alias',value:'Argent Ash'},
    metadata:{representationText:'Correction: Ash of Aster Vale is explicitly called Argent Ash.'},
  });
  assert.ok(corrected.identityInvalidation.affectedEntityIds.includes('entity:aster:ash'));
  assert.ok(corrected.identityInvalidation.affectedEntityIds.includes('entity:aster:ash-relic'));
  assert.equal(corrected.identityInvalidation.affectedEntityIds.includes('entity:ember:ash'),false);

  const afterInvalidation=brain.core.entities.get('entity:aster:ash');
  assert.equal(Boolean(currentAlias(afterInvalidation,'Silver Ash')),false);
  assert.ok(afterInvalidation.aliases.some(row=>row.alias==='Silver Ash'&&row.status==='INVALIDATED'));

  const newAlias=brain.proposeEntityIdentity({
    action:'ALIAS_ADD',providerId:'LORE_ASTER',sourceEntityId:'aster-person-ash-v2',alias:'Argent Ash',
    targetEntityId:'entity:aster:ash',worldId:'world:aster',entityType:'PERSON',
    authorityOrigin:'SOURCE_EXPLICIT',explicit:true,sourceRevisionRefs:[corrected.row.sourceRevisionId],
    provenanceRefs:[corrected.row.evidenceId,'lore:corrected-alias'],
  });
  assert.equal(brain.settleEntityIdentity(newAlias.proposalId,{decision:'ACCEPT'}).state,'ALIAS_ADDED');
  assert.equal(brain.core.entities.resolveMention({label:'Argent Ash',worldId:'world:aster',entityType:'PERSON'}).entity.entityId,'entity:aster:ash');

  const restored=Area52NativeBrain.fromSnapshot(brain.snapshot());
  const aster=restored.core.entities.get('entity:aster:ash'),ember=restored.core.entities.get('entity:ember:ash');
  assert.ok(currentAlias(aster,'Argent Ash'));
  assert.ok(aster.aliases.some(row=>row.alias==='Silver Ash'&&row.status==='INVALIDATED'));
  assert.equal(ember.revision,emberBefore.revision);
  assert.equal(restored.core.entities.resolveMention({label:'Ash'}).state,'UNRESOLVED');

  console.log('IDENTITY_WAVE_METRIC',JSON.stringify({
    identities:restored.entityIdentityReadModel().counts.identities,
    proposals:restored.entityIdentityReadModel().counts.proposals,
    ambiguousCandidates:ambiguous.candidateEntityIds.length,
    falseFriend:falseFriend.recommendationCode,
    modelGuess:modelGuess.recommendationCode,
    invalidatedAliases:corrected.identityInvalidation.retiredAliases.length,
  }));
});

test('DETERMINISTIC: graph walker preserves owner semantics, temporal possession history, mistaken belief, stale correction fences, and exact paths',async()=>{
  const brain=new Area52NativeBrain();
  const ids={
    ash:'entity:aster:ash',lio:'entity:aster:lio',key:'entity:aster:moon-key',
    orchard:'entity:aster:moon-orchard',spire:'entity:aster:glass-spire',event:'event:aster:lantern-fall',
  };
  brain.registerEntityIdentity({entityId:ids.ash,canonicalLabel:'Ash',entityType:'PERSON',worldId:'world:aster'});
  brain.registerEntityIdentity({entityId:ids.lio,canonicalLabel:'Lio',entityType:'PERSON',worldId:'world:aster'});
  brain.registerEntityIdentity({entityId:ids.key,canonicalLabel:'Moon Key',entityType:'OBJECT',worldId:'world:aster'});
  brain.registerEntityIdentity({entityId:ids.orchard,canonicalLabel:'Moon Orchard',entityType:'PLACE',worldId:'world:aster'});
  brain.registerEntityIdentity({entityId:ids.spire,canonicalLabel:'Glass Spire',entityType:'PLACE',worldId:'world:aster'});
  brain.registerEntityIdentity({entityId:ids.event,canonicalLabel:'Lantern Fall',entityType:'EVENT',worldId:'world:aster'});

  const loreOld=brain.acceptLore({
    sourceId:'lore:aster:orchard-map',sourceType:'LORE_ENTRY',
    exactContent:'Old map: Ash is associated with the eastern Moon Orchard route.',
    semantic:{subjectId:ids.ash,predicate:'route',value:ids.orchard},
    metadata:{representationText:'Old map: Ash follows the eastern Moon Orchard route.'},
  });
  const loreCorrected=brain.correctLore('lore:aster:orchard-map','Correction: Ash uses the western Glass Spire route, not the eastern Moon Orchard route.',{
    semantic:{subjectId:ids.ash,predicate:'route',value:ids.spire},
    metadata:{representationText:'Corrected map: Ash uses the western Glass Spire route.'},
  });

  await brain.prepareTurn({
    chatId:'chat:aster-graph',turnId:'aster-graph:1',generationId:'gen:aster-graph:1',query:'Begin at Moon Orchard.',
    scene:scene('moon-orchard',1,{location:'Moon Orchard',activeCast:[{entityId:ids.ash,canonicalEntityId:ids.ash,name:'Ash'}],objects:[{entityId:ids.key,canonicalEntityId:ids.key,name:'Moon Key'}]}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'aster-graph:1',response:'Ash takes the Moon Key while standing in the Moon Orchard.',knownBy:[ids.ash],
    observations:[
      {subjectId:ids.ash,predicate:'location',value:ids.orchard,at:1},
      {subjectId:ids.key,predicate:'possessor',value:ids.ash,at:1},
    ],
  });
  await brain.prepareTurn({
    chatId:'chat:aster-graph',turnId:'aster-graph:2',generationId:'gen:aster-graph:2',query:'Move to the Glass Spire.',
    scene:scene('glass-spire',2,{location:'Glass Spire',activeCast:[{entityId:ids.ash,canonicalEntityId:ids.ash,name:'Ash'},{entityId:ids.lio,canonicalEntityId:ids.lio,name:'Lio'}],objects:[{entityId:ids.key,canonicalEntityId:ids.key,name:'Moon Key'}],relationship:'PRECEDES'}),
    executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'aster-graph:2',response:'Ash hands the Moon Key to Lio and moves into the Glass Spire.',knownBy:[ids.ash,ids.lio],
    observations:[
      {subjectId:ids.ash,predicate:'location',value:ids.spire,at:2},
      {subjectId:ids.key,predicate:'possessor',value:ids.lio,at:2},
    ],
  });

  brain.registerGraphProvider({
    providerId:'LORE_GRAPH_ASTER',owner:'LORE_SEMANTIC_GRAPH',semanticsVersion:'lore-graph-v1',
    isRevisionCurrent:(ref)=>brain.core.isSourceRevisionCurrent(ref),
    query:()=>({providerRevision:'lore-provider:2',edges:[
      {edgeId:'lore-route-old',fromEntityId:ids.ash,toEntityId:ids.orchard,edgeMeaning:'SCENE_LOCATION',sourceKind:'LORE_GRAPH',temporalStatus:'CURRENT',authorityClass:'SOURCE_CANON',sourceRevisionRefs:[loreOld.sourceRevisionId],provenanceRefs:['lore:path:old'],representationText:'Derived old route concept.'},
      {edgeId:'lore-route-current',fromEntityId:ids.ash,toEntityId:ids.spire,edgeMeaning:'SCENE_LOCATION',sourceKind:'LORE_GRAPH',temporalStatus:'CURRENT',authorityClass:'SOURCE_CANON',sourceRevisionRefs:[loreCorrected.row.sourceRevisionId],provenanceRefs:['lore:path:current'],representationText:'Derived corrected Glass Spire route concept.'},
    ]}),
  });
  const memoryRevision='memory:aster:r9';
  brain.registerGraphProvider({
    providerId:'MEMORY_GRAPH_ASTER',owner:'MEMORY_EXPERIENCE_GRAPH',semanticsVersion:'memory-graph-v1',
    isRevisionCurrent:(ref)=>ref===memoryRevision,
    query:()=>({providerRevision:'memory-provider:9',edges:[
      {edgeId:'memory-ally',fromEntityId:ids.ash,toEntityId:ids.lio,edgeMeaning:'ALLY_OF',sourceKind:'MEMORY_EXPERIENCE',temporalStatus:'CURRENT',authorityClass:'OBSERVED',sourceRevisionRefs:[memoryRevision],provenanceRefs:['memory:ally:evidence'],representationText:'Ash and Lio acted as allies.'},
      {edgeId:'memory-ally',fromEntityId:ids.ash,toEntityId:ids.lio,edgeMeaning:'ALLY_OF',sourceKind:'MEMORY_EXPERIENCE',temporalStatus:'CURRENT',authorityClass:'OBSERVED',sourceRevisionRefs:[memoryRevision],provenanceRefs:['memory:ally:evidence'],representationText:'Ash and Lio acted as allies.'},
      {edgeId:'memory-belief',fromEntityId:ids.key,toEntityId:ids.ash,edgeMeaning:'BELIEVES_POSSESSOR',sourceKind:'MEMORY_EXPERIENCE',temporalStatus:'UNCERTAIN',authorityClass:'UNRESOLVED',sourceRevisionRefs:[memoryRevision],provenanceRefs:['memory:mistaken-belief'],perspective:{scope:'CHARACTER_KNOWLEDGE',characterRef:ids.ash},representationText:"Ash mistakenly believes the Moon Key is still in Ash's possession."},
      {edgeId:'memory-event',fromEntityId:ids.ash,toEntityId:ids.event,edgeMeaning:'PARTICIPATED_IN',sourceKind:'MEMORY_EXPERIENCE',temporalStatus:'HISTORICAL',authorityClass:'OBSERVED',sourceRevisionRefs:[memoryRevision],provenanceRefs:['memory:event:lantern-fall'],representationText:'Ash participated in the historical Lantern Fall.'},
    ]}),
  });

  const currentPossession=brain.core.retrieval.retrieveEnvelope('Moon Key possessor now',{
    intent:'CURRENT',anchorEntityIds:[ids.key],channelIds:['ZZ_NATIVE_GRAPH_WALKER'],candidateBudget:12,latencyBudgetMs:1000,
    graphTraversal:{maxDepth:2,maxNodes:24,maxEdges:48,maxCandidates:12,allowedEdgeMeanings:['possessor']},
  });
  const currentPossessionGraph=graphMetadata(currentPossession);
  assert.ok(currentPossessionGraph.some(row=>row.edgeMeaning==='possessor'&&row.toEntityId===ids.lio&&row.temporalStatus==='CURRENT'));
  assert.equal(currentPossessionGraph.some(row=>row.edgeMeaning==='possessor'&&row.toEntityId===ids.ash&&row.temporalStatus==='SUPERSEDED'),false);

  const historicalPossession=brain.core.retrieval.retrieveEnvelope('Moon Key possession history',{
    intent:'HISTORICAL',anchorEntityIds:[ids.key],channelIds:['ZZ_NATIVE_GRAPH_WALKER'],candidateBudget:12,latencyBudgetMs:1000,
    graphTraversal:{maxDepth:2,maxNodes:24,maxEdges:48,maxCandidates:12,allowedEdgeMeanings:['possessor']},
  });
  const historicalPossessionGraph=graphMetadata(historicalPossession);
  assert.ok(historicalPossessionGraph.some(row=>row.toEntityId===ids.ash&&['HISTORICAL','SUPERSEDED'].includes(row.temporalStatus)));
  assert.ok(historicalPossessionGraph.some(row=>row.toEntityId===ids.lio&&row.temporalStatus==='CURRENT'));

  const relationship=brain.core.retrieval.retrieveEnvelope('Ash relationship neighborhood',{
    intent:'CURRENT',anchorEntityIds:[ids.ash],channelIds:['ZZ_NATIVE_GRAPH_WALKER'],candidateBudget:12,latencyBudgetMs:1000,
    graphTraversal:{maxDepth:1,maxNodes:16,maxEdges:32,maxCandidates:12,allowedEdgeMeanings:['ALLY_OF']},
  });
  const relationshipGraph=graphMetadata(relationship);
  assert.equal(relationshipGraph.filter(row=>row.edgeId==='memory-ally').length,1);
  assert.ok(relationshipGraph.some(row=>row.graphProvider==='MEMORY_GRAPH_ASTER'&&row.graphOwner==='MEMORY_EXPERIENCE_GRAPH'&&row.traversalPath.length===1));

  const historicalEvent=brain.core.retrieval.retrieveEnvelope('What historical event involved Ash?',{
    intent:'HISTORICAL',anchorEntityIds:[ids.ash],channelIds:['ZZ_NATIVE_GRAPH_WALKER'],candidateBudget:12,latencyBudgetMs:1000,
    graphTraversal:{maxDepth:1,maxNodes:16,maxEdges:32,maxCandidates:12,allowedEdgeMeanings:['PARTICIPATED_IN']},
  });
  assert.ok(graphMetadata(historicalEvent).some(row=>row.edgeId==='memory-event'&&row.temporalStatus==='HISTORICAL'&&row.toEntityId===ids.event));

  const ownerSemantics=brain.core.retrieval.retrieveEnvelope('Ash scene location neighborhood',{
    intent:'CURRENT',anchorEntityIds:[ids.ash],channelIds:['ZZ_NATIVE_GRAPH_WALKER'],candidateBudget:20,latencyBudgetMs:1000,
    graphTraversal:{maxDepth:2,maxNodes:32,maxEdges:64,maxCandidates:20,allowedEdgeMeanings:['PRESENT_IN_SCENE','SCENE_LOCATION']},
  });
  const ownerRows=graphMetadata(ownerSemantics).filter(row=>row.edgeMeaning==='SCENE_LOCATION');
  assert.ok(ownerRows.some(row=>row.graphOwner==='SCENE_INTELLIGENCE'&&row.sourceKind==='SCENE_OBSERVATION'));
  const derivedLore=ownerRows.find(row=>row.graphOwner==='LORE_SEMANTIC_GRAPH'&&row.edgeId==='lore-route-current');
  assert.ok(derivedLore);
  assert.equal(derivedLore.authorityClass,'INFERRED');
  assert.ok(ownerSemantics.metadata.graphTraversalReceipt.staleRejected.some(row=>row.edgeId==='lore-route-old'));
  assert.equal(ownerSemantics.metadata.graphTraversalReceipt.authority.graphMutation,false);

  const belief=brain.core.retrieval.retrieveEnvelope('What does Ash believe about the Moon Key?',{
    intent:'TEMPORAL',anchorEntityIds:[ids.key],channelIds:['ZZ_NATIVE_GRAPH_WALKER'],candidateBudget:20,latencyBudgetMs:1000,
    graphTraversal:{maxDepth:1,maxNodes:16,maxEdges:32,maxCandidates:20,allowedEdgeMeanings:['BELIEVES_POSSESSOR']},
  });
  const beliefRow=graphMetadata(belief).find(row=>row.edgeId==='memory-belief');
  assert.ok(beliefRow);
  assert.equal(beliefRow.temporalStatus,'UNCERTAIN');
  assert.equal(brain.currentWorldModel().current.find(row=>row.subjectId===ids.key&&row.predicate==='possessor').value,ids.lio);

  const chosen=await brain.prepareTurn({
    chatId:'chat:aster-graph',turnId:'aster-graph:3',generationId:'gen:aster-graph:3',
    query:'Where can I find Ash around the Glass Spire, and what is Ash connected to?',intent:'CURRENT',anchorEntityIds:[ids.ash],
    scene:scene('glass-spire-current',3,{location:'Glass Spire',activeCast:[{entityId:ids.ash,canonicalEntityId:ids.ash,name:'Ash'},{entityId:ids.lio,canonicalEntityId:ids.lio,name:'Lio'}],relationship:'CONTINUES'}),
    candidateBudget:16,latencyBudgetMs:1000,graphTraversal:{maxDepth:2,maxNodes:32,maxEdges:64,maxCandidates:16},
    executionLabel:'DETERMINISTIC',
  });
  assert.ok(chosen.used.admittedJobs.includes('GRAPH_WALKER'));
  for(const channel of ['ZZ_NATIVE_GRAPH_WALKER','CORE_SPARSE','CORE_DENSE','NATIVE_LORE','NATIVE_MEMORY'])assert.ok(chosen.used.sensoryChannelsUsed.includes(channel),'expected native retrieval channel '+channel);
  assert.ok(chosen.contextSealReceipt?.sealedState);
  assert.ok(chosen.graphTraversalReceipt);
  assert.ok(chosen.retrievalBudgetReceipt);
  const rejected=brain.uiBindings().readRejectedEvidence(chosen.selection);
  assert.ok(rejected.staleGraphEdges.some(row=>row.edgeId==='lore-route-old'));

  console.log('GRAPH_WAVE_METRIC',JSON.stringify({
    currentPossessionCandidates:currentPossession.candidateCount,
    historicalPossessionCandidates:historicalPossession.candidateCount,
    relationshipCandidates:relationship.candidateCount,
    historicalEventCandidates:historicalEvent.candidateCount,
    staleRejected:ownerSemantics.metadata.graphTraversalReceipt.staleRejectedCount,
    graphElapsedMs:chosen.graphTraversalReceipt.elapsedMs,
    retrievalElapsedMs:chosen.retrievalBudgetReceipt.elapsedMs,
    finalBrainCandidates:chosen.candidateEnvelope.candidateCount,
  }));
});

test('DETERMINISTIC: graph traversal candidate/node/edge/latency budgets are hard bounds and provider failure degrades independently',async()=>{
  const brain=new Area52NativeBrain();
  const anchor='entity:stress:anchor';
  brain.registerEntityIdentity({entityId:anchor,canonicalLabel:'Stress Anchor',entityType:'OBJECT',worldId:'world:stress'});
  const revision='stress-graph@r1';
  brain.registerGraphProvider({
    providerId:'STRESS_GRAPH',owner:'STRESS_OWNER',isRevisionCurrent:(ref)=>ref===revision,
    query:()=>({providerRevision:'stress:1',edges:Array.from({length:120},(_,index)=>({
      edgeId:'stress-edge:'+index,fromEntityId:anchor,toEntityId:'stress-node:'+index,edgeMeaning:'RELATED_TO',
      sourceKind:'OWNER_GRAPH',temporalStatus:'CURRENT',authorityClass:'UNRESOLVED',sourceRevisionRefs:[revision],
      provenanceRefs:['stress-prov:'+index],representationText:'stress edge '+index,
    }))}),
  });
  brain.registerGraphProvider({providerId:'BROKEN_GRAPH',owner:'BROKEN_OWNER',isRevisionCurrent:()=>true,query(){throw new Error('GRAPH_PROVIDER_OFFLINE');}});

  const bounded=brain.core.retrieval.retrieveEnvelope('stress graph',{
    intent:'CURRENT',anchorEntityIds:[anchor],channelIds:['ZZ_NATIVE_GRAPH_WALKER'],candidateBudget:5,latencyBudgetMs:1000,
    graphTraversal:{maxDepth:1,maxNodes:12,maxEdges:20,maxCandidates:7},
  });
  const receipt=bounded.metadata.graphTraversalReceipt;
  assert.ok(receipt.examinedEdgeCount<=20);
  assert.ok(receipt.visitedNodeCount<=12);
  assert.ok(receipt.traversedEdgeCount<=7);
  assert.ok(bounded.candidateCount<=5);
  assert.equal(bounded.fusionReceipt.diagnostics.effectiveCandidateLimit,5);
  assert.ok(receipt.providers.some(row=>row.providerId==='BROKEN_GRAPH'&&row.status==='DEGRADED'));
  assert.equal(receipt.authority.truth,false);
  assert.equal(receipt.authority.settlement,false);

  const latency=brain.core.retrieval.retrieveEnvelope('stress graph latency cutoff',{
    intent:'CURRENT',anchorEntityIds:[anchor],channelIds:['ZZ_NATIVE_GRAPH_WALKER'],candidateBudget:5,latencyBudgetMs:0,
    graphTraversal:{maxDepth:1,maxNodes:12,maxEdges:20,maxCandidates:7},
  });
  assert.equal(latency.candidateCount,0);
  assert.ok(latency.metadata.retrievalBudgetReceipt.skippedChannels.includes('ZZ_NATIVE_GRAPH_WALKER'));
  assert.equal(latency.metadata.graphTraversalReceipt,null);

  console.log('GRAPH_STRESS_METRIC',JSON.stringify({
    examinedEdges:receipt.examinedEdgeCount,visitedNodes:receipt.visitedNodeCount,traversedEdges:receipt.traversedEdgeCount,
    graphCandidateCap:receipt.limits.maxCandidates,candidateBusCap:bounded.fusionReceipt.diagnostics.effectiveCandidateLimit,
    finalCandidates:bounded.candidateCount,latencyBudgetMs:latency.metadata.retrievalBudgetReceipt.latencyBudgetMs,
    latencySkipped:latency.metadata.retrievalBudgetReceipt.skippedChannels,
  }));
});

test('DETERMINISTIC: small and large delivery budgets preserve protected truth/source identity while optional lore is omitted without authority promotion',async()=>{
  const brain=new Area52NativeBrain();
  const hard=brain.acceptLore({
    sourceId:'lore:moon-gate:hard-rule',sourceType:'LORE_ENTRY',
    exactContent:'Moon Gate hard rule: during an eclipse the gate remains closed even if the moonrise bell rings.',
    semantic:{subjectId:'Moon Gate',predicate:'exceptionRule',value:'CLOSED_DURING_ECLIPSE'},hardRule:true,
    metadata:{representationText:'Moon Gate hard rule and exception: during an eclipse the gate remains closed even if the moonrise bell rings.'},
  });
  for(let index=0;index<11;index++){
    brain.acceptLore({
      sourceId:'lore:moon-gate:archive:'+index,sourceType:'LORE_ENTRY',
      exactContent:'Moon Gate eclipse archive detail '+index+': '+('optional background chronicle detail '.repeat(22)),
      semantic:{subjectId:'Moon Gate',predicate:'archiveDetail'+index,value:'DETAIL_'+index},
      metadata:{representationText:'Moon Gate eclipse archive detail '+index+': '+('optional background chronicle detail '.repeat(22))},
    });
  }

  await brain.prepareTurn({
    chatId:'chat:budget',turnId:'budget:1',generationId:'gen:budget:1',query:'Observe Moon Gate.',
    scene:scene('moon-gate',1,{location:'Moon Gate',activeCast:['Mara']}),executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'budget:1',response:'The Moon Gate stands open before the eclipse.',knownBy:['Mara'],
    observations:[{subjectId:'Moon Gate',predicate:'state',value:'OPEN',at:1}],
  });
  await brain.prepareTurn({
    chatId:'chat:budget',turnId:'budget:2',generationId:'gen:budget:2',query:'The eclipse arrives.',
    scene:scene('moon-gate-eclipse',2,{location:'Moon Gate',activeCast:['Mara'],relationship:'PRECEDES'}),executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({
    turnId:'budget:2',response:'During the eclipse the Moon Gate closes, while two reports disagree about the omen.',knownBy:['Mara'],
    observations:[
      {subjectId:'Moon Gate',predicate:'state',value:'CLOSED',at:2},
      {subjectId:'Moon Omen',predicate:'meaning',value:'SAFE',at:2},
      {subjectId:'Moon Omen',predicate:'meaning',value:'DANGER',at:2},
    ],
  });

  const prepared=await brain.prepareTurn({
    chatId:'chat:budget',turnId:'budget:3',generationId:'gen:budget:3',
    query:'Moon Gate eclipse archive: give current state, historical state, unresolved omen, rule and exception.',intent:'TEMPORAL',
    scene:scene('moon-gate-eclipse-review',3,{location:'Moon Gate',activeCast:['Mara'],relationship:'CONTINUES'}),
    budgetBytes:20000,budgetTokens:4096,candidateBudget:64,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  const record=brain.readTurn('budget:3'),published=record.published;
  assert.ok((published.packet.current??[]).length>0);
  assert.ok((published.packet.historical??[]).length>0);
  assert.ok((published.packet.unresolved??[]).length>0);
  assert.ok((published.packet.relevantLore??[]).some(row=>row.hardRule===true&&row.sourceRevisionRefs.includes(hard.sourceRevisionId)));

  const large=brain.core.deliverGenerationContext({
    published,generationId:'gen:budget:large',modelProfileId:'CACHE_STABLE',budgetTokens:4096,
    userInput:'Moon Gate eclipse archive: give current state, historical state, unresolved omen, rule and exception.',
  });
  assert.equal(large.ok,true);
  assert.equal((large.plan.dropped?.length??0)+(large.plan.deferred?.length??0),0);

  let small=null,smallBudget=null;
  for(const tokens of [384,448,512,640,768,896,1024,1280,1536]){
    const attempt=brain.core.deliverGenerationContext({
      published,generationId:'gen:budget:small:'+tokens,modelProfileId:'CACHE_STABLE',budgetTokens:tokens,
      userInput:'Moon Gate eclipse archive: give current state, historical state, unresolved omen, rule and exception.',
    });
    if(attempt.ok&&((attempt.plan.dropped?.length??0)+(attempt.plan.deferred?.length??0)>0)){small=attempt;smallBudget=tokens;break;}
  }
  assert.ok(small,'a satisfiable pressure budget with explicit omission/defer should exist');

  for(const plan of [large.plan,small.plan]){
    const present=slots(plan);
    assert.ok(present.has('CURRENT_WORLD_STATE'));
    assert.ok(present.has('HISTORICAL_SUPPORT'));
    assert.ok(present.has('UNRESOLVED_EVIDENCE'));
    assert.ok(present.has('WORLD_FOUNDATION'));
    const hardManifest=plan.sections.flatMap(section=>section.semanticManifest??[]).find(row=>row.sourceRevisionIds?.includes(hard.sourceRevisionId));
    assert.ok(hardManifest);
    assert.equal(hardManifest.authorityClass,'SOURCE_CANON');
    assert.equal(hardManifest.temporalStatus,'CURRENT');
    assert.ok(JSON.stringify(plan.sections).includes(hard.sourceRevisionId));
  }
  assert.ok(small.plan.diagnosticReceipt.budgetDecision.omitted.length>0);
  assert.ok(small.plan.diagnosticReceipt.budgetDecision.hardRuleProtectedSlots.includes('WORLD_FOUNDATION'));
  assert.ok(small.plan.sections.some(section=>section.representation==='COMPACT'));
  assert.equal(small.plan.sealedPacketHash,large.plan.sealedPacketHash);
  assert.equal(small.rendered.sealedPacketHash,large.rendered.sealedPacketHash);

  const restored=Area52NativeBrain.fromSnapshot(brain.snapshot());
  const restoredRecord=restored.readTurn('budget:3');
  assert.equal(restoredRecord.published.sealReceipt.packetHash,published.sealReceipt.packetHash);
  assert.deepEqual(restoredRecord.published.packet,published.packet);
  const replay=restored.core.deliverGenerationContext({
    published:restoredRecord.published,generationId:'gen:budget:replay',modelProfileId:'CACHE_STABLE',budgetTokens:smallBudget,
    userInput:'Moon Gate eclipse archive: give current state, historical state, unresolved omen, rule and exception.',
  });
  assert.equal(replay.ok,true);
  assert.equal(replay.plan.sealedPacketHash,small.plan.sealedPacketHash);
  assert.equal(replay.plan.diagnosticReceipt.semanticManifestHash,small.plan.diagnosticReceipt.semanticManifestHash);

  console.log('CONTEXT_BUDGET_METRIC',JSON.stringify({
    smallBudgetTokens:smallBudget,
    smallAvailable:small.plan.budget.available,smallAllocated:small.plan.budget.allocated,
    smallOmitted:small.plan.diagnosticReceipt.budgetDecision.omitted,
    smallRepresentations:small.plan.diagnosticReceipt.budgetDecision.admitted.map(row=>[row.slot,row.representation]),
    largeAllocated:large.plan.budget.allocated,largeOmitted:large.plan.diagnosticReceipt.budgetDecision.omitted.length,
    sealedPacketHash:small.plan.sealedPacketHash,semanticManifestHash:small.plan.diagnosticReceipt.semanticManifestHash,
  }));
});

test('DETERMINISTIC: quiet continuation stays Hot-only while ambiguous identity turn uses bounded native retrieval without Jev',async()=>{
  const brain=new Area52NativeBrain();
  brain.registerEntityIdentity({entityId:'entity:quiet:ren-a',canonicalLabel:'Ren',entityType:'PERSON',worldId:'world:quiet-a'});
  brain.registerEntityIdentity({entityId:'entity:quiet:ren-b',canonicalLabel:'Ren',entityType:'PERSON',worldId:'world:quiet-b'});
  await brain.prepareTurn({
    chatId:'chat:quiet-identity',turnId:'quiet-identity:1',generationId:'gen:quiet-identity:1',query:'Begin.',
    scene:scene('quiet-room',1,{location:'Quiet Room',activeCast:['Ren']}),executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({turnId:'quiet-identity:1',response:'Ren waits beside the window.',knownBy:['Ren']});
  const quiet=await brain.prepareTurn({
    chatId:'chat:quiet-identity',turnId:'quiet-identity:2',generationId:'gen:quiet-identity:2',query:'Continue.',executionLabel:'DETERMINISTIC',
  });
  assert.ok(quiet.used.paths.includes('HOT_ONLY'));
  assert.ok(quiet.skipped.skippedJobs.includes('RETRIEVAL'));
  assert.ok(quiet.skipped.skippedJobs.includes('GRAPH_WALKER'));
  assert.equal(quiet.graphTraversalReceipt,null);

  const proposal=brain.proposeEntityIdentity({
    action:'AMBIGUOUS',providerId:'SCENE',label:'Ren',candidateEntityIds:['entity:quiet:ren-a','entity:quiet:ren-b'],
    authorityOrigin:'HEURISTIC',explicit:false,provenanceRefs:['scene:ren-ambiguous'],
  });
  assert.equal(brain.settleEntityIdentity(proposal.proposalId,{decision:'ACCEPT'}).state,'UNRESOLVED');
  const ambiguous=await brain.prepareTurn({
    chatId:'chat:quiet-identity',turnId:'quiet-identity:3',generationId:'gen:quiet-identity:3',
    query:'Which Ren is this and what evidence supports the identity?',intent:'TEMPORAL',
    scene:scene('quiet-room-ambiguous',2,{location:'Quiet Room',activeCast:['Ren'],relationship:'CONTINUES'}),
    candidateBudget:8,latencyBudgetMs:1000,graphTraversal:{maxDepth:2,maxNodes:16,maxEdges:24,maxCandidates:8},
    executionLabel:'DETERMINISTIC',
  });
  assert.equal(ambiguous.skipped.jev?.unavailable===true||ambiguous.skipped.jev?.skipped===true,true);
  assert.ok(ambiguous.candidateEnvelope.candidateCount<=8);
  assert.equal(brain.diagnostics().nativeRequirements.jevRequired,false);
  assert.equal(brain.diagnostics().nativeRequirements.sidecarRequired,false);
  assert.equal(brain.diagnostics().nativeRequirements.remoteModelRequired,false);
});
