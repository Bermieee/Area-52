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
