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
