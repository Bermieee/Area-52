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
