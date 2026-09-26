import test from 'node:test';
import assert from 'node:assert/strict';

import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';
import {LoreSemanticImpactPlanner} from '../src/lore-semantic-impact-planner.js';

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
