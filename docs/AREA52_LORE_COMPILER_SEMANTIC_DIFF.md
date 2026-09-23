# Area-52 Semantic Lore Compiler + Diff / Impact Analysis

**Canonical integration branch:** `Development-Nexus`  
**Primary implementation lane:** `Development-Lorebook-Editor`  
**Primary project card:** #120  
**Related systems:** Lore Study, Source Registry, Ontology/Hierarchy Learning, Contextual Retrieval, Provenance, Dependency Invalidation  
**Purpose:** define lore ingestion as a semantic compilation process while preserving the familiar Lore Tree as a first-class human-facing structure.

---

# 1. The Lore Tree stays

Area-52 will continue to support a traditional **Lore Tree**.

This is an explicit product and architecture requirement.

Many users naturally understand lore through:

- folders;
- categories;
- branches;
- nested topics;
- character sections;
- location sections;
- manually curated groupings.

That representation is useful.

Area-52 does not need to replace it merely because the Brain also uses graphs, embeddings, ontologies and derived semantic structures.

The correct architecture is:

```text
                 HUMAN VIEW
                 LORE TREE
                     |
                     v
               EXACT SOURCE
                     |
                     v
              LORE COMPILER
                     |
        +------------+------------+
        |            |            |
        v            v            v
      claims       graph       retrieval
      rules        ontology    representations
      events       hierarchy   embeddings
        |            |            |
        +------------+------------+
                     |
                     v
               AREA-52 BRAIN
```

The Lore Tree is not obsolete.

It is one useful representation among several.

---

# 2. Lore Tree invariant

The Lore Tree is a **human-authored organizational structure**.

Area-52 may use its structure as contextual metadata.

Examples:

- parent category may establish topic context;
- sibling entries may suggest related concepts;
- path may aid contextual chunking;
- branches may guide navigation;
- operator ordering may carry intentional organization.

However:

> tree placement does not automatically create semantic truth.

If an entry is placed under `Enemies`, the Brain should not silently convert that folder label into a canonical relationship unless the appropriate evidence/authority rules support it.

---

# 3. Lore as source code for the world model

The Lore Compiler treats human-authored lore as a rich source representation.

Compilation creates derived products without rewriting the original.

Conceptual pipeline:

```text
Lore Tree entry
     |
     v
exact source revision
     |
     v
structural/context reading
     |
     v
semantic extraction
     |
     +--> entities / aliases
     +--> claims / properties
     +--> relationships
     +--> rules
     +--> capabilities
     +--> restrictions
     +--> events
     +--> concepts / ontology
     +--> hierarchy/community
     +--> retrieval representations
     +--> dependency graph
     +--> compact compiled forms
```

This extends the existing Lore Study Engine rather than replacing it.

---

# 4. Source preservation

Every compilation product must be traceable to an exact source revision.

The compiler never edits source merely to make machine retrieval easier.

A user can change the Lore Tree or source text explicitly.

Area-52 then recompiles the affected dependency cone.

---

# 5. Structural context

The compiler may use Lore Tree structure during study.

A leaf such as:

```text
Characters
  -> Hestia Familia
     -> Enoch
        -> Equipment
           -> Solace
```

contains useful context that may not appear inside every sentence.

A derived retrieval form may therefore include contextual labels such as:

```text
Entity: Enoch
Category: Equipment
Item: Solace
...
```

while the exact source remains untouched.

---

# 6. Semantic products

The compiler should preserve distinct artifact classes.

Do not flatten everything into generic text chunks.

Potential products:

- Entity;
- Alias;
- Claim;
- Property;
- Relationship;
- Rule;
- Capability;
- Restriction;
- Event;
- Concept;
- Ontology proposal;
- Hierarchy/community membership;
- Retrieval representation;
- Compiled semantic packet;
- Dependency edge.

Each type has different authority and invalidation semantics.

---

# 7. Semantic diff

Traditional text diff answers:

> Which characters or lines changed?

Semantic diff should additionally answer:

> What meaning changed?

Example:

```text
revision 14 -> 15

text change:
"Akira can use fire and water."
->
"Akira can use all known elemental affinities."

semantic change:
- capability modified
- affinity scope widened
- 1 prior restriction superseded
- 3 retrieval representations stale
- 1 ontology membership changed
- unrelated relationship artifacts unaffected
```

This makes large lorebooks safer to maintain.

---

# 8. Semantic diff categories

Useful change categories include:

- entity added/removed/renamed;
- alias added/removed;
- claim added/removed/changed;
- property changed;
- relationship changed;
- rule introduced/superseded;
- capability widened/narrowed;
- restriction added/removed;
- event changed;
- temporal qualifier changed;
- ontology classification changed;
- retrieval representation stale;
- dependent Reflection requires reevaluation;
- dependent current-state proposal requires review;
- no semantic change.

A whitespace or formatting edit may legitimately produce:

```text
semantic changes: none
```

---

# 9. Impact analysis

Semantic diff feeds dependency impact analysis.

Conceptually:

```text
changed source revision
       |
       v
semantic diff
       |
       v
dependency graph
       |
       +--> invalidate
       +--> rebuild
       +--> reevaluate
       +--> preserve
```

The goal is not to rebuild the entire Brain whenever one lore entry changes.

Invalidate the smallest truthful dependency cone.

---

# 10. Impact preview

Where practical, the editor should be able to preview likely effects before propagation.

Example:

```text
Editing: Nanahoshi - Mana Physiology

Affected:
  2 claims
  1 restriction
  3 retrieval forms
  1 causal hypothesis
  1 reflection reevaluation

Preserved:
  East Tower location history
  Akira/Darius relationship history
  unrelated summoning research
```

Impact preview is advisory until the actual validated compilation/relearning pass completes.

Do not pretend preflight prediction is authoritative if the final semantic extraction differs.

---

# 11. Stable identity and rename handling

Lore refactoring must distinguish:

- a renamed entity;
- a new entity;
- an alias;
- a moved tree entry;
- a semantically unchanged entry;
- a genuinely replaced concept.

Stable identities should survive harmless reorganization where evidence supports continuity.

Moving a card between Lore Tree folders should not necessarily create a new entity.

---

# 12. Ontology learning

Repeated lore patterns may suggest reusable schema.

Example recurring concepts:

- SPELL;
- AFFINITY;
- MANA_SOURCE;
- CASTING_RESTRICTION;
- FAMILIA_ROLE;
- ITEM_STATE.

Area-52 may propose ontology modules.

These are learned structural proposals.

They do not rewrite original lore.

---

# 13. Ontology refactoring

A later operator-approved ontology may reorganize derived representations.

For example:

```text
generic relationship
"can use"
```

may become more specific derived structure:

```text
Capability:
  actor=Akira
  domain=ElementalMagic
  allowedAffinities=[...]
```

Source still reads exactly as authored.

Lore Tree still appears exactly as organized unless the user edits it.

---

# 14. Tree + graph coexistence

The Tree and graph solve different problems.

Lore Tree:

- human navigation;
- deliberate organization;
- editing;
- browsing;
- source grouping.

Semantic graph:

- entity relationships;
- multi-hop traversal;
- temporal state;
- causal/event relationships;
- machine reasoning.

Neither should be forced to impersonate the other.

A graph does not replace the Lore Tree.

A Lore Tree does not replace semantic relationships.

---

# 15. Tree + hierarchy/community coexistence

Learned RAPTOR/GraphRAG-style hierarchy/community structures also do not replace the Lore Tree.

Area-52 may simultaneously maintain:

1. operator-authored Lore Tree;
2. learned ontology;
3. learned semantic communities;
4. retrieval hierarchy;
5. temporal/causal graphs.

This is intentional multi-representation architecture.

---

# 16. Retrieval representations

The compiler may derive representations specialized for:

- sparse search;
- dense embeddings;
- late interaction;
- graph retrieval;
- hierarchy retrieval;
- rule lookup;
- event lookup.

A single source entry may therefore produce multiple retrieval artifacts.

All remain linked to the same source revision.

---

# 17. Recompilation

A source edit follows:

```text
new source revision
 -> semantic diff
 -> identify dependent artifacts
 -> mark truthful stale set
 -> schedule recompilation
 -> validate new products
 -> atomically replace derived active forms
 -> retain historical revisions/provenance
```

Large recompilation uses Runtime Fabric batching/checkpoints.

---

# 18. Failure behavior

If semantic extraction fails:

> exact source remains valid and recoverable.

If ontology inference fails:

> ordinary retrieval representations remain available.

If impact analysis is uncertain:

> invalidate/rebuild a conservative bounded dependency set rather than pretending precision.

If a derived representation is stale:

> do not publish it as fresh.

If Lore Tree rendering fails:

> Brain knowledge remains intact; UI structure can rebuild from stored tree metadata.

---

# 19. UI implications

The Lore Editor can eventually show two coordinated views:

**Lore Tree**
- familiar folders/categories/cards;
- operator editing/navigation.

**Semantic Inspector**
- compiled artifacts;
- provenance;
- dependencies;
- semantic diff;
- impact preview;
- ontology/graph relations.

Selecting a Lore Tree node may reveal its compiled semantic footprint.

This allows advanced cognition without sacrificing usability.

---

# 20. Acceptance targets

A mature implementation should prove:

1. Lore Tree remains a first-class human-facing structure;
2. moving/reorganizing tree entries does not unnecessarily destroy stable semantic identity;
3. exact source remains recoverable by revision;
4. compilation produces distinct typed derived artifacts;
5. every artifact has provenance;
6. semantic diff detects meaningful changes beyond line diff;
7. semantically null edits do not force unnecessary relearning;
8. impact analysis identifies affected and unaffected artifacts;
9. source edits invalidate the smallest truthful dependency cone;
10. ontology refactoring never silently rewrites source or Lore Tree;
11. retrieval continues when one derived representation type fails.

---

# 21. Project relationships

Primary card:

- #120 Semantic Lore Compiler + diff/impact analysis while preserving Lore Tree

Existing related work:

- #4 Lore Study Engine
- #30 Lore Study lifecycle
- #36 Ontology + hierarchy learning
- #47 Provenance/document lifecycle
- #48 RAPTOR + GraphRAG study
- #56 Contextual retrieval representation
- #38 Revision-keyed cache/invalidation

The Lore Compiler is an evolution of Lore Study, not a replacement subsystem.

---

# 22. Final principle

> **Keep lore pleasant for humans and compile it richly for machines.**

The Lore Tree survives.

The Brain gains additional representations behind it.
