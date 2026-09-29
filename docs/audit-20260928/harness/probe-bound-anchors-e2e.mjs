// End-to-end: operator lorebook + Scene Sidecar that returns a PRESENT cast. Does the next
// turn's Graph Walker get anchors, and do Lore/Memory/Scene graph owners contribute edges?
import { makeSession, pushUser, pushAssistant, EVENT_TYPES, sleep } from './host.mjs';
import { createGoldenDeploymentLorebook } from '../../../src/deployment/brain.js';

const CAST = process.argv[2] ?? 'Mara';
const h = makeSession({ chatId: 'chat:anchors' });
h.session.brain.resourceConnections.fetchImpl = async (url, init) => {
  if (String(url).endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'm' }] }) };
  await sleep(150);
  const payload = { fields: { activeCast: { value: [{ characterId: CAST, state: 'PRESENT' }], confidence: .95, observationClass: 'OBSERVED' } }, boundarySignals: {} };
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: 'm', choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }], usage: {} }) };
};
h.session.brain.optionalResources.actions.addResource({ resourceId: 'glm', kind: 'OPENAI_COMPATIBLE', endpoint: 'https://glm.invalid', modelId: 'm', apiKey: 'k', capabilities: ['STRUCTURED_EXTRACTION'] });
await h.session.brain.optionalResources.actions.connectResource('glm');
const lore = h.session.ingestLorebook({ ...createGoldenDeploymentLorebook(), chatId: 'chat:anchors' });
console.log('lore ingest:', JSON.stringify({ mappingCount: lore.mappingCount, retrievable: lore.retrievable }));
h.session.start();

async function turn(text, reply) {
  pushUser(h.context, text);
  await h.emit(EVENT_TYPES.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
  const req = { chat: [{ role: 'user', content: text }] };
  await h.emit(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, req);
  const pending = h.session.nativePending.get(h.context.chatId);
  await sleep(400);
  const idx = pushAssistant(h.context, reply); await h.emit(EVENT_TYPES.MESSAGE_RECEIVED, idx, 'normal');
  await sleep(400);
  return { pending, req };
}
// Neither line is deterministic-explicit, so Sidecar semantic extraction runs.
const t1 = await turn('She leans closer. "Tell me what happened to the Sun Blade."', 'Rain drums on the roof while the fire crackles.');
const g1 = h.nativeBrain.uiBindings().readGraphTraversal({ chatId: h.context.chatId, turnId: t1.pending.turnId, generationId: t1.pending.generationId });
console.log('T1 graph:', JSON.stringify({ anchors: g1?.anchorEntityIds, noWork: g1?.noWorkReason, providers: g1?.providerDiagnostics?.map((p) => p.providerId + ':' + p.status + ':' + p.edgeCount) }));
console.log('Scene cast after T1:', JSON.stringify(h.session.brain.scene.integrationSignal(h.context.chatId).activeCast));
const t2 = await turn('She leans closer. "Tell me what happened to the Sun Blade."', 'Nothing more is said.');
const g2 = h.nativeBrain.uiBindings().readGraphTraversal({ chatId: h.context.chatId, turnId: t2.pending.turnId, generationId: t2.pending.generationId }); console.log('T2 providers:', JSON.stringify(g2.providers), 'examined', g2.examinedEdgeCount, 'traversed', g2.traversedEdgeCount, 'staleRejected', JSON.stringify(g2.staleRejected).slice(0,600));
console.log('T2 graph:', JSON.stringify({ anchors: g2?.anchorEntityIds, noWork: g2?.noWorkReason, nominations: g2?.nominationCount ?? g2?.nominations?.length, providers: g2?.providerDiagnostics?.map((p) => p.providerId + ':' + p.status + ':' + p.edgeCount) }));
console.log('graph keys:', Object.keys(g2 ?? {}).join(','));
const inj = t2.req.chat.slice(0, -1).map((m) => String(m.content)).join('\n');
console.log('T2 delivered mentions Sun Blade / Ember Tavern lore:', /Sun Blade/.test(inj), /Ember Tavern/.test(inj), 'bytes', inj.length);
h.session.destroy();
