# UI.Core Wave 9 Acceptance

Wave 9 acceptance is evaluated on the exact `Development-UI` head by `.github/workflows/ui-core-wave9.yml`.

## Accepted implementation evidence

Validated implementation head: `2dbb1e2fb29daded1edbbf00035da5b85e465c5d`.

GitHub Actions run `36045770696` completed **SUCCESS** and proved:

- full UI.Core regression: **237 / 237 PASS**;
- Wave 9 focused acceptance: **18 / 18 PASS**;
- Wave 6 focused regression and lifecycle stress: **PASS**;
- Wave 8 focused regression: **44 / 44 PASS**;
- Wave 8 cognition stress: **PASS**;
- Wave 9 full-shell stress: **PASS**;
- JavaScript syntax validation: **PASS**;
- static shell contract: **PASS**;
- browser-facing Wave 9 module/source guard with `Buffer=undefined`: **PASS**;
- UI.Core ESM import: **PASS**.

Wave 9 shell stress exercised **1,000** collapse/expand cycles, **600** disclosure switches, **700** workspace switches, **500** Inspector cycles, **500** Inspector visibility changes, **500** width changes, **400** responsive preset changes and **60** scenario remounts. Large review sets included **10,000 Lore entries**, **10,000 Memory records**, **10,000 cognition candidates** and **10,000 Gather results**. The virtual mounted window remained bounded at **26**; tracked workspace/inspect/wildcard listeners were **0 / 0 / 0 after destroy**; root children after destroy were **0**; persisted presentation state restored successfully.

The focused suite covers Quick Dash collapse/expand; seven-workspace navigation; shared Inspector use; Normal/Detail/Advanced disclosure; six explicit FIXTURE scenarios; responsive and width presets; empty/degraded/stale/late/invalid states; Ember Tavern / Sun Blade consistency; bounded virtualization; clean destroy; and the explicit rule that #224 live binding remains pending.

The shell's static contract requires repository-relative browser assets, explicit `DEMO / FIXTURE DATA`, a neutral `HOST-OWNED SURFACE`, reduced-motion support, no fake host-chat markup, no Node-only browser dependency, and direct ESM loading.

Passing Wave 9 means the static shell is ready for director visual review. It does **not** close #187, #224, #145 or #152 by itself and does not claim Phase 2 complete.

**PHASE-2 DEMO SHELL READY FOR DIRECTOR VISUAL REVIEW / LIVE #224 BINDING PENDING**
