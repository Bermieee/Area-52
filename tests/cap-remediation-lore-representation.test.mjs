// Cap remediation, cap ledger rows 11-13 (owner handoff "Lore Representation"). The grounded contribution set used to be
// sorted alphabetically by semantic class and cut at 512, which dropped REQUIRED_IDENTITY, TEMPORAL_ANCHOR and
// UNRESOLVED_CONFLICT first while the quality receipt still said PASS; texture contributions stopped at sentence 512 and
// at 48 per slice. Contract now: the contribution set is complete; a representation that cannot hold what its profile
// requires fails visibly instead of passing without it. (Oversized work is now segmented under the same source revision with aggregate coverage receipts.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { SemanticClass, QualityStatus, RepresentationProfile } from '../src/lore-representation-contracts.js';
import { buildGroundedContributions } from '../src/lore-representation-compiler.js';
import { LoreStudyRuntime } from '../src/lore-study-runtime.js';
import { LoreMultiResolutionSystem } from '../src/lore-multi-resolution.js';

function studied(content) {
  const runtime = new LoreStudyRuntime();
  runtime.registerLorebook({ id: 'book', title: 'book' });
  const added = runtime.upsertEntry({ lorebookId: 'book', uid: 1, content });
  let result, guard = 0;
  do { result = runtime.run(added.obligation.id, { maxUnits: 50 }); } while (result.checkpointed && guard++ < 1000);
  assert.equal(result.obligation.state, 'COMPLETED');
  return { runtime, sourceId: added.obligation.sourceId };
}
// Plain sentences yield two entities, a claim and a relationship; "later" ones are temporal; "a witness reports" ones unresolved.
const plain = (i) => i % 7 !== 0 && i % 3 !== 0;
const sentence = (i) => i % 7 === 0 ? `A witness reports Keeper${i} owns the Tavern${i}.` : i % 3 === 0 ? `Keeper${i} later owned the Tavern${i}.` : `Keeper${i} owns the Tavern${i}.`;
const content = (n) => Array.from({ length: n }, (_, i) => sentence(i)).join(' ');
const classes = (set) => set.contributions.reduce((m, row) => m.set(row.semanticClass, (m.get(row.semanticClass) || 0) + 1), new Map());

for (const n of [60, 200, 700]) {
  test(`${n} sentences: the grounded contribution set is complete (no alphabetical cut)`, () => {
    const { runtime, sourceId } = studied(content(n));
    const set = buildGroundedContributions({ runtime, sourceId });
    assert.equal(set.coverage.truncated, false);
    const byClass = classes(set);
    // One REQUIRED_IDENTITY contribution per entity: two per sentence.
    const entities = runtime.store.currentArtifacts(runtime.registry).filter((row) => row.sourceId === sourceId && row.artifactType === 'ENTITY').length;
    assert.equal(byClass.get(SemanticClass.REQUIRED_IDENTITY), entities, 'every entity keeps its identity contribution');
    assert.ok(entities > n, 'entities from across the whole source (' + entities + ')');
    const identityRefs = new Set(set.contributions.filter((row) => row.semanticClass === SemanticClass.REQUIRED_IDENTITY).flatMap((row) => row.entityRefs));
    let last = n - 1; while (!plain(last)) last -= 1;
    assert.ok(identityRefs.has('entity:keeper' + last) && identityRefs.has('entity:tavern' + last), 'the last plain sentence keeps its identity contributions');
    assert.ok((byClass.get(SemanticClass.UNRESOLVED_CONFLICT) || 0) > 0 && (byClass.get(SemanticClass.TEMPORAL_ANCHOR) || 0) > 0);
    if (n >= 700) assert.ok(set.contributions.length > 512, 'past the old 512 ceiling (' + set.contributions.length + ')');
  });
}

test('oversized representations segment without dropping mandatory contributions; small ones are unchanged', () => {
  const small = studied(content(40));
  const smallFamily = new LoreMultiResolutionSystem({ runtime: small.runtime }).compileFamily({ sourceId: small.sourceId });
  for (const profile of [RepresentationProfile.LEAN, RepresentationProfile.BALANCED, RepresentationProfile.HEAVY]) {
    assert.equal(smallFamily[profile].status, QualityStatus.PASS, profile);
    assert.equal(Boolean(smallFamily[profile].representation.segmented), false, profile + ' stays on the legacy single-artifact path');
  }

  const large = studied(content(900));
  const family = new LoreMultiResolutionSystem({ runtime: large.runtime }).compileFamily({ sourceId: large.sourceId });
  for (const profile of [RepresentationProfile.LEAN, RepresentationProfile.BALANCED, RepresentationProfile.HEAVY]) {
    const row = family[profile];
    assert.equal(row.status, QualityStatus.PASS, profile);
    assert.equal(row.qualityReceipt.requiredRetained, row.qualityReceipt.requiredContributions, profile);
    if (row.representation.segmented) {
      assert.ok(row.representation.segments.length > 1, profile);
      assert.ok(row.representation.segments.every((segment) => segment.content.length <= 24000), profile + ' physical segment bound');
      assert.ok(row.representation.segments.every((segment) => segment.providerRequestCharacters <= 96000), profile + ' provider segment bound');
    }
  }
  assert.ok(Object.values(family).some((row) => row.representation.segmented), 'the 900-sentence source uses segmented representation storage');
});
