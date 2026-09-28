import { makeSession, normalTurn } from './host.mjs';
const filler=(i,n)=>('Turn '+i+': '+'The lantern light flickers across the worn tavern tables while rain drums outside. ').repeat(Math.ceil(n/90)).slice(0,n);
const h = makeSession({ chatId: 'chat:grow' }); h.session.start();
for (let i=1;i<=22;i++){ const r=await normalTurn(h, filler(i,300), filler(i,600)); const sel=h.nativeBrain.uiBindings().readSelection({chatId:'chat:grow'}); const t=h.nativeBrain.readTurn(sel.turnId);
 if(i%3===0||i>=19){ const secs=(t.delivery?.plan?.sections??[]).map(s=>s.slot+':'+(s.estimatedTokens??s.tokens??Math.round((s.text||'').length/4))+(s.representation&&s.representation!=='RICH'?'/'+s.representation:'')); console.log('turn',i,'query ok:',t.query.startsWith('Turn '+i+':'),'| plan tokens',t.delivery?.plan?.allocation?.totalTokens??t.performance?.sizes?.promptPlanTokens,'/',t.performance?.sizes?.promptBudgetTokens,'| packet bytes',t.performance?.sizes?.compiledPacketBytes,'|',secs.join(' ')); } }
h.session.destroy();
