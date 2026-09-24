# Cognitive Runtime Fabric — Wave 2 Changelog

## Baseline

- Branch: `Development-Worker-Director`
- Starting SHA: `89ce5f4610be28fd6d579d0ab883db67f5dc7676`
- Current Nexus read-only compatibility reference used during implementation: `5980ad2372fa9fbbd1b64111fdc790aaa0aa17fa`
- Wave 1 accepted cards #16/#17/#18/#19/#20/#21/#22/#23/#26 were preserved and not reopened/redesigned.

## Added — Deep Cognition Runtime (#28)

- Generic Deep work-profile registry.
- L3-default / L4-capable execution descriptors.
- Capability/version, resource, batch, checkpoint, dependency, revision, priority/deadline, expected-cost and yield metadata.
- Deep admission/activity telemetry.
- No specialist task-name logic in Scheduler or Worker Director.

## Added — Maintenance / Sleep Runtime (#32)

- Explicit generic L4 eligibility controller.
- Idle, foreground pressure, L2/L3 backlog, due/operator-request conditions.
- CPU/GPU/IO/provider-style resource limits.
- Maximum atomic-slice units.
- Maximum outstanding maintenance obligations.
- Maintenance dedupe/coalescing through Lifecycle.
- Safe generation preemption and resume.

## Added — Specialist obligation-producer hosting

- Generic producer descriptor/registry.
- Event -> external producer adapter.
- Opaque payload preservation.
- L2/L3/L4 hosting without cognitive semantic ownership.

## Extended — Capability discovery/negotiation (#124 Runtime portion)

- Versioned capability descriptors.
- Provider/implementation metadata.
- Foreground/background eligibility.
- Health/availability/concurrency/load/latency/quality metadata.
- Version-filtered discovery.
- Minimum/preferred version requests.
- Fallback capability request sets.
- Deterministic negotiation under resource policy.
- Provider disappearance/recovery.

## Added — Service dependency graph (#125 Runtime portion)

- Required vs optional dependencies.
- Startup validation.
- Dependency readiness/degraded state.
- Dynamic availability/recovery.
- Optional-dependency degraded execution.
- Service-cycle rejection.
- Task-dependency-cycle admission rejection.
- Durable Work Ledger dependency/degradation/negotiation state.

## Added — Extensible Event type registry (#131 Runtime portion)

- Stable versioned Event descriptors.
- Declarative payload schemas.
- Dynamic Event registration without Event Spine modification.
- Producer and schema-version fields in Event envelope.
- Revision-fence envelope.
- Compatible version resolution.
- Unknown/unregistered/incompatible/malformed Event rejection.
- Duplicate registration rejection.
- Subscriber failure diagnostics.

## Extended — Runtime telemetry (#33 Runtime portion)

Added signals for:

- Deep/Sleep admission/activity;
- dependency block/degrade/recovery/cycle;
- capability provider discovery/health/availability/negotiation/fallback;
- Event registration/rejection/subscriber failures;
- starvation protection;
- result-ready/late timing truth.

## Extended — publication compatibility seam

- Optional external Context-Seal timing checker.
- Optional external result sink.
- Opaque specialist-declared `resultContract` is preserved through producer/profile -> obligation -> completion envelope for current Nexus `CognitiveResult` adapters.
- Completion envelope carries task, producer/owner, correlation/causation, source revision IDs/set, world/scene revisions, degradation and late timing.
- No Result Bus destination or canonical mutation policy added.

## Fixed — persistent BLOCKED drain churn

Wave 2 telemetry testing found that Scheduler rewrote an already-identical `BLOCKED` state on every cycle. Because the Work Ledger sequence changed every time, `drain()` could treat a permanently missing dependency as progress until `maxCycles`.

Repair:

- identical `BLOCKED` state is now idempotent;
- scheduler diagnostics emit only on the actual state/reason transition;
- `drain()` truthfully stops when only unrecoverable-at-the-moment blocked work remains;
- dependency recovery later re-evaluates the same queued task.

Wave 1 regressions remain green after the fix.

## Extended — Batch / lifecycle / ledger

- per-task max slice-unit/checkpoint hints;
- adaptive slice target can honor safe-duration policy hints for future slices;
- explicit source revision ID fences alongside existing source revision set;
- durable dependency state;
- durable degradation state;
- durable capability-negotiation receipt.

## Added tests

- `tests/runtime-wave2.mjs` — 27 deterministic Wave 2 contracts.
- `tests/runtime-wave2-stress.mjs` — 5,200-submission mixed-layer stress + 578 Event storm + durable reload probe.
- `tests/syntax.mjs` now validates source module loading and syntax-checks all test modules.

## Validation

```text
Wave 1 deterministic: 29/29 PASS
Wave 2 deterministic: 27/27 PASS
Wave 1 stress: 2,200 PASS
Wave 2 stress: 5,200 submissions + 578 events PASS
Wave 2 completed: 2,435
L0/L1/L2/L3/L4 completion: 573 / 533 / 476 / 520 / 333
maxOpen: 1000
final open: 0
commit attempts: 2796
unique commits: 2796
duplicate commit attempts: 0
src module-load: 19/19 PASS
test syntax: 5/5 PASS
```

## Intentionally not implemented / not closed by this lane

- #27 Hot Cognition semantics.
- #29 Post-turn Memory semantics.
- #30 Lore Study eligibility semantics.
- #31 Reflection eligibility semantics.
- Result Bus.
- Context Seal.
- Settlement.
- Truth Gate / Context Compiler.
- Sidecar semantic workers.
- final persistence backend / external discovery transport.
- shared cards #124/#125/#131/#33.

## Governance

- No new branch created.
- No other branch used as implementation workspace.
- `Development-Nexus` inspected read-only only.
- No merge to `Development-Nexus`.
- No merge to `main`.
