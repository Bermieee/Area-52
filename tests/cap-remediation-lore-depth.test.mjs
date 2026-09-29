// Cap remediation, cap ledger row 21. A Lore entry whose authored Tree path was deeper than the navigation depth (12) was
// excluded from the hierarchy and so from Lore retrieval. Contract: deeper levels fold into one virtual group at the last
// level; the entry is navigable and retrievable; the authored Tree is unchanged; entries within the depth are unaffected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LoreStudyRuntime as Runtime } from '../src/lore-study-runtime.js';
import { LORE_WAVE3_LIMITS } from '../src/lore-navigation-contracts.js';
import { LoreHierarchyRetrievalSystem } from '../src/lore-hierarchy-retrieval-system.js';

function add(runtime, uid, treePath, content) {
  runtime.registerLorebook({ id: 'deep', title: 'deep' });
  const r = runtime.upsertEntry({ lorebookId: 'deep', uid, content, metadata: { title: 'Entry ' + uid, treePath } });
  let out; do { out = runtime.run(r.obligation.id, { maxUnits: 64 }); } while (out.checkpointed && !out.failed);
  return 'lore:deep:' + uid;
}
const path = (n) => Array.from({ length: n }, (_, i) => 'Level' + i);

for (const depth of [LORE_WAVE3_LIMITS.maxHierarchyDepth - 1, LORE_WAVE3_LIMITS.maxHierarchyDepth, LORE_WAVE3_LIMITS.maxHierarchyDepth + 1, 2 * LORE_WAVE3_LIMITS.maxHierarchyDepth]) {
  test(`an entry at Tree depth ${depth} is retrievable`, () => {
    const runtime = new Runtime();
    const id = add(runtime, 1, path(depth), 'The moonstone vault lies beneath the old chapel.');
    const system = new LoreHierarchyRetrievalSystem({ runtime });
    system.refreshHierarchy();
    system.buildAll({ maxUnits: 64 });
    const result = system.query({ query: 'moonstone vault' });
    assert.ok(result.nominations.some((row) => JSON.stringify(row).includes(id)), 'retrievable at depth ' + depth);
    assert.deepEqual(runtime.registry.currentRevision(id).metadata.treePath, path(depth), 'authored Tree unchanged');
    const folded = (system.hierarchy.diagnostics ?? []).some?.((row) => row.status === 'DEPTH_FOLDED');
    if (depth <= LORE_WAVE3_LIMITS.maxHierarchyDepth) assert.ok(!folded);
  });
}
