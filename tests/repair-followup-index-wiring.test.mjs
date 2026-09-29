// Follow-up (audit D3): the installed entry (index.js) picks a durable backend and persists a real turn through it.
// FAKE browser globals (document, localStorage, SillyTavern); not a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EV } from './helpers/installed-host.mjs';

test('index.js init selects localStorage when IndexedDB is absent and checkpoints a turn to it', async () => {
  const data = new Map();
  const storage = { get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  const listeners = new Map();
  const context = { chatId: 'chat:index', chat: [], mainApi: 'openai', eventTypes: EV,
    eventSource: { on(t, f) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); }, removeListener(t, f) { listeners.get(t)?.delete(f); } }, async setExtensionPrompt() {} };
  const emit = async (t, ...a) => { for (const f of [...(listeners.get(t) ?? [])]) await f(...a); };
  const saved = { document: globalThis.document, SillyTavern: globalThis.SillyTavern, localStorage: globalThis.localStorage, indexedDB: globalThis.indexedDB };
  globalThis.document = { readyState: 'complete', getElementById: () => null, querySelector: () => null, addEventListener() {}, body: {} };
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.Area52HeadlessHost = true;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
  try {
    const mod = await import('../index.js?wiring=' + Date.now());
    await mod.init();
    let session = mod.getSession();
    for (let i = 0; i < 100 && !session; i += 1) { await new Promise((r) => setTimeout(r, 10)); session = mod.getSession(); }
    assert.ok(session, 'session created');
    const diag = session.exportEvidence().nativeBrainIntegration.persistence;
    assert.equal(diag.configured, true);
    assert.equal(diag.storage.backend, 'LOCAL_STORAGE');
    context.chat.push({ is_user: true, mes: 'Hello there.', mesId: 'u1' });
    await emit(EV.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
    await emit(EV.CHAT_COMPLETION_PROMPT_READY, { chat: [{ role: 'system', content: 's' }, { role: 'user', content: 'Hello there.' }] });
    context.chat.push({ is_user: false, mes: 'Hi.', mesId: 'a2' });
    await emit(EV.MESSAGE_RECEIVED, 1, 'normal');
    await session.flushPersistence();
    const keys = [...data.keys()];
    assert.ok(keys.some((k) => k.includes('/manifest/story:')), 'story manifest persisted: ' + keys.join(','));
    assert.ok(keys.some((k) => k.includes('/manifest/owners')), 'owners manifest persisted');
    mod.destroy();
  } finally {
    delete globalThis.Area52HeadlessHost;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); }
  }
});
