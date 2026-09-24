# Cognitive Runtime Fabric — Wave 3 Changelog

## Added

- `src/runtime/provider-execution.js`: provider-neutral execution-resource adapter registry, typed timeout/unavailable/abort/malformed failures, cancellation, provenance and generic output-shape validation.
- `src/runtime/foreground-quorum.js`: bounded REQUIRED/OPPORTUNISTIC/DEFERRED foreground completion policy.
- `src/runtime/native-swarm.js`: canonical TURN_EVENT consumer and admitted CognitiveTask -> Runtime obligation adapter.
- `tests/runtime-wave3.mjs`: focused native swarm golden/negative acceptance.
- `tests/runtime-wave3-stress.mjs`: mixed multi-resource, one-resource and provider-churn stress.
- `tests/runtime-wave3-browser.mjs`: browser-hostile dependency scan plus browser-style execution.
- `scripts/runtime-wave3-provider-smoke.mjs`: opt-in external JSON provider smoke seam.
- Wave 3 GitHub Actions workflow.

## Changed

- `WorkerDirector` now tracks in-flight assignments, can wait only for a specified foreground task set, forwards the scheduler-selected worker into provider execution, emits typed result-ready envelopes, supports cancellation, and applies bounded provider health/fallback behavior.
- `BatchEngine` forwards execution context (including selected worker) to execute/validate/commit hooks without changing existing executor contracts.
- Runtime event constants include canonical `TURN_EVENT`.
- `CognitiveRuntimeHost` exposes the native turn runtime and execution-resource registration.
- Runtime package exports/scripts include Wave 3.
- Foreground quorum distinguishes temporary single-resource contention from true no-progress/resource absence, allowing queued REQUIRED work to run sequentially before fallback.

## Preserved

Wave 1/2 Lifecycle, Work Ledger, Resource Governor, capability negotiation, dependency graph, batching, yield/park/resume, recovery, Deep/Sleep hosting, Event Spine and telemetry remain the base implementation. Wave 3 does not replace those systems.

No fixed SC-A/SC-B/Jev worker identities were introduced. No cognitive owner semantics, Truth Gate, Context Seal, Settlement, Scene Intelligence, Lore, Memory, or Result Bus authority were moved into Runtime.

## Integration status

Runtime Wave 3 proves the branch-owned native execution path. FT005, #222 full integrated acceptance, and #224 remain deliberate live-main assembly gates.
