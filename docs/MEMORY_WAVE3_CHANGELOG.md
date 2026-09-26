# Memory Wave 3 Changelog

## Added

- `MemoryExternalEvidenceBridge v1.0.0`;
- bounded external owner evidence mapping journal with raw audit input;
- exact owner artifact / evidence / source revision reconciliation;
- typed mapping mismatch and authority-fence failures;
- Scene owner event intake for confirmed boundary and episode-ready evidence;
- late Scene proposal resolution after exact evidence arrival;
- Scene proposal withholding for missing/stale/mismatched/mentioned-only evidence;
- exact-evidence-backed automatic Scene summary-scope registration;
- Core Settlement evidence-ID remapping adapter preserving owner proposal/decision/receipt;
- perspective-safe exact drillback;
- immutable live Scene/Core owner-shape test snapshots;
- revision-safe hierarchy token/entity/level query index;
- bounded dependency-aware hierarchy nomination cache;
- exact affected-scope cache eviction;
- persisted query index/cache in Memory snapshots;
- legacy-vs-indexed-vs-cache hierarchy profiling;
- Wave 3 3,000-event + 300-mapping stress/profile workload.

## Optimized

- hierarchy no longer deep-clones/tokenizes every current summary for each broad query;
- bridge revision refs are cached and invalidated by bridge mutations;
- exact mapping admission no longer rebuilds Historian when no retrievable artifact changed.

## Preserved

- Wave 1 CURRENT/HISTORICAL/UNRESOLVED Temporal State semantics;
- exact raw evidence and Settlement replay idempotency;
- Green Room expiry;
- Reflection INFERRED authority;
- Wave 2 grounded hierarchy and source-range drillback;
- CandidateNomination authority fences;
- browser/SillyTavern-safe local operation;
- no mandatory provider/database/vector/plugin/background service;
- Core ownership of Candidate Bus, Truth, Settlement, Context Seal and PromptPlan;
- Scene ownership of interpretation/boundaries;
- Runtime ownership of scheduling/yield;
- no new branch and no merge to main.
