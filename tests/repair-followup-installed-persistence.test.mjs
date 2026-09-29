// Follow-up (audit D3): installed persistence end to end: fresh-session recovery, story isolation, invalidation and
// interrupted writes, through the real installed session objects with the installed storage adapter over a FAKE
// backend and a FAKE SillyTavern host. Not a real browser or SillyTavern reload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { InstalledStorageAdapter, createMemoryBackend } from '../src/deployment/installed-storage.js';
import { createInstalledDevelopmentDeploymentSession } from '../src/deployment/installed-session.js';
import { createGoldenDeploymentLorebook } from '../src/deployment/brain.js';
import { EV } from './helpers/installed-host.mjs';

// A host whose chats persist across "reloads" (ST keeps chats on disk); each boot gets a fresh event bus.
function makeChats() { return new Map(); }
async function boot({ backend, chats, chatId, crashAt = null }) {
  const listeners = new Map();
  if (!chats.has(chatId)) chats.set(chatId, []);
  const context = {
    chatId, chat: chats.get(chatId), mainApi: 'openai', eventTypes: EV,
    eventSource: { on(t, f) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); }, removeListener(t, f) { listeners.get(t)?.delete(f); } },
    async setExtensionPrompt() {},
  };
  const emit = async (t, ...a) => { for (const f of [...(listeners.get(t) ?? [])]) await f(...a); };
  let storageBackend = backend;
  if (crashAt != null) {
    let writes = 0;
    storageBackend = { ...backend, kind: 'CRASHING', async set(k, v) { writes += 1; if (writes >= crashAt) throw new Error('simulated interruption'); return backend.set(k, v); }, async delete(k) { return backend.delete(k); } };
  }
  const storage = new InstalledStorageAdapter({ backend: storageBackend });
  const session = await createInstalledDevelopmentDeploymentSession({ sillyTavern: { getContext: () => context }, document: null, mountUi: false, storage });
  session.start();
  let n = chats.get(chatId).length;
  const switchTo = async (id) => {
    if (!chats.has(id)) chats.set(id, []);
    context.chatId = id; context.chat = chats.get(id);
    await emit(EV.CHAT_CHANGED, id);
    await session.storyBrainReady;
  };
  const turn = async (user, reply) => {
    context.chat.push({ is_user: true, mes: user, mesId: 'u' + (++n) });
    await emit(EV.GENERATION_STARTED, 'normal', {}, false);
    await emit(EV.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
    const req = { chat: [{ role: 'system', content: 'host' }, { role: 'user', content: user }], dryRun: false };
    await emit(EV.CHAT_COMPLETION_PROMPT_READY, req);
    context.chat.push({ is_user: false, mes: reply, mesId: 'a' + (++n) });
    await emit(EV.MESSAGE_RECEIVED, context.chat.length - 1, 'normal');
    await emit(EV.GENERATION_ENDED, context.chat.length);
    await session.flushPersistence();
    return req;
  };
  return { session, context, emit, turn, switchTo, storage, errors: () => session.exportEvidence().errors.map((e) => e.stage + ': ' + e.message) };
}
const has = (req, token) => JSON.stringify(req.chat).includes(token);

test('fresh-session recovery restores Brain, Lore with its story binding, and Scene, and continues coherently', async () => {
  const backend = createMemoryBackend(), chats = makeChats();
  const a = await boot({ backend, chats, chatId: 'chat:A' });
  a.session.ingestLorebook({ ...createGoldenDeploymentLorebook(), chatId: 'chat:A' });
  await a.turn('At North Gallery, Mara waits near marker one.', 'Eris walks in carrying the Sun Blade OLDTOKEN.');
  await a.turn('We arrive at South Courtyard.', 'Mara steps into the courtyard.');
  const before = a.session.brain.scene.integrationSignal('chat:A');
  const turnsBefore = a.session.nativeBrain.turns.size;
  assert.ok(before?.sceneId && turnsBefore >= 2, 'precondition');
  a.session.destroy();

  const b = await boot({ backend, chats, chatId: 'chat:A' });
  assert.equal(b.session.storageRestore.story, 'CURRENT');
  assert.equal(b.session.storageRestore.brain, 'RESTORED');
  assert.equal(b.session.brain.sceneRestoreReceipt.status, 'RESTORED');
  assert.equal(b.session.nativeBrain.turns.size, turnsBefore, 'Brain turns restored');
  const lore = b.session.brain.loreIntelligence;
  assert.equal(lore.storyAuthority.scopeReceipt('chat:A').state, 'BOUND', 'story binding restored');
  const after = b.session.brain.scene.integrationSignal('chat:A');
  assert.equal(after.sceneId, before.sceneId, 'same Scene identity');
  assert.equal(after.sceneRevision, before.sceneRevision, 'same Scene revision (no reset)');
  const req = await b.turn('Where is the Sun Blade?', 'Nobody knows.');
  assert.ok(has(req, 'Sun Blade'), 'restored Lore reaches the next prepared context');
  assert.ok(b.session.brain.scene.integrationSignal('chat:A').sceneRevision >= before.sceneRevision, 'Scene continues from the restored revision');
  assert.deepEqual(b.errors(), []);
  b.session.destroy();
});

test('story isolation: a restored story exposes nothing of another story, in storage or in memory', async () => {
  const backend = createMemoryBackend(), chats = makeChats();
  const a = await boot({ backend, chats, chatId: 'chat:A' });
  await a.turn('At North Gallery, Kael lights the lantern.', 'The gallery brightens ALPHASECRET.');
  await a.switchTo('chat:B');
  await a.turn('At Old Harbor, Tomas mends the net.', 'Gulls circle BETASECRET.');
  a.session.destroy();

  const b = await boot({ backend, chats, chatId: 'chat:B' });
  const snapshotText = JSON.stringify(b.session.nativeBrain.snapshot());
  assert.equal(snapshotText.includes('chat:A'), false, 'restored Brain holds no story-A identifiers');
  assert.equal(snapshotText.includes('ALPHASECRET'), false);
  // Story-scoped parts of B (Brain + host bookkeeping) hold nothing of A. Owner parts (Lore, Memory, Scene) are stored
  // once and scope their own reads per story; that is asserted through the prepared context below, not by storage layout.
  const manifests = [...backend._map].filter(([k]) => k.includes('/manifest/story:')).map(([k, v]) => JSON.parse(v));
  const storyB = manifests.find((m) => m.chatId === 'chat:B');
  assert.ok(storyB, 'story B stored under its own scope');
  for (const ref of Object.values(storyB.parts)) assert.equal(String(backend._map.get(ref.key)).includes('ALPHASECRET'), false, 'stored story-B part contains no story-A text: ' + ref.key);
  for (const ref of Object.values(storyB.parts)) assert.equal(String(backend._map.get(ref.key)).includes('chat:A'), false, 'no story-A identifier in story-B part ' + ref.key);
  const req = await b.turn('What happened earlier?', 'Unknown.');
  assert.equal(has(req, 'ALPHASECRET'), false, 'story B context carries nothing of story A');
  await b.switchTo('chat:A');
  const back = await b.turn('Continue.', 'Yes.');
  assert.equal(has(back, 'BETASECRET'), false, 'switching back restores story A without story B');
  assert.ok(b.session.nativeBrain.turns.size >= 1 && [...b.session.nativeBrain.turns.values()].every((t) => t.chatId === 'chat:A'), 'attached brain serves only story A');
  b.session.destroy();
});

test('invalidation: a message deleted while the extension was off is retired on the next generation', async () => {
  const backend = createMemoryBackend(), chats = makeChats();
  const a = await boot({ backend, chats, chatId: 'chat:A' });
  await a.turn('Mara wipes the bar.', 'Eris walks in carrying the Sun Blade OLDTOKEN.');
  await a.turn('Eris sits down.', 'Mara pours ale.');
  a.session.destroy();
  const chat = chats.get('chat:A');
  const at = chat.findIndex((m) => String(m.mes).includes('OLDTOKEN'));
  chat.splice(at, 1); // the user deleted it in SillyTavern while Area-52 was not running

  const b = await boot({ backend, chats, chatId: 'chat:A' });
  const req = await b.turn('What is Eris carrying?', 'Nothing.');
  assert.equal(has(req, 'OLDTOKEN'), false, 'deleted message text is not delivered after the reload');
  assert.ok(b.session.hostRevisionReconciliations.some((r) => r.nativeTurns.some((t) => t.action === 'RETIRED')), 'retired through the persisted host bookkeeping');
  b.session.destroy();
});

test('invalidation: Lore revisions changed while the extension was off invalidate restored identities', async () => {
  const backend = createMemoryBackend(), chats = makeChats();
  const a = await boot({ backend, chats, chatId: 'chat:A' });
  a.session.ingestLorebook({ ...createGoldenDeploymentLorebook(), chatId: 'chat:A' });
  await a.turn('Hello there.', 'Hi.');
  const idsBefore = [...a.session.nativeBrain.core.entities.entities.keys()];
  assert.ok(idsBefore.length > 0);
  a.session.destroy();

  const b = await boot({ backend, chats, chatId: 'chat:A' });
  const book = createGoldenDeploymentLorebook();
  book.entries = book.entries.map((e) => (e.uid === 'mara' ? { ...e, content: 'Mara sells the Ember Tavern to a stranger.' } : e));
  b.session.ingestLorebook({ ...book, chatId: 'chat:A' });
  await b.turn('Who owns the tavern now?', 'Unknown.');
  const sync = b.session.nativeBrain.loreIdentitySync.last;
  assert.ok(sync.invalidatedRevisionRefs.length > 0, 'old Lore revisions invalidated after the offline edit: ' + JSON.stringify(sync));
  b.session.destroy();
});

test('interrupted writes never corrupt recovery: every crash point recovers a consistent earlier checkpoint', async () => {
  for (const crashAt of [1, 2, 3, 4, 5, 6]) {
    const backend = createMemoryBackend(), chats = makeChats();
    const a = await boot({ backend, chats, chatId: 'chat:A' });
    await a.turn('At North Gallery, Mara waits.', 'She nods.');
    const stored = a.session.nativeBrain.turns.size;
    a.session.destroy();
    const crashing = await boot({ backend, chats, chatId: 'chat:A', crashAt });
    await crashing.turn('We arrive at South Courtyard.', 'Mara steps in.').catch(() => {});
    crashing.session.destroy();
    const recovered = await boot({ backend, chats, chatId: 'chat:A' });
    assert.ok(['CURRENT', 'RECOVERED_PREVIOUS_GENERATION'].includes(recovered.session.storageRestore.story), `crashAt ${crashAt}: ${recovered.session.storageRestore.story}`);
    assert.ok([stored, stored + 1].includes(recovered.session.nativeBrain.turns.size), `crashAt ${crashAt}: turns ${recovered.session.nativeBrain.turns.size}`);
    const req = await recovered.turn('Continue.', 'Yes.');
    assert.deepEqual(recovered.errors(), [], `crashAt ${crashAt}`);
    assert.ok(req.chat.length >= 2);
    recovered.session.destroy();
  }
});

test('a corrupted Scene owner part starts the Scene owner fresh and reports it; the session still works', async () => {
  const backend = createMemoryBackend(), chats = makeChats();
  const a = await boot({ backend, chats, chatId: 'chat:A' });
  await a.turn('At North Gallery, Mara waits.', 'She nods.');
  a.session.destroy();
  const manifestKey = (await backend.keys('area52/v1/manifest/owners'))[0];
  const manifest = JSON.parse(await backend.get(manifestKey));
  const sceneRef = manifest.parts.scene;
  const bad = JSON.stringify({ kind: 'SceneLifecycleRuntimeState', version: 1, lifecycle: { kind: 'nope' } });
  await backend.set(sceneRef.key, bad);
  manifest.parts.scene = { ...sceneRef, checksum: (await import('../src/coprocessor/browser-compat.js')).sha256Hex(bad).slice(0, 32), bytes: bad.length };
  await backend.set(manifestKey, JSON.stringify(manifest));
  const b = await boot({ backend, chats, chatId: 'chat:A' });
  assert.equal(b.session.brain.sceneRestoreReceipt.status, 'REJECTED_FRESH_START');
  await b.turn('We arrive at South Courtyard.', 'Mara steps in.');
  assert.deepEqual(b.errors(), []);
  b.session.destroy();
});

test('storage state is visible in the existing Diagnostics evidence export', async () => {
  const a = await boot({ backend: createMemoryBackend(), chats: makeChats(), chatId: 'chat:A' });
  await a.turn('Hello.', 'Hi.');
  const p = a.session.exportEvidence().nativeBrainIntegration.persistence;
  assert.equal(p.configured, true);
  assert.equal(p.storage.backend, 'MEMORY');
  assert.ok(p.storage.saves >= 2);
  assert.equal(p.last.status, 'PERSISTED');
  a.session.destroy();
});

test('a checkpoint rewrites only the changed tail: settled turn, ledger and seal chunks are reused (record size itself is O8)', async () => {
  const backend = createMemoryBackend(), chats = makeChats();
  const a = await boot({ backend, chats, chatId: 'chat:A' });
  const storyKeys = () => new Set([...backend._map.keys()].filter((k) => k.includes('/part/story:')));
  const partsOf = () => Object.keys(JSON.parse(backend._map.get([...backend._map.keys()].find((k) => k.includes('/manifest/story:')))).parts);
  let written = [];
  for (let i = 1; i <= 20; i += 1) {
    const keysBefore = storyKeys();
    await a.turn('At North Gallery, Mara waits near marker ' + i + '.', 'She waits ' + i + '.');
    written = [...storyKeys()].filter((k) => !keysBefore.has(k)).map((k) => k.split('/').pop());
  }
  const turnChunks = partsOf().filter((n) => n.startsWith('brain.turns:')).length;
  const rewrote = (prefix) => written.filter((n) => n.startsWith(prefix)).length;
  assert.ok(turnChunks >= 20, 'every turn has its own chunk');
  // Only the newest turns (still settling, then compacted) may change; history is not rewritten.
  assert.ok(rewrote('brain.turns:') <= 5, `${rewrote('brain.turns:')} of ${turnChunks} turn chunks rewritten in one checkpoint: ${written.join(' ')}`);
  assert.ok(rewrote('brain.ledger:') <= 2 && rewrote('brain.seal:') <= 2, 'ledger and seal grow by their tail only: ' + written.join(' '));
  assert.ok(a.storage.stats.partsReused > 0, 'unchanged chunks were reused');
  assert.equal((await a.storage.loadStory('chat:A')).status, 'CURRENT');
  a.session.destroy();
});

test('reload after the story manifest is corrupted: restored from the backup manifest and reported, not a silent fresh start', async () => {
  const backend = createMemoryBackend(), chats = makeChats();
  const a = await boot({ backend, chats, chatId: 'chat:CM' });
  await a.turn('At North Gallery, Mara waits near marker one.', 'Eris walks in.');
  await a.turn('We arrive at South Courtyard.', 'Mara steps into the courtyard.');
  a.session.destroy();
  for (const key of await backend.keys('area52/v1/manifest/story:')) await backend.set(key, '{"truncated":');
  const b = await boot({ backend, chats, chatId: 'chat:CM' });
  assert.equal(b.session.storageRestore.story, 'RECOVERED_BACKUP_MANIFEST');
  assert.equal(b.session.storageRestore.brain, 'RESTORED', 'the previous checkpoint is restored');
  assert.ok(b.session.nativeBrain.turns.size >= 1);
  b.session.destroy();
});

test('reload when story manifest and backup are unreadable: UNREADABLE_FRESH_START is reported and the old parts are kept', async () => {
  const backend = createMemoryBackend(), chats = makeChats();
  const a = await boot({ backend, chats, chatId: 'chat:CX' });
  await a.turn('At North Gallery, Mara waits.', 'Eris walks in.');
  await a.turn('Still here.', 'Yes.');
  a.session.destroy();
  for (const key of [...await backend.keys('area52/v1/manifest/story:'), ...await backend.keys('area52/v1/manifest-backup/story:')]) await backend.set(key, 'garbage');
  const oldParts = await backend.keys('area52/v1/part/story:');
  const b = await boot({ backend, chats, chatId: 'chat:CX' });
  assert.equal(b.session.storageRestore.story, 'CORRUPT_MANIFEST');
  assert.equal(b.session.storageRestore.brain, 'UNREADABLE_FRESH_START', 'visible, never NONE_STORED');
  await b.turn('A new line.', 'A reply.');
  for (const key of oldParts) assert.notEqual(await backend.get(key), null, 'recoverable parts are quarantined, not collected');
  assert.equal((await b.storage.quarantineForStory('chat:CX')).length, 1);
  b.session.destroy();
});

test('storage unavailable at reload and on save: reported in the restore receipt and on every checkpoint; the session keeps working', async () => {
  const chats = makeChats();
  const unavailable = () => Object.assign(new Error('No durable browser storage is usable'), { code: 'STORAGE_UNAVAILABLE' });
  const dead = { kind: 'DEAD', async get() { throw unavailable(); }, async set() { throw unavailable(); }, async delete() { throw unavailable(); }, async keys() { throw unavailable(); } };
  const s = await boot({ backend: dead, chats, chatId: 'chat:UA' });
  assert.equal(s.session.storageRestore.story, 'UNAVAILABLE');
  assert.equal(s.session.storageRestore.brain, 'STORAGE_UNAVAILABLE_FRESH_START');
  const req = await s.turn('Mara waits at the gate.', 'She nods.');
  assert.ok(req.chat.length >= 2, 'the turn still prepares context');
  const rows = s.session.nativePersistence ?? [];
  assert.ok(rows.length && rows.at(-1).status === 'FAILED', 'the checkpoint failure is recorded: ' + JSON.stringify(rows.at(-1)));
  assert.equal(s.storage.diagnostics().lastErrorCode, 'STORAGE_UNAVAILABLE');
  s.session.destroy();
});

test('quota exhausted mid-session: the last valid checkpoint survives a reload and the failure is recorded', async () => {
  const chats = makeChats(), inner = createMemoryBackend();
  let full = false;
  const backend = { ...inner, async set(k, v) { if (full) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError', code: 22 }); return inner.set(k, v); } };
  const a = await boot({ backend, chats, chatId: 'chat:QT' });
  await a.turn('At North Gallery, Mara waits.', 'Eris walks in.');
  const turnsAtCheckpoint = a.session.nativeBrain.turns.size;
  full = true;
  await a.turn('A second line that cannot be stored.', 'A reply.');
  assert.equal(a.session.nativePersistence.at(-1).status, 'FAILED');
  assert.equal(a.storage.diagnostics().lastErrorCode, 'QUOTA_EXCEEDED');
  a.session.destroy();
  full = false;
  const b = await boot({ backend, chats, chatId: 'chat:QT' });
  assert.equal(b.session.storageRestore.story, 'CURRENT');
  assert.equal(b.session.storageRestore.brain, 'RESTORED');
  assert.equal(b.session.nativeBrain.turns.size, turnsAtCheckpoint, 'the last valid checkpoint, not a torn one');
  b.session.destroy();
});

test('two tabs on one story: the stale tab cannot overwrite the newer checkpoint; its checkpoint is preserved and the conflict is reported until reload', async () => {
  const backend = createMemoryBackend(), chats = makeChats();
  const tabA = await boot({ backend, chats, chatId: 'chat:TT' });
  await tabA.turn('At North Gallery, Mara waits.', 'Eris walks in.');
  const tabB = await boot({ backend, chats, chatId: 'chat:TT' }); // loads A's checkpoint
  await tabA.turn('A second line in tab A.', 'Reply A.');          // A saves a newer checkpoint B has not seen
  const newer = await new InstalledStorageAdapter({ backend }).loadStory('chat:TT');
  await tabB.turn('A line typed in the stale tab B.', 'Reply B.');
  const row = tabB.session.nativePersistence.at(-1);
  assert.equal(row.status, 'CONFLICT'); assert.equal(row.code, 'STALE_WRITER'); assert.equal(row.scope, 'story'); assert.equal(row.preserved, true);
  const evidence = tabB.session.exportEvidence();
  assert.equal(JSON.stringify(evidence).includes('RELOAD_TO_LOAD_THE_NEWER_CHECKPOINT'), true, 'the conflict is visible in Diagnostics evidence');
  const after = await new InstalledStorageAdapter({ backend }).loadStory('chat:TT');
  assert.equal(after.generation, newer.generation, 'the newer checkpoint was not overwritten');
  assert.deepEqual(after.parts, newer.parts);
  const conflicts = await tabB.storage.readWriteConflicts('chat:TT');
  assert.equal(conflicts.length, 1); assert.equal((await tabB.storage.loadWriteConflict(conflicts[0].key)).status, 'PRESERVED');
  tabA.session.destroy(); tabB.session.destroy();
  const reloaded = await boot({ backend, chats, chatId: 'chat:TT' });
  assert.equal(reloaded.session.storageRestore.brain, 'RESTORED', 'reload restores the newer checkpoint');
  await reloaded.turn('Continuing after reload.', 'Fine.');
  assert.equal(reloaded.session.nativePersistence.at(-1).status, 'PERSISTED');
  reloaded.session.destroy();
});
