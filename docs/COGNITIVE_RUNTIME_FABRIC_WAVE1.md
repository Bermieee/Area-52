# Cognitive Runtime Fabric — Wave 1 Implementation Record

**Repository:** `Bermieee/Area-52`  
**Owner branch:** `Development-Worker-Director`  
**Starting SHA:** `f3d2a4970fb159095b0bae12f5002d3ba2d2b598`  
**Canonical read-only architecture reference:** `Development-Nexus@1b1f81d0a1d1d036a4c5719bdc477fd8effb8acd`  
**Wave:** Runtime Fabric Wave 1  
**Primary issues:** #16, #17, #18, #19, #20, #21, #22, #23, #26  
**Shared observability issue:** #33 (Runtime-owned portion only)

## 1. Purpose

Wave 1 supplies the native execution substrate underneath Area-52 cognition. It deliberately separates two truths:

- **Lifecycle truth:** whether a cognitive obligation exists and remains valid.
- **Execution truth:** whether a worker is currently running, yielding, parked, blocked, recovering, or complete.

The central invariant is:

> **Generation changes execution priority, not cognitive lifecycle truth.**

Foreground cognition receives reserved execution capacity. Background cognition may borrow otherwise idle capacity, but it yields only at a safe batch boundary and resumes from a durable checkpoint. The Runtime Fabric executes work; it does not decide semantic truth or grant canonical mutation authority.

## 2. Architecture

```text
Cognitive Obligation
        |
        v
   Lifecycle Core
        |
        v
 L0-L4 Scheduler
        |
        v
 Resource Governor
        |
        v
Capability Registry
        |
        v
   Batch Engine
        |
        v
 Work Ledger
    |       |
    |       +--> safe yield / park
    |       +--> recovery / reconcile
    |       +--> resume
    v
  complete
```

Coordination events are emitted through the Event Spine and lightweight telemetry signals are emitted independently. Telemetry failure is non-fatal.

## 3. Implemented modules

### `src/runtime/constants.js`

Defines canonical L0-L4 layers, lifecycle states, execution states, capability names, resource classes, and lifecycle coordination event types.

Lifecycle states:

```text
PENDING / ELIGIBLE / SATISFIED / SUPERSEDED / CANCELLED
```

Execution states:

```text
QUEUED / ACTIVE / YIELDING / PARKED / BLOCKED / RECOVERING / COMPLETE / FAILED
```

### `src/runtime/lifecycle.js` — Lifecycle Core (#16)

The Lifecycle Core owns cognitive obligation identity and truth. An obligation carries task type, layer, owner, required capabilities, resource class, source/world/scene revisions, dependencies, priority/deadline, foreground/speculative classification, durable dedupe identity, conflict/supersession identity, and deterministic sequence identity.

Key behavior:

- worker unavailability does not erase an obligation;
- exact redelivery dedupes against durable identity, including after successful completion and reload;
- compatible pending work may coalesce and append unique units;
- newer conflicting revisions supersede only truthfully stale work;
- active stale work is asked to yield and is freshness-checked before commit;
- bounded outstanding work applies backpressure;
- speculative work is the first class eligible for shedding when foreground work needs admission.

### `src/runtime/scheduler.js` — L0-L4 Scheduler (#17)

The scheduler maintains layer-aware eligible work and selects what may execute now. Ordering is deterministic:

1. effective cognitive layer;
2. priority;
3. deadline;
4. creation sequence;
5. task ID.

Dependency readiness, worker capability, worker availability, and Resource Governor eligibility are checked before dispatch. Starvation protection gradually promotes waiting L3/L4 work toward L2 service without allowing it to outrank L0/L1 foreground cognition.

A single global FIFO is not used.

### `src/runtime/batch-engine.js` — Mandatory Batch Engine (#18)

Large work is represented as bounded units and executes one atomic slice at a time:

```text
prepare
 -> execute slice
 -> validate
 -> freshness check
 -> durable commit intent
 -> external commit
 -> ledger commit/checkpoint
 -> safe yield decision
 -> next slice
```

The batch record retains batch ID, units, completed units, completed slice IDs, active slice/phase, validation state, retry state, and adaptive batch size.

Adaptive batch sizing is deterministic and bounded. It reacts to:

- foreground demand;
- resource pressure;
- historical slice duration;
- queue depth;
- deadline proximity.

### `src/runtime/resource-governor.js` — Resource Governor (#19)

The governor implements the rule:

> **Foreground capacity is reserved. Background capacity is borrowed.**

Worker resource profiles may contain CPU, GPU, memory, IO, network/provider slots, structured-LLM slots, reranker, embedding, or graph resources without naming a provider in the architecture.

While generation is inactive, background work may borrow the reserve. When generation starts, active background leases receive yield requests. Resource capacity is reclaimed only after the current atomic slice reaches a safe checkpoint and parks.

The capability fixture proves a slower CPU `RERANK` worker can be selected instead of a faster GPU `RERANK` worker when the GPU is reserved for generation.

### `src/runtime/work-ledger.js` — Durable Work Ledger (#20)

The Work Ledger is authoritative for execution progress. It records:

- task identity and obligation contract;
- lifecycle and execution status;
- dependencies;
- complete batch state;
- completed unit and slice identities;
- active slice phase;
- checkpoint;
- result receipts;
- retries and failure evidence;
- recovery state;
- supersession state;
- yield request;
- deterministic update sequences.

Completed slices are durable and are not silently replayed after reload.

#### Commit-intent protocol

Before an external commit, the active slice is persisted as `COMMITTING` with a stable idempotency key. If the process reloads or the commit call fails ambiguously after that point, Runtime does **not** assume the commit failed and replay it. The task enters:

```text
RECOVERING / commit-reconciliation-required
```

A host/persistence integration must explicitly reconcile whether the external side effect committed. This closes the crash window between an irreversible side effect and the local checkpoint.

### `src/runtime/worker-director.js` — Cooperative Yield/Resume (#21)

The Worker Director coordinates execution while preserving Lifecycle ownership.

Background execution follows:

```text
ACTIVE -> YIELDING -> PARKED -> ACTIVE -> COMPLETE
```

Before `PARKED`, a slice has completed or failed safely, validated, passed freshness, committed/checkpointed, and released its borrowed worker/resources. Resume begins at the next uncommitted unit.

Worker crashes retry from the last committed checkpoint. Committed slices remain committed. Ambiguous commit failures do not retry until explicitly reconciled.

### `src/runtime/capability-registry.js` — Capability Registry + Worker Pools (#22)

Workers advertise:

- worker ID;
- capabilities;
- supported layers;
- resource profile;
- optional provider/model metadata;
- current load;
- availability;
- latency score;
- health;
- concurrency capacity.

Tasks declare capabilities. The scheduler selects an eligible worker using deterministic policy and Resource Governor constraints. Worker names do not carry semantic authority.

### `src/runtime/event-spine.js` — Event Spine (#23)

The native Event Spine emits immutable in-process coordination events with:

- event ID/type;
- causation ID;
- correlation ID;
- turn/task IDs;
- source/world/scene revisions;
- sequence/time;
- dedupe identity.

Duplicate event delivery returns the already accepted event. Subscriber failures do not grant mutation authority or redefine lifecycle truth. The contract is transport-neutral.

### Backpressure / dedupe / coalescing / supersession (#26)

The implementation bounds outstanding lifecycle work, dedupes durable identity, coalesces compatible pending work, rejects or sheds low-value speculative work under pressure, and supersedes stale revisions without rewriting completed historical work.

Freshness is checked after slice validation and immediately before the external commit boundary. A revision superseded while its slice is running cannot publish the stale slice.

### `src/runtime/telemetry.js` — Runtime contribution to #33

The bounded telemetry ring emits lightweight signals including:

- worker started;
- yielding/yield requested;
- parked;
- resumed;
- blocked;
- recovering;
- completed;
- queue depth by layer;
- layer utilization;
- foreground reserve and borrowed capacity;
- batch checkpoint/progress;
- recovery state.

Telemetry sink failures are swallowed and counted; cognition continues. Full Work Ledger snapshots are explicit through `snapshot()` rather than continuously emitted.

## 4. Persistence contract

`MemoryPersistenceAdapter` is a deliberately simple replaceable reference implementation for deterministic reload/recovery tests. Runtime depends on a small `load()`/`save()` abstraction and does not choose the final Area-52 persistence backend.

The in-memory adapter snapshots the complete ledger and is intentionally **not** a production-scale storage benchmark. Scheduler/backpressure stress therefore runs without persistence-copy overhead, while crash/reload/idempotence behavior is tested separately with the adapter enabled.

## 5. Integrated deterministic acceptance scenario

`tests/runtime-fabric.mjs` implements the Wave 1 acceptance path:

1. L3 Lore Study becomes eligible and is sliced.
2. A background structured-LLM worker begins and commits bounded progress.
3. Generation begins and requests a safe yield.
4. The active slice validates/checkpoints and the worker parks while lifecycle remains `ELIGIBLE`.
5. An L1 semantic-judgment obligation runs without waiting for all Lore Study work.
6. Generation completes and Lore Study resumes from the next truthful unit.
7. Completed slices are not replayed.
8. Runtime is reloaded from the Work Ledger.
9. Completed progress remains complete.
10. Duplicate delivery after completion/reload dedupes to the durable original task.
11. An older pending revision is superseded by a newer revision while unrelated valid work is preserved.
12. Runtime reaches a terminal truthful state without lost work.

Additional deterministic fixtures cover active-revision supersession before commit, ambiguous external commit reconciliation, worker failure/retry, dependency blocking, unavailable workers, starvation protection, adaptive batching, CPU/GPU capability policy, and telemetry failure containment.

## 6. Stress acceptance

`tests/runtime-stress.mjs` submits **2,200 obligations** across L1-L4 with multiple capability pools, constrained workers, repeated generation events, superseding revisions, and bounded outstanding work.

Observed deterministic run:

```text
submitted:   2200
accepted:     798
rejected:    1402
completed:    700
superseded:    34
cancelled:     65
open:           0
```

The extra terminal record is the dedicated generation-preemption fixture that completes before the bulk 2,200-obligation run.

The stress harness asserts:

- open lifecycle work never exceeds the configured bound;
- backpressure is exercised;
- foreground generation causes cooperative background yield;
- legitimate work completes;
- no idempotency key is committed twice;
- superseded work is contained;
- the queue drains to zero open obligations.

## 7. Validation evidence

Current local validation for the exact implementation intended for commit:

```text
Runtime Fabric deterministic suite: 29/29 PASS
Runtime Fabric stress suite: PASS (2,200 obligations; open=0)
Syntax/module-load sweep: 13/13 PASS
```

The deterministic suite includes all five L0-L4 classifications plus lifecycle/execution separation, scheduling, reservation/borrowing, safe yield, park/resume, durable reload, completed-slice idempotence, in-doubt commit recovery, durable duplicate delivery, coalescing, queued and active supersession, adaptive batching, same-capability routing, resource-policy routing, starvation protection, unavailable workers, dependency blocking, Event Spine identity, backpressure, telemetry containment/signals, worker failure recovery, and the integrated Wave 1 scenario.

## 8. Recovery behavior

| Failure | Runtime behavior |
|---|---|
| No eligible worker | Obligation remains valid; execution becomes `BLOCKED`. |
| Worker/execute failure | Active slice is not committed; retry resumes from last committed checkpoint. |
| Validation failure | Slice is not committed. |
| Generation begins | Active background work becomes `YIELDING`, commits its current safe slice, then parks. |
| Duplicate obligation | Durable dedupe identity returns the existing task. |
| Newer source revision | Truthfully stale work is superseded; active stale output is blocked before commit. |
| Ambiguous external commit | Task becomes `RECOVERING` and requires explicit commit reconciliation; no blind replay. |
| Telemetry sink failure | Signal failure is counted; cognition continues. |
| Cache loss | Work identity remains in the Work Ledger; Runtime does not treat cache as canonical progress. |

## 9. Cross-lane boundaries

Wave 1 intentionally does **not** implement semantic authority owned elsewhere.

- #24 Result Bus — `Development-Nexus`.
- #25 Context Seal — `Development-Nexus`.
- Settlement / Truth Gate semantics — `Development-Nexus` and owning semantic lanes.
- Memory / Reflection semantics — `Development-Memory`.
- Sidecar worker semantics / Gather Coordinator — `Development-Sidecar/Jev`.
- Scene Intelligence / Lore Study semantics / Context Compiler — their owning lanes.
- #33 UI rendering — `Development-UI`; this branch supplies only real Runtime signals.

The seams are capability-driven, revision-aware, event-correlated, and persistence/transport-neutral so those lanes can integrate without Runtime absorbing their authority.

## 10. Known limitations / later work

1. The reference persistence adapter is test-oriented and copies the full in-memory ledger; a production backend remains a separate evaluation.
2. Event Spine is a native in-process reference transport. Cross-process transport remains a benchmark/evaluation decision.
3. Worker executors are runtime process objects and must be reattached by the host after reload; durable task/progress identity remains in the ledger.
4. Ambiguous external commit recovery intentionally requires a real integration-specific reconciliation source rather than guessing.
5. Deadline participates in deterministic scheduler ordering; task-specific timeout/fallback semantics remain the responsibility of the task/integration contract.
6. Result Bus, Context Seal, settlement, semantic workers, Hot Cognition, and Deep Cognition lifecycle consumers are deliberately not implemented here.
7. #33 is only partially satisfied by this lane until the UI owner consumes the emitted Runtime signals.
8. Parent epic #11 remains open because later Runtime Fabric waves are still required.

## 11. Source files

```text
src/runtime/constants.js
src/runtime/utils.js
src/runtime/persistence.js
src/runtime/telemetry.js
src/runtime/event-spine.js
src/runtime/work-ledger.js
src/runtime/lifecycle.js
src/runtime/capability-registry.js
src/runtime/resource-governor.js
src/runtime/scheduler.js
src/runtime/batch-engine.js
src/runtime/worker-director.js
src/runtime/index.js

tests/runtime-fabric.mjs
tests/runtime-stress.mjs
tests/syntax.mjs
```

## 12. Documentation reconciliation note

This implementation was built against the current authoritative `Development-Nexus` documentation as read-only reference. The Runtime implementation record lives on `Development-Worker-Director`. Any future canonical documentation reconciliation into `Development-Nexus` belongs to the integration owner and is not performed by this Wave 1 branch.
