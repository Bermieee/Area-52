import { createCandidateBusEnvelope } from './candidate-bus.js';

export function createLoreCandidateFixtures() {
  return createCandidateBusEnvelope({
    candidateSetId: 'lore:fixture', query: 'What is the current state of Ember Tavern?', intentFingerprint: 'intent:lore:ember',
    sourceRevisionSet: ['lore:ember:r6'], worldRevision: 8, sceneRevision: 4,
    candidates: [
      candidate('lore:exact', 'lore:ember:r6', 'EXACT_SOURCE', 'CURRENT: Ember Tavern is destroyed', 'SOURCE_CANON', 'CURRENT', { artifactId: 'lore:ember', revision: 6 }),
      candidate('lore:raptor', 'lore:ember:r6', 'RAPTOR', 'DERIVED: Ember Tavern destruction summary', 'DERIVED', 'CURRENT', { artifactId: 'raptor:ember', revision: 3 }),
      candidate('lore:navigation', 'lore:ember:r6', 'NAVIGATION_SUMMARY', 'DERIVED: Ember Tavern state navigation summary', 'DERIVED', 'CURRENT', { artifactId: 'nav:ember', revision: 2 }),
      candidate('lore:lean', 'lore:ember:r6', 'LEAN_REPRESENTATION', 'DERIVED: Ember Tavern destroyed', 'DERIVED', 'CURRENT', { artifactId: 'lean:ember', revision: 5 }),
      candidate('lore:contextual', 'lore:ember:r6', 'CONTEXTUAL_CHUNK', 'Ember Tavern was intact before the fire', 'DERIVED', 'HISTORICAL', { artifactId: 'chunk:ember', revision: 6 }),
      candidate('lore:tree', 'lore:ember:r6', 'TREE', 'Tree nomination for Ember Tavern current-state branch', 'DERIVED', 'UNRESOLVED', { artifactId: 'tree:ember', revision: 9 }),
      candidate('lore:ontology', 'lore:ember:r6', 'ONTOLOGY', 'Ontology nomination: structure state', 'DERIVED', 'UNRESOLVED', { artifactId: 'ontology:ember', revision: 1 }),
    ],
  });
}

export function createMemoryCandidateFixtures() {
  return createCandidateBusEnvelope({
    candidateSetId: 'memory:fixture', query: 'Where is the Sun Blade now?', intentFingerprint: 'intent:memory:blade',
    sourceRevisionSet: ['memory:blade:r4'], worldRevision: 8, sceneRevision: 4,
    candidates: [
      candidate('memory:episode', 'memory:blade:r4', 'SCENE_EPISODE', 'HISTORICAL: Sun Blade was at Ember Tavern', 'OBSERVED', 'HISTORICAL', { artifactId: 'episode:blade', revision: 4 }),
      candidate('memory:episodic', 'memory:blade:r4', 'EPISODIC_MEMORY', 'HISTORICAL: Blade seen at Tavern before fire', 'OBSERVED', 'HISTORICAL', { artifactId: 'memory:blade', revision: 4 }),
      candidate('memory:reflection', 'memory:blade:r4', 'REFLECTION', 'INFERRED: Blade may have been removed before fire', 'INFERRED', 'UNRESOLVED', { artifactId: 'reflection:blade', revision: 2 }),
      candidate('memory:causal', 'memory:blade:r4', 'CAUSAL_HYPOTHESIS', 'INFERRED: removal may explain missing remains', 'INFERRED', 'UNCERTAIN', { artifactId: 'cause:blade', revision: 1 }),
      candidate('memory:historical', 'memory:blade:r4', 'TEMPORAL_STATE', 'HISTORICAL: Blade at Tavern', 'SETTLED', 'HISTORICAL', { artifactId: 'state:blade:past', revision: 7 }),
      candidate('memory:current', 'memory:blade:r4', 'TEMPORAL_STATE', 'CURRENT: Blade location unknown', 'SETTLED', 'CURRENT', { artifactId: 'state:blade:current', revision: 8 }),
      candidate('memory:unresolved-a', 'memory:blade:r4', 'EPISODIC_MEMORY', 'Blade destroyed in fire', 'UNRESOLVED', 'UNRESOLVED', { artifactId: 'fate:a', revision: 1 }),
      candidate('memory:unresolved-b', 'memory:blade:r4', 'REFLECTION', 'Blade removed before fire', 'INFERRED', 'UNRESOLVED', { artifactId: 'fate:b', revision: 1 }),
    ],
  });
}

export function createEmberTavernPrecisionFixture() {
  const sourceRevisionSet = ['world:ember:r8'];
  const candidates = [
    candidate('tavern:intact', sourceRevisionSet[0], 'BM25', 'HISTORICAL: Ember Tavern was intact before the fire', 'OBSERVED', 'HISTORICAL', { artifactId: 'ember:tavern:history', revision: 8 }, 'tavern:history'),
    candidate('tavern:destroyed', sourceRevisionSet[0], 'DENSE', 'CURRENT: Ember Tavern is destroyed', 'SETTLED', 'CURRENT', { artifactId: 'ember:tavern:current', revision: 8 }, 'tavern:current'),
    candidate('blade:tavern-history', sourceRevisionSet[0], 'TREE', 'HISTORICAL: Sun Blade was at Ember Tavern', 'OBSERVED', 'HISTORICAL', { artifactId: 'ember:blade:history', revision: 8 }, 'blade:history'),
    candidate('blade:destroyed', sourceRevisionSet[0], 'RAPTOR', 'UNRESOLVED: Sun Blade was destroyed in the fire', 'UNRESOLVED', 'UNRESOLVED', { artifactId: 'ember:blade:fate:a', revision: 8 }, 'blade:fate:a'),
    candidate('blade:removed', sourceRevisionSet[0], 'GRAPH', 'UNRESOLVED: Sun Blade was removed before the fire', 'UNRESOLVED', 'UNRESOLVED', { artifactId: 'ember:blade:fate:b', revision: 8 }, 'blade:fate:b'),
    candidate('noise:ale', sourceRevisionSet[0], 'BM25', 'Tavern served dark ale', 'DERIVED', 'UNKNOWN', { artifactId: 'noise:ale', revision: 8 }),
    candidate('noise:roof', sourceRevisionSet[0], 'DENSE', 'Old roof beams creaked', 'DERIVED', 'HISTORICAL', { artifactId: 'noise:roof', revision: 8 }),
    candidate('noise:mara', sourceRevisionSet[0], 'ONTOLOGY', 'Mara belongs to another thread', 'DERIVED', 'UNKNOWN', { artifactId: 'noise:mara', revision: 8 }),
  ];
  return Object.freeze({
    candidateSet: createCandidateBusEnvelope({ candidateSetId: 'ember:golden', query: 'What is the current state of Ember Tavern and the Sun Blade?', intentFingerprint: 'intent:ember:golden', sourceRevisionSet, worldRevision: 8, sceneRevision: 4, candidates }),
    currentRevisionSet: Object.freeze({ sourceRevisionSet, worldRevision: 8, sceneRevision: 4, characterStateRevision: 0 }),
    conflictSets: Object.freeze([{ id: 'blade-fate', refs: ['blade:destroyed', 'blade:removed'], credible: true }]),
    expected: Object.freeze({ tavernCurrent: 'tavern:destroyed', bladeHistorical: 'blade:tavern-history', bladeCurrent: 'UNKNOWN', fate: 'UNRESOLVED' }),
  });
}

export function createMultiChannelDedupeFixture() {
  const base = { sourceRevisionRefs: ['src:claim:r5'], worldRevision: 5, sceneRevision: 2, authorityClass: 'OBSERVED', truthStatus: 'CURRENT', representationText: 'CURRENT: Mara holds the Blade', evidenceIdentity: 'claim:blade-holder:r5', artifactRef: { artifactId: 'claim:blade-holder', revision: 5 } };
  return createCandidateBusEnvelope({ candidateSetId: 'dedupe:fixture', sourceRevisionSet: ['src:claim:r5'], worldRevision: 5, sceneRevision: 2, candidates: [
    { candidateId: 'bm25:1', channel: 'BM25', rankSignals: { bm25: .8 }, ...base },
    { candidateId: 'dense:1', channel: 'DENSE', rankSignals: { dense: .9 }, ...base },
    { candidateId: 'raptor:1', channel: 'RAPTOR', rankSignals: { raptor: .7 }, ...base },
  ] });
}

function candidate(candidateId, sourceRevision, channel, representationText, authorityClass, truthStatus, artifactRef, evidenceIdentity = null) {
  return {
    candidateId, evidenceIdentity: evidenceIdentity ?? candidateId, artifactRef, sourceRevisionRefs: [sourceRevision], channel,
    rankSignals: { source: .7 }, entityRefs: [], relationshipRefs: [], temporalHints: truthStatus === 'CURRENT' ? ['CURRENT'] : truthStatus === 'HISTORICAL' ? ['HISTORICAL'] : [],
    authorityClass, truthStatus, provenance: [{ sourceRevision }], representationText,
  };
}
