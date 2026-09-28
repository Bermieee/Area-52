// Wave 5 (audit D6): owner graph identities must reach the Native identity registry so Graph Walker can
// traverse Lore edges from Scene-style anchors. FAKE-HOST evidence only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Area52NativeBrain } from '../src/native-brain.js';
import { createDevelopmentDeploymentSillyTavernSession, } from '../src/deployment/sillytavern-live.js';
import { createGoldenDeploymentLorebook } from '../src/deployment/brain.js';
import { EV, makeInstalled } from './helpers/installed-host.mjs';

async function bound() {
  const h = makeInstalled({ chatId: 'chat:w5' });
  h.session.ingestLorebook({ ...createGoldenDeploymentLorebook(), chatId: 'chat:w5' });
  h.user('Hello there.'); await h.generate('normal', 'Hi.');
  return h;
}

test('Lore owner entities are registered in the Native identity registry with source links and aliases', async () => {
  const h = await bound();
  const reg = h.nativeBrain.core.entities;
  assert.ok(reg.entities.size > 0, 'native registry has owner identities');
  const mara = reg.get('entity:mara');
  assert.ok(mara, 'entity:mara registered');
  assert.equal(reg.normalizeRef('entity:mara', { providerId: 'LORE_OWNER_GRAPH' }).resolved, true);
  assert.equal(reg.normalizeRef('Mara').entityId, 'entity:mara', 'raw Scene-style anchor resolves through the registry');
  assert.equal(mara.status, 'CURRENT');
  assert.ok(mara.sourceRevisionRefs.length > 0, 'identity keeps its source revision');
  h.session.destroy();
});

test('Graph Walker traverses Lore owner edges from canonical and raw Scene anchors', async () => {
  const h = await bound();
  for (const anchor of ['entity:mara', 'Mara']) {
    const r = h.nativeBrain.worldGraphReferences('Mara', { anchorEntityIds: [anchor] });
    assert.ok(r.edges.length > 0, 'edges for anchor ' + anchor + ' stale=' + JSON.stringify([...new Set(r.staleRejected.map((s) => s.reason))]));
  }
  h.session.destroy();
});

test('no Lore in scope registers no identities', async () => {
  const h = makeInstalled({ chatId: 'chat:w5-unbound' });
  h.user('Hello there.');
  await h.generate('normal', 'Hi.');
  assert.equal(h.nativeBrain.core.entities.entities.size, 0);
  h.session.destroy();
});

test('fresh Lore ingest yields no false stale rejections, but unknown derived refs still fail closed', async () => {
  const h = await bound();
  const r = h.nativeBrain.worldGraphReferences('Mara', { anchorEntityIds: ['entity:mara'] });
  assert.equal(r.staleRejected.length, 0, JSON.stringify(r.staleRejected.map((s) => s.reason)));
  const provider = h.session.brain.hostBindings().graphProviders.find((p) => p.providerId === 'LORE_OWNER_GRAPH');
  assert.equal(provider.isRevisionCurrent('navigation-summary:0000000000000000'), false);
  assert.equal(provider.isRevisionCurrent('structure:0000000000000000'), false);
  h.session.destroy();
});

test('identity sync is reported in the Identity Resolution diagnostics read model', async () => {
  const h = await bound();
  const sel = h.nativeBrain.uiBindings().readSelection({ chatId: h.context.chatId });
  const model = h.nativeBrain.uiBindings().readIdentityResolution(sel);
  assert.equal(model.loreIdentitySync.status, 'OK');
  assert.ok(model.loreIdentitySync.registered > 0);
  assert.equal(model.loreIdentitySync.authorityGranted, false);
  h.session.destroy();
});
