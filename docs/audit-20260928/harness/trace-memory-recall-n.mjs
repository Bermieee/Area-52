// Multi-turn: narrative facts learned earlier -> are they retrieved later, through which channel,
// with what temporal status? Also: does narrative state change settle into Temporal State?
import { makeSession, normalTurn, sleep } from './host.mjs';
import { createGoldenDeploymentLorebook } from '../../../src/deployment/brain.js';
const h = makeSession({ chatId: 'chat:recall' });
h.session.ingestLorebook({ ...createGoldenDeploymentLorebook(), chatId: 'chat:recall' });
h.session.start();
const story = [
  ['Eris hands Mara a silver key engraved with a heron.', 'Mara pockets the heron key and nods.'],
  ['We talk about the weather for a while.', 'The rain keeps falling.'],
  ['Mara locks the cellar door.', 'The lock clicks shut.'],
  ['Eris orders a stew.', 'The stew is hot and salty.'],
  ['A bard starts playing.', 'The music is loud.'],
  ['Eris yawns.', 'Night deepens.'],
];
for (let i=0;i<Number(process.env.FILLER||0);i++) story.push(['Eris sips her drink number '+i+'.','Time passes quietly '+i+'.']);
for (const [u, a] of story) { await normalTurn(h, u, a); await sleep(30); }
await sleep(300);
const t = await normalTurn(h, 'Who has the heron key right now?', 'Mara does.');
const sel = h.nativeBrain.uiBindings().readSelection({ chatId: h.context.chatId });
const turn = h.nativeBrain.readTurn(sel.turnId);
console.log('channels with nominations:', turn.performance.retrievalChannels.filter((c) => c.nominationCount).map((c) => c.channelId + ':' + c.nominationCount).join(' '));
console.log('memorySync:', JSON.stringify({ s: turn.memorySync.status, n: turn.memorySync.nominationCount }));
const truth = turn.published.assessment.truthResults;
for (const r of truth) if (/heron|narrative|episode|memory/i.test(r.candidateId)) console.log('  truth', r.classification, r.usableForIntent, (r.reasons || []).join(','), r.candidateId.slice(0, 80));
const txt = t.request.chat.slice(0, -1).map((m) => String(m.content)).join('\n');
const secs=turn.delivery.plan.sections; const ui=secs.find(s=>s.slot==='USER_INPUT'); console.log('USER_INPUT text:',JSON.stringify(ui?.text)); const cs=secs.find(s=>s.slot==='CURRENT_SCENE')?.text||''; const i=cs.search(/heron/i); console.log('heron context in CURRENT_SCENE:', cs.slice(Math.max(0,i-300),i+60).replace(/\s+/g,' ')); console.log('query recorded:',turn.query); for(const s of secs) console.log('  section',s.slot,'mentions heron:',/heron/i.test(s.text||''),'bytes',(s.text||'').length);
console.log('settlements over session:', [...h.nativeBrain.turns?.values?.() ?? []].reduce((a, r) => a + (r.settlements?.length ?? 0), 0));
console.log('native temporal claims:', h.nativeBrain.core.graph.allClaims().length, '| memory episodes (approx):', (JSON.stringify(h.session.brain.memory.snapshot()).match(/"episodeId"/g) ?? []).length);
h.session.destroy();
