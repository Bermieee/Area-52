// Wave 4 (audit D4): intentional supersession aborts must not disable the Scene resource, and a
// resource in COOLDOWN must recover through the documented probe. FAKE-HOST / mock-provider evidence only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EV, makeInstalled } from './helpers/installed-host.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withGlm(h, { hangMs = 1500 } = {}) {
  const calls = [];
  const rc = h.session.brain.resourceConnections;
  rc.fetchImpl = async (url, init) => {
    if (String(url).endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'glm-mock' }] }) };
    calls.push(Date.now());
    await new Promise((resolve, reject) => { const t = setTimeout(resolve, hangMs); init.signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })); }); });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: 'glm-mock', choices: [{ message: { content: '{"fields":{},"boundarySignals":{}}' }, finish_reason: 'stop' }], usage: {} }) };
  };
  h.session.brain.optionalResources.actions.addResource({ resourceId: 'glm', kind: 'OPENAI_COMPATIBLE', endpoint: 'https://glm.invalid', modelId: 'glm-mock', apiKey: 'k', capabilities: ['STRUCTURED_EXTRACTION'] });
  await h.session.brain.optionalResources.actions.connectResource('glm');
  return { calls, res: () => h.session.brain.optionalResources.read.resource('glm') };
}
async function turn(h, text) {
  h.user(text);
  await h.emit(EV.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
  await h.emit(EV.CHAT_COMPLETION_PROMPT_READY, { chat: [{ role: 'user', content: 'x' }] });
  await sleep(200);
  const idx = h.assistant('She nods.'); await h.emit(EV.MESSAGE_RECEIVED, idx, 'normal');
}

test('superseding an in-flight Scene call does not make the resource unavailable', async () => {
  const h = makeInstalled({ chatId: 'chat:w4' });
  const { res } = await withGlm(h);
  await turn(h, 'Mara wipes the bar.'); await sleep(20);
  assert.equal(res().activeExecutions, 1, 'precondition: first scene call in flight');
  await turn(h, 'Eris sits down.'); await sleep(50);
  const r = res();
  assert.notEqual(r.state, 'UNAVAILABLE', 'cancellation is not a provider failure: ' + r.reasonCode);
  assert.equal(r.callable, true);
  const fg = h.session.brain.readSceneObservationReceipts({ limit: 128 }).filter((x) => x.phase === 'FOREGROUND_USER');
  assert.equal(fg.at(-1)?.status === 'SKIPPED', false, 'the replacement foreground job must not be blocked by the slot the cancellation is freeing: ' + JSON.stringify(fg.map((x) => x.status + '/' + x.reasonCode)));
  const profile = h.session.brain.resourceConnections.profiles.list().find((p) => p.providerHealth !== undefined && String(p.profileId).includes('glm'));
  assert.equal(profile.availability, 'AVAILABLE');
  h.session.destroy();
});

test('a genuine failure enters COOLDOWN and the resource recovers by probe after the cooldown', async () => {
  const h = makeInstalled({ chatId: 'chat:w4b' });
  const rc = h.session.brain.resourceConnections;
  let now = 1_000_000; rc.now = () => now;
  let failing = false;
  rc.fetchImpl = async (url) => {
    if (String(url).endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'glm-mock' }] }) };
    if (failing) return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({ error: { message: 'down' } }) };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: 'glm-mock', choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: {} }) };
  };
  h.session.brain.optionalResources.actions.addResource({ resourceId: 'glm', kind: 'OPENAI_COMPATIBLE', endpoint: 'https://glm.invalid', modelId: 'glm-mock', apiKey: 'k', capabilities: ['STRUCTURED_EXTRACTION'] });
  await h.session.brain.optionalResources.actions.connectResource('glm');
  const res = () => h.session.brain.optionalResources.read.resource('glm');
  failing = true;
  await turn(h, 'Mara wipes the bar.'); await sleep(300);
  assert.equal(res().state, 'UNAVAILABLE', 'precondition: one hard failure trips the breaker');
  failing = false; now += 31_000;
  await rc.recoverResourcesAfterCooldown();
  assert.equal(res().state, 'READY', 'probe after cooldown restores the resource');
  h.session.destroy();
});

test('destroying the session cancels pending cooldown recovery, so no later probe reconnects the resource', async () => {
  const h = makeInstalled({ chatId: 'chat:w4c' });
  const rc = h.session.brain.resourceConnections;
  let now = 1_000_000; rc.now = () => now;
  let failing = false, probes = 0;
  rc.fetchImpl = async (url) => {
    if (String(url).endsWith('/models')) { probes += 1; return { ok: true, status: 200, json: async () => ({ data: [{ id: 'glm-mock' }] }) }; }
    if (failing) return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({ error: { message: 'down' } }) };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: 'glm-mock', choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: {} }) };
  };
  h.session.brain.optionalResources.actions.addResource({ resourceId: 'glm', kind: 'OPENAI_COMPATIBLE', endpoint: 'https://glm.invalid', modelId: 'glm-mock', apiKey: 'k', capabilities: ['STRUCTURED_EXTRACTION'] });
  await h.session.brain.optionalResources.actions.connectResource('glm');
  failing = true;
  await turn(h, 'Mara wipes the bar.'); await sleep(300);
  assert.equal(h.session.brain.optionalResources.read.resource('glm').state, 'UNAVAILABLE', 'precondition: COOLDOWN');
  assert.equal(rc.recoveryTimers?.size, 1, 'precondition: a recovery probe is scheduled');
  h.session.destroy();
  assert.equal(rc.recoveryTimers.size, 0, 'destroy cancels the scheduled probe');
  failing = false; now += 31_000; const before = probes;
  assert.deepEqual(await rc.recoverResourcesAfterCooldown(), []);
  assert.equal(probes, before, 'no authenticated probe after destroy');
});

test('an injected brain is not disposed by the session that borrowed it', async () => {
  const { createDevelopmentDeploymentSillyTavernSession } = await import('../src/deployment/sillytavern-live.js');
  const owner = makeInstalled({ chatId: 'chat:w4d' });
  const context = { chatId: 'chat:w4d-borrow', chat: [], mainApi: 'openai', eventTypes: EV, eventSource: { on() {}, removeListener() {} }, async setExtensionPrompt() {} };
  const borrowed = createDevelopmentDeploymentSillyTavernSession({ sillyTavern: { getContext: () => context }, document: null, mountUi: false, brain: owner.session.brain });
  assert.equal(borrowed.brain, owner.session.brain, 'precondition: the brain is shared');
  borrowed.destroy();
  assert.notEqual(owner.session.brain.resourceConnections.disposed, true, 'borrower leaves the host brain alive');
  owner.session.destroy();
  assert.equal(owner.session.brain.resourceConnections.disposed, true, 'the creating session disposes it');
});
