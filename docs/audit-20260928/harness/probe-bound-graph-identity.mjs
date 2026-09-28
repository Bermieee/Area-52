import { makeSession, normalTurn } from './host.mjs';
import { createGoldenDeploymentLorebook } from '../../../src/deployment/brain.js';
const h = makeSession({ chatId: 'chat:id' });
h.session.ingestLorebook({ ...createGoldenDeploymentLorebook(), chatId: 'chat:id' });
h.session.start();
await normalTurn(h, 'Hello there.', 'Hi.');
const reg = h.nativeBrain.core.entities;
console.log('native identity registry entity count:', reg.entities.size, '| deployment core registry count:', h.session.brain.core.entities.entities.size);
console.log('normalizeRef(entity:mara, LORE provider) =>', JSON.stringify(reg.normalizeRef('entity:mara',{providerId:'LORE_OWNER_GRAPH'})));
const before = h.nativeBrain.worldGraphReferences('Mara', { anchorEntityIds: ['entity:mara'] });
// Counterfactual (audit only, in-memory): register the Lore canonical id in the Native registry.
try { reg.registerIdentity({ entityId: 'entity:mara', canonicalLabel: 'Mara', entityType: 'CHARACTER', aliases:['Mara'], sourceRevisionRefs: ['lore:ember-golden:mara@r1'], provenanceRefs:['lore:ember-golden:mara@r1'] }); } catch (e) { console.log('register err', e.message); }
const after = h.nativeBrain.worldGraphReferences('Mara', { anchorEntityIds: ['entity:mara'] });
console.log('edges before:', before.edges.length, '| after registering entity:mara in Native registry:', after.edges.length, after.edges.map(e=>e.fromEntityId+'->'+e.toEntityId+' '+e.edgeMeaning).slice(0,3));
const raw = h.nativeBrain.worldGraphReferences('Mara', { anchorEntityIds: ['Mara'] });
console.log('raw Scene-style anchor "Mara" after registration:', raw.edges.length);
h.session.destroy();
