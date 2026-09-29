// Follow-up (audit D4 residual): a valid POST_RESPONSE Scene obligation must survive foreground capacity
// pressure and run when capacity returns. Mock provider, fake host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EV, makeInstalled } from './helpers/installed-host.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function setup(hangMs = 400) {
  const h = makeInstalled({ chatId: 'chat:defer' });
  const calls = [];
  h.session.brain.resourceConnections.fetchImpl = async (url, init) => {
    if (String(url).endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'm' }] }) };
    calls.push(Date.now());
    await new Promise((res, rej) => { const t = setTimeout(res, hangMs); init.signal?.addEventListener?.('abort', () => { clearTimeout(t); rej(Object.assign(new Error('a'), { name: 'AbortError' })); }); });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: 'm', choices: [{ message: { content: '{"fields":{},"boundarySignals":{}}' }, finish_reason: 'stop' }], usage: {} }) };
  };
  h.session.brain.optionalResources.actions.addResource({ resourceId: 'glm', kind: 'OPENAI_COMPATIBLE', endpoint: 'https://x.invalid', modelId: 'm', apiKey: 'k', capabilities: ['STRUCTURED_EXTRACTION'] });
  await h.session.brain.optionalResources.actions.connectResource('glm');
  return { h, calls, receipts: () => h.session.brain.readSceneObservationReceipts({ limit: 64 }) };
}
async function oneTurn(h, user, reply) {
  h.user(user);
  await h.emit(EV.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
  await h.emit(EV.CHAT_COMPLETION_PROMPT_READY, { chat: [{ role: 'user', content: 'x' }] });
  await sleep(50);
  const idx = h.assistant(reply); await h.emit(EV.MESSAGE_RECEIVED, idx, 'normal');
}

test('POST_RESPONSE work blocked only by foreground load is deferred, then executed when capacity returns', async () => {
  const { h, calls, receipts } = await setup(300);
  await oneTurn(h, 'I look at Kael, waiting for an answer.', 'She nods slowly.');
  const post = () => receipts().filter((r) => r.phase === 'POST_RESPONSE');
  assert.ok(post().some((r) => r.status === 'DEFERRED'), 'retained instead of SKIPPED: ' + JSON.stringify(post().map((r) => r.status + '/' + r.reasonCode)));
  assert.equal(post().some((r) => r.status === 'SKIPPED'), false);
  await sleep(1400);
  assert.ok(post().some((r) => r.status === 'QUEUED' && r.reasonCode === 'SCENE_OBSERVATION_RUNTIME_QUEUED_AFTER_DEFER'), 'admitted after capacity returned: ' + JSON.stringify(post().map((r) => r.status + '/' + r.reasonCode)));
  assert.ok(calls.length >= 2, 'the provider actually ran the deferred observation (' + calls.length + ' calls)');
  assert.equal(h.session.brain.deferredSceneObservations.size, 0, 'nothing left deferred');
  h.session.destroy();
});

test('a deferred obligation whose source message was deleted is cancelled, not executed', async () => {
  const { h, calls, receipts } = await setup(300);
  await oneTurn(h, 'I look at Kael, waiting for an answer.', 'She nods slowly.');
  assert.ok(h.session.brain.deferredSceneObservations.size >= 1, 'precondition: something is deferred');
  const idx = h.context.chat.findIndex((m) => !m.is_user);
  h.context.chat.splice(idx, 1); await h.emit(EV.MESSAGE_DELETED, idx);
  await sleep(1400);
  const post = receipts().filter((r) => r.phase === 'POST_RESPONSE');
  assert.ok(post.some((r) => r.status === 'CANCELLED'), JSON.stringify(post.map((r) => r.status + '/' + r.reasonCode)));
  assert.equal(post.some((r) => r.reasonCode === 'SCENE_OBSERVATION_RUNTIME_QUEUED_AFTER_DEFER'), false);
  assert.equal(h.session.brain.deferredSceneObservations.size, 0);
  h.session.destroy();
});

test('a genuinely unavailable resource still skips POST_RESPONSE work (deferral is capacity-only)', async () => {
  const h = makeInstalled({ chatId: 'chat:defer-none' });
  h.user('I look at Kael, waiting.');
  await h.emit(EV.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
  const idx = h.assistant('She nods.'); await h.emit(EV.MESSAGE_RECEIVED, idx, 'normal');
  await sleep(100);
  const post = h.session.brain.readSceneObservationReceipts({ limit: 32 }).filter((r) => r.phase === 'POST_RESPONSE');
  assert.equal(post.some((r) => r.status === 'DEFERRED'), false);
  assert.equal(h.session.brain.deferredSceneObservations.size, 0);
  h.session.destroy();
});
