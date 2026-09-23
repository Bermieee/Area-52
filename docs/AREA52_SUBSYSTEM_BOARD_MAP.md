# Area-52 Subsystem Board Map

**Working branch:** `Development-Nexus`  
**Purpose:** canonical mapping between the Area-52 architecture, GitHub work items, development lanes, and external research references.

---

# 1. Brain-level architecture

Area-52 is a hybrid cognitive system.

```text
SOURCE / EXPERIENCE
       |
       v
   STUDY / OBSERVE
       |
       +----------------------------+
       |                            |
       v                            v
EXPERIENCE / MEMORY            LEARNED WORLD MODEL
       |                      graph / hierarchy / claims
       v                            |
   REFLECTION                       |
       \____________________________/
                    |
                    v
               SENSORY NET
                    |
                    v
               TRUTH GATE
                    |
                    v
              PRECISION GATE
                    |
                    v
             CONTEXT COMPILER
                    |
                    v
               CONTEXT SEAL
                    |
                    v
                  MAIN
                    |
                    v
             NEW EXPERIENCE
```

All large or potentially unbounded work executes through the Cognitive Runtime Fabric.

---

# 2. Cognitive Runtime Fabric

Umbrella: GitHub #11.

## Lifecycle Core — #16

Lifecycle determines **what cognitive work exists**.

It does not ask whether a worker is free. It records obligations truthfully.

Generation cannot erase valid lifecycle obligations.

## Layered Scheduler — #17

Cognitive layers:

- L0 Reflex — immediate deterministic/cheap foreground cognition.
- L1 Assist — bounded generation-adjacent semantic work.
- L2 Nearline — immediate post-turn learning.
- L3 Background — heavy study/learning.
- L4 Sleep — deep maintenance/consolidation.

## Mandatory Batch Engine — #18

Every potentially large operation is sliced:

```text
prepare -> execute -> validate -> commit/checkpoint -> safe yield -> next slice
```

Batching applies to lore study, embeddings, graph work, reflection, consolidation, maintenance, large reranking and relearning.

## Resource Governor — #19

Foreground has reserved capacity.

Background cognition may borrow unused capacity but never owns the machine.

Generation revokes borrowed resources and asks deep workers to yield at safe boundaries.

## Durable Work Ledger — #20

Stores cognitive work identity and progress independently of lifecycle state:

- task ID/type;
- cognitive layer;
- source/world revisions;
- dependencies;
- completed/pending slices;
- dedupe/conflict keys;
- result receipts;
- recovery status.

Completed irreversible work must never silently replay.

## Cooperative Yield / Resume — #21

Background work transitions:

```text
ACTIVE -> YIELDING -> PARKED -> ACTIVE
```

Workers finish their atomic slice, validate/commit it, checkpoint, then park.

Do not kill arbitrary work mid-mutation.

## Capability Registry / Worker Pools — #22

Workers advertise abilities rather than being generic sidecar tubes:

- structured LLM extraction;
- semantic judgment/reasoning;
- CPU reranking;
- vector/embedding;
- graph;
- IO.

Tasks declare required capabilities and resource class.

## Event Spine — #23

Immutable cognitive events include:

- TURN_RECEIVED
- GENERATION_STARTED
- GENERATION_COMPLETED
- SOURCE_CHANGED
- STATE_SETTLED
- SCENE_CHANGED
- REFLECTION_CHANGED
- CACHE_INVALIDATED

Events may create obligations but do not themselves grant canonical mutation authority.

## Result Bus — #24

Typed results route back to owning subsystems.

Results retain:

- provenance;
- input/source revisions;
- fresh/stale result state;
- authority class;
- proposal vs settled state;
- destination owner.

## Context Seal — #25

Foreground pipeline:

```text
Sensory -> Truth -> Precision -> Compiler -> CONTEXT SEAL -> Main
```

Late semantic results may warm the next turn or feed background learning but cannot mutate an already sealed generation context.

## Backpressure / dedupe / supersession — #26

Prevent cognitive queue explosions.

Equivalent work may dedupe/coalesce. Work made stale by later revisions may be superseded before execution. Valid completed work remains preserved.

## Hot Cognition — #27

Continuously maintained working set:

- current scene;
- location;
- active characters/entities;
- active graph neighborhood;
- unresolved threads;
- current state revision;
- continuity/pins;
- recent episode tail.

Generation should start from a warm state.

## Deep Cognition — #28

Opportunistic work:

- lore study;
- reflection;
- ontology;
- graph enrichment;
- hierarchy/community construction;
- consolidation;
- deep contradiction audits;
- cold embedding;
- compression maintenance.

Deep Cognition borrows idle resources and yields to foreground demand.

## Runtime telemetry — #33

Default observability is signal-based:

- started;
- yielding;
- parked;
- resumed;
- completed;
- queue depth;
- utilization;
- borrowed resource amount;
- batch progress;
- late result;
- recovery event.

Expensive snapshots are explicit/on-demand.

---

# 3. Lifecycle systems

## Post-turn / Nearline — #29

After generation completes, bounded L2 work begins:

- event extraction;
- episodic write;
- state-change proposals;
- entity/relation updates;
- incremental indexing;
- reflection eligibility.

The user-facing response is already complete.

## Lore Study lifecycle — #30

New or changed source material creates durable study obligations. Generation pauses execution, not study truth.

## Reflection lifecycle — #31

Cadence creates eligibility, not automatic work or canon.

Reflection runs when meaningful evidence, contradiction, transition or consolidation need exists.

## Maintenance / Sleep — #32

Long-idle L4 work covers index health, graph cleanup, deep contradiction audits, hierarchy refinement, cache maintenance and consolidation.

---

# 4. Lore-learning systems

Parent: #4.

## Source Registry / provenance — #3, #47

Source stays independently recoverable.

W3C PROV patterns inform derivation:

- Entity -> source/derived artifact
- Activity -> extraction/study/reflection/settlement
- Agent -> operator/model/worker/subsystem
- wasDerivedFrom / wasGeneratedBy / used -> provenance relationships

LlamaIndex document-management patterns inform stable IDs, revisions, refresh and transformation caching.

## Contextual retrieval representation — #56

Original lore remains immutable.

Derived sparse/dense retrieval text may add entity/topic/timeline context so ambiguous chunks remain meaningful after splitting.

## Ontology / hierarchy learning — #36

The world teaches its own schema rather than Area-52 imposing one universal RP taxonomy.

## RAPTOR / GraphRAG — #48

Research-backed patterns:

- recursive clustering;
- multi-resolution summaries;
- entities/relationships/claims;
- community detection;
- community summaries;
- Local/Global/DRIFT-like retrieval.

GraphRAG/RAPTOR teach corpus structure. They do not own temporal current truth.

---

# 5. Temporal world model

Parent: #5.

## Graphiti reference — #40

High-priority temporal-state benchmark because it already demonstrates:

- incremental graph updates;
- temporal validity;
- episode provenance;
- historical queries;
- ontology;
- hybrid semantic/keyword/graph retrieval.

Area-52 retains its own settlement and authority rules.

## Temporal semantics

The model distinguishes:

- CURRENT;
- HISTORICAL;
- SUPERSEDED;
- CONTRADICTED;
- UNCERTAIN;
- UNRESOLVED.

State change does not erase history.

---

# 6. Sensory / retrieval systems

Parent: #6.

## Scene Query Planner — #35

Decompose a scene into bounded retrieval intents:

- active entities;
- location;
- relationships;
- active threat;
- item provenance;
- unresolved threads;
- relevant event/history.

## Candidate Bus

All retrievers normalize into a common candidate contract. No retriever owns final admission.

## Retrieval channels

- sparse/BM25;
- dense vectors;
- late interaction;
- graph neighborhood;
- hierarchy/community;
- episodes;
- reflections;
- specialized semantic stores;
- continuity/pins.

## Qdrant vs Milvus — #41

Benchmark hybrid dense/sparse/multi-vector retrieval rather than choosing infrastructure first.

---

# 7. Truth / corrective retrieval / precision

Parents: #7 and #8.

## CRAG / Self-RAG patterns — #49

Retrieval quality is evaluated rather than assumed.

```text
HIGH  -> proceed
MIXED -> bounded corrective retrieval
LOW   -> allow no long-term memory
```

Area-52 adopts adaptive retrieve-or-not behavior without requiring a specially trained Main model.

## Precision stack — #42

Benchmark:

- ColBERTv2-style token late interaction;
- FlashRank CPU-friendly cross-encoders;
- optional bounded second semantic judge.

Broad recall precedes expensive precision.

---

# 8. Reflection / memory systems

Parent: #9.

## Generative Agents / Letta patterns — #50

Generative Agents informs:

```text
experience -> higher-order reflection -> later recall
```

Letta/MemGPT informs managed hot vs archival memory tiers.

Area-52 adds explicit:

- temporal truth;
- provenance;
- contradiction;
- confidence dynamics;
- settlement authority;
- specialized memory owners.

## Learning feedback — #39

Retrieval outcomes may tune confidence, nomination policy or caches.

Feedback does not silently rewrite canon.

---

# 9. Context / communication systems

Parent: #10.

## Compiler — #10

Produces a compact, model-independent semantic packet.

Responsibilities:

- dedupe;
- merge compatible claims;
- preserve temporal qualifiers;
- preserve uncertainty;
- order by utility;
- structured sparse representation;
- verbose fallback;
- token estimation.

## LLMLingua-2 benchmark — #43

Compare structured Area-52 packets against programmatic prompt compression.

SPR remains design inspiration, not a correctness guarantee.

## Position/order benchmark — #57

Measure whether critical information placement changes factual use by target model families. Context reduction alone is not enough.

---

# 10. Authority / settlement

## Settlement Engine — #37

Canonical path:

```text
proposal
 -> schema validation
 -> evidence validation
 -> freshness validation
 -> bounded semantic judgment if required
 -> owning subsystem policy
 -> optional human approval
 -> settlement
```

Models propose; owners settle.

## Structured output adapters — #46

DSPy Signatures inform declarative task interfaces.

Instructor/Pydantic informs typed output validation/retry for Python workers.

Canonical Area-52 contracts remain framework/provider-neutral.

Malformed output cannot silently enter canonical state.

---

# 11. Cache / routing / persistence

## Revision-keyed cache — #38

Derived artifacts declare dependencies and invalidators.

Invalidate the smallest truthful dependency cone.

## Semantic Router / GPTCache — #51

Semantic Router informs cheap route selection.

GPTCache informs semantic reuse.

Truth-bearing cache reuse additionally requires canonical source/world revision fences.

## Persistence decision — #12

Choose backend only after cognitive behavior is proven.

Candidate technologies remain replaceable behind contracts.

---

# 12. Durability / orchestration references

## LangGraph durability — #52

Borrow patterns:

- checkpoint boundaries;
- retained successful writes;
- resumable work;
- explicit durability modes;
- pending writes.

LangGraph does not define Area-52 cognition.

## LlamaIndex Workflows / LangGraph benchmark — #53

External orchestration must prove value over the native Event Spine + Work Ledger + Scheduler without forcing an unsuitable Python/runtime boundary.

## Event transport benchmark — #55

Redis Pub/Sub is excluded from durable cognitive work because at-most-once loss is unacceptable.

Benchmark internal Work Ledger/transport, Redis Streams and ZeroMQ where appropriate.

Task identity and checkpoint truth remain Area-52-owned.

---

# 13. Evaluation systems

## Golden-world harness — #2

Deterministic worlds remain the authoritative regression system.

## Ragas / TruLens — #44

Optional adapters for:

- context precision/recall;
- groundedness;
- faithfulness;
- answer relevance.

Area-52 custom metrics remain required for:

- current/historical state;
- supersession;
- contradiction;
- provenance;
- false reflection learning;
- relearning;
- context-packet retention.

## MIPROv2 — #54

Prompt/pipeline optimization is deferred until metrics are frozen.

Optimization cannot trade authority or truth for score.

---

# 14. Shadow integration

Parent: #13.

## Comparison scorer — #45

Nexus remains live authority.

Area-52 runs against the same evidence but its context is log-only.

Compare:

- relevance;
- stale facts;
- missing continuity;
- current-state correctness;
- unresolved-thread coverage;
- next-beat usefulness;
- token count;
- latency.

Promotion requires demonstrated equality/superiority plus recovery confidence.

---

# 15. UI / Brain Inspector

Issue #34.

The inspector should expose:

- Hot Cognition;
- lifecycle obligations;
- L0-L4 worker state;
- batch progress;
- temporal graph/current vs history;
- provenance;
- reflections and supporting/contradicting evidence;
- Sensory candidates;
- Truth Gate decisions;
- rerank path;
- compiled packet;
- shadow comparison.

UI is observational by default.

---

# 16. Development lanes

## Development-Nexus

Owns contracts, integration, golden worlds, Result Bus, Context Seal, Settlement, Compiler and cross-lane acceptance.

## Development-Lorebook-Editor

Owns Source Registry, Lore Study, contextual retrieval forms, ontology/hierarchy.

## Development-Memory

Owns Experience, Reflection, temporal state, consolidation and learning feedback.

## Development-Scene-Scanner

Owns scene intent planning, Sensory Net and hybrid retrieval infrastructure.

## Development-Sidecar/Jev

Owns structured semantic-worker interfaces, semantic Truth Gate judgment and precision/reranking.

## Development-Worker-Director

Owns Lifecycle and the Cognitive Runtime Fabric.

## Development-UI

Owns the Brain Inspector and lightweight runtime observability.

---

# 17. Core research-derived invariants

1. Hybrid retrieval is intentional.
2. Lorebooks are studied, not merely indexed.
3. Original source and learned representation remain separate.
4. Every learned belief is provenance-backed.
5. Inference is explicitly different from observed or settled fact.
6. State changes preserve historical truth.
7. Retrieval relevance and temporal truth are separate gates.
8. High recall precedes high precision.
9. Retrieval may return nothing when confidence is low.
10. Every large operation is batched.
11. Generation changes execution priority, not lifecycle truth.
12. Foreground capacity is reserved; background capacity is borrowed.
13. Background work yields cooperatively at safe checkpoints.
14. Completed durable work is never silently replayed.
15. Late results cannot mutate a sealed generation.
16. Models propose; canonical owners settle.
17. Frameworks are replaceable behind Area-52 contracts.
18. Compression is accepted only when measured knowledge is retained.
19. Evaluation combines deterministic golden worlds with optional RAG-quality metrics.
20. Nexus integration begins in shadow mode.


# 18. UI.Core

Epic #58. Owner lane: `Development-UI`.

Canonical blueprint: `docs/AREA52_UI_CORE_BLUEPRINT.md`.

UI.Core owns the application shell, design tokens, widget lifecycle/registry, workspaces, Inspector, action routing, signal subscriptions, render coalescing, virtualization, overlays, notifications, accessibility, persistent presentation state and the shared primitive/cognitive widget vocabulary.

Core invariant:

> **Subsystems expose state, events and typed actions. UI.Core owns how those become interface.**

Child work items: #59-#74 plus #34 Brain Inspector.
