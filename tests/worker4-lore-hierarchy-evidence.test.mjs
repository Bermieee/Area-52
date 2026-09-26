import test from 'node:test';
import assert from 'node:assert/strict';

import {LoreStudyRuntime} from '../src/lore-study-runtime.js';
import {LoreHierarchyRetrievalSystem} from '../src/lore-hierarchy-retrieval-system.js';
import {NavigationScopeType} from '../src/lore-navigation-contracts.js';

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
