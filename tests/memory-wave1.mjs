import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthorityClass,
  KnowledgeStatus,
  MEMORY_LIMITS,
  MutationType,
  PerspectiveScope,
  SettlementDecisionType,
  stableStringify,
} from '../src/memory-contracts.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';
import {createMemoryIntegrationFixture,createMemoryIntegrationSurface} from '../src/memory-integration-surface.js';

function evidence(producer,{
  id,
  sourceId=id,
  sourceRevisionId=id+'@r1',
  text,
  worldRevision=0,
  sceneRevision=null,
  participants=[],
  knownBy=[],
  perspective='WORLD',
}={}) {
  return producer.appendEvidence({
    id,
    sourceId,
    sourceRevisionId,
    exactContent:text,
    kind:'EXPERIENCE',
    occurredAt:worldRevision,
    worldRevision,
    sceneRevision,
    participants,
    knownBy,
    perspective,
    provenance:['test:'+id],
  });
}

function settlementEnvelope({
  evidenceId,
  sourceRevisionId,
  claimId,
  subjectId,
  predicate,
  value,
  worldRevision,
  decision=SettlementDecisionType.ACCEPT_CURRENT,
  authorityClass=AuthorityClass.OBSERVED,
  temporalKind='CURRENT',
  validFrom=worldRevision,
  reason='test settlement',
}={}) {
  const proposalId='proposal:'+claimId;
  const claim={
    kind:'Claim',
    id:claimId,
    subjectId,
    predicate,
    value,
    temporal:{kind:temporalKind,validFrom},
    authorityClass,
    confidence:1,
    provenance:{sourceRevisionIds:[sourceRevisionId],evidenceIds:[evidenceId]},
    owner:'WORLD_STATE',
    semanticKey:subjectId+'|'+predicate+'|'+JSON.stringify(value),
    explicitness:'EXPLICIT',
  };
  return {
    proposal:{
      kind:'MutationProposal',
      id:proposalId,
      mutationType:MutationType.SET_CLAIM,
      owner:'WORLD_STATE',
      sourceRevisionIds:[sourceRevisionId],
      evidenceIds:[evidenceId],
      freshnessRevisionIds:[sourceRevisionId],
      payload:{claim},
      status:'PROPOSED',
    },
    decision:{
      kind:'SettlementDecision',
      id:'decision:'+claimId,
      proposalId,
      decision,
      owner:'WORLD_STATE',
      evidenceIds:[evidenceId],
      sourceRevisionIds:[sourceRevisionId],
      worldRevision,
      reason,
      consideredClaimIds:[],
      receiptId:'receipt:'+claimId,
      diagnostics:{validation:[{ok:true}]},
    },
    receipt:{
      kind:'SettlementReceipt',
      id:'receipt:'+claimId,
      proposalId,
      owner:'WORLD_STATE',
      outcome:'SETTLED',
      settledArtifactIds:[claimId],
      supersededArtifactIds:[],
      revision:worldRevision,
      reason:null,
    },
  };
}

function greenInference({characterRef,sceneRevision,evidenceId,sourceRevisionId,supportIdentity,dimensions={trustTrend:'DOWN'},confidence=0.8,createdAt=0}={}) {
  return {
    kind:'GreenRoomInference',
    contractVersion:'1.1.0',
    characterRef,
    sceneRevision,
    directEvidenceRefs:[evidenceId],
    evidenceRefs:[evidenceId],
    priorInferenceRefs:[],
    confidence,
    dimensions,
    createdAt,
    updatedAt:createdAt,
    expiryCondition:{
      onSceneClose:true,
      onSceneReplacement:true,
      onMajorTimeShift:true,
      onCharacterDeparture:true,
      onContradiction:true,
      onSourceRevisionInvalidation:true,
      ttlTurns:2,
    },
    sourceRevisionSet:[sourceRevisionId],
    supportIdentity,
    authority:'INFERRED',
    canonical:false,
    settlementAuthority:false,
    memoryMutation:false,
    characterStateMutation:false,
  };
}

function greenBatch(sceneRevision,characters) {
  return {
    kind:'GreenRoomBatch',
    contractVersion:'1.1.0',
    sceneRevision,
    characters,
    authority:'INFERRED',
    canonical:false,
    durableMutation:false,
  };
}

function buildEmberMemory() {
  const producer=new MemoryTemporalProducer();

  const intact=evidence(producer,{
    id:'ev:tavern-intact',
    sourceId:'event:tavern-intact',
    sourceRevisionId:'event:tavern-intact@r1',
    text:'The Ember Tavern stood intact before the fire.',
    worldRevision:1,
    participants:['Mara','Ember Tavern'],
    knownBy:['Mara','Eris'],
  });
  producer.applySettlement(settlementEnvelope({
    evidenceId:intact.id,
    sourceRevisionId:intact.sourceRevisionId,
    claimId:'claim:tavern-intact',
    subjectId:'Ember Tavern',
    predicate:'state',
    value:'INTACT',
    worldRevision:1,
    decision:SettlementDecisionType.ACCEPT_CURRENT,
    temporalKind:'CURRENT',
  }));

  const fire=evidence(producer,{
    id:'ev:tavern-fire',
    sourceId:'event:tavern-fire',
    sourceRevisionId:'event:tavern-fire@r1',
    text:'The Ember Tavern burned and was destroyed.',
    worldRevision:2,
    participants:['Mara','Eris','Ember Tavern'],
    knownBy:['Mara','Eris'],
  });
  producer.applySettlement(settlementEnvelope({
    evidenceId:fire.id,
    sourceRevisionId:fire.sourceRevisionId,
    claimId:'claim:tavern-destroyed',
    subjectId:'Ember Tavern',
    predicate:'state',
    value:'DESTROYED',
    worldRevision:2,
    decision:SettlementDecisionType.SUPERSEDE,
    temporalKind:'CURRENT',
  }));

  const bladeHistory=evidence(producer,{
    id:'ev:blade-history',
    sourceId:'event:blade-history',
    sourceRevisionId:'event:blade-history@r1',
    text:'Eris carried the Sun Blade and later left it at the Ember Tavern.',
    worldRevision:3,
    participants:['Eris','Sun Blade','Ember Tavern'],
    knownBy:['Eris','Mara'],
  });
  producer.applySettlement(settlementEnvelope({
    evidenceId:bladeHistory.id,
    sourceRevisionId:bladeHistory.sourceRevisionId,
    claimId:'claim:eris-carried-blade',
    subjectId:'Eris',
    predicate:'carried',
    value:'Sun Blade',
    worldRevision:3,
    decision:SettlementDecisionType.ACCEPT_HISTORICAL,
    temporalKind:'HISTORICAL',
    validFrom:1,
  }));
  producer.applySettlement(settlementEnvelope({
    evidenceId:bladeHistory.id,
    sourceRevisionId:bladeHistory.sourceRevisionId,
    claimId:'claim:blade-at-tavern',
    subjectId:'Sun Blade',
    predicate:'locatedAt',
    value:'Ember Tavern',
    worldRevision:3,
    decision:SettlementDecisionType.ACCEPT_HISTORICAL,
    temporalKind:'HISTORICAL',
    validFrom:2,
  }));

  const fateDestroyed=evidence(producer,{
    id:'ev:blade-destroyed',
    sourceId:'event:blade-fate-destroyed',
    sourceRevisionId:'event:blade-fate-destroyed@r1',
    text:'One account says the Sun Blade was destroyed in the Ember Tavern fire.',
    worldRevision:4,
    participants:['Sun Blade'],
    knownBy:['Mara'],
  });
  const fateRemoved=evidence(producer,{
    id:'ev:blade-removed',
    sourceId:'event:blade-fate-removed',
    sourceRevisionId:'event:blade-fate-removed@r1',
    text:'Another account says the Sun Blade was removed before the fire.',
    worldRevision:4,
    participants:['Sun Blade'],
    knownBy:['Eris'],
  });
  for (const [ev,claimId,value] of [
    [fateDestroyed,'claim:blade-fate-destroyed','DESTROYED_IN_FIRE'],
    [fateRemoved,'claim:blade-fate-removed','REMOVED_BEFORE_FIRE'],
  ]) {
    producer.applySettlement(settlementEnvelope({
      evidenceId:ev.id,
      sourceRevisionId:ev.sourceRevisionId,
      claimId,
      subjectId:'Sun Blade',
      predicate:'fate',
      value,
      worldRevision:4,
      decision:SettlementDecisionType.UNRESOLVED,
      authorityClass:AuthorityClass.UNRESOLVED,
      temporalKind:'UNRESOLVED',
      validFrom:4,
    }));
  }

  producer.publishEpisode({
    logicalId:'episode:blade-history',
    sceneId:'scene:tavern-before-fire',
    sceneRevision:1,
    sourceRevisionRefs:[bladeHistory.sourceRevisionId],
    evidenceRefs:[bladeHistory.id],
    participants:['Eris','Sun Blade','Ember Tavern'],
    knownBy:['Eris','Mara'],
    significance:0.9,
    timeStart:1,
    timeEnd:2,
    summary:'Eris carried the Sun Blade and later left it at the Ember Tavern.',
  });
  producer.publishEpisode({
    logicalId:'episode:tavern-fire',
    sceneId:'scene:tavern-fire',
    sceneRevision:2,
    sourceRevisionRefs:[fire.sourceRevisionId],
    evidenceRefs:[fire.id],
    participants:['Mara','Eris','Ember Tavern'],
    knownBy:['Mara','Eris'],
    significance:1,
    timeStart:2,
    timeEnd:2,
    summary:'The Ember Tavern burned and was destroyed.',
  });
  producer.rebuildHistorian();
  return producer;
}

test('Temporal State Graph reconstructs current and prior Tavern state without erasing history', () => {
  const producer=buildEmberMemory();
  const current=producer.currentProjection();
  const tavern=current.find((row)=>row.subjectId==='Ember Tavern'&&row.predicate==='state');
  assert.equal(tavern.value,'DESTROYED');
  assert.equal(tavern.status,KnowledgeStatus.CURRENT);
  assert.equal(tavern.freshness,'FRESH');

  const history=producer.historicalClaims({subjectId:'Ember Tavern',predicate:'state'});
  assert.equal(history.length,2);
  assert.equal(history[0].value,'INTACT');
  assert.equal(history[0].status,KnowledgeStatus.HISTORICAL);
  assert.equal(history[1].value,'DESTROYED');
  assert.equal(history[1].status,KnowledgeStatus.CURRENT);

  const before=producer.asOf(1);
  assert.equal(before.current.find((row)=>row.subjectId==='Ember Tavern'&&row.predicate==='state')?.value,'INTACT');
  const after=producer.asOf(2);
  assert.equal(after.current.find((row)=>row.subjectId==='Ember Tavern'&&row.predicate==='state')?.value,'DESTROYED');

  const explanation=producer.graph.explainClaim('claim:tavern-intact');
  assert.equal(explanation.evidence[0].exactContent,'The Ember Tavern stood intact before the fire.');
  assert.ok(explanation.transitions.some((row)=>row.transition==='SUPERSEDED_BY'&&row.relatedClaimId==='claim:tavern-destroyed'));
});

test('historical Blade placement remains historical and competing Blade fate remains unresolved', () => {
  const producer=buildEmberMemory();
  const bladeHistory=producer.historicalClaims({subjectId:'Sun Blade'});
  const location=bladeHistory.find((row)=>row.predicate==='locatedAt');
  assert.equal(location.value,'Ember Tavern');
  assert.equal(location.status,KnowledgeStatus.HISTORICAL);
  assert.equal(producer.currentProjection().some((row)=>row.subjectId==='Sun Blade'&&row.predicate==='fate'),false);

  const unresolved=producer.unresolvedSets({subjectId:'Sun Blade',predicate:'fate'});
  assert.equal(unresolved.length,1);
  assert.deepEqual(new Set(unresolved[0].claims.map((row)=>row.value)),new Set(['DESTROYED_IN_FIRE','REMOVED_BEFORE_FIRE']));
  assert.equal(unresolved[0].status,KnowledgeStatus.UNRESOLVED);
});

test('entity traversal preserves current, historical and unresolved claims with provenance', () => {
  const producer=buildEmberMemory();
  const traversal=producer.traverseEntity('Sun Blade');
  assert.ok(traversal.claims.some((row)=>row.predicate==='locatedAt'&&row.status===KnowledgeStatus.HISTORICAL));
  assert.equal(traversal.claims.filter((row)=>row.predicate==='fate'&&row.status===KnowledgeStatus.UNRESOLVED).length,2);
  assert.equal(traversal.authorityGranted,false);
});

test('only validated owner Settlement may mutate canonical projection and replay is idempotent', () => {
  const producer=new MemoryTemporalProducer();
  const ev=evidence(producer,{id:'ev:settle',sourceRevisionId:'settle@r1',text:'The door is open.',worldRevision:1});
  const envelope=settlementEnvelope({
    evidenceId:ev.id,sourceRevisionId:ev.sourceRevisionId,claimId:'claim:door-open',
    subjectId:'Door',predicate:'state',value:'OPEN',worldRevision:1,
  });
  producer.applySettlement(envelope);
  const before=producer.graph.settlementJournal.length;
  const replay=producer.applySettlement(envelope);
  assert.equal(replay.kind,'MemorySettlementReplayReceipt');
  assert.equal(producer.graph.settlementJournal.length,before);

  const inferred=settlementEnvelope({
    evidenceId:ev.id,sourceRevisionId:ev.sourceRevisionId,claimId:'claim:door-inferred',
    subjectId:'Door',predicate:'mood',value:'OMINOUS',worldRevision:2,authorityClass:AuthorityClass.INFERRED,
  });
  assert.throws(()=>producer.applySettlement(inferred),/CANONICAL_AUTHORITY_REJECTED/);
  assert.equal(producer.currentProjection().some((row)=>row.id==='claim:door-inferred'),false);

  const badReceipt=settlementEnvelope({
    evidenceId:ev.id,sourceRevisionId:ev.sourceRevisionId,claimId:'claim:bad-receipt',
    subjectId:'Door',predicate:'locked',value:true,worldRevision:3,
  });
  badReceipt.receipt.proposalId='wrong';
  assert.throws(()=>producer.applySettlement(badReceipt),/RECEIPT_PROPOSAL_MISMATCH/);
});

test('Green Room distrust remains INFERRED, can seed Reflection, expires, and never becomes Character State or canon', () => {
  const producer=new MemoryTemporalProducer();
  const inputs=[];
  for (let i=1;i<=3;i++) {
    const ev=evidence(producer,{
      id:'ev:distrust:'+i,
      sourceRevisionId:'distrust:'+i+'@r1',
      text:'Eris shows a sign of growing distrust '+i+'.',
      worldRevision:i,
      sceneRevision:5,
      participants:['Eris'],
      knownBy:['Mara'],
    });
    inputs.push({ev,i});
    producer.ingestGreenRoomBatch(greenBatch(5,[
      greenInference({
        characterRef:'Eris',sceneRevision:5,evidenceId:ev.id,sourceRevisionId:ev.sourceRevisionId,
        supportIdentity:'support:distrust:'+i,dimensions:{trustTrend:'DOWN',guardedness:0.8},confidence:0.7+i*0.05,createdAt:i,
      }),
    ]),{turnSequence:i});
  }
  const shadow=producer.greenRoomShadow({sceneRevision:5,turnSequence:3});
  assert.equal(shadow.characters.length,1);
  assert.equal(shadow.characters[0].authority,AuthorityClass.INFERRED);
  assert.equal(shadow.canonical,false);

  const proposal=producer.greenRoomReflectionProposal('Eris');
  assert.equal(proposal.observationCount,3);
  assert.equal(proposal.authority,AuthorityClass.INFERRED);
  assert.equal(proposal.characterStateMutation,false);
  const reflection=producer.reflectionFromGreenRoomProposal(proposal,{
    statement:'Eris appears increasingly distrustful.',
    confidence:0.91,
  });
  assert.equal(reflection.authorityClass,AuthorityClass.INFERRED);
  assert.equal(reflection.worldTruthAuthority,false);
  assert.equal(producer.currentProjection().some((row)=>row.subjectId==='Eris'&&row.predicate==='trust'),false);

  const expiry=producer.expireGreenRoom({sceneRevision:6,turnSequence:4});
  assert.equal(expiry.expired.length,1);
  assert.equal(producer.greenRoomShadow({sceneRevision:6,turnSequence:4}).characters.length,0);
  assert.equal(producer.experienceStore.currentReflections()[0].id,reflection.id);
});

test('Reflection revisions reinforce or weaken inferential meaning without mutating world truth', () => {
  const producer=new MemoryTemporalProducer();
  const ev1=evidence(producer,{id:'ev:r1',sourceRevisionId:'r1@1',text:'Mara trusted Eris once.',knownBy:['Mara']});
  const ev2=evidence(producer,{id:'ev:r2',sourceRevisionId:'r2@1',text:'Mara later hesitated.',knownBy:['Mara']});
  const first=producer.reviseReflection({
    reflectionKey:'relationship:mara-eris',
    statement:'Mara tends to trust Eris.',
    subjectRefs:['Mara','Eris'],
    supportEvidenceRefs:[ev1.id],
    confidence:0.7,
    action:'REINFORCE',
  });
  const second=producer.reviseReflection({
    reflectionKey:'relationship:mara-eris',
    statement:'Mara trusts Eris, but with growing hesitation.',
    subjectRefs:['Mara','Eris'],
    supportEvidenceRefs:[ev1.id],
    contradictionEvidenceRefs:[ev2.id],
    confidence:0.55,
    action:'WEAKEN',
  });
  assert.notEqual(first.id,second.id);
  assert.equal(producer.experienceStore.reflectionHistory('relationship:mara-eris').length,2);
  assert.equal(producer.experienceStore.reflections.get(first.id).state,'HISTORICAL');
  assert.equal(second.authorityClass,AuthorityClass.INFERRED);
  assert.equal(producer.currentProjection().some((row)=>row.subjectId==='Mara'&&row.predicate==='trust'),false);
});

test('source correction stales only dependent episode/reflection/Historian records while unrelated identity remains reusable', () => {
  const producer=new MemoryTemporalProducer();
  const a=evidence(producer,{id:'ev:a-old',sourceRevisionId:'source:a@r1',text:'Aster crossed the Old Bridge.',participants:['Aster'],knownBy:['Aster']});
  const b=evidence(producer,{id:'ev:b',sourceRevisionId:'source:b@r1',text:'Bryn visited the market.',participants:['Bryn'],knownBy:['Bryn']});
  const epA=producer.publishEpisode({logicalId:'ep:a',sourceRevisionRefs:[a.sourceRevisionId],evidenceRefs:[a.id],participants:['Aster'],knownBy:['Aster'],summary:'Aster crossed the Old Bridge.',significance:0.8});
  const epB=producer.publishEpisode({logicalId:'ep:b',sourceRevisionRefs:[b.sourceRevisionId],evidenceRefs:[b.id],participants:['Bryn'],knownBy:['Bryn'],summary:'Bryn visited the market.',significance:0.8});
  const refA=producer.reviseReflection({reflectionKey:'ref:a',statement:'Aster knows the Old Bridge route.',subjectRefs:['Aster'],supportEvidenceRefs:[a.id],episodeRefs:[epA.id],confidence:0.7});
  const refB=producer.reviseReflection({reflectionKey:'ref:b',statement:'Bryn frequents the market.',subjectRefs:['Bryn'],supportEvidenceRefs:[b.id],episodeRefs:[epB.id],confidence:0.7});
  producer.rebuildHistorian();

  const unrelatedEpisodeId=producer.experienceStore.currentEpisodes().find((row)=>row.logicalId==='ep:b').id;
  const unrelatedReflectionId=producer.experienceStore.currentReflections().find((row)=>row.reflectionKey==='ref:b').id;
  assert.ok(producer.queryHistorian({query:'Old Bridge',mode:'EXPLICIT_HISTORY'}).nominations.length>0);

  const receipt=producer.invalidateSourceRevision('source:a@r1',{replacedBy:'source:a@r2'});
  assert.ok(receipt.staleEpisodeIds.includes(epA.id));
  assert.ok(receipt.staleReflectionIds.includes(refA.id));
  assert.equal(receipt.staleEpisodeIds.includes(epB.id),false);
  assert.equal(receipt.staleReflectionIds.includes(refB.id),false);
  assert.equal(producer.experienceStore.currentEpisodes().find((row)=>row.logicalId==='ep:b').id,unrelatedEpisodeId);
  assert.equal(producer.experienceStore.currentReflections().find((row)=>row.reflectionKey==='ref:b').id,unrelatedReflectionId);
  assert.equal(producer.queryHistorian({query:'Old Bridge',mode:'EXPLICIT_HISTORY'}).nominations.length,0);
  assert.ok(producer.queryHistorian({query:'market',mode:'EXPLICIT_HISTORY'}).nominations.length>0);
  assert.equal(producer.graph.exactEvidence(a.id).exactContent,'Aster crossed the Old Bridge.');
});

test('Historian relevance beats irrelevant recency and every nomination drills to raw evidence', () => {
  const producer=new MemoryTemporalProducer();
  const relevant=evidence(producer,{id:'ev:old-relevant',sourceRevisionId:'old@r1',text:'Eris left the Sun Blade at the Ember Tavern.',worldRevision:1,participants:['Eris','Sun Blade'],knownBy:['Eris']});
  producer.publishEpisode({logicalId:'ep:old',sourceRevisionRefs:[relevant.sourceRevisionId],evidenceRefs:[relevant.id],participants:['Eris','Sun Blade'],knownBy:['Eris'],summary:'Eris left the Sun Blade at the Ember Tavern.',significance:0.9,timeStart:1,timeEnd:1});
  for (let i=0;i<20;i++) {
    const ev=evidence(producer,{id:'ev:recent:'+i,sourceRevisionId:'recent:'+i+'@r1',text:'A recent unrelated weather observation '+i+'.',worldRevision:10+i,participants:['Mara'],knownBy:['Mara']});
    producer.publishEpisode({logicalId:'ep:recent:'+i,sourceRevisionRefs:[ev.sourceRevisionId],evidenceRefs:[ev.id],participants:['Mara'],knownBy:['Mara'],summary:'Recent unrelated weather observation '+i+'.',significance:0.4,timeStart:10+i,timeEnd:10+i});
  }
  producer.rebuildHistorian();
  const result=producer.queryHistorian({query:'Sun Blade history',mode:'EXPLICIT_HISTORY'});
  assert.ok(result.nominations.length>0);
  assert.match(result.nominations[0].representationText,/Sun Blade/i);
  assert.equal(result.nominations.some((row)=>/weather/i.test(row.representationText)),false);
  for (const nomination of result.nominations) {
    const drill=producer.drillDown(nomination);
    assert.ok(drill.length>0);
    assert.ok(drill.every((row)=>typeof row.exactContent==='string'));
  }
});

test('character perspective cannot reveal an event the character did not know', () => {
  const producer=new MemoryTemporalProducer();
  const secret=evidence(producer,{id:'ev:secret',sourceRevisionId:'secret@r1',text:'Mara hid the cellar map under the stove.',participants:['Mara'],knownBy:['Mara']});
  producer.publishEpisode({logicalId:'ep:secret',sourceRevisionRefs:[secret.sourceRevisionId],evidenceRefs:[secret.id],participants:['Mara'],knownBy:['Mara'],summary:'Mara hid the cellar map under the stove.',significance:0.9});
  producer.rebuildHistorian();

  const world=producer.queryHistorian({query:'cellar map',mode:'EXPLICIT_HISTORY',perspectiveConstraint:{scope:PerspectiveScope.WORLD}});
  assert.ok(world.nominations.length>0);
  const mara=producer.queryHistorian({query:'cellar map',mode:'EXPLICIT_HISTORY',perspectiveConstraint:{scope:PerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'Mara'}});
  assert.ok(mara.nominations.length>0);
  const eris=producer.queryHistorian({query:'cellar map',mode:'EXPLICIT_HISTORY',perspectiveConstraint:{scope:PerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'Eris'}});
  assert.equal(eris.nominations.length,0);
});

test('Historian output is CandidateNomination-compatible and grants no admission, truth, Settlement or Context Seal authority', () => {
  const producer=buildEmberMemory();
  const result=producer.queryHistorian({query:'Sun Blade history',mode:'EXPLICIT_HISTORY'});
  assert.ok(result.nominations.length<=MEMORY_LIMITS.maxHistorianCandidates);
  for (const nomination of result.nominations) {
    assert.equal(nomination.kind,'CandidateNomination');
    assert.equal(nomination.contractVersion,'1.0.0');
    assert.equal(nomination.channelVersion,'1.0.0');
    assert.equal(nomination.freshness,'FRESH');
    assert.equal(nomination.authorityGranted,false);
    assert.equal(nomination.admissionAuthority,false);
    assert.equal(nomination.settlementAuthority,false);
    assert.equal(nomination.canonicalMutationAuthority,false);
    assert.equal(nomination.metadata.candidateBusAdmissionAuthority,false);
    assert.equal(nomination.metadata.contextSealAuthority,false);
  }
});

test('Jev Historian resolver seam returns exact references and degrades on Memory revision mismatch', () => {
  const producer=buildEmberMemory();
  const request={
    kind:'HistorianMemoryRequest',
    contractVersion:'1.0.0',
    requestId:'memory:test',
    retrievalIntents:[{intentId:'hist:blade',mode:'EXPLICIT_HISTORY',query:'Sun Blade history',entityRefs:[]}],
    retrievalIntentIds:['hist:blade'],
    activeEntityIds:['Sun Blade'],
    activeThreadIds:[],
    perspectiveConstraint:{scope:'WORLD',characterRef:null},
    memoryRevisionRefs:producer.memoryRevisionRefs(),
    limits:{maxArtifacts:48,maxEpisodes:24,maxReflections:12,maxEvidenceBytes:65536,maxProviderCandidates:48,maxProviderExcerptChars:1600},
  };
  const resolved=producer.resolveHistorianMemoryRequest(request);
  assert.equal(resolved.kind,'HistorianMemoryResolution');
  assert.equal(resolved.contractVersion,'1.0.0');
  assert.equal(resolved.status,'OK');
  assert.ok(resolved.artifacts.length>0);
  assert.ok(resolved.artifacts.every((row)=>row.artifactRef?.artifactId&&row.artifactRef?.revision>=1));
  assert.ok(resolved.artifacts.every((row)=>row.authorityGranted===false&&row.memoryMutation===false));

  const stale=producer.resolveHistorianMemoryRequest({...request,memoryRevisionRefs:['memory:stale']});
  assert.equal(stale.status,'DEGRADED');
  assert.deepEqual(stale.artifacts,[]);
  assert.ok(stale.unavailableChannels.includes('MEMORY_REVISION_FENCE_CHANGED'));
});

test('stale or failed Historian read degrades locally without fabricating memory or blocking Temporal reads', () => {
  const producer=buildEmberMemory();
  const degraded=producer.queryHistorian({query:'x'.repeat(MEMORY_LIMITS.maxHistorianQueryCharacters+1)});
  assert.equal(degraded.status,'DEGRADED');
  assert.equal(degraded.nominations.length,0);
  assert.ok(degraded.diagnostics.reason);
  assert.equal(producer.currentProjection().find((row)=>row.subjectId==='Ember Tavern').value,'DESTROYED');
});

test('SceneExperienceProposal is admitted reference-first but withheld when external evidence is unresolved', () => {
  const producer=new MemoryTemporalProducer();
  const surface=createMemoryIntegrationSurface(producer);
  const proposal={
    kind:'SceneExperienceProposal',
    contractVersion:'1.0.0',
    proposalId:'scene-proposal:1',
    sceneId:'scene:1',
    sceneRevision:1,
    sceneEpisodeRef:{artifactId:'scene-episode:1',artifactType:'SceneEpisode',revision:1},
    graphReferenceSet:{kind:'SceneGraphReferenceSet',sceneId:'scene:1',sceneRevision:1},
    sourceRevisionRefs:['scene-source@r1'],
    evidenceRefs:['scene-evidence:external'],
    provenance:['scene-prov:1'],
    status:'PROPOSED',
    authority:'PROPOSAL',
    authorityGranted:false,
    memoryMutationAuthority:false,
    settlementAuthority:false,
  };
  const episode=surface.adapters.acceptSceneExperience(proposal,{summary:'A scene reference awaiting evidence resolution.'});
  assert.equal(episode.unresolvedEvidenceRefs.length,1);
  assert.equal(episode.freshness,'STALE');
  producer.rebuildHistorian();
  assert.equal(producer.queryHistorian({query:'awaiting evidence',mode:'EXPLICIT_HISTORY'}).nominations.length,0);
  assert.ok(surface.directorAdapterNotes.some((row)=>row.seam==='SCENE_EVIDENCE_RESOLUTION'));
});

test('bounded consolidation checkpoints, reloads and resumes without duplicate Reflection publication', () => {
  let producer=new MemoryTemporalProducer();
  const supports=[];
  for (let i=0;i<7;i++) supports.push(evidence(producer,{id:'ev:cons:'+i,sourceRevisionId:'cons:'+i+'@r1',text:'Observation '+i+' about Mara.',knownBy:['Mara']}));
  const jobs=supports.map((ev,i)=>({
    type:'REFLECTION',
    input:{
      reflectionKey:'cons:mara',
      statement:'Mara reflection revision '+i+'.',
      subjectRefs:['Mara'],
      supportEvidenceRefs:[ev.id],
      confidence:0.5+i*0.05,
      action:i%2?'WEAKEN':'REINFORCE',
    },
  }));
  let session=producer.startConsolidation(jobs);
  session=producer.runConsolidation(session.id,{maxUnits:2});
  assert.equal(session.state,'CHECKPOINTED');
  assert.equal(session.checkpoint.cursor,2);
  const snapshot=producer.snapshot();

  producer=MemoryTemporalProducer.fromSnapshot(snapshot);
  while (session.state!=='COMPLETED') session=producer.runConsolidation(session.id,{maxUnits:2});
  assert.equal(session.publishedArtifactIds.length,7);
  assert.equal(new Set(session.publishedArtifactIds).size,7);
  assert.equal(producer.experienceStore.reflectionHistory('cons:mara').length,7);
  assert.equal(producer.experienceStore.currentReflections().length,1);
});

test('snapshot reload and replay preserve projection/history and do not duplicate publication or discard raw turns', () => {
  const producer=buildEmberMemory();
  const rawCount=producer.graph.evidence.size;
  const projection=stableStringify(producer.currentProjection({includeStale:true}));
  const history=stableStringify(producer.historicalClaims({includeUnresolved:true,includeStale:true}));
  const snapshot=producer.snapshot();
  const restored=MemoryTemporalProducer.fromSnapshot(snapshot);
  assert.equal(stableStringify(restored.currentProjection({includeStale:true})),projection);
  assert.equal(stableStringify(restored.historicalClaims({includeUnresolved:true,includeStale:true})),history);
  assert.equal(restored.graph.evidence.size,rawCount);
  assert.equal(restored.graph.exactEvidence('ev:blade-history').exactContent,'Eris carried the Sun Blade and later left it at the Ember Tavern.');

  const envelope=settlementEnvelope({
    evidenceId:'ev:tavern-fire',sourceRevisionId:'event:tavern-fire@r1',claimId:'claim:tavern-destroyed',
    subjectId:'Ember Tavern',predicate:'state',value:'DESTROYED',worldRevision:2,decision:SettlementDecisionType.SUPERSEDE,
  });
  const before=restored.graph.settlementJournal.length;
  const replay=restored.applySettlement(envelope);
  assert.equal(replay.kind,'MemorySettlementReplayReceipt');
  assert.equal(restored.graph.settlementJournal.length,before);
});

test('integration fixture exposes stable versioned API without private store ownership leakage', () => {
  const producer=buildEmberMemory();
  const surface=createMemoryIntegrationSurface(producer);
  const fixture=createMemoryIntegrationFixture(producer);
  assert.equal(surface.contractVersion,'1.0.0');
  assert.equal(surface.compatibility.greenRoom,'1.1.0');
  assert.equal(surface.compatibility.historian,'1.0.0');
  assert.equal(fixture.kind,'MemoryIntegrationFixture');
  assert.equal(fixture.api.apiVersion,'1.0.0');
  assert.equal(fixture.ownership.canonicalMutation,'CORE_OWNER_SETTLEMENT_ONLY');
  assert.equal(fixture.ownership.candidateBusAdmission,false);
  assert.ok(Array.isArray(fixture.currentProjection));
});
