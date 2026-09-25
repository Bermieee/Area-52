# Lore Wave 4 Changelog

## Added

- `LoreIntelligenceService` orchestration from accepted SillyTavern source snapshot to Brain retrieval.
- strict discovered lorebook id / UID handoff validation.
- required Worker 3 discovery/origin receipt and explicit rejection of the legacy `operator-lore` fallback.
- Worker 3-compatible operator read/action interface.
- Worker 1-compatible revision-fenced Brain retrieval interface.
- explicit `FAILED` study lifecycle state and safe retry.
- pre-unit rollback when a study step throws.
- persisted service reconstruction from runtime/representation/hierarchy snapshots.
- READY gate requiring current learned revision, Lean/Balanced/Heavy representations and retrieval readiness.
- source-scoped stale representation reporting.
- Wave 4 acceptance tests for unrelated books, edit/removal, ambiguity, failure/retry, persistence and broad/detail retrieval.

## Changed

- unknown entry discovery metadata is preserved in the revision metadata `extra` map instead of being discarded.
- public Lore integration surface contract version increased to 2 and now reports per-entry operator/study states, failure information and semantic diff.
- Intelligence status preserves the existing retrieval-representation fields consumed by Worker 3's current read adapter while adding the stricter Wave 4 state/representation contract.
- package version advanced to `0.5.0-lore-wave4`.
- Lore branch CI now runs the Wave 4 suite and imports the complete representation/intelligence stack.

## Preserved

- exact authored Lore text.
- human Lore Tree organization.
- source revision history.
- derived-vs-canon authority boundary.
- optional/provider-neutral architecture.
- no required database, embedding service or orchestration daemon.
