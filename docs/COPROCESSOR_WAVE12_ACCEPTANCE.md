# Cognitive Coprocessor Wave 12 Acceptance

## Acceptance claim

**SPECULATIVE WARMER PRODUCER READY FOR ASSEMBLY**

This wave does not claim #224 Live Brain PASS and does not claim zero-latency generation. #77 remains open until actual cross-lane Core pre-Send consumption is proven in assembled runtime.

## Required behavior covered

- confirmed location-transition recommendation can prepare reference-backed material before Send;
- matching Send may expose FRESH material only for Core freshness/Truth-receipt revalidation and admission;
- false/mentioned-only location prediction cannot admit wrong-location context when the actual intent/policy does not match;
- source and character-state changes produce PARTIALLY_STALE salvage with mandatory rerank/Truth/recompile;
- Scene/world/policy changes produce STALE discard;
- Blade-fate disagreement remains UNRESOLVED even when a generated summary sounds certain;
- missing recommendation, missing optional provider, provider failure/timeout, cache eviction and TTL expiry preserve normal foreground cognition;
- result arriving after Context Seal is unavailable to that generation;
- repeated recommendations coalesce and one-resource scheduling yields at safe retrieval boundaries without unbounded growth;
- active preparations are superseded when revision fences change.

## Bounded defaults

| Limit | Default |
| --- | ---: |
| Active preparations | 1 |
| Queued preparations | 8 |
| Retrieval intents | 64 |
| Retrieval batch size | 8 |
| Candidate refs | 48 |
| Evidence refs | 64 |
| Packet bytes | 32,768 |
| Estimated packet tokens | 8,192 |
| Stage receipt bytes | 4,096 |
| Retained diagnostics | 256 |
| Sealed-turn records | 64 |
| Default TTL | 2 turns |

## Provider configuration

The native/default configuration is local and provider-free. Optional injected adapters may perform semantic retrieval, Truth, Precision and compile work. Failure of optional capacity changes latency only; correctness falls back to the foreground pipeline.

## Remaining assembly gaps

- Scene lane must publish the production recommendation/revision input at the correct pre-Send lifecycle point.
- Runtime must wire foreground-start/yield/resume and revision-invalidation notifications to this coordinator.
- Core must request warm material on Send, independently revalidate freshness/Truth receipts, rerun the mandatory partial-stale stages, and own final admission/Context Seal.
- A live assembled integration must prove that the warmed path actually removes foreground work in the host rather than only in the deterministic benchmark.
