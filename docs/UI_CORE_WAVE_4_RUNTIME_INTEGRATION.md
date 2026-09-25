# UI.Core Wave 4 — Runtime Wave 1 Contract Alignment

**Runtime reference:** `Development-Worker-Director@89ce5f4610be28fd6d579d0ab883db67f5dc7676`

## Accepted Runtime vocabulary consumed

Cognitive layers:

```text
L0 L1 L2 L3 L4
```

Lifecycle truth:

```text
PENDING ELIGIBLE SATISFIED SUPERSEDED CANCELLED
```

Execution truth:

```text
QUEUED ACTIVE YIELDING PARKED BLOCKED RECOVERING COMPLETE FAILED
```

The UI adapter keeps lifecycle and execution as distinct fields.

## Accepted public state

Worker Director `snapshot()` exposes:

- lifecycle task ID/status/execution/layer;
- queue depth by layer;
- Resource Governor snapshot;
- Capability Registry worker snapshot;
- bounded telemetry summary.

Work Ledger detail contains:

- obligation contract;
- lifecycle/execution status;
- dependencies;
- batch state;
- completed unit/slice identities;
- active slice phase;
- validation;
- adaptive batch size;
- checkpoint;
- result receipts;
- retries/failures;
- recovery;
- supersession;
- yield request;
- deterministic sequences.

UI.Core keeps its existing paged summary + explicit detail model.

## Accepted telemetry mapping

Runtime signal | UI observation
---|---
`QUEUE_DEPTH` | keyed queue-depth update
`LAYER_UTILIZATION` | keyed L0-L4 utilization update
`RESOURCE_UTILIZATION` | resource usage, foreground reserve, borrowed background leases
`BATCH_CHECKPOINT` | bounded batch/checkpoint progress
`WORK_STARTED` | execution ACTIVE
`WORK_YIELDING` | execution YIELDING
`WORK_PARKED` | execution PARKED + checkpoint
`WORK_RESUMED` | execution ACTIVE/resumed
`WORK_BLOCKED` | execution BLOCKED
`WORK_RECOVERING` | execution RECOVERING
`WORK_COMPLETED` | execution COMPLETE

Unknown telemetry types are passed through safely rather than crashing.

## Event Spine

The adapter can consume Event Spine subscriptions independently from telemetry. Every event retains:

- `eventId`
- `eventType`
- `causationId`
- `correlationId`
- `turnId`
- `taskId`
- source revisions
- world revision
- scene revision
- sequence/time
- dedupe key
- bounded payload summary

The UI defines no canonical Event Registry.

## Integration seam

The intended later integrated construction is:

```text
real WorkerDirector
   | snapshot()
   | ledger.list()
   | telemetry sink subscription
   | EventSpine.subscribe()
   v
small Runtime bridge
   v
RuntimeWave1UIAdapter
   v
existing UI.Core Runtime workspace
```

The adapter never calls scheduler, lifecycle, resource governor, batch, ledger mutation or worker execution methods.

## Known integration limitation

The accepted Runtime `RuntimeTelemetry` object accepts a sink at Worker Director construction time rather than exposing a later `subscribe()` method. Therefore the integrated host must fan the configured telemetry sink into the UI bridge. Wave 4 intentionally does not modify Runtime to add UI-specific subscription ownership.

#33 remains open until Runtime and UI coexist on an integrated branch and this bridge is proven end-to-end.
