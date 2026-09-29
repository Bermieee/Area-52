// Cap remediation, cap ledger row 60 (owner handoff "External Mapping / Event Retention": identity needed for stale
// detection and correction must stay durable). The Native Brain keeps at most maxTurns turn records; once a turn left that
// window, deleting its host message returned NO_LEARNED_NARRATIVE (its learned facts stayed current) and editing it
// threw. Owner direction: Nexus keeps a durable per-message identity for this; the Area-52 form is a small durable stub
// per evicted turn. Contract: a delete or edit of a turn older than the window retires or corrects what was learned from
// it, exactly as for a recent turn, and the stub survives a snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Area52NativeBrain } from '../src/native-brain.js';

const scene = (rev) => ({ sceneId: 'road', sceneRevision: rev, location: 'Road', narrativeTime: 'day ' + rev, activeCast: ['Tess'], activeThreads: [], objects: [], sceneRelationship: null, sourceRevisionRefs: [], provenance: ['test-scene:road:' + rev] });
async function turns(brain, n, chatId = 'chat:long') {
  for (let i = 0; i < n; i += 1) {
    await brain.prepareTurn({ chatId, turnId: 't' + i, generationId: 'g' + i, query: 'Continue.', scene: i === 0 ? scene(1) : undefined, executionLabel: 'DETERMINISTIC' });
    await brain.completeTurn({ turnId: 't' + i, response: `Tess reaches waypoint ${i}.`, knownBy: ['Tess'],
      observations: i === 0 ? [{ subjectId: 'Tess', predicate: 'sigil', value: 'Crimson', at: 1 }] : [] });
  }
}
const sigil = (brain) => brain.currentWorldModel().current.filter((row) => row.subjectId === 'Tess' && row.predicate === 'sigil');

for (const [label, extra] of [['inside the window', 0], ['one past the window', 1], ['well past the window', 24]]) {
  test(`deleting the first turn's message ${label} retires what was learned from it`, { timeout: 300000 }, async () => {
    const brain = new Area52NativeBrain({ maxTurns: 16 });
    await turns(brain, 16 + extra);
    assert.equal(brain.turns.has('t0'), extra === 0);
    assert.equal(sigil(brain).length, 1);
    const receipt = brain.retireTurnNarrative('t0');
    assert.equal(receipt.status, 'RETIRED', JSON.stringify(receipt));
    assert.equal(receipt.durableIdentity, extra > 0);
    assert.equal(sigil(brain).length, 0, 'the learned fact is no longer current');
    assert.equal(brain.retireTurnNarrative('t0').status, 'ALREADY_RETIRED');
  });
}

test('editing an evicted turn corrects it; the durable identity survives a snapshot', { timeout: 300000 }, async () => {
  const brain = new Area52NativeBrain({ maxTurns: 16 });
  await turns(brain, 20);
  const restored = Area52NativeBrain.fromSnapshot(JSON.parse(JSON.stringify(brain.snapshot())));
  assert.ok(restored.retainedTurnIdentity.has('t0'));
  const correction = restored.correctTurn({ turnId: 't0', response: 'Correction: Tess carries the Azure sigil.', knownBy: ['Tess'],
    observations: [{ subjectId: 'Tess', predicate: 'sigil', value: 'Azure', at: 1 }] });
  assert.ok(correction.invalidatedClaimIds.length >= 1);
  assert.deepEqual(sigil(restored).map((row) => row.value), ['Azure']);
  const stub = restored.retainedTurnIdentity.get('t0');
  assert.equal(stub.experience.sourceRevisionId, correction.sourceRevisionId, 'the stub follows the correction');
  assert.equal(stub.response, undefined, 'the stub keeps no response text');
});
