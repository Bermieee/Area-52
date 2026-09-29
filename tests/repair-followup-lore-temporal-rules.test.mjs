// Follow-up (audit D7): owner-approved Lore temporal/conflict rules R1-R4 (+E1 event identity).
// R1 attribution modes, R2 validated time coordinates, R3 supersession only on matching identity/property/time,
// R4 conflicts only for the same single-valued property with provably overlapping applicability. MOCK-HARNESS evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LoreStudyRuntime } from '../src/lore-study-runtime.js';
import { ArtifactType } from '../src/lore-contracts.js';
import { parseAttribution, analyzeClause, readSourceTime, compareTimes, sameEvent, buildEventIdentity } from '../src/lore-temporal-rules.js';

function world(entries, { id = 'book' } = {}) {
  const rt = new LoreStudyRuntime();
  rt.ingestLorebook({ id, title: id, fullSnapshot: true, entries: entries.map(([uid, content, metadata = {}]) => ({ uid, content, metadata })) });
  rt.runDue();
  const claims = rt.store.currentArtifacts(rt.registry, { types: [ArtifactType.CLAIM] });
  return { rt, claims, res: rt.store.temporalResolution(rt.registry), by: (uid) => claims.filter((c) => c.sourceId.endsWith(':' + uid)) };
}

test('R1: observation, hearsay and speculation are distinguished; speaker and source are kept; only the last two are unresolved', () => {
  const { by } = world([
    ['seen', 'Eris witnessed the Sun Blade destroyed in the fire.', { at: 5 }],
    ['heard', 'The innkeeper says the Sun Blade was removed before the fire.', { at: 6 }],
    ['guess', 'Mara suspects the Sun Blade survived the fire.', { at: 7 }],
    ['plain', 'The Sun Blade is destroyed in the fire.', { at: 8 }],
  ]);
  const seen = by('seen'), heard = by('heard'), guess = by('guess'), plain = by('plain');
  assert.equal(seen[0].payload.attribution.mode, 'OBSERVATION');
  assert.equal(seen[0].payload.attribution.speaker, 'Eris');
  assert.equal(seen[0].unresolved, false, 'a direct observation is a source-attested claim, not an uncertain one');
  assert.equal(heard[0].payload.attribution.mode, 'HEARSAY');
  assert.equal(heard[0].payload.attribution.speaker, 'innkeeper');
  assert.equal(heard[0].payload.attribution.reportedBy, heard[0].sourceId);
  assert.equal(heard[0].unresolved, true);
  assert.equal(guess[0].payload.attribution.mode, 'SPECULATION');
  assert.equal(guess[0].unresolved, true);
  assert.equal(plain[0].payload.attribution, null);
  assert.equal(plain[0].unresolved, false);
});

test('R1: a report is not extracted from text the grammar does not understand (no invented claim)', () => {
  const { claims } = world([['x', 'A journal claims the moon smiled at the harbor.', { at: 1 }]]);
  assert.equal(claims.filter((c) => c.payload.attribution).length, 0);
  assert.equal(parseAttribution('Mara laughed.'), null);
  assert.equal(analyzeClause('the moon smiled at the harbor'), null);
});

test('R2: at/claimAt are validated coordinates; missing, malformed or incompatible times stay unknown', () => {
  assert.deepEqual(readSourceTime({ at: 4 }, { lorebookId: 'b' }).at, { value: 4, timeline: 'b', unit: 'ORDER' });
  assert.deepEqual(readSourceTime({ at: '7' }, { lorebookId: 'b' }).at.value, 7);
  for (const bad of [1.5, 'soon', NaN, Infinity, {}, [], true]) {
    const t = readSourceTime({ at: bad }, { lorebookId: 'b' });
    assert.equal(t.at, null, String(bad));
    assert.ok(t.problems.includes('AT_INVALID'), String(bad));
  }
  assert.equal(readSourceTime({}, { lorebookId: 'b' }).at, null);
  assert.equal(readSourceTime({ at: 3, timeUnit: '??' }, { lorebookId: 'b' }).at, null);
  const a = readSourceTime({ at: 1 }, { lorebookId: 'one' }).at, b = readSourceTime({ at: 2 }, { lorebookId: 'two' }).at;
  assert.equal(compareTimes(a, b), 'UNKNOWN', 'different timelines never compare');
  const c = readSourceTime({ at: 2, timeUnit: 'DAY' }, { lorebookId: 'one' }).at;
  assert.equal(compareTimes(a, c), 'UNKNOWN', 'different units never compare');
  assert.equal(compareTimes(a, null), 'UNKNOWN');
});

test('R3: a later same-entity same-property same-timeline state supersedes the earlier one', () => {
  const { res, by } = world([
    ['before', 'The Ember Tavern is intact.', { at: 3 }],
    ['fire', 'The Ember Tavern burns down.', { at: 10 }],
  ]);
  assert.equal(res.superseded.has(by('before')[0].id), true);
  assert.equal(res.superseded.has(by('fire')[0].id), false);
  assert.equal(res.conflicts.length, 0, 'change over time is not a contradiction');
});

test('R3: no supersession without matching identity, property, timeline or known time; a report never settles', () => {
  const noTime = world([['a', 'The Ember Tavern is intact.'], ['b', 'The Ember Tavern burns down.', { at: 10 }]]);
  assert.equal(noTime.res.superseded.size, 0, 'a missing time stays unknown');
  const badTime = world([['a', 'The Ember Tavern is intact.', { at: 'soon' }], ['b', 'The Ember Tavern burns down.', { at: 10 }]]);
  assert.equal(badTime.res.superseded.size, 0);
  const otherEntity = world([['a', 'The Ember Tavern is intact.', { at: 3 }], ['b', 'The Silver Inn burns down.', { at: 10 }]]);
  assert.equal(otherEntity.res.superseded.size, 0);
  const hearsay = world([['a', 'The Ember Tavern is intact.', { at: 3 }], ['b', 'A traveler reports the Ember Tavern burns down.', { at: 10 }]]);
  assert.equal(hearsay.res.superseded.size, 0, 'a reported destruction does not settle the earlier state');
  const twoBooks = new LoreStudyRuntime();
  twoBooks.ingestLorebook({ id: 'one', entries: [{ uid: 'a', content: 'The Ember Tavern is intact.', metadata: { at: 3 } }] });
  twoBooks.ingestLorebook({ id: 'two', entries: [{ uid: 'b', content: 'The Ember Tavern burns down.', metadata: { at: 10 } }] });
  twoBooks.runDue();
  assert.equal(twoBooks.store.temporalResolution(twoBooks.registry).superseded.size, 0, 'different timelines are not comparable');
});

test('R4: differing values conflict only for the same single-valued property with provably overlapping applicability', () => {
  const same = world([
    ['a', 'The Sun Blade is destroyed in the fire.', { at: 10 }],
    ['b', 'A journal claims the Sun Blade survived the fire.', { at: 12, claimAt: 9 }],
  ]);
  assert.equal(same.res.conflicts.length, 1);
  assert.equal(same.res.conflicts[0].property, 'fate');
  assert.deepEqual(same.res.conflicts[0].values.map((v) => v.attribution).sort(), ['ASSERTED', 'HEARSAY']);
  const otherEvent = world([
    ['a', 'The Sun Blade is destroyed in the fire.', { at: 10 }],
    ['b', 'A journal claims the Sun Blade survived the flood.', { at: 12 }],
  ]);
  assert.equal(otherEvent.res.conflicts.length, 0, 'unrelated events (no shared head noun) are neither a conflict nor a possible one');
  const otherSubject = world([
    ['a', 'The Sun Blade is destroyed in the fire.', { at: 10 }],
    ['b', 'A journal claims the Moon Blade survived the fire.', { at: 12 }],
  ]);
  assert.equal(otherSubject.res.conflicts.length, 0);
  const sameValue = world([
    ['a', 'The Sun Blade is destroyed in the fire.', { at: 10 }],
    ['b', 'A journal claims the Sun Blade is destroyed in the fire.', { at: 12 }],
  ]);
  assert.equal(sameValue.res.conflicts.length, 0, 'agreeing values are not a conflict');
  const simultaneous = world([
    ['a', 'The Ember Tavern is intact.', { at: 3 }],
    ['b', 'The Ember Tavern burns down.', { at: 3 }],
  ]);
  assert.equal(simultaneous.res.conflicts.length, 1, 'two non-reported states at the same time on one timeline do conflict');
});

test('E1: event identity needs equal names or alias evidence; a missing or different modifier is uncertainty, not proof either way', () => {
  const same = buildEventIdentity([]);
  assert.equal(same('fire', 'fire'), 'SAME');
  assert.equal(same('fire', 'ember-tavern-fire'), 'POSSIBLE', 'missing modifier: uncertain');
  assert.equal(same('ember-tavern-fire', 'river-district-fire'), 'POSSIBLE', 'different modifiers do not prove different events');
  assert.equal(same('fire', 'flood'), 'NONE');
  const evidence = [{ payload: { entityId: 'entity:e1', canonicalName: 'Ember Tavern fire', aliases: ['Ember Tavern fire', 'the fire'] } }];
  assert.equal(buildEventIdentity(evidence)('fire', 'ember-tavern-fire'), 'SAME', 'alias evidence establishes identity');
  const ambiguous = [...evidence, { payload: { entityId: 'entity:e2', canonicalName: 'Harbor fire', aliases: ['Harbor fire', 'the fire'] } }];
  assert.equal(buildEventIdentity(ambiguous)('fire', 'ember-tavern-fire'), 'POSSIBLE', 'an alias shared by two entities is not evidence');
  assert.equal(sameEvent('fire', 'fire'), true);
  assert.equal(sameEvent('fire', 'ember-tavern-fire'), false);
});

test('a study made by an older engine revision is re-studied, and only then', () => {
  const rt = new LoreStudyRuntime();
  rt.ingestLorebook({ id: 'b', entries: [{ uid: 'a', content: 'The Ember Tavern is intact.', metadata: { at: 1 } }] });
  rt.runDue();
  assert.deepEqual(rt.enqueueEngineRefresh(), [], 'current engine: nothing to refresh');
  for (const learned of rt.store.learnedRevisions.values()) learned.engineRevision = 'old-engine';
  const queued = rt.enqueueEngineRefresh();
  assert.equal(queued.length, 1);
  assert.deepEqual(rt.enqueueEngineRefresh(), [], 'idempotent while queued');
  rt.runDue();
  assert.deepEqual(rt.enqueueEngineRefresh(), []);
  const claims = rt.store.currentArtifacts(rt.registry, { types: [ArtifactType.CLAIM] });
  assert.ok(claims[0].payload.applicability, 'claims carry the new evidence after the refresh');
});

test('scope: unrelated stories never supersede or conflict with each other; books read together may', () => {
  const rt = new LoreStudyRuntime();
  rt.ingestLorebook({ id: 'storyA', entries: [{ uid: 'a1', content: 'The Sun Blade is destroyed in the fire.', metadata: { at: 10 } }, { uid: 'a2', content: 'The Ember Tavern is intact.', metadata: { at: 1, timeline: 'shared' } }] });
  rt.ingestLorebook({ id: 'storyB', entries: [{ uid: 'b1', content: 'A journal claims the Sun Blade survived the fire.', metadata: { at: 12 } }, { uid: 'b2', content: 'The Ember Tavern burns down.', metadata: { at: 5, timeline: 'shared' } }] });
  rt.runDue();
  assert.equal(rt.store.temporalResolution(rt.registry).conflicts.length, 0, 'default scope is one lorebook: same names in other stories do not interact');
  assert.equal(rt.store.temporalResolution(rt.registry).superseded.size, 0);
  rt.store.setBookGroupsProvider(() => [['storyA', 'storyB']]);
  const joined = rt.store.temporalResolution(rt.registry);
  assert.equal(joined.conflicts.length, 1, 'books read together are compared');
  assert.equal(joined.conflicts[0].certainty, 'POSSIBLE', 'but different timelines do not establish shared continuity');
  assert.equal(joined.superseded.size, 1, 'supersession still needs the explicitly shared timeline');
  rt.store.setBookGroupsProvider(() => [['storyA', 'other']]);
  assert.equal(rt.store.temporalResolution(rt.registry).conflicts.length, 0);
});
