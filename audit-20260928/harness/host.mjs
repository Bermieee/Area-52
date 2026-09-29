// Audit harness: fake SillyTavern host that replays the event ORDER observed in
// SillyTavern public/script.js (clone @06bde939, 2026-09-14) for the events the
// Area-52 installed session subscribes to. It drives the real production
// session (createDevelopmentDeploymentSillyTavernSession + Area52NativeBrain),
// i.e. the same objects index.js constructs, minus DOM mounting.
import { Area52NativeBrain } from '../../src/native-brain.js';
import { createDevelopmentDeploymentSillyTavernSession } from '../../src/deployment/sillytavern-live.js';

export const EVENT_TYPES = {
  GENERATION_AFTER_COMMANDS: 'generation_after_commands', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
  MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED: 'message_edited', MESSAGE_DELETED: 'message_deleted',
  MESSAGE_UPDATED: 'message_updated', MESSAGE_SWIPED: 'message_swiped', MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
  CHAT_CHANGED: 'chat_id_changed', CHAT_LOADED: 'chatLoaded', CHAT_CREATED: 'chat_created', CHAT_RENAMED: 'chat_renamed',
  WORLDINFO_UPDATED: 'worldinfo_updated', WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
  GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped',
  IMPERSONATE_READY: 'impersonate_ready',
};

export function makeHost({ chatId = 'chat:audit' } = {}) {
  const listeners = new Map();
  const context = {
    chatId, chat: [], eventTypes: EVENT_TYPES,
    eventSource: {
      on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeListener(type, fn) { listeners.get(type)?.delete(fn); },
    },
    async setExtensionPrompt() {},
  };
  // Mirrors eventSource.emit: awaits listeners sequentially.
  async function emit(type, ...args) {
    for (const fn of [...(listeners.get(type) ?? [])]) await fn(...args);
  }
  return { sillyTavern: { getContext: () => context }, context, listeners, emit };
}

export function makeSession({ chatId, nativeBrain = new Area52NativeBrain(), ...opts } = {}) {
  const host = makeHost({ chatId });
  const session = createDevelopmentDeploymentSillyTavernSession({ sillyTavern: host.sillyTavern, document: null, mountUi: false, nativeBrain, ...opts });
  return { ...host, session, nativeBrain };
}

let mesSeq = 0;
export function pushUser(context, mes) { context.chat.push({ is_user: true, mes, mesId: 'u' + (++mesSeq), send_date: Date.now() }); return context.chat.length - 1; }
export function pushAssistant(context, mes) { context.chat.push({ is_user: false, name: 'Narrator', mes, mesId: 'a' + (++mesSeq), send_date: Date.now() }); return context.chat.length - 1; }

// Normal Send, following Generate(): GENERATION_STARTED -> GENERATION_AFTER_COMMANDS
// -> (chat completion) CHAT_COMPLETION_PROMPT_READY -> reply appended -> MESSAGE_RECEIVED -> GENERATION_ENDED.
export async function normalTurn(h, userText, assistantText, { type = 'normal', providerError = false, skipUserPush = false } = {}) {
  if (!skipUserPush) pushUser(h.context, userText);
  await h.emit(EVENT_TYPES.GENERATION_STARTED, type, {}, false);
  await h.emit(EVENT_TYPES.GENERATION_AFTER_COMMANDS, type, {}, false);
  const request = { chat: [{ role: 'system', content: 'host system prompt' }, { role: 'user', content: userText }], dryRun: false };
  await h.emit(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, request);
  if (providerError) { await h.emit(EVENT_TYPES.GENERATION_ENDED, h.context.chat.length); return { request, error: true }; }
  const idx = pushAssistant(h.context, assistantText);
  await h.emit(EVENT_TYPES.MESSAGE_RECEIVED, idx, type);
  await h.emit(EVENT_TYPES.GENERATION_ENDED, h.context.chat.length);
  return { request, idx };
}

// Quiet generation (generateQuietPrompt, used by e.g. Summarize/Expressions/Image
// prompt extensions): same pre-events, NO MESSAGE_RECEIVED; result returned to caller.
export async function quietTurn(h, quietPrompt = 'Summarize the story so far.') {
  await h.emit(EVENT_TYPES.GENERATION_STARTED, 'quiet', { quiet_prompt: quietPrompt }, false);
  await h.emit(EVENT_TYPES.GENERATION_AFTER_COMMANDS, 'quiet', { quiet_prompt: quietPrompt }, false);
  const request = { chat: [{ role: 'system', content: 'host system prompt' }, { role: 'user', content: quietPrompt }], dryRun: false };
  await h.emit(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, request);
  await h.emit(EVENT_TYPES.GENERATION_ENDED, h.context.chat.length);
  return { request };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, { timeout = 3000, step = 10 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(step); }
  return null;
}
export function a52Messages(request) { return request.chat.filter((m) => !['host system prompt'].includes(m.content) && m.role === 'system' || String(m.content ?? '').includes('AREA52') ); }
export function lastErrors(session, n = 5) { return session.exportEvidence().errors.slice(-n).map((e) => e.stage + ': ' + e.message); }
