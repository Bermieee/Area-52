# Cognitive Coprocessor — Wave 10 Acceptance

Primary issue: #212. Secondary preparation: Jev portion of FT005/#180.

Acceptance requires all 13 #212 goldens with evidence/authority/expectation/rationale; deterministic-only, raw-provider and Jev comparisons per case and in aggregate; measurable valid resolution gain on genuinely ambiguous cases without rewarding forced certainty; zero Jev authority violations; stale golden rejection; provider qualification for structured validation, malformed output, timeout, bounded fallback, disagreement, stale/late containment and consistency; an opt-in live smoke that reports SKIPPED when unconfigured; and exact-head branch regression/browser/syntax/ESM gates.

A high aggregate score cannot compensate for false certainty, authority escalation or stale-result acceptance.

The independent corpus does not exercise the Wave 9 adapter replay cache. The pending #211 replay-freshness/cache-retention repair therefore does not alter the direct-corpus score, but remains a dependency for adapter-level replay/integration acceptance.

## Measured evidence

Code/evaluation candidate `395efc1fd1253989530efec32241535e0eb98cfc` completed Wave 10 Actions run `36052674030` GREEN.

- corpus: `jev-golden-corpus@10.0.0`, 13/13 required goldens;
- deterministic-only: 61.5% acceptable overall, 0 ambiguous valid resolutions, 5 safe uncertainty outcomes;
- raw provider: 76.9% acceptable, 6 ambiguous valid resolutions, 3 false-certainty cases, 3 simulated operator overturns;
- Jev: 100% acceptable, 7 ambiguous valid resolutions, 5 safe uncertainty outcomes, 0 false certainty, 0 authority violations, stale golden rejected, 92.3% mean evidence coverage, 100% deterministic-fixture provider consistency;
- deterministic-to-Jev ambiguous valid-resolution delta: +7;
- raw-provider-to-Jev validity delta: +23.1 percentage points;
- raw-provider-to-Jev false-certainty delta: -3;
- Jev fixture token use: 5,068 tokens across the corpus; no monetary fixture cost was invented;
- provider qualification: 7/7 PASS, including structured validation, malformed-output fallback, timeout fallback, disagreement, stale post-execution rejection, Context Seal late containment, and repeated-provider consistency;
- browser safety: 2/2 PASS;
- full branch regression: 437/437 PASS;
- syntax and Coprocessor ESM import: PASS;
- opt-in live Jev smoke: **SKIPPED**, because `AREA52_JEV_BASE_URL` and `AREA52_JEV_MODEL` were not supplied. No live-provider PASS is claimed.

The workflow uploaded the reproducible JSON/Markdown evaluation artifact as `jev-wave10-evaluation` (artifact id `10831341152`). The final handoff reports the exact post-documentation head/run.
