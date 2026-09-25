import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveScope} from '../src/memory-contracts.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';
import {createMemoryIntegrationSurface} from '../src/memory-integration-surface.js';
import {
  sceneArtifactRef,
  sceneProposal,
  sceneEvent,
  coreArtifactRef,
  coreSettlementEnvelope,
} from './fixtures/memory-wave3-owner-shapes.js';

const FORBIDDEN_FIXTURE_NAMES=/Ember Tavern|\bMara\b|\bEris\b|Sun Blade/i;

function identity(chatId,turnId,generationId,correlationId){
  return {chatId,turnId,generationId,correlationId};
}

function sceneExactMapping({
  episodeRef,
  externalEvidenceRef,
  sourceRevisionId,
  exactContent,
  sceneRevision,
  worldRevision=sceneRevision,
  participants=[],
  knownBy=[],
  hostIdentity,
  observationState=null,
}={}){
  return {
    kind:'MemoryExternalEvidenceMappingRequest',
    contractVersion:'1.0.0',
    ownerArtifactRef:episodeRef,
    externalEvidenceRef,
    observationState,
    source:{
      sourceId:'narrative:'+sourceRevisionId,
      sourceRevisionId,
      exactContent,
      evidenceKind:'NARRATIVE_EXPERIENCE',
      occurredAt:worldRevision,
      worldRevision,
      sceneRevision,
      participants,
      knownBy,
      perspective:'WORLD',
      metadata:{...hostIdentity,fixture:'wave4-general-world'},
      provenance:['host-narrative:'+sourceRevisionId],
    },
    revisionProof:{
      sourceRevisionId,
      ownerArtifactRevision:episodeRef.revision,
      sceneRevision,
    },
    provenanceRefs:['wave4-scene-map:'+externalEvidenceRef],
  };
}

function coreExactMapping({
  artifactRef,
  evidenceId,
  sourceRevisionId,
  exactContent,
  worldRevision,
  participants=[],
  knownBy=[],
  hostIdentity,
}={}){
  return {
    kind:'MemoryExternalEvidenceMappingRequest',
    contractVersion:'1.0.0',
    ownerArtifactRef:artifactRef,
    externalEvidenceRef:evidenceId,
    source:{
      sourceId:'world-event:'+sourceRevisionId,
      sourceRevisionId,
      exactContent,
      evidenceKind:'OBSERVED_EXPERIENCE',
      occurredAt:worldRevision,
      worldRevision,
      sceneRevision:null,
      participants,
      knownBy,
      perspective:'WORLD',
      metadata:{...hostIdentity,fixture:'wave4-general-world'},
      provenance:['world-observation:'+sourceRevisionId],
    },
    revisionProof:{
      sourceRevisionId,
      ownerArtifactRevision:artifactRef.revision,
      worldRevision,
    },
    provenanceRefs:['wave4-core-map:'+evidenceId],
  };
}

function boundary({sceneId,sceneRevision,sourceRevisionRefs,eventType='SCENE_BOUNDARY_CONFIRMED',eventId=null}={}){
  return sceneEvent({
    eventId:eventId??((eventType==='SCENE_BOUNDARY_CONFIRMED'?'boundary:':'candidate:')+sceneId+':'+sceneRevision),
    eventType,sceneId,sceneRevision,sourceRevisionRefs,
    payload:eventType==='SCENE_BOUNDARY_CONFIRMED'
      ? {candidateId:'boundary-candidate:'+sceneId,boundaryType:'EXPLICIT',relationship:'CONTINUES'}
      : {candidate:{candidateId:'boundary-candidate:'+sceneId}},
  });
}

function ready({sceneId,sceneRevision,sourceRevisionRefs,episodeRef}={}){
  return sceneEvent({
    eventId:'episode-ready:'+sceneId+':'+sceneRevision,
    eventType:'SCENE_EPISODE_READY',
    sceneId,sceneRevision,sourceRevisionRefs,
    payload:{episodeRef},
    sequence:2,
  });
}

function runSummary(surface){
  let guard=0;
  while(surface.adapters.summaryStatus().pendingWorkUnits&&guard++<64){
    surface.adapters.runSummaryCompaction({maxUnits:16});
  }
  assert.equal(surface.adapters.summaryStatus().pendingWorkUnits,0);
}

function admitScene(surface,{
  chatId,turnId,generationId,correlationId,
  sceneId,sceneRevision,sourceRevisionId,externalEvidenceRef,text,
  participants=[],knownBy=[],confirmed=true,
}={}){
  const hostIdentity=identity(chatId,turnId,generationId,correlationId);
  const episodeRef=sceneArtifactRef({
    artifactId:'scene-episode:'+chatId+':'+sceneId,
    sceneRevision,
    sourceRevisionRefs:[sourceRevisionId],
  });
  const proposal=sceneProposal({
    proposalId:'scene-proposal:'+chatId+':'+sceneId,
    sceneId,sceneRevision,episodeRef,
    evidenceRefs:[externalEvidenceRef],
    sourceRevisionRefs:[sourceRevisionId],
  });
  const initial=surface.adapters.acceptSceneExperience(proposal,{
    summary:text,participants,knownBy,significance:0.85,
    timeStart:sceneRevision,timeEnd:sceneRevision,currentSceneRevision:sceneRevision,
  });
  if(confirmed){
    surface.adapters.acceptSceneOwnerEvent(boundary({sceneId,sceneRevision,sourceRevisionRefs:[sourceRevisionId]}),{currentSceneRevision:sceneRevision});
    surface.adapters.acceptSceneOwnerEvent(ready({sceneId,sceneRevision,sourceRevisionRefs:[sourceRevisionId],episodeRef}),{currentSceneRevision:sceneRevision});
  }else{
    surface.adapters.acceptSceneOwnerEvent(boundary({
      sceneId,sceneRevision,sourceRevisionRefs:[sourceRevisionId],
      eventType:'SCENE_BOUNDARY_CANDIDATE',
    }),{currentSceneRevision:sceneRevision});
  }
  const mappingInput=sceneExactMapping({
    episodeRef,externalEvidenceRef,sourceRevisionId,exactContent:text,sceneRevision,
    participants,knownBy,hostIdentity,
  });
  const mapping=surface.adapters.admitExternalEvidenceMapping(mappingInput);
  const episode=surface.adapters.queryHistorian({
    query:participants[0]??text,
    mode:'EXPLICIT_HISTORY',
    selection:{...hostIdentity,worldRevision:sceneRevision,sceneRevision,sourceRevisionRefs:[sourceRevisionId]},
  });
  return {hostIdentity,episodeRef,proposal,initial,mappingInput,mapping,query:episode};
}

function settle(surface,{
  hostIdentity,
  evidenceId,
  sourceRevisionId,
  exactContent,
  subjectId,
  predicate,
  value,
  worldRevision,
  decision='ACCEPT_CURRENT',
  temporalKind='CURRENT',
  participants=[subjectId],
  knownBy=[],
}={}){
  const ref=coreArtifactRef({evidenceId,sourceRevisionId,worldRevision});
  const mapping=surface.adapters.admitExternalEvidenceMapping(coreExactMapping({
    artifactRef:ref,evidenceId,sourceRevisionId,exactContent,worldRevision,
    participants,knownBy,hostIdentity,
  }));
  const envelope=coreSettlementEnvelope({
    proposalId:'proposal:'+evidenceId,
    claimId:'claim:'+evidenceId,
    evidenceId,
    sourceRevisionId,
    subjectId,predicate,value,worldRevision,decision,temporalKind,
  });
  const receipt=surface.adapters.applyCoreSettlement(envelope,{
    evidenceArtifactRefs:[{externalEvidenceRef:evidenceId,artifactRef:ref}],
  });
  return {ref,mapping,envelope,receipt};
}

function makeWorlds(){
  const producer=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(producer);

  const coast={
    chatId:'chat:glass-coast',
    turnId:'turn:coast:2',
    generationId:'gen:coast:2',
    correlationId:'corr:coast:2',
  };
  const vale={
    chatId:'chat:ironwood-vale',
    turnId:'turn:vale:4',
    generationId:'gen:vale:4',
    correlationId:'corr:vale:4',
  };

  const coastScene=admitScene(surface,{
    ...coast,sceneId:'moonrail-arrival',sceneRevision:1,
    sourceRevisionId:'coast:narrative@r1',externalEvidenceRef:'coast:event:arrival',
    text:'Lio stepped from the moonrail into Bellspire Station while Tovan watched the tide clocks.',
    participants:['Lio','Tovan','Bellspire Station'],knownBy:['Lio','Tovan'],
  });

  const location1=settle(surface,{
    hostIdentity:coast,evidenceId:'coast:location:station',sourceRevisionId:'coast:location@r1',
    exactContent:'Lio was at Bellspire Station when the moonrail arrived.',
    subjectId:'Lio',predicate:'location',value:'Bellspire Station',worldRevision:1,
    participants:['Lio','Bellspire Station'],knownBy:['Lio','Tovan'],
  });
  const location2=settle(surface,{
    hostIdentity:{...coast,turnId:'turn:coast:2',generationId:'gen:coast:2'},
    evidenceId:'coast:location:harbor',sourceRevisionId:'coast:location@r2',
    exactContent:'Later, Lio crossed the causeway and entered Cloudglass Harbor.',
    subjectId:'Lio',predicate:'location',value:'Cloudglass Harbor',worldRevision:2,
    decision:'SUPERSEDE',participants:['Lio','Cloudglass Harbor'],knownBy:['Lio','Tovan'],
  });

  const privateScene=admitScene(surface,{
    ...coast,turnId:'turn:coast:3',generationId:'gen:coast:3',correlationId:'corr:coast:3',
    sceneId:'observatory-secret',sceneRevision:3,
    sourceRevisionId:'coast:secret@r1',externalEvidenceRef:'coast:event:secret',
    text:'Tovan hid the blue transit key behind the western star chart.',
    participants:['Tovan','blue transit key'],knownBy:['Tovan'],
  });

  const valeScene=admitScene(surface,{
    ...vale,sceneId:'root-court',sceneRevision:4,
    sourceRevisionId:'vale:narrative@r1',externalEvidenceRef:'vale:event:court',
    text:'Iona and Pell entered the Root Court while witnesses argued about the Crown Seed.',
    participants:['Iona','Pell','Crown Seed'],knownBy:['Iona','Pell'],
  });

  const buried=settle(surface,{
    hostIdentity:vale,evidenceId:'vale:fate:buried',sourceRevisionId:'vale:fate:buried@r1',
    exactContent:'Keeper Oru reported that the Crown Seed was buried beneath the ash roots.',
    subjectId:'Crown Seed',predicate:'fate',value:'BURIED_BENEATH_ASH_ROOTS',worldRevision:4,
    decision:'UNRESOLVED',temporalKind:'HISTORICAL',
    participants:['Crown Seed','Keeper Oru'],knownBy:['Iona'],
  });
  const stolen=settle(surface,{
    hostIdentity:vale,evidenceId:'vale:fate:stolen',sourceRevisionId:'vale:fate:stolen@r1',
    exactContent:'Scout Nemi reported that the Crown Seed was stolen north before dawn.',
    subjectId:'Crown Seed',predicate:'fate',value:'STOLEN_NORTH',worldRevision:4,
    decision:'UNRESOLVED',temporalKind:'HISTORICAL',
    participants:['Crown Seed','Scout Nemi'],knownBy:['Pell'],
  });

  producer.reviseReflection({
    reflectionKey:'vale:witness-disagreement',
    statement:'The witnesses in the Root Court may be relying on incompatible accounts.',
    subjectRefs:['Crown Seed'],
    supportEvidenceRefs:[buried.mapping.memoryEvidenceId],
    contradictionEvidenceRefs:[stolen.mapping.memoryEvidenceId],
    sourceRevisionRefs:['vale:fate:buried@r1','vale:fate:stolen@r1'],
    confidence:0.72,
    action:'REINFORCE',
    provenance:['wave4-general-reflection'],
  });

  runSummary(surface);
  return {producer,surface,coast,vale,coastScene,privateScene,valeScene,location1,location2,buried,stolen};
}

test('Wave 4 general-world fixtures contain no legacy fixed-scenario names',()=>{
  const source=JSON.stringify(makeWorlds().surface.adapters.readMemory({chatId:'chat:glass-coast'}));
  assert.doesNotMatch(source,FORBIDDEN_FIXTURE_NAMES);
});

test('general world A preserves a justified location transition, as-of history and selected-chat Historian output',()=>{
  const {surface,producer,coast}=makeWorlds();
  const current=surface.adapters.currentProjection({includeStale:false}).find((row)=>row.subjectId==='Lio'&&row.predicate==='location');
  assert.equal(current.value,'Cloudglass Harbor');
  const prior=surface.adapters.asOf(1).current.find((row)=>row.subjectId==='Lio'&&row.predicate==='location');
  assert.equal(prior.value,'Bellspire Station');
  assert.ok(producer.historicalClaims({subjectId:'Lio',predicate:'location'}).some((row)=>row.value==='Bellspire Station'&&row.status==='HISTORICAL'));

  const exact=surface.adapters.queryHistorian({
    query:'where did Lio arrive at the moonrail?',
    mode:'EXPLICIT_HISTORY',
    precisionRequired:true,
    selection:{...coast,worldRevision:2,sceneRevision:1},
  });
  assert.ok(exact.nominations.length>0);
  assert.ok(exact.nominations.every((row)=>surface.adapters.drillDown(row,{selection:coast}).every((ev)=>ev.metadata.chatId===coast.chatId)));

  const broad=surface.adapters.queryHistorian({
    query:'Lio travel overview',
    breadth:'BROAD',
    selection:{...coast,worldRevision:2},
  });
  assert.ok(broad.nominations.length>0);
  assert.ok(broad.nominations.every((row)=>surface.adapters.drillDown(row,{selection:coast}).every((ev)=>ev.metadata.chatId===coast.chatId)));
});

test('general world B keeps conflicting reports unresolved despite Reflection and retrieval ranking',()=>{
  const {surface,producer,vale}=makeWorlds();
  const unresolved=producer.unresolvedSets({subjectId:'Crown Seed',predicate:'fate'});
  assert.equal(unresolved.length,1);
  assert.deepEqual(new Set(unresolved[0].claims.map((row)=>row.value)),new Set(['BURIED_BENEATH_ASH_ROOTS','STOLEN_NORTH']));
  assert.equal(surface.adapters.currentProjection().some((row)=>row.subjectId==='Crown Seed'&&row.predicate==='fate'),false);

  const reflections=producer.experienceStore.currentReflections({freshOnly:true}).filter((row)=>row.reflectionKey==='vale:witness-disagreement');
  assert.equal(reflections.length,1);
  assert.equal(reflections[0].authorityClass,'INFERRED');

  const result=surface.adapters.queryHistorian({
    query:'Crown Seed fate history',
    mode:'EXPLICIT_HISTORY',
    selection:{...vale,worldRevision:4,sceneRevision:4},
  });
  assert.ok(result.nominations.length>0);
  assert.equal(result.nominations.some((row)=>row.truthStatusHint==='CURRENT'&&row.claimRefs?.length),false);

  const pretendJev={
    kind:'JevDecisionReceipt',outcome:'DECIDED',confidence:0.99,
    selectedOptionIds:['BURIED_BENEATH_ASH_ROOTS'],authorityGranted:false,settlementPerformed:false,
  };
  assert.equal(pretendJev.settlementPerformed,false);
  assert.equal(producer.currentProjection().some((row)=>row.subjectId==='Crown Seed'&&row.predicate==='fate'),false);
});

test('selected-chat Historian fences before ranking even when another world has many matching records',()=>{
  const {surface,producer,coast,vale}=makeWorlds();
  for(let i=0;i<90;i++){
    producer.appendEvidence({
      id:'vale:crowd:'+i,sourceId:'vale:crowd-source:'+i,sourceRevisionId:'vale:crowd-source:'+i+'@r1',
      exactContent:'Lio travel moonrail decoy account '+i+' belongs to a different world.',
      kind:'EXPERIENCE',occurredAt:10+i,worldRevision:10+i,
      participants:['Decoy'+i],knownBy:['Pell'],
      metadata:{...vale,turnId:'turn:vale:crowd',generationId:'gen:vale:crowd'},
      provenance:['crowd-test'],
    });
    producer.publishEpisode({
      logicalId:'vale:crowd-episode:'+i,
      sourceRevisionRefs:['vale:crowd-source:'+i+'@r1'],
      evidenceRefs:['vale:crowd:'+i],
      participants:['Decoy'+i],knownBy:['Pell'],
      summary:'Lio travel moonrail decoy account '+i+'.',
      significance:1,
    });
  }
  producer.rebuildHistorian();
  const selected=surface.adapters.queryHistorian({
    query:'Lio travel moonrail',
    mode:'EXPLICIT_HISTORY',
    maxCandidates:8,
    selection:{...coast,worldRevision:2},
  });
  assert.ok(selected.nominations.length>0);
  for(const row of selected.nominations){
    const exact=surface.adapters.drillDown(row,{selection:coast});
    assert.ok(exact.length>0);
    assert.ok(exact.every((ev)=>ev.metadata.chatId===coast.chatId));
  }
});

test('character perspective cannot reveal private evidence through episode, summary, cache or drillback',()=>{
  const {surface,coast}=makeWorlds();
  const selection={...coast,turnId:'turn:coast:3',generationId:'gen:coast:3',correlationId:'corr:coast:3',worldRevision:3,sceneRevision:3};
  const world=surface.adapters.queryHistorian({
    query:'blue transit key overview',breadth:'BROAD',selection,
  });
  assert.ok(world.nominations.some((row)=>/transit key/i.test(row.representationText)));

  const hidden=surface.adapters.queryHistorian({
    query:'blue transit key overview',breadth:'BROAD',selection,
    perspectiveConstraint:{scope:PerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'Lio'},
  });
  assert.equal(hidden.nominations.some((row)=>/transit key/i.test(row.representationText)),false);

  const exact=surface.adapters.queryHistorian({
    query:'where was the blue transit key hidden?',precisionRequired:true,selection,
    perspectiveConstraint:{scope:PerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'Lio'},
  });
  assert.equal(exact.nominations.length,0);

  const cached=surface.adapters.queryHistorian({
    query:'blue transit key overview',breadth:'BROAD',selection,
    perspectiveConstraint:{scope:PerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'Lio'},
  });
  assert.equal(cached.nominations.some((row)=>/transit key/i.test(row.representationText)),false);

  const worldNom=world.nominations.find((row)=>/transit key/i.test(row.representationText));
  assert.deepEqual(surface.adapters.drillDown(worldNom,{
    selection,
    perspectiveConstraint:{scope:PerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'Lio'},
  }),[]);
});

test('source correction invalidates one world dependency cone while unrelated world summary identity survives',()=>{
  const {surface,producer,coast,vale,coastScene}=makeWorlds();
  surface.adapters.defineSummaryScope({level:'ARC',scopeId:'coast-arc',childScopeRefs:['SCENE:moonrail-arrival','SCENE:observatory-secret']});
  surface.adapters.defineSummaryScope({level:'ARC',scopeId:'vale-arc',childScopeRefs:['SCENE:root-court']});
  runSummary(surface);
  const coastBefore=surface.adapters.summaryArtifact('ARC:coast-arc').id;
  const valeBefore=surface.adapters.summaryArtifact('ARC:vale-arc').id;

  const invalidation=surface.adapters.invalidateExternalEvidenceMapping({
    mappingId:coastScene.mapping.mappingId,
    removed:true,
    reason:'USER_EDITED_SOURCE',
  });
  assert.equal(invalidation.status,'INVALIDATED');
  assert.equal(surface.adapters.summaryArtifact('ARC:coast-arc'),null);
  assert.equal(surface.adapters.summaryArtifact('ARC:vale-arc').id,valeBefore);
  assert.ok(surface.adapters.summaryHistory('ARC:coast-arc').some((row)=>row.id===coastBefore));

  const valeQuery=surface.adapters.queryHistorian({
    query:'Root Court Crown Seed overview',resolutionHint:'ARC',
    selection:{...vale,worldRevision:4,sceneRevision:4},
  });
  assert.ok(valeQuery.nominations.length>0);
  assert.equal(valeQuery.nominations.some((row)=>(row.sourceRevisionRefs??[]).includes('coast:narrative@r1')),false);
});

test('unconfirmed boundary, wrong revision, forged authority and late sealed evidence fail closed with reasons',()=>{
  const producer=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(producer);
  const hostIdentity=identity('chat:opal-steppe','turn:1','gen:1','corr:1');
  const sceneId='wind-gate',sceneRevision=2,sourceRevisionId='steppe:event@r1',externalEvidenceRef='steppe:event:gate';
  const episodeRef=sceneArtifactRef({artifactId:'scene-episode:wind-gate',sceneRevision,sourceRevisionRefs:[sourceRevisionId]});
  const proposal=sceneProposal({
    proposalId:'scene-proposal:wind-gate',sceneId,sceneRevision,episodeRef,
    evidenceRefs:[externalEvidenceRef],sourceRevisionRefs:[sourceRevisionId],
  });
  surface.adapters.acceptSceneExperience(proposal,{summary:'Kesh reached the Wind Gate.',participants:['Kesh'],knownBy:['Kesh']});
  surface.adapters.acceptSceneOwnerEvent(boundary({sceneId,sceneRevision,sourceRevisionRefs:[sourceRevisionId],eventType:'SCENE_BOUNDARY_CANDIDATE'}),{currentSceneRevision:sceneRevision});
  surface.adapters.admitExternalEvidenceMapping(sceneExactMapping({
    episodeRef,externalEvidenceRef,sourceRevisionId,exactContent:'Kesh reached the Wind Gate.',sceneRevision,
    participants:['Kesh'],knownBy:['Kesh'],hostIdentity,
  }));
  const episode=producer.experienceStore.currentEpisodes({freshOnly:false}).find((row)=>row.logicalId===episodeRef.artifactId);
  assert.equal(episode.freshness,'STALE');
  assert.ok(episode.bridgeReasonCodes.includes('MEMORY_BRIDGE_SCENE_BOUNDARY_UNCONFIRMED'));

  const wrong=surface.adapters.acceptSceneOwnerEvent(boundary({sceneId,sceneRevision,sourceRevisionRefs:[sourceRevisionId]}),{currentSceneRevision:sceneRevision+1});
  assert.equal(wrong.status,'STALE');
  assert.equal(wrong.reasonCode,'MEMORY_BRIDGE_SCENE_FENCE_MISMATCH');

  assert.throws(()=>surface.adapters.admitExternalEvidenceMapping({
    ...sceneExactMapping({
      episodeRef,externalEvidenceRef:'steppe:forged',sourceRevisionId:'steppe:forged@r1',
      exactContent:'Forged authority.',sceneRevision,hostIdentity,
    }),
    authorityGranted:true,
  }),/cannot grant authority/i);

  assert.throws(()=>surface.adapters.admitExternalEvidenceMapping({
    ...sceneExactMapping({
      episodeRef:{...episodeRef,sourceRevisionSet:['steppe:late@r1'],sourceRevisionRefs:['steppe:late@r1']},
      externalEvidenceRef:'steppe:late',sourceRevisionId:'steppe:late@r1',
      exactContent:'Late sealed material.',sceneRevision,hostIdentity,
    }),
    lateForSealedGeneration:true,
  }),/Late sealed-generation material/);
});

test('Memory UI producer follows selected chat and generation and never falls back to another retrieval receipt',()=>{
  const {surface,producer,coast,vale}=makeWorlds();
  let selection={...coast,worldRevision:2,sceneRevision:1,sourceRevisionRefs:['coast:narrative@r1','coast:location@r2']};
  const memory=surface.adapters.createMemoryUiProducer({readSelection:()=>selection});
  const events=[];
  const release=memory.subscribe((event)=>events.push(event));

  const coastRead=memory.read();
  assert.equal(coastRead.chatId,coast.chatId);
  assert.ok(coastRead.evidence.length>0);
  assert.ok(coastRead.evidence.every((row)=>row.identity.chatId===coast.chatId));
  assert.equal(JSON.stringify(coastRead).includes(vale.chatId),false);

  surface.adapters.queryHistorian({
    query:'Lio moonrail arrival',precisionRequired:true,selection,
  });
  const withRetrieval=memory.read();
  assert.ok(withRetrieval.retrieval);
  assert.equal(withRetrieval.retrieval.selection.generationId,coast.generationId);

  selection={...coast,turnId:'turn:coast:new',generationId:'gen:coast:new',correlationId:'corr:coast:new',worldRevision:3};
  const nextGeneration=memory.read();
  assert.equal(nextGeneration.retrieval,null);

  selection={...vale,worldRevision:4,sceneRevision:4};
  const valeRead=memory.read();
  assert.equal(valeRead.chatId,vale.chatId);
  assert.ok(valeRead.evidence.every((row)=>row.identity.chatId===vale.chatId));
  assert.equal(JSON.stringify(valeRead).includes(coast.chatId),false);

  producer.appendEvidence({
    id:'vale:ui:update',sourceId:'vale:ui',sourceRevisionId:'vale:ui@r1',
    exactContent:'Pell marked a new witness note.',kind:'EXPERIENCE',occurredAt:5,worldRevision:5,
    participants:['Pell'],knownBy:['Pell'],metadata:{...vale},provenance:['ui-update'],
  });
  assert.ok(events.some((event)=>event.type==='MEMORY_EVIDENCE_APPENDED'));
  assert.ok(events.every((event)=>event.rawEvidenceIncluded===false));
  release();
});

test('Memory consolidation work is bounded, reloadable and fenced away from an already sealed generation',()=>{
  let producer=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(producer);
  const selection=identity('chat:sable-isles','turn:9','gen:9','corr:9');
  const ev=producer.appendEvidence({
    id:'sable:habit:1',sourceId:'sable:habit',sourceRevisionId:'sable:habit@r1',
    exactContent:'Nara checked the tide compass before entering the reef channel.',
    kind:'EXPERIENCE',occurredAt:9,worldRevision:9,participants:['Nara'],knownBy:['Nara'],
    metadata:{...selection},provenance:['sable-habit'],
  });
  const session=surface.adapters.startConsolidation([{
    type:'REFLECTION',
    input:{
      reflectionKey:'sable:nara:tide-check',
      statement:'Nara may habitually verify tide conditions before difficult crossings.',
      subjectRefs:['Nara'],supportEvidenceRefs:[ev.id],contradictionEvidenceRefs:[],
      episodeRefs:[],sourceRevisionRefs:[ev.sourceRevisionId],confidence:0.62,action:'REINFORCE',
      provenance:['wave4-sleep'],
    },
  }],{
    selection,generationFence:{...selection,contextSealId:'seal:gen:9'},
    sourceRevisionRefs:[ev.sourceRevisionId],worldRevision:9,sceneRevision:null,
  });
  const units=surface.adapters.consolidationWorkUnits(session.id,{maxUnits:32});
  assert.equal(units.length,1);
  assert.equal(units[0].generationFence.generationId,'gen:9');
  assert.equal(units[0].runtimeSchedulingAuthority,false);
  assert.equal(units[0].contextSealAuthority,false);

  const parked=surface.adapters.runConsolidation(session.id,{sealedGenerationIds:['gen:9']});
  assert.equal(parked.state,'PARKED_AFTER_SEAL');
  assert.equal(parked.cursor,0);
  assert.deepEqual(parked.publishedArtifactIds,[]);
  assert.equal(parked.lateDisposition.destination,'NEXT_TURN');
  assert.equal(parked.lateDisposition.contextSealMutation,false);

  const snapshot=producer.snapshot();
  producer=MemoryTemporalProducer.fromSnapshot(snapshot);
  const restored=createMemoryIntegrationSurface(producer);
  const resumed=restored.adapters.runConsolidation(session.id,{sealedGenerationIds:[]});
  assert.equal(resumed.state,'COMPLETED');
  assert.equal(resumed.publishedArtifactIds.length,1);
  const firstArtifact=resumed.publishedArtifactIds[0];
  const replay=restored.adapters.runConsolidation(session.id,{sealedGenerationIds:[]});
  assert.equal(replay.publishedArtifactIds.length,1);
  assert.equal(replay.publishedArtifactIds[0],firstArtifact);
  assert.equal(producer.graph.exactEvidence(ev.id).exactContent,'Nara checked the tide compass before entering the reef channel.');
});

test('consolidation revision fence rejects stale source work without publishing a Reflection',()=>{
  const producer=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(producer);
  const selection=identity('chat:sable-isles','turn:10','gen:10','corr:10');
  const ev=producer.appendEvidence({
    id:'sable:stale:1',sourceId:'sable:stale',sourceRevisionId:'sable:stale@r1',
    exactContent:'A temporary observation.',kind:'EXPERIENCE',occurredAt:10,worldRevision:10,
    participants:['Nara'],knownBy:['Nara'],metadata:{...selection},provenance:['stale-work'],
  });
  const session=surface.adapters.startConsolidation([{
    type:'REFLECTION',
    input:{
      reflectionKey:'sable:stale-pattern',statement:'This should never publish from stale evidence.',
      subjectRefs:['Nara'],supportEvidenceRefs:[ev.id],sourceRevisionRefs:[ev.sourceRevisionId],
      confidence:0.5,action:'REINFORCE',
    },
  }],{selection,sourceRevisionRefs:[ev.sourceRevisionId],worldRevision:10});
  producer.invalidateSourceRevision(ev.sourceRevisionId,{removed:true,reason:'USER_CORRECTION'});
  const result=surface.adapters.runConsolidation(session.id);
  assert.equal(result.state,'STALE');
  assert.equal(result.cursor,0);
  assert.deepEqual(result.publishedArtifactIds,[]);
  assert.equal(result.lateDisposition.reasonCode,'MEMORY_CONSOLIDATION_INPUT_REVISION_STALE');
  assert.equal(producer.experienceStore.currentReflections({freshOnly:false}).some((row)=>row.reflectionKey==='sable:stale-pattern'),false);
});
