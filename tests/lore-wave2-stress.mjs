import assert from 'node:assert/strict';
import {AuthorityClass} from '../src/lore-contracts.js';
import {
  QualityStatus,
  RepresentationProfile,
  RequirementLevel,
  SemanticClass,
} from '../src/lore-representation-contracts.js';
import {LoreStudyRuntime} from '../src/lore-study-runtime.js';
import {LoreMultiResolutionSystem} from '../src/lore-multi-resolution.js';

const runtime = new LoreStudyRuntime();
runtime.registerLorebook({id: 'repr-stress', title: 'Representation Stress'});
const SOURCE_COUNT = 24;
const EDIT_ROUNDS = 6;
let compileRequests = 0;
let reusedRequests = 0;
let wordingOnlyEdits = 0;
let semanticEdits = 0;
let customCapPasses = 0;
let slicedCompiles = 0;
let conflictSources = 0;
let unrelatedIdentityChanges = 0;

for (let i = 0; i < SOURCE_COUNT; i += 1) {
  const conflict = i % 6 === 0;
  const longTexture = i % 8 === 0
    ? ' ' + Array.from({length: 38}, (_, n) => 'Keeper' + i + ' taps the counter when Visitor' + n + ' arrives.').join(' ')
    : '';
  const content = [
    'Keeper' + i + ' owns the Hearth' + i + ' Tavern.',
    'Friend' + i + ' knows Keeper' + i + '.',
    'Keeper' + i + ' must never reveal Key' + i + '.',
    'Keeper' + i + ' taps twice when worried.',
    'Her voice is smoky.',
    'Silver embroidery lines her coat.',
    conflict ? 'The Relic' + i + ' was destroyed in the Hearth' + i + ' Tavern fire.' : '',
    conflict ? 'A witness reports the Relic' + i + ' was removed before the fire.' : '',
  ].filter(Boolean).join(' ') + longTexture;
  const added = runtime.upsertEntry({lorebookId: 'repr-stress', uid: i, content, metadata: {title: 'Stress ' + i}});
  runtime.run(added.obligation.id);
  if (conflict) conflictSources += 1;
}

const system = new LoreMultiResolutionSystem({runtime});
for (let i = 0; i < SOURCE_COUNT; i += 1) {
  const sourceId = 'lore:repr-stress:' + i;
  const family = system.compileFamily({sourceId, customCapCharacters: 12000, customBaseProfile: RepresentationProfile.BALANCED});
  compileRequests += Object.keys(family).length;
  customCapPasses += family.CUSTOM_CAP.status === QualityStatus.PASS ? 1 : 0;
  slicedCompiles += family.LEAN.slicesReceipt.sliceCount > 1 ? 1 : 0;
  for (const result of Object.values(family)) {
    assert.equal(result.status, QualityStatus.PASS);
    assert.equal(result.qualityReceipt.requiredRetained, result.qualityReceipt.requiredContributions);
  }
  const again = system.compile({sourceId, profile: RepresentationProfile.LEAN});
  compileRequests += 1;
  reusedRequests += again.reused ? 1 : 0;
}

for (let round = 0; round < EDIT_ROUNDS; round += 1) {
  for (let i = 0; i < SOURCE_COUNT; i += 1) {
    const sourceId = 'lore:repr-stress:' + i;
    const neighborId = 'lore:repr-stress:' + ((i + 1) % SOURCE_COUNT);
    const neighborBefore = system.registry.activeForSource(neighborId, runtime.registry).map((row) => row.id).sort();
    const current = runtime.registry.currentRevision(sourceId);
    const base = 'Keeper' + i + ' owns the Hearth' + i + ' Tavern. Friend' + i + ' knows Keeper' + i + '. Keeper' + i + ' must never reveal Key' + i + '. Keeper' + i + ' taps twice when worried. Her voice is smoky. Silver embroidery lines her coat.';
    const wordingOnly = round % 3 === 0;
    const content = wordingOnly
      ? base.replace('owns the Hearth', 'owns Hearth')
      : base.replace('owns the Hearth', 'formerly owned the Hearth') + ' Visitor' + round + ' knows Keeper' + i + '.';
    const signature = system.compiler.semanticRetentionSignature(sourceId);
    const update = runtime.upsertEntry({lorebookId: 'repr-stress', uid: i, content, metadata: {title: 'Stress ' + i}});
    runtime.run(update.obligation.id);
    const semanticImpact = system.compareSemanticRetention(signature, sourceId);
    if (wordingOnly && semanticImpact.wordingOnlyEquivalent) wordingOnlyEdits += 1;
    if (!wordingOnly && !semanticImpact.wordingOnlyEquivalent) semanticEdits += 1;
    system.refreshFreshness();
    const family = system.compileFamily({sourceId, customCapCharacters: 12000, customBaseProfile: RepresentationProfile.BALANCED});
    compileRequests += Object.keys(family).length;
    for (const result of Object.values(family)) {
      assert.equal(result.status, QualityStatus.PASS);
      assert.equal(result.qualityReceipt.requiredRetained, result.qualityReceipt.requiredContributions);
    }
    const neighborAfter = system.registry.activeForSource(neighborId, runtime.registry).map((row) => row.id).sort();
    if (JSON.stringify(neighborBefore) !== JSON.stringify(neighborAfter)) unrelatedIdentityChanges += 1;
  }
}

const prePolicyLean = [];
for (let i = 0; i < SOURCE_COUNT; i += 1) {
  const sourceId = 'lore:repr-stress:' + i;
  const current = system.registry.activeForSource(sourceId, runtime.registry).find((row) => row.profile === RepresentationProfile.LEAN);
  if (current) prePolicyLean.push(current.id);
}
system.withPolicyOverride({
  profile: RepresentationProfile.LEAN,
  revision: 'stress-lean-v2',
  classes: {[SemanticClass.SENSORY_ANCHOR]: RequirementLevel.MANDATORY},
});
let policyRebuilds = 0;
for (let i = 0; i < SOURCE_COUNT; i += 1) {
  const sourceId = 'lore:repr-stress:' + i;
  const result = system.compile({sourceId, profile: RepresentationProfile.LEAN});
  compileRequests += 1;
  assert.equal(result.status, QualityStatus.PASS);
  assert.equal(result.representation.generation.policyRevision, 'stress-lean-v2');
  policyRebuilds += 1;
}

system.refreshFreshness();
const snapshot = system.registry.snapshot();
const currentRows = snapshot.representations.filter((row) => row.state === 'CURRENT');
const currentIds = currentRows.map((row) => row.id);
const staleCurrent = currentRows.filter((row) => runtime.registry.currentRevision(row.sourceId).id !== row.sourceRevisionId);
const authorityPromotions = snapshot.representations.filter((row) => row.authorityClass !== AuthorityClass.DERIVED);
const failedCurrentQuality = currentRows.filter((row) => row.retentionReceipt.status !== QualityStatus.PASS || row.retentionReceipt.requiredRetained !== row.retentionReceipt.requiredContributions);
const duplicateActiveIds = currentIds.length - new Set(currentIds).size;
const sourceLoss = runtime.registry.listEntries({includeRemoved: true}).filter((entry) =>
  runtime.registry.revisionHistory(entry.sourceId).some((revision) => revision.state !== 'REMOVED' && typeof revision.exactContent !== 'string')
).length;

assert.equal(sourceLoss, 0);
assert.equal(authorityPromotions.length, 0);
assert.equal(failedCurrentQuality.length, 0);
assert.equal(staleCurrent.length, 0);
assert.equal(duplicateActiveIds, 0);
assert.equal(unrelatedIdentityChanges, 0);
assert.equal(reusedRequests, SOURCE_COUNT);
assert.ok(wordingOnlyEdits > 0);
assert.ok(semanticEdits > 0);
assert.equal(policyRebuilds, SOURCE_COUNT);
assert.equal(customCapPasses, SOURCE_COUNT);
assert.ok(slicedCompiles > 0);

console.log('LORE_WAVE2_STRESS ' + JSON.stringify({
  pass: true,
  sources: SOURCE_COUNT,
  sourceRevisions: runtime.registry.listEntries({includeRemoved: true}).reduce((sum, entry) => sum + runtime.registry.revisionHistory(entry.sourceId).length, 0),
  editRounds: EDIT_ROUNDS,
  targetedEdits: SOURCE_COUNT * EDIT_ROUNDS,
  compileRequests,
  deterministicReuses: reusedRequests,
  wordingOnlyEquivalentEdits: wordingOnlyEdits,
  semanticEditsDetected: semanticEdits,
  policyRebuilds,
  customCapPasses,
  slicedSources: slicedCompiles,
  conflictSources,
  representationArtifactsTotal: snapshot.representations.length,
  currentRepresentations: currentRows.length,
  sourceLoss,
  authorityPromotions: authorityPromotions.length,
  missingMandatorySemanticsInPassOutputs: failedCurrentQuality.length,
  staleCurrentRepresentations: staleCurrent.length,
  duplicateActiveRepresentationIds: duplicateActiveIds,
  unrelatedSourceRepresentationIdentityChanges: unrelatedIdentityChanges,
}));
