import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveScope} from '../src/memory-contracts.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';
import {createMemoryIntegrationSurface} from '../src/memory-integration-surface.js';
import {
  OWNER_CONTRACT_REFERENCE,
  sceneArtifactRef,
  sceneProposal,
  sceneEvent,
  coreArtifactRef,
  coreSettlementEnvelope,
} from './fixtures/memory-wave3-owner-shapes.js';

function sceneMapping({
  episodeRef,
  externalEvidenceRef,
  sourceRevisionId,
  exactContent,
  sceneRevision,
  worldRevision=sceneRevision,
  participants=[],
  knownBy=[],
  observationState=null,
  ownerArtifactRef=episodeRef,
  lateForSealedGeneration=false,
}={}){
  return {
    kind:'MemoryExternalEvidenceMappingRequest',
    contractVersion:'1.0.0',
    ownerArtifactRef,
    externalEvidenceRef,
    observationState,
    lateForSealedGeneration,
    source:{
      sourceId:'source:'+sourceRevisionId,
      sourceRevisionId,
      exactContent,
      evidenceKind:'NARRATIVE_EXPERIENCE',
      occurredAt:worldRevision,
      worldRevision,
      sceneRevision,
      participants,
      knownBy,
      perspective:'WORLD',
      metadata:{fixture:'memory-wave3'},
      provenance:['owner-source:'+sourceRevisionId],
    },
    revisionProof:{
      sourceRevisionId,
      ownerArtifactRevision:ownerArtifactRef.revision,
      sceneRevision,
      worldRevision:ownerArtifactRef.worldRevision??undefined,
    },
    provenanceRefs:['wave3-map:'+externalEvidenceRef],
  };
}

function coreMapping({
  artifactRef,
  evidenceId,
  sourceRevisionId,
  exactContent,
  worldRevision,
  participants=[],
  knownBy=[],
}={}){
  return {
    kind:'MemoryExternalEvidenceMappingRequest',
    contractVersion:'1.0.0',
    ownerArtifactRef:artifactRef,
    externalEvidenceRef:evidenceId,
    source:{
      sourceId:'core-source:'+sourceRevisionId,
      sourceRevisionId,
      exactContent,
      evidenceKind:'OBSERVED_EXPERIENCE',
      occurredAt:worldRevision,
      worldRevision,
      sceneRevision:null,
      participants,
      knownBy,
      perspective:'WORLD',
      provenance:['core-source:'+sourceRevisionId],
    },
    revisionProof:{
      sourceRevisionId,
      ownerArtifactRevision:artifactRef.revision,
      worldRevision,
    },
    provenanceRefs:['core-map:'+evidenceId],
  };
}

function boundaryEvent({sceneId,sceneRevision,sourceRevisionRefs,eventId='boundary:'+sceneId+':'+sceneRevision,eventType='SCENE_BOUNDARY_CONFIRMED'}={}){
  return sceneEvent({
    eventId,eventType,sceneId,sceneRevision,sourceRevisionRefs,
    payload:eventType==='SCENE_BOUNDARY_CONFIRMED'
      ? {candidateId:'candidate:'+sceneId,boundaryType:'EXPLICIT',relationship:'CONTINUES'}
      : {candidate:{candidateId:'candidate:'+sceneId}},
  });
}

function episodeReadyEvent({sceneId,sceneRevision,sourceRevisionRefs,episodeRef}={}){
  return sceneEvent({
    eventId:'episode-ready:'+sceneId+':'+sceneRevision,
    eventType:'SCENE_EPISODE_READY',
    sceneId,sceneRevision,sourceRevisionRefs,
    payload:{episodeRef},
    sequence:2,
  });
}

function runCompaction(producer){
  let guard=0;
  while(producer.summaryStatus().pendingWorkUnits&&guard++<50){
    producer.runSummaryCompaction({maxUnits:16});
  }
  assert.equal(producer.summaryStatus().pendingWorkUnits,0);
}

function materializeScene(producer,{
  sceneId,
  sceneRevision=1,
  sourceRevisionId,
  externalEvidenceRef,
  text,
  participants=[],
  knownBy=[],
  observationState=null,
  proposalFirst=false,
}={}){
  const episodeRef=sceneArtifactRef({
    artifactId:'scene-episode:'+sceneId,
    sceneRevision,
    sourceRevisionRefs:[sourceRevisionId],
  });
  const proposal=sceneProposal({
    proposalId:'scene-proposal:'+sceneId,
    sceneId,sceneRevision,episodeRef,
    evidenceRefs:[externalEvidenceRef],
    sourceRevisionRefs:[sourceRevisionId],
  });
  let initialEpisode=null;
  if(proposalFirst)initialEpisode=producer.ingestSceneExperience(proposal,{
    summary:text,participants,knownBy,significance:0.9,timeStart:sceneRevision,timeEnd:sceneRevision,
  });
  const boundary=producer.acceptSceneOwnerEvent(boundaryEvent({sceneId,sceneRevision,sourceRevisionRefs:[sourceRevisionId]}),{currentSceneRevision:sceneRevision});
  producer.acceptSceneOwnerEvent(episodeReadyEvent({sceneId,sceneRevision,sourceRevisionRefs:[sourceRevisionId],episodeRef}),{currentSceneRevision:sceneRevision});
  const mappingInput=sceneMapping({
    episodeRef,externalEvidenceRef,sourceRevisionId,exactContent:text,sceneRevision,
    participants,knownBy,observationState,
  });
  const mappingReceipt=producer.admitExternalEvidenceMapping(mappingInput);
  const episode=proposalFirst
    ? producer.experienceStore.currentEpisodes({freshOnly:false}).find((row)=>row.logicalId===episodeRef.artifactId)
    : producer.ingestSceneExperience(proposal,{
      summary:text,participants,knownBy,significance:0.9,timeStart:sceneRevision,timeEnd:sceneRevision,
    });
  return {episodeRef,proposal,boundary,mappingInput,mappingReceipt,initialEpisode,episode};
}

test('owner contract snapshots match the live branches used for Wave 3 assembly',()=>{
  assert.equal(OWNER_CONTRACT_REFERENCE.scene.sha,'3aaf1c1e9e7e8703dc8c66c5542efb03cc9873cf');
  assert.equal(OWNER_CONTRACT_REFERENCE.core.sha,'ba4619f56db8e4f94873256dc26589e1680b7d29');
});

test('Scene exact evidence arriving before its proposal materializes a fresh episode only after confirmed boundary',()=>{
  const p=new MemoryTemporalProducer();
  const sceneId='ember-before';
  const source='scene-src:before@r1';
  const external='scene-evidence:before';
  const ref=sceneArtifactRef({artifactId:'scene-episode:'+sceneId,sceneRevision:1,sourceRevisionRefs:[source]});
  const mapping=p.admitExternalEvidenceMapping(sceneMapping({
    episodeRef:ref,externalEvidenceRef:external,sourceRevisionId:source,
    exactContent:'Mara lit the Ember Tavern brazier before closing.',sceneRevision:1,
    participants:['Mara','Ember Tavern'],knownBy:['Mara'],
  }));
  assert.equal(mapping.status,'ADMITTED');
  assert.equal(p.summaryHierarchy.scope('SCENE:'+sceneId),null);

  const proposal=sceneProposal({
    proposalId:'scene-proposal:'+sceneId,sceneId,sceneRevision:1,episodeRef:ref,
    evidenceRefs:[external],sourceRevisionRefs:[source],
  });
  const withheld=p.ingestSceneExperience(proposal,{summary:'Mara lit the Ember Tavern brazier before closing.',participants:['Mara','Ember Tavern'],knownBy:['Mara']});
  assert.equal(withheld.freshness,'STALE');
  assert.equal(p.summaryHierarchy.scope('SCENE:'+sceneId),null);

  p.acceptSceneOwnerEvent(boundaryEvent({sceneId,sceneRevision:1,sourceRevisionRefs:[source]}),{currentSceneRevision:1});
  p.acceptSceneOwnerEvent(episodeReadyEvent({sceneId,sceneRevision:1,sourceRevisionRefs:[source],episodeRef:ref}),{currentSceneRevision:1});
  const fresh=p.experienceStore.currentEpisodes({freshOnly:false}).find((row)=>row.logicalId===ref.artifactId);
  assert.equal(fresh.freshness,'FRESH');
  assert.ok(p.summaryHierarchy.scope('SCENE:'+sceneId));

  const exact=p.queryHistorian({query:'who lit the Ember Tavern brazier immediately before closing?',mode:'EXPLICIT_HISTORY'});
  assert.ok(exact.nominations.length>0);
  assert.match(exact.nominations[0].representationText,/Mara/i);
  const drill=p.drillDown(exact.nominations[0]);
  assert.equal(drill[0].exactContent,'Mara lit the Ember Tavern brazier before closing.');
});

test('Scene proposal arriving before evidence stays withheld through candidate boundary and resolves after exact late mapping',()=>{
  const p=new MemoryTemporalProducer();
  const sceneId='ember-after';
  const source='scene-src:after@r1';
  const external='scene-evidence:after';
  const ref=sceneArtifactRef({artifactId:'scene-episode:'+sceneId,sceneRevision:2,sourceRevisionRefs:[source]});
  const proposal=sceneProposal({
    proposalId:'scene-proposal:'+sceneId,sceneId,sceneRevision:2,episodeRef:ref,
    evidenceRefs:[external],sourceRevisionRefs:[source],
  });
  const first=p.ingestSceneExperience(proposal,{summary:'Eris set down the Sun Blade.',participants:['Eris','Sun Blade'],knownBy:['Eris']});
  assert.equal(first.freshness,'STALE');
  assert.equal(p.summaryHierarchy.scope('SCENE:'+sceneId),null);

  const candidate=p.acceptSceneOwnerEvent(boundaryEvent({
    sceneId,sceneRevision:2,sourceRevisionRefs:[source],
    eventId:'boundary-candidate:'+sceneId,eventType:'SCENE_BOUNDARY_CANDIDATE',
  }),{currentSceneRevision:2});
  assert.equal(candidate.status,'RECORDED_NONCONFIRMING');
  assert.equal(p.experienceStore.currentEpisodes({freshOnly:false}).find((row)=>row.logicalId===ref.artifactId).freshness,'STALE');

  p.acceptSceneOwnerEvent(boundaryEvent({sceneId,sceneRevision:2,sourceRevisionRefs:[source]}),{currentSceneRevision:2});
  assert.equal(p.experienceStore.currentEpisodes({freshOnly:false}).find((row)=>row.logicalId===ref.artifactId).freshness,'STALE');

  const late=p.admitExternalEvidenceMapping(sceneMapping({
    episodeRef:ref,externalEvidenceRef:external,sourceRevisionId:source,
    exactContent:'Eris set down the Sun Blade.',sceneRevision:2,
    participants:['Eris','Sun Blade'],knownBy:['Eris'],
  }));
  assert.equal(late.status,'ADMITTED');
  assert.ok(late.materializedSceneEpisodes.some((row)=>row.freshness==='FRESH'));
  assert.ok(p.summaryHierarchy.scope('SCENE:'+sceneId));
});

test('missing source mapping, mentioned-only observation and wrong Scene revision remain withheld',()=>{
  const p=new MemoryTemporalProducer();
  const sceneId='scene-negative';
  const sourceA='scene-negative:a@r1',sourceB='scene-negative:b@r1';
  const external='scene-negative:evidence';
  const ref=sceneArtifactRef({artifactId:'scene-episode:'+sceneId,sceneRevision:4,sourceRevisionRefs:[sourceA,sourceB]});
  const wrong=p.acceptSceneOwnerEvent(boundaryEvent({sceneId,sceneRevision:4,sourceRevisionRefs:[sourceA]}),{currentSceneRevision:5});
  assert.equal(wrong.status,'STALE');

  const proposal=sceneProposal({
    proposalId:'scene-proposal:'+sceneId,sceneId,sceneRevision:4,episodeRef:ref,
    evidenceRefs:[external],sourceRevisionRefs:[sourceA,sourceB],
  });
  p.ingestSceneExperience(proposal,{summary:'A location was only mentioned.',participants:['Mara'],knownBy:['Mara']});
  p.acceptSceneOwnerEvent(boundaryEvent({sceneId,sceneRevision:4,sourceRevisionRefs:[sourceA]}),{currentSceneRevision:4});
  p.admitExternalEvidenceMapping(sceneMapping({
    episodeRef:ref,externalEvidenceRef:external,sourceRevisionId:sourceA,
    exactContent:'The North Gate was mentioned in passing.',sceneRevision:4,
    participants:['Mara'],knownBy:['Mara'],observationState:'MENTIONED_ONLY',
  }));
  const current=p.experienceStore.currentEpisodes({freshOnly:false}).find((row)=>row.logicalId===ref.artifactId);
  assert.equal(current.freshness,'STALE');
  assert.ok(current.bridgeReasonCodes.includes('MEMORY_BRIDGE_MENTIONED_ONLY_NOT_SCENE_EVIDENCE'));
  assert.ok(current.bridgeReasonCodes.includes('MEMORY_BRIDGE_SCENE_SOURCE_MAPPING_MISSING'));
  assert.equal(p.summaryHierarchy.scope('SCENE:'+sceneId),null);
});

test('source correction stales only dependent Scene/Arc retrieval and old owner replay cannot resurrect it',()=>{
  const p=new MemoryTemporalProducer();
  const alpha=materializeScene(p,{
    sceneId:'alpha',sourceRevisionId:'alpha@r1',externalEvidenceRef:'alpha:e1',
    text:'Alpha crossed the old bridge.',participants:['Alpha'],knownBy:['Alpha'],
  });
  const beta=materializeScene(p,{
    sceneId:'beta',sourceRevisionId:'beta@r1',externalEvidenceRef:'beta:e1',
    text:'Beta studied the market ledger.',participants:['Beta'],knownBy:['Beta'],
  });
  p.defineSummaryScope({level:'ARC',scopeId:'alpha',childScopeRefs:['SCENE:alpha']});
  p.defineSummaryScope({level:'ARC',scopeId:'beta',childScopeRefs:['SCENE:beta']});
  runCompaction(p);
  const alphaBefore=p.summaryArtifact('ARC:alpha').id;
  const betaBefore=p.summaryArtifact('ARC:beta').id;

  p.queryHistorian({query:'Alpha bridge overview',resolutionHint:'ARC'});
  p.queryHistorian({query:'Beta market overview',resolutionHint:'ARC'});
  const betaCached=p.queryHistorian({query:'Beta market overview',resolutionHint:'ARC'});
  assert.equal(betaCached.diagnostics.profile.cacheHit,true);

  const invalidated=p.invalidateExternalEvidenceMapping({
    mappingId:alpha.mappingReceipt.mappingId,
    removed:true,
    reason:'SOURCE_EDIT',
  });
  assert.equal(invalidated.status,'INVALIDATED');
  assert.equal(p.summaryArtifact('ARC:alpha'),null);
  assert.equal(p.summaryArtifact('ARC:beta').id,betaBefore);
  assert.equal(p.summaryHistory('ARC:alpha').some((row)=>row.id===alphaBefore),true);

  const alphaNow=p.queryHistorian({query:'Alpha bridge overview',resolutionHint:'ARC'});
  assert.equal(alphaNow.nominations.some((row)=>(row.sourceRevisionRefs??[]).includes('alpha@r1')),false);
  const betaAgain=p.queryHistorian({query:'Beta market overview',resolutionHint:'ARC'});
  assert.ok(betaAgain.nominations.length>0);
  assert.equal(betaAgain.diagnostics.profile.cacheHit,true);

  const replayBoundary=p.acceptSceneOwnerEvent(boundaryEvent({sceneId:'alpha',sceneRevision:1,sourceRevisionRefs:['alpha@r1']}),{currentSceneRevision:1});
  assert.equal(replayBoundary.status,'REPLAYED');
  assert.equal(p.experienceStore.currentEpisodes({freshOnly:false}).find((row)=>row.logicalId==='scene-episode:alpha').freshness,'STALE');
  assert.throws(()=>p.admitExternalEvidenceMapping(alpha.mappingInput),/Source revision is already stale/);
});

test('mapped Core Settlement changes Tavern CURRENT only with matching owner decision and receipt',()=>{
  const p=new MemoryTemporalProducer();
  const intactRef=coreArtifactRef({evidenceId:'core:ev:intact',sourceRevisionId:'core:intact@r1',worldRevision:1});
  const destroyRef=coreArtifactRef({evidenceId:'core:ev:destroyed',sourceRevisionId:'core:destroyed@r1',worldRevision:2});
  p.admitExternalEvidenceMapping(coreMapping({
    artifactRef:intactRef,evidenceId:'core:ev:intact',sourceRevisionId:'core:intact@r1',
    exactContent:'The Ember Tavern stood intact before the fire.',worldRevision:1,
    participants:['Ember Tavern'],knownBy:['Mara','Eris'],
  }));
  p.admitExternalEvidenceMapping(coreMapping({
    artifactRef:destroyRef,evidenceId:'core:ev:destroyed',sourceRevisionId:'core:destroyed@r1',
    exactContent:'The Ember Tavern burned and was destroyed.',worldRevision:2,
    participants:['Ember Tavern'],knownBy:['Mara','Eris'],
  }));

  const intact=coreSettlementEnvelope({
    proposalId:'core:p:intact',claimId:'core:c:intact',evidenceId:'core:ev:intact',
    sourceRevisionId:'core:intact@r1',subjectId:'Ember Tavern',predicate:'state',value:'INTACT',worldRevision:1,
  });
  const intactReceipt=p.applyCoreSettlement(intact,{evidenceArtifactRefs:[{externalEvidenceRef:'core:ev:intact',artifactRef:intactRef}]});
  assert.equal(intactReceipt.status,'APPLIED');
  assert.equal(p.currentProjection().find((row)=>row.subjectId==='Ember Tavern').value,'INTACT');

  const destroyed=coreSettlementEnvelope({
    proposalId:'core:p:destroyed',claimId:'core:c:destroyed',evidenceId:'core:ev:destroyed',
    sourceRevisionId:'core:destroyed@r1',subjectId:'Ember Tavern',predicate:'state',value:'DESTROYED',worldRevision:2,
    decision:'SUPERSEDE',
  });
  const destroyedReceipt=p.applyCoreSettlement(destroyed,{evidenceArtifactRefs:[{externalEvidenceRef:'core:ev:destroyed',artifactRef:destroyRef}]});
  assert.equal(destroyedReceipt.status,'APPLIED');
  assert.equal(p.currentProjection().find((row)=>row.subjectId==='Ember Tavern').value,'DESTROYED');
  assert.equal(p.asOf(1).current.find((row)=>row.subjectId==='Ember Tavern').value,'INTACT');
  assert.ok(p.historicalClaims().some((row)=>row.value==='INTACT'&&row.status==='HISTORICAL'));

  const replay=p.applyCoreSettlement(destroyed,{evidenceArtifactRefs:[{externalEvidenceRef:'core:ev:destroyed',artifactRef:destroyRef}]});
  assert.equal(replay.status,'REPLAYED');
});

test('mapped Core evidence without matching owner receipt cannot mutate canonical state',()=>{
  const p=new MemoryTemporalProducer();
  const ref=coreArtifactRef({evidenceId:'core:ev:no-receipt',sourceRevisionId:'core:no-receipt@r1',worldRevision:1});
  p.admitExternalEvidenceMapping(coreMapping({
    artifactRef:ref,evidenceId:'core:ev:no-receipt',sourceRevisionId:'core:no-receipt@r1',
    exactContent:'The door appears open.',worldRevision:1,participants:['Door'],knownBy:['Mara'],
  }));
  const envelope=coreSettlementEnvelope({
    proposalId:'core:p:no-receipt',claimId:'core:c:no-receipt',evidenceId:'core:ev:no-receipt',
    sourceRevisionId:'core:no-receipt@r1',subjectId:'Door',predicate:'state',value:'OPEN',worldRevision:1,
    includeReceipt:false,
  });
  const receipt=p.applyCoreSettlement(envelope,{evidenceArtifactRefs:[{externalEvidenceRef:'core:ev:no-receipt',artifactRef:ref}]});
  assert.equal(receipt.status,'REJECTED');
  assert.match(receipt.reasonCode,/MEMORY_SETTLEMENT_RECEIPT_REQUIRED/);
  assert.equal(p.currentProjection().some((row)=>row.subjectId==='Door'),false);
});

test('Sun Blade fate remains UNRESOLVED despite exact mapping and retrieval ranking',()=>{
  const p=new MemoryTemporalProducer();
  for(const row of [
    {id:'core:blade:destroyed',src:'core:blade:destroyed@r1',value:'DESTROYED_IN_FIRE',world:4,text:'One account says the Sun Blade was destroyed in the fire.'},
    {id:'core:blade:removed',src:'core:blade:removed@r1',value:'REMOVED_BEFORE_FIRE',world:4,text:'Another account says the Sun Blade was removed before the fire.'},
  ]){
    const ref=coreArtifactRef({evidenceId:row.id,sourceRevisionId:row.src,worldRevision:row.world});
    p.admitExternalEvidenceMapping(coreMapping({artifactRef:ref,evidenceId:row.id,sourceRevisionId:row.src,exactContent:row.text,worldRevision:row.world,participants:['Sun Blade'],knownBy:['Mara']}));
    const envelope=coreSettlementEnvelope({
      proposalId:'core:p:'+row.value,claimId:'core:c:'+row.value,evidenceId:row.id,sourceRevisionId:row.src,
      subjectId:'Sun Blade',predicate:'fate',value:row.value,worldRevision:row.world,decision:'UNRESOLVED',temporalKind:'HISTORICAL',
    });
    const receipt=p.applyCoreSettlement(envelope,{evidenceArtifactRefs:[{externalEvidenceRef:row.id,artifactRef:ref}]});
    assert.equal(receipt.status,'APPLIED');
  }
  const unresolved=p.unresolvedSets({subjectId:'Sun Blade',predicate:'fate'});
  assert.equal(unresolved.length,1);
  assert.deepEqual(new Set(unresolved[0].claims.map((row)=>row.value)),new Set(['DESTROYED_IN_FIRE','REMOVED_BEFORE_FIRE']));
  assert.equal(p.currentProjection().some((row)=>row.subjectId==='Sun Blade'&&row.predicate==='fate'),false);
  const result=p.queryHistorian({query:'Sun Blade fate history',mode:'EXPLICIT_HISTORY'});
  assert.ok(result.nominations.length>0);
  assert.equal(result.nominations.some((row)=>row.truthStatusHint==='CURRENT'),false);
});

test('Eris perspective cannot retrieve Mara-only secret through episode, summary, cache or drillback',()=>{
  const p=new MemoryTemporalProducer();
  materializeScene(p,{
    sceneId:'secret',sourceRevisionId:'secret@r1',externalEvidenceRef:'secret:e1',
    text:'Mara hid the cellar ledger under the stove.',participants:['Mara'],knownBy:['Mara'],
  });
  runCompaction(p);

  const world=p.queryHistorian({query:'cellar ledger overview',breadth:'BROAD',perspectiveConstraint:{scope:PerspectiveScope.WORLD}});
  assert.ok(world.nominations.some((row)=>/cellar ledger/i.test(row.representationText)));
  const worldCached=p.queryHistorian({query:'cellar ledger overview',breadth:'BROAD',perspectiveConstraint:{scope:PerspectiveScope.WORLD}});
  assert.equal(worldCached.diagnostics.profile.cacheHit,true);

  const eris=p.queryHistorian({query:'cellar ledger overview',breadth:'BROAD',perspectiveConstraint:{scope:PerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'Eris'}});
  assert.equal(eris.nominations.some((row)=>/cellar ledger/i.test(row.representationText)),false);

  const exactEris=p.queryHistorian({query:'where was the cellar ledger hidden?',mode:'EXPLICIT_HISTORY',perspectiveConstraint:{scope:PerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'Eris'}});
  assert.equal(exactEris.nominations.length,0);

  const worldNomination=world.nominations[0];
  const fencedDrill=p.drillDown(worldNomination,{perspectiveConstraint:{scope:PerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'Eris'}});
  assert.deepEqual(fencedDrill,[]);
});

test('mapping replay is idempotent and identity, authority, content, fence and seal violations fail closed',()=>{
  const p=new MemoryTemporalProducer();
  const ref=sceneArtifactRef({artifactId:'scene-episode:map-neg',sceneRevision:3,sourceRevisionRefs:['map-neg@r1']});
  const input=sceneMapping({
    episodeRef:ref,externalEvidenceRef:'map-neg:e1',sourceRevisionId:'map-neg@r1',
    exactContent:'Exact observed event.',sceneRevision:3,participants:['Mara'],knownBy:['Mara'],
  });
  const first=p.admitExternalEvidenceMapping(input);
  const replay=p.admitExternalEvidenceMapping(input);
  assert.equal(first.status,'ADMITTED');
  assert.equal(replay.status,'REPLAYED');
  assert.equal(first.mappingId,replay.mappingId);
  assert.equal(p.evidenceBridge.status().mappings,1);

  assert.throws(()=>p.admitExternalEvidenceMapping({
    ...input,
    source:{...input.source,exactContent:'Conflicting content under the same owner identity.'},
  }),/conflicting exact content/i);
  assert.throws(()=>p.admitExternalEvidenceMapping({...input,authorityGranted:true}),/cannot grant authority/i);
  assert.throws(()=>p.admitExternalEvidenceMapping({...input,source:{...input.source,exactContent:''}}),/Exact source\/evidence content is required/);
  assert.throws(()=>p.admitExternalEvidenceMapping({
    ...input,
    ownerArtifactRef:{...ref,sceneRevision:4},
  }),/Scene revision does not match owner artifact reference/);
  assert.throws(()=>p.admitExternalEvidenceMapping({...input,lateForSealedGeneration:true}),/Late sealed-generation material/);

  const coreRef=coreArtifactRef({evidenceId:'core:wrong-world',sourceRevisionId:'core:wrong-world@r1',worldRevision:5});
  assert.throws(()=>p.admitExternalEvidenceMapping(coreMapping({
    artifactRef:coreRef,evidenceId:'core:wrong-world',sourceRevisionId:'core:wrong-world@r1',
    exactContent:'World-fenced evidence.',worldRevision:4,
  })),/World revision does not match owner artifact reference/);
});

test('stale owner artifact revision and invalidated source cannot be replayed as fresh',()=>{
  const p=new MemoryTemporalProducer();
  const ref1=sceneArtifactRef({artifactId:'scene-episode:revisioned',sceneRevision:1,sourceRevisionRefs:['revisioned@r1'],revision:1});
  const first=sceneMapping({episodeRef:ref1,externalEvidenceRef:'revisioned:e1',sourceRevisionId:'revisioned@r1',exactContent:'Revision one.',sceneRevision:1});
  const receipt=p.admitExternalEvidenceMapping(first);
  p.invalidateExternalEvidenceMapping({mappingId:receipt.mappingId,removed:true,reason:'SOURCE_EDIT'});
  assert.throws(()=>p.admitExternalEvidenceMapping(first),/Source revision is already stale/);

  const ref2=sceneArtifactRef({artifactId:'scene-episode:revisioned-2',sceneRevision:2,sourceRevisionRefs:['revisioned-2@r2'],revision:2});
  const second=sceneMapping({episodeRef:ref2,externalEvidenceRef:'revisioned-2:e1',sourceRevisionId:'revisioned-2@r2',exactContent:'Revision two.',sceneRevision:2});
  p.admitExternalEvidenceMapping(second);
  const staleRef={...ref2,revision:1};
  assert.throws(()=>p.admitExternalEvidenceMapping({
    ...second,
    ownerArtifactRef:staleRef,
    revisionProof:{...second.revisionProof,ownerArtifactRevision:1},
  }),/older than the active mapping/);
});

test('snapshot reload preserves bridge mappings, raw evidence, summary query index and bounded cache correctness',()=>{
  let p=new MemoryTemporalProducer();
  materializeScene(p,{
    sceneId:'reload',sourceRevisionId:'reload@r1',externalEvidenceRef:'reload:e1',
    text:'Mara returned to the Ember Tavern.',participants:['Mara','Ember Tavern'],knownBy:['Mara'],
  });
  runCompaction(p);
  const first=p.queryHistorian({query:'Ember Tavern recap',breadth:'BROAD'});
  assert.ok(first.nominations.length>0);
  p.queryHistorian({query:'Ember Tavern recap',breadth:'BROAD'});
  const before=p.status();
  assert.ok(before.summaryHierarchy.queryIndex.artifacts>0);
  assert.ok(before.summaryHierarchy.queryCache.entries>0);
  assert.equal(before.evidenceBridge.currentMappings,1);
  const raw=p.graph.evidence.size;

  p=MemoryTemporalProducer.fromSnapshot(p.snapshot());
  const after=p.status();
  assert.equal(p.graph.evidence.size,raw);
  assert.equal(after.evidenceBridge.currentMappings,1);
  assert.equal(after.summaryHierarchy.queryIndex.dirty,false);
  assert.ok(after.summaryHierarchy.queryCache.entries>0);
  const query=p.queryHistorian({query:'Ember Tavern recap',breadth:'BROAD'});
  assert.ok(query.nominations.length>0);
  assert.equal(query.diagnostics.profile.cacheHit,true);
});

test('public assembly surface runs live owner shapes through production bridge paths without mock authority',()=>{
  const p=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(p);
  const sceneId='assembly';
  const source='assembly:scene@r1';
  const external='assembly:scene-evidence';
  const ref=sceneArtifactRef({artifactId:'scene-episode:'+sceneId,sceneRevision:1,sourceRevisionRefs:[source]});
  const proposal=sceneProposal({proposalId:'scene-proposal:'+sceneId,sceneId,sceneRevision:1,episodeRef:ref,evidenceRefs:[external],sourceRevisionRefs:[source]});

  surface.adapters.acceptSceneExperience(proposal,{summary:'Mara opened the Ember Tavern.',participants:['Mara','Ember Tavern'],knownBy:['Mara']});
  surface.adapters.acceptSceneOwnerEvent(boundaryEvent({sceneId,sceneRevision:1,sourceRevisionRefs:[source]}),{currentSceneRevision:1});
  surface.adapters.acceptSceneOwnerEvent(episodeReadyEvent({sceneId,sceneRevision:1,sourceRevisionRefs:[source],episodeRef:ref}),{currentSceneRevision:1});
  surface.adapters.admitExternalEvidenceMapping(sceneMapping({
    episodeRef:ref,externalEvidenceRef:external,sourceRevisionId:source,
    exactContent:'Mara opened the Ember Tavern.',sceneRevision:1,participants:['Mara','Ember Tavern'],knownBy:['Mara'],
  }));
  const memory=surface.adapters.queryHistorian({query:'who opened the Ember Tavern immediately?',mode:'EXPLICIT_HISTORY'});
  assert.ok(memory.nominations.length>0);
  assert.equal(surface.adapters.drillDown(memory.nominations[0])[0].exactContent,'Mara opened the Ember Tavern.');

  const coreRef=coreArtifactRef({evidenceId:'assembly:core-evidence',sourceRevisionId:'assembly:core@r1',worldRevision:1});
  surface.adapters.admitExternalEvidenceMapping(coreMapping({
    artifactRef:coreRef,evidenceId:'assembly:core-evidence',sourceRevisionId:'assembly:core@r1',
    exactContent:'The Ember Tavern is open.',worldRevision:1,participants:['Ember Tavern'],knownBy:['Mara'],
  }));
  const envelope=coreSettlementEnvelope({
    proposalId:'assembly:proposal',claimId:'assembly:claim',evidenceId:'assembly:core-evidence',
    sourceRevisionId:'assembly:core@r1',subjectId:'Ember Tavern',predicate:'state',value:'OPEN',worldRevision:1,
  });
  const settled=surface.adapters.applyCoreSettlement(envelope,{evidenceArtifactRefs:[{externalEvidenceRef:'assembly:core-evidence',artifactRef:coreRef}]});
  assert.equal(settled.status,'APPLIED');
  assert.equal(surface.adapters.currentProjection().find((row)=>row.subjectId==='Ember Tavern').value,'OPEN');
  assert.equal(surface.authority.memoryOwnsCanonicalSettlement,false);
  assert.equal(surface.authority.evidenceMappingAuthority,false);
});

test('hierarchy profiling reports legacy versus indexed p50/p95 without assuming a speedup',()=>{
  const p=new MemoryTemporalProducer();
  for(let i=0;i<24;i++){
    const ev=p.appendEvidence({
      id:'profile:ev:'+i,sourceId:'profile:src:'+i,sourceRevisionId:'profile:src:'+i+'@r1',
      exactContent:'ProfileActor'+i+' visited ProfileDistrict'+(i%6)+'.',occurredAt:i,worldRevision:i,sceneRevision:i,
      participants:['ProfileActor'+i],knownBy:['ProfileActor'+i],
    });
    p.publishEpisode({
      logicalId:'profile:ep:'+i,sceneId:'profile:scene:'+i,sceneRevision:i+1,
      sourceRevisionRefs:[ev.sourceRevisionId],evidenceRefs:[ev.id],participants:['ProfileActor'+i],knownBy:['ProfileActor'+i],
      summary:'ProfileActor'+i+' visited ProfileDistrict'+(i%6)+'.',significance:0.5,
    });
    p.defineSummaryScope({level:'SCENE',scopeId:'profile-'+i,evidenceRefs:[ev.id],episodeLogicalIds:['profile:ep:'+i],parentScopeRefs:['ARC:profile']});
  }
  p.defineSummaryScope({level:'ARC',scopeId:'profile',childScopeRefs:Array.from({length:24},(_,i)=>'SCENE:profile-'+i)});
  runCompaction(p);
  const profile=p.profileHierarchyQuery({query:'ProfileDistrict0 overview',resolutionHint:'ARC'},{iterations:12,warmup:2});
  assert.equal(profile.status,'MEASURED');
  assert.ok(profile.before.p50Ms>=0&&profile.before.p95Ms>=profile.before.p50Ms);
  assert.ok(profile.afterIndexedCold.p50Ms>=0&&profile.afterIndexedCold.p95Ms>=profile.afterIndexedCold.p50Ms);
  assert.ok(profile.afterWarmCache.p50Ms>=0&&profile.afterWarmCache.p95Ms>=profile.afterWarmCache.p50Ms);
  assert.ok(profile.afterIndexedCold.artifactsExamined<=profile.before.artifactsExamined);
});
