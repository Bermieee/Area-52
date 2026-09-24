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

## Wave 3 continuation

The deterministic intent-opposite corpus is reused by Adaptive Retrieval / Truth / Precision qualification for enter/leave, intact/destroyed, trust/distrust, carry/drop, heal/injure, present/departed, and CURRENT/HISTORICAL distinctions.

No external FlashRank or ColBERTv2 run was fabricated for Wave 3. The isolated provider-neutral precision adapter route remains available for a future real benchmark. Issue #42 therefore remains open.

## Wave 4 precision gateway qualification

Wave 4 adds a permanent 16-case intent-opposite acceptance corpus while retaining the accepted seven-case legacy deterministic baseline export.

Deterministic fixture measurements:

- broad similarity baseline: 3/16 (18.75%);
- precision stage: 16/16 (100%);
- synthetic accuracy gain: +81.25 percentage points;
- temporal-opposite discrimination: 4/4 (100%);
- deterministic two-stage precision: 100% -> 100%, zero measured accuracy gain, material gain false.

These measurements qualify the Area-52 deterministic precision contract. They do not establish real-provider superiority.

FlashRank and ColBERT-style adapters remain optional isolated benchmark capabilities. No executable external FlashRank/ColBERT runtime was available in the Wave 4 environment, so external model accuracy, latency and RAM remain NOT_MEASURED. Issue #42 stays open.
