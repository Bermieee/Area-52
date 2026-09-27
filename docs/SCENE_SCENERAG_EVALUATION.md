# Scene Intelligence — SceneRAG comparison and semantic SceneEpisode benchmark

Status: completed Scene-owned research/evaluation artifact for card #215.

## Source reviewed

SceneRAG: *Scene-level Retrieval-Augmented Generation for Video Understanding*, Nianbo Zeng et al., arXiv:2506.07600 (2025): https://arxiv.org/abs/2506.07600

The paper contrasts fixed-length chunks with narrative-consistent scene segmentation, then combines scene-level representations with graph retrieval and multi-hop relationships. Its domain is long-form video, not SillyTavern roleplay, so Area-52 treats it as an architectural comparison rather than an implementation dependency.

## Pattern mapping

| SceneRAG idea | Area-52 adaptation | Boundary |
| --- | --- | --- |
| Semantic scene segmentation instead of fixed-length chunks | Confirmed Scene boundaries compile revisioned `SceneEpisode` artifacts | Raw host narrative remains untouched and is never deleted by Scene |
| Boundary refinement / correction | Boundary candidate + verifier + operator correction/reconciliation | Optional Jev may adjudicate finite ambiguity; it cannot create Scene state |
| Scene-level entity/event relationships | `SceneGraph` membership, temporal adjacency, non-linear flashback/parallel/interrupt/resume, and evidence-backed causal/support links | Adjacency never implies causality |
| Multi-hop graph retrieval | Existing Core `NativeGraphNeighborhoodRetriever` consumes Scene plus other owner providers under caps and revision fences | Core owns traversal/Candidate Bus admission; Scene only publishes provider evidence |
| Long-range temporal dependencies | `SceneStack`, Scene Graph temporal path retrieval, predecessor/resume relationships | Historical/flashback evidence is not promoted to current-world truth |
| Rebuild after correction | Source-revision invalidation targets dependent Scene fields/Episodes/handoffs/prefetch | No full history rewrite is required for a single-source edit |

## Reproducible fixed-chunk comparison

`scripts/scene-research-evaluation.mjs` runs the same six-source, three-query story-neutral fixture on every Scene completion CI run. It compares:
1. three semantic SceneEpisodes, and
2. naive fixed-size chunks of two source turns,

using the same deterministic lexical Top-1 retrieval scorer. The benchmark measures boundary coherence, source-level retrieval precision/recall, event completeness, source traceability, temporal correctness, callback recovery, graph-neighbor/multi-hop usefulness, retrieved context characters, and how many derived units require rebuild after a single source edit.

Measured result from the exact-head completion CI after the benchmark was introduced:

| Metric | Semantic SceneEpisode | Fixed 2-turn chunks |
| --- | ---: | ---: |
| Boundary coherence | 1.000 | 0.667 |
| Retrieval precision | 0.667 | 0.500 |
| Retrieval recall | 1.000 | 0.833 |
| Event completeness | 1.000 | 0.833 |
| Source traceability | 1.000 | 1.000 |
| Temporal correctness | 1.000 | 0.333 |
| Cross-scene callback recovery | 1.000 | 0.500 |
| Graph-neighbor / multi-hop usefulness | 1.000 | 0.000 |
| Average retrieved context characters | 77.33 | 129.67 |
| Derived units rebuilt by one edited source (average) | 1.000 | 1.000 |

The fixture specifically includes a current vault scene, a historical harbor flashback, and a callback where an earlier key transfer is needed to understand a later door-opening event. Semantic episode neighbor metadata also preserves the Tavern→Vault relationship used by the graph-usefulness check. The semantic representation retrieves both source turns needed for the callback while keeping the flashback temporally isolated; the naive two-turn chunk mixes the flashback with the resumed current scene, misses one callback source, and has no semantic graph-neighbor metadata.

These numbers are a deterministic **Area-52 regression benchmark**, not a claim that Area-52 reproduces SceneRAG's video benchmark or its reported research scores.

## Adopt / reject decision

Adopt:
- semantic SceneEpisode boundaries,
- explicit source/revision lineage,
- graph relationships and bounded multi-hop retrieval,
- correction/rebuild at semantic-unit scope.

Reject as requirements:
- external video/ASR pipeline,
- multimodal visual encoders,
- SceneRAG service/runtime dependency,
- LLM segmentation as a prerequisite for ordinary Scene tracking,
- any graph edge that gains truth authority simply because retrieval found it.

## Evidence

- `src/scene/scene-episode.js`
- `src/scene/scene-graph.js`
- `src/scene/scene-retrieval.js`
- `src/scene/research-evaluation.js`
- `src/graph-neighborhood-retriever.js`
- `scripts/scene-research-evaluation.mjs`
- `tests/scene-completion-wave4-gaps.mjs`

Card #215's research/benchmark requirement is satisfied by this artifact and reproducible CI fixture. Shared Memory/Historian indexing remains outside Scene authority.
