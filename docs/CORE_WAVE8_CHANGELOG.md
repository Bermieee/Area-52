# Core Wave 8 Changelog

## Wave 7 -> Wave 8

Wave 7 added maintained Hot Cognition. Wave 8 adds the retrieval backbone that feeds cognition.

## Files added

Production:

- `src/candidate-bus-contracts.js`
- `src/candidate-bus.js`
- `src/retrieval-channel-registry.js`
- `src/retrieval-index-contracts.js`
- `src/retrieval-representation-provider.js`
- `src/retrieval-index-adapters.js`
- `src/retrieval-index-lifecycle.js`
- `src/sensory-net-channels.js`
- `src/sensory-net-backbone.js`

Validation:

- `tests/candidate-bus-wave8-harness.js`
- `tests/candidate-bus-wave8.mjs`
- `tests/candidate-bus-wave8-stress-harness.js`
- `tests/candidate-bus-wave8-stress.mjs`
- `scripts/candidate-bus-wave8-acceptance-report.mjs`
- `scripts/candidate-bus-wave8-stress-report.mjs`

Documentation:

- `docs/HYBRID_SENSORY_NET_BACKBONE.md`
- `docs/CANDIDATE_BUS_CONTRACT.md`
- `docs/RETRIEVAL_INDEX_LIFECYCLE.md`
- `docs/CORE_WAVE8_ACCEPTANCE.md`
- `docs/CORE_WAVE8_CHANGELOG.md`

## Files modified

- `src/cognitive-core.js` — SensoryNetBackbone becomes Core retrieval surface; source edits notify index lifecycle.
- `src/generation-publication.js` — revision-fenced retrieval and CandidateBusEnvelope publication.
- `src/result-bus.js` — canonical candidate revision/provenance compatibility.
- `src/precision-contract.js` — canonical candidate source-revision compatibility.
- `src/truth-publication-gate.js` — revision-aware corrective retrieval.
- `src/core-assembly-manifest.js` — browser-visible Wave 8 production modules.
- `.github/workflows/cognitive-core-ci.yml` — Wave 8 acceptance and stress evidence.

## Behavioral changes

- Multi-channel nominations now use one typed candidate boundary.
- Evidence identity is independent of retrieval backend when stable claim/event identity exists.
- Cross-channel replay dedupes without multiplying evidence.
- Raw channel ranking semantics remain preserved.
- Candidate growth is explicitly bounded with receipts.
- Stale revision references remain visible.
- Active Continuity uses Wave 7 Hot Cognition as a cheap current-context channel.
- Sparse and dense indexes share one lifecycle contract.
- Partial/torn updates and interrupted rebuilds are detectable and non-fresh.
- Indexes rebuild from owner artifacts and can migrate without changing candidate identity.
- Candidate Bus retains compact receipts, not historic candidate bodies.

## Compatibility retained

Legacy Core Truth/Precision still receive `claimIds`, `scoreSignals`, retrieval-channel aliases and normalized provenance fields.

The compatibility layer does not change canonical Candidate Bus semantics.

## Not implemented

- production embedding model;
- Qdrant/Milvus selection or integration;
- Scene Query Planner;
- adaptive retrieval policy;
- Graph Walker;
- Historian implementation;
- Memory/Character Memory;
- Lore Study provider;
- RAPTOR/GraphRAG;
- UI.
