// Follow-up (audit D7): the temporal/conflict rules are generic. Every behavior below runs on TWO unrelated stories (a tavern
// fire and a space-station blackout) built from the same templates; names live only in these fixtures, never in production.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LoreStudyRuntime } from '../src/lore-study-runtime.js';
import { ArtifactType } from '../src/lore-contracts.js';
import { resolveLoreTemporal } from '../src/lore-temporal-rules.js';

const WORLDS = [
  { name: 'tavern', place: 'Ember Tavern', item: 'Sun Blade', event: 'fire', longEvent: 'Ember Tavern fire', speaker: 'journal', witness: 'Mara' },
  { name: 'station', place: 'Meridian Reactor', item: 'Cargo Pod', event: 'blackout', longEvent: 'Great Blackout', speaker: 'dockhand', witness: 'Captain Reyes' },
];
const at = (n, extra = {}) => ({ at: n, ...extra });
const entriesFor = (w, { alias = false, meta = {} } = {}) => [
  ['before', `The ${w.place} is intact.`, at(3, meta)],
  ['after', `The ${w.place} is destroyed.`, at(10, meta)],
  ['asserted', `The ${w.item} was destroyed during the ${w.event}.`, at(10, meta)],
  ['hearsay', `A ${w.speaker} says the ${w.item} was stolen before the ${w.event}.`, at(12, { claimAt: 9, ...meta })],
  ['observed', `${w.witness} saw the ${w.item} survived the ${w.event}.`, at(13, meta)],
  ...(alias ? [['alias', `The ${w.longEvent}, also called the ${w.event}.`, at(11, meta)]] : []),
];
function build(entries, { book = 'book', groups = null } = {}) {
  const rt = new LoreStudyRuntime();
  rt.ingestLorebook({ id: book, fullSnapshot: true, entries: entries.map(([uid, content, metadata]) => ({ uid, content, metadata })) });
  if (groups) rt.store.setBookGroupsProvider(() => groups);
  rt.runDue();
  return rt;
}
const claimsOf = (rt) => rt.store.currentArtifacts(rt.registry, { types: [ArtifactType.CLAIM] });
const byUid = (rt, uid) => claimsOf(rt).filter((c) => c.sourceId.endsWith(':' + uid));

for (const w of WORLDS) {
  test(`[${w.name}] R1: observation, hearsay and asserted claims are distinguished with their speaker`, () => {
    const rt = build(entriesFor(w));
    const observed = byUid(rt, 'observed')[0], hearsay = byUid(rt, 'hearsay')[0], asserted = byUid(rt, 'asserted')[0];
    assert.equal(observed.payload.attribution.mode, 'OBSERVATION');
    assert.equal(observed.payload.attribution.speaker, w.witness);
    assert.equal(observed.unresolved, false);
    assert.equal(hearsay.payload.attribution.mode, 'HEARSAY');
    assert.equal(hearsay.payload.attribution.speaker, w.speaker);
    assert.equal(hearsay.unresolved, true);
    assert.equal(asserted.payload.attribution, null);
    assert.equal(asserted.unresolved, false);
  });

  test(`[${w.name}] R3: the later state supersedes the earlier; a hearsay claim, other continuity or unknown time never does`, () => {
    const rt = build(entriesFor(w));
    const res = rt.store.temporalResolution(rt.registry);
    assert.equal(res.superseded.has(byUid(rt, 'before')[0].id), true);
    assert.equal(res.superseded.has(byUid(rt, 'after')[0].id), false);
    const hearsayOnly = build([['a', `The ${w.place} is intact.`, at(3)], ['b', `A ${w.speaker} says the ${w.place} is destroyed.`, at(9)]]);
    assert.equal(hearsayOnly.store.temporalResolution(hearsayOnly.registry).superseded.size, 0);
    const noTime = build([['a', `The ${w.place} is intact.`, {}], ['b', `The ${w.place} is destroyed.`, at(9)]]);
    assert.equal(noTime.store.temporalResolution(noTime.registry).superseded.size, 0);
    const otherVersion = build([['a', `The ${w.place} is intact.`, at(3, { version: 'draft' })], ['b', `The ${w.place} is destroyed.`, at(9, { version: 'final' })]]);
    assert.equal(otherVersion.store.temporalResolution(otherVersion.registry).superseded.size, 0, 'a different version is a different continuity');
  });

  test(`[${w.name}] R4: compatible claims are not a conflict; only the incompatible ones form the set, with their alternatives`, () => {
    const rt = build(entriesFor(w));
    const res = rt.store.temporalResolution(rt.registry);
    const fate = res.conflicts.filter((c) => c.property === 'fate' && c.certainty === 'ESTABLISHED');
    assert.equal(fate.length, 1);
    const set = fate[0];
    const idOf = (uid) => byUid(rt, uid)[0].id;
    assert.deepEqual(set.artifactIds, [idOf('asserted'), idOf('hearsay'), idOf('observed')].sort());
    // stolen-before and survived can both hold: one alternative; destroyed is the other.
    assert.equal(set.alternatives.length, 2);
    assert.ok(set.alternatives.some((alt) => alt.length === 2 && alt.includes(idOf('hearsay')) && alt.includes(idOf('observed'))));
    assert.ok(set.alternatives.some((alt) => alt.length === 1 && alt[0] === idOf('asserted')));
    const pairKeys = set.incompatiblePairs.map((p) => [p.a, p.b].sort().join('|'));
    assert.equal(pairKeys.includes([idOf('hearsay'), idOf('observed')].sort().join('|')), false, 'the compatible pair is not listed as incompatible');
    assert.equal(res.compatiblePairs >= 1, true);
    const compatibleOnly = build([['a', `A ${w.speaker} says the ${w.item} was stolen before the ${w.event}.`, at(5)], ['b', `${w.witness} saw the ${w.item} survived the ${w.event}.`, at(6)]]);
    assert.equal(compatibleOnly.store.temporalResolution(compatibleOnly.registry).conflicts.length, 0);
  });

  test(`[${w.name}] E1: a differently worded event is POSSIBLE until alias evidence establishes identity`, () => {
    const noAlias = build([
      ['a', `The ${w.item} was destroyed during the ${w.longEvent}.`, at(10)],
      ['b', `A ${w.speaker} says the ${w.item} survived the ${w.event}.`, at(12)],
    ]);
    const possible = noAlias.store.temporalResolution(noAlias.registry).conflicts;
    assert.equal(possible.length, 1);
    assert.equal(possible[0].certainty, 'POSSIBLE');
    assert.match(possible[0].basis, /EVENT_IDENTITY_UNSUPPORTED/);
    const withAlias = build([
      ['a', `The ${w.item} was destroyed during the ${w.longEvent}.`, at(10)],
      ['b', `A ${w.speaker} says the ${w.item} survived the ${w.event}.`, at(12)],
      ['c', `The ${w.longEvent}, also called the ${w.event}.`, at(11)],
    ]);
    const established = withAlias.store.temporalResolution(withAlias.registry).conflicts;
    assert.equal(established.length, 1);
    assert.equal(established[0].certainty, 'ESTABLISHED');
  });

  test(`[${w.name}] scope: shared read access compares, but only a shared timeline and version establish continuity`, () => {
    const make = (metaA, metaB) => {
      const rt = new LoreStudyRuntime();
      rt.ingestLorebook({ id: 'one', entries: [{ uid: 'a', content: `The ${w.item} was destroyed during the ${w.event}.`, metadata: at(10, metaA) }] });
      rt.ingestLorebook({ id: 'two', entries: [{ uid: 'b', content: `${w.witness} saw the ${w.item} survived the ${w.event}.`, metadata: at(12, metaB) }] });
      rt.store.setBookGroupsProvider(() => [['one', 'two']]);
      rt.runDue();
      return rt.store.temporalResolution(rt.registry).conflicts;
    };
    assert.equal(make({}, {})[0].certainty, 'POSSIBLE', 'different lorebooks default to different timelines');
    assert.equal(make({ timeline: 'main' }, { timeline: 'main' })[0].certainty, 'ESTABLISHED');
    assert.equal(make({ timeline: 'main', version: '1' }, { timeline: 'main', version: '2' })[0].certainty, 'POSSIBLE');
    assert.equal(make({ timeline: 'main' }, { timeline: 'alt' })[0].certainty, 'POSSIBLE');
  });

  test(`[${w.name}] inspector: a claim keeps its asserted status and lists its conflict membership next to the conflict set`, () => {
    const rt = build(entriesFor(w));
    const surface = rt.publicSurface();
    const asserted = surface.artifacts.find((row) => row.artifactType === ArtifactType.CLAIM && row.sourceId.endsWith(':asserted'));
    assert.equal(asserted.unresolved, false, 'asserted status preserved');
    assert.equal(asserted.conflictMembership.length, 1);
    assert.equal(asserted.conflictMembership[0].certainty, 'ESTABLISHED');
    assert.ok(surface.conflicts.some((c) => c.id === asserted.conflictMembership[0].conflictSetId), 'and the separate conflict set exists');
    const superseded = surface.artifacts.find((row) => row.artifactType === ArtifactType.CLAIM && row.sourceId.endsWith(':before'));
    assert.ok(superseded.supersededBy);
  });
}

test('normalization: values compare after normalization and entity values through alias identity', () => {
  const claim = (id, property, value, extra = {}) => ({
    id, semanticId: 's' + id, sourceId: 'lore:x:' + id,
    payload: { subjectId: 'entity:thing', predicate: property, property, cardinality: 'ONE', value, applicability: { kind: 'AS_OF' }, attribution: null, sourceTime: { at: { value: 5, timeline: 'x', unit: 'ORDER' }, continuity: { timeline: 'x', version: null } }, ...extra },
  });
  const run = (claims, entities = []) => resolveLoreTemporal({ claims, entities, scopeOf: () => 'x', coScoped: () => true });
  assert.equal(run([claim('a', 'state', ' Intact '), claim('b', 'state', 'INTACT')]).conflicts.length, 0, 'same normalized state');
  assert.equal(run([claim('a', 'state', 'intact'), claim('b', 'state', 'damaged')]).conflicts.length, 1);
  const entities = [
    { payload: { entityId: 'entity:captain', canonicalName: 'Captain', aliases: ['Captain', 'Reyes'] } },
    { payload: { entityId: 'entity:reyes', canonicalName: 'Reyes', aliases: ['Reyes'] } },
  ];
  assert.equal(run([claim('a', 'owner', 'entity:captain'), claim('b', 'owner', 'entity:reyes')], entities).conflicts.length, 0, 'aliased identities are one owner');
  assert.equal(run([claim('a', 'owner', 'entity:captain'), claim('b', 'owner', 'entity:other')], entities).conflicts.length, 1);
  assert.equal(run([claim('a', 'state', 'intact'), claim('b', 'state', 'lost', { sourceTime: { at: { value: 5, timeline: 'x', unit: 'ORDER' }, continuity: { timeline: 'x', version: null } } })]).conflicts.length, 1);
  assert.equal(run([claim('a', 'mood', 'calm'), claim('b', 'mood', 'angry')]).conflicts.length, 0, 'a property outside the table has no conflict semantics');
});

test('production rules contain no story-specific names, aliases, predicates or outcomes', () => {
  const files = ['src/lore-temporal-rules.js', 'src/lore-source-registry.js', 'src/lore-contextual-retrieval.js', 'src/production-sparse-retrieval.js'];
  const banned = /\b(?:ember|tavern|sun[ -]?blade|mara|eris|blackout|meridian|dockhand|reyes|cargo|journal|fire|reactor|station)\b/i;
  for (const file of files) {
    const text = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    const hit = text.match(banned);
    assert.equal(hit, null, `${file} mentions "${hit?.[0]}"`);
  }
});
