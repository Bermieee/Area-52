# Area-52 Memory Wave 1 — Temporal Producer

**Branch:** `Development-Memory`  
**Primary:** #5 Temporal State Graph  
**Memory-owned supporting work:** #78 Green Room durable side, #9 Reflection/consolidation, #205 Historian producer.

## Outcome

Memory Wave 1 implements a runnable browser-safe Memory producer on top of the preserved Cognitive Memory blueprint.

Production path:

```text
exact raw/source evidence
 -> append-only evidence journal
 -> validated Core owner Settlement
 -> Temporal State claim + transition journals
 -> reconstructible CURRENT / HISTORICAL / UNRESOLVED projection

SceneExperienceProposal -> revisioned Episode
GreenRoomBatch v1.1.0 -> expiring INFERRED shadow -> optional durable INFERRED Reflection

Episodes + historical claims + unresolved hypotheses + Reflections
 -> Memory Historian index
 -> bounded CandidateNomination v1.0.0 and HistorianMemoryResolution v1.0.0
 -> exact raw-evidence drillback
```

Memory does not own Candidate Bus admission, Truth, Settlement, Context Seal, live Runtime scheduling, or UI.

## Production modules

- `src/memory-contracts.js`
- `src/temporal-state-graph.js`
- `src/memory-green-room.js`
- `src/memory-experience-store.js`
- `src/memory-historian.js`
- `src/memory-temporal-producer.js`
- `src/memory-integration-surface.js`

The original `docs/AREA52_COGNITIVE_MEMORY_BLUEPRINT.md` remains unchanged.

## Versioned public API

`MemoryTemporalProducer` exposes evidence admission, Scene experience admission, validated Settlement ingestion, current and as-of projection, entity traversal, unresolved sets, Green Room state, Reflection revisioning, bounded consolidation sessions, Historian retrieval/resolution, drillback, invalidation, snapshot and reload.

`createMemoryIntegrationSurface()` exposes cross-lane adapters without exposing private Maps or journals. `createMemoryIntegrationFixture()` exposes a contract-shaped assembly fixture. Memory API version is `1.0.0`.

## Canonical authority boundary

Only a validated owner Settlement envelope may change canonical Temporal projection.

Accepted canonical input requires a Core-style WORLD_STATE MutationProposal, known exact Memory evidence, active source/freshness revisions, matching SettlementDecision, matching SETTLED SettlementReceipt, and for SET_CLAIM the receipt must include the exact claim ID.

`INFERRED`, `DERIVED`, and `UNKNOWN` claims are rejected from canonical publication. Confidence never grants mutation authority. Exact proposal+decision replay is idempotent.

## Append-only evidence and Temporal State

Raw evidence preserves stable identity, exact content, source revision, world/scene position, participants, knowledge/perspective metadata, provenance and authority. Source invalidation marks revision freshness separately and never deletes the original evidence.

Temporal State uses claim and transition journals instead of destructive slot overwrite. A newer current state records a SUPERSEDED_BY transition from the previous state, while the older state remains historical and reconstructible.

`currentProjection()` replays accepted canonical settlement entries. `asOf(worldRevision)` reconstructs an earlier projection. `historicalClaims()` exposes prior and unresolved state. `explainClaim()` drills through settlement, transitions and exact evidence. `traverseEntity()` provides bounded graph-like traversal.

## Ember Tavern / Sun Blade semantics

The golden proves Ember Tavern INTACT at world revision 1 and DESTROYED at revision 2. Current projection returns DESTROYED; as-of revision 1 returns INTACT; INTACT remains HISTORICAL with exact evidence.

Eris carrying and placing the Sun Blade remains HISTORICAL. Competing DESTROYED_IN_FIRE and REMOVED_BEFORE_FIRE evidence remains UNRESOLVED. No current Blade-fate winner is invented.

## Green Room boundary

Memory accepts Jev `GreenRoomBatch` contract `1.1.0` directly. Authority must remain INFERRED and canonical/Settlement/Character-State mutation flags must remain false.

Green Room supports bounded active characters/dimensions/history and expiry on Scene revision change, close/replacement, major time shift, character departure, contradiction, source-revision invalidation and TTL.

Repeated independent evidence may produce a Reflection proposal, but that proposal has no Character State or canonical authority. `greenRoomShadow()` exposes compact current micro-state for Main without authority promotion.

## Reflection / episode layer

Episodes preserve logical/revision identity, Scene refs, source revisions, evidence refs, participants, `knownBy`, significance, time bounds, summary, provenance and freshness. Raw evidence remains independently recoverable.

Reflections are durable but always INFERRED. They carry support and contradiction sets, episode/source dependencies, confidence, revision history, reinforcement/weakening/supersession metadata and provenance. Stale support fails closed.

Consolidation is checkpointable. `runConsolidation()` executes at most 32 work units per call; snapshot/reload resumes from the saved cursor. Runtime still owns physical scheduling and live L3/L4 yield behavior.

## Scene adapter gap

Scene `SceneExperienceProposal v1.0.0` is accepted reference-first. Scene correctly grants no Memory or Settlement authority.

If Scene-owned evidence refs are not yet materialized as exact Memory evidence, Memory retains the proposal but keeps that episode STALE/not Historian-eligible. Assembly therefore needs a minimal Scene evidence resolver/mapping. Memory does not silently treat an opaque external ref as exact local evidence.

## Core Settlement adapter

Core Settlement shape is compatible. Memory deliberately requires the referenced evidence/source revisions to be admitted before canonical mutation. If Core artifact identity differs from Memory evidence identity, assembly must map it explicitly.

## Historian producer

`MemoryHistorianIndex` indexes fresh episodes, durable Reflections, historical claims and unresolved hypotheses. It requires no external embedding, database, provider or orchestration service.

Ranking keeps lexical relevance, entity overlap, memory-kind fit, significance, recency and perspective compatibility distinct. Recency contributes only after actual relevance exists, so irrelevant recent episodes cannot win by age alone.

Character perspective is enforced through `knownBy`; WORLD memory cannot leak an event to a character who did not know it.

Direct Historian queries emit Core Candidate Bus-compatible `CandidateNomination v1.0.0` with explicit `authorityGranted=false`, `admissionAuthority=false`, `settlementAuthority=false`, `canonicalMutationAuthority=false`, and Memory metadata denying context-injection/Context-Seal authority.

Memory also consumes Jev `HistorianMemoryRequest v1.0.0` and emits `HistorianMemoryResolution v1.0.0`. Memory revision mismatches degrade with zero fabricated artifacts. Reflection artifacts remain INFERRED.

## Incremental invalidation

`invalidateSourceRevision()` records source invalidation, expires dependent Green Room state, stales dependent episodes/reflections, rebuilds fresh Historian records, preserves unrelated artifact identities, and retains all prior exact evidence/history.

Canonical claims depending on invalidated evidence remain reconstructible and visibly stale until a new owner decision arrives; Memory does not invent replacement truth.

## Bounds

| Contract | Bound |
|---|---:|
| evidence refs / artifact | 128 |
| source revisions / artifact | 64 |
| projection slots | 4,096 |
| journal traversal | 8,192 |
| entity traversal claims | 512 |
| Green Room active characters | 16 |
| Green Room dimensions | 9 |
| retained Green Room history | 512 |
| episode evidence refs | 128 |
| Reflection support / contradiction refs | 128 each |
| Historian query chars | 600 |
| Historian examined artifacts | 512 |
| Historian candidates | 48 |
| Historian episodes / Reflections | 24 / 12 |
| Historian evidence bytes | 65,536 |
| excerpt chars | 1,600 |
| diagnostics | 128 |
| checkpoint work units | 32 |
| consolidation jobs/session | 4,096 |
| indexed terms/artifact | 192 |

## Browser portability

Production modules use browser/SillyTavern-safe JavaScript and do not depend on Buffer, process runtime APIs, require, node:*, fs, path or worker_threads.

## Issue boundary

- **#5:** full issue-level acceptance candidate from this lane: reconstructible current/history/unresolved state and authority fence are proven.
- **#78:** Memory-owned durable side ready; keep open for joint Jev/runtime integration.
- **#9:** durable Reflection/consolidation producer ready; broader future learning/reconsolidation scope remains a Director decision.
- **#205:** Memory producer/resolver ready; keep open for Coprocessor/Sensory/Core integration.
- **#79:** checkpointable Memory side prepared; live scheduling/yield not complete.
- **#175:** raw episodes/provenance foundation only; hierarchical story/arc compaction not complete.
- **#178:** Memory producer input ready; FT003 not passed.
- **#224:** not passed.

## Completion claim

After final exact-head CI: **MEMORY TEMPORAL PRODUCER READY FOR ASSEMBLY**