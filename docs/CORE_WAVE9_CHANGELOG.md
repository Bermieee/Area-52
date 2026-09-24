# Core Wave 9 Changelog

## Wave 8 -> Wave 9

Wave 8 established the Hybrid Sensory Net, Candidate Bus, and revision-aware index lifecycle. Wave 9 connects those accepted surfaces into a real deterministic per-turn cognitive-choice path.

## Production files added

- `src/cognitive-choice-contracts.js` — typed `CognitiveChoiceReceipt`, path/job/action enums, deterministic reason codes, and authority-negative contract.
- `src/cognitive-choice-controller.js` — Hot-only admission, retrieval-quality routing, one-correction bound, Jev invocation seam, Precision admission, revision/freshness trace, replay/late-result receipt handling.

## Production files modified

- `src/cognitive-core.js` — owns the controller, exposes Jev adapter registration and receipt lookup, and prevents duplicate publication audit on idempotent replay.
- `src/generation-publication.js` — executes real Hot-only / HIGH / MIXED / LOW paths, uses the accepted Candidate Bus envelope, conditionally runs Precision, preserves unresolved Jev cases, seals generation-facing evidence, and fences replay.
- `src/core-assembly-manifest.js` — includes Wave 9 browser-visible production modules.

## Validation added

- `tests/cognitive-choice-wave9-harness.js`
- `tests/cognitive-choice-wave9.mjs`
- `tests/cognitive-choice-wave9-stress-harness.js`
- `tests/cognitive-choice-wave9-stress.mjs`
- `scripts/cognitive-choice-wave9-acceptance-report.mjs`
- `scripts/cognitive-choice-wave9-stress-report.mjs`

The focused goldens cover Hot-only, multi-channel HIGH, MIXED plus exactly one correction, LOW abstention, CURRENT vs HISTORICAL Truth outcomes, unresolved/Jev unavailable, Jev abstention without canonical mutation, Jev-not-needed, late-after-seal, stale revision, order independence, and publication replay idempotency.

Focused stress covers high-turn repetition, mixed-channel failure, nomination/dedupe pressure, repeated MIXED correction-worthy turns, rapid Scene revision advances, repeated sealed-turn replay, Jev unavailable, Precision unavailable, and late/stale result containment.

## Behavioral rules

- Hot Cognition can satisfy an explicitly local/current turn without fake long-term retrieval.
- HIGH retrieval proceeds without corrective work.
- MIXED retrieval has a hard maximum of one corrective pass.
- LOW retrieval contributes no weak long-term-memory evidence to generation.
- Truth Gate remains the truth classifier; the controller never upgrades authority.
- Jev is invoked only for bounded explicit ambiguity and has no canonical mutation authority.
- Precision is skipped for a tiny exact set and falls back deterministically if required but unavailable.
- Candidate job count remains independent of physical sidecar count.
- Context Seal is final for the active generation.
- Identical sealed-turn replay does not re-execute cognition.

## Explicitly not implemented

- Jev engine internals (#206-#212);
- adaptive retrieval semantic worker ownership (#49);
- Historian implementation;
- Graph Walker implementation;
- Green Room implementation;
- Worker Director scheduling;
- Brain Inspector/UI rendering;
- canonical owner Settlement changes.
