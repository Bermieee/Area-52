import { makeSession, normalTurn, sleep } from './host.mjs';
const h = makeSession({ chatId: 'chat:limit' }); h.session.start();
let firstFail=null;
for (let i=1;i<=45;i++){ const r = await normalTurn(h, 'Line number '+i+' of the story.', 'Reply '+i+'.'); const inj=r.request.chat.length-2; if(inj<=0&&!firstFail){firstFail=i;} }
console.log('first turn with no injection:', firstFail);
console.log('errors (unique):', [...new Set(h.session.exportEvidence().errors.map(e=>e.stage+': '+e.message))]);
console.log('completed native turns:', h.session.nativeHistory.filter(r=>r.state==='RESPONSE_COMPLETED').length);
h.session.destroy();
