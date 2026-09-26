# Memory Wave 4 Changelog

## Scope

Memory Wave 4 converts the Wave 3 exact-evidence bridge into a general-world production producer suitable for FT003 assembly without taking over Core, Scene, Runtime, Jev, Lore or UI ownership.

Requested baseline: `a6d7cac76d5bb9fae7c9b2d67c2b7a6342db96b2`.

Observed branch at audit start: `22d59f3062b495cb837841a2a8cb01aea7575ce5`, already 20 commits ahead of the requested baseline. That pre-existing work was preserved and audited rather than replaced.

## Production changes

- Added `MemoryUiReadModelProducer v1.0.0`.
- Added host selection normalization for chat / turn / generation / correlation / world / Scene / source revision identity.
- Added selected-chat and selected-generation Memory reads.
- Added bounded retrieval receipt journaling keyed to the exact selected generation.
- Added `readMemory`, `subscribeMemory` and `createMemoryUiProducer` integration seams.
- Added exact- and hierarchy-Historian chat fences before ranking.
- Added chat-aware hierarchy source selection.
- Added UI evidence identity indexing by chat.
- Added generation-fenced, source-revision-fenced consolidation sessions and work units.
- Added sealed-generation parking to `NEXT_TURN`.
- Added stale-source consolidation rejection to `RECOMPUTE`.
- Added Memory UI notifications for evidence, Scene episode, summary, retrieval and consolidation changes.
- Kept every new UI/work-unit surface authority-negative.
- Preserved the one-local-resource native path with no mandatory external database, vector server, provider, remote model, plugin or background service.

## Regression repairs during acceptance audit

The pre-existing Wave 4 head had a red Actions run.

Two compatibility defects were found by the unchanged Wave 1 stress path:

1. `MemoryExperienceStore.startConsolidation()` declared a 4,096-ref session bound but still applied the 64-ref per-artifact source-revision bound. It now consistently uses `maxConsolidationSourceRevisionRefs` for session-wide fences.
2. Aggregate UI update selection creation could forward more than 64 source revision refs into the UI selection contract. The aggregate notification selector is now capped to the UI/artifact selection bound instead of throwing.

A focused Wave 4 regression now verifies that a 96-source consolidation session is accepted while 4,097 source revisions fail at the explicit 4,096 session bound.

## Validation additions

- Added two unrelated general-world focused fixtures.
- Added general-world Temporal State transition and as-of history checks.
- Added unresolved-conflict / Reflection non-authority checks.
- Added selected-chat pre-ranking Historian negative.
- Added perspective leakage checks across exact, summary, cache and drillback.
- Added precise source-correction invalidation checks.
- Added unconfirmed boundary / wrong revision / forged authority / late-seal negatives.
- Added UI selected-generation isolation checks.
- Added consolidation reload, duplicate-publication, stale-fence and post-seal parking checks.
- Added two-chat stress for Historian and UI isolation.
- Added Wave 4 browser portability and ESM import coverage.
- Promoted package/workflow targets to Wave 1+2+3+4.

## Documentation

- `docs/MEMORY_WAVE4_GENERAL_WORLD_PRODUCER.md` documents Worker 3 UI calls and Worker 4 FT003 assembly calls.
- `docs/MEMORY_WAVE4_ACCEPTANCE.md` records card-by-card Memory ownership and remaining cross-lane work.
- This changelog records the acceptance-audit repairs and preserved branch drift.

## Authority unchanged

Memory still does not own:

- Candidate Bus admission;
- Truth;
- canonical Settlement;
- Scene interpretation or boundary decisions;
- Context Seal;
- PromptPlan;
- Runtime scheduling/preemption;
- UI rendering or UI-owned truth.

Historian rank, summary fluency, Reflection confidence and Jev output cannot promote authority.
