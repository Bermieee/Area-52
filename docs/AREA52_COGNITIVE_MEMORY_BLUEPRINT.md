# Area-52 Cognitive Memory Blueprint

**Project:** Area-52  
**Repository:** `Bermieee/Area-52`  
**Status:** Blueprint / architecture definition  
**Purpose:** Define the next-generation Nexus cognitive memory architecture before implementation.

---

## 1. Core thesis

Area-52 is not a larger lorebook, a vector database, a knowledge graph, or a single RAG pipeline.

Area-52 is a **self-teaching external cognitive system** that:

1. studies supplied lore and other source material;
2. builds an internal, provenance-backed understanding of the world;
3. learns from narrative experience over time;
4. distinguishes facts, history, inference, current state, and uncertainty;
5. retrieves broadly using multiple complementary techniques;
6. verifies whether retrieved information is current and usable;
7. reranks for exact relevance;
8. compiles the result into a compact model-independent context packet;
9. presents that packet to the active Main model through a model-specific adapter;
10. learns again from the resulting narrative.

The architectural direction is explicitly **hybrid**.

No single retrieval, graph, embedding, summarization, reflection, or compression technique is expected to solve the complete memory problem. Area-52 combines the strongest properties of each technique and assigns each one a bounded role.

---

## 2. Primary design rule: combine strengths, do not force one representation

Different kinds of knowledge require different representations.

A graph is excellent for:

- entities;
- relationships;
- ownership;
- location;
- faction membership;
- state transitions;
- multi-hop relationships;
- temporal supersession.

A vector representation is excellent for:

- semantic similarity;
- fuzzy recall;
- concept matching;
- paraphrase recovery.

Sparse retrieval is excellent for:

- exact names;
- IDs;
- rare terminology;
- literal phrases;
- titles;
- aliases.

Hierarchical summaries are excellent for:

- broad concepts;
- corpus-level questions;
- multi-resolution recall;
- thematic understanding.

Reflections are excellent for:

- repeated patterns;
- relationship trends;
- inferred meaning;
- higher-order developments.

Episodic memory is excellent for:

- what actually happened;
- provenance;
- chronology;
- reconstruction.

Structured state is excellent for:

- current truth;
- compact downstream use;
- deterministic verification.

The Area-52 brain therefore uses **multiple internal representations under one cognitive layer** rather than forcing everything into a single store.

---

## 3. The cognitive loop

```text
SOURCE MATERIAL / NARRATIVE
          |
          v
       OBSERVE
          |
          v
       STUDY / EXTRACT
          |
          +--------------------+
          |                    |
          v                    v
      EXPERIENCE           SEMANTIC INDEXES
          |             sparse / dense / late interaction
          v
       REFLECT
          |
          v
      RECONCILE
          |
          v
       PROPOSE
          |
          v
   VALIDATE / JUDGE
          |
          v
       SETTLE
          |
          v
     WORLD MODEL
          |
          v
     SENSORY NET
          |
          v
      TRUTH GATE
          |
          v
      RERANK GATE
          |
          v
   CONTEXT COMPILER
          |
          v
       MAIN MODEL
          |
          v
   NEW NARRATIVE EXPERIENCE
          |
          +----------> OBSERVE
```

The system learns continuously, but deep learning operations are not required to block foreground generation.

---

# PART I — STUDYING THE WORLD

## 4. Lorebooks are curriculum

When Area-52 receives a lorebook, it does not merely index the entries.

It **studies the lorebook**.

The original source remains immutable evidence. Derived knowledge is stored separately and remains traceable back to the source that taught it.

A source entry may teach the brain:

- entities;
- aliases;
- atomic claims;
- relationships;
- chronology;
- rules;
- mutable states;
- immutable properties;
- categories;
- concepts;
- ontology;
- geographic structure;
- faction structure;
- causality;
- unresolved ambiguity;
- retrieval representations;
- compact compiled representations.

Example:

```text
SOURCE UID 184
|
+-- contextual sparse representation
+-- dense embedding
+-- late-interaction representation
+-- entities
|   +-- Nanahoshi
|   +-- Teleport Incident
+-- claims
|   +-- Nanahoshi affected_by TeleportIncident
|   +-- Nanahoshi origin Japan
|   +-- Nanahoshi native_mana incompatible
+-- graph relationships
+-- concept membership
|   +-- Otherworlders
|   +-- Summoning
+-- hierarchy membership
+-- compact semantic representation
```

Every derived artifact keeps:

```text
sourceId
sourceRevision
derivationType
derivationRevision
createdAt
```

This is the basis for incremental relearning.

---

## 5. Lore Study Engine

Lore study occurs in passes.

### Pass A — source preservation

Store or reference the exact original source.

Do not rewrite it into the learned representation.

### Pass B — structural reading

Identify:

- entries;
- titles;
- keywords;
- source hierarchy;
- author-provided categories;
- metadata;
- embedded links;
- explicit relationships.

### Pass C — contextualization

Chunks receive enough document-level context to remain meaningful after separation.

Example:

Raw chunk:

```text
She became queen three years later.
```

Derived retrieval representation:

```text
Entity=Ariel Anemoi Asura
Topic=Asura succession
Timeline=post-conflict
She became queen three years later.
```

The original sentence remains untouched.

### Pass D — entity and alias extraction

Learn people, places, objects, factions, systems, events, titles, aliases, and identity relationships.

### Pass E — atomic claim extraction

Break prose into individually traceable claims where useful.

Example:

```text
SwordOfLight type weapon
SwordOfLight created_by FirstSwordGod
SwordOfLight status lost
SwordOfLight lost_during LaplaceWar
```

### Pass F — relationship extraction

Create graph-ready relationships between identified entities.

### Pass G — temporal classification

Determine whether a claim appears:

- timeless;
- current;
- historical;
- bounded by an event;
- explicitly mutable;
- uncertain.

### Pass H — ontology and concept learning

The brain learns the world's own schema rather than requiring one fixed universal RP schema.

Examples:

```text
Place
  -> continent
  -> kingdom
  -> city
  -> building

Magic
  -> elemental
  -> healing
  -> summoning
```

### Pass I — hierarchy and community synthesis

Cluster related knowledge into broader semantic concepts so Area-52 can answer both local and global questions.

### Pass J — retrieval representations

Build the appropriate sparse, dense, and late-interaction indexes.

### Pass K — compiled representation

Prepare a compact internal semantic representation that can later be included by the Context Compiler without regenerating it every turn.

---

## 6. Incremental relearning

A changed lore entry must not trigger a full rebuild unless necessary.

Area-52 tracks derived artifacts by source revision.

If UID 184 changes:

```text
invalidate:
  contextual representation for UID184
  embeddings for UID184
  claims sourced only by UID184
  affected relationships
  affected concept memberships
  dependent summaries/reflections where necessary
```

Unrelated learned knowledge remains valid.

This is a core scaling requirement.

---

# PART II — WHAT THE BRAIN CAN KNOW

## 7. Knowledge classes

Area-52 must distinguish at least these knowledge classes.

### 7.1 Source

What the user, author, imported lorebook, character card, or other canonical input explicitly supplied.

### 7.2 Experience

What happened in narrative.

Experience is immutable evidence, not automatically a permanent truth.

### 7.3 Claim

An atomic proposition extracted from source or experience.

### 7.4 Current State

A claim currently considered active for a mutable property or relationship.

### 7.5 Historical State

A claim that was once active and is still historically valid.

### 7.6 Reflection

A higher-order interpretation synthesized from multiple pieces of evidence.

Example:

```text
Nanahoshi appears increasingly willing to trust Akira's technical judgment.
```

A Reflection is explicitly inferential.

### 7.7 Rule / Durable Knowledge

A stable semantic rule of the world.

### 7.8 Character State

Specialized durable person knowledge.

Character State remains a distinct semantic owner rather than being flattened into generic graph state.

### 7.9 Unresolved Knowledge

Ambiguous, conflicting, incomplete, or insufficiently supported knowledge.

### 7.10 Compiled Context

A temporary, task-specific representation produced for Main. It is not canonical memory.

---

## 8. Provenance and authority

Every learned item must answer:

> Why does Area-52 believe this?

Minimum provenance model:

```text
id
kind
sourceIds[]
sourceRevisions[]
evidenceIds[]
authorityClass
confidence
createdRevision
lastConfirmedRevision
supersedes[]
contradictedBy[]
owner
status
```

Authority classes should distinguish at minimum:

```text
OPERATOR
SOURCE_CANON
OBSERVED
SETTLED
INFERRED
UNRESOLVED
```

Confidence never grants mutation authority by itself.

---

# PART III — TEMPORAL WORLD MODEL

## 9. Temporal State Graph

The graph is connective tissue, not the entire brain.

It represents relationships and mutable state while retaining history.

Do not overwrite:

```text
Tavern.state = intact
```

with:

```text
Tavern.state = destroyed
```

Represent both:

```text
Tavern --state--> intact
validFrom=T0
validUntil=T492

Tavern --state--> destroyed
validFrom=T492
validUntil=null

Tavern --destroyed_by--> FireEvent492
```

This allows both:

> What is the tavern like now?

and:

> What was the tavern like before the fire?

to be answered correctly.

---

## 10. Supersession

Supersession is first-class.

```text
Claim A --superseded_by--> Claim B
```

Superseded information is not automatically false.

It may be historically correct.

The brain distinguishes:

```text
CURRENT
HISTORICAL
SUPERSEDED
CONTRADICTED
UNCERTAIN
UNRESOLVED
```

---

# PART IV — THE SENSORY NET

## 11. Sensory Net purpose

The Sensory Net is the high-recall perception layer.

Its job is not to return the final answer.

Its job is:

> Find everything that has a reasonable chance of mattering.

Candidate generation should intentionally over-retrieve.

---

## 12. Parallel retrieval channels

The Sensory Net combines:

### Sparse retrieval

BM25 or equivalent.

Best for:

- exact names;
- IDs;
- keywords;
- rare terminology;
- aliases.

### Dense vector retrieval

Embeddings.

Best for:

- paraphrases;
- semantic similarity;
- fuzzy concepts;
- related events.

### Late-interaction retrieval

ColBERT-like token-level matching.

Best for:

- nuanced phrase relevance;
- high precision without a full cross-encoder over the entire corpus.

### Graph retrieval

Entity neighborhood and bounded relationship traversal.

Best for:

- connected facts;
- ownership;
- location;
- related entities;
- multi-hop relationships.

### Hierarchical retrieval

Concept clusters and recursive summaries.

Best for:

- broad world questions;
- theme-level recall;
- corpus-scale understanding.

### Episodic retrieval

Recent or semantically relevant past events.

### Reflection retrieval

Persistent inferred patterns relevant to current entities or themes.

### Specialized semantic stores

Character State, Durable Lore, Notebook, and future domain-specific stores.

### Active continuity

Manual pins, earned pins, current location, current participants, active unresolved threads.

---

## 13. Query decomposition and expansion

The raw user message is not the only retrieval query.

Area-52 may derive bounded retrieval intents.

Example scene:

```text
I tighten my grip on the dagger as Nanahoshi looks toward the door.
```

Potential intents:

```text
ENTITY dagger
ENTITY Nanahoshi
LOCATION current room
RELATIONSHIP Akira <-> Nanahoshi
THREAD current threat
EVENT dagger provenance
```

Each channel retrieves independently.

Rankings can then be fused.

---

## 14. Candidate Bus

All retrieval channels publish into one normalized candidate bus.

Conceptual candidate:

```text
candidateId
sourceType
sourceId
entityIds[]
claimIds[]
scoreSignals {
  sparse
  dense
  lateInteraction
  graphDistance
  recency
  continuity
  authority
}
retrievalIntents[]
temporalStatus
provenance
```

No individual retriever owns final admission.

---

# PART V — TRUTH MAINTENANCE

## 15. Truth Gate purpose

The Truth Gate answers:

> Is this retrieved information valid for the way the current request intends to use it?

Relevance and truth are separate.

An old tavern description may be relevant but historical.

---

## 16. Truth Gate output

Candidates are classified rather than simply passed or rejected:

```text
CURRENT
HISTORICAL
SUPERSEDED
CONTRADICTED
UNCERTAIN
UNRESOLVED
SOURCE_CANON
INFERRED
```

A historical candidate can still be useful when the query itself is historical.

---

## 17. Truth verification levels

### Level A — deterministic

Use:

- graph state;
- source revision;
- temporal bounds;
- entity IDs;
- explicit supersession;
- canonical state pointers.

This is preferred whenever possible.

### Level B — entailment / contradiction

A small semantic verifier can classify candidate statements against current state/evidence as:

```text
ENTAILED
CONTRADICTED
NEUTRAL
```

### Level C — bounded semantic reconciliation

Use a Sidecar/Jev-like bounded judgment only when deterministic and simple semantic checks cannot safely decide.

Truth Gate does not own canonical mutation.

---

# PART VI — PRECISION

## 18. Rerank Gate

After broad retrieval and truth classification, Area-52 performs high-precision ranking.

Potential stages:

```text
50 candidates
  -> late-interaction rerank
15 candidates
  -> optional cross-encoder / semantic judge
5-10 candidates
```

The expensive layer should receive only a bounded candidate set.

---

## 19. Corrective retrieval

The system evaluates the quality of its own retrieval.

Possible result:

```text
HIGH
MIXED
LOW
```

### HIGH

Compile normally.

### MIXED

Allow bounded corrective actions:

- query reformulation;
- additional graph expansion;
- second sparse/dense pass;
- entity resolution retry.

### LOW

Do not inject irrelevant memory merely to fill a quota.

No memory is better than confidently wrong memory.

---

# PART VII — REFLECTION AND SELF-TEACHING

## 20. Reflection Engine

Area-52 learns across experiences.

Example episodes:

```text
E1 Nanahoshi accepts Akira's help.
E2 Nanahoshi asks Akira for technical advice.
E3 Nanahoshi discloses guarded information.
```

Potential Reflection:

```text
R14
subject=Nanahoshi
pattern=trusts Akira's technical judgment increasingly
support=[E1,E2,E3]
confidence=.78
status=active
```

Reflections can:

- strengthen;
- weaken;
- gain supporting evidence;
- gain contradicting evidence;
- split;
- merge;
- become historical;
- become superseded;
- be promoted to a specialized store through a separate authority process.

---

## 21. Reflection cadence

Reflection does not run because a fixed number of turns elapsed.

Cadence creates **eligibility**.

Actual execution should depend on:

- meaningful accumulated evidence;
- unresolved contradiction;
- major state change;
- narrative transition;
- idle compute availability;
- consolidation need.

A quiet 50-turn period may yield no reflection.

A single major event may justify immediate reflection.

---

## 22. Learning feedback

Area-52 should eventually learn from retrieval outcomes.

Possible feedback signals:

- memory repeatedly retrieved together;
- memory repeatedly selected by reranker;
- memory repeatedly discarded by Truth Gate;
- reflection repeatedly supported by future events;
- reflection repeatedly contradicted;
- compiled knowledge repeatedly useful;
- candidate channel repeatedly producing false positives.

This feedback may influence caches, confidence, indexes, or future retrieval policy.

It must not silently rewrite canon.

---

# PART VIII — CONTEXT COMPILATION

## 23. Context Compiler purpose

Retrieval finds knowledge.

The compiler determines how Main should receive it.

The compiler receives only already-selected knowledge and produces a temporary semantic packet.

It may:

- deduplicate;
- merge compatible claims;
- preserve temporal qualifiers;
- preserve authority labels where important;
- strip redundant prose;
- choose representation density;
- prioritize current state;
- preserve critical historical context;
- order information for model usability.

---

## 24. Structured sparse representation

Area-52 may use an SPR-like dense representation, but the internal representation must remain diagnosable.

Example:

```text
[ACTIVE_WORLD]
LOC EastTower/6F/Workshop
Nanahoshi present=true
SummoningFormation status=recalibrating

[RELATIONSHIPS]
Nanahoshi -> Akira : technical_trust=growing ; cf=.78 ; inferred

[THREADS]
summoning_geometry=redo
origin_point=unresolved
bond_nature=unresolved

[CANON]
Nanahoshi.native_mana=incompatible
temporary_channels=ambient_mana_supply
```

The architecture must not depend on the assumption that arbitrary cryptic tokens are reconstructed perfectly by every model.

---

## 25. Model-independent core, model-specific presentation

Internal memory should not depend on MiMo, GLM, DeepSeek, Claude, Gemini, Qwen, OpenAI, or another model.

The compiler emits a canonical packet.

A future Prompt Loader integration may render that packet differently for the active Main model.

```text
Area-52 semantic packet
        |
        v
Prompt Loader adapter
        |
        +-- MiMo layout
        +-- GLM layout
        +-- DeepSeek layout
        +-- Claude layout
        +-- Gemini layout
        +-- Qwen layout
        +-- OpenAI layout
```

---

# PART IX — COGNITIVE SPEEDS

## 26. Reflex / Thought / Sleep

Not every cognitive process belongs in the generation hot path.

### Reflex — foreground

Must remain aggressively bounded.

Includes:

- entity recognition where required;
- sparse retrieval;
- dense retrieval;
- graph lookup;
- deterministic Truth Gate;
- rerank;
- context compilation.

### Thought — asynchronous near-turn work

Includes:

- event extraction;
- claim extraction;
- relationship proposals;
- reflection updates;
- contradiction analysis;
- incremental index updates.

### Sleep — deep background work

Includes:

- full lore study;
- ontology refinement;
- hierarchy/community building;
- reflection consolidation;
- graph cleanup;
- concept merging;
- deep contradiction audits;
- compression maintenance;
- cold-cache preparation.

Foreground generation must not wait for deep cognitive work that could already have been completed in background.

---

# PART X — SETTLEMENT AND AUTHORITY

## 27. Models propose; owners settle

No model output directly becomes canonical memory.

Canonical mutation path:

```text
worker/model
  -> typed proposal
  -> schema validation
  -> evidence validation
  -> freshness validation
  -> deterministic policy
  -> bounded semantic judgment if needed
  -> owning subsystem policy
  -> optional operator approval
  -> settlement
```

Example proposal:

```text
type=SET_STATE
subject=Tavern
predicate=state
value=destroyed
evidence=[Turn492]
sourceRevision=R1881
confidence=.97
owner=WORLD_STATE
supersedes=Claim182
```

---

## 28. Failure behavior

The brain must degrade safely.

Examples:

- embedding provider unavailable -> sparse + graph retrieval continue;
- graph unavailable -> other retrieval channels continue;
- reranker unavailable -> deterministic fused ranking remains;
- semantic verifier unavailable -> ambiguous candidates remain uncertain rather than falsely current;
- reflection worker unavailable -> story continues without reflection;
- compiler optimization fails -> canonical verbose representation remains available;
- background study fails -> source remains intact and relearn can resume;
- settlement fails -> proposal remains unresolved; no partial canonical mutation.

---

# PART XI — CACHING AND INVALIDATION

## 29. Derived knowledge is revision-keyed

Cacheable artifacts include:

- contextualized chunks;
- sparse indexes;
- dense embeddings;
- late-interaction vectors;
- entity extraction;
- claims;
- graph neighborhoods;
- hierarchy assignments;
- reflection synthesis;
- compiled static representations;
- semantic verification results where source revisions match.

Each cache must declare:

```text
cacheKey
sourceRevision
dependencies[]
invalidators[]
```

---

## 30. Invalidation principle

Invalidate the smallest truthful dependency cone.

Do not rebuild the world when one UID changes.

Do not reuse derived state when its source revision changed.

---

# PART XII — COGNITIVE SYSTEMS MATRIX

## 31. Canonical system matrix

| System | Receives | Primary techniques | Produces | Speed | Canonical authority |
|---|---|---|---|---|---|
| Source Registry | lore/cards/chat/imports | hashing, revisioning | immutable source refs | Thought/Sleep | Source only |
| Lore Study Engine | source corpus | contextualization, extraction, clustering | learned artifacts | Sleep | None |
| Sparse Index | studied text | BM25/sparse | exact candidates | Reflex | None |
| Dense Index | studied text | embeddings | semantic candidates | Reflex | None |
| Late Interaction Index | studied text | ColBERT-like | precision candidates | Reflex | None |
| Experience Store | narrative events | episodic indexing | episodes | Thought | Evidence |
| Reflection Engine | episodes/claims | synthesis, consolidation | reflections | Thought/Sleep | Inferential only |
| Temporal State Graph | settled claims | graph + temporal state | world model | Reflex/Thought | Settled state |
| Hierarchy Store | learned concepts | recursive summaries/clustering | multi-resolution concepts | Sleep | Derived |
| Sensory Net | current scene + stores | hybrid retrieval + fusion | candidate pool | Reflex | None |
| Truth Gate | candidates + world model | temporal checks, NLI, bounded judgment | classified candidates | Reflex | Retrieval only |
| Rerank Gate | valid candidates | late interaction/cross encoder | precision ranking | Reflex | None |
| Context Compiler | final knowledge | dedupe, compression, ordering | semantic packet | Reflex | Temporary only |
| Feedback Learner | retrieval outcomes | statistics/reflection | tuning signals | Thought/Sleep | None |
| Settlement Engine | proposals | validation + ownership policy | canonical commits | Thought | Yes, bounded by owner |

---

# PART XIII — STORAGE PRINCIPLES

## 32. Do not choose storage before the model is stable

The blueprint intentionally does not require a specific backend yet.

Potential implementation technologies may include:

- SQLite;
- IndexedDB;
- graph database;
- embedded graph structures;
- vector database;
- local ANN index;
- file-backed append-only evidence log;
- combinations of these.

The selected technology must serve the cognitive contracts rather than define them.

---

## 33. Storage invariants

Regardless of backend:

1. source evidence is recoverable;
2. derived knowledge points to source revisions;
3. superseded state is retained historically;
4. canonical and inferential stores are separable;
5. indexes are rebuildable from canonical data;
6. caches are disposable;
7. interrupted background learning is resumable;
8. partial mutations cannot masquerade as settled truth.

---

# PART XIV — EVALUATION

## 34. Area-52 must be measurable

The brain must prove that complexity improves memory rather than merely adding machinery.

Core metrics should eventually include:

### Retrieval

- recall@K;
- precision@K;
- stale-context rate;
- irrelevant-context rate;
- current-state accuracy;
- entity recall;
- unresolved-thread recall.

### Truth

- contradiction escape rate;
- historical/current classification accuracy;
- supersession accuracy;
- unsupported-claim rate.

### Compilation

- raw selected tokens;
- compiled tokens;
- compression ratio;
- retained-fact accuracy;
- Main answer/context quality.

### Learning

- reflection support accuracy;
- false durable-learning rate;
- contradiction recovery;
- relearning correctness after source edits.

### Performance

- foreground retrieval latency;
- Truth Gate latency;
- rerank latency;
- compiler latency;
- background study throughput;
- incremental update cost;
- cache reuse rate.

### Narrative quality

Performance improvements are rejected if they reduce:

- continuity;
- character consistency;
- world-state correctness;
- unresolved-thread awareness;
- location awareness;
- next-beat usefulness.

---

# PART XV — IMPLEMENTATION ORDER

## 35. Blueprint-first implementation sequence

Implementation should proceed in dependency order.

### Phase 0 — architecture freeze

Finalize:

- knowledge classes;
- provenance;
- authority;
- temporal rules;
- candidate contract;
- proposal contract;
- compiled packet contract.

No backend optimization work before these stabilize.

### Phase 1 — Source Registry + Lore Study Core

Prove:

- source revisioning;
- contextualization;
- entity extraction;
- claim extraction;
- derivation provenance;
- incremental relearning.

### Phase 2 — Temporal State Graph

Prove:

- current state;
- historical state;
- supersession;
- contradiction representation;
- bounded graph traversal.

### Phase 3 — Hybrid Sensory Net

Integrate:

- sparse retrieval;
- dense retrieval;
- graph nomination;
- episodic nomination;
- hierarchy nomination;
- candidate fusion.

### Phase 4 — Truth Gate

Implement deterministic verification first.

Add semantic contradiction/entailment only where needed.

### Phase 5 — Precision Reranking

Add late-interaction reranking and benchmark whether a second cross-encoder stage materially improves RP retrieval.

### Phase 6 — Reflection Engine

Build multi-episode synthesis with support/contradiction dynamics.

### Phase 7 — Context Compiler

Create the model-independent compact packet.

Measure token reduction against retained meaning.

### Phase 8 — Feedback learning

Allow retrieval outcomes to improve confidence, cache strategy, and nomination policy without granting canonical mutation authority.

### Phase 9 — Nexus integration adapter

Only after Area-52 proves the architecture independently should it connect to:

- Character State;
- Durable Lore;
- Memory Bank;
- Smart Context;
- Housekeeper;
- Work Director;
- Jev / Decision Core;
- Prompt Loader;
- SillyTavern.

### Phase 10 — authority migration

Existing Nexus memory paths are retired or reduced only after equivalent or better live behavior is demonstrated.

---

# PART XVI — NON-NEGOTIABLE PRINCIPLES

## 36. Architectural invariants

1. **Hybrid is the design.** No single retrieval or memory representation becomes the whole brain.
2. **Lorebooks are studied, not merely indexed.**
3. **Source and learned understanding are separate.**
4. **Every learned belief is provenance-backed.**
5. **Inference is not fact.**
6. **History is not erased when state changes.**
7. **Supersession is first-class.**
8. **Truth verification happens before context publication.**
9. **High recall happens before high precision.**
10. **No candidate channel owns final admission.**
11. **No LLM owns canonical mutation by virtue of generating text.**
12. **Models propose; owners settle.**
13. **Reflection cadence creates eligibility, not authority.**
14. **Foreground cognition remains bounded.**
15. **Deep learning belongs in background/idle work.**
16. **Caches are disposable; canonical knowledge is not.**
17. **Incremental relearning is required for scale.**
18. **The internal world model is model-independent.**
19. **Prompt presentation may be model-specific.**
20. **Narrative quality outranks latency and token savings.**

---

# PART XVII — TARGET END STATE

## 37. What Area-52 should become

The final system should be able to receive a large lore corpus and, before the story begins:

- understand its entities;
- discover its relationships;
- learn its concepts;
- build its hierarchy;
- recognize its rules;
- establish its initial world state;
- index it through multiple complementary retrieval methods;
- preserve the exact source behind every learned belief.

As the story progresses, it should:

- remember events;
- recognize meaningful state changes;
- update current truth without deleting history;
- form cautious reflections from repeated evidence;
- maintain character and world understanding;
- detect contradictions;
- revise learned interpretations;
- retrieve the right knowledge through multiple sensory channels;
- verify temporal truth;
- rerank for precise scene relevance;
- compile only what Main needs;
- learn again from what happens next.

The intended end state is:

> **Nexus no longer merely stores a story. Area-52 teaches Nexus the world.**

---

## 38. Current status

This document is the canonical architectural blueprint for Area-52.

Implementation should remain subordinate to this blueprint. Any future subsystem that cannot state:

- what cognitive problem it solves;
- which knowledge class it operates on;
- what authority it has;
- what provenance it preserves;
- what invalidates it;
- whether it runs in Reflex, Thought, or Sleep;
- and how it fails safely

is not ready to enter the Area-52 architecture.


---

# ADVANCED BRAIN EXTENSIONS — MEMORY PLASTICITY, CAUSALITY + LORE COMPILATION

The Area-52 Brain is intentionally extensible.

Three advanced systems deepen existing cognitive organs without creating alternate authority paths.

## Memory reconsolidation

Memory retrieval and use may create eligibility to reorganize **derived memory structure**.

Possible effects:

- strengthen or weaken derived associations;
- refine retrieval representations;
- adjust hot/warm/cold priority;
- split or merge derived memory;
- reevaluate Reflections;
- rebuild communities/hierarchies.

Usage is operational feedback.

Usage is not independent evidence.

Reconsolidation never rewrites exact source and never grants canonical authority.

Canonical reference:

`docs/AREA52_MEMORY_RECONSOLIDATION_MATURATION_FORGETTING.md`

Project card: #118.

## Memory maturation and value-aware forgetting

Derived memory may mature from fresh observation into episodic memory, repeatedly supported patterns and durable learned representations.

Maturity remains distinct from authority.

Forgetting means reducing active retrieval/residency cost before deleting any rebuildable derived representation.

Canonical source, required provenance and historical truth are protected.

## Causal / Event Memory

Temporal State answers *what was true and when*.

Causal/Event Memory adds *what happened, what caused it, what enabled it, and which explanations remain plausible*.

Chronology and causality remain distinct.

Competing explanations are represented as explicit hypothesis sets with support and contradiction evidence.

No hypothesis is promoted to canon merely because it has the highest confidence.

Canonical reference:

`docs/AREA52_CAUSAL_EVENT_MEMORY_AND_HYPOTHESES.md`

Project card: #119.

## Semantic Lore Compiler

Lorebooks remain curriculum.

The Lore Study pipeline may compile exact lore source into multiple typed machine representations:

- entities;
- aliases;
- claims;
- properties;
- relationships;
- rules;
- capabilities;
- restrictions;
- events;
- ontology;
- hierarchy/community;
- retrieval forms;
- dependency edges.

Compilation never replaces exact source.

### Lore Tree is preserved

The traditional **Lore Tree remains first-class**.

It continues to provide human-facing organization, navigation and editing through folders, categories and nested entries.

Area-52's learned ontology, graph, semantic communities and retrieval hierarchies coexist with the Lore Tree.

They augment it.

They do not replace it or silently rearrange operator-authored structure.

## Semantic diff and impact analysis

A source edit should eventually be understandable at the level of meaning:

```text
source revision changed
 -> claims/rules/relationships changed
 -> dependency cone identified
 -> affected derived artifacts rebuilt
 -> unrelated artifacts preserved
```

Semantic diff complements ordinary text diff.

Impact preview may show likely affected/unaffected knowledge before propagation, while final validated recompilation remains authoritative.

Canonical reference:

`docs/AREA52_LORE_COMPILER_SEMANTIC_DIFF.md`

Project card: #120.

## Combined Brain loop

These systems extend the canonical loop:

```text
SOURCE + EXPERIENCE
        |
        v
STUDY / SEMANTIC COMPILE
        |
        +--------------------------+
        |                          |
        v                          v
TEMPORAL + CAUSAL WORLD MODEL   EPISODIC MEMORY
        |                          |
        |                          v
        |                    REFLECTION
        |                          |
        +------------+-------------+
                     |
                     v
               RETRIEVAL / USE
                     |
             +-------+-------+
             |               |
             v               v
       TRUTH/PRECISION   LEARNING FEEDBACK
             |               |
             |               v
             |         RECONSOLIDATION
             |               |
             +-------+-------+
                     |
                     v
              CONTEXT COMPILER
                     |
                     v
                    MAIN
```

The critical invariant remains:

> **Models propose. Schemas validate. Provenance explains. Revisions fence. Owners settle. Golden worlds test.**
