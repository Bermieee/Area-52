// Reproducer R1: a SillyTavern quiet generation (another extension's
// generateQuietPrompt) between two ordinary Sends.
import { makeSession, normalTurn, quietTurn, lastErrors } from './host.mjs';

const h = makeSession({ chatId: 'chat:quiet' });
h.session.start();
const injected = (req) => req.chat.length - 2; // host supplies 2 messages

const t1 = await normalTurn(h, 'Mara wipes the bar of the Ember Tavern.', 'Eris walks in carrying the Sun Blade.');
console.log('T1 normal: Area-52 messages injected =', injected(t1.request));

const q = await quietTurn(h, 'Summarize the story so far in one line.');
console.log('Quiet generation: Area-52 messages injected into the quiet request =', injected(q.request));
console.log('  pending after quiet:', [...h.session.nativePending.values()].map((p) => p.state));

const t2 = await normalTurn(h, 'Eris asks Mara about the fire.', 'Mara says the fire started in the cellar.');
console.log('T2 normal: Area-52 messages injected =', injected(t2.request));
console.log('  errors:', lastErrors(h.session, 3));
const hist = h.session.nativeHistory.filter((r) => r.state === 'RESPONSE_COMPLETED');
console.log('  completed turns:', hist.map((r) => ({ turnId: r.turnId.split(':').slice(-1)[0], userMessageIndex: r.userMessageIndex, assistantMessageIndex: r.assistantMessageIndex, generationType: r.generationType })));

const t3 = await normalTurn(h, 'Eris searches the cellar.', 'Ash covers everything.');
console.log('T3 normal: Area-52 messages injected =', injected(t3.request));
console.log('  errors:', lastErrors(h.session, 3));
h.session.destroy();
