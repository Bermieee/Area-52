# Area-52 Advanced Memory + State-Aware Retrieval Reference

**Canonical integration branch:** `Development-Nexus`  
**Primary consumers:** `Development-Memory`, `Development-Lorebook-Editor`, `Development-Scene-Scanner`, `Development-Sidecar/Jev`  
**Purpose:** preserve the advanced memory/retrieval architecture discussed during Area-52 planning so specialist branches do not need chat history to reconstruct it.

---

# 1. The architectural shift

Traditional RAG is usually:

```text
query
  -> retrieve static chunks
  -> inject
  -> generate
```

Area-52 is intentionally moving toward:

```text
SOURCE + EXPERIENCE
        |
        v
   STUDY / OBSERVE
        |
        v
DERIVED UNDERSTANDING
        |
        +--------------------+
        |                    |
        v                    v
TEMPORAL WORLD STATE     REFLECTION / LEARNED MEMORY
        |                    |
        +----------+---------+
                   |
                   v
          STATE-AWARE RETRIEVAL
                   |
                   v
            CONTEXT COMPILER
```

The goal is not just to remember text.

The goal is to maintain a self-organizing model of:

- what the world is;
- what happened;
- what is true now;
- what used to be true;
- what is uncertain;
- what repeated experience appears to mean;
- which evidence supports every belief.

---

# 2. Write-back knowledge graph — corrected Area-52 form

A naive implementation would allow a background model to directly update graph state.

Area-52 must **not** do that.

Correct flow:

```text
narrative/source evidence
        |
        v
background extractor
        |
        v
typed state-change proposal
        |
        v
schema validation
        |
        v
evidence + revision validation
        |
        v
Settlement Engine
        |
        v
Temporal State Graph
```

Example narrative:

```text
"The Ember Tavern burned to the ground."
```

Potential worker proposal:

```text
type: SET_STATE
subject: EmberTavern
predicate: structural_state
value: destroyed
evidence: [Turn492]
worldRevision: W118
authority: OBSERVED
```

Only the owning settlement path may admit it.

## Why this matters

One hundred turns later, retrieval for Ember Tavern should not blindly return:

```text
Ember Tavern is a warm, intact tavern.
```

It should be able to recover:

```text
CURRENT:
Ember Tavern -> destroyed

HISTORICAL:
Ember Tavern -> intact
valid until FireEvent492
```

The original description remains valid history.

The newer state does not erase it.

---

# 3. Mutable lore does not mean mutable source

Area-52 distinguishes:

```text
SOURCE CANON
DERIVED UNDERSTANDING
CURRENT STATE
HISTORICAL STATE
LEARNED INFERENCE
```

A world-state update must never rewrite the original source file merely to make retrieval convenient.

Instead:

```text
Source record
    |
    +-> extracted claim A
    |
    +-> extracted claim B
            |
            v
      Temporal State Graph
```

This makes relearning, rollback and historical queries possible.

---

# 4. Temporal graph write-back

Mutable properties and relationships should be temporal.

Bad:

```text
Tavern.state = destroyed
```

Better:

```text
Claim 101
Tavern --state--> intact
validFrom=T0
validUntil=T492
status=HISTORICAL

Claim 207
Tavern --state--> destroyed
validFrom=T492
validUntil=open
status=CURRENT
evidence=FireEvent492
```

Relationships can also evolve:

```text
Eris --carries--> SunBlade
valid T0..T1

SunBlade --located_at--> EmberTavern
valid T1..T3

SunBlade --state--> destroyed
valid T3..
```

Or remain unresolved if conflicting evidence exists.

---

# 5. Graph mutation adapter

An implementation may eventually use:

- Cypher;
- Gremlin;
- SQL graph tables;
- a native graph API;
- another persistence adapter.

This is intentionally **not** a semantic dependency.

The canonical interface is a typed state/relationship mutation request.

Storage syntax belongs behind the persistence adapter.

For example, a future Neo4j adapter might translate a settled state transition into Cypher, but no model should generate arbitrary Cypher and receive unrestricted write authority.

---

# 6. Autonomous background reflection — corrected Area-52 form

The simple pattern:

```text
every 20-50 turns -> summarize recent conversation
```

is useful as inspiration but too blunt for Area-52.

Area-52 uses **reflection eligibility**.

A reflection may become eligible because of:

- accumulated supporting evidence;
- repeated behavior;
- a major state transition;
- contradiction;
- a relationship change;
- scene closure;
- narrative transition;
- idle background capacity;
- consolidation pressure.

Cadence may create an opportunity to check.

Cadence alone must not force a reflection.

---

# 7. Reflection object

A reflection is an inferred artifact.

Example:

```text
reflectionId: R14
subject: Mara
pattern: increasingly distrustful of Eris over the gold dispute
authority: INFERRED
confidence: 0.78
evidence:
  - Scene17
  - Scene21
  - Scene26
worldRevision: W221
status: SUPPORTED
```

Reflection may later:

- strengthen;
- weaken;
- gain evidence;
- lose evidence;
- be contradicted;
- split;
- merge;
- become historical;
- become superseded;
- be rejected.

It must not masquerade as source canon.

---

# 8. Reflections are not a replacement for raw dialogue

Area-52 should **not** vectorize reflections and throw raw dialogue away.

Correct hierarchy:

```text
RAW EXPERIENCE
      |
      +-> episode representation
      |
      +-> extracted claims/events
      |
      +-> reflection
```

Retrieval can prefer the compact higher-level representation when sufficient.

But raw experience remains recoverable for:

- exact quotes;
- disputed evidence;
- relearning;
- provenance;
- debugging;
- historical reconstruction.

---

# 9. Episodic compression

Closed scenes should become coherent episodic units rather than arbitrary token windows.

A SceneEpisode may contain:

- source turn range;
- active cast;
- location/time;
- significant events;
- state transitions;
- relationship changes;
- open/resolved threads;
- atmosphere trajectory;
- compact summary;
- provenance;
- embedding/index references.

This gives retrieval a semantically coherent memory object.

---

# 10. Sparse Priming Representation / dense semantic packets

SPR is useful as a **compression design pattern**.

The safe Area-52 interpretation is:

> preserve the semantic activation cues and relationships Main needs while removing redundant prose.

Example verbose lore:

```text
Blood magic requires the practitioner to physically sacrifice blood.
Greater effects require greater blood loss. The practice is culturally
taboo and most public institutions prohibit it.
```

Possible dense representation:

```text
BloodMagic:
  medium=blood
  cost scales with effect
  output=variable
  cultural_status=taboo
  institutional_status=prohibited
```

This representation is compact but still diagnosable.

---

# 11. SPR safety rule

Never assume:

> the model will perfectly reconstruct whatever cryptic shorthand we give it.

Compression must be measured.

Required evaluation:

- fact retention;
- temporal qualifier retention;
- contradiction retention;
- relationship retention;
- model portability;
- token reduction;
- latency;
- failure mode when a field is omitted.

Area-52's internal representation should remain structured and inspectable.

A model-specific Prompt Loader adapter may later render that structure more aggressively.

---

# 12. Model-independent semantic packet

Internal memory must not become tied to MiMo, GLM, DeepSeek, Claude, Gemini, Qwen, OpenAI or another Main model.

Preferred architecture:

```text
canonical Area-52 semantic packet
              |
              v
       Prompt Loader adapter
              |
      +-------+-------+
      |       |       |
    MiMo     GLM    other
```

This lets compression/presentation evolve without changing canonical memory.

---

# 13. State-aware retrieval

Retrieval should consider both relevance and temporal state.

Example query:

```text
"Where can Eris find the Sun Blade?"
```

A semantically relevant historical memory:

```text
Eris carried the Sun Blade.
```

must not be injected as current truth.

Candidate flow:

```text
broad retrieval
    |
    v
Candidate Bus
    |
    v
Truth Gate
    |
    +-> CURRENT
    +-> HISTORICAL
    +-> SUPERSEDED
    +-> CONTRADICTED
    +-> UNCERTAIN
    +-> UNRESOLVED
    |
    v
Precision / Context Compiler
```

Relevance and truth are separate questions.

---

# 14. Self-organizing memory

The long-term target is a memory system that reorganizes around experience.

Possible background transformations:

- source -> entities/claims/relationships;
- turns -> events;
- events -> SceneEpisodes;
- episodes -> reflections;
- claims -> temporal state;
- repeated concepts -> hierarchy/community;
- source edits -> dependency-cone relearning;
- retrieval outcomes -> non-canonical learning feedback;
- stale representations -> rebuild/invalidation.

None of these transformations delete source evidence.

---

# 15. Learning feedback

Retrieval itself can teach the system operationally.

Signals may include:

- repeated co-retrieval;
- repeated reranker selection;
- repeated Truth Gate rejection;
- repeated reflection support;
- repeated false-positive channel results;
- repeated compiler admission;
- repeated stale-cache rejection.

Feedback may influence:

- channel weighting;
- nomination policy;
- caches;
- confidence;
- warm-state selection;
- prefetch.

It must never silently rewrite canon.

---

# 16. Branch responsibilities

## Development-Lorebook-Editor

Owns:

- source study;
- contextual retrieval representations;
- entities/claims/rules extraction;
- ontology/hierarchy proposals;
- source-revision dependency mapping.

Must not settle current world truth.

## Development-Memory

Owns:

- Experience;
- Reflection;
- temporal state;
- consolidation;
- learning feedback.

Must retain evidence/provenance.

## Development-Scene-Scanner

Owns:

- CurrentScene;
- scene deltas;
- scene boundaries;
- SceneEpisodes;
- active cast/location/time proposals.

Must not directly canonize world state.

## Development-Sidecar/Jev

Owns semantic worker implementations such as:

- extraction;
- reranking;
- bounded truth judgment;
- reflection workers.

Workers propose only.

## Development-Nexus

Owns cross-lane contracts, settlement integration, Truth Gate integration and Context Compiler publication behavior.

---

# 17. Failure behavior

If reflection is unavailable:

> story continues without new reflections.

If temporal settlement is ambiguous:

> preserve UNRESOLVED.

If compression loses facts in evaluation:

> fall back to richer representation.

If graph storage is unavailable:

> source/claims remain intact and alternative retrieval continues.

If a background write-back proposal is stale:

> reject or recompute; do not mutate current state.

---

# 18. Acceptance targets

A mature implementation should prove:

1. current state differs correctly from historical state;
2. write-back updates settled state without overwriting source;
3. conflicting evidence remains unresolved when appropriate;
4. reflections retain evidence;
5. removing supporting evidence can weaken/invalidate a reflection;
6. raw experience remains recoverable;
7. compressed semantic packets preserve required facts;
8. state-aware retrieval rejects stale-current misuse;
9. source edits invalidate only their truthful dependency cone;
10. no model output directly gains canonical mutation authority.

---

# 19. Related Area-52 work

Relevant existing issue families include:

- #4 Lore Study Engine
- #5 Temporal State Graph
- #9 Reflection + consolidation
- #31 Reflection eligibility
- #37 Settlement Engine
- #39 Learning feedback
- #40 temporal graph/Graphiti benchmark
- #43 context compression benchmark
- #56 contextual retrieval representation
- #97-#117 Scene Intelligence

This document is reference material for those systems. It does not create new project-card ownership.

---

# 20. Summary

Area-52's long-term memory should behave less like a static search index and more like an evidence-backed evolving world model:

```text
remember source
understand source
observe experience
update state
preserve history
reflect cautiously
retrieve broadly
verify truth
compress safely
explain provenance
```

The goal is **self-organizing, state-aware memory without surrendering epistemic control to the models that propose the organization.**
