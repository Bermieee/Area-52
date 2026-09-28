// STRESS (LOCAL_DETERMINISTIC_NODE, synthetic lorebook): 1,200-entry Lorebook through the installed
// session path (session.ingestLorebook with chatId = story-bound acceptance + DUE study), then turns,
// status/export reads, and a 10-entry source edit.
import { makeSession, normalTurn } from './host.mjs';
const N = Number(process.env.N || 1200), chatId = 'chat:lore' + N;
const places = ['Ember Tavern', 'Silver Keep', 'Greyharbor', 'River District', 'Ashfall Pass', 'Moonwell', 'Thornwood', 'Saint Veyra'];
const names = Array.from({ length: 150 }, (_, i) => ['Mara', 'Eris', 'Kael', 'Lyra', 'Tomas', 'Anya', 'Rhys', 'Selene', 'Dorian', 'Mira'][i % 10] + (i >= 10 ? ' ' + String.fromCharCode(65 + (i % 26)) + (i >> 4) : ''));
function entry(i, rev = 1) {
  const a = names[i % names.length], b = names[(i * 7 + 3) % names.length], p = places[i % places.length];
  return { uid: 'e' + i, content: `${a} ${rev > 1 ? 'no longer' : ''} guards the ${['vault', 'gate', 'archive', 'forge'][i % 4]} of ${p}. ${a} distrusts ${b} after the incident of year ${900 + (i % 97)}. The ${['amber', 'iron', 'glass', 'bone'][i % 4]} sigil of ${p} marks entry ${i}.`, metadata: { title: `${a} — ${p} #${i}`, treePath: ['People', a], at: i } };
}
const book = (rev = 1, edited = new Set()) => ({ id: 'synthetic-' + N, title: 'Synthetic ' + N, chatId, discovery: { kind: 'AuditSyntheticFixture', stableId: 'synthetic-' + N, exactAuthoredSource: true }, entries: Array.from({ length: N }, (_, i) => entry(i, edited.has(i) ? rev : 1)) });
const mb = () => Math.round(process.memoryUsage().heapUsed / 1048576);
const h = makeSession({ chatId });
let t0 = performance.now();
const r = h.session.ingestLorebook(book());
const ingestMs = performance.now() - t0;
console.log(JSON.stringify({ N, ingestAndStudyMs: Math.round(ingestMs), mappingCount: r.mappingCount, retrievable: r.retrievable, heapMB: mb() }));
h.session.start();
const turnMs = [];
for (let i = 1; i <= 8; i++) {
  t0 = performance.now();
  const res = await normalTurn(h, `Kael asks Mara about the amber sigil of Silver Keep (${i}).`, 'Mara hesitates before answering.');
  turnMs.push(Math.round(performance.now() - t0));
  if (i === 1) { const sel = h.nativeBrain.uiBindings().readSelection({ chatId }); const t = h.nativeBrain.readTurn(sel.turnId); console.log('turn1 lore', JSON.stringify({ s: t.loreSync.status, n: t.loreSync.nominationCount, sparse: t.sparseRetrievalReceipt.eligibleCount + '/' + t.sparseRetrievalReceipt.indexedCount, compacted: t.sparseRetrievalReceipt.compacted, injectedMsgs: res.request.chat.length - 2, sections: t.delivery?.plan?.sections?.map((s) => s.slot + (s.representation !== 'RICH' ? '/' + s.representation : '')) })); }
}
console.log('turn wall ms (host prepare+inject+complete, provider instant):', JSON.stringify(turnMs), 'heapMB', mb());
const errs = [...new Set(h.session.exportEvidence().errors.map((e) => e.message))]; if (errs.length) console.log('errors:', errs);
t0 = performance.now(); const ev = JSON.stringify(h.session.exportEvidence()); console.log('exportEvidence bytes', ev.length, 'ms', Math.round(performance.now() - t0));
const ui = h.session.uiBindings(); const readers = Object.entries(ui).filter(([k, v]) => typeof v === 'function' && /^read/.test(k));
const readSizes = [];
for (const [k, fn] of readers) { try { t0 = performance.now(); const v = fn({ chatId }); const s = JSON.stringify(v ?? null).length; readSizes.push([k, s, Math.round(performance.now() - t0)]); } catch (e) { readSizes.push([k, 'ERR ' + String(e.message).slice(0, 40), 0]); } }
readSizes.sort((a, b) => (typeof b[1] === 'number' ? b[1] : 0) - (typeof a[1] === 'number' ? a[1] : 0));
console.log('UI readers:', readers.length, 'largest:', JSON.stringify(readSizes.slice(0, 8)));
const edited = new Set([5, 77, 300, 301, 450, 600, 777, 900, 1001, 1199].filter((x) => x < N));
t0 = performance.now(); const r2 = h.session.ingestLorebook(book(2, edited)); console.log('edit 10 entries: re-accept+study ms', Math.round(performance.now() - t0), 'mapping', r2.mappingCount, 'heapMB', mb());
const status = h.session.brain.loreIntelligence.status?.({ chatId }) ?? null;
if (status) { const e = status.entries ?? []; console.log('after edit: entries', e.length, 'stale/due', e.filter((x) => x.studyState && x.studyState !== 'COMPLETED' && x.studyState !== 'READY').length); }
h.session.destroy();
