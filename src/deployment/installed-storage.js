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

export class StorageUnavailableError extends Error {
  constructor(message = 'No durable browser storage is usable', details = {}) { super(message); this.name = 'StorageUnavailableError'; this.code = 'STORAGE_UNAVAILABLE'; this.details = details; }
}

// Private windows and locked-down hosts can expose indexedDB/localStorage objects that fail on use (IndexedDB open
// rejected, setItem always throwing). The failover backend probes each candidate once with a real write/read/delete and
// uses the first that works; when none does, every operation rejects with STORAGE_UNAVAILABLE (loads then report
// UNAVAILABLE, never EMPTY). It never switches backend after one has worked, so data is never split across two media.
export function createFailoverBackend(candidates = []) {
  let chosen = null, probing = null;
  const attempts = [];
  const probe = async () => {
    for (const { kind, create } of candidates) {
      try {
        const backend = create();
        const key = '__area52_probe__/' + Math.random().toString(36).slice(2);
        await backend.set(key, 'ok');
        const back = await backend.get(key);
        await backend.delete(key);
        if (back !== 'ok') throw new Error('probe read back ' + String(back));
        attempts.push({ kind, ok: true });
        return backend;
      } catch (error) { attempts.push({ kind, ok: false, error: String(error?.name ?? '') + ': ' + String(error?.message ?? error).slice(0, 120) }); }
    }
    throw new StorageUnavailableError('No durable browser storage is usable', { attempts: [...attempts] });
  };
  const ready = async () => chosen ?? (chosen = await (probing ??= probe()));
  return {
    get kind() { return chosen?.kind ?? 'FAILOVER_UNRESOLVED'; },
    attempts: () => attempts.map((row) => ({ ...row })),
    async get(key) { return (await ready()).get(key); },
    async set(key, value) { return (await ready()).set(key, value); },
    async delete(key) { return (await ready()).delete(key); },
    async keys(prefix = '') { return (await ready()).keys(prefix); },
  };
}

// Picks the best usable backend (IndexedDB, then localStorage, each probed on first use); null when the host exposes
// neither (the caller keeps working, unpersisted, and says so).
export function selectInstalledBackend(host = globalThis) {
  const candidates = [];
  try { if (host.indexedDB) { const indexedDB = host.indexedDB; candidates.push({ kind: 'INDEXED_DB', create: () => createIndexedDbBackend({ indexedDB }) }); } } catch { /* getter threw: not usable */ }
  try { if (host.localStorage) { const storage = host.localStorage; candidates.push({ kind: 'LOCAL_STORAGE', create: () => createLocalStorageBackend(storage) }); } } catch { /* getter threw (SecurityError) */ }
  return candidates.length ? createFailoverBackend(candidates) : null;
}

// QuotaExceededError across browsers (DOMException name, legacy codes 22 / 1014, Firefox NS_ERROR_DOM_QUOTA_REACHED).
export function isQuotaError(error) {
  const name = String(error?.name ?? ''), code = Number(error?.code);
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014 || /quota/i.test(String(error?.message ?? ''));
}
function storageErrorCode(error) {
  if (error?.code === 'STORAGE_UNAVAILABLE') return 'STORAGE_UNAVAILABLE';
  return isQuotaError(error) ? 'QUOTA_EXCEEDED' : 'WRITE_FAILED';
}

const checksum = (text) => sha256Hex(text).slice(0, 32);
const storyKey = (chatId) => 'story:' + sha256Hex('chat|' + String(chatId)).slice(0, 24);

// Generation of a part key `<ns>/part/<scope>/<generation>.<writer>/<name>` (older keys have no writer suffix).
const keyGeneration = (key, prefix) => Number.parseInt(String(key).slice(prefix.length).split('/')[0], 10);

export class InstalledStorageAdapter {
  constructor({ backend, namespace = 'area52/v1', now = () => Date.now(), locks = globalThis.navigator?.locks ?? null, writerId = null } = {}) {
    if (!backend || typeof backend.get !== 'function' || typeof backend.set !== 'function') throw new TypeError('a storage backend is required');
    this.backend = backend;
    this.namespace = namespace;
    this.now = now;
    // Cross-tab serialisation (Web Locks) when the host has it; the in-tab queue always applies.
    this.locks = locks && typeof locks.request === 'function' ? locks : null;
    // Distinct per adapter instance (per tab): two writers never write the same part key.
    this.writerId = String(writerId ?? Math.random().toString(36).slice(2, 10));
    this.queue = Promise.resolve();
    this.lastError = null;
    this.lastErrorCode = null;
    this.seenGeneration = new Map();
    this.stats = { saves: 0, failedSaves: 0, loads: 0, fallbacks: 0, partsWritten: 0, partsReused: 0, bytesWritten: 0, quotaFailures: 0, concurrentWriterOverwrites: 0, backupManifestRecoveries: 0, quarantines: 0 };
  }

  #manifestKey(scope) { return `${this.namespace}/manifest/${scope}`; }
  #backupKey(scope) { return `${this.namespace}/manifest-backup/${scope}`; }
  #partPrefix(scope) { return `${this.namespace}/part/${scope}/`; }
  #partKey(scope, generation, name) { return `${this.#partPrefix(scope)}${generation}.${this.writerId}/${name}`; }
  #quarantinePrefix(scope) { return `${this.namespace}/quarantine/${scope}/`; }

  // Keys held by quarantine records (parts that were on disk when an unreadable manifest was replaced). Never collected.
  async #quarantinedKeys(scope) {
    const held = new Set();
    for (const key of await this.backend.keys(this.#quarantinePrefix(scope))) {
      try { for (const partKey of JSON.parse(await this.backend.get(key))?.partKeys ?? []) held.add(partKey); } catch { /* unreadable record: holds nothing new */ }
    }
    return held;
  }

  // {state: MISSING | OK | CORRUPT | READ_FAILED, manifest?, raw?, error?}. Corrupt JSON is CORRUPT, never "empty".
  async #readManifestAt(key, scope) {
    let raw;
    try { raw = await this.backend.get(key); } catch (error) { return { state: 'READ_FAILED', error }; }
    if (raw == null) return { state: 'MISSING' };
    try {
      const manifest = JSON.parse(raw);
      if (manifest?.format === INSTALLED_STORAGE_FORMAT && manifest.version === INSTALLED_STORAGE_VERSION && manifest.scope === scope) return { state: 'OK', manifest, raw };
    } catch { /* corrupt */ }
    return { state: 'CORRUPT' };
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

  #withLock(scope, run) {
    return this.locks ? this.locks.request(`area52-storage:${this.namespace}:${scope}`, { mode: 'exclusive' }, run) : run();
  }

  // Serialised: two saves never interleave their part writes and manifest switches (in this tab by the queue, across tabs by
  // Web Locks when available; without locks, writer-unique part keys and the collection rule below still prevent a torn mix).
  #commit(scope, { parts, meta = {}, retainUnlisted = false }) {
    const run = async () => {
      const main = await this.#readManifestAt(this.#manifestKey(scope), scope);
      if (main.state === 'READ_FAILED') throw main.error;
      // A corrupt current manifest is replaced from its backup (the manifest it replaced), so recoverable parts stay
      // referenced and are not collected.
      let base = main.state === 'OK' ? main.manifest : null, baseRaw = main.state === 'OK' ? main.raw : null;
      if (main.state === 'CORRUPT') { const backup = await this.#readManifestAt(this.#backupKey(scope), scope); if (backup.state === 'OK') { base = backup.manifest; baseRaw = backup.raw; } }
      const prefix = this.#partPrefix(scope);
      const existing = await this.backend.keys(prefix);
      // Replacing an unreadable manifest: nothing is collected in this save, and when no backup could be read either, every
      // part on disk is placed in quarantine first (kept for manual recovery, reported, never collected).
      const recoveringCorruptManifest = main.state === 'CORRUPT';
      let quarantine = null;
      if (recoveringCorruptManifest && !base && existing.length) {
        let corruptManifestRaw = null; try { corruptManifestRaw = String(await this.backend.get(this.#manifestKey(scope)) ?? '').slice(0, 65536); } catch { /* unreadable */ }
        quarantine = { key: `${this.#quarantinePrefix(scope)}${this.now()}.${this.writerId}`, partKeys: [...existing].sort() };
        await this.backend.set(quarantine.key, JSON.stringify({ kind: 'Area52StorageQuarantine', scope, at: this.now(), reason: 'MANIFEST_AND_BACKUP_UNREADABLE', partKeys: quarantine.partKeys, corruptManifestRaw }));
      }
      const highest = existing.reduce((n, key) => Math.max(n, keyGeneration(key, prefix) || 0), 0);
      const generation = Math.max(base?.generation ?? 0, highest) + 1;
      const seen = this.seenGeneration.get(scope);
      const concurrentWriter = base != null && seen != null && base.generation > seen;
      const table = retainUnlisted && base ? { ...base.parts } : {};
      const written = [];
      try {
        for (const [name, payload] of Object.entries(parts)) {
          if (payload === undefined) continue;
          const text = JSON.stringify(payload);
          const sum = checksum(text);
          // An unchanged part (same checksum as the current generation's) is referenced, not rewritten.
          const prior = base?.parts?.[name];
          if (prior && prior.checksum === sum && prior.bytes === text.length) { table[name] = prior; this.stats.partsReused += 1; continue; }
          const key = this.#partKey(scope, generation, name);
          await this.backend.set(key, text);
          written.push(key);
          this.stats.bytesWritten += text.length; this.stats.partsWritten += 1;
          table[name] = { key, checksum: sum, bytes: text.length };
        }
        const manifest = {
          format: INSTALLED_STORAGE_FORMAT, version: INSTALLED_STORAGE_VERSION, scope, ...meta, generation, writerId: this.writerId,
          savedAt: this.now(), parts: table, previous: base ? { generation: base.generation, parts: base.parts, savedAt: base.savedAt } : null,
        };
        if (baseRaw != null) await this.backend.set(this.#backupKey(scope), baseRaw); // the manifest being replaced
        await this.backend.set(this.#manifestKey(scope), JSON.stringify(manifest)); // the atomic switch
        this.seenGeneration.set(scope, generation);
        if (concurrentWriter) this.stats.concurrentWriterOverwrites += 1;
        if (quarantine) this.stats.quarantines += 1;
        if (!recoveringCorruptManifest) await this.#collect(scope, manifest);
        return { scope, generation, bytes: Object.values(table).reduce((n, row) => n + row.bytes, 0),
          ...(recoveringCorruptManifest ? { replacedCorruptManifest: true, collectionSkipped: true } : {}),
          ...(quarantine ? { quarantinedPartKeys: quarantine.partKeys.length, quarantineKey: quarantine.key } : {}),
          ...(concurrentWriter ? { concurrentWriterDetected: true, overwrittenGeneration: base.generation, lastSeenGeneration: seen } : {}) };
      } catch (error) {
        // Parts of this failed attempt are unreferenced: remove them now (on quota exhaustion this frees the space the
        // next attempt needs). The previous generation is untouched.
        for (const key of written) { try { await this.backend.delete(key); } catch { /* collected later */ } }
        throw error;
      }
    };
    const locked = () => this.#withLock(scope, run);
    const next = this.queue.then(locked, locked).then((value) => { this.stats.saves += 1; return value; }, (error) => {
      this.stats.failedSaves += 1; this.lastError = String(error?.message ?? error).slice(0, 200); this.lastErrorCode = storageErrorCode(error);
      if (this.lastErrorCode === 'QUOTA_EXCEEDED') this.stats.quotaFailures += 1;
      if (error && typeof error === 'object' && !error.storageCode) { try { error.storageCode = this.lastErrorCode; } catch { /* frozen */ } }
      throw error;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  // Drops parts referenced by neither the current nor the previous generation: every part older than the previous
  // generation, and this writer's own orphans. A newer part of another writer (a save still in flight in another tab) is
  // never deleted. Failure here is harmless: the data is merely retained.
  async #collect(scope, manifest) {
    try {
      const keep = new Set([...Object.values(manifest.parts), ...Object.values(manifest.previous?.parts ?? {})].map((row) => row.key));
      for (const key of await this.#quarantinedKeys(scope)) keep.add(key);
      const floor = manifest.previous?.generation ?? manifest.generation;
      const prefix = this.#partPrefix(scope);
      for (const key of await this.backend.keys(prefix)) {
        if (keep.has(key)) continue;
        const generation = keyGeneration(key, prefix);
        const own = String(key).slice(prefix.length).split('/')[0].endsWith('.' + this.writerId);
        if (!(generation < floor || (own && generation <= manifest.generation))) continue;
        await this.backend.delete(key);
      }
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

  async #loadFrom(manifest, expect) {
    if (expect.chatId != null && manifest.chatId !== String(expect.chatId)) return { status: 'STORY_MISMATCH', generation: 0, parts: {} };
    try {
      const parts = await this.#readParts(manifest.parts);
      if (parts) return { status: 'CURRENT', generation: manifest.generation, savedAt: manifest.savedAt, parts };
    } catch { /* fall back */ }
    try {
      const parts = manifest.previous ? await this.#readParts(manifest.previous.parts) : null;
      if (parts) { this.stats.fallbacks += 1; return { status: 'RECOVERED_PREVIOUS_GENERATION', generation: manifest.previous.generation, savedAt: manifest.previous.savedAt, parts, discardedGeneration: manifest.generation }; }
    } catch { /* corrupt */ }
    return null;
  }

  async #load(scope, expect = {}) {
    this.stats.loads += 1;
    const main = await this.#readManifestAt(this.#manifestKey(scope), scope);
    if (main.state === 'READ_FAILED') return { status: 'UNAVAILABLE', generation: 0, parts: {}, errorCode: storageErrorCode(main.error), error: String(main.error?.message ?? main.error).slice(0, 160) };
    if (main.state === 'MISSING') return { status: 'EMPTY', generation: 0, parts: {} };
    if (main.state === 'OK') {
      this.seenGeneration.set(scope, main.manifest.generation);
      const result = await this.#loadFrom(main.manifest, expect);
      if (result) return result;
    }
    // Current manifest corrupt, or both of its generations unreadable: try the backup manifest (the one it replaced).
    const backup = await this.#readManifestAt(this.#backupKey(scope), scope);
    if (backup.state === 'OK') {
      const result = await this.#loadFrom(backup.manifest, expect);
      if (result?.status === 'STORY_MISMATCH') return result;
      if (result) { this.stats.backupManifestRecoveries += 1; return { ...result, status: 'RECOVERED_BACKUP_MANIFEST', recoveredFrom: result.status, manifestState: main.state }; }
    }
    return { status: main.state === 'CORRUPT' ? 'CORRUPT_MANIFEST' : 'CORRUPT', generation: 0, parts: {}, discardedGeneration: main.manifest?.generation ?? null };
  }

  loadStory(chatId) { return this.#load(storyKey(chatId), { chatId }); }
  loadOwners() { return this.#load('owners'); }

  // Quarantine records of a story (parts kept after its manifest became unreadable); for diagnostics and manual recovery.
  async quarantineForStory(chatId) {
    const scope = storyKey(chatId), out = [];
    for (const key of await this.backend.keys(this.#quarantinePrefix(scope))) { try { const row = JSON.parse(await this.backend.get(key)); out.push({ key, at: row.at, reason: row.reason, partKeys: row.partKeys?.length ?? 0 }); } catch { out.push({ key, unreadable: true }); } }
    return out;
  }

  // An explicit delete removes everything of the story, quarantine included (the operator asked for it).
  async deleteStory(chatId) {
    const scope = storyKey(chatId);
    const run = async () => {
      for (const key of await this.backend.keys(this.#quarantinePrefix(scope))) await this.backend.delete(key);
      for (const key of await this.backend.keys(this.#partPrefix(scope))) await this.backend.delete(key);
      await this.backend.delete(this.#backupKey(scope));
      await this.backend.delete(this.#manifestKey(scope));
    };
    const locked = () => this.#withLock(scope, run);
    const next = this.queue.then(locked, locked);
    this.queue = next.catch(() => {});
    return next;
  }

  async flush() { await this.queue; }
  diagnostics() {
    return { kind: 'InstalledStorageDiagnostics', backend: this.backend.kind ?? 'CUSTOM', namespace: this.namespace, writerId: this.writerId, crossTabLocks: Boolean(this.locks),
      ...this.stats, lastError: this.lastError, lastErrorCode: this.lastErrorCode, ...(typeof this.backend.attempts === 'function' ? { backendAttempts: this.backend.attempts() } : {}) };
  }
}

export function createInstalledStorage(options = {}) {
  const backend = options.backend ?? selectInstalledBackend(options.host ?? globalThis);
  return backend ? new InstalledStorageAdapter({ ...options, backend }) : null;
}
