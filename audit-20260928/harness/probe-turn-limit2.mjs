import { makeSession, normalTurn, EVENT_TYPES } from './host.mjs';
const LEN=Number(process.env.LEN||60);
const filler=(i,n)=>('Turn '+i+': '+'The lantern light flickers across the worn tavern tables while rain drums outside. ').repeat(Math.ceil(n/90)).slice(0,n);
const h = makeSession({ chatId: 'chat:limit2' }); h.session.start();
let firstFail=null, after=[];
for (let i=1;i<=60;i++){ const r = await normalTurn(h, filler(i,Math.min(LEN,300)), filler(i,LEN)); const inj=r.request.chat.length-2; if(inj<=0&&!firstFail)firstFail=i; if(firstFail&&i>firstFail&&i<=firstFail+3) after.push(inj); if(firstFail&&i>=firstFail+3)break; }
const errs=h.session.exportEvidence().errors.map(e=>e.message);
console.log(`reply ${LEN} chars: first failing turn=${firstFail}; injections on next 3 turns=${JSON.stringify(after)}; errors=${JSON.stringify([...new Set(errs)])}`);
// chat switch clears?
h.context.chatId='chat:other'; await h.emit(EVENT_TYPES.CHAT_CHANGED,'chat:other'); h.context.chatId='chat:limit2'; await h.emit(EVENT_TYPES.CHAT_CHANGED,'chat:limit2');
const r=await normalTurn(h,'After chat switch.','ok.'); console.log('after CHAT_CHANGED back: injected',r.request.chat.length-2, h.session.exportEvidence().errors.at(-1)?.message);
h.session.destroy();
