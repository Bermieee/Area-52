// Follow-up (audit D3): installed storage adapter guarantees. FAKE backends only (memory, a Storage fake and a
// minimal IndexedDB fake); not a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { InstalledStorageAdapter, createMemoryBackend, createLocalStorageBackend, createIndexedDbBackend } from '../src/deployment/installed-storage.js';

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
  assert.equal((await backend.keys('area52/v1/part/')).some((k) => k.endsWith('/orphan')), false);
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
