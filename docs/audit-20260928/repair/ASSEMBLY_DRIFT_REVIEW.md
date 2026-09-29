# Assembly drift review (follow-up round)

Scope: the paths my repair overlay added to `assembly/reconciliations/repair-installed-architecture-20260928.json` (30 in the first version: 27 pre-existing drift plus 3 repair-added; the Scene lifecycle runtime became a 4th repair-added path in this round, giving 31 reviewed).

## Method (a matching hash alone is not approval)

For each path: (1) provenance: `git log ba4619f..HEAD -- path` split into commits already on `origin/main` (<= 98a4e43, the audited main) and commits on this branch; `deploymentBaseSha` ba4619f is 2,150 commits older than main, so pre-existing drift is post-checkpoint owner work the lane manifests never recorded; (2) the recovered lane source blob was diffed against the current file (added/removed lines and hunk count below); (3) the covering tests were run in this round's sweep; (4) an approval requires provenance fully explained by named commits AND no currently failing test that concerns the path's contract AND, for executable code, at least one covering test. Otherwise the path is WITHHELD and stays unexpected drift. Approval blesses current content as a reviewed integration state; it does not accept the underlying behavior.

Result: **23 approved, 8 withheld**. `node scripts/verify-development-deployment.mjs` is **FAIL** with exactly the 8 withheld paths unexpected (jev 1, ui 7). This is deliberate and is reported, not hidden.

| Path | Lane diff vs checkpoint | Main commits (ba4619f..98a4e43) | Branch commits | Covering test files | Verdict |
|---|---|---|---|---|---|
| `src/coprocessor/coprocessor-ui-read-model.js` | +271/-24 in 1 hunks | 6 | 0 | 2 | APPROVED (main-authored drift, provenance complete) |
| `src/coprocessor/resource-connections.js` | +547/-56 in 13 hunks | 35 | 1 | 5 | **WITHHELD**: coprocessor-wave14-connections (manual model id qualification) fails against it (CONTRACT-DRIFT, owner decision open); 36 commits, 547 added lines, plus the Wave 4 repair |
| `src/coprocessor/resource-host-adapter.js` | +25/-2 in 1 hunks | 7 | 0 | 3 | APPROVED (main-authored drift, provenance complete) |
| `src/coprocessor/speculative-warmer-coordinator.js` | +230/-13 in 17 hunks | 10 | 0 | 2 | APPROVED (main-authored drift, provenance complete) |
| `src/coprocessor/speculative-warmer.js` | +34/-5 in 6 hunks | 7 | 0 | 4 | APPROVED (main-authored drift, provenance complete) |
| `src/lore-intelligence-service.js` | +579/-59 in 18 hunks | 9 | 2 | 11 | APPROVED (repair-changed; tests below) |
| `src/scene/atmosphere.js` | +45/-10 in 1 hunks | 4 | 1 | 15 | APPROVED (repair-changed; tests below) |
| `src/ui-core/index.js` | +8/-0 in 1 hunks | 8 | 0 | 158 | APPROVED (main-authored drift, provenance complete) |
| `src/ui-core/wave12-sillytavern-host.js` | +64/-11 in 6 hunks | 17 | 0 | 2 | APPROVED (main-authored drift, provenance complete) |
| `src/ui-core/wave13-floating-navigation.js` | +115/-80 in 6 hunks | 8 | 0 | 0 | **WITHHELD**: JavaScript with no covering test and 115/80 changed lines in the same failing wave13 surface set |
| `src/ui-core/wave13-operator-adapters.js` | +1002/-57 in 16 hunks | 54 | 0 | 4 | **WITHHELD**: 13 wave13-operator-ui tests fail (UI-DRIFT: "Unknown workspace: memory", missing labels); the module and its test both drifted on main and disagree; 1,002 added lines / 54 commits not reviewable as intent without the UI owner |
| `src/ui-core/wave13-operator-surfaces.js` | +1161/-101 in 4 hunks | 82 | 0 | 1 | **WITHHELD**: wave13-operator-ui (13) and worker3-lore-neural-ui (105 hubs) fail against it; 1,161 added lines / 82 commits |
| `src/ui-core/wave6-front-face.js` | +16/-9 in 5 hunks | 6 | 0 | 1 | **WITHHELD**: wave6 Front Face dimension-clamp test fails (1440 vs 960, UI-DRIFT) |
| `src/ui-core/wave6-presentation.js` | +28/-8 in 4 hunks | 7 | 0 | 2 | APPROVED (main-authored drift, provenance complete) |
| `src/ui-core/wave6-runtime.js` | +116/-25 in 5 hunks | 28 | 0 | 1 | APPROVED (main-authored drift, provenance complete) |
| `styles/ui-core-wave13.css` | +691/-30 in 2 hunks | 21 | 0 | 2 | **WITHHELD**: 691 added lines belonging to the failing wave13 surface set; no test gates it |
| `styles/ui-core-wave8.css` | +57/-14 in 3 hunks | 3 | 0 | 1 | APPROVED (main-authored drift, provenance complete) |
| `styles/ui-core.css` | +16/-5 in 5 hunks | 5 | 0 | 0 | APPROVED (main-authored drift, provenance complete) |
| `tests/wave12-sillytavern-host.test.mjs` | +53/-2 in 3 hunks | 9 | 0 | 0 | APPROVED (main-authored drift, provenance complete) |
| `tests/wave13-operator-ui.test.mjs` | +853/-33 in 12 hunks | 56 | 0 | 0 | **WITHHELD**: the drifted test itself is the failing gate (13 failures); approving it would bless a red test |
| `tests/wave8.test.mjs` | +15/-0 in 2 hunks | 3 | 0 | 0 | APPROVED (main-authored drift, provenance complete) |
| `src/lore-representation-registry.js` | +18/-6 in 5 hunks | 3 | 1 | 1 | APPROVED (repair-changed; tests below) |
| `src/lore-source-registry.js` | +44/-1 in 2 hunks | 2 | 2 | 2 | APPROVED (repair-changed; tests below) |
| `src/lore-study-runtime.js` | +47/-7 in 3 hunks | 3 | 2 | 11 | APPROVED (repair-changed; tests below) |
| `docs/SCENE_INTEGRATION_SIGNAL_CONTRACT.md` | +20/-0 in 1 hunks | 2 | 0 | 0 | APPROVED (main-authored drift, provenance complete) |
| `src/memory-temporal-producer.js` | +421/-21 in 18 hunks | 21 | 0 | 15 | APPROVED (main-authored drift, provenance complete) |
| `src/memory-ui-read-model.js` | +15/-3 in 3 hunks | 2 | 0 | 1 | APPROVED (main-authored drift, provenance complete) |
| `tests/memory-wave4.mjs` | +12/-4 in 1 hunks | 3 | 0 | 0 | APPROVED (main-authored drift, provenance complete) |
| `src/ui-core/shell.js` | +4/-2 in 1 hunks | 3 | 0 | 17 | APPROVED (main-authored drift, provenance complete) |
| `styles/ui-core-wave6.css` | +4/-4 in 2 hunks | 2 | 0 | 1 | **WITHHELD**: styles the wave6 Front Face whose test fails; withheld with it |
| `src/scene/scene-lifecycle-runtime.js` | +275/-18 in 3 hunks | n/a (see below) | several (Waves 3, 4, follow-up Scene restore) | 2 | APPROVED (repair-changed; tests below) |

## Notes per group

- **Main-authored drift (approved)**: Bermie-authored commits dated 2026-09-24..28 on main; the diff sizes and hunk counts above are consistent with the commit subjects (Memory feedback contract, warmer fencing, Vectoring rebind, UI motion default, etc.). I checked the hunk headers, not the full behavior of each UI diff; UI behavior remains the UI owner's to confirm.
- **Repair-changed (approved)**: `lore-*` (Waves 5, 6, follow-up batching), `scene/atmosphere.js` (Wave 0), `scene/scene-lifecycle-runtime.js` (export/restore state): covering tests pass in this round's sweep (see the ledger).
- **Withheld**: reasons in the table. To release: fix or re-baseline the failing tests with the owner, re-run the verifier, add the digest to a new reviewed overlay.
- Docs/tests/styles with no failing gate (`docs/SCENE_INTEGRATION_SIGNAL_CONTRACT.md`, `tests/memory-wave4.mjs`, `tests/wave8.test.mjs`, `tests/wave12-sillytavern-host.test.mjs`, `styles/ui-core.css`, `styles/ui-core-wave8.css`) are approved on provenance alone.

Evidence: sweep of 237 test files this round, 17 failing files / 32 failing tests, every failing test name present in the baseline list (`audit-20260928/results/base2_fails.tsv`).

## Addendum: D7 temporal-rules round (repair-authored paths)

Five Lore paths were changed by this repository's own D7 work and are approved with fresh digests (repair-changed, all covering tests pass on the exact head `c7494ae`; see the D7 ledger row): `src/lore-contextual-retrieval.js`, `src/lore-intelligence-service.js`, `src/lore-source-registry.js`, `src/lore-study-engine.js`, `src/lore-study-runtime.js`. `src/lore-temporal-rules.js` is a new file that no lane manifest lists. The verifier still fails on exactly the same 8 withheld paths listed above.

Jev advisory change: `src/lore-intelligence-service.js` gained the read-only `conflictSetsForStory`/`conflictSets` interface and its digest was refreshed; no other lane file changed. The verifier still fails on exactly the 8 withheld paths.
