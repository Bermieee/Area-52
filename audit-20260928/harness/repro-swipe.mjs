// Reproducer R2: swipe / regenerate / continue after an ordinary turn.
// SillyTavern order (script.js): swipe -> MESSAGE_SWIPED -> Generate('swipe'); regenerate deletes
// last assistant message (MESSAGE_DELETED) then Generate('regenerate'); continue -> Generate('continue').
import { makeSession, normalTurn, pushAssistant, EVENT_TYPES, lastErrors } from './host.mjs';

async function run(kind) {
  const h = makeSession({ chatId: 'chat:' + kind });
  h.session.start();
  const injected = (req) => req.chat.length - 2;
  await normalTurn(h, 'Mara wipes the bar of the Ember Tavern.', 'Eris walks in carrying the Sun Blade.');
  const errorsBefore = h.session.exportEvidence().errors.length;
  let req;
  if (kind === 'swipe') {
    const last = h.context.chat.length - 1;
    await h.emit(EVENT_TYPES.MESSAGE_SWIPED, last);
    h.context.chat[last].mes = '...';
    await h.emit(EVENT_TYPES.GENERATION_STARTED, 'swipe', {}, false);
    await h.emit(EVENT_TYPES.GENERATION_AFTER_COMMANDS, 'swipe', {}, false);
    req = { chat: [{ role: 'system', content: 'host system prompt' }, { role: 'user', content: 'x' }] };
    await h.emit(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, req);
    h.context.chat[last].mes = 'A different swipe: Eris arrives empty-handed.';
    await h.emit(EVENT_TYPES.MESSAGE_RECEIVED, last, 'swipe');
  } else if (kind === 'regenerate') {
    const last = h.context.chat.length - 1;
    h.context.chat.pop();
    await h.emit(EVENT_TYPES.MESSAGE_DELETED, last);
    await normalTurn(h, 'Mara wipes the bar of the Ember Tavern.', 'Regenerated: Eris is late.', { type: 'regenerate', skipUserPush: true }).then((r) => { req = r.request; });
  } else if (kind === 'continue') {
    await h.emit(EVENT_TYPES.GENERATION_STARTED, 'continue', {}, false);
    await h.emit(EVENT_TYPES.GENERATION_AFTER_COMMANDS, 'continue', {}, false);
    req = { chat: [{ role: 'system', content: 'host system prompt' }, { role: 'user', content: 'x' }] };
    await h.emit(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, req);
    const last = h.context.chat.length - 1; h.context.chat[last].mes += ' She sets it on the bar.';
    await h.emit(EVENT_TYPES.MESSAGE_RECEIVED, last, 'continue');
  }
  const errs = h.session.exportEvidence().errors.slice(errorsBefore).map((e) => e.stage + ': ' + e.message);
  console.log(kind.padEnd(10), 'Area-52 messages injected =', injected(req), '| new errors:', JSON.stringify(errs));
  h.session.destroy();
}
for (const k of ['swipe', 'regenerate', 'continue']) await run(k);
