// Text-completion backends: SillyTavern never emits CHAT_COMPLETION_PROMPT_READY.
import { makeSession, pushUser, pushAssistant, EVENT_TYPES } from './host.mjs';
const h = makeSession({ chatId: 'chat:tc' }); h.session.start();
for (let i=1;i<=3;i++){
  pushUser(h.context,'Text-completion turn '+i+'.');
  await h.emit(EVENT_TYPES.GENERATION_AFTER_COMMANDS,'normal',{},false);
  const idx=pushAssistant(h.context,'Reply '+i+'.'); await h.emit(EVENT_TYPES.MESSAGE_RECEIVED,idx,'normal'); await h.emit(EVENT_TYPES.GENERATION_ENDED,h.context.chat.length);
  console.log('turn',i,'pending:',h.session.nativePending.size,'runs:',h.session.nativeRuns.size,'last error:',h.session.exportEvidence().errors.at(-1)?.message);
}
h.session.destroy();
