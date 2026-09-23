# Area-52

## Active working branch

**Development-Nexus** is the active implementation workspace for the cognitive brain. `main` remains the preserved reference baseline.

Working-ground rules: [`docs/DEVELOPMENT_NEXUS_WORKING_GROUND.md`](docs/DEVELOPMENT_NEXUS_WORKING_GROUND.md)

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

Subsystem ownership, lifecycle/runtime architecture, branch lanes, and board hierarchy are mapped in [`docs/AREA52_SUBSYSTEM_BOARD_MAP.md`](docs/AREA52_SUBSYSTEM_BOARD_MAP.md).

The canonical interface platform is defined in [`docs/AREA52_UI_CORE_BLUEPRINT.md`](docs/AREA52_UI_CORE_BLUEPRINT.md).

The sidecar/cognitive-coprocessor architecture is defined in [`docs/AREA52_COGNITIVE_COPROCESSOR_BLUEPRINT.md`](docs/AREA52_COGNITIVE_COPROCESSOR_BLUEPRINT.md).

Implementation phases and acceptance tests: [`docs/AREA52_SIDECAR_IMPLEMENTATION_RUNBOOK.md`](docs/AREA52_SIDECAR_IMPLEMENTATION_RUNBOOK.md).
Verified external references and design implications: [`docs/AREA52_SIDECAR_REFERENCE_DOCUMENTATION.md`](docs/AREA52_SIDECAR_REFERENCE_DOCUMENTATION.md).

The current direction is explicitly hybrid: lore study, sparse + dense retrieval, late-interaction / reranking, temporal graph state, hierarchical semantic memory, reflections, truth maintenance, context compilation, and continual learning operate as one cognitive system.

## Status

**0.1-dev — blueprint phase.**

Implementation is subordinate to the blueprint. Area-52 remains isolated from production Nexus until the cognitive contracts and invariants are proven.


## Advanced memory and precision references

Concrete implementation/reference material for the advanced systems discussed during Area-52 planning:

- [Advanced Memory + State-Aware Retrieval](docs/AREA52_ADVANCED_MEMORY_STATE_AWARE_RETRIEVAL.md) — write-back state through Settlement, temporal graph updates, autonomous reflection, episodic memory, SPR-style semantic packets, self-organizing memory, and state-aware retrieval.
- [Local Precision Reranking + Optimized Inference](docs/AREA52_LOCAL_PRECISION_RERANKING_GUIDE.md) — compact rerankers, cross-encoder vs late interaction, INT8/FP16, ONNX Runtime, TensorRT, FlashRank, local serving, candidate pruning, truncation, batching, fallbacks, and benchmark requirements.

Specialist branches should read these before implementing related memory, retrieval, sidecar, or precision work.


## Advanced learning, causal memory and lore compilation

The next Brain extensions are documented as shared canonical references:

- [Memory Reconsolidation, Maturation + Value-Aware Forgetting](docs/AREA52_MEMORY_RECONSOLIDATION_MATURATION_FORGETTING.md) — derived-memory plasticity, support-aware weakening, hot/warm/cold value policy, safe forgetting, anti-self-validation, and resumable reconsolidation. Tracked by #118.
- [Causal / Event Memory + Competing Hypothesis Sets](docs/AREA52_CAUSAL_EVENT_MEMORY_AND_HYPOTHESES.md) — event-centric memory, evidence-backed causal relations, explicit competing explanations, uncertainty-preserving retrieval, and causal/history integration. Tracked by #119.
- [Semantic Lore Compiler + Diff / Impact Analysis](docs/AREA52_LORE_COMPILER_SEMANTIC_DIFF.md) — semantic compilation, semantic diff, dependency impact preview, ontology refactoring, and multi-representation lore. Tracked by #120.

### Lore Tree compatibility

The traditional **Lore Tree remains first-class** for human organization, browsing and editing.

Area-52's semantic graph, ontology, retrieval hierarchy and compiled representations augment the Lore Tree rather than replacing it. Human-facing tree structure and machine-facing semantic structures intentionally coexist.
