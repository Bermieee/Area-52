# Area-52 Project Plan

**Project:** Area-52 Cognitive Memory Architecture  
**Repository:** `Bermieee/Area-52`  
**Planning model:** dependency-gated, architecture-first  
**Canonical architecture:** `docs/AREA52_COGNITIVE_MEMORY_BLUEPRINT.md`
**Subsystem board map:** `docs/AREA52_SUBSYSTEM_BOARD_MAP.md`
**Research map:** `docs/REFERENCE_RESEARCH_MAP.md`

---

## 1. Mission

Build and prove a self-teaching cognitive memory system that can study a lore corpus, construct a provenance-backed model of the world, learn from narrative experience, maintain temporal truth, retrieve through multiple complementary channels, and compile the right knowledge for an external Main model.

Area-52 remains isolated from production Nexus until the architecture proves its contracts and acceptance gates.

The objective is not to replace one retrieval system with another. The objective is to combine the best available memory and retrieval techniques into one coordinated cognitive pipeline.

---

## 2. Program rules

1. **Blueprint before implementation.** Runtime work may not silently redefine the cognitive contracts.
2. **Hybrid by design.** Sparse, dense, graph, hierarchy, reflection, temporal state, and reranking are complementary.
3. **Source is never learned state.** Original lore and narrative evidence remain independently recoverable.
4. **Models propose; owners settle.** Generated text never gains canonical mutation authority by itself.
5. **History is retained.** Current-state changes supersede prior truth; they do not erase it.
6. **Inference is labeled.** Reflection and inferred knowledge cannot masquerade as observed or canonical fact.
7. **Foreground work stays bounded.** Deep study and consolidation belong in Thought/Sleep paths.
8. **Every derived artifact declares provenance, revision, and invalidators.**
9. **Every phase must be measurable.** Complexity is accepted only when it improves retrieval/truth/context quality.
10. **No Nexus integration until Area-52 works independently.**

---

# 3. Development phases

## Phase 0 — Cognitive contract freeze

**Goal:** define the interfaces that every future implementation must obey.

### Deliverables

- Source record contract.
- Source revision contract.
- Entity / alias contract.
- Atomic claim contract.
- Temporal claim contract.
- Reflection contract.
- Provenance contract.
- Candidate Bus contract.
- Truth Gate classification contract.
- Proposal / settlement contract.
- Compiled context packet contract.
- Cognitive execution class: Reflex / Thought / Sleep.
- Error and recovery semantics.

### Exit Gate A — Contract Freeze

PASS requires:

- every canonical data type has an explicit schema;
- canonical vs derived vs cache state is unambiguous;
- every mutable artifact defines revision/freshness identity;
- every proposal identifies its owner and authority boundary;
- no storage backend is required to understand the contracts;
- deterministic fixtures can represent current, historical, superseded, contradicted, inferred, and unresolved knowledge.

---

## Phase 1 — Source Registry + Lore Study Core

**Goal:** prove that Area-52 can study lore without destroying source intent.

### Work

- Immutable Source Registry.
- Content hashing / source revisions.
- Lorebook import abstraction.
- Structural entry reading.
- Contextual chunk representation.
- Entity extraction.
- Alias resolution candidates.
- Atomic claim extraction.
- Relationship extraction.
- Temporal classification.
- Concept / ontology nomination.
- Derived-artifact provenance.
- Incremental relearning dependency graph.
- Study checkpoint/resume.

### Required fixtures

At minimum:

1. simple character + location lorebook;
2. mutable-object lorebook;
3. conflicting lore entries;
4. alias-heavy lorebook;
5. multi-entry magic/system lorebook;
6. edited-entry/revision scenario.

### Exit Gate B — Study Fidelity

PASS requires:

- original source bytes/text remain recoverable;
- all learned artifacts point to source revision(s);
- editing one UID invalidates only its truthful dependency cone;
- unrelated learned artifacts survive unchanged;
- no unsupported claim is silently promoted to source canon;
- study can resume after interruption.

---

## Phase 2 — Temporal World Model

**Goal:** represent what is true now without losing what used to be true.

### Work

- Entity registry.
- Temporal claim store.
- Relationship graph.
- Current-state projection.
- Historical-state queries.
- Supersession links.
- Contradiction representation.
- Unresolved claim sets.
- Bounded graph traversal.
- Claim confidence metadata.
- Provenance traversal: claim -> evidence.
- Revisioned graph snapshots / change journal.

### Core scenario

```text
Tavern state=intact valid T0..T492
Tavern state=destroyed valid T492..
Tavern destroyed_by FireEvent492
```

The system must answer both current and historical questions correctly.

### Exit Gate C — Temporal Truth

PASS requires:

- state changes never erase historical truth;
- one active mutually-exclusive state can supersede another safely;
- historical queries recover the prior state;
- contradiction and supersession are distinct;
- graph traversal cannot accidentally convert an inferred relationship into canon;
- every current projection can be traced to settled claims.

---

## Phase 3 — Hybrid Sensory Net

**Goal:** maximize candidate recall through complementary retrieval channels.

### Work

- Candidate Bus.
- Sparse/BM25 retriever.
- Dense embedding interface.
- Graph-neighborhood retriever.
- Episodic retriever.
- Reflection retriever.
- Hierarchical/concept retriever.
- Active-continuity channel.
- Query decomposition.
- Multi-query expansion.
- Rank fusion.
- Candidate deduplication.
- Retrieval diagnostics.

### Architecture rule

No retriever owns final admission.

### Exit Gate D — High Recall

Using a controlled benchmark corpus:

- exact identifiers must be recoverable through sparse retrieval;
- paraphrased concepts must be recoverable through dense retrieval;
- relationship-only facts must be recoverable through graph nomination;
- broad conceptual questions must be recoverable through hierarchy;
- relevant evidence should survive channel disagreement;
- empty/irrelevant turns must be allowed to return a small or empty candidate set.

---

## Phase 4 — Truth Gate + Precision Reranking

**Goal:** distinguish relevance from truth and broad recall from exact usefulness.

### Truth Gate work

- Deterministic temporal verification.
- Current/historical/superseded/contradicted/unresolved classification.
- Query-intent temporal interpretation.
- Source-authority handling.
- Semantic entailment/contradiction interface.
- Bounded semantic reconciliation fallback.
- Safe failure semantics.

### Rerank work

- Late-interaction reranker interface.
- Optional cross-encoder interface.
- Score normalization.
- Truth-aware relevance scoring.
- Corrective retrieval controller.
- LOW/MIXED/HIGH retrieval confidence.

### Exit Gate E — Precision + Truth

PASS requires benchmark cases such as:

- “kill a dragon” outranks “heal a dragon”;
- current destroyed tavern state outranks old intact description for present-tense queries;
- old intact description remains available for historical queries;
- ambiguous evidence stays unresolved;
- reranker outage falls back safely;
- low-confidence retrieval may return no long-term memory rather than fabricated relevance.

---

## Phase 5 — Reflection + Consolidation Engine

**Goal:** allow Area-52 to learn meaning across repeated experience without auto-canonizing inference.

### Work

- Reflection schema.
- Evidence support sets.
- Contradiction sets.
- Confidence dynamics.
- Reflection reinforcement.
- Reflection weakening.
- Reflection split/merge.
- Reflection supersession/history.
- Reflection eligibility scheduler.
- Evidence-change trigger.
- Consolidation proposals.
- Promotion proposals to specialized memory owners.
- Reflection provenance UI/debug representation.

### Exit Gate F — Safe Learning

PASS requires:

- one isolated behavior does not automatically become a durable pattern;
- repeated evidence can strengthen a Reflection;
- contradictory evidence can weaken it;
- a Reflection remains explicitly inferential;
- confidence never directly grants canonical mutation authority;
- reflection recomputation is bounded to affected evidence.

---

## Phase 6 — Context Compiler

**Goal:** translate selected knowledge into a compact, truthful, model-independent packet.

### Work

- Canonical semantic packet schema.
- Claim deduplication.
- Relationship merging.
- Temporal qualifier preservation.
- Authority/provenance markers where relevant.
- Priority ordering.
- Structured sparse representation.
- Verbose fallback representation.
- Token estimator.
- Compression profiles.
- Packet diff/debug view.
- Model-adapter interface boundary.

### Exit Gate G — Compression Without Knowledge Loss

Measure:

- selected raw tokens;
- compiled tokens;
- compression ratio;
- factual retention;
- temporal-state retention;
- unresolved-thread retention;
- character-state retention.

PASS requires material token reduction without meaningful loss of selected knowledge.

---

## Phase 7 — Performance, Durability, and Cognitive Scheduling

**Goal:** prove the brain can operate at long-session scale without turning background cognition into foreground latency.

### Work

- Reflex / Thought / Sleep scheduler.
- Durable work checkpoints.
- Idempotent derived-artifact generation.
- Study resume.
- Reflection resume.
- Revision-keyed caches.
- Dependency invalidation.
- Batch processing.
- Bounded concurrency.
- Provider failure handling.
- Offline/local fallback paths where practical.
- Performance telemetry.
- Memory growth measurement.

### Exit Gate H — Scale + Recovery

Test targets should include:

- large lore corpus;
- thousands of narrative turns;
- single-entry lore edits;
- repeated reload/resume;
- provider failures;
- interrupted study;
- interrupted reflection;
- simultaneous unrelated background work.

PASS requires no silent replay, no broad unnecessary rebuild, and bounded foreground latency.

---

## Phase 8 — Evaluation Harness

**Goal:** make Area-52 objectively testable.

This work begins early and expands through every phase.

### Benchmark categories

- exact recall;
- semantic recall;
- relationship recall;
- current-state accuracy;
- historical-state accuracy;
- contradiction handling;
- supersession handling;
- multi-hop graph reasoning;
- reflection learning;
- reflection contradiction recovery;
- compilation fidelity;
- incremental relearning;
- retrieval latency;
- compile latency;
- background throughput.

### Golden-world fixtures

Create small deterministic worlds where every correct answer is known.

A benchmark fixture should include:

- source lore;
- narrative events;
- expected graph state;
- expected history;
- expected reflections;
- expected retrieval candidates;
- expected Truth Gate classifications;
- expected compiled context.

### Exit requirement

No major cognitive subsystem is considered complete without benchmark coverage.

---

## Phase 9 — Persistence Backend Decision

**Goal:** choose storage after cognitive behavior is understood.

Candidates may include:

- SQLite;
- IndexedDB;
- embedded graph tables;
- vector database;
- local ANN;
- append-only evidence journal;
- hybrid combinations.

### Decision criteria

- incremental writes;
- graph traversal;
- transactional settlement;
- source/provenance lookup;
- vector search;
- revision invalidation;
- crash recovery;
- portability;
- SillyTavern/browser compatibility;
- install complexity;
- backup/export;
- long-session size.

### Exit Gate I — Storage Fit

The chosen persistence design must implement the established contracts without weakening them.

---

## Phase 10 — Nexus Shadow Adapter

**Goal:** connect Area-52 to Nexus without making it authoritative.

### First integration surfaces

- lorebook ingestion;
- narrative turn feed;
- Character State read-only access;
- Durable Lore read-only access;
- Smart Context comparison;
- Prompt Loader compiled-packet adapter;
- Work Director scheduling;
- Decision Core/Jev bounded judgment;
- Diagnostics.

### Shadow comparison

For each generation compare:

```text
Current Nexus context
vs
Area-52 proposed context
```

Measure:

- relevant facts present;
- stale facts;
- missing continuity;
- token count;
- current-state correctness;
- next-beat usefulness;
- latency.

### Exit Gate J — Shadow Superiority

Area-52 cannot become authoritative merely because it works.

It must demonstrate equal or better narrative/context quality with acceptable latency and recovery behavior.

---

## Phase 11 — Controlled Authority Migration

**Goal:** progressively replace redundant Nexus paths only after proven equivalence.

Potential migration order:

1. read-only studied lore representation;
2. retrieval candidate nomination;
3. Truth Gate current-state filtering;
4. compiled context publication;
5. Reflection-assisted Character State proposals;
6. world-state settlement;
7. Housekeeper consolidation;
8. retirement/reduction of redundant legacy memory paths.

Every authority migration requires its own rollback path.

---

# 4. Workstreams

## W0 — Contracts & schemas

Owns the language every other subsystem speaks.

## W1 — Source / provenance

Owns immutable source identity, revisioning, and derivation lineage.

## W2 — Study Engine

Owns lore understanding and incremental relearning.

## W3 — World Model

Owns temporal claims, graph relations, supersession, and current projection.

## W4 — Retrieval / Sensory Net

Owns candidate nomination and fusion.

## W5 — Truth / precision

Owns temporal verification, contradiction classification, reranking, and corrective retrieval.

## W6 — Reflection / consolidation

Owns inferential learning across experiences.

## W7 — Context Compiler

Owns compact semantic packets and future model-adapter boundary.

## W8 — Scheduler / durability

Owns Reflex/Thought/Sleep execution, caches, checkpointing, and failure recovery.

## W9 — Evaluation

Owns golden worlds, benchmarks, quality metrics, and regression gates.

## W10 — Persistence

Owns backend evaluation and persistence implementation after contracts stabilize.

## W11 — Nexus integration

Owns shadow adapter, diagnostics, comparison, and eventual authority migration.

---

# 5. Immediate project backlog

## P0 — Must happen before real subsystem implementation

- [ ] Define SourceRecord schema.
- [ ] Define SourceRevision / content identity.
- [ ] Define Entity and AliasCandidate schemas.
- [ ] Define Claim schema.
- [ ] Define temporal validity model.
- [ ] Define Reflection schema.
- [ ] Define Provenance schema.
- [ ] Define Candidate Bus schema.
- [ ] Define Truth Gate classification/result schema.
- [ ] Define MutationProposal schema.
- [ ] Define SettlementReceipt schema.
- [ ] Define CompiledContextPacket schema.
- [ ] Define cache dependency/invalidation contract.
- [ ] Define Reflex / Thought / Sleep task contract.
- [ ] Build first deterministic golden-world fixture.

## P1 — First executable cognitive slice

- [ ] Import a tiny lorebook fixture.
- [ ] Preserve source.
- [ ] Extract entities.
- [ ] Extract simple claims.
- [ ] Settle claims into an in-memory temporal world model.
- [ ] Retrieve by exact term.
- [ ] Retrieve by semantic stub/interface.
- [ ] Retrieve graph neighbors.
- [ ] Classify current vs historical.
- [ ] Compile a compact context packet.
- [ ] Prove source edit invalidates only dependent artifacts.

The first vertical slice is intentionally small. It should prove the entire cognitive lifecycle before any subsystem becomes sophisticated.

---

# 6. First vertical-slice acceptance story

Use a deterministic mini-world:

### Initial lore

- The Ember Tavern is intact and owned by Mara.
- The Sun Blade is carried by Eris.
- Eris knows Mara.

### Narrative updates

1. Eris leaves the Sun Blade at the tavern.
2. The Ember Tavern burns down.
3. The Sun Blade is destroyed in the fire.

### Required learned state

Current:

```text
EmberTavern.state = destroyed
SunBlade.state = destroyed
SunBlade.location = historical: EmberTavern
Mara.owner_of = EmberTavern
```

Historical:

```text
EmberTavern.state = intact before fire
Eris.carried = SunBlade before deposit
SunBlade.state = intact before fire
```

### Retrieval requirements

Present-tense query:

> Where can Eris find the Sun Blade?

must not inject “Eris possesses the Sun Blade” as current truth.

Historical query:

> What weapon did Eris carry before the tavern fire?

must recover the Sun Blade.

### Compiler requirement

The final packet should express current state compactly while retaining historical context only when relevant.

This scenario becomes the first end-to-end Area-52 acceptance test.

---

# 7. Definition of Done for any Area-52 subsystem

A subsystem is not done unless it documents:

1. cognitive problem solved;
2. input contract;
3. output contract;
4. authority level;
5. provenance behavior;
6. revision identity;
7. invalidators;
8. Reflex / Thought / Sleep class;
9. safe failure behavior;
10. cache behavior;
11. benchmark coverage;
12. diagnostics;
13. known limitations;
14. dependencies;
15. rollback/rebuild behavior.

---

# 8. Current program state

**Current phase:** Phase 0 — Cognitive contract freeze.

**Implementation posture:** architecture and test-fixture work may proceed; backend commitment and Nexus integration may not.

**First target:** complete P0 contracts and the first golden-world fixture, then implement the smallest end-to-end vertical slice.

The project should resist the temptation to perfect embeddings, graph storage, rerankers, or UI before that slice proves that the complete cognitive lifecycle is coherent.


# Cognitive Coprocessor execution package

**Epic:** #75  
**Owner lane:** `Development-Sidecar/Jev`

Canonical documents:
- `docs/AREA52_COGNITIVE_COPROCESSOR_BLUEPRINT.md`
- `docs/AREA52_SIDECAR_REFERENCE_DOCUMENTATION.md`
- `docs/AREA52_SIDECAR_IMPLEMENTATION_RUNBOOK.md`

The first sidecar milestone is the **One-Key Swarm**: one Turn Event dynamically fans out to multiple capability workers, a Gather Coordinator closes on a bounded foreground quorum/deadline, Context Compiler receives structured lanes, and late results are rerouted without crossing Context Seal.

The sidecar implementation sequence is contract-first:
1. typed worker/result contracts and correlation envelope;
2. native mock fan-out/gather;
3. Runtime Fabric integration;
4. real cognitive workers;
5. speculative warming / Green Room / consolidation / streaming truth;
6. Dapr and data-plane benchmarks;
7. full coprocessor evaluation.

No infrastructure framework is adopted until it wins against Area-52 golden-world, latency, durability and operational-complexity tests.
