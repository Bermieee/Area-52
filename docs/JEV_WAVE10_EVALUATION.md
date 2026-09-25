# Jev Wave 10 — Golden Corpus and Evaluation Contract

Wave 10 implements #212 as a versioned, repeatable evaluation surface. It does not claim FT005/#180 or the Live Brain Demo/#224 passed, and it does not convert Wave 9 green CI into Director acceptance of #211.

## Corpus

`evaluation/jev-wave10-corpus.mjs` defines `jev-golden-corpus@10.0.0`. Every case records bounded evidence, permitted authority, expected decision or acceptable abstention, and rationale. Lore, Scene, Memory and Temporal cases are explicitly fixtures when owner integration is outside the Jev branch.

The 13 goldens are deterministic skip; ambiguous Lore Tree placement; UID duplicate; UID complementary; UID temporal succession; contradictory lore; Scene boundary ambiguity; entity alias ambiguity; state transition versus contradiction; summary retention failure; no-safe-decision abstention; stale revision; and provider disagreement.

## Comparison and safety

Each case runs through `DETERMINISTIC_ONLY`, `RAW_PROVIDER`, and `JEV`; provider disagreement also records `RAW_PROVIDER_B`. Usefulness is credited only for valid ambiguous resolutions. UNRESOLVED, ABSTAINED and STALE are safe outcomes where allowed and are not penalized for avoiding forced certainty. Any Jev false certainty, authority violation, or stale-result acceptance fails the safety gate regardless of aggregate validity.

The report records per-case and aggregate validity, safe abstention, false certainty, authority violations, stale rejection, evidence coverage, simulated operator overturns, latency, token usage, provider consistency, deterministic-to-Jev delta, and raw-provider-to-Jev delta. Cost is reported only when actual pricing is supplied to the live smoke; fixture pricing is not invented.

`npm run report:wave10` generates JSON and Markdown under `artifacts/jev-wave10/`; CI uploads them as a reproducible artifact.

## Provider qualification

Wave 10 qualifies Jev through the existing `CapabilityProfileRegistry`, `ProviderAdapterRegistry`, and `JevProviderExecutor`. Tests cover strict structured validation, malformed output, timeout, bounded fallback, provider disagreement, stale post-execution results, Context Seal late containment, usage/latency capture, and repeated-provider consistency.

`scripts/jev-wave10-live-smoke.mjs` is an opt-in OpenAI-compatible Jev smoke. Configure `AREA52_JEV_BASE_URL` and `AREA52_JEV_MODEL`; API key is optional for local endpoints. Optional variables are `AREA52_JEV_PROVIDER_ID`, `AREA52_JEV_PROFILE_ID`, `AREA52_JEV_TIMEOUT_MS`, `AREA52_JEV_INPUT_COST_PER_MILLION`, `AREA52_JEV_OUTPUT_COST_PER_MILLION`, and `AREA52_JEV_SMOKE_CASE`. Credentials and endpoint values are never printed. Without live configuration the script reports `SKIPPED`, not PASS.

## #211 repair boundary

A separate repair worker owns the Wave 9 replay-freshness/cache-retention defect. Wave 10 does not edit `src/coprocessor/jev-domain-adapter.js` or replay logic in `src/coprocessor/jev-decision-core.js`, and it does not claim Wave 9 adapter replay acceptance. The direct #212 corpus is independent of that cache defect; adapter-level replay/integration conclusions remain pending Director-coordinated repair integration.
