// Follow-up (audit D6 residual): identities, temporal claims and owner graph evidence learned in one story
// must not be visible from another story after a chat switch. FAKE-HOST evidence only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDeploymentLorebook } from '../src/deployment/brain.js';
import { EV, makeInstalled } from './helpers/installed-host.mjs';

async function twoStories() {
  const h = makeInstalled({ chatId: 'chat:A' });
  h.session.ingestLorebook({ ...createGoldenDeploymentLorebook(), chatId: 'chat:A' });
  h.user('Mara wipes the bar of the Ember Tavern.'); await h.generate('normal', 'Eris walks in carrying the Sun Blade SECRETA.');
  const turnA = h.learned().at(-1);
  // A learns a temporal claim about a Lore-known entity.
  h.nativeBrain.correctTurn({ turnId: turnA.turnId, response: 'Eris walks in carrying the Sun Blade SECRETA.', observations: [{ subjectId: 'entity:mara', predicate: 'holds', value: 'entity:sun-blade', at: 1 }] });
  h.savedA = h.context.chat.splice(0);
  h.context.chatId = 'chat:B'; await h.emit(EV.CHAT_CHANGED, 'chat:B');
  h.user('Tell me about Mara.'); await h.generate('normal', 'Nothing.');
  return h;
}

test('identity read model and anchor resolution in story B expose no story-A identities', async () => {
  const h = await twoStories();
  const nb = h.nativeBrain;
  assert.ok(nb.core.entities.entities.size > 0, 'precondition: identities from A are retained in the registry');
  const sel = nb.uiBindings().readSelection({ chatId: 'chat:B' });
  const read = nb.uiBindings().readIdentityResolution(sel);
  assert.deepEqual(read.identities.map((i) => i.entityId), [], 'foreign identities hidden from the B read model');
  assert.equal(read.counts.identities, 0);
  assert.equal(nb.core.entities.normalizeRef('Mara', { storyId: 'chat:B' }).resolved, false);
  assert.equal(nb.core.entities.normalizeRef('entity:mara', { storyId: 'chat:B' }).resolved, false);
  assert.equal(nb.core.entities.normalizeRef('entity:mara', { storyId: 'chat:A' }).resolved, true, 'still visible in its own story');
  h.session.destroy();
});

test('graph traversal in story B returns no story-A claims, Lore or Memory edges', async () => {
  const h = await twoStories();
  const r = h.nativeBrain.worldGraphReferences('Mara', { anchorEntityIds: ['Mara', 'entity:mara', 'entity:sun-blade'] });
  assert.equal(r.edges.length, 0, JSON.stringify(r.edges.map((e) => e.providerId + ':' + e.fromEntityId + '->' + e.toEntityId)));
  h.session.destroy();
});

test('story A still resolves and traverses its own evidence after switching back', async () => {
  const h = await twoStories();
  h.savedB = h.context.chat.splice(0); h.context.chat.push(...h.savedA);
  h.context.chatId = 'chat:A'; await h.emit(EV.CHAT_CHANGED, 'chat:A');
  h.user('Where is the Sun Blade?'); await h.generate('normal', 'Unknown.');
  const r = h.nativeBrain.worldGraphReferences('Mara', { anchorEntityIds: ['Mara'] });
  assert.ok(r.edges.length > 0, 'own-story edges remain');
  assert.ok(r.edges.some((e) => e.providerId === 'CORE_TEMPORAL_STATE'), 'own-story temporal claim remains');
  h.session.destroy();
});
