import test from 'node:test';
import assert from 'node:assert/strict';

import {LoreStudyRuntime} from '../src/lore-study-runtime.js';
import {LoreHierarchyRetrievalSystem} from '../src/lore-hierarchy-retrieval-system.js';
import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';
import {NavigationScopeType} from '../src/lore-navigation-contracts.js';
import {worker4LargeCurrentLorebook, WORKER4_SELECTED_CHAT} from './fixtures/worker4-lore-readiness-fixtures.mjs';

function add(runtime, {uid, title, treePath, content}) {
  runtime.registerLorebook({id: 'hierarchy-evidence', title: 'Hierarchy Evidence'});
  const row = runtime.upsertEntry({
    lorebookId: 'hierarchy-evidence',
    uid,
    content,
    metadata: {title, treePath},
  });
  runtime.run(row.obligation.id);
  return 'lore:hierarchy-evidence:' + uid;
}

function evidenceWorld() {
  const runtime = new LoreStudyRuntime();
  const ids = {
    rule: add(runtime, {
      uid: 'rule',
      title: 'Mara Rule',
      treePath: ['Places', 'Ember Tavern'],
      content: 'Mara owns the Ember Tavern. Mara must never reveal the cellar key.',
    }),
    historical: add(runtime, {
      uid: 'historical',
      title: 'Sun Blade History',
      treePath: ['Artifacts', 'Sun Blade'],
      content: 'Eris carried the Sun Blade. Eris later left the Sun Blade at the Ember Tavern.',
    }),
    ambiguous: add(runtime, {
      uid: 'ambiguous',
      title: 'Sun Blade Fate',
      treePath: ['Artifacts', 'Sun Blade'],
      content: 'The Sun Blade was destroyed in the Ember Tavern fire. A witness reports the Sun Blade was removed before the fire.',
    }),
    north: add(runtime, {
      uid: 'north',
      title: 'North Tavern',
      treePath: ['Factions', 'North'],
      content: 'The North Tavern is a tavern.',
    }),
    south: add(runtime, {
      uid: 'south',
      title: 'South Tavern',
      treePath: ['Factions', 'South'],
      content: 'The South Tavern is a tavern.',
    }),
  };
  const system = new LoreHierarchyRetrievalSystem({runtime});
  system.refreshHierarchy();
  const build = system.buildAll({maxUnits: 8});
  assert.equal(build.state, 'COMPLETED');
  return {runtime, system, ids};
}

function scope(system, predicate, label) {
  const row = system.hierarchy.scopes.find(predicate);
  assert.ok(row, 'missing scope: ' + label);
  return row;
}

test('reference-backed summaries keep exact evidence drillback without ancestor payload copies', () => {
  const {runtime, system, ids} = evidenceWorld();
  const targets = [
    scope(system, (row) => row.type === NavigationScopeType.LEAF && row.sourceIds.includes(ids.historical), 'entry'),
    scope(system, (row) => row.type === NavigationScopeType.TREE && JSON.stringify(row.treePath) === JSON.stringify(['Artifacts', 'Sun Blade']), 'topic'),
    scope(system, (row) => row.type === NavigationScopeType.COMMUNITY && row.sourceIds.includes(ids.historical) && row.sourceIds.includes(ids.ambiguous), 'community'),
    scope(system, (row) => row.type === NavigationScopeType.TREE && row.treePath.length === 0 && row.lorebookId === 'hierarchy-evidence', 'book'),
    scope(system, (row) => row.type === NavigationScopeType.CORPUS, 'corpus'),
  ];

  for (const target of targets) {
    const summary = system.currentSummary(target.id);
    assert.ok(summary, target.type + ' summary missing');
    assert.equal(Object.hasOwn(summary, 'criticalEvidence'), false, target.type + ' must not embed raw critical evidence');
    assert.ok(Array.isArray(summary.criticalEvidenceRefs));
    assert.ok(summary.criticalEvidenceRefs.length > 0);
    assert.equal(summary.criticalEvidenceCount, summary.criticalEvidenceRefs.length);

    const drill = system.drillEvidence(summary.id);
    assert.equal(drill.status, 'COMPLETE');
    assert.deepEqual(drill.missingEvidenceRefs, []);
    assert.ok(drill.evidence.length > 0);
    assert.equal(drill.evidence.every((row) => row.sourceRevisionId && row.evidenceId && row.evidenceRef), true);
    assert.equal(drill.evidence.every((row) => runtime.registry.getRevision(row.sourceRevisionId)), true);
  }

  const historical = system.drillEvidence(system.currentSummary(targets[0].id).id);
  assert.ok(historical.evidence.some((row) => row.temporalClass === 'HISTORICAL'));

  const ambiguousLeaf = scope(system, (row) => row.type === NavigationScopeType.LEAF && row.sourceIds.includes(ids.ambiguous), 'ambiguous entry');
  const ambiguous = system.drillEvidence(system.currentSummary(ambiguousLeaf.id).id);
  assert.ok(ambiguous.evidence.some((row) => row.unresolved === true));

  const broad = system.query({query: 'Sun Blade history', intent: 'BROAD'});
  const summaryNomination = broad.nominations.find((row) => row.metadata.loreResolution !== 'EXACT_SOURCE');
  assert.ok(summaryNomination);
  assert.ok(summaryNomination.evidenceRefs.length > 0);
  assert.equal(summaryNomination.authorityClass, 'DERIVED');
  assert.equal(summaryNomination.metadata.summaryTruthAuthority, false);
});

test('missing referenced navigation evidence degrades closed instead of fabricating evidence', () => {
  const {system} = evidenceWorld();
  const corpus = scope(system, (row) => row.type === NavigationScopeType.CORPUS, 'corpus');
  const summary = system.currentSummary(corpus.id);
  const snapshot = system.snapshot();
  const missingRef = summary.criticalEvidenceRefs[0];

  snapshot.summaryRegistry.evidenceRegistry.records =
    snapshot.summaryRegistry.evidenceRegistry.records.filter((row) => row.evidenceRef !== missingRef);

  const restored = LoreHierarchyRetrievalSystem.fromSnapshot({runtime: system.runtime, snapshot});
  const drill = restored.drillEvidence(summary.id);
  assert.equal(drill.status, 'DEGRADED');
  assert.ok(drill.missingEvidenceRefs.includes(missingRef));

  restored.refreshRetrieval();
  const diagnostics = restored.diagnostics().retrieval.diagnostics;
  assert.ok(diagnostics.some((row) => row.summaryId === summary.id && row.status === 'SUMMARY_SKIPPED_MISSING_EVIDENCE'));
});


function asLegacyEmbeddedHierarchySnapshot(snapshot) {
  const legacy = structuredClone(snapshot);
  const registry = legacy.summaryRegistry || {};
  const evidenceByRef = new Map((registry.evidenceRegistry?.records || []).map((row) => [row.evidenceRef, row]));
  for (const summary of registry.summaries || []) {
    summary.criticalEvidence = (summary.criticalEvidenceRefs || [])
      .map((ref) => evidenceByRef.get(ref))
      .filter(Boolean)
      .map((row) => {
        const copy = structuredClone(row);
        delete copy.evidenceRef;
        return copy;
      });
    delete summary.criticalEvidenceRefs;
    delete summary.criticalEvidenceCount;
  }
  delete registry.evidenceRegistry;
  delete registry.contractVersion;
  return legacy;
}

function currentSummaryIdMap(system) {
  return new Map((system.summaryRegistry.snapshot().currentByScope || []).map(([scopeId, summaryId]) => [scopeId, summaryId]));
}

test('legacy embedded-evidence snapshots migrate deterministically without changing summary identity or history', () => {
  let {runtime, system, ids} = evidenceWorld();
  const affectedLeaf = scope(system, (row) => row.type === NavigationScopeType.LEAF && row.sourceIds.includes(ids.rule), 'affected leaf');
  const originalSummaryId = system.currentSummary(affectedLeaf.id).id;

  const update = runtime.upsertEntry({
    lorebookId: 'hierarchy-evidence',
    uid: 'rule',
    content: 'Mara formerly owned the Ember Tavern. Mara must never reveal the cellar key.',
    metadata: {title: 'Mara Rule', treePath: ['Places', 'Ember Tavern']},
  });
  runtime.run(update.obligation.id);
  system.refreshHierarchy();
  system.buildAll({maxUnits: 8});
  const replacementSummaryId = system.currentSummary(affectedLeaf.id).id;
  assert.notEqual(replacementSummaryId, originalSummaryId);

  const modernSnapshot = system.snapshot();
  const legacySnapshot = asLegacyEmbeddedHierarchySnapshot(modernSnapshot);
  const expectedSummaryRows = new Map(modernSnapshot.summaryRegistry.summaries.map((row) => [row.id, {
    state: row.state,
    freshness: row.freshness,
    replacedBySummaryId: row.replacedBySummaryId,
  }]));

  runtime = LoreStudyRuntime.fromSnapshot(runtime.snapshot());
  const restored = LoreHierarchyRetrievalSystem.fromSnapshot({runtime, snapshot: legacySnapshot});
  const migrated = restored.snapshot();

  assert.equal(migrated.summaryRegistry.contractVersion, 2);
  assert.ok(migrated.summaryRegistry.evidenceRegistry.records.length > 0);
  assert.equal(migrated.summaryRegistry.summaries.every((row) => !Object.hasOwn(row, 'criticalEvidence')), true);
  assert.equal(migrated.summaryRegistry.summaries.every((row) => Array.isArray(row.criticalEvidenceRefs)), true);

  for (const row of migrated.summaryRegistry.summaries) {
    assert.deepEqual({
      state: row.state,
      freshness: row.freshness,
      replacedBySummaryId: row.replacedBySummaryId,
    }, expectedSummaryRows.get(row.id));
  }

  assert.equal(restored.currentSummary(affectedLeaf.id).id, replacementSummaryId);
  const history = restored.summaryRegistry.history(affectedLeaf.id);
  assert.ok(history.some((row) => row.id === originalSummaryId && row.state === 'HISTORICAL'));
  const historicalEvidence = restored.drillEvidence(originalSummaryId, {limit: 256});
  assert.equal(historicalEvidence.status, 'COMPLETE');
  assert.ok(historicalEvidence.evidence.length > 0);
});

test('one source edit invalidates only its summary cone and keeps historical evidence drillable after reload', () => {
  let {runtime, system, ids} = evidenceWorld();
  const learnedBefore = new Map(runtime.registry.listEntries({includeRemoved: false}).map((source) => [
    source.sourceId,
    runtime.store.currentLearnedRevision(source.sourceId)?.id || null,
  ]));
  const summaryBefore = currentSummaryIdMap(system);
  const affectedScopes = system.hierarchy.scopes.filter((row) => row.sourceIds.includes(ids.rule)).map((row) => row.id);
  const unrelatedScopes = system.hierarchy.scopes.filter((row) => !row.sourceIds.includes(ids.rule)).map((row) => row.id);
  const oldAffected = new Map(affectedScopes.map((scopeId) => [scopeId, system.currentSummary(scopeId)?.id || null]));

  const edit = runtime.upsertEntry({
    lorebookId: 'hierarchy-evidence',
    uid: 'rule',
    content: 'Mara formerly owned the Ember Tavern. Mara must never reveal the cellar key. Mara protects the archive.',
    metadata: {title: 'Mara Rule', treePath: ['Places', 'Ember Tavern']},
  });
  assert.equal(runtime.dueObligations().length, 1);
  runtime.run(edit.obligation.id);
  assert.equal(runtime.dueObligations().length, 0);

  system.refreshHierarchy();
  for (const scopeId of affectedScopes) assert.equal(system.currentSummary(scopeId), null, 'dependent scope must stale: ' + scopeId);
  for (const scopeId of unrelatedScopes) {
    const beforeId = summaryBefore.get(scopeId);
    if (beforeId) assert.equal(system.currentSummary(scopeId)?.id || null, beforeId, 'unrelated scope must remain reusable: ' + scopeId);
  }

  system.buildAll({maxUnits: 8});
  for (const [scopeId, oldSummaryId] of oldAffected) {
    if (!oldSummaryId) continue;
    const current = system.currentSummary(scopeId);
    assert.ok(current);
    assert.notEqual(current.id, oldSummaryId);
    const old = system.summaryRegistry.get(oldSummaryId);
    assert.equal(old.state, 'HISTORICAL');
    assert.equal(system.drillEvidence(oldSummaryId, {limit: 256}).status, 'COMPLETE');
  }

  for (const [sourceId, learnedId] of learnedBefore) {
    if (sourceId === ids.rule) continue;
    assert.equal(runtime.store.currentLearnedRevision(sourceId)?.id || null, learnedId, 'unrelated source restudied: ' + sourceId);
  }

  const runtimeSnapshot = runtime.snapshot();
  const hierarchySnapshot = system.snapshot({compact: true});
  runtime = LoreStudyRuntime.fromSnapshot(runtimeSnapshot);
  system = LoreHierarchyRetrievalSystem.fromSnapshot({runtime, snapshot: hierarchySnapshot});
  assert.equal(runtime.dueObligations().length, 0);
  for (const oldSummaryId of oldAffected.values()) {
    if (oldSummaryId) assert.equal(system.drillEvidence(oldSummaryId, {limit: 256}).status, 'COMPLETE');
  }
});

function componentCharacters(snapshot) {
  const hierarchy = snapshot.hierarchy || {};
  const registry = hierarchy.summaryRegistry || {};
  return {
    total: JSON.stringify(snapshot).length,
    runtime: JSON.stringify(snapshot.runtime ?? null).length,
    multiResolution: JSON.stringify(snapshot.multiResolution ?? null).length,
    hierarchy: JSON.stringify(hierarchy).length,
    ontology: JSON.stringify(snapshot.ontology ?? null).length,
    storyAuthority: JSON.stringify(snapshot.storyAuthority ?? null).length,
    summaryRegistry: JSON.stringify(registry).length,
    summaryNodes: JSON.stringify(registry.summaries ?? []).length,
    evidenceRegistry: JSON.stringify(registry.evidenceRegistry ?? null).length,
    builder: JSON.stringify(hierarchy.builder ?? null).length,
    retrievalIndex: JSON.stringify(hierarchy.retrievalIndex ?? null).length,
  };
}

function legacyEquivalentServiceSnapshot(snapshot) {
  const copy = structuredClone(snapshot);
  copy.hierarchy = asLegacyEmbeddedHierarchySnapshot(copy.hierarchy);
  return copy;
}

test('105-entry reference-backed hierarchy reduces duplicated snapshot payload and retains incremental reload semantics', () => {
  const service = new LoreIntelligenceService();
  const source = worker4LargeCurrentLorebook({count: 105});
  const heapBefore = process.memoryUsage?.().heapUsed ?? null;
  const started = performance.now();
  service.acceptLorebook(source);
  const acceptedAt = performance.now();
  const study = service.runStudy({scope: 'DUE'});
  const studiedAt = performance.now();
  assert.equal(study.results.length, 105);

  const beforeEdit = service.status({chatId: WORKER4_SELECTED_CHAT});
  const learnedBefore = new Map(beforeEdit.entries.map((row) => [row.sourceId, row.learnedRevisionId]));
  const changed = structuredClone(source);
  changed.entries[51].content += ' Reference-backed revision W4-52-R2.';
  const editStarted = performance.now();
  service.acceptLorebook(changed);
  const editAcceptedAt = performance.now();
  assert.equal(service.runtime.dueObligations().length, 1);
  const editStudy = service.runStudy({scope: 'DUE'});
  const editFinished = performance.now();
  assert.equal(editStudy.results.length, 1);

  const afterEdit = service.status({chatId: WORKER4_SELECTED_CHAT});
  assert.equal(afterEdit.counts.READY, 105);
  for (const row of afterEdit.entries.filter((entry) => entry.uid !== '52')) {
    assert.equal(row.learnedRevisionId, learnedBefore.get(row.sourceId));
  }

  const snapshot = service.snapshot();
  const referenceChars = componentCharacters(snapshot);
  const legacyChars = componentCharacters(legacyEquivalentServiceSnapshot(snapshot));
  assert.ok(referenceChars.total < legacyChars.total);
  assert.ok(referenceChars.summaryRegistry < legacyChars.summaryRegistry);
  assert.equal(snapshot.hierarchy.summaryRegistry.summaries.every((row) => !Object.hasOwn(row, 'criticalEvidence')), true);

  const reloadStarted = performance.now();
  const restored = LoreIntelligenceService.fromSnapshot(snapshot);
  const reloadFinished = performance.now();
  const restoredStatus = restored.status({chatId: WORKER4_SELECTED_CHAT});
  assert.equal(restoredStatus.counts.READY, 105);
  assert.equal(restored.runtime.dueObligations().length, 0);
  assert.equal(restored.runStudy({scope: 'DUE'}).requested, 0);
  const heapAfter = process.memoryUsage?.().heapUsed ?? null;

  console.log('WORKER4_LORE_HIERARCHY_105_METRIC ' + JSON.stringify({
    entries: 105,
    priorObserved: {
      snapshotCharacters: 17595257,
      initialStudyAndIndexMs: 2275.38,
      singleEntryRestudyAndIndexMs: 650.63,
      reloadMs: 296.31,
    },
    initialAcceptMs: Number((acceptedAt - started).toFixed(2)),
    studyAndIndexMs: Number((studiedAt - acceptedAt).toFixed(2)),
    singleEntryAcceptMs: Number((editAcceptedAt - editStarted).toFixed(2)),
    singleEntryRestudyAndIndexMs: Number((editFinished - editAcceptedAt).toFixed(2)),
    reloadMs: Number((reloadFinished - reloadStarted).toFixed(2)),
    snapshotCharacters: referenceChars,
    legacyEquivalentCharacters: legacyChars,
    retainedUnrelatedLearnedRevisions: 104,
    restudiedEntriesAfterSingleEdit: editStudy.results.length,
    heapUsedBefore: heapBefore,
    heapUsedAfter: heapAfter,
    heapDelta: heapBefore == null || heapAfter == null ? null : heapAfter - heapBefore,
  }));
});

test('larger synthetic hierarchy remains reference-backed and reloadable without full restudy', () => {
  const count = 240;
  const service = new LoreIntelligenceService();
  const source = worker4LargeCurrentLorebook({count});
  const heapBefore = process.memoryUsage?.().heapUsed ?? null;
  const started = performance.now();
  service.acceptLorebook(source);
  const acceptedAt = performance.now();
  const study = service.runStudy({scope: 'DUE'});
  const studiedAt = performance.now();
  assert.equal(study.results.length, count);

  const snapshot = service.snapshot();
  const referenceChars = componentCharacters(snapshot);
  const legacyChars = componentCharacters(legacyEquivalentServiceSnapshot(snapshot));
  assert.ok(referenceChars.total < legacyChars.total);
  assert.ok(referenceChars.summaryRegistry < legacyChars.summaryRegistry);

  const reloadStarted = performance.now();
  const restored = LoreIntelligenceService.fromSnapshot(snapshot);
  const reloadFinished = performance.now();
  const status = restored.status({chatId: WORKER4_SELECTED_CHAT});
  assert.equal(status.counts.READY, count);
  assert.equal(restored.runtime.dueObligations().length, 0);
  assert.equal(restored.runStudy({scope: 'DUE'}).requested, 0);
  const heapAfter = process.memoryUsage?.().heapUsed ?? null;

  console.log('WORKER4_LORE_HIERARCHY_LARGE_METRIC ' + JSON.stringify({
    entries: count,
    initialAcceptMs: Number((acceptedAt - started).toFixed(2)),
    studyAndIndexMs: Number((studiedAt - acceptedAt).toFixed(2)),
    reloadMs: Number((reloadFinished - reloadStarted).toFixed(2)),
    snapshotCharacters: referenceChars,
    legacyEquivalentCharacters: legacyChars,
    evidenceRecords: snapshot.hierarchy.summaryRegistry.evidenceRegistry.records.length,
    summaryNodes: snapshot.hierarchy.summaryRegistry.summaries.length,
    heapUsedBefore: heapBefore,
    heapUsedAfter: heapAfter,
    heapDelta: heapBefore == null || heapAfter == null ? null : heapAfter - heapBefore,
  }));
});
