# Precision Benchmark — FlashRank and ColBERTv2

Issue: #42

## Question

Should Area-52 adopt FlashRank or ColBERTv2/late interaction as a mandatory second precision stage for the Phase 1 SillyTavern/JavaScript Sidecar?

## FlashRank

Current upstream FlashRank is a Python package. Its lightweight pairwise models use ONNX Runtime, run on CPU, and the default TinyBERT model is approximately 4 MB. It avoids Torch/Transformers for the lightweight path.

Source references:

- https://github.com/PrithivirajDamodaran/FlashRank
- https://pypi.org/project/FlashRank/

Disposition: **OPTIONAL ADAPTER**.

Rationale:

- attractive for an external/local Python precision service;
- CPU-friendly and materially lighter than a Torch stack;
- not a direct browser-native JavaScript dependency for the SillyTavern extension;
- no production dependency is added in Phase 1.

## ColBERTv2 / late interaction

Current upstream ColBERT is Python-based and uses PyTorch/Hugging Face, with FAISS options for indexing/search. The project documents CPU environments but also states GPU is required for training and indexing.

Source reference:

- https://github.com/stanford-futuredata/ColBERT

Disposition: **DEFER** for direct Phase 1 SillyTavern/browser deployment.

Rationale:

- late interaction is a legitimate precision architecture;
- direct inclusion would introduce a materially heavier Python/Torch/FAISS deployment surface;
- it does not fit the current browser-local source lane as a mandatory dependency;
- a future external/local service adapter can be benchmarked without changing the canonical precision contract.

## Measurements

This wave did **not** fabricate model-quality, CPU, RAM, token, money, or network measurements.

Not measured in this JS lane:

- intent-opposite accuracy for FlashRank;
- intent-opposite accuracy for ColBERTv2;
- exact relevance delta over the deterministic baseline;
- real FlashRank latency/memory at Area-52 candidate sizes;
- real ColBERTv2 latency/memory at Area-52 candidate sizes;
- second-stage quality gain on a golden Area-52 retrieval corpus.

Those measurements require the candidate runtimes/models and a representative benchmark corpus.

## Phase 1 decision

Do not adopt either library as a mandatory dependency.

Preserve the existing deterministic provider-neutral precision contract. FlashRank is eligible for a later optional adapter benchmark. ColBERTv2 is deferred to an external/local-service experiment.

Issue #42 remains open because the empirical relevance/intent-opposite benchmark has not been executed.
