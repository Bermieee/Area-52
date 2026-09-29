// Follow-up (audit D3): installed storage adapter guarantees. FAKE backends only (memory, a Storage fake and a
// minimal IndexedDB fake); not a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { InstalledStorageAdapter, createMemoryBackend, createLocalStorageBackend, createIndexedDbBackend, createInstalledStorage, selectInstalledBackend } from '../src/deployment/installed-storage.js';

// Wraps a backend so the Nth mutating call throws (an interrupted write), then behaves normally again.
function crashing(inner, failAtWrite) {
  let writes = 0;
  return {
    ...inner, kind: 'CRASHING',
    async set(key, value) { writes += 1; if (writes === failAtWrite) throw new Error('simulated interruption at write ' + writes); return inner.set(key, value); },
    async delete(key) { writes += 1; if (writes === failAtWrite) throw new Error('simulated interruption at write ' + writes); return inner.delete(key); },
  };
}

test('story and owner parts round-trip with generation and checksum verification', async () => {
  const a = new InstalledStorageAdapter({ backend: createMemoryBackend() });
  await a.saveStory('chat:A', { brain: { turns: [1, 2] }, host: { n: 1 } });
  await a.saveOwners({ lore: { books: ['x'] }, scene: { s: 1 } });
  const story = await a.loadStory('chat:A');
  assert.equal(story.status, 'CURRENT'); assert.deepEqual(story.parts.brain, { turns: [1, 2] });
  const owners = await a.loadOwners();
  assert.deepEqual(owners.parts.lore, { books: ['x'] });
});

test('an unchanged owner part is retained when other owner parts are saved', async () => {
  const a = new InstalledStorageAdapter({ backend: createMemoryBackend() });
  await a.saveOwners({ lore: { v: 1 }, memory: { m: 1 } });
  await a.saveOwners({ memory: { m: 2 }, scene: { s: 1 } });
  const owners = (await a.loadOwners()).parts;
  assert.deepEqual(owners, { lore: { v: 1 }, memory: { m: 2 }, scene: { s: 1 } });
});

test('an interruption at ANY write of a save leaves the previous generation intact', async () => {
  for (let failAt = 1; failAt <= 8; failAt += 1) {
    const inner = createMemoryBackend();
    const a = new InstalledStorageAdapter({ backend: inner });
    await a.saveStory('chat:A', { brain: { gen: 1 }, host: { gen: 1 } });
    const b = new InstalledStorageAdapter({ backend: crashing(inner, failAt) });
    let threw = false;
    try { await b.saveStory('chat:A', { brain: { gen: 2 }, host: { gen: 2 } }); } catch { threw = true; }
    const loaded = await new InstalledStorageAdapter({ backend: inner }).loadStory('chat:A');
    assert.ok(['CURRENT', 'RECOVERED_PREVIOUS_GENERATION'].includes(loaded.status), `failAt ${failAt}: ${loaded.status}`);
    const gen = loaded.parts.brain.gen;
    assert.equal(loaded.parts.host.gen, gen, `failAt ${failAt}: parts come from ONE generation, never a torn mix`);
    if (threw && failAt <= 3) assert.equal(gen, 1, `failAt ${failAt}: manifest not switched, previous generation served`);
    assert.ok([1, 2].includes(gen));
  }
});

test('a corrupted part makes the loader fall back to the previous generation; corruption everywhere is reported, never thrown', async () => {
  const backend = createMemoryBackend();
  const a = new InstalledStorageAdapter({ backend });
  await a.saveStory('chat:A', { brain: { gen: 1 } });
  await a.saveStory('chat:A', { brain: { gen: 2 } });
  const partKeys = (await backend.keys('area52/v1/part/')).sort();
  const newest = partKeys.at(-1);
  await backend.set(newest, '{"gen":999}');
  const recovered = await a.loadStory('chat:A');
  assert.equal(recovered.status, 'RECOVERED_PREVIOUS_GENERATION');
  assert.deepEqual(recovered.parts.brain, { gen: 1 });
  for (const key of partKeys) await backend.set(key, 'not json {');
  const corrupt = await a.loadStory('chat:A');
  assert.equal(corrupt.status, 'CORRUPT');
  assert.deepEqual(corrupt.parts, {});
});

test('garbage collection keeps only the current and previous generation and drops orphans', async () => {
  const backend = createMemoryBackend();
  const a = new InstalledStorageAdapter({ backend });
  for (let i = 1; i <= 4; i += 1) await a.saveStory('chat:A', { brain: { i } });
  assert.equal((await backend.keys('area52/v1/part/')).length, 2);
  await backend.set('area52/v1/part/' + (await backend.keys('area52/v1/part/'))[0].split('/')[3] + '/99/orphan', 'x');
  await a.saveStory('chat:A', { brain: { i: 5 } });
  // Multi-tab rule: a part NEWER than the current generation written by another writer may be a save still in flight in
  // another tab, so it is kept; it is collected once the retained floor (the previous generation) passes it.
  assert.equal((await backend.keys('area52/v1/part/')).some((k) => k.endsWith('/orphan')), true, 'possibly in-flight: kept');
  const g = (await a.saveStory('chat:A', { brain: { i: 6 } })).generation;
  assert.ok(g > 99, 'new generations are numbered past every existing part key');
  await a.saveStory('chat:A', { brain: { i: 7 } });
  assert.equal((await backend.keys('area52/v1/part/')).some((k) => k.endsWith('/orphan')), false, 'collected once older than the previous generation');
  assert.equal((await backend.keys('area52/v1/part/')).length, 2, 'only current and previous generation remain');
  assert.equal((await a.loadStory('chat:A')).parts.brain.i, 7);
});

test('stories are isolated: one story never loads or exposes another story\'s parts', async () => {
  const backend = createMemoryBackend();
  const a = new InstalledStorageAdapter({ backend });
  await a.saveStory('chat:A', { brain: { secret: 'ALPHA-SECRET' } });
  await a.saveStory('chat:B', { brain: { secret: 'BETA-SECRET' } });
  const b = await a.loadStory('chat:B');
  assert.equal(JSON.stringify(b).includes('ALPHA-SECRET'), false);
  assert.equal((await a.loadStory('chat:C')).status, 'EMPTY');
  // A manifest copied under another story's key is rejected (chat identity is verified, not only the hashed key).
  const [manifestA] = (await backend.keys('area52/v1/manifest/')).filter(async () => true);
  const keys = await backend.keys('area52/v1/manifest/');
  const raw = JSON.parse(await backend.get(keys[0]));
  const other = keys.find((k) => k !== keys[0]);
  const forged = { ...JSON.parse(await backend.get(other)), chatId: 'chat:SOMEONE-ELSE' };
  await backend.set(other, JSON.stringify(forged));
  const statuses = [(await a.loadStory('chat:A')).status, (await a.loadStory('chat:B')).status];
  assert.ok(statuses.includes('STORY_MISMATCH'), JSON.stringify(statuses) + (manifestA, raw.scope));
  await a.deleteStory('chat:A');
  assert.equal((await a.loadStory('chat:A')).status, 'EMPTY');
});

test('concurrent saves are serialised and the last one wins', async () => {
  const a = new InstalledStorageAdapter({ backend: createMemoryBackend() });
  const results = await Promise.all([1, 2, 3, 4, 5].map((i) => a.saveStory('chat:A', { brain: { i } })));
  assert.deepEqual(results.map((r) => r.generation), [1, 2, 3, 4, 5]);
  assert.deepEqual((await a.loadStory('chat:A')).parts.brain, { i: 5 });
});

test('localStorage backend works against a Storage fake', async () => {
  const data = new Map();
  const storage = { get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  const a = new InstalledStorageAdapter({ backend: createLocalStorageBackend(storage) });
  await a.saveStory('chat:A', { brain: { ok: true } });
  assert.deepEqual((await a.loadStory('chat:A')).parts.brain, { ok: true });
});

test('IndexedDB backend works against a minimal IndexedDB fake', async () => {
  const stores = new Map();
  const fake = {
    open() {
      const request = {};
      queueMicrotask(() => {
        const db = {
          objectStoreNames: { contains: (n) => stores.has(n) },
          createObjectStore: (n) => stores.set(n, new Map()),
          transaction(name) {
            const map = stores.get(name); const tx = {};
            const wrap = (fn) => { const r = {}; queueMicrotask(() => { try { r.result = fn(); r.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); } catch (e) { r.error = e; r.onerror?.(); } }); return r; };
            tx.objectStore = () => ({ get: (k) => wrap(() => map.get(k)), put: (v, k) => wrap(() => { map.set(k, v); }), delete: (k) => wrap(() => { map.delete(k); }), getAllKeys: () => wrap(() => [...map.keys()]) });
            return tx;
          },
        };
        request.result = db; request.onupgradeneeded?.(); request.onsuccess?.();
      });
      return request;
    },
  };
  const a = new InstalledStorageAdapter({ backend: createIndexedDbBackend({ indexedDB: fake }) });
  await a.saveStory('chat:A', { brain: { idb: 1 } });
  await a.saveStory('chat:A', { brain: { idb: 2 } });
  assert.deepEqual((await a.loadStory('chat:A')).parts.brain, { idb: 2 });
});

// ---- Failure modes (closure round): quota, unavailable/private storage, multi-tab writers, corrupt manifest ----

const quotaError = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError', code: 22 });
// A memory backend with a byte cap over all stored values; set() past the cap throws QuotaExceededError (nothing stored).
function quotaBackend(capBytes) {
  const inner = createMemoryBackend();
  const used = () => [...inner._map.values()].reduce((n, v) => n + v.length, 0);
  return { ...inner, kind: 'QUOTA_FAKE', cap: capBytes,
    async set(key, value) { const text = String(value), prev = inner._map.get(key)?.length ?? 0; if (used() - prev + text.length > this.cap) throw quotaError(); return inner.set(key, text); } };
}
function storageFake({ failWrites = false } = {}) {
  const data = new Map();
  return { get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null, getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { if (failWrites) throw quotaError(); data.set(k, String(v)); }, removeItem: (k) => data.delete(k) };
}
function idbFake({ failOpen = false } = {}) {
  const stores = new Map();
  return { open() {
    const request = {};
    queueMicrotask(() => {
      if (failOpen) { request.error = Object.assign(new Error('A mutation operation was attempted on a database that did not allow mutations.'), { name: 'InvalidStateError' }); request.onerror?.(); return; }
      const db = { objectStoreNames: { contains: (n) => stores.has(n) }, createObjectStore: (n) => stores.set(n, new Map()),
        transaction(name) { const map = stores.get(name), tx = {};
          const wrap = (fn) => { const r = {}; queueMicrotask(() => { try { r.result = fn(); r.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); } catch (e) { r.error = e; r.onerror?.(); } }); return r; };
          tx.objectStore = () => ({ get: (k) => wrap(() => map.get(k)), put: (v, k) => wrap(() => { map.set(k, v); }), delete: (k) => wrap(() => { map.delete(k); }), getAllKeys: () => wrap(() => [...map.keys()]) });
          return tx; } };
      request.result = db; request.onupgradeneeded?.(); request.onsuccess?.();
    });
    return request;
  } };
}
// Web Locks fake: one exclusive holder per name, FIFO.
function locksFake() {
  const tails = new Map();
  return { request(name, _options, fn) { const prev = tails.get(name) ?? Promise.resolve(); const run = prev.then(() => fn()); tails.set(name, run.catch(() => {})); return run; } };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
// Delays every backend operation by one macrotask so two writers genuinely interleave.
const slow = (inner) => ({ ...inner, async get(k) { await tick(); return inner.get(k); }, async set(k, v) { await tick(); return inner.set(k, v); }, async delete(k) { await tick(); return inner.delete(k); }, async keys(p) { await tick(); return inner.keys(p); } });

test('quota exceeded: the save fails with QUOTA_EXCEEDED, the last valid checkpoint stays loadable, and the attempt frees its parts', async () => {
  const backend = quotaBackend(4000);
  const a = new InstalledStorageAdapter({ backend });
  await a.saveStory('chat:Q', { brain: { gen: 1, pad: 'x'.repeat(600) }, host: { gen: 1 } });
  const keysBefore = (await backend.keys('')).sort();
  const err = await a.saveStory('chat:Q', { brain: { gen: 2, pad: 'y'.repeat(900) }, host: { gen: 2, pad: 'z'.repeat(2500) } }).catch((e) => e);
  assert.ok(err instanceof Error, 'the save rejects'); assert.equal(err.storageCode, 'QUOTA_EXCEEDED');
  const loaded = await a.loadStory('chat:Q');
  assert.equal(loaded.status, 'CURRENT'); assert.equal(loaded.parts.brain.gen, 1); assert.equal(loaded.parts.host.gen, 1);
  assert.deepEqual((await backend.keys('')).sort(), keysBefore, 'parts written by the failed attempt were removed (space freed, no orphans)');
  const d = a.diagnostics(); assert.equal(d.lastErrorCode, 'QUOTA_EXCEEDED'); assert.equal(d.quotaFailures, 1); assert.equal(d.failedSaves, 1);
  backend.cap = 1e6; // space freed by the user
  await a.saveStory('chat:Q', { brain: { gen: 3 }, host: { gen: 3 } });
  assert.equal((await a.loadStory('chat:Q')).parts.brain.gen, 3, 'persistence resumes');
});

test('quota exceeded exactly at the manifest switch keeps the previous generation (never a torn mix)', async () => {
  const inner = quotaBackend(1e6);
  const a = new InstalledStorageAdapter({ backend: inner });
  await a.saveStory('chat:Q2', { brain: { gen: 1 }, host: { gen: 1 } });
  // The switch is a compare-and-set where the backend has one, so quota is raised there as well as on set().
  const failManifest = { ...inner, async set(k, v) { if (k.includes('/manifest/')) throw quotaError(); return inner.set(k, v); }, async compareAndSet(k, e, v) { if (k.includes('/manifest/')) throw quotaError(); return inner.compareAndSet(k, e, v); } };
  const b = new InstalledStorageAdapter({ backend: failManifest });
  assert.equal((await b.saveStory('chat:Q2', { brain: { gen: 2 }, host: { gen: 2 } }).catch((e) => e)).storageCode, 'QUOTA_EXCEEDED');
  const loaded = await a.loadStory('chat:Q2');
  assert.equal(loaded.status, 'CURRENT'); assert.deepEqual([loaded.parts.brain.gen, loaded.parts.host.gen], [1, 1]);
});

test('private mode: IndexedDB that fails to open is probed and skipped; localStorage is used when it works', async () => {
  const backend = selectInstalledBackend({ indexedDB: idbFake({ failOpen: true }), localStorage: storageFake() });
  const a = new InstalledStorageAdapter({ backend });
  await a.saveStory('chat:P', { brain: { ok: 1 } });
  assert.deepEqual((await a.loadStory('chat:P')).parts.brain, { ok: 1 });
  const d = a.diagnostics();
  assert.equal(d.backend, 'LOCAL_STORAGE');
  assert.deepEqual(d.backendAttempts.map((r) => [r.kind, r.ok]), [['INDEXED_DB', false], ['LOCAL_STORAGE', true]]);
  const idbOk = new InstalledStorageAdapter({ backend: selectInstalledBackend({ indexedDB: idbFake(), localStorage: storageFake() }) });
  await idbOk.saveStory('chat:P', { brain: { ok: 2 } });
  assert.equal(idbOk.diagnostics().backend, 'INDEXED_DB', 'a working IndexedDB is preferred');
});

test('storage unavailable (IndexedDB open fails, localStorage rejects writes): loads report UNAVAILABLE, saves fail visibly, the session keeps running', async () => {
  const storage = createInstalledStorage({ host: { indexedDB: idbFake({ failOpen: true }), localStorage: storageFake({ failWrites: true }) } });
  assert.ok(storage, 'an adapter exists so the failure is reported rather than silently skipped');
  const loaded = await storage.loadStory('chat:U');
  assert.equal(loaded.status, 'UNAVAILABLE'); assert.equal(loaded.errorCode, 'STORAGE_UNAVAILABLE');
  const err = await storage.saveStory('chat:U', { brain: { x: 1 } }).catch((e) => e);
  assert.equal(err.code, 'STORAGE_UNAVAILABLE'); assert.equal(storage.diagnostics().lastErrorCode, 'STORAGE_UNAVAILABLE');
  assert.equal(createInstalledStorage({ host: {} }), null, 'a host with no storage at all yields no adapter (reported as NO_STORAGE by the session)');
});

test('multi-tab writers with Web Locks: a tab that did not see the other tab\'s newer checkpoint is rejected (STALE_WRITER), its checkpoint preserved, the newer one intact', async () => {
  const shared = slow(createMemoryBackend()), locks = locksFake();
  const tabA = new InstalledStorageAdapter({ backend: shared, locks, writerId: 'tabA' });
  const tabB = new InstalledStorageAdapter({ backend: shared, locks, writerId: 'tabB' });
  await tabA.saveStory('chat:M', { brain: { tab: 'A', n: 0 }, host: { tab: 'A', n: 0 } });
  assert.equal((await tabB.loadStory('chat:M')).generation, 1, 'both tabs have seen generation 1');
  await tabA.saveStory('chat:M', { brain: { tab: 'A', n: 1 }, host: { tab: 'A', n: 1 } }); // generation 2, unseen by B
  const err = await tabB.saveStory('chat:M', { brain: { tab: 'B', n: 1 }, host: { tab: 'B', n: 1 } }).catch((e) => e);
  assert.equal(err.code, 'STALE_WRITER'); assert.equal(err.details.lastSeenGeneration, 1); assert.equal(err.details.newerGeneration, 2); assert.equal(err.details.preserved, true);
  const loaded = await tabA.loadStory('chat:M');
  assert.equal(loaded.status, 'CURRENT'); assert.equal(loaded.generation, 2); assert.deepEqual([loaded.parts.brain.tab, loaded.parts.host.tab], ['A', 'A'], 'the newer checkpoint was not overwritten');
  const conflicts = await tabB.readWriteConflicts('chat:M');
  assert.equal(conflicts.length, 1); assert.equal(conflicts[0].writerId, 'tabB'); assert.equal(conflicts[0].reason, 'NEWER_GENERATION_EXISTS');
  const preserved = await tabB.loadWriteConflict(conflicts[0].key);
  assert.equal(preserved.status, 'PRESERVED'); assert.deepEqual(preserved.parts.brain, { tab: 'B', n: 1 }, 'the stale tab\'s checkpoint is recoverable');
  assert.equal(tabB.diagnostics().lastErrorCode, 'STALE_WRITER');
  // Further saves by the stale tab keep failing and keep ONE conflict record (the latest attempt), never growing storage.
  await tabB.saveStory('chat:M', { brain: { tab: 'B', n: 2 }, host: { tab: 'B', n: 2 } }).catch(() => {});
  const again = await tabB.readWriteConflicts('chat:M');
  assert.equal(again.length, 1); assert.deepEqual((await tabB.loadWriteConflict(again[0].key)).parts.brain, { tab: 'B', n: 2 });
  // Tab A keeps saving normally, and its collection never deletes the preserved checkpoint.
  for (let n = 2; n <= 5; n += 1) await tabA.saveStory('chat:M', { brain: { tab: 'A', n }, host: { tab: 'A', n } });
  assert.equal((await tabB.loadWriteConflict(again[0].key)).status, 'PRESERVED');
  // Reloading the stale tab resolves it: it now knows the newest generation and saves on top of it.
  await tabB.loadStory('chat:M');
  const latestA = (await tabA.loadStory('chat:M')).generation;
  const ok = await tabB.saveStory('chat:M', { brain: { tab: 'B', n: 9 }, host: { tab: 'B', n: 9 } });
  assert.ok(ok.generation > latestA, 'numbered past every existing key, including preserved conflict parts'); assert.deepEqual((await tabA.loadStory('chat:M')).parts.brain, { tab: 'B', n: 9 });
});

test('multi-tab writers without Web Locks: racing saves resolve by an atomic manifest switch; the loser is rejected and preserved, the winner is intact', async () => {
  for (let round = 0; round < 12; round += 1) {
    const shared = slow(createMemoryBackend());
    const tabA = new InstalledStorageAdapter({ backend: shared, locks: null, writerId: 'A' + round });
    const tabB = new InstalledStorageAdapter({ backend: shared, locks: null, writerId: 'B' + round });
    await tabA.saveStory('chat:N', { brain: { w: 'A', n: 0 }, host: { w: 'A', n: 0 } });
    await tabB.loadStory('chat:N');
    const results = await Promise.allSettled([
      tabA.saveStory('chat:N', { brain: { w: 'A', n: 1 }, host: { w: 'A', n: 1 } }),
      (async () => { for (let i = 0; i < round % 4; i += 1) await tick(); return tabB.saveStory('chat:N', { brain: { w: 'B', n: 1 }, host: { w: 'B', n: 1 } }); })(),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled').length, lost = results.filter((r) => r.status === 'rejected');
    assert.equal(won, 1, `round ${round}: exactly one writer wins`);
    assert.ok(lost.every((r) => r.reason.code === 'STALE_WRITER'), `round ${round}: the loser is a reported write conflict`);
    const loaded = await new InstalledStorageAdapter({ backend: shared, locks: null }).loadStory('chat:N');
    assert.equal(loaded.status, 'CURRENT', `round ${round}`);
    assert.deepEqual([loaded.parts.brain.w, loaded.parts.brain.n], [loaded.parts.host.w, loaded.parts.host.n], `round ${round}: never a torn mix`);
    const loser = results[0].status === 'rejected' ? tabA : tabB;
    const conflicts = await loser.readWriteConflicts('chat:N');
    assert.equal(conflicts.length, 1);
    assert.equal((await loser.loadWriteConflict(conflicts[0].key)).status, 'PRESERVED', `round ${round}: the losing checkpoint is recoverable`);
  }
});

test('corrupt manifest JSON: recovered from the backup manifest, reported, and not collected by the next save', async () => {
  const backend = createMemoryBackend();
  const a = new InstalledStorageAdapter({ backend });
  await a.saveStory('chat:C', { brain: { gen: 1 } });
  await a.saveStory('chat:C', { brain: { gen: 2 } });
  const manifestKey = (await backend.keys('area52/v1/manifest/'))[0];
  await backend.set(manifestKey, '{"format":"area52-installed-storage", truncated');
  const loaded = await a.loadStory('chat:C');
  assert.equal(loaded.status, 'RECOVERED_BACKUP_MANIFEST', 'never EMPTY'); assert.equal(loaded.parts.brain.gen, 1); assert.equal(loaded.manifestState, 'CORRUPT');
  const keysBefore = await backend.keys('area52/v1/part/');
  const saved = await a.saveStory('chat:C', { brain: { gen: 3 } });
  assert.equal(saved.replacedCorruptManifest, true); assert.equal(saved.collectionSkipped, true);
  for (const key of keysBefore) assert.notEqual(await backend.get(key), null, 'no existing part was deleted by the recovering save');
  assert.equal((await a.loadStory('chat:C')).parts.brain.gen, 3);
});

test('manifest and backup both unreadable: CORRUPT_MANIFEST is reported (not EMPTY) and every part on disk is quarantined, never collected', async () => {
  const backend = createMemoryBackend();
  const a = new InstalledStorageAdapter({ backend });
  for (let g = 1; g <= 3; g += 1) await a.saveStory('chat:X', { brain: { gen: g } });
  for (const key of [...await backend.keys('area52/v1/manifest/'), ...await backend.keys('area52/v1/manifest-backup/')]) await backend.set(key, 'not json');
  const loaded = await a.loadStory('chat:X');
  assert.equal(loaded.status, 'CORRUPT_MANIFEST'); assert.deepEqual(loaded.parts, {});
  const orphaned = await backend.keys('area52/v1/part/');
  assert.ok(orphaned.length >= 2);
  const saved = await a.saveStory('chat:X', { brain: { gen: 4 } });
  assert.equal(saved.quarantinedPartKeys, orphaned.length);
  for (let g = 5; g <= 8; g += 1) await a.saveStory('chat:X', { brain: { gen: g } }); // normal collection resumes
  for (const key of orphaned) assert.notEqual(await backend.get(key), null, 'quarantined parts survive later collections');
  const q = await a.quarantineForStory('chat:X');
  assert.equal(q.length, 1); assert.equal(q[0].reason, 'MANIFEST_AND_BACKUP_UNREADABLE');
  assert.equal(a.diagnostics().quarantines, 1);
  assert.equal((await a.loadStory('chat:X')).parts.brain.gen, 8);
  await a.deleteStory('chat:X');
  assert.deepEqual([...backend._map.keys()], [], 'an explicit delete removes the story, quarantine included');
});

test('multi-tab writers that pick the SAME generation (both scan before either writes) never overwrite each other\'s parts, and the second switch is refused', async () => {
  const inner = createMemoryBackend();
  const seed = new InstalledStorageAdapter({ backend: inner, locks: null, writerId: 'seed' });
  await seed.saveStory('chat:S', { brain: { w: 'seed' }, host: { w: 'seed' } });
  // Barrier: each writer's part-key scan waits until both writers have scanned, so both choose the same generation.
  let scanned = 0, release; const bothScanned = new Promise((resolve) => { release = resolve; });
  let aManifest; const bDone = new Promise((resolve) => { aManifest = resolve; });
  const gated = (writer) => ({ ...inner,
    async keys(prefix) { const out = await inner.keys(prefix); if (prefix.includes('/part/') && scanned < 2) { scanned += 1; if (scanned === 2) release(); await bothScanned; } return out; },
    async compareAndSet(key, expected, value) { if (writer === 'A' && key.includes('/manifest/')) await bDone; return inner.compareAndSet(key, expected, value); } });
  const tabA = new InstalledStorageAdapter({ backend: gated('A'), locks: null, writerId: 'A' });
  const tabB = new InstalledStorageAdapter({ backend: gated('B'), locks: null, writerId: 'B' });
  const pA = tabA.saveStory('chat:S', { brain: { w: 'A' }, host: { w: 'A' } }).catch((e) => e);
  const rB = await tabB.saveStory('chat:S', { brain: { w: 'B' }, host: { w: 'B' } }); aManifest();
  const eA = await pA;
  assert.equal(eA.code, 'STALE_WRITER'); assert.equal(eA.details.reason, 'LOST_SWITCH_RACE'); assert.equal(eA.details.newerGeneration, rB.generation);
  const loaded = await seed.loadStory('chat:S');
  assert.equal(loaded.status, 'CURRENT', 'the winning manifest points at parts no other writer overwrote');
  assert.deepEqual([loaded.parts.brain.w, loaded.parts.host.w], ['B', 'B']);
  const conflict = (await tabA.readWriteConflicts('chat:S'))[0];
  assert.deepEqual((await tabA.loadWriteConflict(conflict.key)).parts.brain, { w: 'A' }, 'writer-unique keys: A\'s parts were never overwritten and stay recoverable');
});

test('no Web Locks and no compare-and-set (localStorage-like): an overwrite right after the switch is detected by read-back and preserved as a conflict', async () => {
  const inner = createMemoryBackend();
  const seed = new InstalledStorageAdapter({ backend: { ...inner, compareAndSet: undefined }, locks: null, writerId: 'seed' });
  await seed.saveStory('chat:L', { brain: { w: 'seed' } });
  let other = null;
  const racing = { ...inner, compareAndSet: undefined, async set(key, value) { await inner.set(key, value); if (key.includes('/manifest/') && other) { const text = other; other = null; await inner.set(key, text); } } };
  const tab = new InstalledStorageAdapter({ backend: racing, locks: null, writerId: 'T' });
  await tab.loadStory('chat:L');
  const winner = new InstalledStorageAdapter({ backend: { ...inner, compareAndSet: undefined }, locks: null, writerId: 'W' });
  await winner.loadStory('chat:L');
  await winner.saveStory('chat:L', { brain: { w: 'W' } });
  const winnerManifest = await inner.get((await inner.keys('area52/v1/manifest/'))[0]);
  await tab.loadStory('chat:L'); // T is current now; the race below happens at T's switch
  other = winnerManifest.replace('"generation":2', '"generation":9');
  const err = await tab.saveStory('chat:L', { brain: { w: 'T' } }).catch((e) => e);
  assert.equal(err.code, 'STALE_WRITER'); assert.equal(err.details.reason, 'OVERWRITTEN_AFTER_SWITCH');
  assert.deepEqual((await tab.loadWriteConflict((await tab.readWriteConflicts('chat:L'))[0].key)).parts.brain, { w: 'T' }, 'the overwritten checkpoint is preserved');
});

test('IndexedDB compare-and-set runs in one transaction and refuses a switch over a manifest that changed', async () => {
  const backend = createIndexedDbBackend({ indexedDB: idbFake() });
  await backend.set('k', 'v1');
  assert.equal(await backend.compareAndSet('k', 'v0', 'x'), false); assert.equal(await backend.get('k'), 'v1');
  assert.equal(await backend.compareAndSet('k', 'v1', 'v2'), true); assert.equal(await backend.get('k'), 'v2');
  assert.equal(await backend.compareAndSet('new', null, 'n1'), true); assert.equal(await backend.get('new'), 'n1');
  const tabA = new InstalledStorageAdapter({ backend, locks: null, writerId: 'A' }), tabB = new InstalledStorageAdapter({ backend, locks: null, writerId: 'B' });
  await tabA.saveStory('chat:I', { brain: { w: 'A' } }); await tabB.loadStory('chat:I');
  await tabA.saveStory('chat:I', { brain: { w: 'A2' } });
  assert.equal((await tabB.saveStory('chat:I', { brain: { w: 'B' } }).catch((e) => e)).code, 'STALE_WRITER');
  assert.deepEqual((await tabA.loadStory('chat:I')).parts.brain, { w: 'A2' });
});
