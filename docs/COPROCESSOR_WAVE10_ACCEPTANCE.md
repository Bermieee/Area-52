# Cognitive Coprocessor — Wave 10 Acceptance

Primary issue: #212. Secondary preparation: Jev portion of FT005/#180.

Acceptance requires all 13 #212 goldens with evidence/authority/expectation/rationale; deterministic-only, raw-provider and Jev comparisons per case and in aggregate; measurable valid resolution gain on genuinely ambiguous cases without rewarding forced certainty; zero Jev authority violations; stale golden rejection; provider qualification for structured validation, malformed output, timeout, bounded fallback, disagreement, stale/late containment and consistency; an opt-in live smoke that reports SKIPPED when unconfigured; and exact-head branch regression/browser/syntax/ESM gates.

A high aggregate score cannot compensate for false certainty, authority escalation or stale-result acceptance.

The independent corpus does not exercise the Wave 9 adapter replay cache. The pending #211 replay-freshness/cache-retention repair therefore does not alter the direct-corpus score, but remains a dependency for adapter-level replay/integration acceptance.

Exact-head SHA, CI run IDs, measured totals and live-smoke status are appended after final CI.
