// Wave 7 (audit D3): with a host store supplied, a reload must restore Brain, Memory AND Lore (including the
// story binding), not only the Brain snapshot. The storage medium is the host's decision; this test uses an
// in-memory store. FAKE-HOST evidence only; not a real SillyTavern reload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Area52NativeBrain } from '../src/native-brain.js';
import { createDevelopmentDeploymentSillyTavernSession } from '../src/deployment/sillytavern-live.js';
import { createGoldenDeploymentLorebook } from '../src/deployment/brain.js';
import { EV } from './helpers/installed-host.mjs';

function make({ store, restore = null }) {
  const listeners = new Map();
  const context = { chatId: 'chat:w7', chat: [], mainApi: 'openai', eventTypes: EV,
    eventSource: { on(t, f) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); }, removeListener(t, f) { listeners.get(t)?.delete(f); } },
    async setExtensionPrompt() {} };
  const emit = async (t, ...a) => { for (const f of [...(listeners.get(t) ?? [])]) await f(...a); };
  const nativeBrain = restore ? Area52NativeBrain.fromSnapshot(restore.snapshot) : new Area52NativeBrain();
  const session = createDevelopmentDeploymentSillyTavernSession({
    sillyTavern: { getContext: () => context }, document: null, mountUi: false, nativeBrain,
    memoryOwnerSnapshot: restore?.memoryOwnerSnapshot ?? null, loreOwnerSnapshot: restore?.loreOwnerSnapshot ?? null,
    persistNativeBrain: async (payload) => { store.payloads.push(payload); },
  });
  session.start();
  let n = 0;
  const turn = async (u, r) => {
    context.chat.push({ is_user: true, mes: u, mesId: 'u' + (++n) });
    await emit(EV.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
    const req = { chat: [{ role: 'system', content: 's' }, { role: 'user', content: u }] };
    await emit(EV.CHAT_COMPLETION_PROMPT_READY, req);
    context.chat.push({ is_user: false, mes: r, mesId: 'a' + (++n) });
    await emit(EV.MESSAGE_RECEIVED, context.chat.length - 1, 'normal');
    return req;
  };
  return { session, nativeBrain, turn };
}

test('a reload with the supplied host store restores Lore, its story binding and the Brain', async () => {
  const store = { payloads: [] };
  const a = make({ store });
  a.session.ingestLorebook({ ...createGoldenDeploymentLorebook(), chatId: 'chat:w7' });
  await a.turn('Mara wipes the bar.', 'Eris walks in.');
  await a.turn('Eris sits down.', 'Mara pours ale.');
  const last = store.payloads.at(-1);
  assert.ok(last?.snapshot, 'Brain snapshot persisted');
  // Host store contract: keep the newest Brain/Memory snapshot and the newest Lore snapshot that was sent.
  const lastLore = [...store.payloads].reverse().find((p) => p.loreOwnerSnapshot);
  assert.ok(lastLore, 'Lore owner snapshot persisted with a checkpoint');
  const restore = JSON.parse(JSON.stringify({ ...last, loreOwnerSnapshot: lastLore.loreOwnerSnapshot }));
  a.session.destroy();

  const b = make({ store: { payloads: [] }, restore });
  const lore = b.session.brain.loreIntelligence;
  assert.equal(lore.storyAuthority.scopeReceipt('chat:w7').state, 'BOUND', 'story binding restored');
  assert.ok((lore.status({ chatId: 'chat:w7' }).entries ?? []).length > 0, 'studied Lore restored');
  assert.ok(b.nativeBrain.turns.size >= 2, 'Brain turns restored');
  const req = await b.turn('Where is the Sun Blade?', 'Nobody knows.');
  assert.ok(JSON.stringify(req.chat).includes('Sun Blade'), 'restored Lore reaches the next prepared context without re-accepting the lorebook');
  b.session.destroy();
});

test('Lore owner snapshot is only re-persisted when Lore changed', async () => {
  const store = { payloads: [] };
  const a = make({ store });
  a.session.ingestLorebook({ ...createGoldenDeploymentLorebook(), chatId: 'chat:w7' });
  await a.turn('Mara wipes the bar.', 'Eris walks in.');
  await a.turn('Eris sits down.', 'Mara pours ale.');
  const withLore = store.payloads.filter((p) => p.loreOwnerSnapshot);
  assert.equal(withLore.length, 1, 'unchanged Lore is not re-serialized every turn');
  assert.ok(store.payloads.every((p) => typeof p.loreOwnerRevisionKey === 'string'));
  a.session.destroy();
});
