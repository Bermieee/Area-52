# Area-52 Sidecar / Cognitive Coprocessor Reference Documentation

**Owner lane:** `Development-Sidecar/Jev`  
**Integration lane:** `Development-Nexus`  
**Purpose:** preserve the external documentation and architectural implications used to design the Area-52 cognitive coprocessor layer.

---

## 1. Dapr Pub/Sub

Official docs:
- https://docs.dapr.io/developing-applications/building-blocks/pubsub/
- https://docs.dapr.io/developing-applications/building-blocks/pubsub/pubsub-overview/

Relevant behavior:
- publish/subscribe is decoupled and topic-based;
- one publisher can feed multiple subscribers;
- Dapr advertises **at-least-once delivery**;
- redelivery is expected after failures;
- broker implementation is pluggable;
- dead-letter handling and routing are available;
- Dapr uses CloudEvents envelopes by default for pub/sub.

### Area-52 implication

At-least-once delivery means every cognitive consumer must be safe under duplicate delivery.

Required Area-52 protections:
- event ID;
- correlation/turn ID;
- dedupe key;
- idempotent worker behavior where possible;
- Work Ledger acceptance record;
- freshness checks before publication/settlement.

Dapr Pub/Sub is a **fan-out mechanism**, not the Gather Coordinator.

---

## 2. Dapr Workflow — fan-out/fan-in

Official docs:
- https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-patterns/
- https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-features-concepts/
- https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-architecture/
- https://docs.dapr.io/developing-applications/building-blocks/workflow/

Relevant behavior:
- multiple activities may execute concurrently;
- fan-out width may be static or dynamic;
- workflow can aggregate parallel results;
- concurrency can be bounded;
- workflow execution is durable;
- completed activities are not needlessly repeated after recovery;
- workflow state is reconstructed by event-history replay;
- workflow code therefore must remain deterministic across replay;
- child workflows and retry policies are available;
- inputs/outputs and high fan-out affect workflow-history/state-store size.

### Area-52 implication

Dapr Workflow maps strongly to:
- Turn Event fan-out;
- dynamic sidecar swarm;
- foreground quorum/gather orchestration;
- durable background batches;
- restart recovery.

But Area-52 must test:
- local overhead;
- Node/Python interoperability;
- workflow-history growth;
- payload size;
- deterministic replay constraints;
- compatibility with Area-52's cooperative yield/resume model.

Area-52 should prefer compact artifact references over giant workflow payloads.

---

## 3. CloudEvents

Official specification:
- https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md
- https://github.com/cloudevents/spec/blob/main/cloudevents/formats/cloudevents.json

Core required CloudEvents attributes include:
- `id`;
- `source`;
- `specversion`;
- `type`.

CloudEvents defines a vendor-neutral event envelope intended to improve interoperability between producers, consumers, routers and infrastructure.

### Area-52 mapping

Area-52's Turn Correlation Envelope should be able to map onto CloudEvents:

```text
CloudEvents id          <- eventId
CloudEvents source      <- area52 subsystem/producer URI
CloudEvents type        <- area52.turn.received / state.settled / etc.
CloudEvents specversion <- 1.0
CloudEvents subject     <- turnId/entity/task where useful
CloudEvents time        <- createdAt

Area-52 extensions:
turnId
causationId
correlationId
taskId
sceneRevision
worldRevision
sourceRevisionSet
characterStateRevision
cognitiveLayer
deadline
requiredCapabilities
dedupeKey
deliveryAttempt
```

CloudEvents interoperability is useful; Area-52's cognitive semantics remain canonical.

---

## 4. Apache Arrow IPC / Flight

Official docs:
- https://arrow.apache.org/docs/
- https://arrow.apache.org/docs/format/Intro.html
- https://arrow.apache.org/docs/cpp/ipc.html
- https://arrow.apache.org/docs/format/Flight.html
- https://arrow.apache.org/docs/format/DissociatedIPC.html

Relevant behavior:
- Arrow defines a language-independent columnar memory format;
- Arrow IPC is the standard mechanism for interprocess/network sharing of Arrow data;
- same-process zero-copy sharing is associated with the Arrow C Data Interface;
- memory-mapped or compatible IPC sources may support zero-copy reads;
- Flight is a high-performance RPC layer built on gRPC and Arrow IPC;
- Flight reduces avoidable copy/serialization overhead but is still RPC;
- Dissociated IPC explores shared/device-memory transports and is currently experimental.

### Area-52 implication

Do **not** design around the claim that Arrow Flight passes raw RAM pointers between arbitrary processes.

Instead:
1. keep data with the owning subsystem;
2. move compact artifact IDs/revisions through the Result/Event Bus;
3. fetch only required slices;
4. benchmark Arrow IPC/Flight, memory mapping, local sockets, shared memory and ZeroMQ only if profiling shows data transport is material.

---

## 5. SillyTavern extension hooks

Official docs:
- https://docs.sillytavern.app/for-contributors/writing-extensions/

Relevant hooks/events:
- `generate_interceptor`;
- `MESSAGE_SENT`;
- `MESSAGE_RECEIVED`;
- `GENERATION_STARTED`;
- `GENERATION_STOPPED`;
- `GENERATION_ENDED`;
- `STREAM_TOKEN_RECEIVED`.

Prompt interceptors may asynchronously modify prompt/chat data or abort a generation request.

### Area-52 implication

These hooks provide candidate integration points for:
- Turn Event creation;
- foreground Context Seal publication;
- generation start/end resource-mode transitions;
- post-turn lifecycle;
- streaming truth monitoring.

A streaming truth system should buffer enough output to form claims/clauses before validation instead of evaluating isolated tokens.

---

## 6. Structured sidecar outputs

References already captured in:
- `docs/REFERENCE_RESEARCH_MAP.md`

Primary patterns:
- DSPy Signatures — declarative typed LM task interfaces;
- Instructor/Pydantic — schema validation and structured-output retry.

### Area-52 implication

Canonical contracts remain framework-neutral.

Worker output path:

```text
model/provider output
 -> parse
 -> schema/type validation
 -> deterministic semantic validation
 -> optional bounded semantic reconciliation
 -> typed Result Bus object
```

Malformed model output never becomes canonical-ready state.

---

## 7. Parallel turn execution rule

One Send action creates one immutable Turn Event.

```text
TURN_EVENT
  |
  +-> Historian
  +-> Graph Walker
  +-> Character Green Room
  +-> Truth / Precision
  +-> optional external grounding
  +-> other turn-selected capabilities
  |
  v
GATHER COORDINATOR
  |
  v
CONTEXT COMPILER
  |
  v
CONTEXT SEAL
  |
  v
MAIN
```

The Gather Coordinator does not blindly wait for every worker.

Worker results are classified:
- REQUIRED;
- OPPORTUNISTIC;
- DEFERRED.

Foreground completes when the required quorum/fallback policy is satisfied or the hard deadline is reached.

Late results are rerouted to future/background cognition.

---

## 8. Background/foreground relationship

Generation does not stop Area-52 lifecycle state.

```text
generation starts
 -> background workers receive cooperative yield request
 -> current atomic batch slice completes
 -> checkpoint
 -> worker parks
 -> foreground reclaims reserved resources

generation ends
 -> post-turn Nearline work begins
 -> parked Deep work resumes
```

Sidecars participate in the same L0-L4 runtime classes and mandatory batch contract as every other Area-52 cognitive subsystem.

---

## 9. Architecture decisions to benchmark, not assume

The following remain empirical decisions:

- native Event Spine vs Dapr Pub/Sub;
- native Work Ledger/Gather vs Dapr Workflow;
- Qdrant vs Milvus;
- FlashRank vs ColBERTv2 vs combined precision stack;
- native artifact-reference data plane vs Arrow/local IPC;
- local CPU model vs remote sidecar model for Green Room;
- stream Observe vs Verified Chunks vs Hard Intercept;
- number of concurrent foreground workers;
- deadline/quorum timing;
- warm-packet prediction horizon.

All choices must be made against Area-52 golden-world, latency, recovery and long-session benchmarks.
