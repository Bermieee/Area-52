// Wave 1 (audit D1, D9, D13): installed SillyTavern generation lifecycle.
// Drives the real installed session objects (createDevelopmentDeploymentSillyTavernSession +
// Area52NativeBrain) through SillyTavern's event order (public/script.js Generate()).
// FAKE-HOST evidence only; not a live SillyTavern pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Area52NativeBrain } from '../src/native-brain.js';
import { createDevelopmentDeploymentSillyTavernSession } from '../src/deployment/sillytavern-live.js';

const EV = {
  GENERATION_AFTER_COMMANDS: 'generation_after_commands', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
  GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
  MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED: 'message_edited', MESSAGE_DELETED: 'message_deleted',
  MESSAGE_UPDATED: 'message_updated', MESSAGE_SWIPED: 'message_swiped', MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
  CHAT_CHANGED: 'chat_id_changed', CHAT_LOADED: 'chatLoaded', CHAT_CREATED: 'chat_created', CHAT_RENAMED: 'chat_renamed',
  WORLDINFO_UPDATED: 'worldinfo_updated', WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
  GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped',
};
export function makeInstalled({ chatId = 'chat:w1', mainApi = 'openai', nativeBrain = new Area52NativeBrain() } = {}) {
  const listeners = new Map();
  const context = { chatId, chat: [], mainApi, eventTypes: EV,
    eventSource: { on(t, f) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); }, removeListener(t, f) { listeners.get(t)?.delete(f); } },
    async setExtensionPrompt() {} };
  const emit = async (t, ...a) => { for (const f of [...(listeners.get(t) ?? [])]) await f(...a); };
  const session = createDevelopmentDeploymentSillyTavernSession({ sillyTavern: { getContext: () => context }, document: null, mountUi: false, nativeBrain });
  session.start();
  let seq = 0;
  const user = (mes) => { context.chat.push({ is_user: true, mes, mesId: 'u' + (++seq) }); return context.chat.length - 1; };
  const assistant = (mes) => { context.chat.push({ is_user: false, mes, mesId: 'a' + (++seq) }); return context.chat.length - 1; };
  const request = () => ({ chat: [{ role: 'system', content: 'host system' }, { role: 'user', content: context.chat.at(-1)?.mes ?? '' }] });
  // One generation following Generate(): STARTED -> AFTER_COMMANDS -> combine (text or '' for openai) -> chat-completion ready -> reply -> RECEIVED -> ENDED.
  async function generate(type, reply, { textPrompt = null, failProvider = false } = {}) {
    await emit(EV.GENERATION_STARTED, type, {}, false);
    await emit(EV.GENERATION_AFTER_COMMANDS, type, {}, false);
    const combine = { prompt: mainApi === 'openai' ? '' : (textPrompt ?? `Story so far\n${context.chat.map((m) => m.mes).join('\n')}\nNarrator:`), dryRun: false };
    await emit(EV.GENERATE_AFTER_COMBINE_PROMPTS, combine);
    let req = null;
    if (mainApi === 'openai') { req = request(); await emit(EV.CHAT_COMPLETION_PROMPT_READY, req); }
    if (failProvider) { await emit(EV.GENERATION_ENDED, context.chat.length); return { req, combine, failed: true }; }
    let idx;
    if (type === 'swipe') { idx = context.chat.length - 1; context.chat[idx].mes = reply; }
    else if (type === 'continue') { idx = context.chat.length - 1; context.chat[idx].mes += ' ' + reply; }
    else if (type === 'quiet' || type === 'impersonate') { await emit(EV.GENERATION_ENDED, context.chat.length); return { req, combine }; }
    else idx = assistant(reply);
    await emit(EV.MESSAGE_RECEIVED, idx, type);
    await emit(EV.GENERATION_ENDED, context.chat.length);
    return { req, combine, idx };
  }
  const injected = (r) => (r.req ? r.req.chat.length - 2 : (r.combine.prompt.includes('[Area-52') || r.combine.prompt.includes('## ') ? 1 : 0));
  const errors = () => session.exportEvidence().errors.map((e) => e.stage + ': ' + e.message);
  const learned = () => session.nativeHistory.filter((r) => r.state === 'RESPONSE_COMPLETED');
  return { context, emit, session, nativeBrain, user, assistant, generate, injected, errors, learned };
}

test('normal, swipe, regenerate and continue each inject prepared context and learn their response exactly once', async () => {
  const h = makeInstalled();
  h.user('Mara wipes the bar of the Ember Tavern.');
  const n = await h.generate('normal', 'Eris walks in.');
  assert.ok(h.injected(n) > 0, 'normal injects');
  await h.emit(EV.MESSAGE_SWIPED, h.context.chat.length - 1);
  const s = await h.generate('swipe', 'Eris arrives empty-handed.');
  assert.ok(h.injected(s) > 0, 'swipe injects');
  h.context.chat.pop(); await h.emit(EV.MESSAGE_DELETED, h.context.chat.length);
  const r = await h.generate('regenerate', 'Eris is late.');
  assert.ok(h.injected(r) > 0, 'regenerate injects');
  const c = await h.generate('continue', 'She sits down.');
  assert.ok(h.injected(c) > 0, 'continue injects');
  const learned = h.learned();
  assert.equal(learned.length, 4, 'four responses learned');
  assert.equal(new Set(learned.map((x) => x.generationId)).size, 4, 'distinct generation identities');
  assert.equal(new Set(learned.map((x) => x.userMessageDigest)).size, 1, 'same reused user source');
  assert.deepEqual(h.errors(), []);
  h.session.destroy();
});

test('quiet and impersonate generations are excluded without errors and receive no Area-52 context', async () => {
  const h = makeInstalled();
  h.user('Mara wipes the bar.');
  await h.generate('normal', 'Eris walks in.');
  const q = await h.generate('quiet', 'summary');
  const i = await h.generate('impersonate', 'I nod.');
  assert.equal(h.injected(q), 0); assert.equal(h.injected(i), 0);
  assert.deepEqual(h.errors(), []);
  assert.equal(h.session.nativeRuns.size, 0);
  const next = (h.user('Eris orders ale.'), await h.generate('normal', 'Mara pours.'));
  assert.ok(h.injected(next) > 0);
  h.session.destroy();
});

test('a preparation failure is released and the next Send recovers, including after chat switch', async () => {
  const brain = new Area52NativeBrain();
  const h = makeInstalled({ nativeBrain: brain });
  const original = brain.runTurn.bind(brain);
  let failNext = true;
  brain.runTurn = (...args) => { if (failNext) { failNext = false; return Promise.reject(new Error('INJECTED_PREPARE_FAILURE')); } return original(...args); };
  h.user('First.');
  const f = await h.generate('normal', 'x');
  assert.equal(h.injected(f), 0);
  assert.equal(h.session.nativeRuns.size, 0, 'failed run released');
  h.user('Second.');
  const ok = await h.generate('normal', 'y');
  assert.ok(h.injected(ok) > 0, 'next Send recovers');
  // Fail again, switch away and back, then Send.
  failNext = true;
  h.user('Third.');
  await h.generate('normal', 'z');
  const home = h.context.chatId;
  h.context.chatId = 'chat:other'; await h.emit(EV.CHAT_CHANGED, 'chat:other');
  h.context.chatId = home; await h.emit(EV.CHAT_CHANGED, home);
  h.user('Fourth.');
  const back = await h.generate('normal', 'w');
  assert.ok(h.injected(back) > 0, 'Send recovers after switch-away/back');
  assert.equal(h.session.nativeRuns.size, 0);
  h.session.destroy();
});

test('a provider failure without MESSAGE_RECEIVED does not wedge the next Send', async () => {
  const h = makeInstalled();
  h.user('First.');
  const f = await h.generate('normal', 'x', { failProvider: true });
  assert.ok(h.injected(f) > 0);
  const secondIndex = h.user('Second.');
  const ok = await h.generate('normal', 'y');
  assert.ok(h.injected(ok) > 0, 'orphaned run superseded by the next generation');
  assert.equal(h.learned().length, 1);
  assert.equal(h.learned()[0].userMessageIndex, secondIndex, 'the new response is attributed to the new turn only');
  assert.ok(!h.errors().some((e) => /already pending/.test(e)));
  h.session.destroy();
});

test('late cleanup of a superseded run cannot erase a newer run', async () => {
  const h = makeInstalled();
  h.user('First.');
  await h.generate('normal', 'x', { failProvider: true });
  const oldRun = [...h.session.nativeRuns.values()][0];
  h.user('Second.');
  await h.emit(EV.GENERATION_STARTED, 'normal', {}, false);
  await h.emit(EV.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
  const newRun = h.session.nativeRuns.get(h.context.chatId);
  assert.ok(newRun && newRun !== oldRun);
  h.session.releaseNativeRun?.(h.context.chatId, oldRun, 'LATE_OLD_CLEANUP');
  assert.equal(h.session.nativeRuns.get(h.context.chatId), newRun, 'newer run survives stale cleanup');
  h.session.destroy();
});

test('text-completion backends receive the sealed context once and learn the response', async () => {
  const h = makeInstalled({ mainApi: 'textgenerationwebui' });
  h.user('Mara wipes the bar.');
  const t = await h.generate('normal', 'Eris walks in.');
  assert.match(t.combine.prompt, /Area-52/, 'sealed context inserted into the text prompt');
  assert.equal((t.combine.prompt.match(/\[Area-52 sealed context/g) ?? []).length, 1, 'exactly once');
  assert.ok(t.combine.prompt.indexOf('Area-52') < t.combine.prompt.lastIndexOf('Mara wipes the bar.'), 'inserted before the current user message');
  assert.equal(h.learned().length, 1);
  assert.deepEqual(h.errors(), []);
  const receipt = h.nativeBrain.readTurn(h.learned()[0].turnId).delivery.receipt;
  assert.equal(receipt.phases.hostRequest.status, 'OBSERVED_MATCH');
  h.user('Next.');
  const t2 = await h.generate('normal', 'ok');
  assert.match(t2.combine.prompt, /Area-52/);
  h.session.destroy();
});

test('chat-completion turns ignore the empty text-combine event (no duplicate insertion)', async () => {
  const h = makeInstalled({ mainApi: 'openai' });
  h.user('Mara wipes the bar.');
  const t = await h.generate('normal', 'Eris walks in.');
  assert.equal(t.combine.prompt, '');
  assert.ok(h.injected(t) > 0);
  assert.equal(h.learned().length, 1);
  h.session.destroy();
});
