// Live finding (installed diagnostics 2026-09-29): a Lorebook accepted before the chat was opened was learned and "ready",
// yet every turn in that chat reported loreSync EXCLUDED with no visible reason, because Lore is authorized per chat and it
// had been authorized for none. Contract pinned here:
//  - the per-turn Lore exclusion reason and scope state reach the operator inspection (no silent EXCLUDED);
//  - the Lore panel says accepted Lore is not authorized for the open chat and offers to authorize it;
//  - authorizing binds the already learned Lorebook to that chat (no re-study) and the next turn reads Lore;
//  - Accept binds to the chat that is open when the operator clicks it, and refuses when the host reports no open chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { InstalledStorageAdapter, createMemoryBackend } from '../src/deployment/installed-storage.js';
import { createInstalledDevelopmentDeploymentSession } from '../src/deployment/installed-session.js';
import { Wave13LoreStudyUIAdapter, Wave13OperationalStatusAdapter } from '../src/ui-core/wave13-operator-adapters.js';
import { renderLoreStudySurface } from '../src/ui-core/wave13-operator-surfaces.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';
import { EV } from './helpers/installed-host.mjs';

const walk = (node) => [node, ...(node?.children ?? []).flatMap(walk)];

const CHAT = 'akira-chat';
const entries = Array.from({ length: 12 }, (_, i) => ({ uid: 'e' + i, content: `Akira guards the blade of district ${i} near the north gate.`, metadata: { title: 'Akira #' + i } }));
const book = (chatId) => ({ id: 'akira-book', title: 'Akira', chatId, discovery: { kind: 'Audit', stableId: 'akira-book', exactAuthoredSource: true, chatId }, entries });

async function host({ openChat = CHAT } = {}) {
  const chat = [{ is_user: true, mes: 'Akira asks about the blade near the north gate.', mesId: 'm0', name: 'User' }];
  const listeners = new Map();
  const context = { chatId: openChat, chat, mainApi: 'openai', eventTypes: EV, eventSource: { on(t, f) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); }, removeListener(t, f) { listeners.get(t)?.delete(f); } }, async setExtensionPrompt() {} };
  const emit = async (t, ...a) => { for (const f of [...(listeners.get(t) ?? [])]) await f(...a); };
  const session = await createInstalledDevelopmentDeploymentSession({ sillyTavern: { getContext: () => context }, document: null, mountUi: false, storage: new InstalledStorageAdapter({ backend: createMemoryBackend() }) });
  session.start();
  // The bindings the installed UI mounts with (brain owner hosts plus the live session's wrappers).
  const bindings = session.uiBindings();
  const nativeBindings = session.nativeBrain.uiBindings();
  const turn = async () => {
    const req = { chat: [{ role: 'system', content: 'host' }, { role: 'user', content: chat.at(-1).mes }], dryRun: false };
    await emit(EV.GENERATION_STARTED, 'normal', {}, false); await emit(EV.GENERATION_AFTER_COMMANDS, 'normal', {}, false); await emit(EV.CHAT_COMPLETION_PROMPT_READY, req);
    chat.push({ is_user: false, mes: 'Akira answers.', mesId: 'a' + chat.length }); await emit(EV.MESSAGE_RECEIVED, chat.length - 1, 'normal'); await emit(EV.GENERATION_ENDED, chat.length);
    const selection = nativeBindings.readSelection({ chatId: CHAT });
    const record = session.nativeBrain.readTurn(selection.turnId);
    chat.push({ is_user: true, mes: 'Akira asks about the blade again.', mesId: 'u' + chat.length });
    return { loreSync: record.loreSync, selection };
  };
  const studyState = () => JSON.stringify(session.brain.loreIntelligence.runtime.publicSurface({ metadataOnly: true }).entries.map((e) => [e.sourceId, e.studyState ?? e.state, e.learnedRevisionId ?? null]));
  return { session, bindings, context, turn, studyState };
}

test('Lore accepted for another chat is excluded visibly, then authorized for the open chat without re-study', async () => {
  const h = await host();
  h.session.brain.acceptLorebook(book('some-other-chat'), { receiptForm: 'REFERENCE' });
  await h.session.brain.runLoreStudyBatched({ scope: 'DUE' });

  const first = await h.turn();
  assert.equal(first.loreSync.status, 'EXCLUDED');
  assert.equal(first.loreSync.nominationCount, 0);
  // The reason reaches the operator inspection instead of a bare EXCLUDED.
  const inspection = new Wave13OperationalStatusAdapter({ hostBindings: h.bindings, liveReceiptBinding: { selection: () => first.selection } }).read().inspection;
  assert.equal(inspection.loreSync.status, 'EXCLUDED');
  assert.equal(inspection.loreSync.reasonCode, 'LORE_STORY_SCOPE_REQUIRED');
  assert.equal(inspection.loreSync.scopeState, first.loreSync.authorityScope?.state ?? null);

  // The Lore panel reports the gap for the open chat and offers the action.
  const panel = new Wave13LoreStudyUIAdapter({ bindings: h.bindings, selectionProvider: () => ({ chatId: CHAT }) });
  const read = panel.read();
  assert.equal(read.source.errorCode, 'LORE_NOT_AUTHORIZED_FOR_CHAT');
  assert.notEqual(read.source.mode, 'LIVE', 'unauthorized Lore is never shown as ready');
  const access = read.data.storyAccess;
  assert.equal(access.chatId, CHAT);
  assert.deepEqual(access.authorized, []);
  assert.deepEqual(access.unauthorized.map((row) => [row.lorebookId, row.title, row.entries]), [['akira-book', 'Akira', 12]]);
  assert.ok(panel.canAuthorizeForChat());

  const before = h.studyState();
  const receipt = await panel.authorizeForChat('akira-book');
  assert.equal(receipt.kind, 'LoreStoryAuthorizationReceipt');
  assert.equal(receipt.chatId, CHAT);
  assert.equal(receipt.restudied, false);
  assert.equal(h.studyState(), before, 'authorizing does not re-study or change learned state');
  const after = h.session.brain.loreIntelligence.storyReadStatus(CHAT);
  assert.deepEqual(after.authorized.map((row) => row.lorebookId), ['akira-book']);
  assert.deepEqual(after.unauthorized, []);
  assert.notEqual(panel.read().source.errorCode, 'LORE_NOT_AUTHORIZED_FOR_CHAT');

  const second = await h.turn();
  assert.equal(second.loreSync.status, 'SYNCED');
  assert.ok(second.loreSync.nominationCount > 0, 'the next turn reads the authorized Lore');
  // The other chat's binding is untouched (authorization is per chat and additive).
  assert.deepEqual(h.session.brain.loreIntelligence.storyReadStatus('some-other-chat').authorized.map((row) => row.lorebookId), ['akira-book']);
  h.session.destroy();
});

test('authorization refuses without a chat and for a Lorebook that was never accepted', async () => {
  const h = await host();
  h.session.brain.acceptLorebook(book('some-other-chat'), { receiptForm: 'REFERENCE' });
  assert.throws(() => h.session.brain.loreIntelligence.authorizeLorebookForStory({ chatId: '', lorebookId: 'akira-book' }), (e) => e.code === 'LORE_CHAT_REQUIRED');
  assert.throws(() => h.session.brain.loreIntelligence.authorizeLorebookForStory({ chatId: CHAT, lorebookId: 'missing-book' }), (e) => e.code === 'LOREBOOK_NOT_ACCEPTED');
  assert.deepEqual(h.session.brain.loreIntelligence.storyReadStatus(CHAT).authorized, []);
  const noChat = new Wave13LoreStudyUIAdapter({ bindings: h.bindings, selectionProvider: () => ({}) });
  await assert.rejects(() => noChat.authorizeForChat('akira-book'), (e) => e.code === 'LORE_CHAT_REQUIRED');
  assert.deepEqual(h.session.brain.loreIntelligence.storyReadStatus(CHAT).authorized, []);
  h.session.destroy();
});

test('Accept from the panel binds to the chat open at click time and refuses with no open chat', async () => {
  const h = await host();
  // The payload still names the chat that was open when the Lorebook was loaded; the open chat wins.
  const panel = new Wave13LoreStudyUIAdapter({ bindings: h.bindings, selectionProvider: () => ({ chatId: CHAT }) });
  await panel.accept(book('chat-open-at-load-time'));
  assert.deepEqual(h.session.brain.loreIntelligence.storyReadStatus(CHAT).authorized.map((row) => row.lorebookId), ['akira-book']);
  assert.deepEqual(h.session.brain.loreIntelligence.storyReadStatus('chat-open-at-load-time').authorized, []);
  await h.session.brain.runLoreStudyBatched({ scope: 'DUE' });
  const turn = await h.turn();
  assert.equal(turn.loreSync.status, 'SYNCED');
  assert.ok(turn.loreSync.nominationCount > 0);
  h.session.destroy();

  const h2 = await host();
  const closed = new Wave13LoreStudyUIAdapter({ bindings: h2.bindings, selectionProvider: () => ({}) });
  await assert.rejects(() => closed.accept(book('chat-open-at-load-time')), (e) => e.code === 'LORE_CHAT_REQUIRED');
  assert.equal(h2.session.brain.loreIntelligence.storyReadStatus(null).unauthorized.length, 0, 'nothing was accepted');
  h2.session.destroy();
});

test('the Lore panel shows the per-chat gap and its button authorizes the open chat', async () => {
  const h = await host();
  h.session.brain.acceptLorebook(book('some-other-chat'), { receiptForm: 'REFERENCE' });
  await h.session.brain.runLoreStudyBatched({ scope: 'DUE' });
  const panel = new Wave13LoreStudyUIAdapter({ bindings: h.bindings, selectionProvider: () => ({ chatId: CHAT }) });
  const clicks = new Map();
  const scope = { listen(node, type, handler) { if (type === 'click') clicks.set(node, handler); }, add() {}, timeout() {} };
  const d = new FakeDocument(), root = new FakeNode('section', d);
  let refreshes = 0;
  renderLoreStudySurface(root, { loreStudy: panel, actionRouter: { route: async () => ({ ok: true }) }, scope, refresh: () => { refreshes += 1; }, notifications: null, productAdapter: null });
  const text = walk(root).map((node) => node.textContent ?? '').join(' ');
  assert.match(text, /This chat cannot read the accepted Lore/);
  const button = walk(root).find((node) => node.tagName?.toLowerCase?.() === 'button' && /Use "Akira" for this chat/.test(node.textContent ?? ''));
  assert.ok(button, 'the authorize button is rendered');
  await clicks.get(button)();
  assert.equal(refreshes, 1);
  assert.deepEqual(h.session.brain.loreIntelligence.storyReadStatus(CHAT).authorized.map((row) => row.lorebookId), ['akira-book']);
  // Re-rendered once authorized: no gap message, no button.
  const again = new FakeNode('section', d);
  renderLoreStudySurface(again, { loreStudy: panel, actionRouter: { route: async () => ({ ok: true }) }, scope, refresh() {}, notifications: null, productAdapter: null });
  assert.doesNotMatch(walk(again).map((node) => node.textContent ?? '').join(' '), /for this chat"|cannot read the accepted Lore/);
  h.session.destroy();
});
