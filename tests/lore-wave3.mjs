import test from 'node:test';
import assert from 'node:assert/strict';
import {LoreStudyRuntime as Runtime} from '../src/lore-study-runtime.js';
import {
  LORE_WAVE3_LIMITS,
  NavigationScopeType,
  NavigationSummaryState,
} from '../src/lore-navigation-contracts.js';
import {deriveLoreNavigationHierarchy} from '../src/lore-navigation-hierarchy.js';
import {
  DeterministicNavigationSummaryProvider,
} from '../src/lore-navigation-summary-builder.js';
import {LoreHierarchyRetrievalSystem} from '../src/lore-hierarchy-retrieval-system.js';

function add(runtime, {book='wave3', uid, content, title=null, treePath=[]}) {
  runtime.registerLorebook({id: book, title: book});
  const result = runtime.upsertEntry({
    lorebookId: book,
    uid,
    content,
    metadata: {title: title || String(uid), treePath},
  });
  runtime.run(result.obligation.id);
  return 'lore:' + book + ':' + uid;
}

function emberWorld() {
  const runtime = new Runtime();
  const ids = {};
  ids.mara = add(runtime, {
    book:'ember3', uid:1, title:'Mara and Ember Tavern', treePath:['Places','Ember Tavern'],
    content:'Mara owns the Ember Tavern. Mara must never reveal the cellar key.',
  });
  ids.bladeHistory = add(runtime, {
    book:'ember3', uid:2, title:'Eris and Sun Blade History', treePath:['Artifacts','Sun Blade'],
    content:'Eris carried the Sun Blade. Eris later left the Sun Blade at the Ember Tavern.',
  });
  ids.tavernFire = add(runtime, {
    book:'ember3', uid:3, title:'Ember Tavern Fire', treePath:['Places','Ember Tavern'],
    content:'The Ember Tavern later burned.',
  });
  ids.bladeFate = add(runtime, {
    book:'ember3', uid:4, title:'Sun Blade Fate', treePath:['Artifacts','Sun Blade'],
    content:'The Sun Blade was destroyed in the Ember Tavern fire. A witness reports the Sun Blade was removed before the fire.',
  });
  ids.pronoun = add(runtime, {
    book:'ember3', uid:5, title:'Eris Sun Blade Cache', treePath:['Artifacts','Sun Blade'],
    content:'Eris carried the Sun Blade. She left it there.',
  });
  ids.north = add(runtime, {
    book:'ember3', uid:6, title:'North Tavern', treePath:['Factions','North'],
    content:'The North Tavern is a tavern.',
  });
  ids.south = add(runtime, {
    book:'ember3', uid:7, title:'South Tavern', treePath:['Factions','South'],
    content:'The South Tavern is a tavern.',
  });
  const system = new LoreHierarchyRetrievalSystem({runtime});
  system.refreshHierarchy();
  const build = system.buildAll({maxUnits: 8});
  assert.equal(build.state, 'COMPLETED');
  return {runtime, system, ids};
}

function scopeForPath(system, path) {
  return system.hierarchy.scopes.find((scope) =>
    scope.type === NavigationScopeType.TREE && JSON.stringify(scope.treePath) === JSON.stringify(path)
  );
}

test('derived hierarchy preserves authored Tree and creates bounded tree/community/corpus scopes', () => {
  const {runtime, system, ids} = emberWorld();
  const sourceRevision = runtime.registry.currentRevision(ids.mara);
  assert.deepEqual(sourceRevision.metadata.treePath, ['Places','Ember Tavern']);
  assert.equal(system.hierarchy.authoredTreeMutated, false);
  assert.ok(system.hierarchy.scopes.some((scope) => scope.type === NavigationScopeType.LEAF));
  assert.ok(system.hierarchy.scopes.some((scope) => scope.type === NavigationScopeType.TREE));
  assert.ok(system.hierarchy.scopes.some((scope) => scope.type === NavigationScopeType.CORPUS));
  const crossBranch = system.hierarchy.scopes.find((scope) =>
    scope.type === NavigationScopeType.COMMUNITY
    && scope.sourceIds.includes(ids.north)
    && scope.sourceIds.includes(ids.south)
  );
  assert.ok(crossBranch, 'expected evidence-backed community spanning two Tree branches');
  assert.equal(crossBranch.treeTruthAuthority, false);
  assert.equal(crossBranch.entityMergeAuthority, false);
  assert.ok(system.hierarchy.scopes.every((scope) => scope.childScopeIds.length <= LORE_WAVE3_LIMITS.maxChildrenPerSummary));
});

test('bottom-up summaries carry source revisions, child dependencies, provenance and quality receipts', () => {
  const {system} = emberWorld();
  const summaries = system.summaryRegistry.activeSummaries();
  assert.ok(summaries.length > 0);
  for (const summary of summaries) {
    assert.ok(summary.targetScopeId);
    assert.ok(summary.structureRevision);
    assert.ok(summary.sourceRevisionSet.length > 0);
    assert.ok(Array.isArray(summary.childSummaryDependencies));
    assert.equal(summary.qualityReceipt.status, 'PASS');
    assert.equal(summary.authorityClass, 'DERIVED');
    assert.equal(summary.sourceAuthority, false);
    assert.equal(summary.truthAuthority, false);
    assert.equal(summary.settlementAuthority, false);
    assert.equal(summary.candidateBusAdmissionAuthority, false);
    assert.equal(summary.contextSealAuthority, false);
  }
});

test('Ember temporal/current/unresolved evidence survives every dependent summary level', () => {
  const {system, ids} = emberWorld();
  const checks = [
    [ids.tavernFire, /\[CURRENT\].*Ember Tavern state Destroyed/i],
    [ids.bladeHistory, /\[HISTORICAL\].*Eris left Sun Blade at Ember Tavern/i],
    [ids.bladeFate, /\[UNRESOLVED\].*Removed Before Fire/i],
  ];
  for (const [sourceId, pattern] of checks) {
    const scopes = system.hierarchy.scopes.filter((scope) => scope.sourceIds.includes(sourceId));
    assert.ok(scopes.length >= 2);
    for (const scope of scopes) {
      const summary = system.currentSummary(scope.id);
      assert.ok(summary, 'missing current summary for ' + scope.id);
      assert.match(summary.content, pattern, scope.label);
    }
  }
  const fateScopes = system.hierarchy.scopes.filter((scope) => scope.sourceIds.includes(ids.bladeFate));
  for (const scope of fateScopes) {
    const text = system.currentSummary(scope.id).content;
    assert.match(text, /Destroyed In Fire/i);
    assert.match(text, /Removed Before Fire/i);
    assert.match(text, /UNRESOLVED/i);
  }
});

test('narrow Mara and Sun Blade queries favor exact fresh source-backed nominations', () => {
  const {system} = emberWorld();
  for (const query of ['Mara', 'Sun Blade']) {
    const result = system.query({query, intent:'NARROW'});
    assert.ok(result.nominations.length > 0);
    assert.equal(result.nominations[0].metadata.loreResolution, 'EXACT_SOURCE');
    assert.equal(result.nominations[0].freshness, 'FRESH');
    assert.equal(result.nominations[0].admissionAuthority, false);
    const drill = system.drillDown(result.nominations[0]);
    assert.ok(drill.length >= 1);
    assert.ok(drill[0].exactAuthoredText);
  }
});

test('pronoun-heavy source is retrievable through contextual identity without source mutation', () => {
  const {runtime, system, ids} = emberWorld();
  const before = runtime.registry.currentRevision(ids.pronoun).exactContent;
  assert.equal(before, 'Eris carried the Sun Blade. She left it there.');
  const direct = system.query({query:'She left it there', intent:'NARROW'});
  assert.ok(direct.nominations.some((row) => row.metadata.sourceDrillbackRefs.includes(ids.pronoun)));
  const contextual = system.query({query:'Eris Sun Blade left', intent:'NARROW'});
  assert.ok(contextual.nominations.some((row) => row.metadata.sourceDrillbackRefs.includes(ids.pronoun)));
  assert.equal(runtime.registry.currentRevision(ids.pronoun).exactContent, before);
});

test('broad Tavern query can nominate navigation/community resolution and drill to exact sources', () => {
  const {system} = emberWorld();
  const result = system.query({query:'Tell me about the Ember Tavern', intent:'BROAD'});
  assert.ok(result.nominations.length > 0);
  const summaryNom = result.nominations.find((row) => row.metadata.loreResolution !== 'EXACT_SOURCE');
  assert.ok(summaryNom);
  assert.equal(summaryNom.authorityClass, 'DERIVED');
  assert.equal(summaryNom.metadata.summaryTruthAuthority, false);
  const drill = system.drillDown(summaryNom);
  assert.ok(drill.length >= 1);
  assert.ok(drill.every((row) => row.exactAuthoredText));
});

test('Core Candidate Bus nomination shape remains authority-negative and bounded', () => {
  const {system} = emberWorld();
  const result = system.query({query:'Ember Tavern history', intent:'BROAD'});
  assert.ok(result.nominations.length <= LORE_WAVE3_LIMITS.maxNominationsPerIntent);
  for (const row of result.nominations) {
    assert.equal(row.kind, 'CandidateNomination');
    assert.equal(row.contractVersion, '1.0.0');
    assert.equal(row.channelVersion, '1.0.0');
    assert.ok(row.evidenceIdentity);
    assert.ok(Array.isArray(row.sourceRevisionRefs));
    assert.ok(Array.isArray(row.retrievalIntentIds));
    assert.ok(row.normalizedRank >= 0 && row.normalizedRank <= 1);
    assert.ok(row.representationText.length <= LORE_WAVE3_LIMITS.maxCandidateTextCharacters);
    assert.equal(row.authorityGranted, false);
    assert.equal(row.admissionAuthority, false);
    assert.equal(row.settlementAuthority, false);
    assert.equal(row.canonicalMutationAuthority, false);
    assert.equal(row.metadata.retrievalRankAuthority, false);
    assert.equal(row.metadata.communityTruthAuthority, false);
    assert.equal(row.metadata.contextSealAuthority, false);
  }
});

test('editing one deep UID rebuilds leaf and ancestor cone while unrelated branch summary is reused', () => {
  const {runtime, system, ids} = emberWorld();
  const affectedLeaf = system.hierarchy.scopes.find((scope) => scope.type === NavigationScopeType.LEAF && scope.sourceIds[0] === ids.mara);
  const affectedParent = system.hierarchy.scopes.find((scope) => scope.childScopeIds.includes(affectedLeaf.id));
  const unrelated = scopeForPath(system, ['Factions','South']);
  const beforeLeaf = system.currentSummary(affectedLeaf.id).id;
  const beforeParent = system.currentSummary(affectedParent.id).id;
  const beforeUnrelated = system.currentSummary(unrelated.id).id;

  const update = runtime.upsertEntry({
    lorebookId:'ember3', uid:1,
    content:'Mara formerly owned the Ember Tavern. Mara must never reveal the cellar key.',
    metadata:{title:'Mara and Ember Tavern', treePath:['Places','Ember Tavern']},
  });
  runtime.run(update.obligation.id);
  system.refreshHierarchy();
  assert.equal(system.currentSummary(affectedLeaf.id), null);
  assert.equal(system.currentSummary(affectedParent.id), null);
  assert.equal(system.currentSummary(unrelated.id).id, beforeUnrelated);
  system.buildAll({maxUnits:8});
  assert.notEqual(system.currentSummary(affectedLeaf.id).id, beforeLeaf);
  assert.notEqual(system.currentSummary(affectedParent.id).id, beforeParent);
  assert.equal(system.currentSummary(unrelated.id).id, beforeUnrelated);
  assert.match(system.currentSummary(affectedLeaf.id).content, /HISTORICAL/i);
});

test('Tree-only reorganization changes navigation dependencies without rewriting source meaning', () => {
  const {runtime, system, ids} = emberWorld();
  const exactBefore = runtime.registry.currentRevision(ids.north).exactContent;
  const oldScope = scopeForPath(system, ['Factions','North']);
  const unrelated = scopeForPath(system, ['Factions','South']);
  const unrelatedSummary = system.currentSummary(unrelated.id).id;
  const move = runtime.upsertEntry({
    lorebookId:'ember3', uid:6,
    content:exactBefore,
    metadata:{title:'North Tavern', treePath:['Organizations','North']},
  });
  runtime.run(move.obligation.id);
  assert.equal(runtime.registry.currentRevision(ids.north).exactContent, exactBefore);
  system.refreshHierarchy();
  assert.equal(system.currentSummary(oldScope.id), null);
  assert.equal(system.currentSummary(unrelated.id).id, unrelatedSummary);
  system.buildAll({maxUnits:8});
  const newScope = scopeForPath(system, ['Organizations','North']);
  assert.ok(newScope);
  assert.ok(system.currentSummary(newScope.id));
  assert.equal(runtime.registry.currentRevision(ids.north).exactContent, exactBefore);
});

test('failed child summary blocks only its ancestor cone', () => {
  const runtime = new Runtime();
  const a = add(runtime, {book:'fail',uid:1,title:'A',treePath:['A'],content:'Aster is a note.'});
  add(runtime, {book:'fail',uid:2,title:'B',treePath:['B'],content:'Bryn is a note.'});
  const hierarchy = deriveLoreNavigationHierarchy(runtime);
  const leaf = hierarchy.scopes.find((scope) => scope.type === NavigationScopeType.LEAF && scope.sourceIds[0] === a);
  const system = new LoreHierarchyRetrievalSystem({runtime});
  system.refreshHierarchy();
  system.builder.provider = new DeterministicNavigationSummaryProvider({failScopeIds:[leaf.id]});
  const build = system.buildAll({maxUnits:4});
  assert.ok(build.blockedScopeIds.includes(leaf.id));
  const parentA = scopeForPath(system, ['A']);
  const parentB = scopeForPath(system, ['B']);
  assert.equal(system.currentSummary(parentA.id), null);
  assert.ok(system.currentSummary(parentB.id));
  assert.ok(build.blockedScopeIds.includes(parentA.id));
});

test('checkpoint/reload resumes bounded hierarchy build from the saved cursor', () => {
  let runtime = new Runtime();
  for (let i=0;i<40;i++) add(runtime,{book:'reload',uid:i,title:'Entry '+i,treePath:['Branch'+(i%4)],content:'Record'+i+' is a note.'});
  let system = new LoreHierarchyRetrievalSystem({runtime});
  system.refreshHierarchy();
  let session = system.beginBuild();
  session = system.runBuild(session.id,{maxUnits:5});
  assert.equal(session.state,'CHECKPOINTED');
  const cursor = session.checkpoint.cursor;
  const runtimeSnapshot = runtime.snapshot();
  const systemSnapshot = system.snapshot();

  runtime = Runtime.fromSnapshot(runtimeSnapshot);
  system = LoreHierarchyRetrievalSystem.fromSnapshot({runtime,snapshot:systemSnapshot});
  while (session.state !== 'COMPLETED') session = system.runBuild(session.id,{maxUnits:7});
  assert.ok(session.checkpoint.cursor > cursor);
  system.refreshRetrieval();
  const result = system.query({query:'Record17',intent:'NARROW'});
  assert.ok(result.nominations.length > 0);
  assert.equal(system.diagnostics().build.activeSessions,0);
});

test('stale or unstudied entries never surface as fresh nominations', () => {
  const runtime = new Runtime();
  runtime.registerLorebook({id:'stale'});
  const added = runtime.upsertEntry({lorebookId:'stale',uid:1,content:'Mara owns the Ember Tavern.',metadata:{title:'Mara',treePath:['Places']}});
  const system = new LoreHierarchyRetrievalSystem({runtime});
  system.rebuild();
  assert.equal(system.query({query:'Mara',intent:'NARROW'}).nominations.length,0);
  runtime.run(added.obligation.id);
  system.rebuild();
  assert.ok(system.query({query:'Mara',intent:'NARROW'}).nominations.length > 0);
  const update = runtime.upsertEntry({lorebookId:'stale',uid:1,content:'Mara formerly owned the Ember Tavern.',metadata:{title:'Mara',treePath:['Places']}});
  system.refreshHierarchy();
  system.refreshRetrieval();
  assert.equal(system.query({query:'Mara',intent:'NARROW'}).nominations.length,0);
  runtime.run(update.obligation.id);
  system.rebuild();
  assert.ok(system.query({query:'Mara',intent:'NARROW'}).nominations.length > 0);
});

test('diagnostics expose bounded built/blocked/stale/reused/pending status and no scheduler authority', () => {
  const {system} = emberWorld();
  const first = system.diagnostics();
  assert.ok(first.hierarchyScopes > 0);
  assert.equal(first.build.runtimeSchedulingAuthority,false);
  assert.equal(first.build.physicalWorkerAuthority,false);
  system.buildAll({maxUnits:8});
  const second = system.diagnostics();
  assert.ok(second.build.counts.REUSED > 0);
  assert.ok(second.retrieval.diagnostics.length <= LORE_WAVE3_LIMITS.maxDiagnostics);
  assert.equal(second.authorityGranted,false);
  assert.equal(second.candidateBusAdmissionAuthority,false);
  assert.equal(second.settlementAuthority,false);
  assert.equal(second.contextSealAuthority,false);
});

test('query bounds are enforced deterministically', () => {
  const {system} = emberWorld();
  const result = system.query({query:'Tavern',intent:'BROAD'});
  assert.ok(result.diagnostics.examined <= LORE_WAVE3_LIMITS.maxExaminedEntries);
  assert.ok(result.nominations.length <= LORE_WAVE3_LIMITS.maxTotalNominations);
  assert.throws(()=>system.query({query:'x'.repeat(LORE_WAVE3_LIMITS.maxQueryCharacters+1)}),/QUERY_LENGTH_LIMIT/);
});
