# Precision Fallback Policy

Precision is safely degradable.

Preferred ladder:

1. preferred precision capability (late interaction / cross encoder where available);
2. negotiated fallback precision capability such as `RERANK` or `SEMANTIC_JUDGMENT`;
3. deterministic intent-aware baseline;
4. degraded-quality receipt.

A REQUIRED precision task uses bounded fallback rather than indefinite wait. An OPPORTUNISTIC second stage may not extend Context Seal indefinitely.

If the second stage misses its budget and a validated first-stage result exists, use the first-stage result. If no precision provider is available, deterministic ranking remains functional.

Runtime owns actual scheduling/deadline execution. The Sidecar only exposes result class, soft/hard deadlines, quality weight and deterministic fallback metadata.
