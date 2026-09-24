# Coprocessor Telemetry Contract — Phase 1 Wave 5

Telemetry is compact, bounded and reference-first.

Tracked signals include turnId, taskId, capability, layer, executionClass/placement, provider profile, provider health, queue/execution timing, batch progress, yield/park/resume, retry, fallback, validation failure, stale drop, warm/cache hit, result destination and deadline/quorum state.

The telemetry ring is bounded. Observer failure cannot stop cognition.

The sanitizer excludes continuously copied raw material including raw prompts, provider responses, full payloads, candidate/source text, whole conversation, whole lorebook, all memory, private diagnostics and chain-of-thought/reasoning fields.

Provider usage is normalized into input units/tokens, output units/tokens, cache-hit units, latency, provider profile and capability. Cost remains NOT_MEASURED unless deterministic pricing metadata is configured.

Telemetry carries no mutation authority and cannot promote provider output to canonical truth.
