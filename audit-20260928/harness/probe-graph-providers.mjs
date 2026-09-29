import { makeSession } from './host.mjs';
import { createGoldenDeploymentLorebook } from '../../src/deployment/brain.js';
const h = makeSession({ chatId: 'chat:g' });
h.session.ingestLorebook(createGoldenDeploymentLorebook());
const b = h.session.brain.hostBindings();
console.log('graphProviders from deployment hostBindings:', (b.graphProviders??[]).map(p=>p.providerId+':'+p.owner));
console.log('native attachments:', JSON.stringify(h.session.nativeOwnerAttachments));
for (const p of b.graphProviders??[]) {
  for (const anchor of ['Mara','entity:mara','mara','Ember Tavern']) {
    try { const r = p.query({ anchorEntityIds:[anchor], maxDepth:2, maxEdges:50, maxNodes:50, query:'Mara', intent:'CURRENT' }); const edges = r?.edges ?? r?.references ?? r?.rows ?? r; console.log(p.providerId, anchor, '->', Array.isArray(edges)?edges.length:JSON.stringify(r).slice(0,200)); } catch(e){ console.log(p.providerId, anchor, 'ERR', e.message.slice(0,150)); }
  }
}
// what entity ids does Lore know?
const li = h.session.brain.loreIntelligence; const st = JSON.stringify(li.snapshot()); const ids=[...new Set(st.match(/entity:[a-z0-9:_-]+/g)??[])].slice(0,20); console.log('lore entity ids sample:', ids);
