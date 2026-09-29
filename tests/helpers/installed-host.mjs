// Installed-session fake SillyTavern host (event order per SillyTavern public/script.js Generate()).
// FAKE-HOST evidence only.
import { Area52NativeBrain } from '../../src/native-brain.js';
import { createDevelopmentDeploymentSillyTavernSession } from '../../src/deployment/sillytavern-live.js';

export const EV = {
  GENERATION_AFTER_COMMANDS: 'generation_after_commands', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
  GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
  MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED: 'message_edited', MESSAGE_DELETED: 'message_deleted',
  MESSAGE_UPDATED: 'message_updated', MESSAGE_SWIPED: 'message_swiped', MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
  CHAT_CHANGED: 'chat_id_changed', CHAT_LOADED: 'chatLoaded', CHAT_CREATED: 'chat_created', CHAT_RENAMED: 'chat_renamed',
  WORLDINFO_UPDATED: 'worldinfo_updated', WORLDINFO_SETTINGS_UPDATED: 'worldinfo_settings_updated',
  GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped',
};
export function makeInstalled({ chatId = 'chat:w1', mainApi = 'openai', nativeBrain = new Area52NativeBrain() } = {}) {
  const listeners = new Map();
  const context = { chatId, chat: [], mainApi, eventTypes: EV,
    eventSource: { on(t, f) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); }, removeListener(t, f) { listeners.get(t)?.delete(f); } },
    async setExtensionPrompt() {} };
  const emit = async (t, ...a) => { for (const f of [...(listeners.get(t) ?? [])]) await f(...a); };
  const session = createDevelopmentDeploymentSillyTavernSession({ sillyTavern: { getContext: () => context }, document: null, mountUi: false, nativeBrain });
  session.start();
  let seq = 0;
  const user = (mes) => { context.chat.push({ is_user: true, mes, mesId: 'u' + (++seq) }); return context.chat.length - 1; };
  const assistant = (mes) => { context.chat.push({ is_user: false, mes, mesId: 'a' + (++seq) }); return context.chat.length - 1; };
  const request = () => ({ chat: [{ role: 'system', content: 'host system' }, { role: 'user', content: context.chat.at(-1)?.mes ?? '' }] });
  // One generation following Generate(): STARTED -> AFTER_COMMANDS -> combine (text or '' for openai) -> chat-completion ready -> reply -> RECEIVED -> ENDED.
  async function generate(type, reply, { textPrompt = null, failProvider = false } = {}) {
    await emit(EV.GENERATION_STARTED, type, {}, false);
    await emit(EV.GENERATION_AFTER_COMMANDS, type, {}, false);
    const combine = { prompt: mainApi === 'openai' ? '' : (textPrompt ?? `Story so far\n${context.chat.map((m) => m.mes).join('\n')}\nNarrator:`), dryRun: false };
    await emit(EV.GENERATE_AFTER_COMBINE_PROMPTS, combine);
    let req = null;
    if (mainApi === 'openai') { req = request(); await emit(EV.CHAT_COMPLETION_PROMPT_READY, req); }
    if (failProvider) { await emit(EV.GENERATION_ENDED, context.chat.length); return { req, combine, failed: true }; }
    let idx;
    if (type === 'swipe') { idx = context.chat.length - 1; context.chat[idx].mes = reply; }
    else if (type === 'continue') { idx = context.chat.length - 1; context.chat[idx].mes += ' ' + reply; }
    else if (type === 'quiet' || type === 'impersonate') { await emit(EV.GENERATION_ENDED, context.chat.length); return { req, combine }; }
    else idx = assistant(reply);
    await emit(EV.MESSAGE_RECEIVED, idx, type);
    await emit(EV.GENERATION_ENDED, context.chat.length);
    return { req, combine, idx };
  }
  const injected = (r) => (r.req ? r.req.chat.length - 2 : (r.combine.prompt.includes('[Area-52') || r.combine.prompt.includes('## ') ? 1 : 0));
  const errors = () => session.exportEvidence().errors.map((e) => e.stage + ': ' + e.message);
  const learned = () => session.nativeHistory.filter((r) => r.state === 'RESPONSE_COMPLETED');
  return { context, emit, session, nativeBrain, user, assistant, generate, injected, errors, learned };
}

