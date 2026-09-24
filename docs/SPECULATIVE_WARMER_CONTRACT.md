# Speculative Context Warmer Contract

The warmer predicts what may be useful; it never predicts canonical world truth. It accepts provider-neutral Scene `PrefetchRecommendation` data and can execute retrieval -> retrieval-quality evaluation -> Truth -> Precision -> compile before generation.

`WarmPacket` identity is fenced by scene revision, world revision, character-state revision, source revision set, intent fingerprint and retrieval-policy revision. Packets carry `authority: NONE`.

Freshness states:
- `FRESH`: every required fence matches; compiled representation may be reused.
- `PARTIALLY_STALE`: same Scene/world/intent/policy but character/source evidence changed with safe overlap; references may be salvaged, but rerank, revalidation and recompile are mandatory.
- `STALE`: scene/world/policy/TTL or non-overlapping source identity changed; foreground reuse is forbidden.
- `INVALID`: malformed identity or intent mismatch; foreground reuse is forbidden.

`WarmPacketCache` has explicit capacity, TTL, revision/intent invalidation and eviction. Repeated warming affects cache residency only, never authority. A warmer miss or failure falls back to normal foreground retrieval and degrades latency only.

## Wave 12 production coordination

`SpeculativeWarmCoordinator` is the host-neutral pre-Send coordinator around this packet contract.

It accepts only ACTIVE, evidence-backed Scene recommendations whose Scene/source revisions agree with an explicit warm identity. Repeated semantic recommendations coalesce by identity rather than recommendation ID. The native/default path is reference-only and provider-free; optional injected adapters may add semantic retrieval, Truth, Precision and compile work.

Preparation is bounded by active jobs, queued jobs, intent count, slice size, candidate/evidence references, packet bytes, estimated tokens, receipt bytes, TTL, diagnostics and sealed-turn records. A one-resource configuration is the default. Foreground generation can request yield; preparation parks at safe retrieval/stage boundaries and resumes only while its revision fences remain valid.

Packets retain references and bounded receipts, not provider payload bodies. Compiled output is reusable only when returned as a revision-fenced `ArtifactReference`; arbitrary compiled text is reduced to a non-reusable hash/size receipt.

At Send:
- FRESH is a candidate for Core freshness/Truth-receipt revalidation and admission; warmer authority remains NONE.
- PARTIALLY_STALE exposes references only and requires foreground rerank, Truth recheck and recompile.
- STALE, INVALID and misses discard warm material and take normal foreground retrieval.
- a turn already sealed cannot consume a late packet.

The warmer never publishes to Context Seal or Main and never turns prediction into canon.

