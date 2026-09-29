// PROBE (LOCAL_DETERMINISTIC_NODE): the 1,099 MB `heapMB` sample in stress-lore1200 was process.memoryUsage().heapUsed read
// once without a GC. This probe runs the same workload and records, per phase, raw heapUsed (includes uncollected garbage),
// retained heap after a forced full GC, and the peak raw reading; then repeats the 10-entry edit three times to separate
// transient allocation from retained growth. Run: node --expose-gc audit-20260928/harness/probe-heap-lore1200.mjs
import { makeSession, normalTurn } from './host.mjs';
if (typeof globalThis.gc !== 'function') throw new Error('run with --expose-gc');
const N = Number(process.env.N || 1200), chatId = 'chat:heap' + N;
const places = ['Ember Tavern', 'Silver Keep', 'Greyharbor', 'River District', 'Ashfall Pass', 'Moonwell', 'Thornwood', 'Saint Veyra'];
const names = Array.from({ length: 150 }, (_, i) => ['Mara', 'Eris', 'Kael', 'Lyra', 'Tomas', 'Anya', 'Rhys', 'Selene', 'Dorian', 'Mira'][i % 10] + (i >= 10 ? ' ' + String.fromCharCode(65 + (i % 26)) + (i >> 4) : ''));
function entry(i, rev = 1) {
  const a = names[i % names.length], b = names[(i * 7 + 3) % names.length], p = places[i % places.length];
  return { uid: 'e' + i, content: `${a} ${rev > 1 ? 'no longer' : ''} guards the ${['vault', 'gate', 'archive', 'forge'][i % 4]} of ${p}. ${a} distrusts ${b} after the incident of year ${900 + (i % 97)}. The ${['amber', 'iron', 'glass', 'bone'][i % 4]} sigil of ${p} marks entry ${i}.`, metadata: { title: `${a} — ${p} #${i}`, treePath: ['People', a], at: i } };
}
const book = (rev = 1, edited = new Set()) => ({ id: 'synthetic-' + N, title: 'Synthetic ' + N, chatId, discovery: { kind: 'AuditSyntheticFixture', stableId: 'synthetic-' + N, exactAuthoredSource: true }, entries: Array.from({ length: N }, (_, i) => entry(i, edited.has(i) ? rev : 1)) });
const MB = (b) => Math.round(b / 1048576);
let peak = 0; const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 5); sampler.unref();
const rows = [];
function phase(name, extra = {}) {
  const raw = process.memoryUsage().heapUsed; peak = Math.max(peak, raw); globalThis.gc(); globalThis.gc();
  const m = process.memoryUsage(); rows.push({ phase: name, rawMB: MB(raw), retainedMB: MB(m.heapUsed), peakRawMB: MB(peak), rssMB: MB(m.rss), ...extra }); peak = m.heapUsed;
}
phase('start');
const h = makeSession({ chatId });
let t0 = performance.now(); h.session.ingestLorebook(book()); phase('ingest+study', { ms: Math.round(performance.now() - t0) });
h.session.start();
for (let i = 1; i <= 8; i++) await normalTurn(h, `Kael asks Mara about the amber sigil of Silver Keep (${i}).`, 'Mara hesitates before answering.');
phase('8 turns');
JSON.stringify(h.session.exportEvidence()); phase('exportEvidence');
const ui = h.session.uiBindings(); for (const [k, fn] of Object.entries(ui)) if (typeof fn === 'function' && /^read/.test(k)) { try { JSON.stringify(fn({ chatId }) ?? null); } catch {} }
phase('UI readers');
const edited = new Set([5, 77, 300, 301, 450, 600, 777, 900, 1001, 1199].filter((x) => x < N));
for (let rev = 2; rev <= 4; rev++) { t0 = performance.now(); h.session.ingestLorebook(book(rev, edited)); phase('edit 10 entries (rev ' + rev + ')', { ms: Math.round(performance.now() - t0) }); }
h.session.destroy(); phase('destroyed');
console.log(JSON.stringify({ N, node: process.version, rows }, null, 1));
