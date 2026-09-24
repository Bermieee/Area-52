# Context Compression Benchmark

## Area-52 structured compiler — measured

The accepted deterministic Ember Tavern fixture remains:

- raw representation: 6,012 UTF-8 bytes;
- compiled semantic representation: 2,269 bytes;
- compression ratio: 0.377412;
- factual retention: 1.0;
- temporal retention: 1.0;
- contradiction/unresolved retention: 1.0;
- provenance retention: 1.0;
- relationship retention: 1.0.

Correctness is the gate. A shorter representation that drops required cognition fails.

## External compressor protocol

Wave 3 adds:
- ExternalCompressorBenchmarkRequest@1;
- ExternalCompressorBenchmarkResult@1 importer;
- per-metric measurement states;
- deterministic REPLAYED fixture support;
- comparison output that never chooses a winner without comparable evidence;
- isolated `scripts/run_llmlingua2_benchmark.py`.

External command:

`python scripts/run_llmlingua2_benchmark.py --input request.json --output result.json`

External environment dependency:

`pip install llmlingua`

The request contains requestId, compressorId, model, targetRate, inputText and benchmark requirements. The runner measures external input/output bytes, compression ratio and latency. It deliberately marks semantic retention metrics NOT_MEASURED until an Area-52 semantic evaluator/replay supplies them.

## Current LLMLingua-2 status

**NOT_MEASURED.** The Worker 1 execution environment does not have the LLMLingua Python package/model runtime installed. No zero values or synthetic winner are reported. #43 remains open until a real external comparison is executed and semantic-retention metrics are measured.
