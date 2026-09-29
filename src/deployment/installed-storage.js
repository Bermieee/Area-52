// Installed durable storage for the SillyTavern extension (audit D3 / Wave 7 follow-up).
//
// Layout (all keys under one namespace):
//   manifest/<scope>              one small JSON record: generation, part table (key, checksum, bytes), the previous
//                                 generation's part table, timestamps. The manifest is written LAST, so it is the single
//                                 atomic switch between generations.
//   part/<scope>/<generation>/<n> the payload of one named part, JSON text, checksummed.
// Scopes: `story:<key>` (Brain snapshot and host bookkeeping of ONE chat) and `owners` (Lore, Memory and Scene owner
// state; each owner scopes its own reads per story, so they are stored once).
//
// Guarantees: an interrupted save leaves the previous generation readable; a part that fails its checksum makes the
// loader fall back to the previous generation; nothing throws on load (the caller gets a status). Storage medium is a
// backend (IndexedDB in the installed browser, localStorage fallback, memory for tests).
import { sha256Hex } from '../coprocessor/browser-compat.js';

export const INSTALLED_STORAGE_FORMAT = 'area52-installed-storage';
export const INSTALLED_STORAGE_VERSION = 1;

export function createMemoryBackend() {
  const map = new Map();
  return {
    kind: 'MEMORY',
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, value) { map.set(key, String(value)); },
    async delete(key) { map.delete(key); },
    async keys(prefix = '') { return [...map.keys()].filter((key) => key.startsWith(prefix)); },
    _map: map,
  };
}

export function createLocalStorageBackend(storage = globalThis.localStorage) {
  if (!storage) throw new Error('localStorage is unavailable');
  return {
    kind: 'LOCAL_STORAGE',
    async get(key) { return storage.getItem(key); },
    async set(key, value) { storage.setItem(key, String(value)); },
    async delete(key) { storage.removeItem(key); },
    async keys(prefix = '') { const out = []; for (let i = 0; i < storage.length; i += 1) { const key = storage.key(i); if (key?.startsWith(prefix)) out.push(key); } return out; },
  };
}

export function createIndexedDbBackend({ indexedDB = globalThis.indexedDB, dbName = 'area52-installed', storeName = 'kv' } = {}) {
  if (!indexedDB) throw new Error('indexedDB is unavailable');
  let dbPromise = null;
  const open = () => dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error ?? new Error('indexedDB open failed')); };
  });
  const run = async (mode, work) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      const request = work(store);
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
    });
  };
  return {
    kind: 'INDEXED_DB',
    async get(key) { const value = await run('readonly', (store) => store.get(key)); return value == null ? null : String(value); },
    async set(key, value) { await run('readwrite', (store) => store.put(String(value), key)); },
    async delete(key) { await run('readwrite', (store) => store.delete(key)); },
    async keys(prefix = '') { const all = await run('readonly', (store) => store.getAllKeys()); return (all ?? []).map(String).filter((key) => key.startsWith(prefix)); },
  };
}

// Picks the best available backend; returns null when nothing durable exists (the caller keeps working, unpersisted).
export function selectInstalledBackend(host = globalThis) {
  try { if (host.indexedDB) return createIndexedDbBackend({ indexedDB: host.indexedDB }); } catch { /* fall through */ }
  try { if (host.localStorage) return createLocalStorageBackend(host.localStorage); } catch { /* fall through */ }
  return null;
}

const checksum = (text) => sha256Hex(text).slice(0, 32);
const storyKey = (chatId) => 'story:' + sha256Hex('chat|' + String(chatId)).slice(0, 24);

export class InstalledStorageAdapter {
  constructor({ backend, namespace = 'area52/v1', now = () => Date.now() } = {}) {
    if (!backend || typeof backend.get !== 'function' || typeof backend.set !== 'function') throw new TypeError('a storage backend is required');
    this.backend = backend;
    this.namespace = namespace;
    this.now = now;
    this.queue = Promise.resolve();
    this.lastError = null;
    this.stats = { saves: 0, failedSaves: 0, loads: 0, fallbacks: 0, partsWritten: 0, partsReused: 0, bytesWritten: 0 };
  }

  #manifestKey(scope) { return `${this.namespace}/manifest/${scope}`; }
  #partKey(scope, generation, name) { return `${this.namespace}/part/${scope}/${generation}/${name}`; }

  async #readManifest(scope) {
    try {
      const raw = await this.backend.get(this.#manifestKey(scope));
      if (raw == null) return null;
      const manifest = JSON.parse(raw);
      return manifest?.format === INSTALLED_STORAGE_FORMAT && manifest.version === INSTALLED_STORAGE_VERSION && manifest.scope === scope ? manifest : null;
    } catch { return null; }
  }

  async #readParts(table) {
    const parts = {};
    for (const [name, ref] of Object.entries(table ?? {})) {
      const raw = await this.backend.get(ref.key);
      if (raw == null || checksum(raw) !== ref.checksum) return null;
      parts[name] = JSON.parse(raw);
    }
    return parts;
  }

  // Serialised: two saves never interleave their part writes and manifest switches.
  #commit(scope, { parts, meta = {}, retainUnlisted = false }) {
    const run = async () => {
      const previous = await this.#readManifest(scope);
      const generation = (previous?.generation ?? 0) + 1;
      const table = retainUnlisted && previous ? { ...previous.parts } : {};
      const written = [];
      for (const [name, payload] of Object.entries(parts)) {
        if (payload === undefined) continue;
        const text = JSON.stringify(payload);
        const sum = checksum(text);
        // An unchanged part (same checksum as the current generation's) is referenced, not rewritten.
        const prior = previous?.parts?.[name];
        if (prior && prior.checksum === sum && prior.bytes === text.length) { table[name] = prior; this.stats.partsReused += 1; continue; }
        const key = this.#partKey(scope, generation, name);
        await this.backend.set(key, text);
        written.push(key);
        this.stats.bytesWritten += text.length; this.stats.partsWritten += 1;
        table[name] = { key, checksum: sum, bytes: text.length };
      }
      const manifest = {
        format: INSTALLED_STORAGE_FORMAT, version: INSTALLED_STORAGE_VERSION, scope, ...meta, generation,
        savedAt: this.now(), parts: table, previous: previous ? { generation: previous.generation, parts: previous.parts, savedAt: previous.savedAt } : null,
      };
      await this.backend.set(this.#manifestKey(scope), JSON.stringify(manifest)); // the atomic switch
      await this.#collect(scope, manifest);
      return { scope, generation, bytes: Object.values(table).reduce((n, row) => n + row.bytes, 0) };
    };
    const next = this.queue.then(run, run).then((value) => { this.stats.saves += 1; return value; }, (error) => { this.stats.failedSaves += 1; this.lastError = String(error?.message ?? error).slice(0, 200); throw error; });
    this.queue = next.catch(() => {});
    return next;
  }

  // Drops parts referenced by neither the current nor the previous generation (orphans of interrupted saves,
  // superseded generations). Failure here is harmless: the data is merely retained.
  async #collect(scope, manifest) {
    try {
      const keep = new Set([...Object.values(manifest.parts), ...Object.values(manifest.previous?.parts ?? {})].map((row) => row.key));
      for (const key of await this.backend.keys(`${this.namespace}/part/${scope}/`)) if (!keep.has(key)) await this.backend.delete(key);
    } catch { /* retained, collected next time */ }
  }

  saveStory(chatId, parts) {
    if (chatId == null || chatId === '') throw new TypeError('chatId is required');
    return this.#commit(storyKey(chatId), { parts, meta: { chatId: String(chatId) } });
  }

  // Owner parts are merged into the current table so an unchanged owner (for example Lore) is not rewritten.
  saveOwners(parts) {
    return this.#commit('owners', { parts, retainUnlisted: true });
  }

  async #load(scope, expect = {}) {
    this.stats.loads += 1;
    const manifest = await this.#readManifest(scope);
    if (!manifest) return { status: 'EMPTY', generation: 0, parts: {} };
    if (expect.chatId != null && manifest.chatId !== String(expect.chatId)) return { status: 'STORY_MISMATCH', generation: 0, parts: {} };
    try {
      const parts = await this.#readParts(manifest.parts);
      if (parts) return { status: 'CURRENT', generation: manifest.generation, savedAt: manifest.savedAt, parts };
    } catch { /* fall back */ }
    try {
      const parts = manifest.previous ? await this.#readParts(manifest.previous.parts) : null;
      if (parts) { this.stats.fallbacks += 1; return { status: 'RECOVERED_PREVIOUS_GENERATION', generation: manifest.previous.generation, savedAt: manifest.previous.savedAt, parts, discardedGeneration: manifest.generation }; }
    } catch { /* corrupt */ }
    return { status: 'CORRUPT', generation: 0, parts: {}, discardedGeneration: manifest.generation };
  }

  loadStory(chatId) { return this.#load(storyKey(chatId), { chatId }); }
  loadOwners() { return this.#load('owners'); }

  async deleteStory(chatId) {
    const scope = storyKey(chatId);
    const run = async () => {
      for (const key of await this.backend.keys(`${this.namespace}/part/${scope}/`)) await this.backend.delete(key);
      await this.backend.delete(this.#manifestKey(scope));
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async flush() { await this.queue; }
  diagnostics() { return { kind: 'InstalledStorageDiagnostics', backend: this.backend.kind ?? 'CUSTOM', namespace: this.namespace, ...this.stats, lastError: this.lastError }; }
}

export function createInstalledStorage(options = {}) {
  const backend = options.backend ?? selectInstalledBackend(options.host ?? globalThis);
  return backend ? new InstalledStorageAdapter({ ...options, backend }) : null;
}
