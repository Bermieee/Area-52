# Coprocessor Wave 3 Qualification Benchmarks

Wave 3 qualification uses explicit measurement state: `MEASURED`, `REPLAYED`, `NOT_MEASURED`, or `NOT_APPLICABLE`. Missing values never become zero.

Tracked families:
- Warmer: hit rate, partial salvage, stale discard, foreground retrieval avoided, latency saved when measured, false-use rate.
- Adaptive Retrieval: HIGH correctness, MIXED improvement, LOW abstention correctness, corrective-pass rate, garbage-injection avoidance.
- Green Room: inference consistency, evidence coverage, false persistence, expiry correctness, batch size, latency.
- Consolidation: source-fact/provenance retention, unique fact loss, contradiction preservation, yield latency, resume correctness, stale rejection.
- Streaming Truth: true/false positive rate, ambiguity abstention, latency, historical/current discrimination.
- Fan-Out: average nominations, zero-worker rate, unnecessary-worker rate, expected-value hit rate, foreground cost and deadline impact.

The deterministic intent-opposite corpus remains the baseline for enter/leave, intact/destroyed, trust/distrust, carry/drop, heal/injure, present/departed and CURRENT/HISTORICAL distinctions. External FlashRank/ColBERT results remain unmeasured unless a real benchmark is run.

## Implementation-checkpoint results

At `c51b35b0766d12616bfa357494988a37fb36deac`:

- Fan-Out stress: `MEASURED` — 3,000 plans, 4,986 nominated workers, 370 zero-worker plans, 300 background nominations, maximum observed workers per plan 3.
- WarmPacket stress: `MEASURED` — 2,000 evaluations split 500 FRESH / 500 PARTIALLY_STALE / 500 STALE / 500 INVALID.
- Adaptive Retrieval stress: `MEASURED` — 1,000 evaluations, 333 corrective passes, 666 abstentions and 334 proceeds; no path exceeded one corrective pass.
- Green Room stress: `MEASURED` — 1,000 outputs plus 500 expiry cases; bounded active state ended at 24 and history at 64.
- Consolidation stress: `MEASURED` — 1,000 units, 500 checkpointed, all 1,000 emitted as DEEP obligations.
- Streaming Truth stress: `MEASURED` — 2,000 complete claim checks in OBSERVE mode and zero interceptions.
- Deterministic/adversarial qualification: `REPLAYED` through the 46-test Wave 3 focused suite and full 178-test regression.
- Browser-like production execution: `MEASURED` — 2/2 PASS with Node conveniences unavailable.

Not measured in this checkpoint: real provider latency/cost/token use, CPU/RAM under live provider load, true production warmer latency savings, and external FlashRank/ColBERT quality. Those remain `NOT_MEASURED`, not zero.
