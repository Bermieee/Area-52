# Area-52 Reference Research Map

**Status:** researched architecture references  
**Purpose:** map external frameworks/papers to Area-52 without allowing framework choice to redefine the cognitive contracts.

The Area-52 architecture remains implementation-independent. The projects below are references, candidate adapters, or benchmark targets. They are not automatically dependencies.

---

## Decision legend

- **ADOPT PATTERN** — the underlying design should influence Area-52.
- **BENCHMARK** — implementation may be useful, but must be measured against alternatives.
- **OPTIONAL ADAPTER** — useful integration, not canonical core.
- **DEFER** — relevant later, not a current dependency.
- **DO NOT SUBSTITUTE** — useful tool, but it does not solve the Area-52 contract attributed to it.

---

# 1. Cognitive data contracts

## DSPy Signatures

Docs: https://dspy.ai/learn/programming/signatures/  
Source: https://github.com/stanfordnlp/dspy

DSPy Signatures define declarative typed input/output interfaces for LM modules. They are useful as a reference for expressing *what* a cognitive worker receives and returns independently of the exact prompt.

**Area-52 decision:** **ADOPT PATTERN / OPTIONAL ADAPTER**

Important distinction: DSPy Signatures are a task/interface abstraction. They should not be treated as the sole canonical serialization or as a guarantee that every distributed worker emits valid persisted objects.

## Instructor + Pydantic

Docs: https://python.useinstructor.com/

Instructor converts model outputs into Pydantic models, performs validation, and can retry with validation errors fed back to the model.

**Area-52 decision:** **ADOPT PATTERN / OPTIONAL ADAPTER**

Area-52 should use provider-neutral canonical schemas at its boundaries. Because the current prototype is JavaScript-first, Python/Pydantic should not become the only contract definition. JSON Schema / TypeScript validation can remain canonical with an Instructor/Pydantic adapter when Python workers are used.

**Contract lesson:**
1. syntactic/type validation first;
2. deterministic semantic validation second;
3. model-based semantic validation only where necessary;
4. failed validation never becomes canonical state.

---

# 2. Golden-world evaluation

## Ragas

Docs: https://docs.ragas.io/

Useful metrics include context precision, context recall, noise sensitivity, response relevance, faithfulness, and factual correctness.

**Area-52 decision:** **OPTIONAL ADAPTER**

Ragas is useful for conventional RAG quality, but Area-52 requires additional first-class metrics that Ragas does not define for us:

- current-state accuracy;
- historical-state accuracy;
- supersession accuracy;
- contradiction escape rate;
- provenance completeness;
- reflection false-learning rate;
- incremental relearning correctness;
- compiled-context fact retention.

The golden-world harness remains the authority.

## TruLens

Docs: https://www.trulens.org/

The RAG Triad evaluates:
- context relevance;
- groundedness;
- answer relevance.

**Area-52 decision:** **OPTIONAL ADAPTER**

Strong fit for measuring retrieval and downstream answer quality. It does not replace deterministic world-state tests.

---

# 3. Source registry and provenance

## LlamaIndex Document Management / Ingestion Pipeline

Docs:
- https://developers.llamaindex.ai/python/framework/module_guides/indexing/document_management/
- https://developers.llamaindex.ai/python/framework/module_guides/loading/ingestion_pipeline/

Useful patterns:
- stable document IDs;
- insert/update/delete/refresh;
- duplicate-document detection;
- transformation caching;
- async ingestion.

**Area-52 decision:** **ADOPT PATTERN**

Area-52 needs stronger dependency-cone invalidation because a single source can teach graph claims, aliases, concepts, embeddings, summaries, and reflections.

## W3C PROV / PROV-O

Docs:
- https://www.w3.org/TR/prov-overview/
- https://www.w3.org/TR/prov-o/
- https://www.w3.org/TR/prov-primer/

PROV provides a mature vocabulary for provenance across entities, activities, agents, generation, use, and derivation.

**Area-52 decision:** **ADOPT PATTERN**

Do not require RDF/OWL internally merely because PROV-O uses it. Borrow the provenance semantics and keep an Area-52-native representation that can export to a PROV-like form later.

---

# 4. Lore Study Engine

## RAPTOR

Paper: https://arxiv.org/abs/2401.18059

RAPTOR recursively embeds, clusters, and summarizes chunks into a tree with multiple levels of abstraction.

**Area-52 decision:** **ADOPT PATTERN / BENCHMARK**

Excellent reference for:
- multi-resolution lore understanding;
- concept hierarchy;
- local-detail vs global-summary retrieval.

RAPTOR does not solve temporal truth or mutable world state.

## Microsoft GraphRAG

Docs: https://microsoft.github.io/graphrag/

GraphRAG:
- extracts entities, relationships, and claims;
- performs community detection;
- creates hierarchical community summaries;
- supports Local, Global, DRIFT, and basic retrieval.

**Area-52 decision:** **ADOPT PATTERN / BENCHMARK**

Best reference for corpus-level graph/community study and multi-resolution retrieval.

**Important:** GraphRAG should not be mistaken for Area-52's temporal world-state engine. Temporal validity, supersession, and current/historical truth require an additional model.

---

# 5. Temporal State Graph

## Graphiti / Zep

Docs:
- https://help.getzep.com/graphiti/getting-started/welcome
- https://github.com/getzep/graphiti

Graphiti is directly relevant to Area-52:
- temporal knowledge/context graphs;
- incremental updates;
- provenance back to episodes;
- validity windows;
- historical queries;
- semantic + keyword + graph retrieval;
- prescribed and learned ontology.

**Area-52 decision:** **HIGH-PRIORITY REFERENCE / BENCHMARK**

This is a stronger direct reference for the Temporal State Graph than Microsoft GraphRAG.

Area-52 should study Graphiti carefully before inventing temporal semantics from scratch, while retaining its own authority/settlement rules.

---

# 6. Hybrid Sensory Net

## Qdrant Hybrid Search

Docs:
- https://qdrant.tech/documentation/search/text-search/hybrid-search/
- https://qdrant.tech/documentation/search/hybrid-queries/

Qdrant supports:
- dense vectors;
- sparse vectors;
- hybrid fusion;
- multi-stage query/prefetch;
- late-interaction reranking.

**Area-52 decision:** **BENCHMARK**

Qdrant maps very closely to the desired Sensory Net topology.

## Milvus Hybrid Search

Docs:
- https://milvus.io/docs/multi-vector-search.md

Milvus supports dense/sparse and multi-vector hybrid retrieval with reranking.

**Area-52 decision:** **BENCHMARK**

Do not choose Qdrant vs Milvus until the golden-world and scale harness can measure:
- latency;
- memory;
- local deployment complexity;
- update cost;
- hybrid recall;
- long-session behavior.

---

# 7. Candidate bus / asynchronous cognition

## Redis Pub/Sub

Docs: https://redis.io/docs/latest/develop/pubsub/

Redis Pub/Sub is decoupled and fast, but it uses **at-most-once delivery**. A lost subscriber message is lost permanently.

**Area-52 decision:** **DO NOT USE FOR DURABLE COGNITIVE WORK**

It may be acceptable for disposable presentation signals or telemetry.

For state-changing / resumable cognition, evaluate Redis Streams or the Area-52 durable work ledger instead.

## ZeroMQ

Guide: https://zguide.zeromq.org/docs/

ZeroMQ provides high-performance asynchronous socket patterns, pipelines, request/reply, and pub/sub.

**Area-52 decision:** **DEFER / BENCHMARK FOR PROCESS TRANSPORT**

ZeroMQ is transport, not durable cognitive ownership. If used, durability/idempotence/checkpointing still belongs to Area-52.

---

# 8. Truth Gate and corrective retrieval

## CRAG

Paper: https://arxiv.org/abs/2401.15884

CRAG adds a retrieval evaluator and triggers different corrective actions according to retrieval quality. It also decomposes/recomposes retrieved material.

**Area-52 decision:** **ADOPT PATTERN**

Map to:
- HIGH -> continue;
- MIXED -> bounded corrective retrieval;
- LOW -> do not inject garbage.

Area-52 extends this with temporal/current-state verification.

## Self-RAG

Paper: https://arxiv.org/abs/2310.11511

Self-RAG learns adaptive retrieval and reflection behavior instead of indiscriminately retrieving a fixed number of passages.

**Area-52 decision:** **ADOPT PRINCIPLE, NOT TRAINING REQUIREMENT**

We want “retrieve only when useful,” but Area-52 should not require a specially trained Main model or special reflection tokens.

---

# 9. Precision reranking

## FlashRank

Repo: https://github.com/PrithivirajDamodaran/FlashRank

FlashRank offers small CPU-friendly rerankers without requiring Torch/Transformers for its lightweight path.

**Area-52 decision:** **HIGH-PRIORITY BENCHMARK**

Excellent candidate for local CPU reranking, particularly when generation compute must remain untouched.

## ColBERTv2

Paper: https://arxiv.org/abs/2112.01488

ColBERTv2 uses token-level late interaction rather than a single vector per document and reduces late-interaction storage through residual compression.

**Area-52 decision:** **HIGH-PRIORITY BENCHMARK**

Likely useful either:
- as a precision retrieval channel;
- or as an intermediate rerank stage before a more expensive cross-encoder.

---

# 10. Reflection and consolidation

## Letta / MemGPT

Docs: https://docs.letta.com/  
Paper: https://arxiv.org/abs/2310.08560

MemGPT introduced OS-inspired virtual context management with different memory tiers. Letta continues the stateful-agent/memory architecture.

**Area-52 decision:** **ADOPT PATTERN**

Key lessons:
- memory tiers;
- context is a managed working set;
- archival/long-term memory is separate from active context;
- memory movement can be agent-controlled.

Area-52 differs by making temporal truth, provenance, reflection status, and settlement authority explicit.

## Generative Agents

Paper: https://arxiv.org/abs/2304.03442

The architecture stores experiences, synthesizes higher-level reflections over time, and retrieves memories dynamically to support behavior/planning.

**Area-52 decision:** **HIGH-PRIORITY REFERENCE**

This directly supports the Experience -> Reflection -> Recall portion of the blueprint.

---

# 11. Context Compiler

## Sparse Priming Representations (SPR)

Repo: https://github.com/daveshap/SparsePrimingRepresentations

The repository explores representing complex ideas with sparse keywords/phrases/statements that help an LLM reconstruct concepts.

**Area-52 decision:** **INSPIRATION ONLY**

The repository is archived and SPR should not be treated as a proven guarantee that arbitrary compressed token clusters preserve all lore semantics.

Use the idea for structured sparse packets, but keep them diagnosable and benchmark fact retention.

## LLMLingua / LLMLingua-2

Papers:
- https://arxiv.org/abs/2310.05736
- https://arxiv.org/abs/2403.12968

LLMLingua provides budget-aware prompt compression. LLMLingua-2 frames task-agnostic compression as token classification for improved faithfulness and speed.

**Area-52 decision:** **HIGH-PRIORITY BENCHMARK**

Benchmark against Area-52's structured compiler. Do not assume one compressor works equally well for every model/provider.

---

# 12. Scheduler, durability, and caches

## LangGraph

Reference:
- https://reference.langchain.com/python/langgraph/checkpoint
- https://reference.langchain.com/python/langgraph/checkpoints

LangGraph checkpointers persist graph state at super-step boundaries, retain successful node writes when other nodes fail, and support resumable durable execution.

**Area-52 decision:** **ADOPT DURABILITY PATTERNS / OPTIONAL ORCHESTRATION**

Particularly relevant:
- checkpoint boundaries;
- pending successful writes;
- resumable work;
- explicit durability modes.

Do not make LangGraph's execution model Area-52's cognitive model by default.

## Semantic Router

Docs: https://docs.aurelio.ai/docs/semantic-router/get-started/introduction

Semantic Router is primarily a fast semantic **routing/decision** layer.

**Area-52 decision:** **OPTIONAL FAST-ROUTING REFERENCE**

Correction: it is not primarily a semantic cache. It may help classify which cognitive path should run without an LLM call.

## GPTCache

Docs: https://gptcache.readthedocs.io/

GPTCache supports embedding-based similar-request caches, multiple similarity evaluators, time-aware evaluation, and multi-level cache arrangements.

**Area-52 decision:** **ADOPT CACHE PATTERNS / BENCHMARK**

Area-52 caches must additionally include canonical source revisions and dependency invalidation. Semantic similarity alone is not safe for truth-bearing cached state.

---

# 13. Optimization

## DSPy MIPROv2

Docs:
- https://dspy.ai/
- https://github.com/stanfordnlp/dspy/blob/main/docs/docs/api/optimizers/MIPROv2.md

MIPROv2 optimizes instructions and few-shot demonstrations using program traces, metrics, and Bayesian optimization.

**Area-52 decision:** **DEFER TO PROMPT/PIPELINE TUNING**

**Correction:** MIPROv2 is not a persistence-backend evaluation tool.

Potential later uses:
- Lore Study extraction prompts;
- Reflection prompts;
- semantic verifier prompts;
- compiler prompts;
- query-expansion prompts.

Only optimize against frozen golden-world metrics. Never allow optimization to weaken authority or provenance rules.

---

# 14. Shadow integration

## Shadow deployment pattern

Reference example:
- https://docs.aws.amazon.com/sagemaker/latest/dg/model-shadow-deployment.html

Shadow deployment duplicates live requests to a candidate system, logs candidate outputs, and prevents those outputs from affecting live production behavior until promoted.

**Area-52 decision:** **ADOPT PATTERN**

Exact Nexus application:
- current Nexus remains authoritative;
- Area-52 sees the same scene/evidence;
- Area-52 produces proposed context;
- outputs are logged and scored;
- no Area-52 mutation/publication authority;
- promotion only after quality gates.

## Generative Agents

Also relevant here because its memory/reflection architecture demonstrates hidden background cognition influencing later behavior rather than requiring every intermediate memory operation to be surfaced.

---

# 15. End-to-end orchestration

## LlamaIndex Workflows

Docs: https://developers.llamaindex.ai/python/llamaagents/workflows/

Workflows are event-driven multi-step orchestration for agents, RAG sources, reflection, and error correction.

**Area-52 decision:** **OPTIONAL ORCHESTRATION REFERENCE**

## LangGraph

Also a candidate for stateful graph orchestration and checkpointed execution.

**Area-52 decision:** **BENCHMARK PATTERN BEFORE DEPENDENCY**

Because Area-52/Nexus is currently JavaScript-oriented, do not introduce a Python orchestration dependency merely because its model resembles the blueprint. First define Area-52's own runtime interfaces, then compare whether a framework reduces complexity enough to justify the integration boundary.

---

# 16. Revised technology map

| Area-52 subsystem | Best references to study | Current posture |
|---|---|---|
| Cognitive contracts | DSPy Signatures, Instructor/Pydantic | Borrow pattern; canonical provider-neutral schemas |
| Golden-world evaluation | Ragas, TruLens | Optional metrics + Area-52 custom deterministic metrics |
| Provenance | W3C PROV, LlamaIndex doc management | Strong pattern |
| Lore hierarchy | RAPTOR, GraphRAG | Strong pattern / benchmark |
| Temporal world state | **Graphiti** | High-priority reference |
| Hybrid sensory retrieval | Qdrant, Milvus | Benchmark |
| Cognitive bus | Redis Streams/durable ledger; ZeroMQ only if needed | Do not use Redis Pub/Sub for durable work |
| Truth correction | CRAG, Self-RAG | Strong pattern |
| Precision | FlashRank, ColBERTv2 | High-priority benchmark |
| Reflection | Generative Agents, Letta/MemGPT | Strong pattern |
| Compiler | LLMLingua-2, SPR concepts | LLMLingua benchmark; SPR inspiration only |
| Scheduler | LangGraph checkpointing | Borrow durability semantics |
| Fast routing | Semantic Router | Optional |
| Semantic caches | GPTCache | Borrow patterns with revision fences |
| Prompt optimization | DSPy MIPROv2 | Later phase |
| Shadow integration | standard shadow deployment | Adopt |
| Orchestration | LlamaIndex Workflows / LangGraph | Optional after contracts stabilize |

---

# 17. Immediate blueprint changes implied by research

1. Add **Graphiti** as a formal temporal-state reference.
2. Keep Microsoft GraphRAG focused on study/community/hierarchical retrieval rather than temporal truth.
3. Make canonical contracts framework-neutral; add Python/Pydantic/DSPy adapters rather than making Python the source of truth.
4. Add Ragas/TruLens adapters to the evaluation roadmap, while retaining custom golden-world truth metrics.
5. Exclude Redis Pub/Sub from durable mutation/learning work; consider Redis Streams or internal durable work ownership.
6. Add FlashRank and ColBERTv2 to the first precision benchmarks.
7. Treat SPR as experimental inspiration; benchmark LLMLingua-2 as a real compression candidate.
8. Move DSPy MIPROv2 from persistence evaluation to later prompt/pipeline optimization.
9. Treat LangGraph/LlamaIndex Workflows as orchestration references, not architectural dependencies.
10. Preserve the Area-52 principle that every external framework is replaceable behind a contract.

---

## Research rule

An external framework may accelerate Area-52, but it does not own Area-52's semantics.

For every dependency candidate ask:

1. What cognitive problem does it solve?
2. Can its output retain Area-52 provenance?
3. Can it obey temporal truth?
4. Can it be revision-fenced?
5. Can it fail without corrupting canonical state?
6. Can we replace it behind an interface?
7. Does measured quality justify its operational cost?

If the answer is no, borrow the idea rather than the dependency.
