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

## Canonical blueprint

The architecture is defined in [`docs/AREA52_COGNITIVE_MEMORY_BLUEPRINT.md`](docs/AREA52_COGNITIVE_MEMORY_BLUEPRINT.md).

Execution is tracked in [`PROJECT_PLAN.md`](PROJECT_PLAN.md) and [GitHub issue #15 — Area-52 Program Tracker](https://github.com/Bermieee/Area-52/issues/15).

External framework and research references are mapped in [`docs/REFERENCE_RESEARCH_MAP.md`](docs/REFERENCE_RESEARCH_MAP.md). This distinguishes architecture patterns to adopt from optional dependencies to benchmark.

The current direction is explicitly hybrid: lore study, sparse + dense retrieval, late-interaction / reranking, temporal graph state, hierarchical semantic memory, reflections, truth maintenance, context compilation, and continual learning operate as one cognitive system.

## Status

**0.1-dev — blueprint phase.**

Implementation is subordinate to the blueprint. Area-52 remains isolated from production Nexus until the cognitive contracts and invariants are proven.


## SillyTavern direct install

Phase 1 Function Test 001 is assembled on `main` as a SillyTavern UI extension. In SillyTavern, open **Extensions → Install Extension** and paste:

`https://github.com/Bermieee/Area-52`

The accepted worker-lane files are copied into `main`; their source branches remain intact. After installation, open the Extensions panel, find **Area-52 — Phase 1**, and press **Run Test**. The same test is available from the browser console as `Area52.runFunctionTest001()`.

Function Test 001 exercises the copied Coprocessor, Runtime Fabric, Nexus Result Bus/Context Seal, and Adaptive Context Runtime/PromptPlan boundaries using the deterministic Ember Tavern / Sun Blade fixture.
