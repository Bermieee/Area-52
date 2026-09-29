import { makeSession, normalTurn } from './host.mjs';
import { createGoldenDeploymentLorebook } from '../../src/deployment/brain.js';
const h = makeSession({ chatId: 'chat:w' });
h.session.ingestLorebook(createGoldenDeploymentLorebook());
h.session.start();
await normalTurn(h, 'Hello there.', 'Hi.');   // establish Scene + turn
for (const anchors of [['Mara'], ['entity:mara'], ['entity:ember-tavern']]) {
  const r = h.nativeBrain.worldGraphReferences('Mara', { anchorEntityIds: anchors });
  console.log(JSON.stringify(anchors), 'edges', r.edges.length, 'providers', JSON.stringify(r.providers.map(p=>[p.providerId,p.edgeCount,p.rejectedStale])), 'staleReasons', JSON.stringify([...new Set(r.staleRejected.map(s=>s.reason))]));
}
// dump raw Lore provider rows + current check
const p = h.session.brain.hostBindings().graphProviders.find(x=>x.providerId==='LORE_OWNER_GRAPH');
const rows = p.query({ anchorEntityIds:['entity:mara'], maxDepth:2, maxEdges:64, maxNodes:64, query:'Mara', intent:'CURRENT' });
const arr = Array.isArray(rows)?rows:rows.edges;
for (const e of arr) console.log(' ', (e.edgeId||'').slice(17,70).padEnd(54), e.from ?? e.fromEntityId, '->', e.to ?? e.toEntityId, e.edgeMeaning ?? e.predicate, 'temporal=',e.temporalStatus ?? e.status, 'auth=',e.authorityClass, '| deps:', (e.dependencyRevisionRefs??[]).slice(0,2).join(','), '| depCurrent:', (e.dependencyRevisionRefs??[]).map(d=>p.isRevisionCurrent?.(d)).join(','));
h.session.destroy();
