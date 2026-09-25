import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QualityStatus,
  RepresentationProfile,
} from '../src/lore-representation-contracts.js';
import { LoreStudyRuntime } from '../src/lore-study-runtime.js';
import { LoreMultiResolutionSystem } from '../src/lore-multi-resolution.js';

function study(runtime, { book = 'worker4', uid, content }) {
  runtime.registerLorebook({ id: book, title: book });
  const added = runtime.upsertEntry({ lorebookId: book, uid, content });
  const result = runtime.run(added.obligation.id);
  assert.equal(result.obligation.state, 'COMPLETED');
  return 'lore:' + book + ':' + uid;
}

test('Lore #190 repro: CUSTOM_CAP base-profile changes cannot replay a representation compiled under a different semantic policy', () => {
  const runtime = new LoreStudyRuntime();
  const content = [
    'Nyra owns the Moon Blade.',
    'Nyra must never draw the Moon Blade inside the Shrine.',
    'Nyra taps two fingers against her wrist when anxious.',
    'Her voice is low and smoky.',
    'Except during rituals, Nyra avoids eye contact.',
    'Silver embroidery lines her coat.',
  ].join(' ');
  const sourceId = study(runtime, { uid: 1, content });
  const system = new LoreMultiResolutionSystem({ runtime });

  const lean = system.compile({
    sourceId,
    profile: RepresentationProfile.CUSTOM_CAP,
    capCharacters: 5000,
    baseProfile: RepresentationProfile.LEAN,
  });
  const heavy = system.compile({
    sourceId,
    profile: RepresentationProfile.CUSTOM_CAP,
    capCharacters: 5000,
    baseProfile: RepresentationProfile.HEAVY,
  });

  assert.equal(lean.status, QualityStatus.PASS);
  assert.equal(heavy.status, QualityStatus.PASS);
  assert.equal(lean.reused, false);
  assert.equal(heavy.reused, false);
  assert.notEqual(heavy.representation.id, lean.representation.id);
  assert.doesNotMatch(lean.representation.content, /Silver embroidery/i);
  assert.match(heavy.representation.content, /Silver embroidery/i);
  assert.equal(runtime.registry.currentRevision(sourceId).exactContent, content);
  assert.equal(lean.representation.provenance.sourceRevisionId, runtime.registry.currentRevision(sourceId).id);
  assert.equal(heavy.representation.provenance.sourceRevisionId, runtime.registry.currentRevision(sourceId).id);
  assert.equal(system.representationHistory({
    sourceId,
    profile: RepresentationProfile.CUSTOM_CAP,
    capCharacters: 5000,
  }).length, 2);
});

test('Lore #190 repro: source-local policy revision must not stale an unrelated source representation', () => {
  const runtime = new LoreStudyRuntime();
  const sourceA = study(runtime, { book: 'policy-scope', uid: 1, content: 'Mara owns Ember Tavern. Her voice is smoky.' });
  const sourceB = study(runtime, { book: 'policy-scope', uid: 2, content: 'Eris carries the Sun Blade. Her voice is clear.' });
  const system = new LoreMultiResolutionSystem({ runtime });

  const aV1 = system.compile({ sourceId: sourceA, profile: RepresentationProfile.LEAN }).representation;
  const bV1 = system.compile({ sourceId: sourceB, profile: RepresentationProfile.LEAN }).representation;
  const aV2 = system.compile({
    sourceId: sourceA,
    profile: RepresentationProfile.LEAN,
    policyRevision: 'source-a-policy-v2',
  }).representation;

  assert.equal(aV2.state, 'CURRENT');
  assert.notEqual(aV2.id, aV1.id);
  assert.equal(system.registry.get(aV1.id).state, 'HISTORICAL');
  assert.equal(system.registry.get(bV1.id).state, 'CURRENT');
  assert.equal(system.registry.staleReason(bV1.id), null);
  assert.equal(runtime.registry.currentRevision(sourceB).exactContent, 'Eris carries the Sun Blade. Her voice is clear.');
});
