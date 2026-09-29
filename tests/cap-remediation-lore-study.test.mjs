// Cap remediation, cap ledger rows 1-5 (owner handoff AREA52_CAP_REMEDIATION_ARCHITECTURE_HANDOFF.md, "Lore Study").
// Contract: the Lore Study engine bounds the work per step (STUDY_SLICE_LIMITS), never the knowledge per source. Every
// sentence is chunked and analyzed; every entity, claim and relationship row is finalized; a coverage receipt proves it
// before the atomic publication. Slices are fenced on the source revision, survive a snapshot/restore, and a session
// staged by another engine revision is restarted rather than resumed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LoreStudyRuntime } from '../src/lore-study-runtime.js';
import { LoreStudyEngine, STUDY_SLICE_LIMITS, STUDY_ENGINE_REVISION } from '../src/lore-study-engine.js';
import { ArtifactType } from '../src/lore-contracts.js';

const sentence = (i) => `Keeper${i} owns the Tavern${i}.`;
const source = (n) => Array.from({ length: n }, (_, i) => sentence(i)).join(' ');

function studyInSteps(runtime, obligationId, guard = 5000) {
  let result, steps = 0;
  do { result = runtime.run(obligationId, { maxUnits: 1 }); steps += 1; } while (result.checkpointed && !result.failed && steps < guard);
  return { result, steps };
}
function fresh(n) {
  const runtime = new LoreStudyRuntime();
  runtime.registerLorebook({ id: 'book' });
  const added = runtime.upsertEntry({ lorebookId: 'book', uid: 1, content: source(n) });
  return { runtime, obligationId: added.obligation.id, sourceId: added.obligation.sourceId };
}
const byType = (artifacts, type) => artifacts.filter((row) => row.artifactType === type);

for (const n of [STUDY_SLICE_LIMITS.sentencesPerSlice - 1, STUDY_SLICE_LIMITS.sentencesPerSlice, STUDY_SLICE_LIMITS.sentencesPerSlice + 1, 2 * STUDY_SLICE_LIMITS.sentencesPerSlice, 1000]) {
  test(`a ${n}-sentence source is fully covered in bounded slices`, () => {
    const { runtime, obligationId, sourceId } = fresh(n);
    const { result, steps } = studyInSteps(runtime, obligationId);
    assert.ok(result.learnedRevision, 'published');
    const artifacts = runtime.store.currentArtifacts(runtime.registry).filter((row) => row.sourceId === sourceId);
    // Complete coverage.
    const chunks = byType(artifacts, ArtifactType.CONTEXT_CHUNK);
    assert.equal(chunks.length, Math.ceil(n / 2));
    assert.deepEqual(chunks.flatMap((row) => row.payload.sentenceIndexes).sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i));
    const names = new Set(byType(artifacts, ArtifactType.ENTITY).map((row) => row.payload.canonicalName));
    for (const i of [0, n - 1, Math.floor(n / 2)]) assert.ok(names.has('Keeper' + i) && names.has('Tavern' + i), 'entities of sentence ' + i);
    const claimSentences = new Set(byType(artifacts, ArtifactType.CLAIM).map((row) => row.provenance.span?.sentenceIndex));
    assert.equal(claimSentences.size, n, 'every sentence contributes its claim');
    const coverage = result.learnedRevision.validation.coverage;
    assert.equal(coverage.coverageComplete, true);
    assert.equal(coverage.sentenceCount, n);
    assert.equal(coverage.canonicalKnowledgeDropped, false);
    // Bounded work: no step processed more than its slice limit.
    assert.ok(steps >= 7 + Math.ceil(n / STUDY_SLICE_LIMITS.sentencesPerSlice) - 1, 'analysis took one step per slice (' + steps + ' steps)');
  });
}

test('every step stays within its slice limit and units repeat until covered', () => {
  const engine = new LoreStudyEngine();
  const n = 700;
  let session = engine.createSession({ source: { sourceId: 's', lorebookId: 'book', uid: 1 }, revision: { id: 'r1', exactContent: source(n), metadata: {} } });
  let guard = 0;
  while (!session.complete && guard++ < 5000) session = engine.step(session);
  assert.equal(session.complete, true);
  assert.equal(session.valid, true);
  const cap = { CHUNK: STUDY_SLICE_LIMITS.chunksPerSlice * 2, ANALYZE: STUDY_SLICE_LIMITS.sentencesPerSlice, FINALIZE: STUDY_SLICE_LIMITS.entitiesPerSlice, CLAIMS: STUDY_SLICE_LIMITS.claimRowsPerSlice, RELATIONSHIPS: STUDY_SLICE_LIMITS.relationshipRowsPerSlice };
  const sliced = session.workspace.unitReceipts.filter((row) => row.slice);
  assert.ok(sliced.length > 20);
  for (const row of sliced) assert.ok(row.slice.to - row.slice.from <= cap[row.slice.phase], JSON.stringify(row.slice));
  // Contiguous coverage per phase: slices tile [0, total) without gaps or overlaps.
  for (const phase of Object.keys(cap)) {
    const rows = sliced.filter((row) => row.slice.phase === phase);
    rows.forEach((row, i) => assert.equal(row.slice.from, i === 0 ? 0 : rows[i - 1].slice.to, phase + ' slice ' + i));
  }
  assert.equal(sliced.filter((row) => row.slice.phase === 'ANALYZE').at(-1).slice.to, n);
});

test('a source edit between slices supersedes the study; nothing partial is published', () => {
  const { runtime, obligationId, sourceId } = fresh(400);
  for (let i = 0; i < 4; i += 1) assert.equal(runtime.run(obligationId, { maxUnits: 1 }).checkpointed, true);
  assert.equal(runtime.store.currentLearnedRevision(sourceId), null, 'no partial publication');
  const edited = runtime.upsertEntry({ lorebookId: 'book', uid: 1, content: source(10) });
  const stale = runtime.run(obligationId, { maxUnits: 1 });
  assert.equal(stale.obligation.state, 'SUPERSEDED');
  assert.equal(stale.learnedRevision, null);
  assert.equal(runtime.store.currentLearnedRevision(sourceId), null, 'the stale continuation published nothing');
  const { result } = studyInSteps(runtime, edited.obligation.id);
  assert.equal(result.learnedRevision.validation.coverage.sentenceCount, 10, 'the new revision is studied, not the old remainder');
});

test('snapshot and restore mid-study resumes from the checkpoint and gives the same result as an uninterrupted study', () => {
  const straight = fresh(300);
  studyInSteps(straight.runtime, straight.obligationId);
  const expected = straight.runtime.store.currentArtifacts(straight.runtime.registry).map((row) => row.id).sort();

  const interrupted = fresh(300);
  for (let i = 0; i < 6; i += 1) interrupted.runtime.run(interrupted.obligationId, { maxUnits: 1 });
  const restored = LoreStudyRuntime.fromSnapshot(JSON.parse(JSON.stringify(interrupted.runtime.snapshot())));
  const session = [...restored.sessions.values()][0];
  assert.ok(session && session.unitIndex + session.cursor.offset > 0, 'resumed from a checkpoint, not from zero');
  const { result } = studyInSteps(restored, interrupted.obligationId);
  assert.equal(result.learnedRevision.validation.coverage.coverageComplete, true);
  assert.deepEqual(restored.store.currentArtifacts(restored.registry).map((row) => row.id).sort(), expected);
});

test('a session staged by another engine revision is restarted, not resumed', () => {
  const { runtime, obligationId } = fresh(300);
  for (let i = 0; i < 3; i += 1) runtime.run(obligationId, { maxUnits: 1 });
  const snapshot = JSON.parse(JSON.stringify(runtime.snapshot()));
  for (const [, session] of snapshot.sessions) session.engineRevision = 'lore-study-engine-v2+old';
  const restored = LoreStudyRuntime.fromSnapshot(snapshot);
  assert.equal(restored.sessions.size, 0, 'old-engine session dropped');
  const { result } = studyInSteps(restored, obligationId);
  assert.equal(result.learnedRevision.validation.coverage.coverageComplete, true);
  assert.equal(result.learnedRevision.engineRevision ?? STUDY_ENGINE_REVISION, STUDY_ENGINE_REVISION);
});

test('a sentence with more than eight name candidates keeps all of them', () => {
  const { runtime, obligationId, sourceId } = fresh(0);
  const names = ['Arden', 'Brisa', 'Corvin', 'Delma', 'Evran', 'Fennick', 'Galen', 'Hester', 'Ismay', 'Jorvald'];
  runtime.upsertEntry({ lorebookId: 'book', uid: 1, content: `${names.join(', ')} gathered at dusk.` });
  const due = runtime.dueObligations().at(-1) ?? { id: obligationId };
  studyInSteps(runtime, due.id);
  const entityNames = new Set(byType(runtime.store.currentArtifacts(runtime.registry).filter((row) => row.sourceId === sourceId), ArtifactType.ENTITY).map((row) => row.payload.canonicalName));
  for (const name of names) assert.ok(entityNames.has(name), name);
});
