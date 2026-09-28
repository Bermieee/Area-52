import { makeSession, normalTurn, EVENT_TYPES } from './host.mjs';
const h = makeSession({ chatId: 'chat:mem' }); h.session.start();
await normalTurn(h, 'Mara wipes the bar of the Ember Tavern.', 'Eris walks in carrying the Sun Blade UNIQUETOKEN.');
const last=h.context.chat.length-1; h.context.chat.pop(); await h.emit(EVENT_TYPES.MESSAGE_DELETED, last);
const r = await normalTurn(h, 'What is Eris carrying into the tavern?', 'Nothing.');
for (const m of r.request.chat) { const c=String(m.content); if(c.includes('UNIQUETOKEN')){ const i=c.indexOf('UNIQUETOKEN'); console.log(m.role, '...'+c.slice(Math.max(0,i-400),i+40).replace(/\n/g,' | ')); } }
h.session.destroy();
