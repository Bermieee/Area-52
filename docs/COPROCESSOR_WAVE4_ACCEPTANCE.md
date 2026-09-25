# Cognitive Coprocessor Phase 1 — Wave 4 Acceptance

## Scope

Wave 4 closes the Sidecar-owned precision corridor between broad retrieval nomination and Truth/Gather-compatible bounded evidence. It does not implement Sensory Net, Scene Query Planner, Lore Study, Memory, Temporal State, Settlement, UI, or Phase 2 Provider Intelligence.

Accepted Wave 3 start: `2d204c1f277124f06088cbeec1f11f4ea85c3d8b`.

Green implementation checkpoint: `8eca22f0ae474a77914d8606148e433965aff205`.

## Production corridor

`CandidateBus -> retrieval-quality evaluation -> at most one corrective retrieval -> Precision Gateway -> Truth-compatible evidence -> Result Bus / Gather`

The corridor preserves these ownership boundaries:

- retrieval channels nominate evidence but do not admit it;
- Precision ranks/reduces evidence but does not classify canonical truth;
- Truth remains responsible for CURRENT/HISTORICAL/SUPERSEDED/CONTRADICTED/UNCERTAIN/UNRESOLVED classification;
- canonical settlement/mutation remains outside the Coprocessor.

## CandidateBus contract

Candidates preserve identity, evidence identity, Artifact Reference where available, source revision refs, channel nominations, ranking signals, entity/relationship/temporal metadata, scene relevance, supplied authority/truth metadata, provenance and representation text.

Multi-channel duplicates are deduplicated by evidence identity. Channel support/provenance are merged without multiplying authority or confidence.

## Precision Gateway

Default production caps are explicit and bounded:

- input candidates: 256;
- late-interaction candidates: 64;
- semantic-judge candidates: 24;
- final candidates: 12.

The gateway:

- rejects stale revision-keyed candidates before active ranking;
- performs cheap deterministic filtering;
- supports optional provider-neutral late-interaction and semantic-judge stages;
- preserves declared required evidence within the final cap;
- preserves both sides of credible contradiction when the cap permits;
- returns provenance-complete `PrecisionResultSet` objects;
- never converts retrieval/rank scores into truth confidence or authority.

## Intent and temporal qualification

Permanent Wave 4 intent-opposite corpus: 16 cases.

Measured deterministic results:

- deliberately broad similarity baseline: 3/16 = 18.75%;
- deterministic precision: 16/16 = 100%;
- measured synthetic accuracy gain: +81.25 percentage points;
- temporal-opposite corpus: 4/4 = 100%.

These are deterministic fixture results, not a claim that one real-world provider/model is superior.

Two-stage deterministic benchmark:

- first precision stage: 100%;
- second deterministic semantic stage: 100%;
- accuracy gain: 0;
- material gain: false.

Wave 4 therefore does not force a second expensive reranker merely to increase architectural complexity.

## Ember Tavern golden world

The bounded final evidence set preserves:

- Ember Tavern CURRENT = destroyed;
- Sun Blade HISTORICAL location = Tavern;
- Sun Blade CURRENT location = unknown (not synthesized by Precision);
- Blade destroyed in fire vs removed before fire = unresolved competing evidence.

Required historical evidence and both credible contradiction candidates remain inside the final cap.

## Adaptive Retrieval integration

- HIGH -> Precision;
- MIXED -> at most one corrective retrieval -> re-evaluate -> Precision only if acceptable, otherwise abstain;
- LOW -> abstain from long-term retrieval;
- SKIP -> no long-term retrieval when hot cognition already satisfies the turn.

Corrective retrieval remains an injected backend-owned operation. Precision does not implement arbitrary retrieval stores.

## Lore / Memory readiness

Lore and Memory implementations were not added.

Contract fixtures prove future candidates can traverse CandidateBus -> retrieval quality -> Precision while retaining source revision drillback, provenance and supplied authority/truth status.

Status:

- `COPROCESSOR PRECISION SIDE READY FOR FT003` — not FT003 PASS;
- `COPROCESSOR PRECISION SIDE READY FOR FT004` — not FT004 PASS.

## Provider-facing validation / fallback

Provider precision output must pass transport, parse, schema/type validation, deterministic semantic validation and normalization before Result Bus eligibility.

Fail-closed cases cover:

- unknown/invented candidate IDs;
- duplicate result IDs;
- missing required candidates;
- invalid score ranges;
- unknown reason codes;
- wrong source revisions;
- authority escalation;
- HISTORICAL -> CURRENT promotion.

Provider identity remains provenance/telemetry only.

The bounded capability ladder is:

`preferred precision capability -> declared fallback precision capability -> deterministic baseline -> degraded-quality receipt`.

Negotiated fallback capability sets are valid worker attestations; Runtime-selected fallback profiles can execute without altering task semantics.

## External precision status

FlashRank and ColBERT-style late interaction remain optional external capability adapters.

No real external FlashRank/ColBERT runtime was available in this Wave 4 environment, so model-quality, external latency and external memory measurements are `NOT_MEASURED`. No fabricated numbers were substituted. Issue #42 therefore remains open.

## Telemetry / FT006 metrics

Bounded telemetry exposes counts/references for candidate input/output, retrieval quality, corrective passes, precision stages, fallback stage, stage latency, provider/capability, stale rejection, authority-violation rejection and final destination. Raw candidate bodies, prompts, retrieved source text and provider responses remain blocked from continuous telemetry.

The metrics surface is ready to answer later FT006 questions about nomination volume, survival rate, LOW/MIXED behavior, fallbacks, preserved contradiction, stale rejection and precision cost when real measurements exist.

## Green implementation validation

At `8eca22f0ae474a77914d8606148e433965aff205`:

- full regression: 220/220 PASS;
- Wave 1 focused: 40/40 PASS;
- Wave 2 focused: 62/62 PASS;
- Wave 3 focused: 46/46 PASS;
- Wave 4 focused: 39/39 PASS;
- stress: 15/15 PASS;
- browser-like Wave 4 production paths: 2/2 PASS;
- JavaScript syntax: PASS;
- Coprocessor ESM import: PASS.

Actions:

- Wave 1 run #43 / `35963150873` — PASS;
- Wave 2 run #22 / `35963150811` — PASS;
- Wave 3 run #5 / `35963150755` — PASS;
- Wave 4 run #3 / `35963150929` — PASS.

## Pressure evidence

Dedicated Wave 4 stress measured:

- 5,000 precision requests;
- 120,000 broad candidates processed;
- 10,000 duplicate multi-channel nominations deduplicated;
- 1,000 stale candidates rejected;
- 1,000 contradiction cases / 1,000 preserved;
- 1,105 fallback events;
- 455 deadline cutoffs;
- maximum broad candidate-set size: 40;
- 37,000 final outputs across stress requests;
- focused stress throughput run: ~26,522 candidates/second (host-specific CI measurement);
- 2,000 intent-opposite replays / 2,000 correct;
- 1,000 temporal-opposite replays / 1,000 correct;
- 1,000 Ember Tavern contradiction replays / 1,000 preserved.

Throughput is CI-host evidence, not a universal production latency guarantee.

## Phase boundary

Wave 4 does not add learned provider preference, autonomous provider ranking, automatic semantic-prompt tuning, meta-cognition, predictive world truth, self-modifying retrieval authority, or any other Phase 2 Provider Intelligence behavior.
