# Cognitive Coprocessor Wave 2 — Acceptance

## Foreground execution

PASS criteria:

- deterministic + OpenAI-compatible adapters exist;
- credentials/config remain external;
- no native function calling dependency;
- four foreground specialists execute through the same normalized result contract;
- provider identity remains metadata;
- alternate providers normalize to the same specialist payload shape.

## Authority/safety

PASS criteria:

- candidate prompt injection remains data;
- malformed/prose/truncated output rejected;
- wrong enum/ref/duplicate/omission rejected;
- Graph historical/current collapse rejected;
- Truth credible conflict remains unresolved;
- Green Room is INFERRED and expires;
- no worker owns canonical mutation.

## Runtime / batching

PASS criteria:

- Runtime-compatible obligations emitted;
- bounded fan-out;
- adaptive slice recommendation;
- per-slice execute/validate/commit seam;
- valid committed slices survive later slice failure;
- Sidecar contains no Resource Governor/scheduler.

## Foreground quorum

Function Test 001:

- Historian 40ms REQUIRED;
- Graph 50ms REQUIRED;
- Truth/Precision 70ms REQUIRED;
- Green Room 240ms OPPORTUNISTIC;
- foreground closes 70ms;
- Green Room routes late;
- compiler input preserves both Blade-fate claims.

## Stress target

Wave 2 deterministic stress:

- 1,400 turns;
- 5,320 planned worker tasks;
- mixed provider IDs;
- bounded fan-out <= 4;
- zero-worker turns;
- duplicate results;
- stale/future revision pressure;
- missing work/fallback;
- opportunistic lateness;
- no cross-turn leakage.

## Streaming truth

OBSERVE-only prototype:

- buffers meaningful clauses;
- never judges raw individual tokens;
- logs soft uncertainty;
- never rewrites/intercepts creative generation.

Hard intercept remains deferred.

## Final evidence

Exact final SHA and GitHub Actions run are recorded in `COPROCESSOR_WAVE2_TEST_EVIDENCE.md` after the final documentation checkpoint.
