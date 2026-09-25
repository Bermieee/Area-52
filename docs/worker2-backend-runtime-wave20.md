# Worker 2 backend/runtime closure — Wave 20

Branch: `Development-Sidecar/Jev`

This wave advances backend contracts only. It preserves `docs/worker2-standing-wiring-wave19.md` unchanged for Worker 3.

## Worker 1 contract inspected

Worker 1 `Development-Nexus` was inspected at `c0731ae5707d1ea4fce46dc2065c3bb48262a216`.

The existing native Runtime owns:

- `WorkerDirector.registerWorker()`, `submit()`, `beginGeneration()`, `completeGeneration()`;
- capability negotiation and concurrency in `src/runtime/capability-registry.js`;
- foreground reserve/resource leases in `src/runtime/resource-governor.js`;
- cooperative yield, checkpoint slices, park/resume in `src/runtime/worker-director.js` and `src/runtime/batch-engine.js`;
- Deep Cognition admission in `src/runtime/deep-cognition.js`.

Worker 2 does not replace those authorities.

## #124 capability contract

`runtime-director-bridge.js` adds the Worker 2 side of the runtime contract:

- tasks continue to request capability/version sets, never named workers or models;
- capability negotiation now enforces context/output limits, resource class/profile limits, cost, latency, health, concurrency, foreground/background eligibility and fallback sets;
- qualified resource profiles map to WorkerDirector worker descriptors;
- provider/model identity remains in routing/worker receipts, outside the canonical `CognitiveTask`;
- the bridge fail-closes if a Director assignment is not in the pre-qualified candidate set.

Important integration dependency: Worker 1's current `CapabilityRegistry` does not itself evaluate Worker 2's context/output/latency/cost fields. Worker 2 therefore pre-qualifies them and protects execution with the assignment guard. Full shared-runtime closure should add the same constraints natively to Worker 1's registry so the scheduler never nominates a candidate the guard must reject.

## #88 placement contract

Wave 18 `NativeHotDeepScheduler` remains a policy/admission helper at the Worker 2 boundary. Production execution is delegated to WorkerDirector.

The bridge maps:

- HOT -> `runtimeClass: NATIVE_COGNITIVE`, `foreground: true`;
- DEEP -> `runtimeClass: DEEP`, `foreground: false`, `foregroundSensitivity: YIELD_ON_GENERATION`;
- Deep work -> safe-boundary yield policy, one-unit checkpoint/slice defaults;
- low-value optional work -> SKIP;
- saturated Deep admission -> DEFER.

The standalone Wave 18 Deep queue is now bounded by `maxDeepQueue`. WorkerDirector's own `maxOutstanding` remains the production backpressure authority.

`beginGeneration()` / `completeGeneration()` on the bridge delegate directly to WorkerDirector. This allows Worker 1's ResourceGovernor and BatchEngine to perform the real yield/checkpoint/park/resume lifecycle.

## #211 owner integration

`adjudicateJevForOwner()` combines the generic Jev domain service with owner review while preserving the authority boundary.

- fresh/pre-seal Memory and Temporal proposals may be reviewed by their owners;
- stale proposals are rejected before owner review;
- post-seal proposals are rejected before owner review;
- Jev always reports `jevSettlementPerformed: false`;
- only the owner review receipt may report Settlement/canonical mutation.

The existing Lore, Scene, Retrieval/Truth, Memory and Temporal adapters still share the same bounded Jev core. The Wave 20 workflow reruns the exact #211 stale replay, sealed replay, Decision Core eviction and adapter eviction reproduction suite.

## #87 benchmark evidence

`summarizeBackendRuntimeClosureBenchmarks()` records:

- routing semantic stability and interchangeable resources;
- foreground blocking and queue latency;
- Deep yield latency;
- bounded fallback;
- stale rejection;
- Deep defer/backpressure and policy skips;
- optional CPU/RAM evidence.

The report carries an explicit `measurementClass`. `LOCAL_DETERMINISTIC` reports never claim live OpenRouter token cost, provider latency or provider cost.

## Native Brain invariant

No bridge requires Jev, Sidecar, Vectoring, an external database, or an orchestration service for native Brain operation. Optional-resource absence remains a valid degraded/native-only state.
