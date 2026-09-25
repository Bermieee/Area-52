import test from 'node:test';
import assert from 'node:assert/strict';

import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';
import {LoreAuthoringService} from '../src/lore-authoring-service.js';

function harborBook({tideglass = 'intact'} = {}) {
  return {
    id: 'harbor-authored',
    title: 'Harbor Authored',
    discovery: {kind: 'SillyTavernLorebook', stableId: 'wave7-harbor'},
    entries: [
      {
        uid: 'mira',
        content: 'Mira owns the Lantern Hall. Mira knows Oren.',
        metadata: {title: 'Mira', treePath: ['Harbor', 'People'], order: 1},
      },
      {
        uid: 'oren',
        content: 'Oren knows Mira.',
        metadata: {title: 'Oren', treePath: ['Harbor', ' people '], order: 2},
      },
      {
        uid: 'tideglass',
        content: 'The Tideglass is ' + tideglass + '.',
        metadata: {title: 'Tideglass', treePath: ['Harbor', 'Relics'], order: 3},
      },
      {
        uid: 'vault-law',
        content: 'Only Lantern Wardens may enter the Tide Vault.',
        metadata: {title: 'Vault Law', treePath: ['Harbor', 'Rules'], order: 4},
      },
    ],
    fullSnapshot: true,
  };
}

function archiveBook() {
  return {
    id: 'mirror-archive',
    title: 'Mirror Archive',
    discovery: {kind: 'SillyTavernLorebook', stableId: 'wave7-archive'},
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

function unrelatedBook() {
  return {
    id: 'sky-ledger',
    title: 'Sky Ledger',
    discovery: {kind: 'SillyTavernLorebook', stableId: 'wave7-sky'},
    entries: [
      {
        uid: 'aerie',
        content: 'Aerie knows Kestrel.',
        metadata: {title: 'Aerie', treePath: ['Sky', 'People'], order: 1},
      },
    ],
    fullSnapshot: true,
  };
}

function readyWorld() {
  const intelligence = new LoreIntelligenceService();
  intelligence.acceptLorebook(harborBook());
  intelligence.acceptLorebook(archiveBook());
  intelligence.acceptLorebook(unrelatedBook());
  intelligence.runStudy();
  assert.equal(intelligence.status().entries.every((row) => row.operatorState === 'READY'), true);
  return intelligence;
}

function finishBuild(authoring, sessionId, batch = 128) {
  let progress = authoring.authoringProgress(sessionId);
  while (progress.stage === 'BUILDING' || progress.stage === 'CHECKPOINTED') {
    authoring.resumeAuthoringBuild({sessionId, maxActions: batch});
    progress = authoring.authoringProgress(sessionId);
  }
  return progress;
}

function decideAll(authoring, sessionId, decision, prefix) {
  const draft = authoring.draftReview({sessionId});
  for (const [index, action] of draft.actions.entries()) {
    if (action.decision) continue;
    authoring.recordDraftDecision({
      sessionId,
      actionId: action.id,
      decision,
      operatorDecisionId: prefix + '-' + index,
    });
  }
  return authoring.draftReview({sessionId});
}

test('Wave 7 Tree proposal build checkpoints and resumes after reload without duplicate actions', () => {
  const intelligence = readyWorld();
  let authoring = new LoreAuthoringService({intelligence});
  const started = authoring.startTreeBuild({lorebookIds: ['harbor-authored']});
  assert.equal(started.stage, 'BUILDING');
  assert.equal(started.totalActions > 1, true);

  const first = authoring.resumeAuthoringBuild({sessionId: started.sessionId, maxActions: 1});
  assert.equal(first.progress.stage, 'CHECKPOINTED');
  assert.equal(first.checkpoint.cursor, 1);

  const intelligenceRestored = LoreIntelligenceService.fromSnapshot(intelligence.snapshot());
  authoring = LoreAuthoringService.fromSnapshot(authoring.snapshot(), {intelligence: intelligenceRestored});
  const finished = finishBuild(authoring, started.sessionId, 2);
  assert.equal(finished.stage, 'DRAFT_REVIEW');
  const draft = authoring.draftReview({sessionId: started.sessionId});
  assert.equal(draft.actions.length, new Set(draft.actions.map((row) => row.id)).size);
  assert.equal(draft.actions.every((row) => row.inputSourceRevisions.every((ref) => ref.sourceRevisionId)), true);
  assert.equal(draft.actions.every((row) => Array.isArray(row.affectedTreeNodes)), true);
  assert.equal(draft.actions.every((row) => row.semanticDependencies && typeof row.semanticDependencies === 'object'), true);
});

test('Wave 7 targeted taxonomy reclassification reaches Final Preview and settles once per affected source', () => {
  let intelligence = readyWorld();
  let authoring = new LoreAuthoringService({intelligence});
  const started = authoring.startTreeBuild({lorebookIds: ['harbor-authored']});
  finishBuild(authoring, started.sessionId);
  decideAll(authoring, started.sessionId, 'REJECT', 'tree-reject');

  const targeted = ['lore:harbor-authored:mira', 'lore:harbor-authored:oren'];
  const before = new Map(targeted.map((sourceId) => [
    sourceId,
    intelligence.runtime.registry.currentRevision(sourceId),
  ]));
  const unrelatedBefore = intelligence.status().entries
    .filter((row) => row.lorebookId === 'sky-ledger')
    .map((row) => [row.sourceId, row.sourceRevisionId, row.operatorState]);

  const reclass = authoring.reclassifyAfterTaxonomyEdit({
    sessionId: started.sessionId,
    sourceIds: targeted,
    fromPath: ['Harbor'],
    toPath: ['Harbor', 'Characters'],
    operatorDecisionId: 'taxonomy-edit-001',
    note: 'Use Characters for the reviewed human navigation taxonomy.',
  });
  assert.deepEqual(reclass.sourceIds, targeted.sort());
  assert.equal(reclass.targetedReclassification, true);
  assert.equal(reclass.unaffectedSourceCount > 0, true);

  const finalPreview = authoring.computeFinalPreview({sessionId: started.sessionId});
  assert.equal(finalPreview.kind, 'LoreFinalPreview');
  assert.equal(finalPreview.validation.ok, true);
  assert.equal(finalPreview.output.sourceChanges.length, 2);
  assert.equal(finalPreview.operations.every((row) => row.semanticPreflight.semanticChange.invalidationPlan.authoritativePreflight), true);
  assert.equal(finalPreview.operations.every((row) => (
    row.semanticPreflight.semanticChange.invalidationPlan.targets.some((target) => target.target === 'RETRIEVAL_INDEX')
  )), true);

  const approval = authoring.approveFinalPreview({
    sessionId: started.sessionId,
    operatorApprovalId: 'tree-final-approve-001',
  });
  assert.equal(approval.stage, 'READY_TO_SETTLE');

  const partial = authoring.applySettlement({sessionId: started.sessionId, maxOperations: 1});
  assert.equal(partial.state, 'CHECKPOINTED');
  assert.equal(partial.cursor, 1);
  assert.equal(partial.revisionEvents.length, 1);

  intelligence = LoreIntelligenceService.fromSnapshot(intelligence.snapshot());
  authoring = LoreAuthoringService.fromSnapshot(authoring.snapshot(), {intelligence});
  const settled = authoring.applySettlement({sessionId: started.sessionId, maxOperations: 10});
  assert.equal(settled.state, 'SETTLED');
  assert.equal(settled.receipts.length, 2);
  assert.equal(new Set(settled.receipts.map((row) => row.sourceId)).size, 2);

  for (const sourceId of targeted) {
    const current = intelligence.runtime.registry.currentRevision(sourceId);
    assert.equal(current.revision, before.get(sourceId).revision + 1);
    assert.deepEqual(current.metadata.treePath, ['Harbor', 'Characters']);
    assert.equal(intelligence.runtime.registry.getRevision(before.get(sourceId).id).exactContent, before.get(sourceId).exactContent);
  }

  const due = intelligence.runtime.dueObligations();
  assert.equal(due.length, 2);
  assert.deepEqual(new Set(due.map((row) => row.sourceId)), new Set(targeted));
  const unrelatedAfter = intelligence.status().entries
    .filter((row) => row.lorebookId === 'sky-ledger')
    .map((row) => [row.sourceId, row.sourceRevisionId, row.operatorState]);
  assert.deepEqual(unrelatedAfter, unrelatedBefore);

  const worker1 = authoring.worker1SettlementReceipts({settlementId: settled.settlementId});
  assert.equal(worker1.revisionEvents.length, 2);
  assert.equal(worker1.invalidationReceipts.length, 2);
  assert.equal(worker1.studyObligationIds.length, 2);
  assert.equal(worker1.invalidationReceipts.every((row) => row.unrelatedSourcesInvalidated === false), true);

  intelligence.runStudy();
  assert.equal(targeted.every((sourceId) => (
    intelligence.status().entries.find((row) => row.sourceId === sourceId)?.operatorState === 'READY'
  )), true);

  let restoring = authoring.restoreSettlement({
    settlementId: settled.settlementId,
    restorationId: 'tree-restore-001',
    maxOperations: 1,
  });
  assert.equal(restoring.restoration.state, 'CHECKPOINTED');

  intelligence = LoreIntelligenceService.fromSnapshot(intelligence.snapshot());
  authoring = LoreAuthoringService.fromSnapshot(authoring.snapshot(), {intelligence});
  restoring = authoring.restoreSettlement({
    settlementId: settled.settlementId,
    maxOperations: 10,
  });
  assert.equal(restoring.state, 'RESTORED');
  intelligence.runStudy();

  for (const sourceId of targeted) {
    const current = intelligence.runtime.registry.currentRevision(sourceId);
    assert.deepEqual(current.metadata.treePath, before.get(sourceId).metadata.treePath);
    assert.equal(current.exactContent, before.get(sourceId).exactContent);
    assert.equal(intelligence.runtime.registry.revisionHistory(sourceId).length >= before.get(sourceId).revision + 2, true);
  }
});

test('Wave 7 rejects stale Tree Final Preview after a source edit and returns to Draft Review', () => {
  const intelligence = readyWorld();
  const authoring = new LoreAuthoringService({intelligence});
  const started = authoring.startTreeBuild({lorebookIds: ['harbor-authored']});
  finishBuild(authoring, started.sessionId);
  decideAll(authoring, started.sessionId, 'REJECT', 'stale-reject');
  authoring.reclassifyAfterTaxonomyEdit({
    sessionId: started.sessionId,
    sourceIds: ['lore:harbor-authored:mira'],
    toPath: ['Harbor', 'Characters'],
    operatorDecisionId: 'stale-taxonomy',
  });
  const finalPreview = authoring.computeFinalPreview({sessionId: started.sessionId});
  assert.equal(finalPreview.validation.ok, true);

  intelligence.acceptLorebook({
    ...harborBook(),
    entries: harborBook().entries.map((entry) => (
      entry.uid === 'mira'
        ? {...entry, content: 'Mira owns the Lantern Hall. Mira knows Oren. Mira carries the Tideglass.'}
        : entry
    )),
  });
  intelligence.runStudy();

  const approval = authoring.approveFinalPreview({
    sessionId: started.sessionId,
    operatorApprovalId: 'stale-approval',
  });
  assert.equal(approval.readyForApproval, false);
  assert.equal(approval.stale.reason, 'SOURCE_REVISION_FENCE_CHANGED');
  assert.equal(authoring.authoringProgress(started.sessionId).stage, 'DRAFT_REVIEW');
  assert.equal(authoring.authoringProgress(started.sessionId).settlement, null);
});

test('Wave 7 approved merge applies to a new reconstructable book, resumes, and restores without touching originals', () => {
  let intelligence = readyWorld();
  let authoring = new LoreAuthoringService({intelligence});
  const inputFence = new Map([
    ...intelligence.runtime.registry.listEntries({includeRemoved: false})
      .filter((source) => ['harbor-authored', 'mirror-archive'].includes(source.lorebookId))
      .map((source) => [source.sourceId, intelligence.runtime.registry.currentRevision(source.sourceId).id]),
  ]);
  const unrelatedBefore = intelligence.status().entries
    .find((row) => row.sourceId === 'lore:sky-ledger:aerie');

  const started = authoring.startMergeBuild({
    lorebookIds: ['harbor-authored', 'mirror-archive'],
    outputLorebookId: 'reviewed-merge',
    outputTitle: 'Reviewed Merge',
  });
  finishBuild(authoring, started.sessionId);
  const draft = decideAll(authoring, started.sessionId, 'ACCEPT', 'merge-accept');
  assert.equal(draft.actions.every((row) => row.decision === 'ACCEPT'), true);

  const finalPreview = authoring.computeFinalPreview({sessionId: started.sessionId});
  assert.equal(finalPreview.validation.ok, true);
  assert.equal(finalPreview.validation.baseMergePreviewValid, true);
  assert.equal(finalPreview.validation.missingSourceIds.length, 0);
  assert.equal(finalPreview.validation.missingSemanticFactRefs.length, 0);
  assert.equal(finalPreview.validation.unsafeContradictionPairs.length, 0);
  assert.equal(finalPreview.output.contradictionsRemainSeparate, true);
  assert.equal(finalPreview.output.reconstructionManifest.reconstructsExactAuthoredInputs, true);
  assert.equal(finalPreview.output.entries.length < inputFence.size, true);
  assert.equal(new Set(finalPreview.output.entries.map((row) => row.uid)).size, finalPreview.output.entries.length);

  authoring.approveFinalPreview({
    sessionId: started.sessionId,
    operatorApprovalId: 'merge-final-approve-001',
  });
  let applied = authoring.applySettlement({sessionId: started.sessionId, maxOperations: 1});
  assert.equal(applied.state, 'CHECKPOINTED');
  assert.equal(applied.cursor, 1);

  intelligence = LoreIntelligenceService.fromSnapshot(intelligence.snapshot());
  authoring = LoreAuthoringService.fromSnapshot(authoring.snapshot(), {intelligence});
  applied = authoring.applySettlement({sessionId: started.sessionId, maxOperations: 128});
  assert.equal(applied.state, 'SETTLED');
  assert.equal(applied.receipts.length, finalPreview.output.entries.length);
  assert.equal(applied.reconstructionManifest.reconstructsExactAuthoredInputs, true);

  for (const [sourceId, revisionId] of inputFence.entries()) {
    assert.equal(intelligence.runtime.registry.currentRevision(sourceId).id, revisionId);
  }
  const outputSources = intelligence.runtime.registry.listEntries({includeRemoved: false})
    .filter((source) => source.lorebookId === 'reviewed-merge');
  assert.equal(outputSources.length, finalPreview.output.entries.length);
  assert.equal(intelligence.runtime.dueObligations().length, outputSources.length);
  assert.equal(intelligence.runtime.dueObligations().every((row) => row.trigger === 'NEW_UID'), true);

  const unrelatedAfter = intelligence.status().entries
    .find((row) => row.sourceId === 'lore:sky-ledger:aerie');
  assert.equal(unrelatedAfter.sourceRevisionId, unrelatedBefore.sourceRevisionId);
  assert.equal(unrelatedAfter.operatorState, 'READY');

  const worker1 = authoring.worker1SettlementReceipts({settlementId: applied.settlementId});
  assert.equal(worker1.revisionEvents.length, outputSources.length);
  assert.equal(worker1.invalidationReceipts.length, outputSources.length);
  assert.equal(worker1.revisionEvents.every((row) => row.previousSourceRevisionId === null), true);

  intelligence.runStudy();
  assert.equal(outputSources.every((source) => (
    intelligence.status().entries.find((row) => row.sourceId === source.sourceId)?.operatorState === 'READY'
  )), true);

  let restored = authoring.restoreSettlement({
    settlementId: applied.settlementId,
    restorationId: 'merge-restore-001',
    maxOperations: 2,
  });
  assert.equal(['CHECKPOINTED', 'RESTORED'].includes(restored.restoration.state), true);
  while (restored.state !== 'RESTORED') {
    restored = authoring.restoreSettlement({settlementId: applied.settlementId, maxOperations: 2});
  }
  for (const source of outputSources) {
    assert.equal(intelligence.runtime.registry.currentRevision(source.sourceId).state, 'REMOVED');
    assert.equal(intelligence.runtime.registry.revisionHistory(source.sourceId)[0].exactContent.length > 0, true);
  }
  for (const [sourceId, revisionId] of inputFence.entries()) {
    assert.equal(intelligence.runtime.registry.currentRevision(sourceId).id, revisionId);
  }
});

test('Wave 7 merge Final Preview blocks loss of a rejected unique output', () => {
  const intelligence = readyWorld();
  const authoring = new LoreAuthoringService({intelligence});
  const started = authoring.startMergeBuild({
    lorebookIds: ['harbor-authored', 'mirror-archive'],
    outputLorebookId: 'invalid-merge',
  });
  finishBuild(authoring, started.sessionId);
  const draft = authoring.draftReview({sessionId: started.sessionId});
  draft.actions.forEach((action, index) => {
    authoring.recordDraftDecision({
      sessionId: started.sessionId,
      actionId: action.id,
      decision: index === 0 ? 'REJECT' : 'ACCEPT',
      operatorDecisionId: 'loss-check-' + index,
    });
  });
  const finalPreview = authoring.computeFinalPreview({sessionId: started.sessionId});
  assert.equal(finalPreview.validation.ok, false);
  assert.equal(
    finalPreview.validation.missingSourceIds.length > 0 || finalPreview.validation.missingSemanticFactRefs.length > 0,
    true,
  );
  assert.throws(
    () => authoring.approveFinalPreview({sessionId: started.sessionId, operatorApprovalId: 'should-not-approve'}),
    /deterministic validation/i,
  );
});

test('Wave 7 merge approval rejects source changes after Final Preview', () => {
  const intelligence = readyWorld();
  const authoring = new LoreAuthoringService({intelligence});
  const started = authoring.startMergeBuild({
    lorebookIds: ['harbor-authored', 'mirror-archive'],
    outputLorebookId: 'stale-merge',
  });
  finishBuild(authoring, started.sessionId);
  decideAll(authoring, started.sessionId, 'ACCEPT', 'stale-merge-accept');
  assert.equal(authoring.computeFinalPreview({sessionId: started.sessionId}).validation.ok, true);

  intelligence.acceptLorebook(harborBook({tideglass: 'damaged'}));
  intelligence.runStudy();

  const approval = authoring.approveFinalPreview({
    sessionId: started.sessionId,
    operatorApprovalId: 'stale-merge-approval',
  });
  assert.equal(approval.readyForApproval, false);
  assert.equal(approval.stale.reason, 'SOURCE_REVISION_FENCE_CHANGED');
  assert.equal(authoring.authoringProgress(started.sessionId).stage, 'DRAFT_REVIEW');
});

test('Wave 7 late merge output collision returns the approved plan to Draft Review before Settlement', () => {
  const intelligence = readyWorld();
  const authoring = new LoreAuthoringService({intelligence});
  const started = authoring.startMergeBuild({
    lorebookIds: ['harbor-authored', 'mirror-archive'],
    outputLorebookId: 'late-output-collision',
  });
  finishBuild(authoring, started.sessionId);
  decideAll(authoring, started.sessionId, 'ACCEPT', 'late-output-accept');
  const finalPreview = authoring.computeFinalPreview({sessionId: started.sessionId});
  assert.equal(finalPreview.validation.ok, true);
  const approval = authoring.approveFinalPreview({
    sessionId: started.sessionId,
    operatorApprovalId: 'late-output-final-approval',
  });
  assert.equal(approval.stage, 'READY_TO_SETTLE');

  intelligence.runtime.registry.registerLorebook({
    id: 'late-output-collision',
    title: 'External Output Owner',
    metadata: {discovery: {kind: 'ExternalOwner'}},
  });

  const result = authoring.applySettlement({sessionId: started.sessionId});
  assert.equal(result.readyForApproval, false);
  assert.equal(result.stale.reason, 'OUTPUT_LOREBOOK_CONFLICT');
  assert.equal(authoring.authoringProgress(started.sessionId).stage, 'DRAFT_REVIEW');
  assert.equal(authoring.authoringProgress(started.sessionId).settlement, null);
});

test('Wave 7 resumed partial Settlement fails closed when an already-applied output revision changes externally', () => {
  const intelligence = readyWorld();
  const authoring = new LoreAuthoringService({intelligence});
  const started = authoring.startMergeBuild({
    lorebookIds: ['harbor-authored', 'mirror-archive'],
    outputLorebookId: 'resume-conflict-merge',
  });
  finishBuild(authoring, started.sessionId);
  decideAll(authoring, started.sessionId, 'ACCEPT', 'resume-conflict-accept');
  assert.equal(authoring.computeFinalPreview({sessionId: started.sessionId}).validation.ok, true);
  authoring.approveFinalPreview({
    sessionId: started.sessionId,
    operatorApprovalId: 'resume-conflict-final-approval',
  });

  const partial = authoring.applySettlement({sessionId: started.sessionId, maxOperations: 1});
  assert.equal(partial.state, 'CHECKPOINTED');
  assert.equal(partial.receipts.length, 1);
  const appliedReceipt = partial.receipts[0];
  const appliedSource = intelligence.runtime.registry.getEntry(appliedReceipt.sourceId);
  const appliedRevision = intelligence.runtime.registry.currentRevision(appliedReceipt.sourceId);
  intelligence.runtime.upsertEntry({
    lorebookId: appliedSource.lorebookId,
    uid: appliedSource.uid,
    content: appliedRevision.exactContent + ' External operator edit.',
    metadata: appliedRevision.metadata,
  });

  const resumed = authoring.applySettlement({sessionId: started.sessionId, maxOperations: 128});
  assert.equal(resumed.state, 'FAILED');
  assert.equal(resumed.lastError.code, 'LORE_SETTLEMENT_APPLIED_REVISION_STALE');
  assert.equal(resumed.cursor, 1);
  assert.equal(resumed.receipts.length, 1);
  assert.equal(authoring.authoringProgress(started.sessionId).stage, 'FAILED');
});

test('Wave 7 Worker 1 and Worker 3 contracts expose lifecycle, settlement, restoration, and backlog without claiming UI wiring', () => {
  const intelligence = readyWorld();
  const authoring = new LoreAuthoringService({intelligence});
  const host = authoring.operatorContract();
  assert.equal(host.contractVersion, 2);
  assert.equal(host.integrationStatus, 'BACKEND_CONTRACT_ONLY_NOT_WORKER3_WIRED');

  const w3 = host.read.worker3AuthoringContract();
  assert.equal(w3.ok, true);
  assert.equal(w3.value.stalePreviewReturnsToDraftReview, true);
  assert.equal(w3.value.checkpointResumeSupported, true);
  assert.equal(w3.value.restorationSupported, true);
  assert.equal(w3.value.integrationStatus, 'BACKEND_CONTRACT_ONLY_NOT_WORKER3_WIRED');

  const w1 = host.read.worker1InvalidationContract();
  assert.equal(w1.ok, true);
  assert.equal(w1.value.backlog.authoringCreatesNoSecondStudyQueue, true);
  assert.equal(w1.value.backlog.resumableAfterSnapshotRestore, true);
  assert.equal(w1.value.invalidationReceipt.treeSettlementCollapsesToOneRevisionPerAffectedSource, true);
  assert.equal(w1.value.integrationStatus, 'PUBLISHED_NOT_CLAIMED_WIRED');

  const safe = host.actions.applySettlement({sessionId: 'missing'});
  assert.equal(safe.ok, false);
  assert.equal(safe.error.kind, 'LoreAuthoringError');
  assert.equal(safe.error.safe, true);
});
