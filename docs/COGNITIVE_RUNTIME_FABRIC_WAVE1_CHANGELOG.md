# Cognitive Runtime Fabric — Wave 1 Changelog

## Baseline

- Branch: `Development-Worker-Director`
- Starting SHA: `f3d2a4970fb159095b0bae12f5002d3ba2d2b598`
- Canonical architecture read from: `Development-Nexus@1b1f81d0a1d1d036a4c5719bdc477fd8effb8acd`
- No new branch created.
- No implementation work performed on another branch.
- No merge to `Development-Nexus` or `main`.

## Added — Lifecycle Core (#16)

- Canonical durable cognitive obligations.
- Explicit lifecycle state independent of worker execution state.
- Deterministic sequence identity, revision/freshness metadata, dependencies, priority/deadline, dedupe/conflict/coalesce keys.
- Durable dedupe across completion and reload.
- Truthful supersession without deleting completed historical work.

## Added — L0-L4 Cognitive Scheduler (#17)

- Layer-aware queues for Reflex, Assist, Nearline, Background, and Sleep.
- Deterministic priority/deadline/sequence ordering.
- Dependency readiness and worker/resource eligibility.
- Starvation protection for legitimate L3/L4 work while preserving L0/L1 precedence.
- Explicit BLOCKED state when execution cannot proceed.

## Added — Mandatory Batch Engine (#18)

- Bounded slice execution and validation.
- Durable active-slice identity and phases.
- Adaptive deterministic batch sizing.
- Stable idempotency key per slice.
- Freshness fence immediately before external commit.
- Checkpoint after each committed slice.

## Added — Resource Governor (#19)

- Real foreground resource reservation.
- Background borrowing while foreground demand is absent.
- Generation-driven cooperative revocation/yield requests.
- Provider-neutral resource profiles including CPU/GPU/IO/network/LLM/rerank/embed/graph classes.

## Added — Durable Work Ledger (#20)

- Durable task/batch/progress/checkpoint/retry/recovery state.
- Completed-slice and completed-unit identity.
- Result receipts.
- Commit-intent protocol.
- Explicit reconciliation for in-doubt irreversible commits.
- Reload recovery without silent replay.

## Added — Cooperative Yield / Resume (#21)

- `ACTIVE -> YIELDING -> PARKED -> ACTIVE -> COMPLETE` execution lifecycle.
- Safe checkpoint boundary before park.
- Resume from next uncommitted unit.
- Worker/resource release after park/complete/failure.

## Added — Capability Registry + Worker Pools (#22)

- Capability-driven worker matching.
- Supported layers, resource profile, load, capacity, latency, health, availability, optional provider/model metadata.
- Deterministic selection among equivalent capabilities.
- Resource policy can choose CPU over faster GPU when Main-generation GPU capacity is reserved.

## Added — Event Spine (#23)

- Immutable lifecycle coordination events.
- Event/correlation/causation/task/turn/revision/sequence/dedupe identity.
- Duplicate event delivery containment.
- Transport-neutral in-process reference implementation.

## Added — Backpressure / dedupe / coalescing / supersession (#26)

- Bounded outstanding obligation count.
- Speculative shedding under foreground admission pressure.
- Compatible pending-work coalescing.
- Durable duplicate-delivery handling.
- Queued stale-work supersession.
- Active stale-result containment before commit.

## Added — Runtime telemetry contribution (#33)

- Started, blocked, yielding, yield-requested, parked, resumed, recovering, completed signals.
- Queue depth and layer utilization.
- Resource usage/reserved foreground/borrowed background reporting.
- Batch checkpoint/progress signals.
- Bounded signal history; telemetry sink failures cannot stop cognition.

## Tests added

- `tests/runtime-fabric.mjs`: 29 deterministic contract/acceptance tests.
- `tests/runtime-stress.mjs`: 2,200-obligation constrained-capacity stress scenario.
- `tests/syntax.mjs`: recursive Runtime module syntax/import sweep.

## Validation result

```text
Runtime Fabric deterministic suite: 29/29 PASS
Runtime Fabric stress: 2200 submitted; accepted=798; rejected=1402; completed=700; superseded=34; cancelled=65; open=0
Runtime Fabric stress suite: PASS
Syntax/module-load sweep: 13/13 PASS
```

## Intentionally not implemented

- #24 Result Bus.
- #25 Context Seal.
- #27 Hot Cognition.
- #28 Deep Cognition.
- Memory / Reflection / Settlement / Truth Gate semantics.
- Scene Intelligence.
- Lore Study semantics.
- Context Compiler.
- Sidecar semantic worker contracts and Gather Coordinator.
- Final persistence backend.
- Mandatory Dapr/LangGraph/Redis Streams/ZeroMQ dependency.

## Known integration work

- `Development-UI` must consume the real signals before shared issue #33 can close.
- `Development-Nexus` remains responsible for Result Bus / Context Seal and canonical documentation reconciliation.
- Semantic lanes must bind their own task contracts and authority rules to this execution substrate.
