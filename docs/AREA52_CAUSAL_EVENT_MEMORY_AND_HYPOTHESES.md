# Area-52 Causal / Event Memory + Competing Hypothesis Sets

**Canonical integration branch:** `Development-Nexus`  
**Primary implementation lane:** `Development-Memory`  
**Primary project card:** #119  
**Inputs:** Scene Intelligence, Experience, Temporal State, Lore Study  
**Purpose:** extend Area-52 from remembering what happened and when to preserving evidence-backed models of why events happened, without confusing sequence with causality or hypotheses with fact.

---

# 1. Why event memory is separate from state

Temporal State answers questions such as:

- What is true now?
- What was true before?
- When did a property change?
- Which claim superseded another?

Event memory answers a different family of questions:

- What happened?
- Which event changed the state?
- Why did it happen?
- What enabled or prevented it?
- What motive was proposed?
- Which explanations remain plausible?

These representations cooperate but should not be collapsed.

---

# 2. Event-centric memory

A durable event may contain:

- event ID;
- event type;
- participants;
- location;
- narrative time;
- source evidence;
- SceneEpisode references;
- affected entities;
- state-change proposals/results;
- authority class;
- confidence;
- source/world/scene revisions;
- provenance;
- related events;
- causal/support relations.

A SceneEpisode may contain several events.

An event may span or connect multiple scenes.

---

# 3. Chronology is not causality

Area-52 must never infer:

```text
A happened before B
therefore
A caused B
```

Temporal relations remain distinct:

- PRECEDES;
- FOLLOWS;
- OVERLAPS;
- DURING;
- BEFORE / AFTER.

Causal relations are separate:

- CAUSES;
- ENABLES;
- PREVENTS;
- MOTIVATES;
- RESULTS_IN;
- CONTRIBUTES_TO;
- SUPPORTS;
- CONTRADICTS.

Causal links require evidence and provenance.

---

# 4. Causal relation object

A causal relationship should retain enough structure to be challenged.

Conceptually:

```text
relationId
sourceEventId
targetEventOrStateId
relationType
authorityClass
confidence
supportEvidenceIds[]
contradictionEvidenceIds[]
sourceRevisionIds[]
worldRevision
temporalApplicability
status
```

Models may propose these relations.

No model gains unrestricted write authority to the causal graph.

---

# 5. Example — Ember Tavern

Observed evidence:

```text
FireEvent17 occurred at Ember Tavern.
Tavern state became destroyed.
Sun Blade was reported destroyed.
A later journal claims the Blade was removed before the fire.
```

Area-52 may be able to settle:

```text
FireEvent17 CAUSES EmberTavern.state=destroyed
```

while preserving uncertainty around:

```text
FireEvent17 CAUSES SunBlade.state=destroyed
```

because the journal creates a competing explanation.

The graph must permit one relation to be settled and another to remain unresolved even though they share the same event.

---

# 6. Competing hypothesis sets

A hypothesis set preserves multiple explanations without inventing certainty.

Example:

```text
Question:
What happened to the Sun Blade?

H1:
Blade remained in Tavern and was destroyed by the fire.

H2:
Blade was removed before the fire and survived.

H3:
Journal is inaccurate; destruction report is correct.
```

Each hypothesis may maintain:

- hypothesis ID;
- proposition;
- supporting evidence;
- opposing evidence;
- authority;
- confidence;
- created revision;
- updated revision;
- status;
- dependencies;
- alternatives.

Confidence is useful for prioritization.

Confidence alone does not settle a hypothesis as fact.

---

# 7. Hypothesis lifecycle

Possible states include:

- PROPOSED;
- SUPPORTED;
- WEAKENED;
- CONTRADICTED;
- UNRESOLVED;
- RESOLVED;
- SUPERSEDED;
- HISTORICAL.

A hypothesis may:

- gain support;
- lose support;
- split;
- merge;
- become impossible;
- resolve through stronger evidence;
- remain unresolved indefinitely.

Resolution should preserve the earlier competing-hypothesis history for audit and narrative reconstruction.

---

# 8. Lies, unreliable narrators and mysteries

This structure is particularly valuable for roleplay worlds.

Different sources may sincerely or deceptively claim incompatible explanations.

Area-52 should retain:

- who made the claim;
- what evidence existed;
- what the claimant could reasonably know;
- authority class;
- later confirming/contradicting evidence.

The Brain should be able to know:

> Character A believes X.

without asserting:

> X is canonically true.

---

# 9. Scene Intelligence integration

Scene Intelligence is a major evidence producer.

It may emit:

- SceneEpisodes;
- observed events;
- location/time transitions;
- active participants;
- immediate state-change evidence;
- relation candidates.

Scene Intelligence may nominate a causal candidate.

It does not directly settle durable causal truth.

Scene graph relationships such as PRECEDES, FLASHBACK_OF or RESUMES must remain distinct from causal edges.

---

# 10. Temporal State integration

Causal/Event Memory and Temporal State should link bidirectionally through stable IDs.

Example:

```text
Event:
FireEvent17

Temporal transition:
EmberTavern.state
intact -> destroyed

causedBy:
FireEvent17
```

Historical reconstruction can then answer both:

- when the Tavern changed state;
- which settled event caused the change.

---

# 11. Reflection integration

Repeated causal patterns may support Reflection.

Example:

```text
Episode 4: Mara shields civilians
Episode 11: Mara abandons pursuit to evacuate civilians
Episode 19: Mara blocks an attack on civilians
```

Reflection may infer:

```text
Mara tends to prioritize civilian safety.
```

The Reflection is still INFERRED.

Event evidence makes the derivation richer; it does not bypass the Reflection/Settlement rules.

---

# 12. Retrieval

Causal retrieval should be an additional candidate channel/intention, not a replacement for broad retrieval.

Possible query intents:

- WHY;
- CAUSE;
- CONSEQUENCE;
- MOTIVE;
- PRECONDITION;
- COUNTERFACTUAL_EVIDENCE;
- INVESTIGATION;
- HYPOTHESIS.

Candidate output may include:

- relevant events;
- causal relations;
- temporal state;
- hypotheses;
- support/contradiction evidence;
- source passages.

Truth Gate decides how each may be used.

---

# 13. Context compilation

The Context Compiler must preserve uncertainty.

Bad:

```text
The Sun Blade burned in the Tavern fire.
```

when evidence is unresolved.

Better:

```text
SunBlade final fate = UNRESOLVED
- H1 destroyed in FireEvent17
- H2 removed before fire
Evidence exists for both.
```

Main should receive the uncertainty, not a fabricated winner.

---

# 14. Causal compression

Causal memory can produce dense but inspectable packets.

Example:

```text
FireEvent17:
  caused -> EmberTavern.destroyed [SETTLED]
  may_have_caused -> SunBlade.destroyed [UNRESOLVED]
  competing -> BladeRemovedBeforeFire
```

Compression must preserve:

- relation type;
- uncertainty;
- temporal scope;
- evidence identity.

---

# 15. Runtime placement

Typical work:

- immediate event extraction: L2 Nearline;
- causal proposal creation: L2/L3;
- hypothesis reconciliation: L3;
- deep causal consistency audit: L4.

Large event/cause graph work must be batched and resumable.

---

# 16. Anti-cascade rules

A derived causal inference must not become evidence for itself.

Never permit:

```text
model proposes A caused B
 -> causal edge is stored
 -> next worker treats stored edge as independent evidence
 -> confidence rises
 -> edge becomes canon
```

Derived artifacts retain derivation lineage.

Independent evidence must remain distinguishable from reused inference.

---

# 17. Acceptance targets

A mature implementation should prove:

1. chronology and causality remain distinct;
2. causal links are provenance-backed;
3. state transitions may link to causal events;
4. competing hypotheses remain explicit;
5. one hypothesis can weaken without erasing alternatives;
6. resolution preserves hypothesis history;
7. unreliable claims can be represented without becoming world truth;
8. causal queries retrieve relevant event structure;
9. Context Compiler preserves unresolved explanations;
10. derived causal claims cannot self-validate.

---

# 18. Project relationships

Primary card:

- #119 Causal/Event Memory + competing hypothesis sets

Related work:

- #5 Temporal State Graph
- #9 Reflection/consolidation
- #37 Settlement
- #103 Scene Episode Compiler
- #110 Scene Graph + temporal adjacency
- #7 Truth Gate
- #10 Context Compiler

Causal/Event Memory is an organ of the same Area-52 Brain.

It is not a separate authority system.

---

# 19. Final principle

> **Area-52 should remember not only that the world changed, but the evidence-backed story of how and why it changed — including when that story is still uncertain.**
