# Cognitive Runtime Fabric Wave 1 — Acceptance Evidence

## Commands

```bash
npm test
npm run check
```

## Current result

```text
Runtime Fabric deterministic suite: 29/29 PASS
Runtime Fabric stress: 2200 submitted; accepted=798; rejected=1402; completed=700; superseded=34; cancelled=65; open=0
Runtime Fabric stress suite: PASS
Syntax/module-load sweep: 13/13 PASS
```

## Acceptance coverage map

| Contract | Evidence |
|---|---|
| Lifecycle vs execution state | blocked worker + yield/park tests preserve `ELIGIBLE` lifecycle |
| L0-L4 classification | explicit fixtures for all five layers |
| Layer-aware scheduling | L1 dispatches before L3 |
| Foreground reservation | background borrowing + generation preemption fixture |
| Resource revocation | active background leases receive yield requests |
| Mandatory batching | all multi-unit work advances by bounded slices |
| Adaptive batching | deterministic foreground/pressure/history/backlog fixture |
| Checkpoint creation/resume | safe-yield and reload fixtures |
| Completed-slice idempotence | resume/reload duplicate-slice assertions |
| Reload recovery | persisted ledger reload + executor reattachment |
| In-doubt commit recovery | `COMMITTING` requires explicit reconciliation |
| Duplicate task delivery | dedupe before and after completion/reload |
| Safe yield boundary | active slice completes, validates and checkpoints before park |
| Worker park/resume | explicit `PARKED` then `WORK_RESUMED` path |
| Capability matching | deterministic same-capability worker selection |
| Resource-profile matching | CPU RERANK selected when GPU reserve is protected |
| Worker unavailability | obligation remains `ELIGIBLE/BLOCKED` |
| Worker failure | retry from last committed checkpoint |
| Dependency blocking | dependent task waits until prerequisite is satisfied |
| Event correlation/causation | immutable deduped Event Spine fixture |
| Coalescing | compatible pending source-study units combine |
| Supersession | queued stale revision and active stale revision fixtures |
| Queue backpressure | bounded outstanding work + speculative shedding |
| Stale revision containment | active superseded slice is rejected before commit |
| Starvation protection | L4 eventually runs under recurring L2 arrivals |
| Telemetry signals | lifecycle/resource/queue/layer/checkpoint signal fixture |
| Telemetry failure | throwing sink does not stop task completion |
| Integrated acceptance | Lore Study yield -> L1 foreground -> resume -> reload -> dedupe -> supersession |
| Large-obligation stress | 2,200 submitted; queue bounded; drains to zero open |
| Module/syntax | 13 Runtime modules import successfully |

## Scope boundary

This evidence establishes the Wave 1 native Runtime Fabric contract. It does not claim live semantic Result Bus, Context Seal, Memory, Settlement, Scene Intelligence, Lore Study, or Sidecar worker behavior, which remain owned by their respective lanes.
