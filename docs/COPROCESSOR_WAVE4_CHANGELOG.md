# Coprocessor Wave 4 Change Log

Starting point: `2d204c1f277124f06088cbeec1f11f4ea85c3d8b`.

## Added

- channel-neutral CandidateBus normalization and multi-channel evidence dedupe;
- revision-keyed candidate freshness/stale rejection;
- bounded Precision Gateway with explicit input/late/semantic/final caps;
- required-evidence and credible-contradiction preservation inside final caps;
- provider-neutral late-interaction / semantic-judge adapter seams;
- 16-case permanent Wave 4 intent-opposite corpus and 4-case temporal corpus;
- broad-baseline vs precision gain benchmark;
- two-stage precision benchmark;
- optional FlashRank and ColBERT external benchmark adapters;
- Adaptive Retrieval -> Precision pipeline for HIGH/MIXED/LOW/SKIP;
- Lore and Memory candidate compatibility fixtures;
- FT003 and FT004 Coprocessor precision-side readiness docs;
- strict provider precision-output validator;
- bounded precision capability/fallback ladder;
- precision deadline-cutoff policy contribution;
- precision/retrieval telemetry counters;
- reusable Wave 4 benchmark qualification surface;
- Wave 4 deterministic, adversarial, stress and browser-host tests.

## Compatibility repairs during validation

Initial Wave 4 CI correctly caught two regressions before acceptance:

1. The expanded 16-case corpus had replaced the accepted 7-case legacy baseline export. The legacy `PRECISION_INTENT_OPPOSITE_CORPUS` is now preserved at seven cases, while Wave 4 uses a separate expanded acceptance corpus.
2. The Ember Tavern final cap could omit historically required Blade evidence. The existing `requiredCandidateIds` contract now preserves required evidence within the bounded final set while still preserving credible contradiction.

No accepted Wave 1–3 test was weakened to obtain green status.

## Existing seams strengthened

- specialist dispatch now exposes precision specialists;
- Runtime-selected profiles may execute a capability-negotiated fallback set;
- worker-result validation accepts either the complete primary capability set or a complete declared fallback capability set;
- HOT placement policy includes precision reranking / optional semantic judging;
- bounded telemetry adds precision-specific events without raw payload cloning.

## Explicit non-changes

- no Sensory Net implementation;
- no Scene Query Planner implementation;
- no Lore Study or RAPTOR implementation;
- no Memory/Temporal State implementation;
- no Settlement/UI implementation;
- no `main` merge;
- no Phase 2 Provider Intelligence.
