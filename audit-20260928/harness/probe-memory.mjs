import { makeSession, normalTurn, EVENT_TYPES } from './host.mjs';
const h = makeSession({ chatId: 'chat:mem' }); h.session.start();
await normalTurn(h, 'Mara wipes the bar of the Ember Tavern.', 'Eris walks in carrying the Sun Blade UNIQUETOKEN.');
await new Promise(r=>setTimeout(r,200));
const snap = JSON.stringify(h.session.brain.memory.snapshot());
console.log('memory snapshot bytes', snap.length, 'contains assistant token:', snap.includes('UNIQUETOKEN'));
const nsnap = JSON.stringify(h.nativeBrain.snapshot());
console.log('native snapshot bytes', nsnap.length, 'contains token:', nsnap.includes('UNIQUETOKEN'));
// delete the assistant message in host
const last=h.context.chat.length-1; h.context.chat.pop(); await h.emit(EVENT_TYPES.MESSAGE_DELETED, last);
await new Promise(r=>setTimeout(r,200));
console.log('after host delete: memory contains token:', JSON.stringify(h.session.brain.memory.snapshot()).includes('UNIQUETOKEN'), '| native contains token:', JSON.stringify(h.nativeBrain.snapshot()).includes('UNIQUETOKEN'));
// retrieval: does next turn deliver deleted text?
const r = await normalTurn(h, 'What is Eris carrying into the tavern?', 'Nothing.');
console.log('next turn request includes deleted token:', JSON.stringify(r.request.chat.slice(0,-1)).includes('UNIQUETOKEN'));
console.log(Object.keys(h.session.brain.memory.snapshot()));
h.session.destroy();
