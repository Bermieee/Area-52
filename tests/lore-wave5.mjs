import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';
import {LoreHierarchyRetrievalSystem} from '../src/lore-hierarchy-retrieval-system.js';
import {DeterministicNavigationSummaryProvider} from '../src/lore-navigation-summary-builder.js';
import {LoreStudyRuntime} from '../src/lore-study-runtime.js';

function harborBook() {
  return {
    id: 'st-harbor-world',
    title: 'Harbor World',
    discovery: {kind: 'SillyTavernCurrentLorebook', source: 'WORLD_INFO', name: 'Harbor World'},
    entries: [
      {
        uid: 'mira',
        content: [
          'Mira owns the Lantern Hall.',
          'Mira knows Oren.',
          'Mira protects civilians during storms.',
          'Only Lantern Wardens may enter the Tide Vault.',
          'Except when the harbor bell rings, visitors must remain outside.',
        ].join(' '),
        metadata: {title: 'Mira', treePath: ['Harbor', 'People'], order: 1},
      },
      {
        uid: 'harbor-history',
        content: [
          'Oren formerly owned the Lantern Hall.',
          'A witness reports that the Tideglass was removed before the fire.',
          'The Tideglass was destroyed in the Harbor fire.',
        ].join(' '),
        metadata: {title: 'Harbor History', treePath: ['Harbor', 'History'], order: 2},
      },
    ],
    fullSnapshot: true,
  };
}

function skyBook() {
  return {
    id: 'st-sky-world',
    title: 'Sky Archive',
    discovery: {kind: 'SillyTavernCurrentLorebook', source: 'WORLD_INFO', name: 'Sky Archive'},
    entries: [
      {
        uid: 'kai',
        content: [
          'Kai owns the Sky Archive.',
          'Kai carries the Star Key.',
          'Kai protects travelers during blizzards.',
          'Only Star Readers may enter the Upper Vault.',
          'Except when evacuation is declared, guests must remain below.',
        ].join(' '),
        metadata: {title: 'Kai', treePath: ['Archive', 'People'], order: 1},
      },
      {
        uid: 'sky-history',
        content: [
          'Rin formerly owned the Sky Archive.',
          'A witness reports that the Moon Lens was removed before the fire.',
          'The Moon Lens was destroyed in the Archive fire.',
        ].join(' '),
        metadata: {title: 'Sky History', treePath: ['Archive', 'History'], order: 2},
      },
    ],
    fullSnapshot: true,
  };
}

function buildTwoWorlds(service = new LoreIntelligenceService()) {
  service.acceptLorebook(harborBook());
  service.acceptLorebook(skyBook());
  const start = performance.now();
  const run = service.runStudy();
  const studyMs = performance.now() - start;
  return {service, run, studyMs};
}

test('learns world-specific ontology without fixed RP taxonomy and exposes grounded multilevel summaries', () => {
  const {service, studyMs} = buildTwoWorlds();
  const status = service.status();
  assert.equal(status.counts.READY, 4);

  const ontology = status.ontology;
  assert.equal(ontology.learnedFromWorldLore, true);
  assert.equal(ontology.fixedRpOntologyRequired, false);
  assert.equal(ontology.temporalStateAuthority, false);
  assert.ok(ontology.nodes.some((row) => row.id === 'concept:relation-subject:owns'));
  assert.ok(ontology.nodes.some((row) => row.id === 'relationship:owns'));
  assert.equal(ontology.nodes.some((row) => ['tavern', 'weapon', 'proprietor'].includes(row.label)), false);
  assert.ok(ontology.sourceRevisionFence.every((id) => id.includes('@r')));
  assert.ok(ontology.communities.length > 0);
  assert.ok(ontology.communities.every((row) => row.sourceRevisionRefs.length >= 2 && row.sourceAuthority === false));

  const summaries = service.summarySurface();
  assert.ok((summaries.counts.ENTRY || 0) >= 4);
  assert.ok((summaries.counts.BOOK || 0) >= 2);
  assert.ok((summaries.counts.COMMUNITY || 0) >= 1);
  assert.ok((summaries.counts.CORPUS || 0) >= 1);
  assert.ok(summaries.summaries.every((row) => row.authorityClass === 'DERIVED' && row.sourceAuthority === false && row.truthAuthority === false));
  assert.ok(summaries.summaries.every((row) => row.sourceRevisionRefs.length > 0));
  assert.ok(summaries.summaries.every((row) => row.qualityReceipt.status === 'PASS'));
  assert.ok(summaries.summaries.every((row) => row.qualityReceipt.criticalEvidenceRetained === row.qualityReceipt.criticalEvidenceTotal));

  const harborLeaf = summaries.summaries.find((row) => row.level === 'ENTRY' && row.content.includes('Lantern Wardens'));
  assert.ok(harborLeaf);
  assert.match(harborLeaf.content, /\[RULE\].*Lantern Wardens/);
  assert.match(harborLeaf.content, /\[EXCEPTION\].*harbor bell/);
  assert.match(harborLeaf.content, /\[BEHAVIOR\].*protects civilians/);
  assert.ok(harborLeaf.qualityReceipt.hardRulesRetained >= 1);
  assert.ok(harborLeaf.qualityReceipt.exceptionsRetained >= 1);
  assert.ok(harborLeaf.qualityReceipt.behaviorRetained >= 1);

  console.log('LORE_WAVE5_METRIC', JSON.stringify({
    studyMs: Number(studyMs.toFixed(2)),
    readyEntries: status.counts.READY,
    ontologyNodes: ontology.nodes.length,
    ontologyEdges: ontology.edges.length,
    communities: ontology.communities.length,
    summaries: summaries.summaries.length,
    entrySummaries: summaries.counts.ENTRY || 0,
    bookSummaries: summaries.counts.BOOK || 0,
    communitySummaries: summaries.counts.COMMUNITY || 0,
  }));
});

test('broad thematic retrieval and narrow detailed retrieval retain exact-source drillback', () => {
  const {service} = buildTwoWorlds();

  const broadStart = performance.now();
  const broad = service.queryForBrain({query: 'Harbor history', intent: 'BROAD'});
  const broadMs = performance.now() - broadStart;
  assert.equal(broad.desiredProfile, 'LEAN');
  assert.ok(broad.nominations.length > 0);
  assert.ok(broad.nominations.some((row) => row.nomination.metadata.loreResolution !== 'EXACT_SOURCE'));
  assert.ok(broad.summaries.some((row) => ['BOOK', 'COMMUNITY', 'TOPIC'].includes(row.level)));
  assert.ok(broad.sourceRevisionFence.every((id) => id.startsWith('lore:st-harbor-world:') || id.startsWith('lore:st-sky-world:')));
  assert.ok(broad.nominations.flatMap((row) => row.drillback).every((row) => row.exactAuthoredText && row.sourceRevisionId));

  const narrowStart = performance.now();
  const narrow = service.queryForBrain({query: 'Tideglass removed before fire', intent: 'NARROW'});
  const narrowMs = performance.now() - narrowStart;
  assert.equal(narrow.desiredProfile, 'HEAVY');
  assert.ok(narrow.nominations.length > 0);
  const detailed = narrow.nominations.flatMap((row) => row.drillback).find((row) => row.sourceId === 'lore:st-harbor-world:harbor-history');
  assert.ok(detailed);
  assert.match(detailed.exactAuthoredText, /Tideglass/);
  assert.equal(detailed.selectedRepresentation.profile, 'HEAVY');
  assert.ok(narrow.conflicts.every((row) => row.authorityClass === 'UNRESOLVED'));

  console.log('LORE_WAVE5_RETRIEVAL_METRIC', JSON.stringify({
    broadMs: Number(broadMs.toFixed(3)),
    narrowMs: Number(narrowMs.toFixed(3)),
    broadNominations: broad.nominations.length,
    narrowNominations: narrow.nominations.length,
    broadSummaryRefs: broad.summaries.length,
    narrowRevisionFence: narrow.sourceRevisionFence.length,
  }));
});

test('summary quality failure cannot publish a lossy summary and exact-source retrieval remains usable', () => {
  class DropCriticalProvider extends DeterministicNavigationSummaryProvider {
    generate(request) {
      const draft = super.generate(request);
      if (draft.failed) return draft;
      const critical = request.allowedStatements.find((row) => row.critical);
      if (!critical) return draft;
      const statementRefs = draft.statementRefs.filter((ref) => ref !== critical.statementId);
      const allowed = new Map(request.allowedStatements.map((row) => [row.statementId, row.text]));
      return {...draft, statementRefs, content: statementRefs.map((ref) => allowed.get(ref)).join('\n')};
    }
  }

  const runtime = new LoreStudyRuntime();
  const hierarchy = new LoreHierarchyRetrievalSystem({runtime, summaryProvider: new DropCriticalProvider()});
  const service = new LoreIntelligenceService({runtime, hierarchy});
  service.acceptLorebook(harborBook());
  service.runStudy();

  const diagnostics = service.hierarchy.diagnostics();
  assert.ok(diagnostics.build.counts.BLOCKED > 0);
  assert.equal(service.summarySurface().summaries.some((row) => row.content.includes('Lantern Wardens')), false);

  const detail = service.queryForBrain({query: 'Lantern Wardens Tide Vault', intent: 'NARROW'});
  assert.ok(detail.nominations.length > 0);
  assert.ok(detail.nominations.some((row) => row.nomination.metadata.loreResolution === 'EXACT_SOURCE'));
  assert.ok(detail.nominations.flatMap((row) => row.drillback).some((row) => row.exactAuthoredText.includes('Lantern Wardens')));
});

test('edit invalidates only the affected summary/ontology dependency cone and unrelated book remains reusable', () => {
  const {service} = buildTwoWorlds();
  const beforeSummaries = service.summarySurface().summaries;
  const skyBookSummary = beforeSummaries.find((row) => row.level === 'BOOK' && row.lorebookId === 'st-sky-world');
  const harborBookSummary = beforeSummaries.find((row) => row.level === 'BOOK' && row.lorebookId === 'st-harbor-world');
  assert.ok(skyBookSummary && harborBookSummary);

  const edited = harborBook();
  edited.entries[0] = {
    ...edited.entries[0],
    content: [
      'Mira formerly owned the Lantern Hall.',
      'Oren owns the Lantern Hall.',
      'Mira protects civilians during storms.',
      'Only Lantern Wardens may enter the Tide Vault.',
      'Except when the harbor bell rings, visitors must remain outside.',
    ].join(' '),
  };
  const accepted = service.acceptLorebook(edited);
  const changed = accepted.changes.find((row) => row.uid === 'mira');
  assert.equal(changed.changed, true);
  assert.equal(service.status().entries.find((row) => row.sourceId === 'lore:st-sky-world:kai').operatorState, 'READY');

  service.runStudy();
  const afterSummaries = service.summarySurface().summaries;
  const skyAfter = afterSummaries.find((row) => row.level === 'BOOK' && row.lorebookId === 'st-sky-world');
  const harborAfter = afterSummaries.find((row) => row.level === 'BOOK' && row.lorebookId === 'st-harbor-world');
  assert.equal(skyAfter.summaryRef, skyBookSummary.summaryRef);
  assert.notEqual(harborAfter.summaryRef, harborBookSummary.summaryRef);

  const impact = service.ontology.impactForSource('lore:st-harbor-world:mira');
  assert.equal(impact.unrelatedSourcesRemainIndependent, true);
  assert.ok(impact.affectedNodeIds.length > 0);
});

test('removal and checkpoint reload preserve dependency-scoped readiness', () => {
  const service = new LoreIntelligenceService();
  service.acceptLorebook(harborBook());
  const partial = service.runStudy({maxUnitsPerObligation: 2, rebuildRetrieval: false});
  assert.ok(partial.results.some((row) => row.checkpointed));
  const restored = LoreIntelligenceService.fromSnapshot(service.snapshot());
  restored.runStudy();

  const snapshot = harborBook();
  snapshot.entries = [snapshot.entries[0]];
  restored.acceptLorebook(snapshot);
  restored.runStudy();

  const removed = restored.status().entries.find((row) => row.sourceId === 'lore:st-harbor-world:harbor-history');
  assert.equal(removed.operatorState, 'REMOVED');
  const activeOntology = restored.status().ontology;
  assert.equal(activeOntology.sourceRevisionFence.includes('lore:st-harbor-world:harbor-history@r1'), false);
  const packet = restored.queryForBrain({query: 'Tideglass', intent: 'NARROW'});
  assert.equal(packet.nominations.flatMap((row) => row.drillback).some((row) => row.sourceId === 'lore:st-harbor-world:harbor-history'), false);
});
