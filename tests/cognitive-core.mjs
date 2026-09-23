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
