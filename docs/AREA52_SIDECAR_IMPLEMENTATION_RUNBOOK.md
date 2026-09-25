# Area-52 Cognitive Coprocessor Implementation Runbook

**Owner branch:** `Development-Sidecar/Jev`  
**Integration branch:** `Development-Nexus`  
**Epic:** #75  
**Architecture:** `docs/AREA52_COGNITIVE_COPROCESSOR_BLUEPRINT.md`  
**References:** `docs/AREA52_SIDECAR_REFERENCE_DOCUMENTATION.md`

---

# 1. Objective

Build the first production-quality Area-52 cognitive coprocessor fabric around the principle:

> **One keypress may wake many sidecars, but the Main path waits only for the bounded foreground quorum.**

Sidecars are capability workers. They do not own canonical truth.

---

# 2. First executable target: One-Key Swarm

The first end-to-end sidecar test should use one deterministic user turn and four parallel worker roles.

### Worker A — Historian
Returns relevant lore/episode candidates.

### Worker B — Graph Walker
Returns current entity/location/item state.

### Worker C — Green Room
Returns scene-scoped inferred character state.

### Worker D — Precision/Truth
Scores or classifies ambiguous candidate evidence.

The first implementation may use mock deterministic workers. The objective is to prove orchestration before optimizing models.

---

# 3. Required execution path

```text
User Send
 -> Turn Event created
 -> Dynamic Fan-Out Plan
 -> fan out worker tasks concurrently
 -> worker results return independently
 -> correlation/freshness validation
 -> Gather Coordinator
 -> foreground quorum satisfied
 -> structured compiler input bundle
 -> Context Compiler
 -> Context Seal
 -> Main
 -> late results routed to background/future use
```

---

# 4. Phase S0 — contracts

Complete before provider-specific work.

Required:
- #76 Structured Worker Contract
- #91 Turn Correlation Envelope
- #94 foreground result classes/deadlines
- #95 Gather Compiler input contract
- link to #1 canonical cognitive contracts
- link to #18 mandatory batch contract
- link to #25 Context Seal

### Gate S0

PASS when mock workers can produce schema-valid typed results and duplicates/stale results are deterministically identified.

---

# 5. Phase S1 — native fan-out/gather prototype

Implement minimal:
- #89 Turn Event Hub
- #90 Gather Coordinator
- #93 Dynamic Fan-Out Planner

Use an in-process/native implementation first unless the Dapr benchmark is explicitly chosen to run in parallel.

### Gate S1

PASS when:
- one Turn Event wakes at least four mock workers concurrently;
- one worker may fail without cancelling the others;
- results are correlated to the correct turn;
- REQUIRED/OPPORTUNISTIC/DEFERRED handling works;
- Gather closes on deadline/quorum;
- late results cannot cross Context Seal;
- duplicates are harmless.

---

# 6. Phase S2 — Runtime Fabric integration

Integrate:
- #83 sidecar Batch Adapter;
- #88 Hot vs Deep placement;
- #85 failure/fallback;
- #20 Work Ledger;
- #21 cooperative yield/resume;
- #22 Capability Registry;
- #19 Resource Governor.

### Gate S2

PASS when:
- Deep sidecar work yields at safe batch boundaries during generation;
- Hot sidecar workers retain reserved execution capacity;
- parked work resumes without replaying committed slices;
- task routing is capability-driven, not SC-A/SC-B hard-coded.

---

# 7. Phase S3 — real cognitive workers

Bring workers online independently.

Recommended order:

1. Historian / retrieval adapter.
2. Graph Walker.
3. Precision reranker.
4. Green Room.
5. Speculative Context Warmer.
6. Consolidation worker.
7. Streaming Truth Monitor.

Each worker must have:
- typed input/output;
- batch strategy if applicable;
- fallback;
- freshness policy;
- benchmark;
- provenance behavior;
- cognitive layer classification.

---

# 8. Phase S4 — speculative prefetch

Implement #77.

Benchmark:
- prediction hit rate;
- percentage of foreground retrieval skipped;
- foreground latency saved;
- stale packet discard rate;
- partial packet salvage rate;
- wasted prediction cost.

Do not claim zero latency. Measure actual foreground savings.

---

# 9. Phase S5 — Character Green Room

Implement #78.

Start with batched active-cast inference.

Must remain:
- INFERRED;
- scene-scoped;
- evidence-backed;
- expiring;
- non-canonical.

Benchmark false persistence and emotional-state consistency.

---

# 10. Phase S6 — continuous consolidation

Implement #79.

Never destructively replace raw narrative evidence.

Derive:
- episodes;
- summaries;
- claims;
- relationships;
- state proposals;
- reflection support;
- compact representations.

Run as Deep/Background batched work with yield/resume.

---

# 11. Phase S7 — streaming truth

Implement #80 progressively.

### Stage A
Observe-only claim logging.

### Stage B
Verified chunk buffering.

### Stage C
Optional hard intercept for deterministic, high-confidence canon violations only.

Do not let uncertain semantic disagreement turn into aggressive generation interruption.

---

# 12. Phase S8 — Dapr benchmark

Issue #92.

Prototype the same One-Key Swarm with:
- Dapr Pub/Sub fan-out;
- Dapr Workflow fan-out/fan-in where applicable.

Measure:
- publish-to-worker latency;
- total gather latency;
- restart recovery;
- duplicate/redelivery handling;
- workflow-history growth;
- CPU/RAM overhead;
- installation complexity;
- Python/Node interoperability;
- concurrency controls;
- artifact-reference payload strategy.

### Decision

Choose native, Dapr, or hybrid based on data.

Dapr adoption is not a prerequisite for the architecture.

---

# 13. Phase S9 — Cognitive Data Plane

Issue #81.

Default to compact artifact references first.

Only benchmark heavy IPC alternatives if profiling demonstrates serialization/copy overhead is meaningful.

Potential tests:
- plain JSON baseline;
- binary/compact serialization;
- Arrow IPC;
- memory mapped Arrow;
- Unix/local sockets;
- ZeroMQ;
- shared memory where safe.

Measure real cost before adding operational complexity.

---

# 14. Phase S10 — sidecar evaluation

Issue #87.

Minimum metrics:
- fan-out start skew;
- slowest REQUIRED worker;
- foreground quorum latency;
- full swarm completion latency;
- warm hit rate;
- stale result rejection;
- duplicate delivery tolerance;
- yield-to-park latency;
- resume latency;
- structured-output validity;
- fallback rate;
- CPU/RAM;
- LLM token cost;
- context-quality impact.

---

# 15. First acceptance scenario

Use the Area-52 Ember Tavern / Sun Blade golden world.

Turn:
> Eris returns to the ruined Ember Tavern looking for the Sun Blade while speaking to Mara.

Expected fan-out:

### Historian
Retrieves prior Eris/Sun Blade/Tavern events.

### Graph Walker
Returns:
- Tavern destroyed CURRENT;
- Sun Blade current location/fate UNRESOLVED / unknown;
- Eris-left/carried-Sun-Blade evidence remains HISTORICAL where applicable;
- conflicting credible evidence ("destroyed in fire" vs "removed before fire") remains explicit.

### Green Room
May return a mock inferred scene-state packet, explicitly non-canonical.

### Truth/Precision
Ensures historical “Blade was at Tavern / Eris carried the Blade” evidence is not admitted as current and that unresolved fate remains unresolved.

### Gather
Closes when REQUIRED world-state/retrieval results are ready.

### Compiler
Produces current truth plus relevant history without stale possession claims.

### Late-result test
Artificially delay Green Room until after Context Seal. The turn must still generate, and Green Room result must be routed to future/background use only.

This scenario proves the essential Area-52 sidecar architecture.

---

# 16. Definition of Done for a sidecar worker

A worker is not complete until it defines:

1. capability profile;
2. cognitive layer;
3. input schema;
4. output schema;
5. batch behavior;
6. provenance;
7. freshness identity;
8. deadline/result class;
9. fallback;
10. idempotence/dedupe behavior;
11. safe yield behavior;
12. cache behavior;
13. telemetry;
14. benchmark coverage;
15. authority boundary.

---

# 17. Non-negotiable rules

1. One Turn Event can fan out to many workers.
2. Dynamic planning decides which workers wake.
3. Fan-out is parallel by default.
4. Gather does not blindly wait for all workers.
5. REQUIRED, OPPORTUNISTIC and DEFERRED are explicit.
6. Late results cannot mutate sealed context.
7. At-least-once delivery requires idempotence and dedupe.
8. All large work is batched.
9. Deep workers yield and resume.
10. Models propose; owners settle.
11. Result synthesis preserves disagreement and provenance.
12. Sidecar/model identity is replaceable behind capability contracts.
13. Infrastructure is benchmarked before adoption.


---

# 18. Wave 1 executable status

Implemented native deterministic phases:

- S0 contracts: implemented and tested;
- S1 fan-out/gather prototype: implemented and tested;
- provider/model-specific production workers: deferred;
- Dapr: not adopted;
- data-plane optimization: deferred.

The Wave 1 fixture deliberately delays Green Room to 220ms while REQUIRED Historian, Graph Walker and Truth/Precision complete at 32ms, 41ms and 57ms. Foreground closes at 57ms; the later Green Room result routes forward and cannot alter the sealed packet.

The deterministic stress fixture executes 2,100 planned worker tasks across 525 turns with duplicate Turn Events, duplicate results, stale/future revisions, worker omissions/failures, deterministic fallback and bounded gather retention.

---

# 19. Wave 6 production cognition record

Wave 6 completes the Coprocessor implementation work for runbook phases S5 (Character Green Room) and the Sidecar-worker portion of S6 (Continuous Consolidation).

## S5 Character Green Room — production path

Canonical path:

\`\`\`text
active Scene cast + bounded evidence refs
 -> createGreenRoomTask
 -> createGreenRoomProviderInput
 -> SpecialistExecutionLayer
 -> validateGreenRoomProviderOutput
 -> GreenRoomStore
 -> projectGreenRoomForGeneration
\`\`\`

Compatibility:
- old \`foreground-specialists.js\` Green Room APIs remain supported;
- they delegate to the canonical \`green-room.js\` path;
- legacy \`characterId\` is an alias for canonical \`characterRef\`.

Gate:
- batched active cast;
- INFERRED only;
- bounded evidence;
- deterministic expiry/invalidation;
- anti-self-reinforcing support identity;
- Reflection proposal seam;
- generation projection;
- safe OPPORTUNISTIC degradation;
- post-Seal containment.

## S6 Continuous Consolidation — Sidecar worker complete

Canonical path:

\`\`\`text
ArtifactReferences + bounded slices
 -> ConsolidationUnit
 -> createConsolidationTask
 -> SpecialistExecutionLayer
 -> validateConsolidationProviderOutput
 -> ConsolidationProposalBundle
 -> dedupe / checkpoint
 -> MemoryConsolidationProposalHandoff
\`\`\`

The Coprocessor side is complete, but full #79 remains dependent on the Memory owner for real admission/persistence.

Runtime boundary:
- Coprocessor defines cognitive task, proposal validation and checkpoint contents;
- Runtime owns actual queueing, scheduling, preemption, Resource Governor and Work Ledger.

Memory boundary:
- Coprocessor emits proposals and handoff metadata;
- Memory owns durable Experience/Memory, Temporal State, Reflection admission and reconsolidation.

## Wave 6 validation fixture

Functional checkpoint \`ce23d605f85b59677635d6f5257df266912271f3\`, Wave 6 Actions run \`35975330036\`:
- full regression: 280/280;
- Green Room focused: 13/13;
- Consolidation focused: 18/18;
- Character + Consolidation + combined HOT/DEEP goldens: 3/3;
- historical stress: 15/15;
- Wave 5 pressure regression: PASS;
- Wave 6 cognition stress: PASS;
- browser-like Wave 6: 2/2;
- syntax: PASS;
- ESM import: PASS.

Wave 6 focused stress:
- 2,000 Green Room batch validations;
- 500 Green Room expiry sequences;
- 500 contradiction/source-revision cases;
- 1,500 consolidation units;
- 3,000 proposal validations;
- 500 dedupe/replay cases;
- 500 stale/superseded cases;
- 250 checkpoint/resume cycles;
- one 5,000-update Green Room bounded-growth replay;
- one 5,000-unit Consolidation backlog bounded-growth replay.

Observed final bounds in long replay:
- Green Room: 24 active / 64 history;
- Consolidation backlog: 128 stored / 128 pending.

These are subsystem qualification results, not FT005 or FT006.

---

# 20. Wave 7 Historian / adaptive retrieval production record

Canonical Historian: `src/coprocessor/historian-retrieval.js`.

Canonical adaptive controller remains `src/coprocessor/retrieval-control-policy.js`, deepened in place.

Wave 7 completes Worker 2's Coprocessor execution/control side of #205 and #49 while leaving Memory, Scene intent planning, Candidate Bus ownership and Graph Walker core with their owning lanes.

Functional checkpoint `6025a488808c29242eb79b6392a0a9f241798ffe`, Actions run `35981298068`, is GREEN:
- full regression 337/337;
- Historian 21/21;
- adaptive retrieval 18/18;
- goldens 6/6;
- authority negatives 11/11;
- stress PASS;
- browser/syntax/ESM PASS.

Maximum foreground correction passes remain 1.

