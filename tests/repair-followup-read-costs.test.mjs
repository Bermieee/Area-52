// Follow-up (audit A14 / D10 residual): routine Diagnostics reads must be revision-aware reference
// surfaces whose size does not scale with the Lore corpus; full detail stays available on demand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInstalled } from './helpers/installed-host.mjs';

const names = Array.from({ length: 60 }, (_, i) => ['Mara', 'Eris', 'Kael', 'Lyra', 'Tomas', 'Anya', 'Rhys', 'Selene'][i % 8] + (i >= 8 ? ' ' + String.fromCharCode(65 + (i % 26)) + (i >> 3) : ''));
const places = ['Ember Tavern', 'Silver Keep', 'Greyharbor', 'River District'];
const book = (n, chatId) => ({
  id: 'sized-' + n, title: 'Sized ' + n, chatId, discovery: { kind: 'Fixture', stableId: 'sized-' + n, exactAuthoredSource: true },
  entries: Array.from({ length: n }, (_, i) => ({ uid: 'e' + i, content: `${names[i % 60]} guards the vault of ${places[i % 4]}. ${names[i % 60]} distrusts ${names[(i * 7 + 3) % 60]} after year ${900 + (i % 97)}.`, metadata: { title: 'Entry ' + i, at: i, treePath: ['P', '' + (i % 9)] } })),
});
const size = (o) => JSON.stringify(o).length;
async function session(n) {
  const h = makeInstalled({ chatId: 'chat:size' + n });
  h.session.ingestLorebook(book(n, 'chat:size' + n));
  h.user('Where is the Sun Blade?'); await h.generate('normal', 'Nobody knows.');
  return h;
}

test('routine exportEvidence does not scale with the Lore corpus', async () => {
  const small = await session(10), large = await session(60);
  const a = size(small.session.exportEvidence()), b = size(large.session.exportEvidence());
  assert.ok(b - a < 25_000, `export grew ${b - a} bytes for 50 more Lore entries (${a} -> ${b})`);
  const ref = large.session.exportEvidence().loreStatus;
  assert.equal(ref.study.kind, 'LoreStudyReferenceSurface');
  assert.equal(typeof ref.study.revisionKey, 'string');
  assert.ok(ref.study.counts.entries >= 60, 'counts preserved: ' + JSON.stringify(ref.study.counts));
  assert.equal(ref.study.detailReader, 'readLoreStatus');
  small.session.destroy(); large.session.destroy();
});

test('readLoreStatus serves full detail while the revision is current, a reference once it is superseded', async () => {
  const h = await session(20);
  const sel = h.nativeBrain.uiBindings().readSelection({ chatId: h.context.chatId });
  const brain = h.session.brain;
  const full = brain.readLoreStatus();
  assert.ok(Array.isArray(full.study.entries) && full.study.entries.length >= 20, 'unselected read is the live full surface');
  const record = [...brain.turns.values()].at(-1);
  if (record) {
    const forTurn = brain.readLoreStatus({ turnId: record.turnId });
    assert.ok(forTurn.study.revisionKey, 'turn snapshot carries its Lore revision key');
    assert.ok(size(record.loreStatus) < 20_000, 'turn record stores a reference, not the corpus: ' + size(record.loreStatus));
  }
  h.session.destroy();
});

test('identity resolution read is a compact reference surface with on-demand detail', async () => {
  const h = await session(60);
  const nb = h.nativeBrain;
  const sel = nb.uiBindings().readSelection({ chatId: h.context.chatId });
  const read = nb.uiBindings().readIdentityResolution(sel);
  assert.ok(read.identities.length > 0);
  for (const row of read.identities) {
    assert.equal(Array.isArray(row.aliases), false, 'no per-alias arrays in the routine read');
    assert.equal(typeof row.aliasCount, 'number');
    assert.equal(typeof row.sourceRevisionCount, 'number');
    assert.ok(row.revisionRef);
  }
  assert.equal(read.compact, true);
  assert.equal(read.detailReader, 'entityIdentityDetail');
  const id = read.identities[0].entityId;
  const detail = nb.entityIdentityDetail(id, { storyId: h.context.chatId });
  assert.ok(detail.aliases.length >= 1 && detail.sourceRevisionRefs.length >= 1, 'full record on demand');
  assert.equal(nb.entityIdentityDetail(id, { storyId: 'chat:foreign' }), null, 'detail respects story isolation');
  // core-level model stays complete for owners and tests
  assert.ok(nb.entityIdentityReadModel({ storyId: h.context.chatId }).identities[0].aliases.length >= 1);
  h.session.destroy();
});
