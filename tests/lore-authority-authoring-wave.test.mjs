import test from 'node:test';
import assert from 'node:assert/strict';

import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';
import {LoreAuthoringService} from '../src/lore-authoring-service.js';

function harborBook({
  alphaExtra = '',
  alphaPath = ['Harbor', 'People'],
  includeBeta = true,
} = {}) {
  const entries = [
    {
      uid: 'alpha',
      content: 'Ari guards the Shared Beacon at Lantern Harbor.' + (alphaExtra ? ' ' + alphaExtra : ''),
      metadata: {title: 'Ari and the Shared Beacon', treePath: alphaPath, order: 1},
    },
    {
      uid: 'keeper',
      content: 'Nia is a keeper at Lantern Harbor and knows Ari.',
      metadata: {title: 'Nia the Keeper', treePath: ['Harbor', 'People'], order: 2},
    },
    {
      uid: 'orphan',
      content: 'The Map Guild records quiet harbor routes and lantern stations.',
      metadata: {title: 'Map Guild', treePath: [], order: 3},
    },
    {
      uid: 'vault-rule',
      content: 'Only keepers may enter the Moon Vault.',
      metadata: {title: 'Moon Vault Rule', treePath: ['Harbor', 'Rules'], order: 4},
    },
  ];
  if (includeBeta) {
    entries.splice(2, 0, {
      uid: 'beta',
      content: 'The Shared Beacon is intact and rings at midnight.',
      metadata: {title: 'Shared Beacon State', treePath: ['Harbor', 'Relics'], order: 3},
    });
  }
  return {
    id: 'harbor-world',
    title: 'Harbor World',
    discovery: {kind: 'SillyTavernLorebookDiscoveryReceipt', stableId: 'story-harbor', lorebookId: 'harbor-world'},
    entries,
    fullSnapshot: true,
  };
}

function skyBook() {
  return {
    id: 'sky-world',
    title: 'Sky World',
    discovery: {kind: 'SillyTavernLorebookDiscoveryReceipt', stableId: 'story-sky', lorebookId: 'sky-world'},
    entries: [
      {
        uid: 'alpha',
        content: 'Bex studies a Shared Beacon above Skyhold and charts storm routes.',
        metadata: {title: 'Bex and the Shared Beacon', treePath: ['Sky', 'People'], order: 1},
      },
      {
        uid: 'vault-rule',
        content: 'Only keepers may enter the Moon Vault.',
        metadata: {title: 'Moon Vault Rule Copy', treePath: ['Sky', 'Archive'], order: 2},
      },
      {
        uid: 'beacon-conflict',
        content: 'The Shared Beacon was destroyed in the storm. A witness reports the Shared Beacon may still be intact.',
        metadata: {title: 'Conflicting Beacon Report', treePath: ['Sky', 'History'], order: 3},
      },
      {
        uid: 'beacon-complement',
        content: 'The Shared Beacon lens was forged by the Cloudsmiths.',
        metadata: {title: 'Beacon Lens Provenance', treePath: ['Sky', 'Relics'], order: 4},
      },
    ],
    fullSnapshot: true,
  };
}

function accept(intelligence, chatId, book) {
  return intelligence.acceptLorebook({...book, chatId});
}

function readyTwoStories() {
  const intelligence = new LoreIntelligenceService();
  accept(intelligence, 'chat-harbor', harborBook());
  accept(intelligence, 'chat-sky', skyBook());
  const study = intelligence.runStudy();
  assert.equal(study.results.length > 0, true);
  assert.equal(intelligence.status().entries.every((row) => ['READY', 'REMOVED'].includes(row.operatorState)), true);
  return intelligence;
}

function sourceIds(packet) {
  return packet.nominations.flatMap((row) => row.drillback.map((source) => source.sourceId));
}

function finishBuild(authoring, sessionId, maxActions = 128) {
  let progress = authoring.authoringProgress(sessionId);
  while (progress.stage === 'BUILDING' || progress.stage === 'CHECKPOINTED') {
    authoring.resumeAuthoringBuild({sessionId, maxActions});
    progress = authoring.authoringProgress(sessionId);
  }
  return progress;
}

function decideAll(authoring, sessionId, prefix = 'decision') {
  const draft = authoring.draftReview({sessionId});
  for (const [index, action] of draft.actions.entries()) {
    if (action.decision) continue;
    authoring.recordDraftDecision({
      sessionId,
      actionId: action.id,
      decision: 'ACCEPT',
      operatorDecisionId: prefix + '-' + index,
    });
  }
  return authoring.draftReview({sessionId});
}

test('story authority keeps discovery, acceptance, read scope and retrieval isolated by exact chat', () => {
  const intelligence = readyTwoStories();

  const harbor = intelligence.queryForStory({chatId: 'chat-harbor', query: 'Shared Beacon'});
  const sky = intelligence.queryForStory({chatId: 'chat-sky', query: 'Shared Beacon'});
  assert.equal(harbor.blocked, false);
  assert.equal(sky.blocked, false);
  assert.ok(sourceIds(harbor).length > 0);
  assert.ok(sourceIds(sky).length > 0);
  assert.equal(sourceIds(harbor).every((id) => id.startsWith('lore:harbor-world:')), true);
  assert.equal(sourceIds(sky).every((id) => id.startsWith('lore:sky-world:')), true);
  assert.equal(harbor.retrievalDiagnostics.storyScopeFiltered, true);
  assert.equal(sky.retrievalDiagnostics.storyScopeFiltered, true);

  const missing = intelligence.queryForStory({query: 'Shared Beacon'});
  assert.equal(missing.blocked, true);
  assert.equal(missing.reasonCode, 'LORE_STORY_SCOPE_REQUIRED');
  assert.deepEqual(missing.nominations, []);

  intelligence.recordHostDiscovery({
    chatId: 'chat-discovery-only',
    lorebookId: 'harbor-world',
    title: 'Harbor World',
    discovery: {kind: 'SillyTavernLorebookDiscoveryReceipt', stableId: 'selected-only'},
  });
  const discovered = intelligence.storyScopeReceipt({chatId: 'chat-discovery-only'});
  assert.equal(discovered.discoveredLorebooks.length, 1);
  assert.equal(discovered.acceptedForStudy.length, 0);
  assert.deepEqual(discovered.readLorebookIds, []);
  const notAccepted = intelligence.queryForStory({chatId: 'chat-discovery-only', query: 'Shared Beacon'});
  assert.equal(notAccepted.blocked, true);
  assert.equal(notAccepted.reasonCode, 'LORE_STORY_READ_SCOPE_EMPTY');

  accept(intelligence, 'chat-multi', harborBook());
  accept(intelligence, 'chat-multi', skyBook());
  intelligence.setStoryReadScope({chatId: 'chat-multi', lorebookIds: ['harbor-world']});
  const oneBook = intelligence.queryForStory({chatId: 'chat-multi', query: 'Shared Beacon'});
  assert.equal(sourceIds(oneBook).every((id) => id.startsWith('lore:harbor-world:')), true);
  intelligence.setStoryReadScope({chatId: 'chat-multi', lorebookIds: ['harbor-world', 'sky-world']});
  const bothBooks = intelligence.queryForStory({chatId: 'chat-multi', query: 'Shared Beacon'});
  assert.ok(sourceIds(bothBooks).some((id) => id.startsWith('lore:harbor-world:')));
  assert.ok(sourceIds(bothBooks).some((id) => id.startsWith('lore:sky-world:')));

  const duplicateA = intelligence.runtime.registry.currentRevision('lore:harbor-world:vault-rule');
  const duplicateB = intelligence.runtime.registry.currentRevision('lore:sky-world:vault-rule');
  assert.equal(duplicateA.exactContent, duplicateB.exactContent);
  assert.notEqual(duplicateA.id, duplicateB.id);
  assert.equal(intelligence.runtime.registry.currentRevision('lore:sky-world:beacon-complement').state, 'CURRENT');
  assert.equal(intelligence.runtime.registry.currentRevision('lore:sky-world:beacon-conflict').state, 'CURRENT');

  const restored = LoreIntelligenceService.fromSnapshot(intelligence.snapshot());
  assert.deepEqual(restored.storyScopeReceipt({chatId: 'chat-harbor'}).readLorebookIds, ['harbor-world']);
  assert.deepEqual(restored.storyScopeReceipt({chatId: 'chat-sky'}).readLorebookIds, ['sky-world']);
  assert.equal(sourceIds(restored.queryForStory({chatId: 'chat-harbor', query: 'Shared Beacon'}))
    .every((id) => id.startsWith('lore:harbor-world:')), true);
});

test('source edits stale learned retrieval and revoke revision-fenced write authority until explicit renewal', () => {
  const intelligence = readyTwoStories();
  intelligence.grantStoryWriteAuthority({
    chatId: 'chat-harbor',
    lorebookIds: ['harbor-world'],
    operatorAuthorityId: 'write-harbor-1',
  });
  assert.equal(
    intelligence.storyScopeReceipt({chatId: 'chat-harbor'}).writeAuthorities.find((row) => row.lorebookId === 'harbor-world').state,
    'ACTIVE',
  );

  const acceptance = accept(intelligence, 'chat-harbor', harborBook({alphaExtra: 'The beacon now emits the unique cobalt-signal marker.'}));
  assert.ok(acceptance.storyRevisionReceipts.some((row) => row.writeAuthorityRevoked));
  assert.equal(
    intelligence.storyScopeReceipt({chatId: 'chat-harbor'}).writeAuthorities.find((row) => row.lorebookId === 'harbor-world').state,
    'REVOKED',
  );

  const stale = intelligence.queryForStory({chatId: 'chat-harbor', query: 'unique cobalt-signal marker'});
  assert.equal(sourceIds(stale).includes('lore:harbor-world:alpha'), false);

  const study = intelligence.runStudy();
  assert.ok(study.navigationRebuild);
  assert.equal(study.navigationRebuild.fullRebuildPerformed, false);
  const fresh = intelligence.queryForStory({chatId: 'chat-harbor', query: 'unique cobalt-signal marker'});
  assert.ok(sourceIds(fresh).includes('lore:harbor-world:alpha'));
  assert.equal(intelligence.storyScopeReceipt({chatId: 'chat-harbor'}).readLorebookIds.includes('harbor-world'), true);
});

test('reviewed source create/update/delete survives checkpoint reload, Settlement resume, and restoration', () => {
  let intelligence = new LoreIntelligenceService();
  accept(intelligence, 'chat-author', harborBook());
  intelligence.runStudy();
  intelligence.grantStoryWriteAuthority({
    chatId: 'chat-author',
    lorebookIds: ['harbor-world'],
    operatorAuthorityId: 'author-write-1',
  });
  let authoring = new LoreAuthoringService({intelligence});

  assert.throws(() => {
    authoring.startSourceMutationBuild({
      chatId: 'chat-sky-unbound',
      proposals: [{
        action: 'UPDATE_ENTRY',
        sourceId: 'lore:harbor-world:alpha',
        content: 'Blocked cross-story edit.',
      }],
    });
  }, (error) => ['LORE_AUTHORING_READ_SCOPE_BLOCKED', 'LORE_STORY_SCOPE_UNKNOWN'].includes(error.code));

  const alphaBefore = intelligence.runtime.registry.currentRevision('lore:harbor-world:alpha');
  const betaBefore = intelligence.runtime.registry.currentRevision('lore:harbor-world:beta');
  const started = authoring.startSourceMutationBuild({
    chatId: 'chat-author',
    proposals: [
      {
        action: 'UPDATE_ENTRY',
        sourceId: 'lore:harbor-world:alpha',
        content: alphaBefore.exactContent + ' Ari records a cobalt watch signal.',
        metadata: alphaBefore.metadata,
        evidenceSourceIds: ['lore:harbor-world:alpha'],
      },
      {
        action: 'CREATE_ENTRY',
        lorebookId: 'harbor-world',
        uid: 'gamma',
        content: 'Gamma records the Harbor watch rotation and knows Ari.',
        metadata: {title: 'Gamma Watch Record', treePath: ['Harbor', 'Records'], order: 9},
        evidenceSourceIds: ['lore:harbor-world:alpha'],
      },
      {
        action: 'DELETE_ENTRY',
        sourceId: 'lore:harbor-world:beta',
        reason: 'operator-reviewed obsolete state entry',
        evidenceSourceIds: ['lore:harbor-world:beta'],
      },
    ],
  });
  finishBuild(authoring, started.sessionId, 2);
  const draft = decideAll(authoring, started.sessionId, 'source-accept');
  assert.equal(draft.actions.length, 3);
  for (const action of draft.actions) {
    assert.ok(action.evidenceReceipt);
    assert.ok(action.evidenceReceipt.exactSourceRevisions.length > 0);
    assert.ok(action.evidenceReceipt.learnedEvidenceRefs.length > 0);
    assert.equal(action.evidenceReceipt.proposalMutationAuthority, false);
    assert.equal(action.evidenceReceipt.explicitApprovalRequired, true);
  }

  const preview = authoring.computeFinalPreview({sessionId: started.sessionId});
  assert.equal(preview.validation.ok, true);
  assert.equal(preview.output.kind, 'LoreSourceMutationFinalOutputPreview');
  assert.equal(preview.output.proposals.length, 3);
  assert.equal(preview.proposalEvidenceReceipts.length, 3);
  authoring.approveFinalPreview({
    sessionId: started.sessionId,
    operatorApprovalId: 'source-final-approval',
  });

  let settlement = authoring.applySettlement({sessionId: started.sessionId, maxOperations: 1});
  assert.equal(settlement.state, 'CHECKPOINTED');
  assert.equal(settlement.cursor, 1);
  assert.equal(
    intelligence.storyScopeReceipt({chatId: 'chat-author'}).writeAuthorities.find((row) => row.lorebookId === 'harbor-world').state,
    'REVOKED',
  );

  const intelligenceSnapshot = intelligence.snapshot();
  const authoringSnapshot = authoring.snapshot();
  intelligence = LoreIntelligenceService.fromSnapshot(intelligenceSnapshot);
  authoring = LoreAuthoringService.fromSnapshot(authoringSnapshot, {intelligence});

  while (settlement.state !== 'SETTLED') {
    settlement = authoring.applySettlement({sessionId: started.sessionId, maxOperations: 1});
    assert.notEqual(settlement.state, 'FAILED');
  }
  const settlementId = settlement.settlementId;
  assert.match(intelligence.runtime.registry.currentRevision('lore:harbor-world:alpha').exactContent, /cobalt watch signal/);
  assert.equal(intelligence.runtime.registry.currentRevision('lore:harbor-world:gamma').state, 'CURRENT');
  assert.equal(intelligence.runtime.registry.currentRevision('lore:harbor-world:beta').state, 'REMOVED');

  const worker1 = authoring.worker1SettlementReceipts({settlementId});
  assert.equal(worker1.storyScope.chatId, 'chat-author');
  assert.ok(worker1.revisionEvents.length >= 3);
  assert.ok(worker1.invalidationReceipts.length >= 3);

  intelligence.grantStoryWriteAuthority({
    chatId: 'chat-author',
    lorebookIds: ['harbor-world'],
    operatorAuthorityId: 'author-restore-write',
  });
  let restored = authoring.restoreSettlement({
    settlementId,
    restorationId: 'restore-source-wave',
    maxOperations: 1,
  });
  assert.equal(restored.restoration.state, 'CHECKPOINTED');

  const midRestoreIntelligence = intelligence.snapshot();
  const midRestoreAuthoring = authoring.snapshot();
  intelligence = LoreIntelligenceService.fromSnapshot(midRestoreIntelligence);
  authoring = LoreAuthoringService.fromSnapshot(midRestoreAuthoring, {intelligence});

  while (restored.restoration.state !== 'RESTORED') {
    restored = authoring.restoreSettlement({settlementId, maxOperations: 1});
    assert.notEqual(restored.restoration.state, 'FAILED');
  }
  assert.equal(intelligence.runtime.registry.currentRevision('lore:harbor-world:alpha').exactContent, alphaBefore.exactContent);
  assert.equal(intelligence.runtime.registry.currentRevision('lore:harbor-world:beta').exactContent, betaBefore.exactContent);
  assert.equal(intelligence.runtime.registry.currentRevision('lore:harbor-world:beta').state, 'CURRENT');
  assert.equal(intelligence.runtime.registry.currentRevision('lore:harbor-world:gamma').state, 'REMOVED');
  assert.equal(restored.reconstructionManifest.reconstructable, true);
});

test('source edit after Final Preview invalidates approval and targeted navigation rebuild preserves unrelated branches', () => {
  const intelligence = new LoreIntelligenceService();
  accept(intelligence, 'chat-nav', harborBook());
  accept(intelligence, 'chat-nav', skyBook());
  intelligence.runStudy();
  intelligence.grantStoryWriteAuthority({
    chatId: 'chat-nav',
    lorebookIds: ['harbor-world'],
    operatorAuthorityId: 'nav-write-1',
  });
  const authoring = new LoreAuthoringService({intelligence});

  const navigation = authoring.adaptiveNavigationPreview({chatId: 'chat-nav'});
  assert.equal(navigation.previewOnly, true);
  assert.equal(navigation.authoredEntriesDuplicated, false);
  assert.ok(navigation.survey.orphanedSourceIds.includes('lore:harbor-world:orphan'));
  assert.equal(navigation.survey.entries.every((row) => row.authoredEntryDuplicated === false), true);
  assert.ok(navigation.survey.entries.some((row) => row.navigationPaths.some((entry) => entry.kind === 'AUTHORED_HOME')));
  assert.ok(navigation.survey.entries.some((row) => row.navigationPaths.length > 1));

  const alpha = intelligence.runtime.registry.currentRevision('lore:harbor-world:alpha');
  const race = authoring.startSourceMutationBuild({
    chatId: 'chat-nav',
    proposals: [{
      action: 'UPDATE_ENTRY',
      sourceId: 'lore:harbor-world:alpha',
      content: alpha.exactContent + ' Proposed reviewed update.',
      metadata: alpha.metadata,
      evidenceSourceIds: ['lore:harbor-world:alpha'],
    }],
  });
  finishBuild(authoring, race.sessionId);
  decideAll(authoring, race.sessionId, 'race');
  const racePreview = authoring.computeFinalPreview({sessionId: race.sessionId});
  assert.equal(racePreview.validation.ok, true);

  const skyRevisionBefore = new Map(
    intelligence.runtime.registry.listEntries({includeRemoved: false})
      .filter((source) => source.lorebookId === 'sky-world')
      .map((source) => [source.sourceId, intelligence.runtime.registry.currentRevision(source.sourceId).id]),
  );
  const skyLeafScopes = intelligence.hierarchy.hierarchy.scopes
    .filter((scope) => scope.type === 'LEAF' && (scope.sourceIds || []).every((id) => id.startsWith('lore:sky-world:')))
    .map((scope) => scope.id);
  const skySummaryBefore = new Map(skyLeafScopes.map((scopeId) => [scopeId, intelligence.hierarchy.currentSummary(scopeId)?.id || null]));
  const oldPeopleScope = intelligence.hierarchy.hierarchy.scopes.find((scope) =>
    scope.type === 'TREE' && JSON.stringify(scope.treePath || []) === JSON.stringify(['Harbor', 'People'])
  );
  assert.ok(oldPeopleScope);

  const changedBook = harborBook({
    alphaExtra: 'An external edit lands after Final Preview and moves Ari.',
    alphaPath: ['Harbor', 'Watch'],
  });
  accept(intelligence, 'chat-nav', changedBook);
  assert.throws(() => authoring.approveFinalPreview({
    sessionId: race.sessionId,
    operatorApprovalId: 'stale-approval-1',
  }), (error) => error.code === 'LORE_STORY_WRITE_BLOCKED');

  intelligence.grantStoryWriteAuthority({
    chatId: 'chat-nav',
    lorebookIds: ['harbor-world'],
    operatorAuthorityId: 'nav-write-2',
  });
  const staleApproval = authoring.approveFinalPreview({
    sessionId: race.sessionId,
    operatorApprovalId: 'stale-approval-2',
  });
  assert.equal(staleApproval.readyForApproval, false);
  assert.equal(staleApproval.stale.reason, 'SOURCE_REVISION_FENCE_CHANGED');

  const study = intelligence.runStudy();
  const rebuild = study.navigationRebuild;
  assert.ok(rebuild);
  assert.equal(rebuild.fullRebuildPerformed, false);
  assert.ok(rebuild.sourceIds.includes('lore:harbor-world:alpha'));
  assert.ok(rebuild.affectedScopeIds.includes(oldPeopleScope.id), 'old branch should be rebuilt because Nia remains there');
  const newWatchScope = intelligence.hierarchy.hierarchy.scopes.find((scope) =>
    scope.type === 'TREE' && JSON.stringify(scope.treePath || []) === JSON.stringify(['Harbor', 'Watch'])
  );
  assert.ok(newWatchScope);
  assert.ok(rebuild.affectedScopeIds.includes(newWatchScope.id));

  for (const [sourceId, revisionId] of skyRevisionBefore.entries()) {
    assert.equal(intelligence.runtime.registry.currentRevision(sourceId).id, revisionId);
  }
  for (const scopeId of skyLeafScopes) {
    assert.equal(intelligence.hierarchy.currentSummary(scopeId)?.id || null, skySummaryBefore.get(scopeId));
    assert.ok(rebuild.untouchedScopeIds.includes(scopeId));
  }
});
