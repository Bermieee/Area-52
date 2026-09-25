# Area-52 Local Precision Reranking + Optimized Inference Guide

**Canonical integration branch:** `Development-Nexus`  
**Primary implementation lane:** `Development-Sidecar/Jev`  
**Related systems:** Precision Gate, Cognitive Coprocessors, Sensory Net, Runtime Fabric  
**Purpose:** preserve the concrete high-performance reranking/inference techniques discussed during Area-52 planning.

---

# 1. Why a dedicated precision stage exists

Dense vector search is excellent for broad semantic recall but can confuse closely related opposite intents.

Example:

```text
query:
"How do I kill a dragon?"

candidate A:
"How to kill a dragon"

candidate B:
"How to heal a dragon"
```

A bi-encoder may place both close together because they share nearly all semantic vocabulary.

The Area-52 retrieval pipeline therefore separates:

```text
HIGH RECALL
    |
    v
sparse + dense + graph + episode + continuity
    |
    v
bounded candidate pool
    |
    v
HIGH PRECISION
cross-encoder / late interaction / small semantic judge
    |
    v
final admitted candidates
```

The expensive precision layer must stay bounded.

---

# 2. Cross-encoder vs late-interaction correction

These are related but not identical techniques.

## Cross-encoder

A cross-encoder receives the query and candidate together and predicts a relevance score.

Conceptually:

```text
[QUERY] + [DOCUMENT]
        |
        v
joint transformer
        |
        v
relevance score
```

This is precise because query and document tokens directly interact, but cost scales with the number of query-document pairs.

## Late interaction / ColBERT-style

Query and document token representations are produced separately and compared through token-level late interaction.

This can offer richer matching than a single-vector bi-encoder while enabling different indexing/performance tradeoffs.

Do not call ColBERT a classic cross-encoder in implementation documentation.

Area-52 may benchmark both.

---

# 3. Candidate small-footprint rerankers

Candidate models should be benchmarked rather than hard-coded into architecture.

Useful families include:

- `cross-encoder/ms-marco-MiniLM-L6-v2`
- smaller TinyBERT/MS MARCO cross-encoders
- BGE reranker family such as `bge-reranker-base`
- FlashRank-supported compact rerankers
- future small rerank-specific models

The model identity is replaceable behind the `RERANK` worker capability.

The scheduler should care about:

- capability;
- latency;
- context/token limit;
- memory footprint;
- CPU/GPU availability;
- reliability;
- current load.

---

# 4. Why small models are appropriate

Reranking is a narrow classification/scoring problem.

It does not require a large generative model to:

- write prose;
- maintain character voice;
- perform broad creative reasoning.

A small purpose-trained ranking model can therefore be a better resource fit.

This is exactly the kind of task Area-52 should move away from expensive general LLM calls.

---

# 5. Quantization

Quantization is a primary optimization candidate.

Benchmark:

- FP32 baseline;
- FP16 where supported;
- INT8;
- other runtime-supported lower precision only if quality remains acceptable.

For CPU transformer inference, ONNX Runtime documents dynamic and static quantization; dynamic quantization is commonly recommended as a starting point for transformer models.

Quantization must be evaluated for both:

- speed/memory improvement;
- ranking-quality regression.

Do not approve a quantized build solely because it is faster.

---

# 6. ONNX Runtime path

ONNX Runtime is a strong default candidate for local CPU reranking.

Potential path:

```text
trained reranker
    |
    v
ONNX export
    |
    v
graph optimization
    |
    v
INT8 dynamic quantization
    |
    v
ONNX Runtime worker
```

Advantages to benchmark:

- lower framework overhead;
- no full training stack required for serving;
- CPU execution providers;
- quantization support;
- portable local deployment.

A fallback path should remain available if a model cannot export correctly.

---

# 7. TensorRT path

TensorRT is a GPU-oriented optimization candidate.

Benchmark when:

- a compatible NVIDIA GPU is available;
- GPU memory can be spared without harming Main generation;
- local GPU inference is measurably faster than CPU;
- FP16/INT8 engine compilation is practical.

TensorRT supports reduced-precision execution including FP16 and INT8 on supported hardware.

However, Area-52 should not consume Main-generation GPU capacity merely because TensorRT exists.

Resource Governor policy wins.

---

# 8. FlashRank path

FlashRank is an especially relevant CPU-side reference because it is designed as a lightweight reranking library and can run without PyTorch or Transformers dependencies.

It supports pairwise/pointwise cross-encoder-style reranking and exposes compact models suitable for local CPU serving.

This makes it attractive for a dedicated `RERANK` coprocessor.

Area-52 should benchmark FlashRank against:

- direct ONNX Runtime;
- SentenceTransformers/PyTorch baseline;
- optional GPU/TensorRT path.

Do not assume one library wins on every CPU/model combination.

---

# 9. Local serving

Preferred architecture:

```text
Sensory Net
    |
    v
candidate IDs + compact text slice
    |
    v
LOCAL RERANK WORKER
    |
    v
scores + provenance + timing
```

Avoid remote reranking APIs in the foreground path unless they demonstrate a clear quality advantage that justifies network latency and dependency risk.

Local serving gives Area-52 control over:

- latency;
- privacy;
- batching;
- warm model residency;
- resource scheduling;
- fallback.

Actual latency must be measured on target hardware.

Do not encode an assumed fixed millisecond number into contracts.

---

# 10. Candidate pruning

Cross-encoder cost is approximately proportional to the number of query-document pairs evaluated.

Therefore:

> broad retrieval should be wide; precision reranking should be narrow.

Recommended benchmark ladder:

```text
fast retrieval Top 100
        |
        v
cheap fusion / truth filters
        |
        v
rerank Top 10 / 20 / 30
        |
        v
final 5-10
```

These values are starting points, not immutable constants.

Measure whether larger rerank pools materially improve golden-world precision.

If Top 20 performs the same as Top 100, pay for Top 20.

---

# 11. Adaptive rerank budget

The candidate cutoff should eventually be adaptive.

Examples:

## Easy query

```text
exact entity + strong current-state hit
-> rerank 5-10
```

## Ambiguous scene query

```text
many semantic near-neighbors
-> rerank 20-30
```

## Low confidence

```text
candidate quality LOW
-> corrective retrieval before increasing rerank budget
```

Do not use reranker size as a substitute for bad retrieval.

---

# 12. Token truncation

Cross-encoder cost also rises with sequence length.

The worker should enforce the selected model's token limit.

For common compact pairwise rerankers, a 512-token pair budget is a practical starting target and is the documented limit for FlashRank's pairwise/pointwise path.

But truncation should be semantic rather than careless when possible.

Possible strategy:

```text
query: preserve fully
candidate:
  preserve title/entity header
  preserve matching span
  preserve high-value context
  truncate low-value tail
```

Do not blindly discard the evidence-containing portion of a long lore entry.

---

# 13. Retrieval-time candidate representation

The reranker should not necessarily receive the entire canonical lore entry.

Use a derived retrieval representation containing:

- entity/title;
- contextualized chunk;
- relevant timeline hint;
- candidate evidence text;
- relationship/topic metadata where helpful.

Original source remains independently recoverable.

This aligns with Area-52's contextual retrieval representation work.

---

# 14. Batching

Reranking should support batches.

Contract concept:

```text
RerankRequest:
  query
  candidates[]
  modelProfile
  tokenBudget
  deadline
  worldRevision
  sceneRevision
```

Return:

```text
RerankResult:
  candidateId
  rawScore
  normalizedScore
  rank
  modelId
  modelRevision
  latency
  truncationApplied
  freshness
```

Batching reduces repeated runtime overhead and fits Area-52 Runtime Fabric.

---

# 15. Foreground deadline behavior

Reranking is an L1 Assist candidate when it contributes to active generation.

It therefore obeys Context Seal.

If reranking misses the foreground deadline:

- use deterministic fused ranking fallback;
- do not block indefinitely;
- late output may inform next-turn tuning/telemetry;
- late output cannot mutate sealed context.

---

# 16. CPU vs GPU policy

Default principle:

> use the cheapest device that meets the foreground latency/quality target.

CPU advantages:

- leaves GPU free for Main generation;
- easier always-on residency;
- compact INT8 models fit well;
- predictable sidecar isolation.

GPU advantages:

- potentially lower latency for larger rerankers/batches;
- FP16/TensorRT acceleration.

Resource Governor decides whether GPU use is acceptable.

---

# 17. Warm residency

Repeated model load/unload can erase the latency benefit of a small reranker.

A local worker may maintain warm model residency subject to:

- memory budget;
- idle eviction policy;
- worker health;
- model version;
- resource pressure.

Warm residency is a runtime optimization, not semantic state.

---

# 18. Precision pipeline

Recommended Area-52 structure:

```text
Scene Query Planner
       |
       v
Sparse / Dense / Graph / Episode retrieval
       |
       v
Candidate Bus
       |
       v
Truth Gate
       |
       v
cheap fusion / pruning
       |
       v
Precision Reranker
       |
       v
optional bounded semantic judge
       |
       v
Context Compiler
```

Whether Truth Gate runs before or after some reranking substage may be benchmarked, but obviously stale/superseded candidates should not consume expensive precision work unnecessarily when deterministic truth checks can remove them first.

---

# 19. Failure fallback

If optimized reranker is unavailable:

```text
fallback:
  deterministic fused score
  + sparse score
  + dense score
  + graph distance
  + continuity
  + truth status
```

Generation must remain possible.

If the optional second semantic judge fails:

> retain reranker result rather than failing the turn.

If all semantic precision is unavailable:

> prefer conservative bounded retrieval over injecting arbitrary low-confidence memory.

---

# 20. Benchmark matrix

Every candidate runtime/model should be evaluated on the same deterministic corpus.

Measure:

## Quality

- precision@k;
- recall after rerank;
- NDCG/MRR where useful;
- intent-opposite separation;
- current vs historical selection;
- false-positive rejection;
- relevant lore retention.

## Performance

- cold-start latency;
- warm latency;
- p50/p95 latency;
- candidates/sec;
- token pairs/sec;
- RAM;
- VRAM;
- CPU utilization;
- GPU utilization;
- batch scaling.

## Operational

- model load time;
- export reliability;
- quantization compatibility;
- crash isolation;
- fallback behavior;
- deterministic repeatability;
- packaging complexity.

---

# 21. Required intent-opposite fixtures

Include examples deliberately difficult for embedding similarity:

```text
kill dragon
heal dragon

enter dungeon
leave dungeon

trust Mara
distrust Mara

weapon intact
weapon destroyed

character present
character departed

current tavern description
historical tavern description
```

The reranking stage must demonstrate real value over vector similarity alone.

---

# 22. Candidate-cutoff benchmark

Test at minimum:

```text
rerank Top 5
rerank Top 10
rerank Top 20
rerank Top 30
rerank Top 50
rerank Top 100
```

Plot/record quality against latency.

Select the smallest pool that preserves required quality for the workload.

Do not copy an internet benchmark cutoff blindly.

---

# 23. Quantization benchmark

For each model/runtime combination where supported:

```text
FP32
FP16
INT8
```

Compare score/rank stability against baseline.

Acceptance should focus on whether the same useful candidates survive and intent opposites remain separated.

---

# 24. Recommended implementation order

## PR0 — baseline

Run a known compact cross-encoder in a straightforward implementation.

Freeze golden rerank fixtures.

## PR1 — local CPU optimized

Benchmark FlashRank and/or ONNX Runtime.

## PR2 — INT8

Quantize and compare quality/performance.

## PR3 — candidate budgets

Benchmark Top 5-100 rerank cutoffs.

## PR4 — truncation

Benchmark 256/384/512 or model-supported sequence budgets with evidence-aware truncation.

## PR5 — optional GPU

Benchmark TensorRT/FP16/INT8 only if target hardware and Resource Governor justify it.

## PR6 — production routing

Expose the winner through the `RERANK` capability rather than model-specific calls throughout the codebase.

---

# 25. Architecture rule

Do not let the rest of Area-52 know whether precision is implemented by:

- FlashRank;
- ONNX Runtime;
- TensorRT;
- PyTorch;
- ColBERT;
- BGE;
- MiniLM;
- another future reranker.

The canonical contract is:

```text
bounded candidates
    -> precision worker
    -> normalized ranked candidates
```

Implementation remains replaceable.

---

# 26. Existing project ownership

This guide supports existing work rather than creating new project cards.

Primary existing issues:

- #8 Precision reranking layer
- #42 FlashRank + ColBERTv2 benchmark
- #49 adaptive retrieval policy
- #75 Cognitive Coprocessor Layer
- #82 capability/model routing
- #87 coprocessor benchmark harness

---

# 27. External references

Useful implementation references:

- Sentence Transformers Cross-Encoder documentation:
  https://www.sbert.net/docs/cross_encoder/pretrained_models.html

- MS MARCO MiniLM-L6-v2 model:
  https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2

- FlashRank:
  https://github.com/PrithivirajDamodaran/FlashRank

- ONNX Runtime quantization:
  https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html

- NVIDIA TensorRT:
  https://docs.nvidia.com/deeplearning/tensorrt/latest/

These are implementation references, not Area-52 semantic authorities.

---

# 28. Final principle

The precision stack exists to make broad retrieval cheap and final admission precise:

```text
cast wide cheaply
    ->
reject obvious stale/irrelevant candidates
    ->
spend compute on a small ambiguous set
    ->
publish only what Main actually needs
```

Area-52 should spend heavyweight reasoning only where cheaper mathematics and small purpose-built models are no longer sufficient.
