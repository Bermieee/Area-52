# Adaptive Retrieval Policy

Adaptive retrieval classifies evidence usefulness independently of canonical truth.

- `HIGH`: proceed with the current candidate set.
- `MIXED`: permit at most one corrective pass. Supported actions are query reformulation, sparse retry, dense retry, graph expansion, entity-constrained search and temporal narrowing.
- `LOW`: abstain from long-term-memory injection rather than inject weak evidence.
- `SKIP`: legal when already-satisfied HOT cognition makes retrieval unnecessary.

`AdaptiveRetrievalController` hard-bounds correction to one pass even when configured with a larger number. A second LOW/MIXED result stops; it does not loop. Quality receipts explicitly set `canonicalTruthGranted:false`.
