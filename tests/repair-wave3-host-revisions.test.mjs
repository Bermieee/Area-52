// Wave 3 (audit D2): installed SillyTavern message delete/edit/swipe must retire or supersede the
// evidence learned from the old message, so the next prepared context cannot carry it.
// FAKE-HOST evidence only; not a live SillyTavern pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EV, makeInstalled } from './helpers/installed-host.mjs';

const carries = (r, token) => JSON.stringify(r.req?.chat ?? r.combine).includes(token);

async function seeded() {
  const h = makeInstalled();
  h.user('Mara wipes the bar of the Ember Tavern.');
  await h.generate('normal', 'Eris walks in carrying the Sun Blade OLDTOKEN.');
  return h;
}

test('deleting an assistant message removes its evidence from the next prepared context', async () => {
  const h = await seeded();
  h.user('Eris looks around.');
  const before = await h.generate('normal', 'Mara nods.');
  assert.ok(carries(before, 'OLDTOKEN'), 'precondition: learned text is delivered while the message exists');
  const idx = h.context.chat.findIndex((m) => String(m.mes).includes('OLDTOKEN'));
  h.context.chat.splice(idx, 1); await h.emit(EV.MESSAGE_DELETED, idx);
  h.user('What is Eris carrying?');
  const after = await h.generate('normal', 'Nothing.');
  assert.ok(!carries(after, 'OLDTOKEN'), 'deleted text must not be delivered');
  assert.deepEqual(h.errors(), []);
  h.session.destroy();
});

test('editing an assistant message supersedes its old text and delivers the new text', async () => {
  const h = await seeded();
  const idx = h.context.chat.findIndex((m) => String(m.mes).includes('OLDTOKEN'));
  h.context.chat[idx].mes = 'Eris walks in carrying the Moon Lantern NEWTOKEN.';
  await h.emit(EV.MESSAGE_EDITED, idx);
  h.user('What is Eris carrying?');
  const after = await h.generate('normal', 'The lantern glows.');
  assert.ok(!carries(after, 'OLDTOKEN'), 'old text superseded');
  assert.ok(carries(after, 'NEWTOKEN'), 'edited text delivered');
  assert.deepEqual(h.errors(), []);
  h.session.destroy();
});

test('swiping replaces the delivered assistant text with the selected swipe', async () => {
  const h = await seeded();
  const idx = h.context.chat.findIndex((m) => String(m.mes).includes('OLDTOKEN'));
  h.context.chat[idx].mes = 'Eris arrives empty-handed SWIPETOKEN.';
  await h.emit(EV.MESSAGE_SWIPED, idx);
  h.user('What is Eris carrying?');
  const after = await h.generate('normal', 'Nothing.');
  assert.ok(!carries(after, 'OLDTOKEN'));
  assert.ok(carries(after, 'SWIPETOKEN'));
  h.session.destroy();
});

test('deleting a user message retires its Core source and Scene evidence without erasing history', async () => {
  const h = makeInstalled();
  const ui = h.user('Kael lights the lantern at North Gallery.');
  await h.generate('normal', 'The gallery brightens.');
  const brain = h.session.brain;
  const chatId = h.context.chatId;
  const active = () => brain.core.registry.listSources().filter((s) => s.metadata?.chatId === chatId && s.metadata?.messageId === 'u1' && brain.core.registry.isSourceRetired?.(s.id) !== true);
  assert.equal(active().length, 1, 'precondition: one active registered user source');
  const sourceId = active()[0].id;
  assert.ok((brain.scene.narrativeFeed.currentEvidence(chatId) ?? []).length > 0, 'precondition: scene evidence');
  h.context.chat.splice(ui, 1); await h.emit(EV.MESSAGE_DELETED, ui);
  assert.equal(brain.core.registry.isSourceRetired(sourceId), true);
  assert.ok(brain.core.registry.getSource(sourceId), 'source record preserved');
  assert.equal(brain.scene.narrativeFeed.currentEvidence(chatId).some((r) => r.role === 'user'), false, 'scene user evidence retired');
  h.session.destroy();
});

test('a real swipe/regenerate replaces the old learned narrative instead of stacking both', async () => {
  const h = await seeded();
  await h.emit(EV.MESSAGE_SWIPED, h.context.chat.length - 1);
  await h.generate('swipe', 'Eris arrives empty-handed SWIPETOKEN.');
  h.user('What is Eris carrying?');
  const after = await h.generate('normal', 'Nothing.');
  assert.ok(!carries(after, 'OLDTOKEN'), 'abandoned swipe text retired');
  assert.ok(carries(after, 'SWIPETOKEN'), 'selected swipe delivered');
  assert.deepEqual(h.errors(), []);
  h.session.destroy();
});

test('reconciliations are reported in Diagnostics and history stays recoverable', async () => {
  const h = await seeded();
  const idx = h.context.chat.findIndex((m) => String(m.mes).includes('OLDTOKEN'));
  h.context.chat.splice(idx, 1); await h.emit(EV.MESSAGE_DELETED, idx);
  const diag = h.session.exportEvidence();
  const host = JSON.stringify(diag).includes('"revisionReconciliationCount"');
  assert.ok(host, 'Diagnostics exposes revision reconciliations');
  const last = h.session.hostRevisionReconciliations.at(-1);
  assert.equal(last.nativeTurns[0].action, 'RETIRED');
  assert.equal(last.errors.length, 0);
  h.session.destroy();
});
