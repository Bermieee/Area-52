# Hybrid Sensory Net Backbone

## Purpose

Wave 8 gives Area-52 a production retrieval nervous system between retrieval producers and the existing Adaptive Retrieval / Truth / Precision path.

```text
Retrieval intents
  -> registered retrieval channels
  -> Candidate Bus
  -> deterministic normalize / dedupe / bound
  -> CandidateBusEnvelope
  -> Adaptive Retrieval / Truth / Precision
```

The Sensory Net deliberately over-retrieves. Retrieval is not settlement.

Permanent rules:

- fusion score != truth;
- channel count != authority;
- dense similarity != identity;
- graph distance != current truth;
- recency != canonical status;
- retrieval frequency != settlement;
- index != source of truth.

## Production ownership

Core owns:

- canonical candidate contract;
- retrieval channel registry;
- Candidate Bus fusion and receipts;
- Active Continuity channel from maintained Hot Cognition;
- backend-neutral indexed-representation contracts;
- index lifecycle manager;
- deterministic sparse/dense proof adapters;
- stable CandidateBusEnvelope downstream seam.

Core does not own:

- Scene Query Planner (#35);
- Adaptive Retrieval policy (#49);
- Graph Walker (#203);
- Historian (#205);
- Character Memory / Memory persistence;
- Lore Study providers;
- RAPTOR / GraphRAG;
- Qdrant/Milvus production selection (#41);
- Truth Gate / Precision ownership.

## Runtime components

- `candidate-bus-contracts.js` — canonical typed contracts.
- `retrieval-channel-registry.js` — extensible provider registration and health.
- `candidate-bus.js` — deterministic fusion/dedupe/bounding.
- `sensory-net-channels.js` — Core compatibility channels, Active Continuity, index-channel provider.
- `sensory-net-backbone.js` — scatter/orchestration and downstream envelope.
- `retrieval-index-contracts.js` — indexed artifact and lifecycle contracts.
- `retrieval-representation-provider.js` — replaceable deterministic representation proof.
- `retrieval-index-adapters.js` — browser-safe sparse/dense in-memory proof adapters.
- `retrieval-index-lifecycle.js` — revision-aware lifecycle, verification, rebuild and migration.

## Channel extensibility

A channel registers a `RetrievalChannelDescriptor` plus `retrieve(intent, context)`.

The contract supports SPARSE, DENSE, LATE_INTERACTION, GRAPH, RAPTOR, GRAPHRAG_COMMUNITY, HISTORIAN, REFLECTION, CHARACTER_MEMORY, WORLD_STATE, ACTIVE_CONTINUITY and SPECIALIZED_STORE without modifying Candidate Bus internals.

Unknown incompatible contract majors fail safely. Optional channel failure is isolated; healthy nominations remain usable and the envelope records unavailable/degraded channels.

## Hot Cognition direction

Wave 7 maintained Hot Cognition remains the owner of working state.

```text
Hot Cognition
  -> Active Continuity nominations
  -> Candidate Bus
```

Candidate Bus never reconstructs or replaces Hot Cognition.

The continuity-only path is legal when no long-term retrieval channel is required.

## Downstream compatibility

The canonical envelope exposes revision sets, world/scene revision, candidate list, intent IDs, channel degradation and fusion receipt.

Canonical candidates retain legacy `claimIds`, `scoreSignals`, `retrievalIntents` and provenance aliases only for existing Core Truth/Precision compatibility. Those aliases do not redefine the new canonical contract.

## Operational surfaces

`SensoryNetChannelManifest` exposes registered channel ID/version/capabilities/health/availability/intent support/max candidates/index revision and counters.

`SensoryNetDiagnostics` exposes compact fusion receipts and index lifecycle diagnostics. It intentionally does not retain historic candidate payload sets.
