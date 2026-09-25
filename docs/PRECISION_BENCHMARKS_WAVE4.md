# Precision Benchmarks — Wave 4

## Deterministic golden corpus

The permanent intent-opposite corpus contains 16 pairs covering enter/leave, intact/destroyed, trust/distrust, carry/drop, heal/injure, present/departed, present/mentioned and CURRENT/HISTORICAL distinctions.

Local deterministic pre-commit measurement:

- deliberately broad token-overlap baseline: 3/16 = 18.75%;
- deterministic intent-aware precision: 16/16 = 100%;
- synthetic accuracy gain: +81.25 percentage points.

Temporal-specific corpus: 4/4 = 100%.

These are synthetic fixture measurements. They do not establish real-provider/model superiority.

## Two-stage result

On the deterministic golden corpus, adding the deterministic semantic-judge stage after the already-correct intent-aware stage produced 0 additional accuracy gain. Wave 4 therefore does not force a mandatory second stage merely to justify architectural complexity.

## FlashRank / ColBERT

The benchmark seams are isolated optional adapters. No browser/runtime dependency is added.

If no executable external model/runtime is supplied, measurement state is `NOT_MEASURED`. Wave 4 does not fabricate latency, RAM or quality numbers for FlashRank or ColBERT.

Issue #42 remains open until real external measurements are executed.
