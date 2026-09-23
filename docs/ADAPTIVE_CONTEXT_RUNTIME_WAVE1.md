# Adaptive Context Runtime — Wave 1

## Scope

This wave implements Area-52 issue family #133 children #135–#143 and #146 on `Development-Nexus`.

The runtime begins **after** `GenerationContextSeal`. It consumes an immutable compiled packet plus its seal receipt and produces a disposable `PromptPlan`, then a provider/model-facing rendered input through a registered Model Adapter.

It does not retrieve, settle, mutate, or reinterpret canonical knowledge.

## Architectural boundary

```text
PublicationContextCompiler
  -> GenerationContextSeal
  -> sealed ContextPacket
  -> AdaptiveContextRuntime
      -> PromptPlan
      -> PromptIntegrityGuard
      -> ModelAdapter
      -> adapter-integrity check
      -> Main-facing structure
```

Invariant:

> Model-aware presentation may adapt. Canonical meaning may not.

## Implemented behavior

- first-class deterministic `PromptPlan` with seal/hash identity, model/profile revisions, ordered sections, segments, budgets, reuse/cache decisions, fallbacks, dependencies and diagnostics;
- typed Prompt Slot Registry with extension slots and no arbitrary raw prompt append path;
- two deterministic reference profiles: `CACHE_STABLE` and `RECENCY_WEIGHTED`;
- provider-neutral deterministic token-estimator boundary;
- intent-sensitive budget targets, protected content floors, compact fallback, optional drop/defer semantics and explicit impossible-budget failure;
- revision-aware `NO_CHANGE`, `PATCH`, `REBUILD`, `OMIT` delivery states;
- stable-prefix / revisioned-middle / volatile-tail segmentation and cache metadata;
- profile-driven ordering without declaring a universal model winner;
- pre-adapter Prompt Integrity Guard plus post-adapter semantic-manifest verification;
- deterministic benchmark helpers for semantic/current/temporal/unresolved/provenance retention, size, reuse, rebuild, cache eligibility, fallback, latency and optional cost hooks;
- `Area52CognitiveCore.deliverGenerationContext()` as the explicit post-seal integration boundary.

## Protected truth

The Wave 3 packet's current, historical and unresolved semantic sections are protected in this reference implementation. User input, supplied system policy and relevant generation-envelope sections marked protected also receive floors. Optional material is compacted first; low-priority optional material may be dropped, while higher-priority optional material that still cannot fit is explicitly deferred rather than silently lost.

If protected compact content cannot fit, delivery returns `DELIVERY_BUDGET_UNSATISFIABLE`. It does not silently truncate critical truth.

## Post-Seal information policy

Allowed post-seal categories are:

- references to semantic items already inside the sealed packet;
- revisioned static/operator policy;
- generation envelope material such as current user input/recent narrative where the generation architecture requires it;
- presentation metadata.

A semantic contribution from a non-sealed source is rejected as `POST_SEAL_SEMANTIC_INJECTION`.

## Reuse and cache correctness

Reuse is representation reuse only. It cannot make stale facts true.

- stable/revisioned segments may become `NO_CHANGE` when identities are unchanged;
- band-grouped segments may `PATCH` when only a bounded subset changes;
- changed atomic segments `REBUILD`;
- intentionally excluded optional content is `OMIT`;
- volatile-tail content rebuilds every generation even when text happens to repeat;
- cache keys are delivery metadata and never evidence.

## Model neutrality

`CACHE_STABLE` and `RECENCY_WEIGHTED` are deterministic reference policies, not claims about real providers. Real model-family claims remain benchmark work under #57.

## Deferred

- #144 delivery-learning feedback;
- #145 UI inspector (`Development-UI` owner);
- production provider profiles and provider tokenizers;
- production Runtime Fabric scheduling;
- production Sidecar/Jev precision/reranking;
- LLMLingua-2 comparison (#43);
- real target-model position measurements (#57).
