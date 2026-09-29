// Follow-up (audit D3): the Brain snapshot split for incremental storage is an exact, torn-safe inverse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Area52NativeBrain } from '../src/native-brain.js';
import { packBrainSnapshot, unpackBrainSnapshot } from '../src/deployment/brain-snapshot-parts.js';
import { makeInstalled } from './helpers/installed-host.mjs';

test('pack then unpack reproduces the Brain snapshot exactly and a restored brain accepts it', async () => {
  const h = makeInstalled({ chatId: 'chat:parts' });
  for (let i = 1; i <= 10; i += 1) { h.user('At North Gallery, Mara waits near marker ' + i + '.'); await h.generate('normal', 'She waits ' + i + '.'); }
  const snapshot = h.nativeBrain.snapshot();
  const parts = packBrainSnapshot(snapshot);
  assert.ok(Object.keys(parts).length > 3, 'growing arrays are chunked');
  const round = unpackBrainSnapshot(JSON.parse(JSON.stringify(parts)));
  assert.deepEqual(round, JSON.parse(JSON.stringify(snapshot)));
  const restored = Area52NativeBrain.fromSnapshot(round);
  assert.equal(restored.turns.size, h.nativeBrain.turns.size);
  h.session.destroy();
});

test('a missing chunk yields null (no torn Brain)', async () => {
  const h = makeInstalled({ chatId: 'chat:parts2' });
  for (let i = 1; i <= 10; i += 1) { h.user('Turn ' + i + '.'); await h.generate('normal', 'Reply ' + i + '.'); }
  const parts = packBrainSnapshot(h.nativeBrain.snapshot());
  const first = Object.keys(parts).find((k) => k.startsWith('brain.turns:'));
  delete parts[first];
  assert.equal(unpackBrainSnapshot(parts), null);
  assert.equal(unpackBrainSnapshot({}), null);
  h.session.destroy();
});

test('storage dedupe is lossless: exact round trip, unchanged packet, smaller parts, independent copies (O8)', async () => {
  const h = makeInstalled({ chatId: 'chat:parts3' });
  for (let i = 1; i <= 6; i += 1) { h.user('At North Gallery, Mara waits near marker ' + i + '.'); await h.generate('normal', 'She waits ' + i + '.'); }
  const snapshot = JSON.parse(JSON.stringify(h.nativeBrain.snapshot()));
  const parts = JSON.parse(JSON.stringify(packBrainSnapshot(snapshot)));
  const stored = Object.entries(parts).filter(([k]) => k.startsWith('brain.turns:')).reduce((n, [, v]) => n + JSON.stringify(v).length, 0);
  const original = snapshot.turns.reduce((n, t) => n + JSON.stringify(t).length, 0);
  assert.ok(stored < original * 0.75, `stored ${stored} of ${original} bytes`);
  assert.ok(Object.values(parts).some((p) => p?.kind === 'Area52DedupedTurnRows' && Object.keys(p.blobs).length > 0), 'shared blobs used');
  const round = unpackBrainSnapshot(JSON.parse(JSON.stringify(parts)));
  assert.deepEqual(round, snapshot);
  const pub = (x) => JSON.stringify(x.turns.map(([, r]) => r.published ?? null));
  assert.equal(pub(round), pub(snapshot), 'published packets are byte-identical');
  const key = Object.keys(parts).filter((k) => k.startsWith('brain.turns:')).find((k) => parts[k]?.kind === 'Area52DedupedTurnRows' && Object.keys(parts[k].blobs).length);
  delete parts[key].blobs[Object.keys(parts[key].blobs)[0]];
  assert.equal(unpackBrainSnapshot(parts), null);
  h.session.destroy();
});

// O8 round trip for the version-2 shape encodings (tables and the per-part string table), on synthetic turns built to
// exercise every path: homogeneous arrays (tables, nested tables, tables of shared-subtree references), repeated long
// strings (including table key names and blob hashes), heterogeneous arrays, empty containers, unicode and every JSON
// scalar. Seeded, so a failure is reproducible.
const snapshotOf = (turns) => ({ kind: 'Area52NativeBrainSnapshot', turns, runtimeLedger: { records: [] }, core: { contextSeal: { sealed: [] } } });
const viaStorage = (value) => JSON.parse(JSON.stringify(value));
function syntheticTurns(seed, count) {
  let state = seed >>> 0;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const shared = ['The lantern gutters as Mara crosses the North Gallery floor.', 'candidate:scene:north-gallery:entry', 'ëvidence — “quoted” ✓ 🜂 line', 'a'.repeat(24), 'x'.repeat(23)];
  const scalar = () => pick([null, true, false, 0, -1, 3.25, 1e21, '', 'short', ...shared, 'unique ' + rand()]);
  const node = (depth) => {
    const r = rand();
    if (depth <= 0 || r < 0.3) return scalar();
    if (r < 0.55) { // homogeneous rows: a table (a long, repeated key name exercises string-encoded table keys)
      const keys = pick([['id', 'score', 'text'], ['candidateIdentifierWithAVeryLongName', 'weight'], ['only']]);
      return Array.from({ length: 2 + Math.floor(rand() * 5) }, () => Object.fromEntries(keys.map((k) => [k, node(depth - 1)])));
    }
    if (r < 0.7) return Array.from({ length: Math.floor(rand() * 4) }, () => node(depth - 1)); // mixed or empty array
    if (r < 0.8) return [{ a: 1 }, { b: 2 }, { a: 1, b: 2 }]; // same length, different keys: not a table
    if (r < 0.85) return [{ a: 1, b: 2 }, { b: 2, a: 1 }, { a: 3, b: 4 }]; // same keys, different order: not a table
    const out = {}; const n = Math.floor(rand() * 4);
    for (let i = 0; i < n; i += 1) out[pick(['k' + i, 'label', '', 'constructor', 'nested', '10', '2'])] = node(depth - 1);
    return out;
  };
  const big = { candidates: Array.from({ length: 12 }, (_, i) => ({ id: 'cand-' + i, text: shared[0], score: i / 12 })) }; // a shared subtree
  return Array.from({ length: count }, (_, i) => ['turn:' + i, { index: i, body: node(5), again: node(5), shared: big, copy: [big, big, big], note: shared[i % 3] }]);
}

test('O8 encodings round-trip exactly on seeded synthetic turns and actually engage tables and the string table', () => {
  let tables = 0, strings = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const snapshot = viaStorage(snapshotOf(syntheticTurns(seed, 3)));
    const parts = viaStorage(packBrainSnapshot(snapshot));
    for (const [key, part] of Object.entries(parts)) {
      if (!key.startsWith('brain.turns:')) continue;
      assert.equal(part.kind, 'Area52DedupedTurnRows', `seed ${seed} ${key} encoded`);
      assert.equal(part.version, 2);
      const text = JSON.stringify(part);
      if (text.includes('"$area52Table"')) tables += 1;
      if (part.strings.length) strings += 1;
    }
    assert.deepEqual(unpackBrainSnapshot(parts), snapshot, `seed ${seed}`);
    assert.equal(JSON.stringify(unpackBrainSnapshot(parts).turns), JSON.stringify(snapshot.turns), `seed ${seed}: key order preserved`);
  }
  assert.ok(tables > 0 && strings > 0, `tables used in ${tables} parts, string table in ${strings}`);
});

test('O8 encoding is deterministic, so an unchanged turn part keeps its checksum', () => {
  const snapshot = viaStorage(snapshotOf(syntheticTurns(7, 4)));
  assert.equal(JSON.stringify(packBrainSnapshot(snapshot)), JSON.stringify(packBrainSnapshot(viaStorage(snapshot))));
});

test('O8 reserved-marker fallback: records that already use a marker are stored verbatim and round-trip exactly', () => {
  const long = 'a sentence long enough to go into the string table';
  const cases = {
    refKey: { x: { $area52Ref: 'not-a-hash' }, t: [long, long] },
    tableKey: { x: { $area52Table: { keys: ['a'], rows: [[1]] } } },
    markerValue: { x: '\u0001' + '0', t: [long, long] },
    markerAsValueText: { x: '$area52Table' },
    protoKey: JSON.parse('{"rows":[{"__proto__":1,"t":"' + long + '"},{"__proto__":2,"t":"' + long + '"},{"__proto__":3,"t":"y"}]}'),
  };
  for (const [name, record] of Object.entries(cases)) {
    const snapshot = viaStorage(snapshotOf([['turn:0', record]]));
    const parts = viaStorage(packBrainSnapshot(snapshot));
    assert.ok(Array.isArray(parts['brain.turns:00000']), `${name}: stored verbatim`);
    assert.deepEqual(unpackBrainSnapshot(parts), snapshot, name);
  }
  // A marker character that does not start the string is ordinary text and is still encoded.
  const inner = viaStorage(snapshotOf([['turn:0', { rows: [{ t: 'mid\u0001dle ' + long }, { t: 'mid\u0001dle ' + long }, { t: 'z' }] }]]));
  const innerParts = viaStorage(packBrainSnapshot(inner));
  assert.equal(innerParts['brain.turns:00000'].kind, 'Area52DedupedTurnRows');
  assert.deepEqual(unpackBrainSnapshot(innerParts), inner);
});

test('O8 torn version-2 parts restore nothing (missing string entry, missing table, short table row)', () => {
  const snapshot = viaStorage(snapshotOf(syntheticTurns(3, 2)));
  const fresh = () => viaStorage(packBrainSnapshot(snapshot));
  const withStrings = (parts) => Object.keys(parts).find((k) => k.startsWith('brain.turns:') && parts[k].strings.length);
  let parts = fresh(); let key = withStrings(parts);
  parts[key].strings.pop();
  assert.equal(unpackBrainSnapshot(parts), null, 'string table entry missing');
  parts = fresh(); key = withStrings(parts);
  delete parts[key].strings;
  assert.equal(unpackBrainSnapshot(parts), null, 'string table missing');
  parts = fresh();
  const tablePart = Object.keys(parts).find((k) => k.startsWith('brain.turns:') && JSON.stringify(parts[k]).includes('"$area52Table"'));
  const shorten = (node) => {
    if (Array.isArray(node)) return node.some(shorten);
    if (node && typeof node === 'object') {
      if (node.$area52Table) { node.$area52Table.rows[0].pop(); return true; }
      return Object.values(node).some(shorten);
    }
    return false;
  };
  assert.ok(shorten(parts[tablePart]));
  assert.equal(unpackBrainSnapshot(parts), null, 'short table row');
});

test('O8 version-1 parts written before the shape encodings still restore', () => {
  const record = { a: { $area52Ref: 'h1' }, b: [{ $area52Ref: 'h1' }], note: '\u0001 kept as text in v1' };
  const parts = {
    brain: { kind: 'Area52NativeBrainSnapshotCore', layout: { version: 1, turns: 1, ledger: 0, seal: 0 }, core: { runtimeLedger: {}, core: { contextSeal: {} } } },
    'brain.turns:00000': { kind: 'Area52DedupedTurnRows', rows: [['turn:0', record]], blobs: { h1: { x: [1, 2, 3] } } },
  };
  const round = unpackBrainSnapshot(viaStorage(parts));
  assert.deepEqual(round.turns, [['turn:0', { a: { x: [1, 2, 3] }, b: [{ x: [1, 2, 3] }], note: '\u0001 kept as text in v1' }]]);
  round.turns[0][1].a.x.push(4);
  assert.deepEqual(round.turns[0][1].b[0].x, [1, 2, 3], 'independent copies');
});
