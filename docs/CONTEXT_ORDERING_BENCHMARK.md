# Context Ordering / Position Benchmark

Ordering is model-profile presentation policy, not truth.

Wave 3 preserves deterministic order variants and adds explicit position-sensitivity fixtures covering:
- critical CURRENT information early / middle / late;
- unresolved warnings early / middle / late;
- character-state information early / middle / late;
- supporting lore near / far from the query;
- historical evidence before / after current truth;
- long-context distractor pressure.

ContextOrderMeasurement@1 records model family, variant ID, measurement state, current-fact retention, unresolved-warning retention, character-state retention, continuity score, token estimate, latency and evidence reference.

Measurement states are MEASURED, REPLAYED, NOT_MEASURED and NOT_APPLICABLE. Missing measurements remain null rather than zero.

## Current model-family status

**NOT_MEASURED.** Worker 1 has no attached real target-model-family benchmark runner in this execution surface. The deterministic variants, fixtures and import/summary format are ready, but no universal winning order is declared. #57 remains open until actual target model families are measured.

Delivery Learning can consume future measured/replayed ordering evidence, but no benchmark can alter policy without normal qualification and protected-retention checks.
