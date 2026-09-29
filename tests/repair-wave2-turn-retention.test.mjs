// Wave 2 (audit H3): retained native turn records must stay bounded over long sessions while the
// newest turns keep full detail, older turns stay readable by reference, and background learning
// is never starved by compaction. FAKE-HOST evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInstalled } from './helpers/installed-host.mjs';

const filler = (i, n) => ('Turn ' + i + ': The lantern light flickers across the worn tavern tables while rain drums outside. ').repeat(Math.ceil(n / 95)).slice(0, n);
const sz = (v) => JSON.stringify(v ?? null).length;

test('retained turn records stay bounded; newest full, older compacted, readers and snapshot remain usable', async () => {
  const h = makeInstalled({ chatId: 'chat:retain' });
  const totals = {};
  for (let i = 1; i <= 60; i++) {
    h.user(filler(i, 300)); await h.generate('normal', filler(i, 600));
    await new Promise((r) => setTimeout(r, 0));
    if ([20, 40, 60].includes(i)) totals[i] = [...h.nativeBrain.turns.values()].reduce((a, r) => a + sz(r), 0);
  }
  const rows = h.nativeBrain.turnOrder.map((id) => h.nativeBrain.turns.get(id));
  const full = rows.filter((r) => r.retention?.state !== 'COMPACTED'), compacted = rows.filter((r) => r.retention?.state === 'COMPACTED');
  assert.ok(full.length <= 4 + 2, `only the newest turns keep full detail (full=${full.length})`);
  assert.ok(compacted.length >= 50, 'older terminal turns are compacted');
  const marginal = (totals[60] - totals[40]) / 20;
  const compactedBytes = compacted.map(sz), maxCompacted = Math.max(...compactedBytes);
  console.log('RETENTION', JSON.stringify({ totals, marginal: Math.round(marginal), maxCompacted, avgCompacted: Math.round(compactedBytes.reduce((a, b) => a + b, 0) / compactedBytes.length), full: full.length, fullBytes: full.map(sz) }));
  assert.ok(maxCompacted < 160_000, `compacted records bounded (max ${maxCompacted} bytes)`);
  assert.ok(marginal < 250_000, `steady-state retention cost per turn bounded (${Math.round(marginal)} bytes/turn)`);
  for (const r of compacted) {
    assert.ok(r.published.sealReceipt?.sealedState, 'seal receipt retained');
    assert.ok(r.published.packet, 'sealed packet retained (hash re-verifiable)');
    assert.ok(Array.isArray(r.published.candidates) && r.published.candidates.every((c) => c.candidateId), 'candidates retained as references');
    assert.ok(r.feedback, 'learning feedback computed before compaction');
  }
  const old = compacted[0];
  const sel = { chatId: old.chatId, turnId: old.turnId, generationId: old.generationId, correlationId: old.correlationId };
  const readers = Object.entries(h.nativeBrain.uiBindings()).filter(([k, v]) => typeof v === 'function' && /^read/.test(k));
  for (const [name, fn] of readers) assert.doesNotThrow(() => fn(sel), name + ' on a compacted turn');
  const snapBytes = sz(h.nativeBrain.snapshot());
  assert.ok(snapBytes < 25_000_000, `snapshot bounded (${snapBytes} bytes)`);
  console.log(JSON.stringify({ totals, full: full.length, compacted: compacted.length, snapBytes, marginal: Math.round((totals[60] - totals[40]) / 20), maxCompacted: Math.max(...compacted.map(sz)), oldRecordBytes: sz(old), newestRecordBytes: sz(rows.at(-1)) }));
  h.session.destroy();
});
