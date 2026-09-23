# Area-52

Area-52 is the isolated research and development repository for the next-generation Nexus cognitive memory architecture.

The project explores a self-teaching external memory system that continuously turns narrative experience into structured, provenance-backed understanding without granting language models direct canonical mutation authority.

## Core loop

```text
Observe
  -> Extract evidence
  -> Reflect
  -> Reconcile current truth
  -> Propose typed changes
  -> Validate / settle
  -> Retrieve broadly
  -> Verify truth
  -> Rerank
  -> Compile model-specific context
  -> Generate
  -> Observe again
```

## Cognitive layers

- **Experience** — what happened, with source provenance.
- **Reflections** — what repeated evidence appears to mean; explicitly inferential.
- **Temporal State Graph** — what is currently believed true, what used to be true, and why.
- **Specialized semantic stores** — Character State, Durable Lore, Notebook, and future domain-specific memory.
- **Retrieval cognition** — broad candidate nomination followed by truth verification and precision filtering.
- **Context compiler** — dense, model-independent memory packets that can later be rendered through model-specific adapters.
- **Settlement** — typed proposals and authority checks before canonical state changes.

## Non-negotiable safety / authority rules

1. Models propose; they do not directly mutate canonical memory.
2. Every learned claim retains evidence and provenance.
3. Inference is distinct from observed fact.
4. Superseded knowledge is historical, not deleted.
5. Current truth is temporal and revisioned.
6. Retrieval must distinguish current, historical, contradicted, and unresolved claims.
7. Reflection cadence is eligibility, not automatic authority.
8. Existing Nexus systems are integration targets, not dependencies of the prototype.

## Status

**0.1-dev — cognitive contracts and executable prototype.**

This repository is intentionally isolated from the production Nexus repository until the architecture proves its invariants.
