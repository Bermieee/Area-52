# Worker 1 cap-remediation closure

Branch: `Development-Worker-1`  
Baseline: `main@1de19e82a0083d5dfa70175bc0434dae45ee676c`

## Disposition

| Row | Disposition | Closure |
| --- | --- | --- |
| 7 | FIXED | Entity compatibility payload remains bounded to 16 aliases and legacy alias artifacts remain bounded to 7. Explicit aliases beyond those windows are retained in 7-alias continuation artifacts; retrieval context and story identity surfaces consume the continuation pages. |
| 10 | FIXED | Source slicing keeps the 128-slice physical window. Oversized sources are represented by a manifest of bounded slice segments with full-source slice coverage. |
| 14 | FIXED | The 24,000-character limit remains a physical representation-segment limit. Oversized profiles publish one aggregate representation manifest only after every bounded segment validates. |
| 15 | FIXED | The 96,000-character provider-request limit remains per segment. Oversized compile work is split into bounded provider calls rather than rejected as one request. |
| 19 | FIXED | `queryForStory` now carries a `LoreRetrievalCoverageReceipt` with examined, examined-capped, matched, returned and bounded-out counts. The public producer receipt preserves it and explicitly does not claim full-corpus coverage. |
| 20 | VERIFIED_BY_DESIGN | Candidate text and ref transport stay bounded. Candidates expose transport completeness and a stable retrieval-record drillback ref; source drillback now has a paged continuation API, so the 64-ref transport envelope is not an identity ceiling. |
| 23 | FIXED | Community construction no longer stops at 256. Community scopes are retained and exposed through 256-scope manifest pages. |
| 24 | FIXED | Hierarchy construction no longer throws when total scopes exceed 12,000. All derived scopes remain present and are exposed through 12,000-scope manifest pages. |
| 25 | FIXED | Source/evidence references are represented with 4,096-ref pages. Summary text is split into independently validated <=12,000-character segments with an aggregate coverage receipt. Registry/retrieval evidence resolution walks pages instead of dropping the summary. |

## Fencing, durability and authority

Representation compile sessions fence the source revision before and after each provider segment and again before publication. Partial sessions publish nothing. Compiler sessions are included in the multi-resolution snapshot so an interrupted build can resume after reload. If the source revision advances, the old session becomes `SUPERSEDED` and cannot publish a mixed-revision representation.

Navigation summary publication remains derived/read-only. Paged manifests and segmented summaries do not gain source, truth, settlement or mutation authority. Exact authored source remains the retrieval/drillback authority.

## Validation coverage

Focused tests cover:

- source text requiring more than 128 physical slices, with sentinel facts at the beginning, middle, end, and across a physical segment overlap;
- representation segments at <=24,000 characters and provider work at <=96,000 characters;
- compile checkpoint/restore and edit-during-build supersession;
- alias retention beyond the 16/7 compatibility windows;
- ranked nomination overflow propagated by `queryForStory` and the operator-facing producer receipt;
- more than 256 communities;
- more than 12,000 hierarchy scopes, including a source beyond the former boundary;
- more than 4,096 evidence references;
- summary text requiring multiple <=12,000-character segments;
- unchanged single-segment behavior in the existing representation cap-remediation suite;
- exact authored-source drillback in the existing Lore Wave 3 suite;
- two unrelated story/chat isolation in the deployment live-host suite.

## Remaining row 18 boundary

Row 18 remains **OPEN_WITH_EVIDENCE** and is not claimed closed by Worker 1. Retrieval now truthfully reports `examinedCapped`, but the 512-record examined working-set page still has no continuation mechanism. That is a separate retrieval paging seam; ranked results must not be interpreted as exhaustive corpus coverage.

## Files changed by Worker 1

- `src/lore-study-engine.js`
- `src/lore-representation-compiler.js`
- `src/lore-multi-resolution.js`
- `src/lore-representation-registry.js`
- `src/lore-navigation-hierarchy.js`
- `src/lore-navigation-summary-builder.js`
- `src/lore-navigation-summary-registry.js`
- `src/lore-contextual-retrieval.js`
- `src/lore-hierarchy-retrieval-system.js`
- `src/lore-intelligence-service.js`
- `tests/cap-remediation-lore-representation.test.mjs`
- `tests/cap-remediation-lore-worker1.test.mjs`

No merge to `main` is part of this closure.
