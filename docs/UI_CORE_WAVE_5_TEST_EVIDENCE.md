# UI.Core Wave 5 — Test Evidence

Accepted Wave 1–4 baseline at kickoff: **77 tests**.

Wave 5 adds **24 deterministic tests** covering:

- UI-only detail-level persistence;
- authority validation;
- required product fixtures;
- Ember Tavern / Sun Blade temporal truth;
- large-world lightweight summaries;
- Brain Activity translation and 1,500-event coalescing;
- product navigation and Home default migration;
- Scene Normal/Advanced disclosure;
- inferred character relationships;
- Lore Tree preservation;
- Memory learning/reconsolidation truth separation;
- World historical/current separation;
- generic Brain gateway discovery;
- unknown-extension Front Face summaries and cleanup;
- unavailable extension degradation;
- data-only extension descriptors;
- Home generic extension summary consumption;
- notification acknowledge/dismiss/cleanup and Home interaction controls;
- fixture-backed PromptPlan disclosure;
- responsive/reduced-motion CSS;
- no synthetic-subsystem shell hardcoding.

Final CI evidence is recorded only after the final committed bytes complete the Wave 3, Wave 4, and Wave 5 validation workflows.


## Accepted implementation checkpoint

Implementation checkpoint: `3256fdfe9cbdbed74809d586fdbe1d90db3065af`

Validation on that exact commit:

- full deterministic suite: **101/101 PASS**;
- Wave 5 focused suite: **24/24 PASS**;
- Wave 1–4 accepted regression tests: preserved inside the 100-test full suite;
- JavaScript syntax validation: **PASS**;
- UI.Core index import: **PASS**;
- UI.Core Wave 3 workflow: **SUCCESS** (run 35828502585);
- UI.Core Wave 4 workflow: **SUCCESS** (run 35828502594);
- UI.Core Wave 5 workflow: **SUCCESS** (run 35828502628).

The final documentation-only acceptance commit is required to pass the same workflows before handoff.
