# Cognitive Coprocessor Wave 12 Changelog

## Scope

Worker 2 Wave 12 advances #77 from a packet/cache foundation into a host-neutral pre-Send preparation pipeline on `Development-Sidecar/Jev`.

## Production changes

- Added `SpeculativeWarmCoordinator` around the existing `WarmPacket` contract.
- Accepts only ACTIVE, evidence-backed Scene `PrefetchRecommendation` inputs whose Scene/source fences agree with an explicit warm identity containing Scene, world, character-state, source and retrieval-policy revisions.
- Coalesces repeated semantic recommendations and bounds active work, queued work, retrieval intents, retrieval slices, candidate/evidence references, packet bytes, estimated tokens, receipts, diagnostics, cache residency and sealed-turn bookkeeping.
- Runs retrieval in safe slices, then retrieval-quality assessment, injected Truth, optional Precision and compile work.
- Keeps only references and bounded receipts in the packet. Non-reference compile payloads are reduced to a hash/size receipt and are not reusable prompt material.
- Provides a native/default reference-only path with no network or provider dependency. It never claims retrieval, Truth, Precision or compile work was completed when optional capacity is absent.
- Foreground Send consumption rechecks exact intent/revision fences. FRESH output is only a Core revalidation candidate; PARTIALLY_STALE output exposes references with mandatory rerank + Truth recheck + recompile; STALE/INVALID/miss falls back to normal foreground retrieval.
- Warm material never gains canon, admission, Context Seal or prompt authority.
- Added foreground-yield checkpoints, bounded one-resource scheduling, active-work supersession on revision changes, and sealed-turn rejection.
- Added `WarmPacketCache.peek()` for side-effect-free inspection after a successful freshness evaluation.

## Evaluation

- Added Ember Tavern / Sun Blade foreground-only versus warmed benchmark.
- Measures prediction attempts, useful fresh candidates after Core revalidation, partial salvage, stale/invalid discard, false warm hits, foreground stage calls avoided, warm preparation latency, Send latency, retained packet bytes and process CPU time.
- The benchmark explicitly records `zeroLatencyClaim: false`.
- Added focused goldens/negatives, queue/yield tests, active invalidation, cache/TTL failure tests, stress and browser-portability guard.

## Ownership preserved

Wave 12 does not edit:

- `src/coprocessor/native-coprocessor-bootstrap.js`
- `evaluation/jev-wave11-evaluator.mjs`
- `tests/coprocessor-wave11-*`
- `src/coprocessor/jev-domain-adapter.js`
- JevDecisionCore replay logic

Scene remains owner of CurrentScene/boundary confirmation/prefetch recommendation. Core remains owner of Candidate Bus, Truth, Compiler, admission and Context Seal. Runtime remains owner of durable scheduling. UI remains observational.
