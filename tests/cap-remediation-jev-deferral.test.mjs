// Cap remediation, cap ledger row 58 (owner handoff "Jev Advisory"). Only two conflict sets are advised per turn; the
// others used to be dropped from that turn with no record and, because the owner's order is stable, the same sets won
// every turn, so later sets were never advised. Contract: the per-turn budget is unchanged (no extra calls); sets over it
// are DEFERRED and go first on later turns, so every eligible set is eventually advised; too-large sets are recorded as
// UNRESOLVED (the conflict stays visible to Truth).
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeJevAdvisory } from '../src/native-jev-advisory.js';

const set = (i, members = 2) => ({ id: 'set' + i, property: 'location', sourceRevisionRefs: ['src' + i],
  members: Array.from({ length: members }, (_, k) => ({ claimId: `c${i}-${k}`, value: 'v' + k, attribution: 'NARRATOR', sourceRevisionId: 'src' + i })),
  alternatives: ['a', 'b'] });
function advisory() {
  const jev = new NativeJevAdvisory();
  jev.attach({ service: { adjudicate: async () => ({}) }, isConfigured: () => true });
  return jev;
}
const record = (n) => ({ chatId: 'c', published: { candidates: [{ sourceRevisionRefs: Array.from({ length: n }, (_, i) => 'src' + i) }] } });

for (const n of [1, 2, 3, 4, 9]) {
  test(`${n} eligible conflict sets: at most two per turn, every set reaches Jev within ${Math.ceil(n / 2)} turns`, () => {
    // Worst case: no advice ever becomes fresh (e.g. Jev keeps answering NOT_ADVISED), so the same sets stay eligible.
    const jev = advisory(), sets = Array.from({ length: n }, (_, i) => set(i));
    const lore = { conflictSets: () => sets };
    const reached = new Set();
    for (let turn = 0; turn < Math.ceil(n / 2); turn += 1) {
      const chosen = jev.candidateSets({ loreInterface: lore, record: record(n) });
      assert.ok(chosen.length <= 2, 'per-turn budget unchanged');
      for (const s of chosen) reached.add(s.id);
    }
    assert.equal(reached.size, n, 'no set is starved');
  });
}

test('a set with too many members is recorded as unresolved, not silently dropped', () => {
  const jev = advisory();
  jev.candidateSets({ loreInterface: { conflictSets: () => [set(0, 12)] }, record: record(1) });
  assert.ok(jev.diagnostics().skipped.some((row) => row.conflictSetId === 'set0' && row.reason === 'UNRESOLVED_TOO_MANY_MEMBERS'));
});

test('deferrals survive a snapshot', () => {
  const jev = advisory(), sets = Array.from({ length: 5 }, (_, i) => set(i));
  jev.candidateSets({ loreInterface: { conflictSets: () => sets }, record: record(5) });
  const restored = new NativeJevAdvisory({ snapshot: JSON.parse(JSON.stringify(jev.snapshot())) });
  assert.equal(restored.deferred.size, 3);
});
