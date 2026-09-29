// PROBE (LOCAL_DETERMINISTIC_NODE): longest event-loop stalls during the operator's batched Lore study (runLoreStudyBatched)
// on a 1,200-entry synthetic Lorebook, attributed to the synchronous chunk that caused them. A chunk is timed by wrapping
// the owner/runtime entry points; lag is measured by a 1 ms heartbeat. Run: node audit-20260928/harness/probe-batched-stalls.mjs
import { makeSession } from './host.mjs';
const N = Number(process.env.N || 1200), chatId = 'chat:stall';
const places = ['Ember Tavern', 'Silver Keep', 'Greyharbor', 'River District', 'Ashfall Pass', 'Moonwell', 'Thornwood', 'Saint Veyra'];
const names = Array.from({ length: 150 }, (_, i) => ['Mara', 'Eris', 'Kael', 'Lyra', 'Tomas', 'Anya', 'Rhys', 'Selene', 'Dorian', 'Mira'][i % 10] + (i >= 10 ? ' ' + String.fromCharCode(65 + (i % 26)) + (i >> 4) : ''));
const entries = Array.from({ length: N }, (_, i) => { const a = names[i % names.length], b = names[(i * 7 + 3) % names.length], p = places[i % places.length]; return { uid: 'e' + i, content: `${a} guards the vault of ${p}. ${a} distrusts ${b} after the incident of year ${900 + (i % 97)}. The sigil of ${p} marks entry ${i}.`, metadata: { title: `${a} — ${p} #${i}`, treePath: ['People', a], at: i } }; });
const h = makeSession({ chatId }); const b = h.session.brain, svc = b.loreIntelligence;
let t = performance.now();
b.acceptLorebook({ id: 'syn', title: 'syn', chatId, discovery: { kind: 'Audit', stableId: 'syn', exactAuthoredSource: true }, entries });
const acceptMs = performance.now() - t;
const chunks = new Map();
const wrap = (obj, name, label = name) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const s = performance.now(); try { return f(...a); } finally { const d = performance.now() - s; const r = chunks.get(label) ?? { n: 0, total: 0, max: 0 }; r.n++; r.total += d; r.max = Math.max(r.max, d); chunks.set(label, r); } }; };
wrap(svc, 'studyObligation'); wrap(svc, 'runMaintenanceSlice'); wrap(svc.hierarchy, 'refreshRetrieval'); wrap(svc, '_studyReceipt'); wrap(svc, 'beginMaintenance'); wrap(svc, 'dueObligationIds');
wrap(b.runtimeDirector, 'runCycle');
let last = performance.now(); const gaps = [];
const beat = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 1);
t = performance.now();
await b.runLoreStudyBatched({ scope: 'DUE' });
const studyMs = performance.now() - t;
clearInterval(beat);
gaps.sort((x, y) => y - x);
const status = svc.status({ chatId, metadataOnly: true });
console.log(JSON.stringify({ N, acceptMs: Math.round(acceptMs), batchedStudyMs: Math.round(studyMs), ready: status.counts.READY,
  longestStallsMs: gaps.slice(0, 8).map(Math.round), stallsOver100ms: gaps.filter((g) => g > 100).length, stallsOver50ms: gaps.filter((g) => g > 50).length,
  chunks: Object.fromEntries([...chunks].map(([k, r]) => [k, { n: r.n, maxMs: Math.round(r.max), totalMs: Math.round(r.total) }])) }, null, 1));
h.session.destroy();
