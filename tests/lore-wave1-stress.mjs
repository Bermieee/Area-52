import assert from 'node:assert/strict';
import {ArtifactType, AuthorityClass, StudyState} from '../src/lore-contracts.js';
import {LoreStudyRuntime} from '../src/lore-study-runtime.js';

let runtime = new LoreStudyRuntime();
runtime.registerLorebook({id: 'stress', title: 'Stress Lorebook'});
const SOURCE_COUNT = 40;
const EDIT_ROUNDS = 25;
let unrelatedFullRebuilds = 0;
let resumedCheckpoints = 0;
let duplicateSignals = 0;

for (let i = 0; i < SOURCE_COUNT; i += 1) {
  runtime.upsertEntry({
    lorebookId: 'stress',
    uid: i,
    content: 'Keeper' + i + ' owns the Ember Tavern ' + i + '.',
    metadata: {title: 'Entry ' + i, treePath: ['Stress', String(i % 5)]},
  });
}
runtime.runDue();

for (let round = 0; round < EDIT_ROUNDS; round += 1) {
  for (let i = 0; i < SOURCE_COUNT; i += 1) {
    const sourceId = 'lore:stress:' + i;
    const neighborId = 'lore:stress:' + ((i + 1) % SOURCE_COUNT);
    const neighborBefore = runtime.store.currentLearnedRevision(neighborId)?.id || null;
    const update = runtime.upsertEntry({
      lorebookId: 'stress',
      uid: i,
      content: 'Keeper' + i + ' owns the Ember Tavern ' + i + '. Keeper' + i + ' knows Visitor' + round + '.',
      metadata: {title: 'Entry ' + i, treePath: ['Stress', String(i % 5)]},
    });
    const duplicate = runtime.enqueue(update.revision, 'CHANGED_UID');
    if (duplicate.id === update.obligation.id) duplicateSignals += 1;

    if ((round * SOURCE_COUNT + i) % 73 === 0) {
      const partial = runtime.run(update.obligation.id, {maxUnits: 3});
      assert.equal(partial.obligation.state, StudyState.CHECKPOINTED);
      const checkpoint = partial.obligation.checkpoint.unitIndex;
      runtime = LoreStudyRuntime.fromSnapshot(runtime.snapshot());
      const resumed = runtime.run(update.obligation.id);
      assert.equal(resumed.obligation.state, StudyState.COMPLETED);
      assert.ok(resumed.obligation.checkpoint.unitIndex > checkpoint);
      resumedCheckpoints += 1;
    } else {
      const result = runtime.run(update.obligation.id);
      assert.equal(result.obligation.state, StudyState.COMPLETED);
    }

    const neighborAfter = runtime.store.currentLearnedRevision(neighborId)?.id || null;
    if (neighborBefore !== neighborAfter) unrelatedFullRebuilds += 1;
  }
}

for (let i = 0; i < 5; i += 1) {
  const removal = runtime.removeEntry({lorebookId: 'stress', uid: i, reason: 'stress-removal'});
  runtime.run(removal.obligation.id);
}

const histories = runtime.registry.listEntries({includeRemoved: true}).map((entry) => runtime.registry.revisionHistory(entry.sourceId));
const sourceRevisionCount = histories.reduce((sum, rows) => sum + rows.length, 0);
const sourceLosses = histories.filter((rows) => rows.some((row) => row.state !== 'REMOVED' && typeof row.exactContent !== 'string')).length;
const currentArtifacts = runtime.store.currentArtifacts(runtime.registry);
const staleCurrentArtifacts = currentArtifacts.filter((artifact) => runtime.registry.currentRevision(artifact.sourceId).id !== artifact.sourceRevisionId).length;
const currentIds = currentArtifacts.map((artifact) => artifact.id);
const duplicateCurrentArtifacts = currentIds.length - new Set(currentIds).size;
const authorityPromotions = currentArtifacts.filter((artifact) =>
  [ArtifactType.STRUCTURE, ArtifactType.CONTEXT_CHUNK, ArtifactType.CONCEPT, ArtifactType.COMMUNITY, ArtifactType.RETRIEVAL, ArtifactType.COMPACT].includes(artifact.artifactType)
  && artifact.authorityClass === AuthorityClass.SOURCE_CANON
).length;
const activeSessions = runtime.snapshot().sessions.length;
const dueAfterCompletion = runtime.studyStatus().due;
const removedSurfaced = runtime.publicSurface().artifacts.filter((artifact) => {
  const revision = runtime.registry.currentRevision(artifact.sourceId);
  return revision.state === 'REMOVED';
}).length;

assert.equal(sourceRevisionCount, SOURCE_COUNT + (SOURCE_COUNT * EDIT_ROUNDS) + 5);
assert.equal(sourceLosses, 0);
assert.equal(authorityPromotions, 0);
assert.equal(staleCurrentArtifacts, 0);
assert.equal(duplicateCurrentArtifacts, 0);
assert.equal(unrelatedFullRebuilds, 0);
assert.equal(activeSessions, 0);
assert.equal(dueAfterCompletion, 0);
assert.equal(removedSurfaced, 0);
assert.ok(resumedCheckpoints > 0);
assert.equal(duplicateSignals, SOURCE_COUNT * EDIT_ROUNDS);

const metrics = {
  pass: true,
  sources: SOURCE_COUNT,
  sourceRevisions: sourceRevisionCount,
  targetedEdits: SOURCE_COUNT * EDIT_ROUNDS,
  removals: 5,
  duplicateTriggersCoalesced: duplicateSignals,
  resumedCheckpoints,
  currentArtifacts: currentArtifacts.length,
  sourceLosses,
  unsupportedAuthorityPromotions: authorityPromotions,
  staleCurrentArtifacts,
  duplicateCurrentArtifactPublication: duplicateCurrentArtifacts,
  unrelatedFullRebuilds,
  activeCheckpointSessionsAfterCompletion: activeSessions,
  dueAfterCompletion,
  removedCurrentArtifacts: removedSurfaced,
};
console.log('LORE_WAVE1_STRESS ' + JSON.stringify(metrics));
