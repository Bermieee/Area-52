# Worker 2 closure — Memory coverage, recovery and retention

## Scope and branch

- Owner: Worker 2 / Memory
- Branch: `Development-Worker-2`
- Base: `main@1de19e82a0083d5dfa70175bc0434dae45ee676c`
- Draft PR: #328
- Assigned ledger rows: 40, 45, 46, 49, 50, 61, 64, 65
- Shared-file rule observed: Worker 2 did not edit `src/deployment/brain.js`; row 65 integration is handed to Worker 3.

This closure follows the three-worker cap-remediation handoff: physical, cache, ranking and diagnostic bounds may remain when recovery and truthful receipts are demonstrated; confirmed loss/starvation must be repaired; partial coverage is never reported as complete.

## Final row dispositions

| Row | Disposition | Closure evidence |
| --- | --- | --- |
| 40 — Historian evidence bytes | **FIXED** | Ranked evidence is packed by actual UTF-8 byte size instead of returning an empty artifact set on overflow. Bounded-out artifact identities remain addressable. Single-artifact overflow is reported explicitly. Stale historian rows remain excluded before packing. |
| 45 — Memory store ref bounds | **FIXED** | Episode/reflection refs use bounded head segments plus complete `MemoryReferenceManifest` segments. Validation occurs before retiring a prior current artifact. Exact drillback, historian indexing, summary construction, vector work, freshness and reflection review consume the complete manifest through `memoryReferenceValues()`. |
| 46 — Consolidation 4,096 jobs | **FIXED** | A consolidation session retains only one <=4,096-job page and emits a Runtime-owned continuation offset/token for the rest. Bundle review also pages at 4,096 proposals. Native Brain appends remaining review pages as bounded units to the same persisted Runtime batch; interruption/reload resumes page 4,097 without re-invoking the provider. Job/proposal identities fence changed middle entries, and Memory retains no second overflow queue or scheduler. |
| 49 — Summary-of-summaries | **FIXED** | SESSION/ARC-style summaries retain child summary manifests rather than flattening all descendant evidence into one 8,192-ref list. Exact drillback is paged through child artifacts. A 9,216-evidence synthetic hierarchy proves beginning/end facts, correction/rebuild, snapshot/restore and allowed-evidence filtering. Replacement retirement is atomic: a failed new summary build leaves the prior revision current. |
| 50 — Summary term index ceiling | **FIXED** | Terms beyond the 32,768 reverse-index ceiling use bounded targeted fallback pages. The public historian boundary now exposes incomplete targeted coverage as `DEGRADED` with `nextTargetedFallbackOffset`; useful exact fallback can still be returned without pretending the summary scan was complete. |
| 61 — Four full-detail turns | **VERIFIED_BY_DESIGN** | The four-turn limit compacts diagnostics only. The immutable sealed packet, seal receipt and owner-backed experience remain intact; large non-authoritative diagnostic bodies become reference/hash forms. No published seal is mutated. |
| 64 — Native knowledge cache/history | **VERIFIED_BY_DESIGN** | Non-current derivative rows may leave the bounded NativeKnowledgeStore cache, but exact source revisions remain in the authoritative `SourceRegistry` and survive snapshot/restore. The cache limit therefore does not delete canonical historical source content. |
| 65 — 2,400/1,200-char Memory transport excerpts | **OPEN_WITH_EVIDENCE** | Worker 2 added `createMemoryTransportExcerpt()`, explicit omission/coverage receipts, bounded drillback refs and contract tests for Consolidation/Jev payload shapes. `docs/cap-remediation/worker-2-row65-deployment-handoff.md` gives the narrow integration. Worker 3 still owns and must update `src/deployment/brain.js`; its current branch does not yet consume the helper. |

## Repairs and contracts

### Row 40 — ranked partial evidence

Historian resolution now:

- measures `JSON.stringify(artifacts)` with `TextEncoder`, so multibyte text is accounted as UTF-8 bytes;
- preserves rank order while selecting useful artifacts that fit;
- returns `processed`, `remaining`, `boundedOut`, `coverageComplete`, `continuationAvailable`, `continuationCursor`, `reasonCode`, `limit` and `limitType`;
- distinguishes a globally exceeded evidence budget from one top artifact that cannot fit;
- keeps `canonicalKnowledgeDropped:false`.

The producer-level Historian resolution wrapper follows the same partial-result contract rather than re-emptying an already useful result.

### Rows 45/46 — recoverable Memory bounds

Artifact reference overflow is segmented, not silently sliced or rejected after a prior revision was already mutated. Legacy bounded fields remain available as segment 1 for compatibility, while `referenceManifests` carry all refs and owner code resolves the complete set with `memoryReferenceValues()`.

Consolidation is page bounded:

- page size <= `MEMORY_LIMITS.maxConsolidationJobs` (4,096);
- `jobOffset`, `jobPageEnd`, `processedJobs`, `totalJobs` and `nextJobOffset` make progress explicit;
- checkpoints preserve global cursor and page cursor separately;
- the continuation token hashes the complete logical job list, not only page edges;
- a changed middle job invalidates continuation with `MEMORY_CONSOLIDATION_JOB_SET_CHANGED`;
- review bundles expose the same page boundary rather than silently ignoring proposal 4,097;
- review continuation carries a full proposal-set token; changing a middle proposal invalidates resume with `MEMORY_CONSOLIDATION_REVIEW_SET_CHANGED`;
- Native Brain's Memory-owned Runtime executor converts remaining review pages into deterministic <=4,096-proposal units in the same Runtime batch before the current slice commits;
- Runtime's persisted Work Ledger therefore owns interruption/reload recovery; continuation units bypass the Sidecar producer and do not issue another provider request;
- page progress is retained as compact counts/coverage instead of thousands of per-proposal diagnostics;
- Runtime scheduling authority remains false inside Memory receipts so the existing Runtime remains the scheduler.

### Row 49 — hierarchical exact drillback

Higher summaries keep:

- direct evidence only when they directly own it;
- child artifact refs with child revisions, range hashes and exact-evidence counts;
- `MemorySummaryEvidenceManifest` coverage metadata;
- representative child excerpts for bounded summary text;
- paged `exactDrillbackPage()` traversal through child manifests.

Missing exact evidence or a missing child is reported as unavailable; it is not silently counted as successful drillback. Child revisions participate in dependency fingerprints/freshness so a child correction invalidates and rebuilds its parent. A prior summary revision is not retired until the replacement artifact has passed all build-time validation.

### Row 50 — bounded index with recoverable search

The 32,768-term reverse index remains a bounded acceleration structure. Artifact token sets retain the terms that could not receive postings. Queries containing unindexed terms scan a deterministic <=512-artifact fallback page at the preferred resolution tier and return:

- examined count;
- current fallback offset/tier;
- remaining rows;
- coverage status;
- next offset.

If that page is incomplete, the public historian result is `DEGRADED` with `MemorySummaryTargetedFallbackContinuation`, even if exact fallback produces useful candidates.

### Rows 61/64 — safe diagnostic/cache limits

No production limit was raised merely to hide pressure.

Turn detail compaction retains publication identity and the sealed packet. Native knowledge historical exact content remains in SourceRegistry even when derivative cache rows are evicted. These are therefore retained as bounded diagnostic/cache policies rather than converted into unbounded in-memory history.

### Row 65 — Worker 2 side complete, shared integration outstanding

`src/memory-transport-excerpt.js` keeps the current transport limits while making them truthful. Its receipt differentiates:

- complete transport vs bounded excerpt;
- transmitted vs omitted characters;
- owner drillback identity/revision;
- bounded source/evidence ref heads plus full counts/completeness flags;
- transport evidence from exhaustive owner evidence.

Worker 3 must replace the manual `.slice(0,2400)` and `.slice(0,1200)` callsites in `src/deployment/brain.js` using the supplied handoff. Until that happens, row 65 is not end-to-end closed.

## Regression coverage added or extended

Focused cap tests on this branch include:

- `tests/cap-remediation-memory-historian-budget.test.mjs`
- `tests/cap-remediation-memory-store-bounds.test.mjs`
- `tests/cap-remediation-memory-summary-hierarchy-longrun.test.mjs`
- `tests/cap-remediation-memory-summary-index.test.mjs`
- `tests/cap-remediation-memory-retention.test.mjs`
- `tests/cap-remediation-memory-transport-excerpt.test.mjs`
- `tests/cap-remediation-memory-vectors.test.mjs`
- `tests/memory-cognition-completion.test.mjs` now includes an exact Runtime interruption/reload continuation case for proposal 4,097
- existing `tests/memory-wave4.mjs` expectations updated where segmented complete refs are now visible.

Boundary coverage includes below/at/above bounds where applicable, stale exclusion, invalid replacement atomicity, 4,097-job continuation, changed-middle job/proposal resume rejection, Runtime-owned proposal-page recovery after Brain+Memory reload without provider reinvocation, >8,192 descendant drillback, failed summary replacement atomicity, correction/rebuild/restore, term recovery beyond the first 512 fallback rows, sealed-packet immutability and cache-history reload.

## Validation state

This chat environment cannot clone GitHub directly because outbound DNS to github.com is unavailable, so it does **not** claim a local full-suite execution.

The authoritative exact-head execution evidence is the GitHub Actions checks on draft PR #328. The Worker 2 workflow includes:

- exact-head checkout verification;
- focused Memory regressions;
- `npm run check` syntax sweep;
- browser-facing import checks;
- a full `node --test tests/*.mjs` baseline-diff lane that rejects newly failing test names relative to its configured starting baseline.

The repository assembly verification CLI remains `node scripts/verify-assembly-manifest.mjs <lane-entry.json> <observed-state.json>`; no Worker 2 assembly manifest/digest was silently rewritten in this closure.

Do not describe the final branch as all-green until the PR checks for the final closure head have completed.

## Residuals and integration notes

- Row 65 requires Worker 3 deployment integration and then real callsite regression coverage.
- No new dense-recall/vector failure is claimed from the provided live finding where EMBED_QUERY preceded artifact indexing. Supporting vector changes on this branch are limited to keeping candidate transport references bounded/truthful as required by the assigned cap work.
- Rows 37/41/44 remain follow-up territory outside this closure except where complete segmented refs had to flow through an assigned repair.
- No live-host acceptance is claimed by synthetic tests.
- No raw narrative, credentials, hidden reasoning or provider payload bodies were added to commits.
- No merge is authorized by this document; PR #328 remains draft for integration review.
