# Area-52 Native Lore Study — Wave 1

**Branch:** Development-Lorebook-Editor  
**Architecture:** specialization of docs/AREA52_COGNITIVE_MEMORY_BLUEPRINT.md  
**Scope:** native Lore producer for future FT004 integration

## Purpose

Wave 1 turns a lorebook into a revisioned curriculum rather than a bag of indexed text. Exact authored source and learned understanding remain separate. The source registry owns source identity and append-only revision history; the study runtime owns Lore-derived artifacts and lifecycle truth. Nothing in this lane owns Candidate Bus, Truth Gate, Precision, Gather, Context Seal, Settlement, Jev, UI, or physical worker scheduling.

## Production path

Lorebook entry -> stable source identity -> exact source revision -> structural/contextual study -> entity/alias extraction -> atomic claims and relationships -> temporal hints -> ontology/community foundation -> sparse/dense-ready/precision-ready retrieval forms -> compact learned representation -> validation -> atomic learned-revision publication.

The implementation is deliberately multi-resolution. Current public output can expose source/entry, contextual chunk, entity, alias, claim, relationship, concept/community, retrieval, and compact artifacts without downstream consumers understanding Lore internals.

## Source and revision contract

A source entry is identified by lorebook identity plus UID. Revisions append; they do not overwrite history. Each revision retains exact authored content, content hash, source metadata, title/tags/scope/order, Lore Tree path, lineage, and provenance. Removal appends a removal revision and keeps prior exact revisions recoverable.

Lore Tree placement is structural evidence only. Structure artifacts explicitly carry no truth authority. Learned ontology does not mutate the human-authored Tree.

## Study artifacts and authority

Every learned artifact carries artifact ID, stable semantic ID, source ID, exact source revision ID, provenance, temporal class, authority class, dependencies, confidence, unresolved state, and freshness.

Explicit source statements may produce source-class atomic claims, but inference, contextualization, retrieval forms, ontology/community membership, summaries, scores, and embeddings never gain SOURCE_CANON merely by derivation. Retrieval score is not truth. Similarity is not identity. Community membership is not canon.

## Temporal and ambiguity behavior

Study preserves TIMELESS, CURRENT-like, HISTORICAL, SEQUENCE, UNCERTAIN, and CONFLICTING-style hints without pretending to own the complete Temporal State system. Reported or uncertain alternatives remain unresolved. Compatible evidence may coexist. Conflicting alternatives are exposed as LoreConflictSet records for later Truth/Jev evaluation; Lore does not select a winner.

## Incremental relearning and semantic diff

A changed UID creates a new exact source revision and a new study obligation. The previous fully committed learned revision remains inspectable while the replacement is staged. Retrieval-facing current output refuses to expose a learned revision whose source revision is stale.

The impact preview identifies the old artifacts in the changed source dependency cone and counts unrelated current artifacts that remain reusable. Semantic diff compares stable semantic identities and reports additions, removals, preserved meanings, value changes, temporal meaning changes, and authority/unresolved changes. Unrelated source learned revisions are not rebuilt.

Removal immediately prevents the removed UID from appearing as active retrieval material. Its historical source and historical learned revisions remain inspectable.

## Lifecycle, checkpoint, yield, and resume

Lore owns whether study is due. Runtime/Worker Director will later own physical execution priority.

Lifecycle vocabulary: DUE, PENDING, ACTIVE, CHECKPOINTED, COMPLETED, SUPERSEDED, STALE, INVALID.

Repeated equivalent revision triggers coalesce. A newer source revision supersedes older restartable work. Study advances through bounded units:

1. STRUCTURE_CONTEXT
2. ENTITY_ALIAS
3. CLAIM_RELATIONSHIP
4. TEMPORAL_ONTOLOGY
5. RETRIEVAL
6. COMPILE
7. VALIDATE

A checkpoint stores the completed unit index and checksum. Snapshot/restore resumes from the next unit. Staged artifacts do not become current before validation. Completed/superseded sessions are discarded so checkpoint state does not grow with historical completed work.

## Retrieval representations

Each fresh learned source publishes:
- exact source form through the Source Registry;
- contextual sparse form with terms and structural context;
- dense-ready text contract with no embedding authority;
- precision/late-interaction-ready token/entity/claim references with no score authority;
- compact learned representation.

Every form drills back to its exact source revision.

## Ontology and hierarchy foundation

Wave 1 derives bounded concept memberships and small communities from supported evidence. Examples include person/location/object classes plus evidence-backed inferred roles such as proprietor, and lexical subtype foundations such as tavern/location and sword/weapon. These are DERIVED or INFERRED, never source canon.

This is a foundation for future RAPTOR/GraphRAG work, not the final clustering product.

## Public integration surface

LoreStudyRuntime.publicSurface() exposes versioned, typed, read-only integration records. It retains source/revision identity, provenance, authority, temporal hints, freshness, artifact references, retrieval representations, and unresolved conflicts. It declares no Candidate Bus, Truth Gate, Precision, Gather/Seal, Settlement, Runtime scheduling, or physical-worker authority.

## FT004 readiness boundary

This wave can produce real learned Lore artifacts suitable for future retrieval nomination. It does not claim the full Lore -> Candidate Bus -> Truth -> Precision -> Gather -> Seal -> PromptPlan path has passed. That requires deliberate main assembly and live SillyTavern acceptance under #179/#224.

## Validation matrix

The branch CI runs:
- focused Source Registry and native Lore Study tests;
- Ember Tavern golden;
- edit/relearn and semantic-diff proof;
- removed-UID proof;
- ambiguity/conflict proof;
- lifecycle/dedupe proof;
- checkpoint/snapshot/resume proof;
- authority-negative assertions;
- retrieval-representation assertions;
- bounded artifact-growth proof;
- browser-source portability audit;
- representative 1,000-edit stress;
- JavaScript syntax;
- direct ESM imports.

Exact run IDs and final SHA are recorded in the Worker handoff because a workflow run ID does not exist until after the commit is published.
