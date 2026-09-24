import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ArtifactType,
  AuthorityClass,
  RetrievalForm,
  StudyState,
  TemporalClass,
} from '../src/lore-contracts.js';
import {LoreSourceRegistry} from '../src/lore-source-registry.js';
import {LoreStudyRuntime} from '../src/lore-study-runtime.js';

function buildEmber() {
  const runtime = new LoreStudyRuntime();
  runtime.ingestLorebook({
    id: 'ember',
    title: 'Ember Tavern',
    fullSnapshot: true,
    entries: [
      {uid: 1, content: 'Mara, also called Emberkeeper, owns the Ember Tavern. Eris knows Mara.', metadata: {title: 'People and Tavern', treePath: ['World', 'Ember Tavern']}},
      {uid: 2, content: 'Eris carried the Sun Blade. Eris later left the Sun Blade at the Ember Tavern.', metadata: {title: 'Sun Blade History', treePath: ['World', 'Artifacts']}},
      {uid: 3, content: 'The Ember Tavern later burned.', metadata: {title: 'Tavern Fire', treePath: ['History']}},
      {uid: 4, content: 'The Sun Blade was destroyed in the Ember Tavern fire. A witness reports the Sun Blade was removed before the fire.', metadata: {title: 'Conflicting Blade Fate', treePath: ['History', 'Unresolved']}},
    ],
  });
  const results = runtime.runDue();
  assert.equal(results.every((row) => row.obligation.state === StudyState.COMPLETED), true);
  return runtime;
}

test('source registry preserves exact revisions, metadata, lineage, and removal history', () => {
  const registry = new LoreSourceRegistry();
  registry.registerLorebook({id: 'book', title: 'Book'});
  const first = registry.upsertEntry({lorebookId: 'book', uid: 63, content: 'Exact source A.', metadata: {title: 'Entry', treePath: ['A', 'B'], tags: ['x']}});
  const second = registry.upsertEntry({lorebookId: 'book', uid: 63, content: 'Exact source B.', metadata: {title: 'Entry', treePath: ['A', 'B'], tags: ['x']}});
  assert.equal(first.revision.id, 'lore:book:63@r1');
  assert.equal(second.revision.id, 'lore:book:63@r2');
  assert.equal(registry.getRevision(first.revision.id).exactContent, 'Exact source A.');
  assert.equal(registry.getRevision(second.revision.id).exactContent, 'Exact source B.');
  assert.deepEqual(registry.getRevision(second.revision.id).metadata.treePath, ['A', 'B']);
  assert.equal(registry.getRevision(first.revision.id).replacedByRevisionId, second.revision.id);
  const removed = registry.removeEntry({lorebookId: 'book', uid: 63});
  assert.equal(removed.revision.state, 'REMOVED');
  assert.equal(registry.revisionHistory('lore:book:63').length, 3);
  assert.equal(registry.getRevision(first.revision.id).exactContent, 'Exact source A.');
});

test('native study produces typed multi-resolution artifacts with exact provenance', () => {
  const runtime = buildEmber();
  const surface = runtime.publicSurface();
  const types = new Set(surface.artifacts.map((row) => row.artifactType));
  for (const type of [
    ArtifactType.STRUCTURE,
    ArtifactType.CONTEXT_CHUNK,
    ArtifactType.ENTITY,
    ArtifactType.ALIAS,
    ArtifactType.CLAIM,
    ArtifactType.RELATIONSHIP,
    ArtifactType.CONCEPT,
    ArtifactType.COMMUNITY,
    ArtifactType.RETRIEVAL,
    ArtifactType.COMPACT,
  ]) assert.ok(types.has(type), 'missing artifact type ' + type);

  for (const artifact of surface.artifacts) {
    assert.equal(artifact.sourceRevisionId, artifact.provenance.sourceRevisionId);
    assert.equal(artifact.freshness, 'CURRENT');
  }
  const source = surface.entries.find((row) => row.uid === '1');
  assert.equal(source.exactSource.content.startsWith('Mara, also called Emberkeeper'), true);
  assert.equal(source.exactSource.authorityClass, AuthorityClass.SOURCE_CANON);
});

test('Ember Tavern golden preserves entities, relationships, temporal meaning and bounded conflict', () => {
  const runtime = buildEmber();
  const surface = runtime.publicSurface();
  const entities = surface.artifacts.filter((row) => row.artifactType === ArtifactType.ENTITY).map((row) => row.payload.entityId);
  for (const id of ['entity:mara', 'entity:eris', 'entity:ember-tavern', 'entity:sun-blade']) assert.ok(entities.includes(id), 'missing ' + id);

  const owns = surface.artifacts.find((row) => row.artifactType === ArtifactType.RELATIONSHIP && row.payload.predicate === 'owns');
  assert.equal(owns.payload.subjectId, 'entity:mara');
  assert.equal(owns.payload.objectId, 'entity:ember-tavern');

  const knows = surface.artifacts.find((row) => row.artifactType === ArtifactType.RELATIONSHIP && row.payload.predicate === 'knows');
  assert.equal(knows.payload.subjectId, 'entity:eris');

  const tavernDestroyed = surface.artifacts.find((row) => row.artifactType === ArtifactType.CLAIM && row.payload.subjectId === 'entity:ember-tavern' && row.payload.predicate === 'state');
  assert.equal(tavernDestroyed.payload.value, 'destroyed');
  assert.equal(tavernDestroyed.temporalClass, TemporalClass.CURRENT);

  const fate = surface.artifacts.filter((row) => row.artifactType === ArtifactType.CLAIM && row.payload.subjectId === 'entity:sun-blade' && row.payload.predicate === 'fate');
  assert.equal(fate.length, 2);
  assert.ok(fate.some((row) => row.payload.value === 'destroyed-in-fire' && row.temporalClass === TemporalClass.HISTORICAL));
  assert.ok(fate.some((row) => row.payload.value === 'removed-before-fire' && row.unresolved));
  assert.equal(surface.conflicts.some((row) => row.slotKey === 'entity:sun-blade|fate' && row.status === 'UNRESOLVED'), true);
});

test('ontology and hierarchy are derived, provenance-backed, and do not rewrite Tree truth', () => {
  const runtime = buildEmber();
  const surface = runtime.publicSurface();
  const concepts = surface.artifacts.filter((row) => row.artifactType === ArtifactType.CONCEPT);
  assert.ok(concepts.some((row) => row.payload.entityId === 'entity:sun-blade' && row.payload.concept === 'weapon'));
  assert.ok(concepts.some((row) => row.payload.entityId === 'entity:ember-tavern' && row.payload.concept === 'tavern'));
  assert.ok(concepts.some((row) => row.payload.entityId === 'entity:mara' && row.payload.concept === 'proprietor'));
  assert.equal(concepts.every((row) => row.authorityClass !== AuthorityClass.SOURCE_CANON), true);
  const structure = surface.artifacts.find((row) => row.artifactType === ArtifactType.STRUCTURE && row.sourceId === 'lore:ember:1');
  assert.deepEqual(structure.payload.treePath, ['World', 'Ember Tavern']);
  assert.equal(structure.payload.truthAuthority, false);
});

test('retrieval forms are source-revision drillable and never grant rank or embedding authority', () => {
  const runtime = buildEmber();
  const surface = runtime.publicSurface();
  for (const entry of surface.entries.filter((row) => row.sourceState !== 'REMOVED')) {
    const forms = new Set(entry.retrievalRepresentations.map((row) => row.representation.form));
    assert.ok(forms.has(RetrievalForm.CONTEXTUAL_SPARSE));
    assert.ok(forms.has(RetrievalForm.DENSE_READY));
    assert.ok(forms.has(RetrievalForm.PRECISION_READY));
    assert.ok(forms.has(RetrievalForm.COMPACT_LEARNED));
    assert.equal(entry.retrievalRepresentations.every((row) => row.sourceRevisionId === entry.sourceRevisionId), true);
    assert.equal(entry.retrievalRepresentations.every((row) => row.authorityClass !== AuthorityClass.SOURCE_CANON), true);
    assert.equal(entry.retrievalRepresentations.every((row) => row.retrievalScoreAuthority === false), true);
  }
});

test('targeted edit relearns only its dependency cone and preserves unrelated learned identity', () => {
  const runtime = buildEmber();
  const unrelatedSource = 'lore:ember:1';
  const editedSource = 'lore:ember:2';
  const unrelatedBefore = runtime.store.currentLearnedRevision(unrelatedSource).id;
  const editedBefore = runtime.store.currentLearnedRevision(editedSource);
  const oldRevision = runtime.registry.currentRevision(editedSource);

  const update = runtime.upsertEntry({
    lorebookId: 'ember',
    uid: 2,
    content: 'Eris carries the Sun Blade. Eris later left the Sun Blade at the Ember Tavern.',
    metadata: {title: 'Sun Blade History', treePath: ['World', 'Artifacts']},
  });
  assert.equal(update.changed, true);
  assert.equal(runtime.store.currentLearnedRevision(editedSource).id, editedBefore.id);
  const preCommitEntry = runtime.publicSurface().entries.find((row) => row.sourceId === editedSource);
  assert.equal(preCommitEntry.freshness, 'STALE_OR_UNLEARNED');
  assert.deepEqual(preCommitEntry.artifactIds, []);

  const result = runtime.run(update.obligation.id);
  assert.equal(result.obligation.state, StudyState.COMPLETED);
  assert.ok(result.impactPreview.affectedArtifactIds.length > 0);
  assert.ok(result.impactPreview.unrelatedReusableArtifactCount > 0);
  assert.equal(runtime.store.currentLearnedRevision(unrelatedSource).id, unrelatedBefore);
  assert.equal(runtime.registry.getRevision(oldRevision.id).exactContent, 'Eris carried the Sun Blade. Eris later left the Sun Blade at the Ember Tavern.');
  assert.equal(runtime.registry.currentRevision(editedSource).id.endsWith('@r2'), true);
  assert.equal(result.semanticDiff.temporalMeaningChanged, true);
  const post = runtime.publicSurface().entries.find((row) => row.sourceId === editedSource);
  assert.equal(post.freshness, 'CURRENT');
  assert.equal(post.retrievalRepresentations.every((row) => row.sourceRevisionId.endsWith('@r2')), true);
});

test('removed UID preserves history but cannot surface as active retrieval lore', () => {
  const runtime = buildEmber();
  const sourceId = 'lore:ember:3';
  const oldLearned = runtime.store.currentLearnedRevision(sourceId);
  const oldRevision = runtime.registry.currentRevision(sourceId);
  const removal = runtime.removeEntry({lorebookId: 'ember', uid: 3});
  const beforeCommit = runtime.publicSurface().entries.find((row) => row.sourceId === sourceId);
  assert.equal(beforeCommit.sourceState, 'REMOVED');
  assert.equal(beforeCommit.exactSource, null);
  assert.deepEqual(beforeCommit.artifactIds, []);
  const result = runtime.run(removal.obligation.id);
  assert.equal(result.learnedRevision.state, 'REMOVED');
  assert.equal(runtime.registry.getRevision(oldRevision.id).exactContent, 'The Ember Tavern later burned.');
  assert.ok(runtime.store.learnedHistory(sourceId).some((row) => row.id === oldLearned.id && row.state === 'HISTORICAL'));
  assert.equal(runtime.publicSurface().artifacts.some((row) => row.sourceId === sourceId), false);
});

test('lifecycle coalesces duplicate triggers and newer revisions supersede old uncommitted work', () => {
  const runtime = new LoreStudyRuntime();
  runtime.registerLorebook({id: 'life'});
  const first = runtime.upsertEntry({lorebookId: 'life', uid: 1, content: 'Aster owns the Moon Tavern.'});
  const same = runtime.upsertEntry({lorebookId: 'life', uid: 1, content: 'Aster owns the Moon Tavern.'});
  assert.equal(same.changed, false);
  assert.equal(same.obligation.id, first.obligation.id);
  const partial = runtime.run(first.obligation.id, {maxUnits: 2});
  assert.equal(partial.checkpointed, true);
  const second = runtime.upsertEntry({lorebookId: 'life', uid: 1, content: 'Aster owns the Star Tavern.'});
  assert.equal(runtime.findObligation(first.revision.id).state, StudyState.SUPERSEDED);
  assert.equal(runtime.run(first.obligation.id).learnedRevision, null);
  assert.equal(runtime.run(second.obligation.id).obligation.state, StudyState.COMPLETED);
  assert.equal(runtime.store.learnedHistory('lore:life:1').length, 1);
});

test('checkpoint snapshot resumes from next unit with one atomic publication', () => {
  let runtime = new LoreStudyRuntime();
  runtime.registerLorebook({id: 'resume'});
  const added = runtime.upsertEntry({
    lorebookId: 'resume',
    uid: 1,
    content: 'Mara owns the Ember Tavern. Eris knows Mara. Eris carried the Sun Blade. Eris later left the Sun Blade at the Ember Tavern.',
  });
  const partial = runtime.run(added.obligation.id, {maxUnits: 3});
  assert.equal(partial.checkpointed, true);
  assert.equal(runtime.store.currentLearnedRevision('lore:resume:1'), null);
  const checkpointIndex = partial.obligation.checkpoint.unitIndex;
  runtime = LoreStudyRuntime.fromSnapshot(runtime.snapshot());
  const resumed = runtime.run(added.obligation.id, {maxUnits: 99});
  assert.equal(resumed.obligation.state, StudyState.COMPLETED);
  assert.equal(resumed.obligation.checkpoint.atomicPublication, true);
  assert.ok(resumed.obligation.checkpoint.unitIndex > checkpointIndex);
  assert.equal(runtime.store.learnedHistory('lore:resume:1').length, 1);
  assert.equal(runtime.snapshot().sessions.length, 0);
});

test('generation-pressure pause preserves study due truth', () => {
  const runtime = new LoreStudyRuntime();
  runtime.registerLorebook({id: 'pause'});
  const added = runtime.upsertEntry({lorebookId: 'pause', uid: 1, content: 'Mara owns the Ember Tavern.'});
  runtime.begin(added.obligation.id);
  const paused = runtime.pause(added.obligation.id);
  assert.equal(paused.state, StudyState.CHECKPOINTED);
  assert.equal(runtime.studyStatus().due, 1);
  assert.equal(runtime.studyStatus().runtimeSchedulingAuthority, false);
});

test('ambiguous/incomplete source stays unresolved instead of fabricating relationships', () => {
  const runtime = new LoreStudyRuntime();
  runtime.registerLorebook({id: 'amb'});
  const added = runtime.upsertEntry({lorebookId: 'amb', uid: 1, content: 'Perhaps the Sun Blade vanished somewhere. This fragment could mean several things.'});
  const result = runtime.run(added.obligation.id);
  assert.ok(result.warnings.length >= 1);
  const artifacts = runtime.store.currentArtifacts(runtime.registry);
  assert.equal(artifacts.some((row) => row.artifactType === ArtifactType.RELATIONSHIP), false);
  assert.equal(artifacts.filter((row) => row.artifactType === ArtifactType.RETRIEVAL).every((row) => row.authorityClass !== AuthorityClass.SOURCE_CANON), true);
});

test('public integration surface is read-only in authority terms and keeps unresolved state visible', () => {
  const runtime = buildEmber();
  const surface = runtime.publicSurface();
  assert.equal(surface.contractVersion, 1);
  assert.equal(surface.candidateBusAuthority, false);
  assert.equal(surface.truthGateAuthority, false);
  assert.equal(surface.precisionAuthority, false);
  assert.equal(surface.gatherSealAuthority, false);
  assert.equal(surface.settlementAuthority, false);
  assert.ok(surface.conflicts.length >= 1);
  assert.ok(surface.artifacts.every((row) => row.sourceRevisionId && row.provenance && row.authorityClass));
});

test('artifact production is bounded for oversized source input', () => {
  const runtime = new LoreStudyRuntime();
  runtime.registerLorebook({id: 'bound'});
  const content = Array.from({length: 180}, (_, i) => 'Keeper' + i + ' owns the Tavern' + i + '.').join(' ');
  const added = runtime.upsertEntry({lorebookId: 'bound', uid: 1, content});
  runtime.run(added.obligation.id);
  const artifacts = runtime.store.currentArtifacts(runtime.registry);
  assert.ok(artifacts.filter((row) => row.artifactType === ArtifactType.CONTEXT_CHUNK).length <= 24);
  assert.ok(artifacts.filter((row) => row.artifactType === ArtifactType.ENTITY).length <= 96);
  assert.ok(artifacts.filter((row) => row.artifactType === ArtifactType.CLAIM).length <= 192);
});
