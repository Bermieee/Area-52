import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityClass} from '../src/lore-contracts.js';
import {
  QualityFailure,
  QualityStatus,
  RepresentationProfile,
  RequirementLevel,
  SemanticClass,
} from '../src/lore-representation-contracts.js';
import {
  DeterministicRepresentationProvider,
  LORE_REPRESENTATION_LIMITS,
  sliceSource,
  validateSlices,
} from '../src/lore-representation-compiler.js';
import {LoreStudyRuntime} from '../src/lore-study-runtime.js';
import {LoreMultiResolutionSystem} from '../src/lore-multi-resolution.js';

function study(runtime, {book = 'wave2', uid, content, metadata = {}}) {
  runtime.registerLorebook({id: book, title: book});
  const added = runtime.upsertEntry({lorebookId: book, uid, content, metadata});
  const result = runtime.run(added.obligation.id);
  assert.equal(result.obligation.state, 'COMPLETED');
  return 'lore:' + book + ':' + uid;
}

function richEmber() {
  const runtime = new LoreStudyRuntime();
  const sourceId = study(runtime, {
    book: 'ember2',
    uid: 1,
    content: [
      'Mara owns the Ember Tavern.',
      'Eris knows Mara.',
      'Eris carried the Sun Blade.',
      'Eris later left the Sun Blade at the Ember Tavern.',
      'The Ember Tavern later burned.',
      'The Sun Blade was destroyed in the Ember Tavern fire.',
      'A witness reports the Sun Blade was removed before the fire.',
      'Mara must never reveal the cellar key.',
      'Mara taps the bar twice when worried.',
      'Her voice is warm and smoky.',
      'Because the fire destroyed the tavern, Mara moved her meetings outside.',
      'Except during memorial rites, Mara avoids eye contact.',
      'Blue embroidery lines her coat.',
    ].join(' '),
    metadata: {title: 'Ember Tavern Chronicle', treePath: ['World', 'Ember Tavern']},
  });
  return {runtime, sourceId, system: new LoreMultiResolutionSystem({runtime})};
}

test('Wave 2 source slicing is deterministic, bounded, and covers every source character', () => {
  const source = Array.from({length: 100}, (_, i) => 'Sentence ' + i + ' contains bounded lore detail.').join(' ');
  const first = sliceSource(source);
  const second = sliceSource(source);
  assert.deepEqual(first, second);
  assert.ok(first.length > 1);
  assert.ok(first.every((slice) => slice.text.length <= LORE_REPRESENTATION_LIMITS.sliceCharacters));
  const receipt = validateSlices(source, first);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.everySliceAccountedFor, true);
  assert.equal(receipt.sourceCharacters, source.length);
});

test('Lean, Balanced, Heavy and Custom Cap coexist without replacing exact source', () => {
  const {runtime, sourceId, system} = richEmber();
  const exact = runtime.registry.currentRevision(sourceId).exactContent;
  const family = system.compileFamily({sourceId, customCapCharacters: 5000, customBaseProfile: RepresentationProfile.BALANCED});
  for (const profile of Object.values(RepresentationProfile)) {
    assert.equal(family[profile].status, QualityStatus.PASS, profile);
    assert.equal(family[profile].representation.authorityClass, AuthorityClass.DERIVED);
    assert.equal(family[profile].representation.sourceRevisionId, runtime.registry.currentRevision(sourceId).id);
  }
  assert.equal(runtime.registry.currentRevision(sourceId).exactContent, exact);
  assert.notEqual(family.LEAN.representation.id, family.BALANCED.representation.id);
  assert.notEqual(family.BALANCED.representation.id, family.HEAVY.representation.id);
  assert.notEqual(family.HEAVY.representation.id, family.CUSTOM_CAP.representation.id);
  assert.ok(family.LEAN.representation.size.characters < family.BALANCED.representation.size.characters);
  assert.ok(family.BALANCED.representation.size.characters < family.HEAVY.representation.size.characters);
  assert.ok(family.CUSTOM_CAP.representation.size.characters <= 5000);
});

test('profile policy retains semantics by class rather than by percentage', () => {
  const {sourceId, system} = richEmber();
  const lean = system.compile({sourceId, profile: RepresentationProfile.LEAN});
  const balanced = system.compile({sourceId, profile: RepresentationProfile.BALANCED});
  const heavy = system.compile({sourceId, profile: RepresentationProfile.HEAVY});
  assert.equal(lean.qualityReceipt.requiredRetained, lean.qualityReceipt.requiredContributions);
  assert.equal(lean.qualityReceipt.constraints.retained, lean.qualityReceipt.constraints.total);
  assert.equal(lean.qualityReceipt.behavioralAnchors.retained, lean.qualityReceipt.behavioralAnchors.total);
  assert.equal(balanced.qualityReceipt.sensoryAnchors.retained, balanced.qualityReceipt.sensoryAnchors.total);
  assert.ok(heavy.qualityReceipt.optionalRetained >= balanced.qualityReceipt.optionalRetained);
  assert.ok(heavy.representation.content.includes('Blue embroidery'));
});

test('Ember Tavern profiles retain ownership, chronology, destruction, and unresolved Blade fate', () => {
  const {sourceId, system} = richEmber();
  const family = system.compileFamily({sourceId, customCapCharacters: 5000});
  for (const result of Object.values(family)) {
    const text = result.representation.content;
    assert.match(text, /Mara/i);
    assert.match(text, /Eris/i);
    assert.match(text, /owner/i);
    assert.match(text, /Sun Blade/i);
    assert.match(text, /HISTORICAL/);
    assert.match(text, /destroyed/i);
    assert.match(text, /UNRESOLVED/);
    assert.match(text, /Removed Before Fire/i);
    assert.equal(result.qualityReceipt.conflicts.retained, result.qualityReceipt.conflicts.total);
  }
});

test('quality receipt exposes structured retention instead of one opaque score', () => {
  const {runtime, sourceId, system} = richEmber();
  const result = system.compile({sourceId, profile: RepresentationProfile.BALANCED});
  const receipt = result.qualityReceipt;
  assert.equal(receipt.status, QualityStatus.PASS);
  assert.equal(receipt.sourceRevisionId, runtime.registry.currentRevision(sourceId).id);
  assert.ok(receipt.sourceSize.characters > 0);
  assert.ok(receipt.representationSize.characters > 0);
  assert.ok(Number.isFinite(receipt.compressionRatio));
  for (const key of ['claims','relationships','temporalAnchors','conflicts','constraints','behavioralAnchors','sensoryAnchors']) {
    assert.ok(Number.isInteger(receipt[key].total), key);
    assert.ok(Number.isInteger(receipt[key].retained), key);
  }
  assert.equal(receipt.unsupportedStatementsDetected, 0);
  assert.equal(receipt.capCompliant, true);
  assert.deepEqual(receipt.validationFailures, []);
});

test('tiny custom cap fails CAP_IMPOSSIBLE and publishes nothing', () => {
  const {sourceId, system} = richEmber();
  const result = system.compile({
    sourceId,
    profile: RepresentationProfile.CUSTOM_CAP,
    capCharacters: 80,
    baseProfile: RepresentationProfile.LEAN,
  });
  assert.equal(result.status, QualityStatus.FAIL);
  assert.equal(result.failure, QualityFailure.CAP_IMPOSSIBLE);
  assert.equal(result.representation, null);
  assert.ok(result.qualityReceipt.minimumSafeEstimate > 80);
  assert.equal(system.representationHistory({sourceId, profile: RepresentationProfile.CUSTOM_CAP, capCharacters: 80}).length, 0);
});

test('strict provider validation rejects omitted mandatory semantics and free-floating assertions', () => {
  const runtime = new LoreStudyRuntime();
  const sourceId = study(runtime, {uid: 10, content: 'Mara owns the Ember Tavern. Mara must never reveal the cellar key.'});

  const omitProvider = {
    generate(request) {
      const selected = request.selectedContributions.slice(1);
      return {
        kind: 'LoreRepresentationDraft',
        sourceId: request.sourceId,
        sourceRevisionId: request.sourceRevisionId,
        profile: request.profile,
        contributionRefs: selected.map((row) => row.id),
        content: selected.map((row) => '[' + row.semanticClass + '] ' + row.text.trim()).join('\n'),
        providerMetadata: {persistentId: null},
        authorityClass: AuthorityClass.DERIVED,
      };
    },
  };
  const omitSystem = new LoreMultiResolutionSystem({runtime, provider: omitProvider});
  const omitted = omitSystem.compile({sourceId, profile: RepresentationProfile.LEAN});
  assert.equal(omitted.status, QualityStatus.FAIL);
  assert.ok(omitted.qualityReceipt.validationFailures.some((code) => [
    QualityFailure.MISSING_REQUIRED_CLAIM,
    QualityFailure.MISSING_RELATIONSHIP,
    QualityFailure.HARD_CONSTRAINT_DROPPED,
  ].includes(code)));

  const inventedProvider = {
    generate(request) {
      const selected = request.selectedContributions;
      return {
        kind: 'LoreRepresentationDraft',
        sourceId: request.sourceId,
        sourceRevisionId: request.sourceRevisionId,
        profile: request.profile,
        contributionRefs: selected.map((row) => row.id),
        content: selected.map((row) => '[' + row.semanticClass + '] ' + row.text.trim()).join('\n') + '\nMara is secretly an emperor.',
        providerMetadata: {persistentId: null},
        authorityClass: AuthorityClass.DERIVED,
      };
    },
  };
  const inventedSystem = new LoreMultiResolutionSystem({runtime, provider: inventedProvider});
  const invented = inventedSystem.compile({sourceId, profile: RepresentationProfile.LEAN});
  assert.equal(invented.status, QualityStatus.FAIL);
  assert.ok(invented.qualityReceipt.validationFailures.includes(QualityFailure.UNSUPPORTED_ASSERTION));
});

test('provider output cannot escalate representation authority or inject unknown refs', () => {
  const runtime = new LoreStudyRuntime();
  const sourceId = study(runtime, {uid: 11, content: 'Mara owns the Ember Tavern.'});
  const provider = {
    generate(request) {
      const selected = request.selectedContributions;
      const refs = selected.map((row) => row.id);
      return {
        kind: 'LoreRepresentationDraft',
        sourceId: request.sourceId,
        sourceRevisionId: request.sourceRevisionId,
        profile: request.profile,
        contributionRefs: [...refs, 'contribution:invented'],
        content: selected.map((row) => '[' + row.semanticClass + '] ' + row.text.trim()).join('\n'),
        providerMetadata: {persistentId: 'provider-persistent-id'},
        authorityClass: AuthorityClass.SOURCE_CANON,
      };
    },
  };
  const result = new LoreMultiResolutionSystem({runtime, provider}).compile({sourceId, profile: RepresentationProfile.LEAN});
  assert.equal(result.status, QualityStatus.FAIL);
  assert.ok(result.qualityReceipt.validationFailures.includes(QualityFailure.UNKNOWN_CONTRIBUTION_REF));
  assert.ok(result.qualityReceipt.validationFailures.includes(QualityFailure.UNSUPPORTED_AUTHORITY));
  assert.ok(result.qualityReceipt.validationFailures.includes(QualityFailure.UNEXPECTED_PERSISTENT_ID));
});

test('character-texture golden keeps constraints and defining behavior in Lean, richer texture in Balanced/Heavy', () => {
  const runtime = new LoreStudyRuntime();
  const sourceId = study(runtime, {
    uid: 12,
    content: [
      'Nyra owns the Moon Blade.',
      'Nyra must never draw the Moon Blade inside the Shrine.',
      'Around Mara, Nyra taps two fingers against her wrist when anxious.',
      'Her voice is low and smoky.',
      'After the siege, Nyra began standing closer to Mara.',
      'Except during rituals, Nyra avoids eye contact.',
      'Silver embroidery lines her coat.',
    ].join(' '),
  });
  const system = new LoreMultiResolutionSystem({runtime});
  const lean = system.compile({sourceId, profile: RepresentationProfile.LEAN});
  const balanced = system.compile({sourceId, profile: RepresentationProfile.BALANCED});
  const heavy = system.compile({sourceId, profile: RepresentationProfile.HEAVY});
  assert.match(lean.representation.content, /must never draw/i);
  assert.match(lean.representation.content, /taps two fingers/i);
  assert.doesNotMatch(lean.representation.content, /voice is low and smoky/i);
  assert.match(balanced.representation.content, /voice is low and smoky/i);
  assert.match(balanced.representation.content, /Except during rituals/i);
  assert.match(heavy.representation.content, /Silver embroidery/i);
});

test('large-source golden uses bounded slices and publishes valid profile family', () => {
  const runtime = new LoreStudyRuntime();
  const source = Array.from({length: 35}, (_, i) =>
    'Keeper' + i + ' owns the Hearth' + i + ' Tavern. Keeper' + i + ' knows Friend' + i + '.'
  ).join(' ');
  const sourceId = study(runtime, {uid: 13, content: source});
  const system = new LoreMultiResolutionSystem({runtime});
  const family = system.compileFamily({sourceId, customCapCharacters: 20000, customBaseProfile: RepresentationProfile.HEAVY});
  for (const result of Object.values(family)) {
    assert.equal(result.status, QualityStatus.PASS);
    assert.ok(result.slicesReceipt.sliceCount > 1);
    assert.equal(result.slicesReceipt.everySliceAccountedFor, true);
    assert.ok(result.slicesReceipt.maxSliceCharacters <= LORE_REPRESENTATION_LIMITS.sliceCharacters);
    assert.equal(result.qualityReceipt.requiredRetained, result.qualityReceipt.requiredContributions);
  }
  assert.equal(runtime.registry.currentRevision(sourceId).exactContent, source);
});

test('same revision, policy and compiler deterministically reuse one representation', () => {
  const {sourceId, system} = richEmber();
  const first = system.compile({sourceId, profile: RepresentationProfile.LEAN});
  const second = system.compile({sourceId, profile: RepresentationProfile.LEAN});
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.representation.id, first.representation.id);
  assert.equal(system.representationHistory({sourceId, profile: RepresentationProfile.LEAN}).length, 1);
});

test('wording-only source edit changes exact provenance but preserves semantic-retention fingerprint', () => {
  const runtime = new LoreStudyRuntime();
  const sourceId = study(runtime, {book: 'wording', uid: 1, content: 'Mara owns Ember Tavern.'});
  const system = new LoreMultiResolutionSystem({runtime});
  const signature = system.compiler.semanticRetentionSignature(sourceId);
  const old = system.compile({sourceId, profile: RepresentationProfile.LEAN}).representation;
  const update = runtime.upsertEntry({lorebookId: 'wording', uid: 1, content: 'Mara owns the Ember Tavern.'});
  runtime.run(update.obligation.id);
  const impact = system.compareSemanticRetention(signature, sourceId);
  assert.equal(impact.wordingOnlyEquivalent, true);
  assert.equal(impact.sourceRevisionChanged, true);
  assert.equal(impact.representationRegenerationRequired, true);
  const stale = system.refreshFreshness();
  assert.ok(stale.includes(old.id));
  const next = system.compile({sourceId, profile: RepresentationProfile.LEAN});
  assert.equal(next.reused, false);
  assert.notEqual(next.representation.id, old.id);
  assert.equal(next.representation.content, old.content);
  assert.notEqual(next.representation.sourceRevisionId, old.sourceRevisionId);
});

test('load-bearing ownership edit changes temporal semantics and stales only dependent source representations', () => {
  const runtime = new LoreStudyRuntime();
  const sourceA = study(runtime, {book: 'edit', uid: 1, content: 'Mara owns the Ember Tavern.'});
  const sourceB = study(runtime, {book: 'edit', uid: 2, content: 'Eris knows Mara.'});
  const system = new LoreMultiResolutionSystem({runtime});
  const beforeSignature = system.compiler.semanticRetentionSignature(sourceA);
  const aLean = system.compile({sourceId: sourceA, profile: RepresentationProfile.LEAN}).representation;
  const aHeavy = system.compile({sourceId: sourceA, profile: RepresentationProfile.HEAVY}).representation;
  const bLean = system.compile({sourceId: sourceB, profile: RepresentationProfile.LEAN}).representation;

  const edit = runtime.upsertEntry({lorebookId: 'edit', uid: 1, content: 'Mara formerly owned the Ember Tavern.'});
  const relearn = runtime.run(edit.obligation.id);
  assert.equal(relearn.semanticDiff.temporalMeaningChanged, true);
  const impact = system.compareSemanticRetention(beforeSignature, sourceA);
  assert.equal(impact.wordingOnlyEquivalent, false);
  assert.ok(impact.addedContributionSemanticIds.length > 0);
  assert.ok(impact.removedContributionSemanticIds.length > 0);

  const stale = system.refreshFreshness();
  assert.ok(stale.includes(aLean.id));
  assert.ok(stale.includes(aHeavy.id));
  assert.equal(system.registry.get(bLean.id).state, 'CURRENT');
  assert.equal(system.selection({sourceId: sourceA, desiredProfile: RepresentationProfile.LEAN}).requestedMatch, null);

  const rebuilt = system.compile({sourceId: sourceA, profile: RepresentationProfile.LEAN});
  assert.equal(rebuilt.status, QualityStatus.PASS);
  assert.match(rebuilt.representation.content, /HISTORICAL/);
  assert.equal(system.registry.get(bLean.id).state, 'CURRENT');
  const history = system.representationHistory({sourceId: sourceA, profile: RepresentationProfile.LEAN});
  assert.equal(history.length, 2);
  assert.equal(system.registry.staleReason(aLean.id).reason, 'SOURCE_REVISION_CHANGED');
});

test('policy revision invalidates old profile without changing source revision', () => {
  const runtime = new LoreStudyRuntime();
  const sourceId = study(runtime, {book: 'policy', uid: 1, content: 'Mara owns the Ember Tavern. Her voice is smoky.'});
  const system = new LoreMultiResolutionSystem({runtime});
  const old = system.compile({sourceId, profile: RepresentationProfile.LEAN}).representation;
  const sourceRevision = runtime.registry.currentRevision(sourceId).id;
  system.withPolicyOverride({
    profile: RepresentationProfile.LEAN,
    revision: 'lean-policy-v2',
    classes: {[SemanticClass.SENSORY_ANCHOR]: RequirementLevel.MANDATORY},
  });
  assert.equal(system.registry.get(old.id).state, 'STALE');
  assert.equal(system.registry.staleReason(old.id).reason, 'POLICY_REVISION_CHANGED');
  const rebuilt = system.compile({sourceId, profile: RepresentationProfile.LEAN});
  assert.equal(rebuilt.status, QualityStatus.PASS);
  assert.notEqual(rebuilt.representation.id, old.id);
  assert.equal(rebuilt.representation.sourceRevisionId, sourceRevision);
  assert.equal(rebuilt.representation.generation.policyRevision, 'lean-policy-v2');
  assert.match(rebuilt.representation.content, /voice is smoky/i);
});

test('representation history preserves old products and stale reason for forensics', () => {
  const runtime = new LoreStudyRuntime();
  const sourceId = study(runtime, {book: 'history', uid: 1, content: 'Mara owns the Ember Tavern.'});
  const system = new LoreMultiResolutionSystem({runtime});
  const old = system.compile({sourceId, profile: RepresentationProfile.LEAN}).representation;
  const edit = runtime.upsertEntry({lorebookId: 'history', uid: 1, content: 'Mara formerly owned the Ember Tavern.'});
  runtime.run(edit.obligation.id);
  system.refreshFreshness();
  const staleReason = system.registry.staleReason(old.id);
  assert.equal(staleReason.reason, 'SOURCE_REVISION_CHANGED');
  const fresh = system.compile({sourceId, profile: RepresentationProfile.LEAN}).representation;
  const history = system.representationHistory({sourceId, profile: RepresentationProfile.LEAN});
  assert.deepEqual(history.map((row) => row.id), [old.id, fresh.id]);
  assert.equal(history[0].state, 'HISTORICAL');
  assert.equal(history[0].replacedByRepresentationId, fresh.id);
  assert.equal(history[1].state, 'CURRENT');
});

test('Context Compiler seam advertises typed choices but owns no selection policy', () => {
  const {sourceId, system} = richEmber();
  system.compileFamily({sourceId, customCapCharacters: 5000});
  const surface = system.selection({
    sourceId,
    desiredProfile: RepresentationProfile.BALANCED,
    availableBudget: 10000,
    precisionNeed: 'HIGH',
  });
  assert.equal(surface.chooserAuthority, false);
  assert.equal(surface.requestedMatch.profile, RepresentationProfile.BALANCED);
  assert.ok(surface.available.length >= 4);
  assert.ok(surface.fallbackRepresentationRefs.some((ref) => ref.startsWith('source:')));
  assert.equal(surface.sourceDrillbackAvailable, true);
});

test('UI-ready read model exposes profile state without importing UI authority', () => {
  const {sourceId, system} = richEmber();
  system.compileFamily({sourceId, customCapCharacters: 5000});
  const model = system.readModel(sourceId);
  assert.equal(model.kind, 'LoreRepresentationReadModel');
  assert.equal(model.mutationAuthority, false);
  assert.equal(model.contextSelectionAuthority, false);
  assert.ok(model.availableProfiles.some((row) => row.profile === RepresentationProfile.LEAN));
  assert.ok(model.availableProfiles.some((row) => row.profile === RepresentationProfile.BALANCED));
  assert.ok(model.availableProfiles.some((row) => row.profile === RepresentationProfile.HEAVY));
  assert.ok(model.availableProfiles.every((row) => row.qualityState === QualityStatus.PASS));
  assert.ok(model.availableProfiles.every((row) => row.provenanceSummary.sourceRevisionId === model.sourceRevisionId));
});

test('removed source cannot keep an active representation', () => {
  const runtime = new LoreStudyRuntime();
  const sourceId = study(runtime, {book: 'remove-rep', uid: 1, content: 'Mara owns the Ember Tavern.'});
  const system = new LoreMultiResolutionSystem({runtime});
  const representation = system.compile({sourceId, profile: RepresentationProfile.LEAN}).representation;
  const removed = runtime.removeEntry({lorebookId: 'remove-rep', uid: 1});
  runtime.run(removed.obligation.id);
  const stale = system.refreshFreshness();
  assert.ok(stale.includes(representation.id));
  assert.equal(system.selection({sourceId, desiredProfile: RepresentationProfile.LEAN}).available.length, 0);
  assert.equal(system.readModel(sourceId).sourceState, 'REMOVED');
});

test('source drillback remains exact and representations never gain source authority', () => {
  const {runtime, sourceId, system} = richEmber();
  const exact = runtime.registry.currentRevision(sourceId);
  const result = system.compile({sourceId, profile: RepresentationProfile.HEAVY});
  assert.equal(exact.provenance.authored, true);
  assert.equal(result.representation.authorityClass, AuthorityClass.DERIVED);
  assert.notEqual(result.representation.content, exact.exactContent);
  assert.equal(result.representation.provenance.sourceRevisionId, exact.id);
  assert.ok(result.representation.dependencyArtifactIds.length > 0);
  assert.equal(result.qualityReceipt.qualityAuthority, false);
  assert.equal(result.qualityReceipt.settlementAuthority, false);
});
