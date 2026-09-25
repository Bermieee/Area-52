import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthorityClass, CognitiveTaskClass, KnowledgeStatus, MutationType,
  createAliasCandidate, createCacheDependency, createCandidateBusResult, createClaim,
  createCognitiveTask, createCompiledContextPacket, createEntity, createMutationProposal,
  createProvenance, createReflection, createSettlementReceipt, createSourceRecord,
  createSourceRevision, createTruthGateResult,
} from '../src/contracts.js';
import { EMBER_TAVERN_WORLD } from './fixtures/ember-tavern.js';

test('contract constructors are deterministic and JSON serializable', () => {
  const provenance = createProvenance({ id:'prov:1', sourceRevisionIds:['lore:1@1'], activity:'STUDY', agent:'test' });
  const record = createSourceRecord({ id:'lore:1', sourceType:'LORE' });
  const revision = createSourceRevision({ id:'lore:1@1', sourceId:'lore:1', revision:1, contentHash:'abc', exactContent:'Exact source.' });
  const entity = createEntity({ id:'entity:1', canonicalName:'Thing', entityType:'OBJECT', provenance });
  const alias = createAliasCandidate({ id:'alias:1', alias:'The Thing', entityId:'entity:1', provenance });
  const claim = createClaim({ id:'claim:1', subjectId:'entity:1', predicate:'state', value:'intact', temporal:{kind:'CURRENT', validFrom:0, validUntil:null}, authorityClass:AuthorityClass.SOURCE_CANON, provenance });
  const reflection = createReflection({ id:'reflection:1', statement:'Thing may matter.', evidenceIds:['claim:1'], confidence:.5, provenance });
  const candidate = createCandidateBusResult({ candidateId:'candidate:1', sourceType:'claim', sourceId:'claim:1', entityIds:['entity:1'], claimIds:['claim:1'], temporalStatus:KnowledgeStatus.CURRENT, provenance });
  const truth = createTruthGateResult({ candidateId:'candidate:1', classification:KnowledgeStatus.CURRENT, usableForIntent:true, claimIds:['claim:1'], provenance });
  const proposal = createMutationProposal({ id:'proposal:1', mutationType:MutationType.SET_CLAIM, owner:'WORLD_STATE', sourceRevisionIds:['lore:1@1'], payload:{claim} });
  const receipt = createSettlementReceipt({ id:'receipt:1', proposalId:'proposal:1', owner:'WORLD_STATE', outcome:'SETTLED', settledArtifactIds:['claim:1'], revision:1 });
  const packet = createCompiledContextPacket({ id:'packet:1', query:'thing?', intent:'CURRENT', current:[{e:'entity:1',p:'state',v:'intact'}], provenanceIndex:{'claim:1':['lore:1@1']}, dependencies:['lore:1@1'] });
  const cache = createCacheDependency({ cacheKey:'cache:1', sourceRevisionIds:['lore:1@1'], artifactIds:['claim:1'], invalidators:['lore:1@1'] });
  const task = createCognitiveTask({ id:'task:1', taskClass:CognitiveTaskClass.REFLEX, taskType:'TRUTH_GATE', inputRevisionIds:['lore:1@1'] });

  for (const artifact of [record,revision,entity,alias,claim,reflection,candidate,truth,proposal,receipt,packet,cache,task]) {
    assert.doesNotThrow(() => JSON.stringify(artifact));
  }
  assert.equal(JSON.stringify(record), JSON.stringify(createSourceRecord({ id:'lore:1', sourceType:'LORE' })));
});

test('truth status vocabulary represents the required golden-world states', () => {
  for (const status of ['CURRENT','HISTORICAL','SUPERSEDED','CONTRADICTED','UNCERTAIN','UNRESOLVED']) {
    assert.equal(KnowledgeStatus[status], status);
  }
});

test('Ember Tavern golden world freezes the canonical acceptance story', () => {
  assert.deepEqual(EMBER_TAVERN_WORLD.expected.current, [
    ['ember-tavern','state','destroyed'],
    ['sun-blade','state','destroyed'],
    ['ember-tavern','owner','mara'],
  ]);
  assert.match(EMBER_TAVERN_WORLD.expected.presentQuery, /Sun Blade/);
  assert.match(EMBER_TAVERN_WORLD.expected.historicalQuery, /before the tavern fire/);
});


import { SourceRegistry, hashContent } from '../src/source-registry.js';

test('Source Registry preserves exact revisions and hashes content deterministically', () => {
  const registry = new SourceRegistry();
  const first = registry.importSource({ id:'lore:test', sourceType:'LORE', content:'Exact source A.' });
  assert.equal(first.revision.contentHash, hashContent('Exact source A.'));
  const replaced = registry.replaceSource('lore:test', 'Exact source B.');
  assert.equal(replaced.changed, true);
  assert.equal(registry.getRevision('lore:test@1').exactContent, 'Exact source A.');
  assert.equal(registry.getActiveRevision('lore:test').exactContent, 'Exact source B.');
  assert.equal(registry.isActiveRevision('lore:test@1'), false);
  assert.equal(registry.isActiveRevision('lore:test@2'), true);
});

test('Source Registry invalidates only the truthful dependency cone', () => {
  const registry = new SourceRegistry();
  registry.importSource({ id:'lore:a', sourceType:'LORE', content:'A' });
  registry.importSource({ id:'lore:b', sourceType:'LORE', content:'B' });
  registry.registerDerivedArtifact({ artifactId:'claim:a', artifact:{kind:'ClaimStub'}, sourceRevisionIds:['lore:a@1'] });
  registry.registerDerivedArtifact({ artifactId:'summary:a', artifact:{kind:'SummaryStub'}, dependsOnArtifactIds:['claim:a'] });
  registry.registerDerivedArtifact({ artifactId:'claim:b', artifact:{kind:'ClaimStub'}, sourceRevisionIds:['lore:b@1'] });

  const edit = registry.replaceSource('lore:a', 'A2');
  assert.deepEqual(edit.invalidatedArtifactIds, ['claim:a','summary:a']);
  assert.equal(registry.isArtifactValid('claim:a'), false);
  assert.equal(registry.isArtifactValid('summary:a'), false);
  assert.equal(registry.isArtifactValid('claim:b'), true);
  assert.deepEqual(registry.explainArtifact('summary:a').derivedFrom[0].sourceRevisions.map((x) => x.id), ['lore:a@1']);
});


import { LoreStudyEngine } from '../src/lore-study.js';
import { TemporalStateGraph } from '../src/temporal-state-graph.js';
import { Area52CognitiveCore } from '../src/cognitive-core.js';

test('Lore Study preserves exact source while deriving context, entities, claims, relationships, and temporal proposals', () => {
  const registry = new SourceRegistry();
  registry.importSource({ id:'lore:study', sourceType:'LORE', content:'The Sun Blade is carried by Eris.' });
  const study = new LoreStudyEngine({registry}).studySource('lore:study');
  assert.equal(registry.getActiveRevision('lore:study').exactContent, 'The Sun Blade is carried by Eris.');
  assert.equal(study.contextual.exactTextHash, registry.getActiveRevision('lore:study').contentHash);
  assert.deepEqual(study.entities.map((x) => x.id).sort(), ['eris','sun-blade']);
  assert.equal(study.claims[0].predicate, 'location');
  assert.equal(study.claims[0].value, 'eris');
  assert.equal(study.relationships[0].predicate, 'carries');
  assert.equal(study.proposals[0].owner, 'WORLD_STATE');
  assert.deepEqual(study.claims[0].provenance.sourceRevisionIds, ['lore:study@1']);
});

test('Temporal State Graph retains superseded history and rejects stale settlement proposals', () => {
  const registry = new SourceRegistry();
  registry.importSource({ id:'lore:s', sourceType:'LORE', content:'The Sun Blade is carried by Eris.' });
  const studyEngine = new LoreStudyEngine({registry});
  const graph = new TemporalStateGraph();
  const first = studyEngine.studySource('lore:s');
  const oldProposal = first.proposals[0];
  assert.equal(graph.settleProposal(oldProposal, registry).outcome, 'SETTLED');
  registry.replaceSource('lore:s', 'The Sun Blade is carried by Eris and forged by Sol.');
  assert.equal(graph.settleProposal(oldProposal, registry).outcome, 'STALE');
});

test('Ember Tavern end-to-end cognitive vertical slice preserves current truth, history, provenance, and incremental relearning', () => {
  const core = new Area52CognitiveCore();
  for (const source of EMBER_TAVERN_WORLD.sources) core.importAndLearn({...source, at:0});
  for (const source of EMBER_TAVERN_WORLD.narrative) core.importAndLearn(source);

  const current = core.graph.currentClaims();
  const currentTriples = current.map((c) => [c.subjectId,c.predicate,c.value]);
  for (const expected of EMBER_TAVERN_WORLD.expected.current) assert.ok(currentTriples.some((row) => JSON.stringify(row) === JSON.stringify(expected)), `missing current ${expected}`);

  const historical = core.graph.historicalClaims();
  const historicalTriples = historical.map((c) => [c.subjectId,c.predicate,c.value]);
  for (const expected of EMBER_TAVERN_WORLD.expected.historical) assert.ok(historicalTriples.some((row) => JSON.stringify(row) === JSON.stringify(expected)), `missing historical ${expected}`);
  const inferredBladeIntact = historical.find((c) => c.subjectId === 'sun-blade' && c.predicate === 'state' && c.value === 'intact');
  assert.equal(inferredBladeIntact.authorityClass, AuthorityClass.INFERRED);

  const present = core.query(EMBER_TAVERN_WORLD.expected.presentQuery, {intent:'CURRENT',anchorEntityIds:['sun-blade','eris']});
  const stalePossession = present.truth.find((r) => r.claimIds.some((id) => {
    const c = core.graph.getClaim(id); return c?.subjectId === 'sun-blade' && c?.predicate === 'location' && c?.value === 'eris';
  }));
  assert.ok(stalePossession);
  assert.equal(stalePossession.usableForIntent, false);
  assert.ok(present.packet.current.some((f) => f.e === 'sun-blade' && f.p === 'state' && f.v === 'destroyed'));
  assert.equal(present.packet.current.some((f) => f.e === 'sun-blade' && f.p === 'location' && f.v === 'eris'), false);

  const past = core.query(EMBER_TAVERN_WORLD.expected.historicalQuery, {intent:'HISTORICAL',anchorEntityIds:['eris','sun-blade']});
  const retrievalChannels = new Set(past.candidates.flatMap((c) => c.retrievalIntents));
  assert.ok(retrievalChannels.has('exact'));
  assert.ok(retrievalChannels.has('semantic'));
  assert.ok(retrievalChannels.has('graph'));
  assert.ok(past.packet.historical.some((f) => f.e === 'sun-blade' && f.p === 'location' && f.v === 'eris'));
  const carriedFact = past.packet.historical.find((f) => f.e === 'sun-blade' && f.p === 'location' && f.v === 'eris');
  assert.ok(past.packet.provenanceIndex[carriedFact.id].includes('lore:sun-blade@1'));

  const ownerBefore = core.graph.currentClaims({subjectId:'ember-tavern',predicate:'owner'})[0].id;
  const edit = core.editAndRelearn('lore:sun-blade', 'The Sun Blade is carried by Eris and forged by Sol.');
  assert.ok(edit.replacement.invalidatedArtifactIds.some((id) => id.startsWith('claim:lore:sun-blade@1')));
  assert.ok(edit.invalidatedGraphClaimIds.some((id) => id.startsWith('claim:lore:sun-blade@1')));
  assert.equal(core.graph.currentClaims({subjectId:'ember-tavern',predicate:'owner'})[0].id, ownerBefore);
  assert.ok(core.graph.currentClaims({subjectId:'sun-blade',predicate:'state'}).some((c) => c.value === 'destroyed'));
  assert.ok(core.graph.currentClaims({subjectId:'sun-blade',predicate:'forgedBy'}).some((c) => c.value === 'sol'));
  assert.ok(core.graph.historicalClaims({subjectId:'sun-blade',predicate:'location'}).some((c) => c.value === 'eris' && c.provenance.sourceRevisionIds.includes('lore:sun-blade@2')));
  assert.equal(core.registry.getRevision('lore:sun-blade@1').exactContent, 'The Sun Blade is carried by Eris.');
  assert.equal(core.registry.getActiveRevision('lore:sun-blade').exactContent, 'The Sun Blade is carried by Eris and forged by Sol.');

  const postEditPast = core.query(EMBER_TAVERN_WORLD.expected.historicalQuery, {intent:'HISTORICAL',anchorEntityIds:['sun-blade']});
  const relearnedCarry = postEditPast.packet.historical.find((f) => f.e === 'sun-blade' && f.p === 'location' && f.v === 'eris');
  assert.ok(relearnedCarry);
  assert.deepEqual(postEditPast.packet.provenanceIndex[relearnedCarry.id], ['lore:sun-blade@2']);
  assert.ok(JSON.stringify(postEditPast.packet).length < 2500);
  assert.equal(JSON.stringify(postEditPast.packet).includes('The Sun Blade is carried by Eris'), false);
});

test('Temporal State Graph exposes contradiction and unresolved state without inventing a current winner', () => {
  const registry = new SourceRegistry();
  registry.importSource({ id:'lore:conflict-a', sourceType:'LORE', content:'A' });
  registry.importSource({ id:'lore:conflict-b', sourceType:'LORE', content:'B' });
  const graph = new TemporalStateGraph();
  const mk = (id, revisionId, value) => {
    const provenance = createProvenance({ id:`prov:${id}`, sourceRevisionIds:[revisionId], activity:'TEST', agent:'golden-world' });
    const claim = createClaim({ id, subjectId:'door', predicate:'state', value, temporal:{kind:'CURRENT',validFrom:0,validUntil:null}, authorityClass:AuthorityClass.SOURCE_CANON, provenance });
    return createMutationProposal({ id:`proposal:${id}`, mutationType:MutationType.SET_CLAIM, owner:'WORLD_STATE', sourceRevisionIds:[revisionId], payload:{claim} });
  };
  graph.settleProposal(mk('claim:open','lore:conflict-a@1','open'), registry);
  graph.settleProposal(mk('claim:closed','lore:conflict-b@1','closed'), registry);
  assert.equal(graph.currentClaims({subjectId:'door',predicate:'state'}).length, 0);
  assert.equal(graph.getClaim('claim:open').status, KnowledgeStatus.CONTRADICTED);
  assert.equal(graph.getClaim('claim:closed').status, KnowledgeStatus.CONTRADICTED);
  assert.deepEqual(graph.unresolvedState('door','state').claimIds, ['claim:closed','claim:open']);
  assert.ok(graph.neighbors('door',{limit:1}).length <= 1);
});

import { runEmberTavernGoldenWorld } from './golden-harness.js';

test('golden-world harness scores the complete Ember Tavern acceptance surface', () => {
  const scored = runEmberTavernGoldenWorld();
  assert.equal(scored.pass, true, JSON.stringify(scored.metrics, null, 2));
  assert.equal(scored.metrics.currentStateAccuracy, 1);
  assert.equal(scored.metrics.historicalStateAccuracy, 1);
  assert.equal(scored.metrics.staleCurrentEscapes, 0);
  assert.equal(scored.metrics.provenanceCompleteness, 1);
  assert.equal(scored.metrics.retrievalChannelsCovered, true);
  assert.equal(scored.metrics.unrelatedKnowledgeSurvived, true);
});
