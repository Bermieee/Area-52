# Coprocessor Failure / Fallback Matrix

| Task / class | Safe fallback |
|---|---|
| Historian | deterministic supplied-candidate ordering |
| Graph Walker | bounded supplied current-state lookup |
| Truth / Precision | preserve UNRESOLVED + deterministic fused order |
| Green Room | omit ephemeral inference |
| Rerank | deterministic fused ranking |
| Speculative Warmer | normal foreground retrieval |
| Consolidation | preserve raw experience |
| Streaming Truth | continue unverified / observation unavailable |

## Typed failure taxonomy

- PROVIDER_TIMEOUT
- PROVIDER_UNAVAILABLE
- PROVIDER_ABORTED
- PROVIDER_FAILURE
- CAPABILITY_UNAVAILABLE
- MALFORMED_OUTPUT
- SCHEMA_INVALID
- SCHEMA_VALIDATION_FAILED
- SEMANTIC_VALIDATION_FAILED
- UNKNOWN_REFERENCE
- AUTHORITY_VIOLATION
- STALE_RESULT
- FUTURE_REVISION
- INVALID_REVISION
- DEADLINE_EXPIRED / DEADLINE_MISS
- RETRY_EXHAUSTED
- FALLBACK_USED
- CORRELATION_MISMATCH

Retries are bounded by task fallback policy.

No recursive provider/tool loop exists.

Fallback output remains non-canonical and carries fallback provenance.
