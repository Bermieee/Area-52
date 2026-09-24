# Provider Health and Fallback — Phase 1 Wave 5

Provider health is current operational state, not learned provider preference.

States:
- HEALTHY
- DEGRADED
- SATURATED
- UNAVAILABLE
- COOLDOWN
- PROBE

Inputs may include timeout, validation failure, transport failure, rate limiting, latency, active concurrency and manual disable.

The circuit breaker is bounded. Repeated failures can enter COOLDOWN, a later probe can test recovery, and successful probe returns the profile to HEALTHY. No history is converted into autonomous provider ranking.

Fallback semantics:
- REQUIRED failure or hard deadline: bounded deterministic fallback.
- OPPORTUNISTIC timeout: current generation continues; valid late work may route to NEXT_TURN or WARM_CACHE.
- DEFERRED timeout: background accounting only.
- cancelled, superseded or stale result: DROP.
- malformed result: typed failure and no canonical-ready admission.

One provider failure does not cancel unrelated swarm tasks unless an explicit REQUIRED dependency requires it.
