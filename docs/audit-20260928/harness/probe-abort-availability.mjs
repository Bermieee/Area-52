import { makeSession, pushUser, pushAssistant, EVENT_TYPES, sleep } from './host.mjs';
const calls = [];
const h = makeSession({ chatId: 'chat:abort' });
h.session.brain.resourceConnections.fetchImpl = async (url, init) => {
  if (String(url).endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'glm-mock' }] }) };
  calls.push(Date.now());
  await new Promise((resolve, reject) => { const t = setTimeout(resolve, 4700); init.signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })); }); });
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: 'glm-mock', choices: [{ message: { content: '{"fields":{},"boundarySignals":{}}' }, finish_reason: 'stop' }], usage: {} }) };
};
h.session.brain.optionalResources.actions.addResource({ resourceId: 'glm', kind: 'OPENAI_COMPATIBLE', endpoint: 'https://glm.invalid', modelId: 'glm-mock', apiKey: 'k', capabilities: ['STRUCTURED_EXTRACTION'] });
await h.session.brain.optionalResources.actions.connectResource('glm');
h.session.start();
const res = () => { const r = h.session.brain.optionalResources.read.resource('glm'); return `${r.state}/${r.reasonCode} callable=${r.callable} active=${r.activeExecutions} lastFailure=${r.lastFailure?.code ?? r.lastFailure?.reasonCode ?? JSON.stringify(r.lastFailure)?.slice(0, 80)}`; };
const prof = () => { const p = h.session.brain.resourceConnections.profiles.list().map((p) => p.profileId + ':' + p.providerHealth + '/' + p.availability + ' load=' + p.currentLoad); return p.join(','); };
async function turn(text) {
  pushUser(h.context, text);
  await h.emit(EVENT_TYPES.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
  await h.emit(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, { chat: [{ role: 'user', content: 'x' }] });
  await sleep(300);
  const idx = pushAssistant(h.context, 'She nods.'); await h.emit(EVENT_TYPES.MESSAGE_RECEIVED, idx, 'normal');
}
console.log('connected:', res(), '|', prof());
await turn('Mara wipes the bar.'); await sleep(20);
console.log('after T1 (scene call in flight):', res(), '|', prof());
await turn('Eris sits down.'); await sleep(20);
console.log('after T2 (T1 superseded):', res(), '|', prof());
const rec = h.session.brain.readSceneObservationReceipts({ limit: 128 }).map((r) => `${r.turnId?.split(':').slice(-1)[0]} ${r.phase ?? ''} ${r.status} ${r.reasonCode}`);
console.log(rec.join('\n'));
await turn('Mara pours ale.'); await sleep(20);
console.log('after T3:', res(), '|', prof());
console.log(h.session.brain.readSceneObservationReceipts({ limit: 128 }).slice(-3).map((r) => `${r.turnId?.split(':').slice(-1)[0]} ${r.status} ${r.reasonCode} admission=${JSON.stringify(r.admission?.plan?.capabilityAdmission?.status ?? r.admissionStatus ?? null)}`).join('\n'));
await sleep(6000);
console.log('6s later:', res(), '|', prof());
console.log('provider calls:', calls.length);
h.session.destroy();
