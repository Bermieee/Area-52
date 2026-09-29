// Scene investigation: installed session path + OPENAI_COMPATIBLE Scene resource on a
// mocked fetch with controllable latency. Samples SceneObservationRuntimeReadModel over time.
// Scenarios chosen to discriminate candidate causes of "FOREGROUND_USER QUEUED, no physical attempt".
import { makeSession, pushUser, pushAssistant, EVENT_TYPES, sleep } from './host.mjs';

const SCENE_JSON = { fields: { activeCast: { value: [{ characterId: 'Mara', state: 'PRESENT' }, { characterId: 'Eris', state: 'PRESENT' }], confidence: .95, observationClass: 'OBSERVED' }, location: { value: { location: 'Ember Tavern' }, confidence: .95, observationClass: 'OBSERVED' } }, boundarySignals: {} };

function mockFetch(latencyMs, calls, { hang = false } = {}) {
  return async (url, init) => {
    if (String(url).endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'glm-mock' }] }) };
    const body = JSON.parse(init.body);
    calls.push({ at: Date.now(), system: String(body.messages?.[0]?.content ?? '').slice(0, 40) });
    await new Promise((resolve, reject) => {
      if (hang) { init.signal?.addEventListener?.('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); return; }
      const t = setTimeout(resolve, latencyMs);
      init.signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: 'glm-mock', choices: [{ message: { content: JSON.stringify(SCENE_JSON) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 } }) };
  };
}

const summarize = (rt) => rt.tasks.map((t) => `${t.taskId.split(':').slice(-3).join(':')} ${t.lifecycleStatus}/${t.executionStatus}(${t.executionReason ?? ''}) fg=${t.foreground} started=${t.startedCount} inflight=${t.inflight}`).join(' || ')
  + ` | gen=${rt.resources.generationActive} use=${JSON.stringify(rt.resources.usage)} leases=${rt.resources.activeLeases} q=${JSON.stringify(rt.queueDepth)} workers=${rt.workers.map((w) => w.workerId + ':' + w.health + '/' + w.currentLoad + '/' + w.concurrencyCapacity + ':' + w.supportedLayers.join('')).join(',')}`;

async function scenario(name, { providerLatency, hostResponseMs, turns = 2, gapMs = 50, hang = false }) {
  const calls = [];
  const h = makeSession({ chatId: 'chat:' + name });
  h.session.brain.resourceConnections.fetchImpl = mockFetch(providerLatency, calls, { hang });
  h.session.brain.optionalResources.actions.addResource({ resourceId: 'glm', kind: 'OPENAI_COMPATIBLE', endpoint: 'https://glm.invalid', modelId: 'glm-mock', apiKey: 'k', capabilities: ['STRUCTURED_EXTRACTION'] });
  await h.session.brain.optionalResources.actions.connectResource('glm');
  h.session.start();
  console.log(`\n=== ${name}: provider=${providerLatency}ms hostResponse=${hostResponseMs}ms turns=${turns}${hang ? ' (provider hangs)' : ''}`);
  const t0 = Date.now();
  for (let i = 1; i <= turns; i++) {
    pushUser(h.context, i === 1 ? 'Mara wipes the bar of the Ember Tavern while Eris waits.' : 'Eris asks Mara about the Sun Blade.');
    await h.emit(EVENT_TYPES.GENERATION_STARTED, 'normal', {}, false);
    await h.emit(EVENT_TYPES.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
    await h.emit(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, { chat: [{ role: 'system', content: 'host' }, { role: 'user', content: 'x' }] });
    const sel = h.session.nativePending.get(h.context.chatId);
    console.log(`[t+${Date.now() - t0}] turn ${i} sealed/injected:`, summarize(h.session.brain.readSceneObservationRuntime({ chatId: h.context.chatId })));
    await sleep(hostResponseMs);
    console.log(`[t+${Date.now() - t0}] turn ${i} before response :`, summarize(h.session.brain.readSceneObservationRuntime({ chatId: h.context.chatId })));
    const idx = pushAssistant(h.context, 'Mara glances at Eris and sets down her rag.');
    await h.emit(EVENT_TYPES.MESSAGE_RECEIVED, idx, 'normal');
    await h.emit(EVENT_TYPES.GENERATION_ENDED, h.context.chat.length);
    await sleep(gapMs);
    console.log(`[t+${Date.now() - t0}] turn ${i} after completion:`, summarize(h.session.brain.readSceneObservationRuntime({ chatId: h.context.chatId })));
  }
  await sleep(Math.max(300, providerLatency * 3));
  const rt = h.session.brain.readSceneObservationRuntime({ chatId: h.context.chatId });
  console.log(`[t+${Date.now() - t0}] settled:`, summarize(rt));
  console.log('provider calls:', calls.length, calls.map((c) => '+' + (c.at - t0)).join(' '));
  const rec = h.session.brain.readSceneObservationReceipts({ limit: 128 });
  const byStatus = {}; for (const r of rec) byStatus[r.kind.replace('DeploymentSceneObservation', '') + ':' + r.status] = (byStatus[r.kind.replace('DeploymentSceneObservation', '') + ':' + r.status] ?? 0) + 1;
  console.log('receipts:', JSON.stringify(byStatus));
  const sig = h.session.brain.scene.integrationSignal(h.context.chatId);
  console.log('Scene activeCast:', JSON.stringify(sig.activeCast), 'location:', JSON.stringify(sig.location));
  const errs = h.session.exportEvidence().errors.map((e) => e.stage + ': ' + e.message);
  if (errs.length) console.log('errors:', errs);
  h.session.destroy();
}

await scenario('fast-provider', { providerLatency: 200, hostResponseMs: 1500 });
await scenario('slow-provider', { providerLatency: 4700, hostResponseMs: 1500, gapMs: 100 });
await scenario('rapid-sends', { providerLatency: 4700, hostResponseMs: 800, turns: 3, gapMs: 10 });
