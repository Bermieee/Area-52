import test from 'node:test';
import assert from 'node:assert/strict';

import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';
import {LoreSemanticImpactPlanner} from '../src/lore-semantic-impact-planner.js';
import {LoreReviewedMutationService} from '../src/lore-reviewed-mutation.js';
import {LoreMutationOperation, LoreMutationState} from '../src/lore-authoring-contracts.js';

const CHAT = 'chat:authoring-owner';

function book(entries) {
  return {
    id: 'authoring-owner',
    title: 'Authoring Owner',
    discovery: {
      kind: 'SillyTavernLorebookDiscoveryReceipt',
      source: 'WORKER4_FIXTURE',
      lorebookId: 'authoring-owner',
      entryCount: entries.length,
      chatId: CHAT,
      exactAuthoredSource: true,
    },
    fullSnapshot: true,
    entries,
  };
}

function readyWorld() {
  const intelligence = new LoreIntelligenceService();
  intelligence.acceptLorebook(book([
    {
      uid: 'mara',
      content: 'Mara owns the Ember Tavern. Mara must never reveal the cellar key. Mara knows Eris.',
      metadata: {title: 'Mara', treePath: ['Places', 'Ember Tavern']},
    },
    {
      uid: 'blade',
      content: 'Eris carried the Sun Blade. Eris later left the Sun Blade at the Ember Tavern.',
      metadata: {title: 'Sun Blade', treePath: ['Artifacts', 'Sun Blade']},
    },
    {
      uid: 'rumor',
      content: 'A witness reports the Sun Blade may have been removed before the fire.',
      metadata: {title: 'Rumor', treePath: ['Artifacts', 'Sun Blade']},
    },
  ]));
  intelligence.runStudy({scope: 'DUE'});
  return intelligence;
}

function changeSource(intelligence, uid, content, metadata) {
  const sourceId = 'lore:authoring-owner:' + uid;
  const before = intelligence.runtime.registry.currentRevision(sourceId);
  const source = intelligence.runtime.registry.getEntry(sourceId);
  const result = intelligence.runtime.upsertEntry({
    lorebookId: source.lorebookId,
    uid: source.uid,
    content,
    metadata,
  });
  intelligence.runStudy({scope: 'DUE'});
  const after = intelligence.runtime.registry.currentRevision(sourceId);
  return {sourceId, before, after, result};
}

test('semantic impact planner reports bounded typed A -> B changes and exact revision drillback', () => {
  const intelligence = readyWorld();
  const {sourceId, before, after} = changeSource(
    intelligence,
    'mara',
    'Mara formerly owned the Ember Tavern. Mara carries the Sun Blade. Mara must never reveal the archive key.',
    {title: 'Mara', treePath: ['People', 'Mara']},
  );
  const planner = new LoreSemanticImpactPlanner({intelligence});
  const plan = planner.plan({
    sourceId,
    fromRevisionId: before.id,
    toRevisionId: after.id,
  });

  assert.equal(plan.kind, 'LoreSemanticImpactPlan');
  assert.equal(plan.contractVersion, 1);
  assert.equal(plan.source.sourceRevisionId, after.id);
  assert.equal(plan.previousSource.sourceRevisionId, before.id);
  assert.equal(plan.exactSourcePreserved, true);
  assert.equal(plan.bounds.truncated, false);

  for (const key of [
    'CLAIM', 'ENTITY', 'ALIAS', 'RELATIONSHIP', 'RULE', 'CAPABILITY',
    'TEMPORAL', 'CONTRADICTION', 'CONCEPT', 'COMMUNITY',
    'RETRIEVAL', 'COMPACT', 'STRUCTURE',
  ]) {
    assert.ok(plan.changes[key], 'missing typed change bucket ' + key);
    assert.ok(Array.isArray(plan.changes[key].added));
    assert.ok(Array.isArray(plan.changes[key].removed));
    assert.ok(Array.isArray(plan.changes[key].changed));
  }

  assert.equal(plan.classification.meaningChanged, true);
  assert.equal(plan.classification.wordingOnly, false);
  assert.deepEqual(plan.structure.beforeTreePath, ['Places', 'Ember Tavern']);
  assert.deepEqual(plan.structure.afterTreePath, ['People', 'Mara']);
  assert.equal(plan.structure.changed, true);

  const descriptors = Object.values(plan.changes)
    .flatMap((bucket) => [...bucket.added, ...bucket.removed, ...bucket.changed.flatMap((row) => [row.before, row.after].filter(Boolean))])
    .filter(Boolean);
  assert.ok(descriptors.some((row) => row.sourceRevisionId === before.id));
  assert.ok(descriptors.some((row) => row.sourceRevisionId === after.id));
  assert.ok(descriptors.filter((row) => row.exactEvidence).every((row) => row.exactEvidence.sourceRevisionId));
});

test('wording-only source revision preserves semantic aggregates while revision-fenced rows refresh', () => {
  const intelligence = readyWorld();
  const sourceId = 'lore:authoring-owner:blade';
  const before = intelligence.runtime.registry.currentRevision(sourceId);
  const beforeArtifacts = intelligence.runtime.store.artifactsForLearnedRevision(
    intelligence.runtime.store.currentLearnedRevision(sourceId).id,
  );
  const wordingOnly = before.exactContent.replace('Sun Blade.', 'Sun Blade!');

  const {after} = changeSource(
    intelligence,
    'blade',
    wordingOnly,
    before.metadata,
  );
  const planner = new LoreSemanticImpactPlanner({intelligence});
  const plan = planner.plan({sourceId, fromRevisionId: before.id, toRevisionId: after.id});

  assert.notEqual(before.contentHash, after.contentHash);
  assert.equal(plan.classification.meaningChanged, false);
  assert.equal(plan.classification.wordingOnly, true);
  assert.ok(plan.impact.required.some((row) => row.target === 'STUDY_ARTIFACTS'));
  assert.ok(plan.impact.required.some((row) => row.target === 'REPRESENTATIONS'));
  assert.ok(plan.impact.required.some((row) => row.target === 'RETRIEVAL_INDEX'));
  assert.equal(plan.impact.required.some((row) => row.target === 'ONTOLOGY' && row.reason === 'SEMANTIC_MEANING_CHANGED'), false);
  assert.ok(plan.impact.preserved.unrelatedSourceCount >= 2);
  assert.ok(plan.impact.preserved.refs.every((ref) => !String(ref).includes(before.id) || !plan.impact.invalidatedRefs.includes(ref)));
  assert.ok(beforeArtifacts.length > 0);
});

test('temporal and unresolved transitions are explicit and dependency cone preserves unrelated sources', () => {
  const intelligence = readyWorld();
  const sourceId = 'lore:authoring-owner:rumor';
  const before = intelligence.runtime.registry.currentRevision(sourceId);
  const {after} = changeSource(
    intelligence,
    'rumor',
    'The Sun Blade was removed before the fire. The Sun Blade is now stored in the Archive.',
    before.metadata,
  );
  const planner = new LoreSemanticImpactPlanner({intelligence});
  const plan = planner.plan({sourceId, fromRevisionId: before.id, toRevisionId: after.id});

  assert.ok(
    plan.changes.TEMPORAL.added.length
      + plan.changes.TEMPORAL.removed.length
      + plan.changes.TEMPORAL.changed.length > 0,
  );
  assert.ok(
    plan.changes.CONTRADICTION.added.length
      + plan.changes.CONTRADICTION.removed.length
      + plan.changes.CONTRADICTION.changed.length > 0,
  );
  assert.ok(plan.impact.edges.every((edge) => ['DIRECT', 'TRANSITIVE', 'REGENERATE', 'REINDEX', 'REVIEW', 'PRESERVE'].includes(edge.class)));
  assert.equal(plan.impact.unrelatedSourcesInvalidated, false);
  assert.ok(plan.impact.preserved.unrelatedSourceCount >= 2);
  assert.ok(plan.impact.direct.some((row) => row.sourceRevisionId === before.id));
});


function mutationService() {
  const intelligence = readyWorld();
  return {intelligence, mutations: new LoreReviewedMutationService({intelligence})};
}

function approve(mutations, proposalId, decisionId) {
  return mutations.approve({proposalId, operatorDecisionId: decisionId, chatId: CHAT});
}

test('reviewed mutation CREATE UPDATE DELETE TREE_ASSIGN mutate only after explicit approval and commit', () => {
  {
    const {intelligence, mutations} = mutationService();
    const proposal = mutations.createProposal({
      operation: LoreMutationOperation.CREATE,
      chatId: CHAT,
      target: {
        lorebookId: 'authoring-owner',
        uid: 'new-place',
        content: 'The Archive stands north of the Ember Tavern.',
        metadata: {title: 'Archive', treePath: ['Places', 'Archive']},
      },
      origin: {kind: 'MODEL_SUGGESTION', provider: 'fixture'},
    });
    assert.equal(proposal.state, LoreMutationState.REVIEW_READY);
    assert.equal(intelligence.runtime.registry.getEntry('lore:authoring-owner:new-place'), null);
    assert.equal(proposal.authority.modelMutationAuthority, false);
    assert.equal(proposal.authority.jevMutationAuthority, false);
    assert.equal(proposal.preview.after[0].contentIncluded, true);
    assert.ok(proposal.evidence.sourceRevisionRefs.length >= 0);

    approve(mutations, proposal.proposalId, 'approve-create');
    assert.equal(intelligence.runtime.registry.getEntry('lore:authoring-owner:new-place'), null);
    const committed = mutations.commit({proposalId: proposal.proposalId, operatorDecisionId: 'approve-create', chatId: CHAT});
    assert.equal(committed.state, LoreMutationState.COMMITTED);
    const created = intelligence.runtime.registry.currentRevision('lore:authoring-owner:new-place');
    assert.equal(created.exactContent, 'The Archive stands north of the Ember Tavern.');
    assert.equal(intelligence.runtime.dueObligations().filter((row) => row.sourceId === created.sourceId).length, 1);
  }

  {
    const {intelligence, mutations} = mutationService();
    const sourceId = 'lore:authoring-owner:mara';
    const before = intelligence.runtime.registry.currentRevision(sourceId);
    const unrelated = intelligence.runtime.registry.currentRevision('lore:authoring-owner:blade').id;
    const proposal = mutations.createProposal({
      operation: LoreMutationOperation.UPDATE,
      chatId: CHAT,
      sourceId,
      after: {
        content: 'Mara formerly owned the Ember Tavern. Mara protects the Archive.',
        metadata: before.metadata,
      },
    });
    assert.equal(intelligence.runtime.registry.currentRevision(sourceId).id, before.id);
    assert.ok(proposal.semanticImpact.length >= 1);
    approve(mutations, proposal.proposalId, 'approve-update');
    const committed = mutations.commit({proposalId: proposal.proposalId, operatorDecisionId: 'approve-update', chatId: CHAT});
    assert.equal(committed.state, LoreMutationState.COMMITTED);
    assert.notEqual(intelligence.runtime.registry.currentRevision(sourceId).id, before.id);
    assert.equal(intelligence.runtime.registry.currentRevision('lore:authoring-owner:blade').id, unrelated);
    assert.equal(committed.revisionEvents.length, 1);
    assert.equal(committed.invalidationReceipts[0].unrelatedSourcesInvalidated, false);
  }

  {
    const {intelligence, mutations} = mutationService();
    const sourceId = 'lore:authoring-owner:mara';
    const before = intelligence.runtime.registry.currentRevision(sourceId);
    const proposal = mutations.createProposal({
      operation: LoreMutationOperation.DELETE,
      chatId: CHAT,
      sourceId,
    });
    approve(mutations, proposal.proposalId, 'approve-delete');
    const committed = mutations.commit({proposalId: proposal.proposalId, operatorDecisionId: 'approve-delete', chatId: CHAT});
    assert.equal(committed.state, LoreMutationState.COMMITTED);
    assert.equal(intelligence.runtime.registry.currentRevision(sourceId).state, 'REMOVED');
    assert.equal(intelligence.runtime.registry.getRevision(before.id).exactContent, before.exactContent);

    const restored = mutations.restore({proposalId: proposal.proposalId, restorationId: 'restore-delete'});
    assert.equal(restored.state, LoreMutationState.RESTORED);
    assert.equal(intelligence.runtime.registry.currentRevision(sourceId).state, 'CURRENT');
    assert.equal(intelligence.runtime.registry.currentRevision(sourceId).exactContent, before.exactContent);
    assert.ok(intelligence.runtime.registry.revisionHistory(sourceId).length >= 3);
  }

  {
    const {intelligence, mutations} = mutationService();
    const sourceId = 'lore:authoring-owner:mara';
    const before = intelligence.runtime.registry.currentRevision(sourceId);
    const proposal = mutations.createProposal({
      operation: LoreMutationOperation.TREE_ASSIGN,
      chatId: CHAT,
      sourceId,
      treePath: ['Characters', 'Mara'],
    });
    approve(mutations, proposal.proposalId, 'approve-tree');
    mutations.commit({proposalId: proposal.proposalId, operatorDecisionId: 'approve-tree', chatId: CHAT});
    const after = intelligence.runtime.registry.currentRevision(sourceId);
    assert.equal(after.exactContent, before.exactContent);
    assert.deepEqual(after.metadata.treePath, ['Characters', 'Mara']);
    assert.deepEqual(before.metadata.treePath, ['Places', 'Ember Tavern']);
  }
});

test('reviewed mutation MERGE SPLIT MOVE preserve inputs unless an approved operation explicitly changes them', () => {
  {
    const {intelligence, mutations} = mutationService();
    const sourceIds = ['lore:authoring-owner:blade', 'lore:authoring-owner:rumor'];
    const inputFence = new Map(sourceIds.map((id) => [id, intelligence.runtime.registry.currentRevision(id).id]));
    const proposal = mutations.createProposal({
      operation: LoreMutationOperation.MERGE,
      chatId: CHAT,
      sourceIds,
      target: {
        lorebookId: 'authoring-owner',
        uid: 'blade-reconciled',
        content: 'Eris later left the Sun Blade at the Ember Tavern. A witness reported a conflicting account.',
        metadata: {title: 'Sun Blade Reconciled', treePath: ['Artifacts', 'Sun Blade']},
      },
    });
    approve(mutations, proposal.proposalId, 'approve-merge');
    mutations.commit({proposalId: proposal.proposalId, operatorDecisionId: 'approve-merge', chatId: CHAT});
    assert.equal(intelligence.runtime.registry.currentRevision('lore:authoring-owner:blade-reconciled').state, 'CURRENT');
    for (const [sourceId, revisionId] of inputFence) {
      assert.equal(intelligence.runtime.registry.currentRevision(sourceId).id, revisionId);
    }
  }

  {
    const {intelligence, mutations} = mutationService();
    const sourceId = 'lore:authoring-owner:mara';
    const sourceRevisionId = intelligence.runtime.registry.currentRevision(sourceId).id;
    const proposal = mutations.createProposal({
      operation: LoreMutationOperation.SPLIT,
      chatId: CHAT,
      sourceId,
      outputs: [
        {
          lorebookId: 'authoring-owner',
          uid: 'mara-role',
          content: 'Mara owns the Ember Tavern.',
          metadata: {title: 'Mara Role', treePath: ['Characters', 'Mara']},
        },
        {
          lorebookId: 'authoring-owner',
          uid: 'mara-rule',
          content: 'Mara must never reveal the cellar key.',
          metadata: {title: 'Mara Rule', treePath: ['Rules', 'Mara']},
        },
      ],
    });
    approve(mutations, proposal.proposalId, 'approve-split');
    mutations.commit({proposalId: proposal.proposalId, operatorDecisionId: 'approve-split', chatId: CHAT});
    assert.equal(intelligence.runtime.registry.currentRevision(sourceId).id, sourceRevisionId);
    assert.ok(intelligence.runtime.registry.currentRevision('lore:authoring-owner:mara-role'));
    assert.ok(intelligence.runtime.registry.currentRevision('lore:authoring-owner:mara-rule'));
  }

  {
    const {intelligence, mutations} = mutationService();
    const sourceId = 'lore:authoring-owner:mara';
    const before = intelligence.runtime.registry.currentRevision(sourceId);
    const proposal = mutations.createProposal({
      operation: LoreMutationOperation.MOVE,
      chatId: CHAT,
      sourceId,
      target: {lorebookId: 'authoring-owner', uid: 'mara-moved'},
    });
    approve(mutations, proposal.proposalId, 'approve-move');
    const committed = mutations.commit({proposalId: proposal.proposalId, operatorDecisionId: 'approve-move', chatId: CHAT});
    assert.equal(committed.revisionEvents.length, 2);
    assert.equal(intelligence.runtime.registry.currentRevision(sourceId).state, 'REMOVED');
    const moved = intelligence.runtime.registry.currentRevision('lore:authoring-owner:mara-moved');
    assert.equal(moved.exactContent, before.exactContent);
    assert.deepEqual(moved.metadata.treePath, before.metadata.treePath);
  }
});

test('rejected duplicate and stale reviewed proposals change no authored canon', () => {
  const {intelligence, mutations} = mutationService();
  const sourceId = 'lore:authoring-owner:mara';
  const before = intelligence.runtime.registry.currentRevision(sourceId);
  const request = {
    operation: LoreMutationOperation.UPDATE,
    chatId: CHAT,
    sourceId,
    after: {
      content: 'Mara owns the Ember Tavern. Mara protects the cellar key.',
      metadata: before.metadata,
    },
  };
  const first = mutations.createProposal(request);
  const duplicate = mutations.createProposal(request);
  assert.equal(duplicate.proposalId, first.proposalId);

  const rejected = mutations.reject({
    proposalId: first.proposalId,
    operatorDecisionId: 'reject-update',
    chatId: CHAT,
  });
  assert.equal(rejected.state, LoreMutationState.REJECTED);
  assert.equal(intelligence.runtime.registry.currentRevision(sourceId).id, before.id);
  assert.throws(
    () => mutations.commit({proposalId: first.proposalId, operatorDecisionId: 'reject-update', chatId: CHAT}),
    /approved/i,
  );

  const staleProposal = mutations.createProposal({
    ...request,
    after: {...request.after, content: 'Mara owns the Ember Tavern. Mara protects the Archive.'},
  });
  approve(mutations, staleProposal.proposalId, 'approve-stale');
  const external = intelligence.runtime.upsertEntry({
    lorebookId: 'authoring-owner',
    uid: 'mara',
    content: before.exactContent + ' External operator edit.',
    metadata: before.metadata,
  });
  const historyBeforeCommit = intelligence.runtime.registry.revisionHistory(sourceId).length;
  const stale = mutations.commit({
    proposalId: staleProposal.proposalId,
    operatorDecisionId: 'approve-stale',
    chatId: CHAT,
  });
  assert.equal(stale.state, LoreMutationState.STALE);
  assert.equal(intelligence.runtime.registry.currentRevision(sourceId).id, external.revision.id);
  assert.equal(intelligence.runtime.registry.revisionHistory(sourceId).length, historyBeforeCommit);
});

test('reviewed mutation enforces exact chat scope and requires explicit global operator mode when unscoped', () => {
  const {intelligence, mutations} = mutationService();
  const sourceId = 'lore:authoring-owner:mara';
  const before = intelligence.runtime.registry.currentRevision(sourceId);

  assert.throws(
    () => mutations.createProposal({
      operation: LoreMutationOperation.UPDATE,
      chatId: 'chat:not-authorized',
      sourceId,
      after: {content: before.exactContent + ' Change.', metadata: before.metadata},
    }),
    /scope|authorized/i,
  );

  assert.throws(
    () => mutations.createProposal({
      operation: LoreMutationOperation.UPDATE,
      sourceId,
      after: {content: before.exactContent + ' Change.', metadata: before.metadata},
    }),
    /GLOBAL_OPERATOR|chatId/i,
  );

  const global = mutations.createProposal({
    operation: LoreMutationOperation.UPDATE,
    scopeMode: 'GLOBAL_OPERATOR',
    sourceId,
    after: {content: before.exactContent + ' Reviewed global operator change.', metadata: before.metadata},
  });
  assert.equal(global.scope.scopeMode, 'GLOBAL_OPERATOR');
  const approved = mutations.approve({
    proposalId: global.proposalId,
    operatorDecisionId: 'global-approval',
    scopeMode: 'GLOBAL_OPERATOR',
  });
  assert.equal(approved.state, LoreMutationState.APPROVED);
});

test('reviewed mutation replay, collision, reload and audit stay deterministic and recoverable', () => {
  let {intelligence, mutations} = mutationService();
  const proposal = mutations.createProposal({
    operation: LoreMutationOperation.CREATE,
    chatId: CHAT,
    target: {
      lorebookId: 'authoring-owner',
      uid: 'audit-entry',
      content: 'The Audit Bell hangs in the Archive.',
      metadata: {title: 'Audit Bell', treePath: ['Artifacts', 'Audit Bell']},
    },
  });
  approve(mutations, proposal.proposalId, 'audit-approval');
  const committed = mutations.commit({proposalId: proposal.proposalId, operatorDecisionId: 'audit-approval', chatId: CHAT});
  const revisionId = intelligence.runtime.registry.currentRevision('lore:authoring-owner:audit-entry').id;
  const historyLength = intelligence.runtime.registry.revisionHistory('lore:authoring-owner:audit-entry').length;

  assert.throws(
    () => mutations.commit({proposalId: proposal.proposalId, operatorDecisionId: 'audit-approval', chatId: 'chat:wrong'}),
    /scope|chat/i,
  );
  const replay = mutations.commit({proposalId: proposal.proposalId, operatorDecisionId: 'audit-approval', chatId: CHAT});
  assert.equal(replay.replayed, true);
  assert.equal(intelligence.runtime.registry.currentRevision('lore:authoring-owner:audit-entry').id, revisionId);
  assert.equal(intelligence.runtime.registry.revisionHistory('lore:authoring-owner:audit-entry').length, historyLength);

  const audit = mutations.audit({proposalId: proposal.proposalId});
  assert.equal(audit.proposalId, proposal.proposalId);
  assert.ok(audit.events.some((row) => row.kind === 'LoreMutationCommittedAudit'));
  assert.ok(audit.reconstruction);

  const intelligenceSnapshot = intelligence.snapshot();
  const mutationSnapshot = mutations.snapshot();
  intelligence = LoreIntelligenceService.fromSnapshot(intelligenceSnapshot);
  mutations = LoreReviewedMutationService.fromSnapshot(mutationSnapshot, {intelligence});
  assert.equal(mutations.read(proposal.proposalId).state, LoreMutationState.COMMITTED);
  assert.equal(mutations.audit({proposalId: proposal.proposalId}).proposalId, proposal.proposalId);

  const collision = mutations.createProposal({
    operation: LoreMutationOperation.CREATE,
    chatId: CHAT,
    target: {
      lorebookId: 'authoring-owner',
      uid: 'future-collision',
      content: 'Proposed content.',
      metadata: {title: 'Collision', treePath: []},
    },
  });
  mutations.approve({proposalId: collision.proposalId, operatorDecisionId: 'collision-approval', chatId: CHAT});
  intelligence.runtime.upsertEntry({
    lorebookId: 'authoring-owner',
    uid: 'future-collision',
    content: 'External owner content.',
    metadata: {title: 'External', treePath: []},
  });
  const collisionResult = mutations.commit({
    proposalId: collision.proposalId,
    operatorDecisionId: 'collision-approval',
    chatId: CHAT,
  });
  assert.equal(collisionResult.state, LoreMutationState.STALE);
  assert.equal(intelligence.runtime.registry.currentRevision('lore:authoring-owner:future-collision').exactContent, 'External owner content.');
  assert.equal(committed.authority.sourceMutationAuthority, true);
  assert.equal(committed.authority.modelMutationAuthority, false);
  assert.equal(committed.authority.jevMutationAuthority, false);
});


test('commit-time operation fingerprint revalidation rejects a tampered restored proposal without mutation', () => {
  let {intelligence, mutations} = mutationService();
  const sourceId = 'lore:authoring-owner:mara';
  const before = intelligence.runtime.registry.currentRevision(sourceId);
  const proposal = mutations.createProposal({
    operation: LoreMutationOperation.UPDATE,
    chatId: CHAT,
    sourceId,
    after: {
      content: before.exactContent + ' Approved exact addition.',
      metadata: before.metadata,
    },
  });
  approve(mutations, proposal.proposalId, 'fingerprint-approval');

  const snapshot = mutations.snapshot();
  const stored = snapshot.proposals.find((row) => row.proposalId === proposal.proposalId);
  stored.intent.after.content = 'Tampered content that was never approved.';
  mutations = LoreReviewedMutationService.fromSnapshot(snapshot, {intelligence});

  const result = mutations.commit({
    proposalId: proposal.proposalId,
    operatorDecisionId: 'fingerprint-approval',
    chatId: CHAT,
  });
  assert.equal(result.state, LoreMutationState.STALE);
  assert.equal(result.lastError.code, 'LORE_MUTATION_FINGERPRINT_CHANGED');
  assert.equal(intelligence.runtime.registry.currentRevision(sourceId).id, before.id);
});
