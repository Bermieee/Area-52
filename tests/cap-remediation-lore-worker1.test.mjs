import test from 'node:test';
import assert from 'node:assert/strict';

import {ArtifactType} from '../src/lore-contracts.js';
import {LoreStudyRuntime} from '../src/lore-study-runtime.js';
import {LoreMultiResolutionSystem} from '../src/lore-multi-resolution.js';
import {LoreRepresentationRegistry} from '../src/lore-representation-registry.js';
import {RepresentationProfile, QualityStatus} from '../src/lore-representation-contracts.js';
import {LORE_REPRESENTATION_LIMITS, segmentSourceSlices, validateSlices} from '../src/lore-representation-compiler.js';
import {deriveLoreNavigationHierarchy} from '../src/lore-navigation-hierarchy.js';
import {LORE_WAVE3_LIMITS} from '../src/lore-navigation-contracts.js';
import {LoreNavigationSummaryRegistry} from '../src/lore-navigation-summary-registry.js';
import {LoreHierarchyRetrievalSystem} from '../src/lore-hierarchy-retrieval-system.js';
import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';

function study(content, {uid = 1, title = 'Entry'} = {}) {
  const runtime = new LoreStudyRuntime();
  runtime.registerLorebook({id: 'book', title: 'Book'});
  const added = runtime.upsertEntry({lorebookId: 'book', uid, content, metadata: {title}});
  let row;
  do row = runtime.run(added.obligation.id, {maxUnits: 64}); while (row.checkpointed && !row.failed);
  assert.equal(row.obligation.state, 'COMPLETED');
  return {runtime, sourceId: added.obligation.sourceId};
}

const sentence = (i) => i % 7 === 0
  ? `A witness reports Keeper${i} owns the Tavern${i}.`
  : i % 3 === 0
    ? `Keeper${i} later owned the Tavern${i}.`
    : `Keeper${i} owns the Tavern${i}.`;
const content = (n) => Array.from({length: n}, (_, i) => sentence(i)).join(' ');

test('rows 10/14/15: source slices and representation/provider work are physically segmented', () => {
  const seed = 'x'.repeat(180000);
  const seedPlan = segmentSourceSlices(seed);
  assert.ok(seedPlan.segments.length > 1);
  const overlapStart = seedPlan.segments[1].start;
  const overlapEnd = seedPlan.segments[0].end;
  assert.ok(overlapEnd > overlapStart, 'adjacent source-slice segments retain overlap');

  const stamp = (text, offset, label) => text.slice(0, offset) + label + text.slice(offset + label.length);
  const sentinels = {
    start: 'START_SENTINEL_FACT',
    middle: 'MIDDLE_SENTINEL_FACT',
    boundary: 'BOUNDARY_SENTINEL_FACT',
    end: 'END_SENTINEL_FACT',
  };
  let raw = seed;
  raw = stamp(raw, 0, sentinels.start);
  raw = stamp(raw, Math.floor(raw.length / 2), sentinels.middle);
  raw = stamp(raw, overlapStart + Math.floor((overlapEnd - overlapStart) / 2), sentinels.boundary);
  raw = stamp(raw, raw.length - sentinels.end.length, sentinels.end);

  const sliced = segmentSourceSlices(raw);
  const coverage = validateSlices(raw, sliced.slices);
  assert.equal(coverage.ok, true);
  assert.ok(sliced.slices.length > LORE_REPRESENTATION_LIMITS.maxSlices);
  assert.ok(sliced.segments.length > 1);
  assert.ok(sliced.segments.every((segment) => segment.sliceCount <= LORE_REPRESENTATION_LIMITS.maxSlices));
  assert.equal(sliced.segments.at(-1).complete, true);

  const sliceById = new Map(sliced.slices.map((row) => [row.id, row]));
  const segmentText = (segment) => segment.sliceRefs.map((id) => sliceById.get(id)?.text || '').join('');
  const allSliceText = sliced.slices.map((row) => row.text).join('');
  assert.match(allSliceText, new RegExp(sentinels.start));
  assert.match(allSliceText, new RegExp(sentinels.middle));
  assert.match(allSliceText, new RegExp(sentinels.end));
  assert.match(segmentText(sliced.segments[0]), new RegExp(sentinels.boundary));
  assert.match(segmentText(sliced.segments[1]), new RegExp(sentinels.boundary));

  const {runtime, sourceId} = study(content(900));
  const registry = new LoreRepresentationRegistry();
  const multi = new LoreMultiResolutionSystem({runtime, registry});
  const result = multi.compile({sourceId, profile: RepresentationProfile.HEAVY});
  assert.equal(result.status, QualityStatus.PASS);
  assert.equal(result.qualityReceipt.requiredRetained, result.qualityReceipt.requiredContributions);
  assert.ok(result.representation.segmented);
  assert.ok(result.representation.segments.every((segment) => segment.content.length <= LORE_REPRESENTATION_LIMITS.maxRepresentationCharacters));
  assert.ok(result.representation.segments.every((segment) => segment.providerRequestCharacters <= LORE_REPRESENTATION_LIMITS.maxProviderRequestCharacters));
});

test('rows 10/14/15: representation compile checkpoints restore and superseding edits cannot publish mixed revisions', () => {
  const first = study(content(900));
  const registry = new LoreRepresentationRegistry();
  const multi = new LoreMultiResolutionSystem({runtime: first.runtime, registry});
  let session = multi.beginCompile({sourceId: first.sourceId, profile: RepresentationProfile.HEAVY});
  assert.ok(session.segments.length > 1);
  session = multi.runCompile(session.id, {maxSegments: 1});
  assert.equal(session.state, 'CHECKPOINTED');

  const snap = multi.snapshot();
  const restoredRegistry = new LoreRepresentationRegistry(snap.representationRegistry);
  const restored = new LoreMultiResolutionSystem({
    runtime: first.runtime,
    registry: restoredRegistry,
    compilerRevision: snap.compilerRevision,
    policyOverrides: snap.policyOverrides,
    compilerSnapshot: snap.compiler,
  });
  session = restored.runCompile(session.id, {maxSegments: 999});
  assert.equal(session.state, 'COMPLETED');
  assert.equal(session.result.status, QualityStatus.PASS);

  const second = study(content(900));
  const registry2 = new LoreRepresentationRegistry();
  const multi2 = new LoreMultiResolutionSystem({runtime: second.runtime, registry: registry2});
  let interrupted = multi2.beginCompile({sourceId: second.sourceId, profile: RepresentationProfile.HEAVY});
  interrupted = multi2.runCompile(interrupted.id, {maxSegments: 1});
  assert.equal(interrupted.state, 'CHECKPOINTED');
  second.runtime.upsertEntry({lorebookId: 'book', uid: 1, content: 'The source changed while compilation was checkpointed.'});
  interrupted = multi2.runCompile(interrupted.id, {maxSegments: 999});
  assert.equal(interrupted.state, 'SUPERSEDED');
  assert.equal(interrupted.result.representation, null);
});

test('row 7: aliases beyond 16/7 are retained in bounded continuation artifacts', () => {
  const aliases = Array.from({length: 24}, (_, i) => `Ari is also called Alias${i}.`).join(' ');
  const {runtime, sourceId} = study(aliases);
  const artifacts = runtime.store.currentArtifacts(runtime.registry).filter((row) => row.sourceId === sourceId);
  const entity = artifacts.find((row) => row.artifactType === ArtifactType.ENTITY && row.payload?.canonicalName === 'Ari');
  assert.ok(entity);
  assert.ok(entity.payload.aliases.length <= 16);
  assert.equal(entity.payload.aliasCoverage.complete, true);
  const pages = artifacts.filter((row) => row.artifactType === ArtifactType.ALIAS && row.payload?.continuation);
  assert.ok(pages.length > 0);
  assert.ok(pages.every((page) => page.payload.aliases.length <= 7));
  assert.ok(pages.flatMap((page) => page.payload.aliases).includes('Alias23'));
});

function hierarchyRuntime(count, communityCount = 0) {
  const entries = Array.from({length: count}, (_, i) => ({sourceId: 's' + i, lorebookId: 'b', uid: i}));
  const revisions = new Map(entries.map((source, i) => [source.sourceId, {
    id: 'r' + i, sourceId: source.sourceId, state: 'CURRENT', exactContent: 'unique token ' + i,
    metadata: {title: 'Source ' + i, treePath: ['Path ' + i]},
  }]));
  const learned = new Map(entries.map((source, i) => [source.sourceId, {id: 'l' + i, sourceId: source.sourceId, sourceRevisionId: 'r' + i, state: 'CURRENT'}]));
  const concepts = [];
  for (let i = 0; i < communityCount; i += 1) {
    for (const sourceId of ['s' + ((i * 2) % count), 's' + ((i * 2 + 1) % count)]) {
      concepts.push({artifactType: ArtifactType.CONCEPT, sourceId, payload: {concept: 'concept-' + i}});
    }
  }
  return {
    registry: {
      listEntries: () => entries,
      currentRevision: (sourceId) => revisions.get(sourceId) || null,
      getEntry: (sourceId) => entries.find((row) => row.sourceId === sourceId) || null,
    },
    store: {
      currentLearnedRevision: (sourceId) => learned.get(sourceId) || null,
      currentArtifacts: () => concepts,
    },
  };
}

test('rows 23/24: communities and >12k hierarchy scopes page instead of truncating or throwing', () => {
  const runtime = hierarchyRuntime(6100, 257);
  const hierarchy = deriveLoreNavigationHierarchy(runtime);
  assert.ok(hierarchy.scopes.length > LORE_WAVE3_LIMITS.maxScopeCount);
  assert.ok(hierarchy.scopePages.length > 1);
  assert.ok(hierarchy.scopePages.every((page) => page.scopeIds.length <= LORE_WAVE3_LIMITS.maxScopeCount));
  assert.ok(hierarchy.coverage.communityCount >= 257);
  assert.ok(hierarchy.communityPages.length > 1);
  assert.ok(hierarchy.includedSourceIds.includes('s6099'));
  assert.equal(hierarchy.coverage.complete, true);
});

test('row 19: queryForStory and operator receipt propagate ranked bounded-out coverage truth', () => {
  const service = new LoreIntelligenceService();
  const chatId = 'chat:worker1-bounded';
  const lorebookId = 'worker1-bounded-lore';
  service.acceptLorebook({
    id: lorebookId,
    title: 'Worker 1 bounded retrieval',
    chatId,
    discovery: {
      kind: 'SillyTavernCurrentLorebook',
      source: 'WORLD_INFO',
      stableId: 'worker1-bounded-retrieval-fixture',
      chatId,
    },
    entries: Array.from({length: 40}, (_, index) => ({
      uid: 'beacon-' + index,
      content: 'Shared beacon marker is recorded at station ' + index + '.',
      metadata: {title: 'Beacon ' + index, treePath: ['Stations', String(index)]},
    })),
    fullSnapshot: true,
  });
  const run = service.runStudy();
  assert.equal(run.results.every((row) => row.obligation?.state === 'COMPLETED'), true);

  const packet = service.queryForStory({
    chatId,
    query: 'shared beacon marker',
    intent: 'NARROW',
    includeNavigation: false,
  });
  assert.equal(packet.status, 'ELIGIBLE');
  assert.ok(packet.retrievalCoverage.boundedOut > 0, 'more matches exist than the nomination budget');
  assert.equal(packet.retrievalCoverage.coverageComplete, false);
  assert.equal(packet.retrievalCoverage.rankedResult, true);
  assert.equal(packet.retrievalCoverage.fullCorpusCoverageClaim, false);
  assert.equal(packet.retrievalCoverage.returned, packet.nominations.length);
  assert.ok(packet.retrievalCoverage.returned <= LORE_WAVE3_LIMITS.maxNominationsPerIntent);

  const operator = service.operatorReadModel({chatId});
  assert.ok(operator.lastProducerQuery);
  assert.deepEqual(operator.lastProducerQuery.retrievalCoverage, packet.retrievalCoverage);
});

test('row 25: evidence refs page beyond 4096 and long summary text segments below 12k', () => {
  const registry = new LoreNavigationSummaryRegistry();
  const refs = registry.registerEvidence(Array.from({length: 5000}, (_, i) => ({
    evidenceId: 'e' + i,
    sourceRevisionId: 'r' + i,
    text: 'evidence ' + i,
  })));
  const resolved = registry.resolveEvidenceRefsPaged(refs);
  assert.equal(resolved.status, 'COMPLETE');
  assert.ok(resolved.pageCount > 1);
  assert.ok(resolved.pages.every((page) => page.returnedRefs <= LORE_WAVE3_LIMITS.maxEvidenceRefsPerSummary));

  const rules = Array.from({length: 420}, (_, i) => `Guardian must never open sealed gate ${i} unless the bell rings.`).join(' ');
  const {runtime, sourceId} = study(rules, {title: 'Rules'});
  const system = new LoreHierarchyRetrievalSystem({runtime});
  const hierarchy = system.refreshHierarchy();
  system.buildAll({maxUnits: 64});
  const leafId = new Map(hierarchy.leafBySource).get(sourceId);
  const summary = system.currentSummary(leafId);
  assert.ok(summary);
  assert.equal(summary.retentionReceipt?.status || summary.qualityReceipt?.status, 'PASS');
  assert.ok(summary.segmented, 'long critical summary is segmented');
  assert.ok(summary.segments.length > 1);
  assert.ok(summary.segments.every((segment) => segment.content.length <= LORE_WAVE3_LIMITS.maxSummaryCharacters));
  assert.equal(summary.segmentManifest.aggregateCoverageComplete, true);
});
