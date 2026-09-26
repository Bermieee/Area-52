import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';
import {LoreAuthoringService} from '../src/lore-authoring-service.js';

function harborBook({tideglass = 'intact', includeOren = true} = {}) {
  const entries = [
    {
      uid: 'mira',
      content: 'Mira owns the Lantern Hall. Mira knows Oren.',
      metadata: {title: 'Mira', treePath: ['Harbor', 'People'], order: 1},
    },
    {
      uid: 'tideglass',
      content: 'The Tideglass is ' + tideglass + '.',
      metadata: {title: 'Tideglass', treePath: ['Harbor', 'Relics'], order: 2},
    },
    {
      uid: 'vault-law',
      content: 'Only Lantern Wardens may enter the Tide Vault.',
      metadata: {title: 'Vault Law', treePath: ['Harbor', 'Rules'], order: 3},
    },
  ];
  if (includeOren) {
    entries.push({
      uid: 'oren',
      content: 'Oren knows Mira.',
      metadata: {title: 'Oren', treePath: ['Harbor', ' people '], order: 4},
    });
  }
  return {
    id: 'harbor-authored',
    title: 'Harbor Authored',
    discovery: {kind: 'SillyTavernLorebook', source: 'WORLD_INFO', name: 'Harbor Authored', stableId: 'st-book-harbor'},
    entries,
    fullSnapshot: true,
  };
}

function archiveBook() {
  return {
    id: 'mirror-archive',
    title: 'Mirror Archive',
    discovery: {kind: 'SillyTavernLorebook', source: 'WORLD_INFO', name: 'Mirror Archive', stableId: 'st-book-mirror'},
    entries: [
      {
        uid: 'mira',
        content: 'Mira carries the Tideglass. Mira knows Lio.',
        metadata: {title: 'Mira', treePath: ['Archive', 'Cast'], order: 1},
      },
      {
        uid: 'tideglass',
        content: 'The Tideglass is destroyed.',
        metadata: {title: 'Tideglass', treePath: ['Archive', 'Relics'], order: 2},
      },
      {
        uid: 'vault-law',
        content: 'Only Lantern Wardens may enter the Tide Vault.',
        metadata: {title: 'Vault Law', treePath: ['Archive', 'Rules'], order: 3},
      },
    ],
    fullSnapshot: true,
  };
}

function readyTwoBooks() {
  const service = new LoreIntelligenceService();
  service.acceptLorebook(harborBook());
  service.acceptLorebook(archiveBook());
  const run = service.runStudy();
  assert.equal(run.results.every((row) => row.obligation?.state === 'COMPLETED'), true);
  const status = service.status();
  assert.equal(status.entries.length, 7);
  assert.equal(status.entries.every((row) => row.operatorState === 'READY'), true);
  return service;
}

test('Wave 6 semantic edit preview is source-grounded and leaves unrelated Lore ready', () => {
  const service = readyTwoBooks();
  const authoring = new LoreAuthoringService({intelligence: service});
  const sourceId = 'lore:harbor-authored:tideglass';
  const original = service.runtime.registry.currentRevision(sourceId);
  const unrelatedBefore = service.status().entries
    .filter((row) => row.lorebookId === 'mirror-archive')
    .map((row) => [row.sourceId, row.sourceRevisionId, row.operatorState]);

  const preview = authoring.editImpactPreview({
    sourceId,
    content: 'The Tideglass is damaged.',
  });

  assert.equal(preview.kind, 'LoreEditImpactPreview');
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.originalServiceMutated, false);
  assert.equal(preview.semanticChange.claims.altered.length > 0, true);
  assert.equal(preview.semanticChange.claims.superseded.length > 0, true);
  const transition = preview.semanticChange.claims.superseded[0];
  assert.equal(transition.from.drillback.exactExcerpt, 'The Tideglass is intact.');
  assert.equal(transition.to.drillback.exactExcerpt, 'The Tideglass is damaged.');
  assert.equal(transition.from.drillback.exactSourceText, 'The Tideglass is intact.');
  assert.equal(transition.to.drillback.exactSourceText, 'The Tideglass is damaged.');

  const targets = new Set(preview.semanticChange.invalidationPlan.targets.map((row) => row.target));
  assert.equal(targets.has('STUDY_ARTIFACTS'), true);
  assert.equal(targets.has('REPRESENTATIONS'), true);
  assert.equal(targets.has('RETRIEVAL_INDEX'), true);
  assert.equal(preview.semanticChange.invalidationPlan.unrelatedSourcesInvalidated, false);
  assert.equal(preview.allPreviouslyReadyUnrelatedSourcesRemainReady, true);

  const originalAfter = service.runtime.registry.currentRevision(sourceId);
  assert.equal(originalAfter.id, original.id);
  assert.equal(originalAfter.exactContent, 'The Tideglass is intact.');
  const unrelatedAfter = service.status().entries
    .filter((row) => row.lorebookId === 'mirror-archive')
    .map((row) => [row.sourceId, row.sourceRevisionId, row.operatorState]);
  assert.deepEqual(unrelatedAfter, unrelatedBefore);
});

test('Wave 6 applied edit yields revision-fenced semantic report with supersession and contradiction preserved', () => {
  const service = readyTwoBooks();
  const authoring = new LoreAuthoringService({intelligence: service});
  const sourceId = 'lore:harbor-authored:tideglass';
  const before = service.runtime.registry.currentRevision(sourceId);

  service.acceptLorebook(harborBook({tideglass: 'damaged'}));
  service.runStudy();
  const after = service.runtime.registry.currentRevision(sourceId);
  assert.notEqual(after.id, before.id);
  assert.equal(service.runtime.registry.getRevision(before.id).exactContent, 'The Tideglass is intact.');
  assert.equal(after.exactContent, 'The Tideglass is damaged.');

  const report = authoring.semanticChangeReport({
    sourceId,
    fromRevisionId: before.id,
    toRevisionId: after.id,
  });
  assert.equal(report.claims.superseded.some((row) => row.from.payload.value === 'intact' && row.to.payload.value === 'damaged'), true);
  assert.equal(report.relationships.added.length, 0);
  assert.equal(report.source.sourceRevisionId, after.id);
  assert.equal(report.previousSource.sourceRevisionId, before.id);

  const merge = authoring.mergePreview({lorebookIds: ['harbor-authored', 'mirror-archive']});
  assert.equal(merge.validation.ok, true);
  assert.equal(merge.classifications.unresolvedContradictions.length > 0, true);
  assert.equal(merge.classifications.unresolvedContradictions.some((row) => (
    row.details.contradictions.some((c) => (
      [c.leftValue, c.rightValue].includes('damaged') && [c.leftValue, c.rightValue].includes('destroyed')
    ))
  )), true);
  assert.equal(merge.destructiveApplyImplemented, false);
});

test('Wave 6 LoreStructurePlan separates human Tree proposals from semantic memberships', () => {
  const service = readyTwoBooks();
  const authoring = new LoreAuthoringService({intelligence: service});
  const beforePaths = service.runtime.registry.listEntries({includeRemoved: false}).map((source) => {
    const revision = service.runtime.registry.currentRevision(source.sourceId);
    return [source.sourceId, revision.metadata.treePath];
  });

  const plan = authoring.treeProposal({lorebookIds: ['harbor-authored', 'mirror-archive']});
  assert.equal(plan.kind, 'LoreStructurePlan');
  assert.equal(plan.primaryTreePlacementIsHumanChoice, true);
  assert.equal(plan.semanticMembershipIsManyToMany, true);
  assert.equal(plan.treePlacementGrantsTruthAuthority, false);
  assert.equal(plan.mutationAuthority, false);
  assert.equal(plan.semanticMemberships.length > 0, true);
  assert.equal(plan.proposals.some((row) => row.action === 'CREATE_NODE'), true);
  assert.equal(plan.proposals.some((row) => row.action === 'RENAME_NODE'), true);
  assert.equal(plan.proposals.some((row) => row.action === 'MERGE_NODE'), true);
  assert.deepEqual(plan.supportedActions.sort(), ['CREATE_NODE', 'MERGE_NODE', 'MOVE_ENTRY', 'RENAME_NODE', 'SPLIT_NODE'].sort());

  const afterPaths = service.runtime.registry.listEntries({includeRemoved: false}).map((source) => {
    const revision = service.runtime.registry.currentRevision(source.sourceId);
    return [source.sourceId, revision.metadata.treePath];
  });
  assert.deepEqual(afterPaths, beforePaths);
});

test('Wave 6 two-book merge preview retains unique facts, collisions, exact duplicates, and reconstructability', () => {
  const service = readyTwoBooks();
  const authoring = new LoreAuthoringService({intelligence: service});
  const preview = authoring.mergePreview({lorebookIds: ['harbor-authored', 'mirror-archive']});

  assert.equal(preview.kind, 'LoreMergePreview');
  assert.equal(preview.validation.ok, true);
  assert.equal(preview.classifications.exactDuplicates.length > 0, true);
  assert.equal(preview.classifications.likelyOverlap.length > 0, true);
  assert.equal(preview.classifications.complementary.length > 0, true);
  assert.equal(preview.classifications.titleKeyCollisions.length > 0, true);
  assert.equal(preview.classifications.unresolvedContradictions.length > 0, true);
  assert.equal(preview.sourceToOutput.length, 7);
  assert.equal(preview.reconstructionManifest.books.length, 2);
  assert.equal(preview.reconstructionManifest.reconstructsExactAuthoredInputs, true);
  assert.equal(preview.validation.retainedEverySemanticFact, true);
  assert.equal(preview.similarityScoresAreAdvisory, true);
  assert.equal(preview.explicitOperatorApprovalRequiredForMutation, true);
  assert.equal(preview.destructiveApplyImplemented, false);

  const duplicateOutput = preview.proposedOutput.find((row) => row.strategy === 'CONSOLIDATE_EXACT_DUPLICATE_PREVIEW_ONLY');
  assert.ok(duplicateOutput);
  assert.equal(duplicateOutput.sourceRefs.length >= 2, true);
  assert.equal(duplicateOutput.synthesizedText, false);
});

test('Wave 6 operator contract publishes discovery identity, safe errors, and Worker 1 invalidation contract without claiming wiring', () => {
  const service = readyTwoBooks();
  const authoring = new LoreAuthoringService({intelligence: service});
  const host = authoring.operatorContract();

  assert.equal(host.kind, 'LoreAuthoringOperatorContract');
  assert.equal(host.integrationStatus, 'BACKEND_CONTRACT_ONLY_NOT_WORKER3_WIRED');
  assert.equal(host.destructiveMergeApply, null);
  assert.equal(host.destructiveTreeApply, null);

  const discovery = host.read.sourceDiscoveryIdentity({});
  assert.equal(discovery.ok, true);
  assert.equal(discovery.value.books.length, 2);
  assert.equal(discovery.value.books.every((book) => book.discoveryIdentityPersisted), true);
  assert.equal(discovery.value.books.some((book) => book.discovery?.stableId === 'st-book-harbor'), true);

  const worker1 = host.read.worker1InvalidationContract();
  assert.equal(worker1.ok, true);
  assert.equal(worker1.value.integrationStatus, 'PUBLISHED_NOT_CLAIMED_WIRED');
  assert.equal(worker1.value.invalidationPlan.unrelatedSourceArtifactsRemainReusable, true);

  const safeFailure = host.actions.previewMerge({lorebookIds: ['harbor-authored']});
  assert.equal(safeFailure.ok, false);
  assert.equal(safeFailure.error.kind, 'LoreAuthoringError');
  assert.equal(safeFailure.error.safe, true);
});

test('Wave 6 removal and checkpoint recovery preserve authored revision history', () => {
  const base = readyTwoBooks();
  const sourceId = 'lore:harbor-authored:oren';
  const oldRevision = base.runtime.registry.currentRevision(sourceId);

  const removal = LoreIntelligenceService.fromSnapshot(base.snapshot());
  removal.acceptLorebook(harborBook({includeOren: false}));
  removal.runStudy();
  const removed = removal.runtime.registry.currentRevision(sourceId);
  assert.equal(removed.state, 'REMOVED');
  assert.equal(removal.runtime.registry.getRevision(oldRevision.id).exactContent, 'Oren knows Mira.');
  const removalReport = new LoreAuthoringService({intelligence: removal}).semanticChangeReport({
    sourceId,
    fromRevisionId: oldRevision.id,
    toRevisionId: removed.id,
  });
  assert.equal(removalReport.semantic.removed.length > 0, true);

  const checkpoint = LoreIntelligenceService.fromSnapshot(base.snapshot());
  checkpoint.acceptLorebook(harborBook({tideglass: 'damaged'}));
  const partial = checkpoint.runStudy({maxUnitsPerObligation: 2, rebuildRetrieval: false});
  assert.equal(partial.results.some((row) => row.obligation?.state === 'CHECKPOINTED' || row.obligation?.state === 'PENDING'), true);
  const restored = LoreIntelligenceService.fromSnapshot(checkpoint.snapshot());
  restored.runStudy();
  const resumed = restored.runtime.registry.currentRevision('lore:harbor-authored:tideglass');
  assert.equal(resumed.exactContent, 'The Tideglass is damaged.');
  assert.equal(restored.status().entries.find((row) => row.sourceId === 'lore:harbor-authored:tideglass').operatorState, 'READY');
});

function corpusBook(id, prefix, count, sharedEvery = 20) {
  return {
    id,
    title: id,
    discovery: {kind: 'Wave6Benchmark', stableId: 'bench-' + id},
    entries: Array.from({length: count}, (_, index) => {
      const name = index % sharedEvery === 0 ? 'Shared Person ' + index : prefix + ' Person ' + index;
      return {
        uid: 'entry-' + index,
        content: name + ' knows ' + prefix + ' Friend ' + index + '.',
        metadata: {title: name, treePath: [prefix, 'People'], order: index},
      };
    }),
    fullSnapshot: true,
  };
}

test('Wave 6 larger-corpus authoring cost remains bounded and reports measured work', () => {
  const service = new LoreIntelligenceService();
  const totalEntriesPerBook = 100;
  const t0 = performance.now();
  service.acceptLorebook(corpusBook('benchmark-a', 'Alpha', totalEntriesPerBook));
  service.acceptLorebook(corpusBook('benchmark-b', 'Beta', totalEntriesPerBook));
  service.runStudy();
  const studiedMs = performance.now() - t0;

  const authoring = new LoreAuthoringService({intelligence: service});
  const p0 = performance.now();
  const plan = authoring.treeProposal({lorebookIds: ['benchmark-a', 'benchmark-b']});
  const planMs = performance.now() - p0;
  const m0 = performance.now();
  const merge = authoring.mergePreview({lorebookIds: ['benchmark-a', 'benchmark-b']});
  const mergeMs = performance.now() - m0;

  assert.equal(service.status().entries.length, 200);
  assert.equal(plan.sourceRevisionFence.length, 200);
  assert.equal(merge.pairDiagnostics.length, 10000);
  assert.equal(merge.validation.ok, true);
  assert.equal(studiedMs < 30000, true);
  assert.equal(planMs < 10000, true);
  assert.equal(mergeMs < 15000, true);

  console.log('WAVE6_BENCHMARK ' + JSON.stringify({
    entries: 200,
    crossBookPairs: merge.pairDiagnostics.length,
    studyAndRepresentMs: Number(studiedMs.toFixed(2)),
    structurePlanMs: Number(planMs.toFixed(2)),
    mergePreviewMs: Number(mergeMs.toFixed(2)),
    structureProposals: plan.proposals.length,
    mergeClassifications: Object.fromEntries(Object.entries(merge.classifications).map(([key, value]) => [key, value.length])),
  }));
});
