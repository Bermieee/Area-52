# Cognitive Coprocessor — Wave 9 Changelog

## Starting checkpoint

`Development-Sidecar/Jev@aee72220131037c3e499372a418ccb3c52078fa6`

## Added

- `jev-domain-adapter.js`: reusable domain-adapter registry/service, deterministic-first orchestration, replay/idempotency, bounded owner proposal contract, Runtime task projection, UI diagnostic projection and bounded telemetry.
- `jev-lore-adapter.js`: Lore Tree placement, reconciliation and retention-review adapters.
- `jev-scene-adapter.js`: Scene boundary, cast/location conflict and merge/split review adapters with `MENTIONED_ONLY != PRESENT` and OBSERVED/INFERRED fencing.
- `jev-retrieval-truth-adapter.js`: Retrieval/Truth semantic fallback adapters with stale/temporal/provenance/authority negatives.
- `jev-adapter-matrix.js`: default three-domain registry/matrix and limited Wave 9 #212 corpus contribution.
- focused Lore, Scene, Retrieval/Truth, cross-domain, authority, stress and browser-like test suites.
- `.github/workflows/coprocessor-wave9.yml` exact-head gate.
- dedicated Wave 9 architecture, changelog and acceptance documentation.

## Preserved

- Wave 8 canonical `JevDecisionRequest` / `JevDecisionReceipt` and generic Jev kernel.
- deterministic-first invocation and bounded provider execution.
- no physical Jev worker identity.
- owner/Settlement authority boundary.
- Runtime Wave 3 remains read-only reference; no Runtime scheduling was duplicated.

## Explicit non-goals retained

No Lore Study, Lore representation compiler, Tree mutation, Scene Intelligence, Memory backend, Temporal State Graph, Candidate Bus ownership, Truth settlement, Runtime scheduler, provider qualification, UI, Context Compiler, Settlement or full #212 benchmark program was added.