# Area-52 Cognitive Coprocessor / Sidecar Blueprint

**Owner branch:** `Development-Sidecar/Jev`  
**Integration branch:** `Development-Nexus`  
**Parent epic:** #75

---

## 1. Core idea

Area-52 sidecars are **cognitive coprocessors**, not fixed identities like SC-A or SC-B.

A sidecar execution slot may host a worker specialized for:

- retrieval;
- graph traversal;
- emotional/intent shadowing;
- semantic judgment;
- reranking;
- reflection;
- consolidation;
- embedding;
- streaming truth verification;
- compression;
- external grounding.

The runtime chooses a worker from declared capabilities rather than hard-coding one task to one sidecar name.

---

## 2. One keypress, many sidecars

One user Send action creates one immutable `TURN_EVENT`.

```text
USER SEND
   |
   v
TURN_EVENT
   |
   +----------------+----------------+----------------+----------------+
   |                |                |                |                |
   v                v                v                v                v
Historian      Graph Walker       Green Room       Truth/Rank      Other worker
retrieval      current state      affect/intent    precision       if valuable
   |                |                |                |                |
   +----------------+----------------+----------------+----------------+
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

The workers execute independently and concurrently.

---

## 3. Fan-out planning

Area-52 does **not** wake every worker on every turn.

A Dynamic Fan-Out Planner uses:

- scene entities;
- retrieval intents;
- current location;
- active threads;
- cache warmth;
- current world revision;
- available worker capabilities;
- latency/cost budget;
- expected value of the worker result.

Examples:

### Dialogue-heavy turn
- continuity retrieval;
- Character Green Room;
- maybe no graph traversal.

### Physical-state / inventory action
- graph walker;
- Historian;
- Truth worker.

### Simple acknowledgement
- Hot Cognition only;
- possibly zero model sidecars.

The design goal is:

> One key may wake many sidecars, but only sidecars with expected value.

---

## 4. Turn correlation envelope

Every fan-out event/result is correlated to the originating turn.

Required fields:

- turnId;
- eventId;
- causationId;
- correlationId;
- eventType;
- taskId;
- sceneRevision;
- worldRevision;
- sourceRevisionSet;
- characterStateRevision;
- cognitiveLayer;
- createdAt;
- deadline;
- requiredCapabilities;
- dedupeKey;
- deliveryAttempt.

The contract should map cleanly onto CloudEvents-style envelopes without requiring Dapr internally.

---

## 5. At-least-once means idempotence

Any event transport with at-least-once delivery can redeliver.

Therefore:

- every worker operation is idempotent where possible;
- every event/result has a dedupe key;
- the Work Ledger records accepted/completed work;
- duplicate delivery never causes duplicate canonical mutation;
- settlement remains separately revision/freshness fenced.

---

## 6. Result classes

Sidecar work is classified before execution.

### REQUIRED
Needed for the current context path.

If missing at deadline, use a deterministic fallback or defined degraded behavior.

### OPPORTUNISTIC
Useful if ready before Context Seal.

If late, it does not block generation.

### DEFERRED
Never blocks current generation.

Feeds:

- next-turn warm state;
- Nearline cognition;
- Deep cognition;
- evaluation;
- caches.

This prevents parallel fan-out from degenerating into “wait for the slowest worker.”

---

## 7. Gather Coordinator

The Gather Coordinator is primarily deterministic orchestration.

Responsibilities:

1. collect results sharing a turn/correlation ID;
2. validate source/world/scene freshness;
3. reject or quarantine stale results;
4. dedupe overlapping evidence;
5. preserve disagreement/uncertainty;
6. determine whether foreground quorum is satisfied;
7. pass normalized structured lanes to Context Compiler;
8. close the foreground gather at deadline;
9. reroute late results to future/background cognition.

Gather does **not** become an authority-bearing synthesizer LLM.

---

## 8. Gather input lanes

The Context Compiler receives structured lanes:

- lore/evidence candidates;
- graph/current-world state;
- Character Green Room state;
- Truth Gate classifications;
- rerank/precision scores;
- retrieval confidence;
- optional external grounding;
- provenance;
- freshness metadata.

This preserves source identity and disagreement through compilation.

---

## 9. Context Seal

Generation-facing sidecar results have a hard publication boundary.

```text
Fan-out
 -> Gather
 -> validate
 -> Compiler
 -> CONTEXT SEAL
 -> Main generation
```

Before seal:
- fresh REQUIRED/OPPORTUNISTIC results may contribute.

After seal:
- results cannot alter the active context;
- they may warm next-turn state;
- feed Nearline/Deep cognition;
- update non-canonical evaluation/cache state.

---

## 10. Cognitive coprocessor roles

### Historian
Hybrid lore/episode retrieval.

### Graph Walker
Current-state and relationship traversal.

### Green Room
Ephemeral inferred affect/intent state for active characters.

### Truth Worker
Ambiguous contradiction/relevance judgment when deterministic checks are insufficient.

### Precision Worker
ColBERT/FlashRank/cross-encoder-style reranking.

### Study Worker
Lore understanding, claims, ontology and hierarchy extraction.

### Reflection Worker
Higher-order pattern synthesis.

### Consolidation Worker
Experience -> episodes/summaries/claims/long-term representations.

### Embedding Worker
Dense/sparse/late-interaction indexing.

### Streaming Truth Monitor
Clause/sentence-level generated-claim verification.

### External Grounding Worker
Optional external API/web factual grounding when enabled and relevant.

---

## 11. Speculative Context Warmer

Predict likely next-turn intents before Send.

Pipeline:

```text
scene prediction
 -> retrieval intents
 -> sparse+dense retrieval
 -> graph expansion
 -> Truth Gate
 -> precision rerank
 -> compile
 -> WARM PACKET
```

Warm packet keys include:

- scene revision;
- world revision;
- character-state revision;
- source revisions;
- intent fingerprint.

Fresh packets are reusable. Partially stale packets may salvage candidates. Fully stale packets are discarded.

---

## 12. Character Green Room

Green Room state is:

- inferred;
- scene-scoped;
- evidence-backed;
- expiring;
- non-canonical.

Example dimensions may include:

- guardedness;
- warmth;
- anger;
- trust trend;
- anxiety;
- latent intent.

Multiple active characters should be processed in a single batch by default.

Repeated Green Room evidence may support a Reflection proposal but does not directly mutate Character State.

---

## 13. Continuous Memory Consolidation

While the user reads/types, Deep cognition derives:

- episodes;
- summaries;
- claims;
- relationships;
- state-change proposals;
- reflection evidence;
- compact representations.

Raw source turns remain recoverable.

Area-52 reduces active prompt pressure by changing what Context Compiler selects, not by destructively replacing source history.

---

## 14. Streaming Truth Monitor

Do not validate isolated tokens.

Pipeline:

```text
stream tokens
 -> clause/sentence buffer
 -> entity/claim extraction
 -> deterministic graph/state check
 -> optional semantic verifier
 -> violation class
```

Modes:

1. **Observe** — log-only.
2. **Verified chunks** — buffer/check/release.
3. **Hard intercept** — opt-in and reserved for deterministic high-confidence canon violations.

Soft uncertainty never automatically aborts creative generation.

---

## 15. Cognitive Data Plane

Avoid sending giant JSON blobs between workers.

Default:

- data stays with its owning store;
- workers pass artifact IDs/revisions/references;
- consumers request only required slices.

Benchmark later:

- in-process references;
- Arrow IPC/record batches;
- local sockets;
- shared memory/memory mapping;
- ZeroMQ;
- other local IPC.

Do not assume Arrow Flight provides direct cross-process RAM-pointer sharing.

---

## 16. Batch integration

Every large sidecar operation uses the common Batch Engine:

```text
prepare
 -> execute slice
 -> validate
 -> checkpoint/commit
 -> safe yield
 -> next slice
```

Applies to:

- lore study;
- Green Room cast batches;
- reflection sweeps;
- embeddings;
- graph extraction;
- consolidation;
- large candidate evaluation;
- summaries.

---

## 17. Hot vs Deep coprocessors

### Hot
Generation-adjacent:
- warm-packet validation;
- Green Room for active cast;
- precision rerank;
- bounded Truth judgment;
- stream monitor.

### Deep
Opportunistic:
- lore study;
- consolidation;
- reflection;
- ontology;
- graph enrichment;
- cold embeddings;
- compression maintenance.

Hot cognition receives reserved capacity.

Deep cognition borrows idle capacity and yields cooperatively during generation.

---

## 18. Failure model

Every coprocessor has explicit fallback.

Examples:

- predictive warmer stale/down -> normal foreground retrieval;
- reranker down -> deterministic fused rank;
- Green Room down -> Main infers normally;
- verifier down -> ambiguity stays unresolved;
- consolidation down -> raw source remains intact;
- stream monitor down -> generation continues unverified;
- provider timeout -> task-specific fallback/retry.

A sidecar failure must not corrupt canonical state or prevent safe degradation.

---

## 19. Dapr reference / benchmark

Dapr is a candidate reference/runtime for:

- Pub/Sub fan-out;
- CloudEvents-compatible envelopes;
- dynamic routing/subscriptions;
- at-least-once delivery;
- durable Workflow fan-out/fan-in;
- crash/restart continuation;
- concurrency control.

Important distinction:

- Pub/Sub performs broadcast/fan-out.
- Workflow or an Area-52 coordinator performs fan-in/gather/aggregation.

Dapr is not automatically adopted. Benchmark it against the native Event Spine + Work Ledger for:

- local latency;
- process overhead;
- installation complexity;
- Node/Python interop;
- durability;
- restart behavior;
- dynamic fan-out;
- batch/yield compatibility;
- observability.

---

## 20. Work items

Primary epic: #75

- #76 Structured Worker Contract
- #77 Speculative Context Warmer
- #78 Character Green Room
- #79 Continuous Memory Consolidation
- #80 Streaming Truth Monitor
- #81 Cognitive Data Plane
- #82 Capability Profiles/model routing
- #83 Sidecar Batch Adapter
- #84 Foreground freshness/Context Seal
- #85 Failure/fallback containment
- #86 Coprocessor telemetry
- #87 Coprocessor benchmark harness
- #88 Hot vs Deep placement
- #89 Turn Event Hub
- #90 Turn Gather Coordinator
- #91 Correlation Envelope/CloudEvents
- #92 Dapr fan-out/fan-in benchmark
- #93 Dynamic Fan-Out Planner
- #94 Foreground quorum/deadline policy
- #95 Parallel Gather Compiler contract

---

## 21. Primary invariant

> **One keypress may wake many sidecars, but the Main path waits only for the bounded foreground quorum.**

Sidecars are specialized cognitive coprocessors. The runtime fans work out in parallel, gathers only what is fresh and useful before Context Seal, and lets late/deep cognition continue without blocking the user.


---

## 22. Wave 9 Core Cognitive Choice Controller

`Development-Nexus` owns the deterministic Core half of the per-turn cognitive-choice path.

The controller answers one bounded question:

> Given the current turn, Hot Cognition, revision fences, capability availability, and retrieval outcome, which cognitive work is worth executing and which validated evidence may continue toward Gather / Context Compiler / Context Seal?

It is **not** a canon authority, another Truth Gate, another Candidate Bus, another scheduler, or another Jev engine.

### 22.1 Canonical per-turn path

```text
TURN_EVENT
  -> Hot Cognition sufficiency check
  -> candidate cognitive jobs
  -> admit / skip / defer
  -> Sensory Net + Candidate Bus when retrieval is required
  -> retrieval quality
       HIGH  -> Truth -> Precision only when useful
       MIXED -> exactly one corrective retrieval -> reevaluate
       LOW   -> abstain from weak long-term-memory evidence
  -> bounded ambiguity check
       -> Jev seam only when explicit unresolved alternatives remain
       -> preserve UNRESOLVED when Jev is unavailable/abstains
  -> Gather
  -> Context Compiler
  -> Context Seal
```

Hot-only turns do not perform fake retrieval to create activity. Skipping work and abstaining are successful bounded outcomes.

### 22.2 `CognitiveChoiceReceipt`

Each sealed turn exposes one revision-fenced structured receipt containing:

- turn/correlation identity and turn revision;
- considered, admitted, skipped, and deferred logical cognition jobs;
- deterministic reason codes;
- retrieval intents;
- Sensory channels requested and actually used;
- Candidate Bus nomination/normalization/dedupe counts;
- retrieval quality and corrective-retrieval state;
- Truth outcome counts;
- Jev consideration/invocation/unavailable/abstention state;
- Precision consideration/invocation/fallback state;
- final generation-facing evidence references;
- abstention/unresolved state;
- latency/resource budget;
- source/candidate/representation/world/scene revisions;
- freshness/stale/late result state;
- Context Seal publication boundary.

The receipt explains Core routing. It grants no truth, settlement, canonical mutation, or Context Seal bypass authority.

### 22.3 Hot-only admission

Hot-only is intentionally conservative. It requires fresh revision-matching Hot Cognition and an explicitly local/current request that can be answered by the maintained Scene projection. Anchored long-term lookup, historical intent, unknown needs, or stale Hot state force the normal retrieval path.

### 22.4 Adaptive retrieval routing

Core consumes the existing retrieval-quality contract:

- `HIGH` proceeds;
- `MIXED` permits one and only one corrective pass;
- `LOW` removes weak long-term-memory evidence from generation-facing compilation.

Corrective retrieval re-enters the same Candidate Bus / Truth path. It cannot recurse.

### 22.5 Truth, Jev, and Precision boundaries

Truth classifications remain owned by Truth Gate. Retrieval scores, fusion strength, channel count, and recency cannot upgrade truth or authority.

Jev is a bounded integration seam. Core may emit/invoke an explicit-alternatives request, but Jev does not receive canonical mutation authority. Missing or abstaining Jev preserves unresolved evidence.

Precision runs only when the admitted set is broad/redundant or MIXED. A tiny exact set skips it. If required Precision is unavailable, Core uses the deterministic pre-Precision ordering as a safe fallback and records that fallback.

### 22.6 Seal and replay semantics

Context Seal closes the active foreground generation. Late results are routed by the Result Bus and appended only to decision telemetry; they cannot reopen the sealed packet. Stale results remain stale.

Identical publication replay for an already sealed turn returns the sealed result without re-running retrieval, correction, Precision, or Jev. A replay with materially different cognitive-choice inputs is rejected.

### 22.7 Ownership boundaries

Core owns:

- cognitive-choice policy and receipt;
- adaptive retrieval routing;
- Truth/Precision/Jev integration boundaries;
- generation-facing evidence trace;
- Gather/compiler/seal routing semantics.

Core does not own:

- Jev internals;
- Historian, Graph Walker, Green Room, or Scene Intelligence implementations;
- Worker Director scheduling/resource pools;
- UI rendering;
- canonical owner Settlement.

The permanent invariants remain: logical jobs are not physical sidecars; relevance is not truth; Jev is not Settlement; skip and abstention are not failures; revisions fence every decision; and late work cannot mutate sealed context.
