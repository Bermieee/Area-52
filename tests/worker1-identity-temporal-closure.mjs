import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthorityClass, KnowledgeStatus, MutationType,
  createClaim, createMutationProposal, createProvenance,
} from '../src/contracts.js';
import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {NativeEntityIdentityRegistry} from '../src/entity-identity-registry.js';
import {TemporalStateGraph} from '../src/temporal-state-graph.js';
import {Area52NativeBrain} from '../src/native-brain.js';

function admitEvidence(core,id,content=id){
  const imported=core.registry.importSource({id,sourceType:'TEST_EVIDENCE',content});
  const artifactId='evidence:'+id;
  core.registry.registerDerivedArtifact({
    artifactId,artifact:{kind:'TestEvidence',id:artifactId},
    sourceRevisionIds:[imported.revision.id],activity:'TEST_EVIDENCE',agent:'worker1-identity-temporal-closure',
  });
  return{sourceId:id,revisionId:imported.revision.id,artifactId};
}
function mutation(core,evidence,{
  id,subjectId,predicate,value,at,authorityClass=AuthorityClass.OBSERVED,
  temporalKind='CURRENT',identityRevisionRefs=[],stableIdentity=null,
}){
  const provenance=createProvenance({
    id:'prov:'+id,sourceRevisionIds:[evidence.revisionId],evidenceIds:[evidence.artifactId],
    derivedFromIds:[evidence.artifactId],activity:'STORY_NEUTRAL_FIXTURE',agent:'worker1',
    invalidators:[evidence.revisionId,evidence.artifactId,...identityRevisionRefs],
  });
  const claim=createClaim({
    id,subjectId,predicate,value,temporal:{kind:temporalKind,validFrom:at,validUntil:null},
    authorityClass,confidence:1,status:temporalKind==='HISTORICAL'?KnowledgeStatus.HISTORICAL:KnowledgeStatus.CURRENT,
    provenance,owner:'WORLD_STATE',stableIdentity,identityRevisionRefs,claimType:'FACT',slotPolicy:'SINGLE',
    explicitness:authorityClass===AuthorityClass.INFERRED?'INFERRED_TEST':'EXPLICIT_TEST',evidenceTime:at,
  });
  return createMutationProposal({
    id:'proposal:'+id,mutationType:MutationType.SET_CLAIM,owner:'WORLD_STATE',
    sourceRevisionIds:[evidence.revisionId],evidenceIds:[evidence.artifactId],
    freshnessRevisionIds:[evidence.revisionId],payload:{claim},status:'PROPOSED',
  });
}
function scene(sceneId,sceneRevision){
  return{
    sceneId,sceneRevision,location:'Neutral Dock',narrativeTime:'tick '+sceneRevision,
    activeCast:[],activeThreads:[],objects:[],sourceRevisionRefs:[],
    provenance:['worker1:'+sceneId+':'+sceneRevision],
  };
}

test('DETERMINISTIC: #201 aliases, ambiguity, historical aliases, proposals, provenance and targeted invalidation close independently',()=>{
  const identities=new NativeEntityIdentityRegistry();
  identities.registerIdentity({entityId:'entity:rowan:a',canonicalLabel:'Rowan',entityType:'PERSON',worldId:'world:neutral'});
  identities.registerIdentity({entityId:'entity:rowan:b',canonicalLabel:'Rowan',entityType:'PERSON',worldId:'world:neutral'});
  const sameName=identities.resolveMention({label:'Rowan',worldId:'world:neutral',entityType:'PERSON'});
  assert.equal(sameName.state,'UNRESOLVED');
  assert.deepEqual(sameName.candidateEntityIds,['entity:rowan:a','entity:rowan:b']);

  identities.registerIdentity({entityId:'entity:mira',canonicalLabel:'Mira Vale',entityType:'PERSON',worldId:'world:neutral'});
  const alias=identities.propose({
    action:'ALIAS_ADD',providerId:'LORE_NEUTRAL',alias:'Nightglass',targetEntityId:'entity:mira',
    worldId:'world:neutral',entityType:'PERSON',authorityOrigin:'SOURCE_EXPLICIT',explicit:true,
    sourceRevisionRefs:['lore:mira@1'],provenanceRefs:['prov:lore:mira@1'],
    temporalApplicability:{validFrom:1,validUntil:10},
  });
  assert.equal(identities.settle(alias.proposalId,{decision:'ACCEPT'}).state,'ALIAS_ADDED');
  assert.equal(identities.resolveMention({label:'Nightglass',worldId:'world:neutral',entityType:'PERSON'}).entity.entityId,'entity:mira');

  const retire=identities.propose({
    action:'ALIAS_RETIRE',providerId:'LORE_NEUTRAL',alias:'Nightglass',targetEntityId:'entity:mira',
    worldId:'world:neutral',entityType:'PERSON',authorityOrigin:'SOURCE_EXPLICIT',explicit:true,
    sourceRevisionRefs:['lore:mira@2'],provenanceRefs:['prov:lore:mira@2'],
  });
  assert.equal(identities.settle(retire.proposalId,{decision:'ACCEPT'}).state,'ALIAS_RETIRED');
  assert.equal(identities.resolveMention({label:'Nightglass',worldId:'world:neutral',entityType:'PERSON'}).state,'NOT_FOUND');
  assert.equal(identities.resolveMention({label:'Nightglass',worldId:'world:neutral',entityType:'PERSON',temporalMode:'HISTORICAL',at:5}).state,'RESOLVED_HISTORICAL_ALIAS');
  assert.equal(identities.resolveMention({label:'Nightglass',worldId:'world:neutral',entityType:'PERSON',temporalMode:'HISTORICAL',at:50}).state,'NOT_FOUND');

  const merge=identities.propose({
    action:'MERGE',providerId:'OWNER',targetEntityId:'entity:rowan:a',candidateEntityIds:['entity:rowan:a','entity:rowan:b'],
    authorityOrigin:'OWNER_EXPLICIT',explicit:true,sourceRevisionRefs:['owner:identity@7'],provenanceRefs:['owner:merge:evidence'],
  });
  const mergeReceipt=identities.settle(merge.proposalId,{decision:'ACCEPT'});
  assert.equal(mergeReceipt.state,'UNRESOLVED');
  assert.equal(mergeReceipt.applied,false);
  assert.deepEqual(mergeReceipt.sourceRevisionRefs,['owner:identity@7']);
  assert.deepEqual(mergeReceipt.provenanceRefs,['owner:merge:evidence']);

  const split=identities.propose({
    action:'SPLIT',providerId:'OWNER',targetEntityId:'entity:rowan:a',candidateEntityIds:['entity:rowan:a'],
    authorityOrigin:'OWNER_EXPLICIT',explicit:true,sourceRevisionRefs:['owner:identity@8'],provenanceRefs:['owner:split:evidence'],
  });
  const splitReceipt=identities.settle(split.proposalId,{decision:'ACCEPT'});
  assert.equal(splitReceipt.state,'DEFERRED');
  assert.equal(splitReceipt.applied,false);
  assert.deepEqual(splitReceipt.provenanceRefs,['owner:split:evidence']);

  const modelGuess=identities.propose({
    action:'LINK',providerId:'MODEL',sourceEntityId:'guess:rowan',targetEntityId:'entity:rowan:a',
    authorityOrigin:'MODEL',explicit:false,confidence:1,sourceRevisionRefs:['model:guess@1'],provenanceRefs:['model:guess'],
  });
  assert.equal(identities.settle(modelGuess.proposalId,{decision:'ACCEPT'}).state,'DEFERRED');
  assert.equal(identities.resolveSource({providerId:'MODEL',sourceEntityId:'guess:rowan'}),null);

  identities.registerIdentity({
    entityId:'entity:dependent',canonicalLabel:'Dependent',entityType:'PERSON',worldId:'world:neutral',
    providerId:'LORE_NEUTRAL',sourceEntityId:'dependent:source',aliases:['Dependent Alias'],
    sourceRevisionRefs:['lore:dependent@1'],provenanceRefs:['prov:dependent'],authorityOrigin:'SOURCE_EXPLICIT',
  });
  identities.registerIdentity({
    entityId:'entity:unrelated',canonicalLabel:'Unrelated',entityType:'PERSON',worldId:'world:neutral',
    providerId:'LORE_NEUTRAL',sourceEntityId:'unrelated:source',aliases:['Unrelated Alias'],
    sourceRevisionRefs:['lore:unrelated@1'],provenanceRefs:['prov:unrelated'],authorityOrigin:'SOURCE_EXPLICIT',
  });
  const priorRef=identities.identityReference('entity:dependent').revisionRef;
  const unrelatedRef=identities.identityReference('entity:unrelated').revisionRef;
  const invalidated=identities.invalidateSourceRevision('lore:dependent@1');
  assert.deepEqual(invalidated.affectedEntityIds,['entity:dependent']);
  assert.ok(invalidated.invalidatedIdentityRevisionRefs.includes(priorRef));
  assert.equal(identities.isCurrentRevisionRef(priorRef),false);
  assert.equal(identities.isCurrentRevisionRef(unrelatedRef),true);
  assert.equal(identities.resolveMention({label:'Dependent Alias',worldId:'world:neutral',entityType:'PERSON'}).state,'NOT_FOUND');
  assert.equal(identities.resolveMention({label:'Unrelated Alias',worldId:'world:neutral',entityType:'PERSON'}).entity.entityId,'entity:unrelated');

  const refs=identities.readReferences(['entity:dependent','entity:unrelated']);
  assert.equal(refs.authorityGranted,false);
  assert.equal(refs.mutationAuthority,false);
  assert.equal(refs.references.length,2);
});

test('DETERMINISTIC: #5 transition, supersession, contradiction, reload reconstruction and inference fence remain distinct',()=>{
  const core=new Area52CognitiveCore();
  const open=admitEvidence(core,'state:open','The gate is open.');
  const closed=admitEvidence(core,'state:closed','The gate is closed.');
  const red=admitEvidence(core,'signal:red','The signal is red.');
  const blue=admitEvidence(core,'signal:blue','The signal is blue.');

  const first=core.settlement.settle(mutation(core,open,{id:'claim:gate:open',subjectId:'entity:gate',predicate:'state',value:'OPEN',at:1}));
  const second=core.settlement.settle(mutation(core,closed,{id:'claim:gate:closed',subjectId:'entity:gate',predicate:'state',value:'CLOSED',at:2}));
  assert.equal(first.decision.decision,'ACCEPT_CURRENT');
  assert.equal(second.decision.decision,'SUPERSEDE');
  assert.equal(core.graph.getClaim('claim:gate:open').status,'SUPERSEDED');
  assert.equal(core.graph.getClaim('claim:gate:closed').status,'CURRENT');
  assert.deepEqual(core.graph.transitions('entity:gate','state').map(x=>[x.from,x.to,x.at]),[[null,'OPEN',1],['OPEN','CLOSED',2]]);

  core.settlement.settle(mutation(core,red,{id:'claim:signal:red',subjectId:'entity:beacon',predicate:'signal',value:'RED',at:3}));
  const conflict=core.settlement.settle(mutation(core,blue,{id:'claim:signal:blue',subjectId:'entity:beacon',predicate:'signal',value:'BLUE',at:3}));
  assert.equal(conflict.decision.decision,'UNRESOLVED');
  assert.equal(core.graph.getClaim('claim:signal:red').status,'CONTRADICTED');
  assert.equal(core.graph.getClaim('claim:signal:blue').status,'CONTRADICTED');
  assert.equal(core.graph.unresolvedState('entity:beacon','signal').status,'UNRESOLVED');

  const before={current:core.graph.currentProjection(),historical:core.graph.historicalClaims(),unresolved:core.graph.unresolvedClaims()};
  const snapshot=core.graph.exportState();
  for(const [,claim] of snapshot.claims)claim.status='CURRENT';
  const restored=new TemporalStateGraph();
  restored.restoreState(snapshot);
  assert.deepEqual(restored.currentProjection(),before.current);
  assert.deepEqual(restored.historicalClaims(),before.historical);
  assert.deepEqual(restored.unresolvedClaims(),before.unresolved);

  const inferredEvidence=admitEvidence(core,'inferred:empty','A model guesses the gate is locked.');
  const inferred=core.settlement.settle(mutation(core,inferredEvidence,{
    id:'claim:gate:inferred',subjectId:'entity:gate',predicate:'lockState',value:'LOCKED',at:4,authorityClass:AuthorityClass.INFERRED,
  }));
  assert.equal(inferred.decision.decision,'REJECT');
  assert.match(inferred.decision.reason,/inferred claim cannot mutate canonical/i);
  assert.equal(core.graph.getClaim('claim:gate:inferred'),null);

  const stale=core.registry.importSource({id:'stale:source',sourceType:'TEST_EVIDENCE',content:'old revision'});
  core.registry.replaceSource('stale:source','new revision');
  const stableEvidence=admitEvidence(core,'stale:evidence','independent evidence artifact');
  const staleClaim=createClaim({
    id:'claim:stale',subjectId:'entity:gate',predicate:'staleProbe',value:'OLD',
    temporal:{kind:'CURRENT',validFrom:5,validUntil:null},authorityClass:AuthorityClass.OBSERVED,confidence:1,status:KnowledgeStatus.CURRENT,
    provenance:createProvenance({id:'prov:stale',sourceRevisionIds:[stale.revision.id],evidenceIds:[stableEvidence.artifactId],activity:'STALE_TEST',agent:'worker1'}),
  });
  const staleResult=core.settlement.settle(createMutationProposal({
    id:'proposal:stale',mutationType:MutationType.SET_CLAIM,owner:'WORLD_STATE',
    sourceRevisionIds:[stale.revision.id],evidenceIds:[stableEvidence.artifactId],freshnessRevisionIds:[stale.revision.id],payload:{claim:staleClaim},
  }));
  assert.equal(staleResult.decision.decision,'REJECT');
  assert.match(staleResult.decision.reason,/stale/i);
});

test('DETERMINISTIC: identity correction invalidates only dependent temporal claims and cannot promote inferred replacement',()=>{
  const core=new Area52CognitiveCore();
  const identitySource=core.registry.importSource({id:'identity:keeper',sourceType:'IDENTITY_OWNER',content:'Keeper identity revision one.'});
  const unrelatedIdentitySource=core.registry.importSource({id:'identity:watcher',sourceType:'IDENTITY_OWNER',content:'Watcher identity revision one.'});
  core.registerEntityIdentity({
    entityId:'entity:keeper',canonicalLabel:'Keeper',entityType:'PERSON',worldId:'world:neutral',
    providerId:'OWNER',sourceEntityId:'keeper:source',sourceRevisionRefs:[identitySource.revision.id],provenanceRefs:['prov:keeper'],authorityOrigin:'SOURCE_EXPLICIT',
  });
  core.registerEntityIdentity({
    entityId:'entity:watcher',canonicalLabel:'Watcher',entityType:'PERSON',worldId:'world:neutral',
    providerId:'OWNER',sourceEntityId:'watcher:source',sourceRevisionRefs:[unrelatedIdentitySource.revision.id],provenanceRefs:['prov:watcher'],authorityOrigin:'SOURCE_EXPLICIT',
  });
  const keeperRef=core.entityIdentityReferences(['entity:keeper']).references[0].revisionRef;
  const watcherRef=core.entityIdentityReferences(['entity:watcher']).references[0].revisionRef;

  const keeperEvidence=admitEvidence(core,'temporal:keeper','Keeper is at the neutral dock.');
  const watcherEvidence=admitEvidence(core,'temporal:watcher','Watcher is at the neutral tower.');
  const keeperSettlement=core.settlement.settle(mutation(core,keeperEvidence,{
    id:'claim:keeper:location',subjectId:'entity:keeper',predicate:'location',value:'dock',at:1,
    identityRevisionRefs:[keeperRef],stableIdentity:'entity:keeper',
  }));
  core.settlement.settle(mutation(core,watcherEvidence,{
    id:'claim:watcher:location',subjectId:'entity:watcher',predicate:'location',value:'tower',at:1,
    identityRevisionRefs:[watcherRef],stableIdentity:'entity:watcher',
  }));
  assert.deepEqual(keeperSettlement.audit.identityRevisionRefs,[keeperRef]);
  assert.deepEqual(keeperSettlement.decision.diagnostics.identityRevisionRefs,[keeperRef]);

  const receipt=core.invalidateEntityIdentityRevision(identitySource.revision.id,{reason:'IDENTITY_OWNER_CORRECTION'});
  assert.ok(receipt.invalidatedIdentityRevisionRefs.includes(keeperRef));
  assert.deepEqual(receipt.invalidatedTemporalClaimIds,['claim:keeper:location']);
  assert.equal(core.graph.getClaim('claim:keeper:location'),null);
  assert.equal(core.graph.getClaim('claim:watcher:location').status,'CURRENT');
  assert.equal(core.entities.isCurrentRevisionRef(watcherRef),true);

  const newKeeperRef=core.entityIdentityReferences(['entity:keeper']).references[0].revisionRef;
  const inferredEvidence=admitEvidence(core,'temporal:keeper:inferred','A model guesses a replacement location.');
  const inferred=core.settlement.settle(mutation(core,inferredEvidence,{
    id:'claim:keeper:guess',subjectId:'entity:keeper',predicate:'location',value:'bridge',at:2,
    authorityClass:AuthorityClass.INFERRED,identityRevisionRefs:[newKeeperRef],stableIdentity:'entity:keeper',
  }));
  assert.equal(inferred.decision.decision,'REJECT');
  assert.equal(core.graph.getClaim('claim:keeper:guess'),null);

  const temporalRefs=core.temporalStateReferences({entityIds:['entity:watcher']});
  assert.equal(temporalRefs.authorityGranted,false);
  assert.equal(temporalRefs.settlementAuthority,false);
  assert.ok(temporalRefs.references.some(row=>row.claimId==='claim:watcher:location'&&row.identityRevisionRefs.includes(watcherRef)));
});

test('DETERMINISTIC: native one-resource path preserves chat/turn/perspective fences and stable identity refs',async()=>{
  const brain=new Area52NativeBrain();
  brain.registerEntityIdentity({entityId:'entity:keeper',canonicalLabel:'Keeper',entityType:'PERSON',worldId:'world:neutral'});
  assert.equal(brain.listOptionalResources().resources.length,0);
  assert.deepEqual(brain.diagnostics().nativeRequirements,{
    jevRequired:false,sidecarRequired:false,externalDatabaseRequired:false,sqlRequired:false,remoteModelRequired:false,userOrchestratorRequired:false,
  });

  const a=await brain.prepareTurn({
    chatId:'chat:a',turnId:'turn:a:1',generationId:'gen:a:1',query:'Continue the neutral scene.',
    scene:scene('scene:a',1),perspectiveConstraint:{scope:'CHARACTER_KNOWLEDGE',characterRef:'entity:keeper'},
    executionLabel:'DETERMINISTIC',
  });
  const b=await brain.prepareTurn({
    chatId:'chat:b',turnId:'turn:b:1',generationId:'gen:b:1',query:'Continue the other neutral scene.',
    scene:scene('scene:b',1),executionLabel:'DETERMINISTIC',
  });
  const ui=brain.uiBindings();
  assert.ok(ui.readTruth(a.selection));
  assert.ok(ui.readTruth(b.selection));
  assert.equal(ui.readTruth({...a.selection,chatId:'chat:b'}),null);
  assert.equal(ui.readTruth({...a.selection,turnId:'turn:foreign'}),null);
  assert.deepEqual(brain.readTurn('turn:a:1').perspectiveConstraint,{scope:'CHARACTER_KNOWLEDGE',characterRef:'entity:keeper'});

  await brain.completeTurn({
    turnId:'turn:a:1',response:'Keeper remains at the neutral dock.',
    observations:[{subjectId:'entity:keeper',predicate:'location',value:'dock',at:1,authorityClass:AuthorityClass.OBSERVED}],
  });
  const settled=brain.readTurn('turn:a:1').settlements[0];
  const stableRef=brain.identityReferences(['entity:keeper']).references[0].revisionRef;
  assert.ok(settled.proposal.payload.claim.identityRevisionRefs.includes(stableRef));
  assert.ok(settled.audit.identityRevisionRefs.includes(stableRef));
  assert.equal(brain.temporalReferences({entityIds:['entity:keeper']}).authorityGranted,false);
});
