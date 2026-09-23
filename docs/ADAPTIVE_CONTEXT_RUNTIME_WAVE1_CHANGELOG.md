# Adaptive Context Runtime Wave 1 — Changelog

## Added

### Delivery contracts

- `src/adaptive-context-contracts.js`
  - prompt slot vocabulary;
  - contribution source classes;
  - `PromptPlan` contract;
  - delivery/reuse/representation states;
  - deterministic delivery hashing.

### Runtime

- `src/adaptive-context-runtime.js`
  - Prompt Slot Registry;
  - Model Profile Registry;
  - deterministic approximate token estimator;
  - adaptive budget allocator;
  - Context Delivery Engine;
  - revision-aware Change Gate;
  - cache-aware segmentation;
  - profile-driven ordering;
  - Prompt Integrity Guard;
  - model adapter registry and two deterministic reference adapters;
  - explicit overflow/failure behavior, including distinct optional drop vs defer decisions.

### Benchmarking

- `src/adaptive-context-benchmarks.js`
  - retention, size, reuse, rebuild, cache, fallback, latency and cost-hook metrics;
  - profile semantic-equivalence / presentation-difference comparison.

### Core integration

- `Area52CognitiveCore` now constructs `this.delivery` and exposes `deliverGenerationContext({published,...})`.
- Delivery accepts only the already-published packet and seal receipt; it does not receive mutation authority.

### Tests and acceptance

- `tests/wave4.mjs` adds contract, budget, reuse, segmentation, attack, fallback, sealed extension-slot, ownership, defer-state, benchmark and 1,200-contribution stress coverage.
- `tests/wave4-golden-harness.js` carries the accepted Ember Tavern / Sun Blade packet across two model profiles, reuse, a revised seal, budget pressure and integrity attacks.
- `scripts/wave4-acceptance-report.mjs` provides a deterministic acceptance report.
- Cognitive Core CI runs the Wave 4 acceptance report in addition to prior suites.

## Preserved

Wave 1–3 source authority, temporal state, Reflection, Settlement, Result Bus, Truth Gate, Precision, Publication Context Compiler and Context Seal behavior are intentionally unchanged except for the explicit new post-seal delivery integration point in `src/cognitive-core.js`.

## Not changed

- canonical mutation ownership;
- production Sidecar/Jev routing;
- Runtime Fabric scheduling;
- UI.Core;
- persistence backend;
- real provider/model preference claims.
