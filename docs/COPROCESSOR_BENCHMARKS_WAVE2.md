# Coprocessor Benchmarks — Phase 1 Wave 2

The integration benchmark surface uses explicit measurement states: `MEASURED`, `NOT_MEASURED` and `NOT_APPLICABLE`. Missing metrics are never represented as zero.

Deterministic metrics now cover fan-out, zero-worker correctness, quorum close time, late results, structured validity, malformed rejection, retry/fallback, stale/future-revision rejection, provider interchangeability, batch throughput when receipts exist, artifact-reference savings, serialization/transport cost and telemetry volume.

CPU, peak RAM, provider token usage and cost remain `NOT_MEASURED` unless a caller supplies real instrumentation.

## Precision follow-up (#42)

The repository now includes an intent-opposite corpus for enter/leave, intact/destroyed, trust/distrust, carry/drop, heal/injure, present/departed and CURRENT/HISTORICAL. A deterministic adapter establishes the local benchmark seam and baseline. External FlashRank remains an optional local-service adapter candidate; ColBERTv2 remains deferred from direct browser deployment. No Python stack is forced into the extension and no external-model quality result is claimed without running that provider.
