# Phase 1 Gate Evidence Contract

`Phase1GateEvidenceAggregator` makes the eventual Phase 1 promotion review mechanically inspectable without granting promotion authority to the evidence system.

Evidence categories:
- subsystem checkpoint;
- CI;
- golden world;
- stress;
- browser;
- restart/recovery;
- freshness and stale-result handling;
- function tests;
- performance/resource evidence;
- open blockers;
- UI/diagnostic readiness;
- cross-lane compatibility.

Each category is PASS, PARTIAL, BLOCKED or NOT_RUN. Missing evidence remains NOT_RUN. The aggregator never converts absence into PASS.

The report intentionally emits:
- `promotionDecision: null`;
- `phase2PromotionAllowed: false`.

Wave 4 Core evidence leaves the program gate BLOCKED because assembled-main/live function tests, visual UI acceptance, full Runtime/Scene integration and representative live workload evidence remain external requirements. This is expected and is not a Core failure.

The aggregator is evidence for #157; it does not close #157 and does not start Phase 2.

## Wave 5 knowledge readiness dimensions

The report now tracks knowledge readiness independently for `CORE`, `MEMORY_OWNER`, `LORE_OWNER`, `SENSORY`, `PRECISION`, and `LIVE_ASSEMBLED_MAIN`. This prevents `CORE SIDE READY FOR FT003/FT004` from being misreported as a live Function Test PASS. At the Wave 5 functional checkpoint Core is ready, while owner/live dimensions remain explicitly partial or blocked.
