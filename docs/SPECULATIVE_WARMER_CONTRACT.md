# Speculative Context Warmer Contract

The warmer predicts what may be useful; it never predicts canonical world truth. It accepts provider-neutral Scene `PrefetchRecommendation` data and can execute retrieval -> retrieval-quality evaluation -> Truth -> Precision -> compile before generation.

`WarmPacket` identity is fenced by scene revision, world revision, character-state revision, source revision set, intent fingerprint and retrieval-policy revision. Packets carry `authority: NONE`.

Freshness states:
- `FRESH`: every required fence matches; compiled representation may be reused.
- `PARTIALLY_STALE`: same Scene/world/intent/policy but character/source evidence changed with safe overlap; references may be salvaged, but rerank, revalidation and recompile are mandatory.
- `STALE`: scene/world/policy/TTL or non-overlapping source identity changed; foreground reuse is forbidden.
- `INVALID`: malformed identity or intent mismatch; foreground reuse is forbidden.

`WarmPacketCache` has explicit capacity, TTL, revision/intent invalidation and eviction. Repeated warming affects cache residency only, never authority. A warmer miss or failure falls back to normal foreground retrieval and degrades latency only.
