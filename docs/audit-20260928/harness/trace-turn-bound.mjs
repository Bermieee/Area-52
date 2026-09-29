import { makeSession, normalTurn } from './host.mjs';
import { createGoldenDeploymentLorebook } from '../../../src/deployment/brain.js';
const h = makeSession({ chatId: 'chat:trace' });
h.session.ingestLorebook({...createGoldenDeploymentLorebook(), chatId:'chat:trace'});
h.session.start();
await normalTurn(h, 'Eris returns to the tavern.', 'Mara looks up from the counter.');
const t = await normalTurn(h, 'Where can Eris find the Sun Blade now?', 'Nobody knows.');
const sel = h.nativeBrain.uiBindings().readSelection({ chatId: h.context.chatId });
const turn = h.nativeBrain.readTurn(sel.turnId);
const keys = (o, d=0) => o && typeof o==='object' ? Object.keys(o) : o;
console.log('readTurn keys:', Object.keys(turn));
for (const k of Object.keys(turn)) { const v = turn[k]; console.log(' ', k, ':', Array.isArray(v) ? `array(${v.length})` : (v && typeof v === 'object' ? Object.keys(v).slice(0,25).join(',') : String(v).slice(0,80))); }
const fs = await import('node:fs'); fs.writeFileSync('/home/claude/audit/results/turn-trace-bound.json', JSON.stringify(turn, null, 1));
console.log('bytes', JSON.stringify(turn).length);
h.session.destroy();
