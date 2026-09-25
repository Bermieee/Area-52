# UI.Core Wave 10 Acceptance — #145 + #152

## Scope

Wave 10 connects the existing PromptPlan / Adaptive Context explainability surface (#145) and Cognitive Transaction / forensic timeline surface (#152) into one operator-facing experience inside the existing Phase-2 UI.Core shell.

Validated implementation checkpoint: `f9ff0117c6c06149bd5fbac6eee9883ecba95d28`.

GitHub Actions implementation run `36053840998` completed **SUCCESS**.

## #145 — PromptPlan / Adaptive Context

User-facing acceptance is demonstrated on the review shell. The operator can answer **"why did this generation receive this context?"** without reading raw source or a full prompt.

Normal Brain presentation includes available / allocated / remaining budget, reused / rebuilt / updated section counts, dropped / deferred content, model profile, fallback state, final packet estimate, unresolved-evidence count, and explicit data-source mode.

The **Why This Generation?** workspace presents ordered allocations, token estimates, reuse/rebuild state and owner-published reasons. Missing reasons remain unavailable rather than inferred.

The shared Inspector adds revision fences, source-revision identity, authority labels, underlying context sections and the recorded decision trail. Raw payload/provider detail remains Advanced-only.

## #152 — Cognitive Transaction / Forensics

User-facing acceptance is demonstrated with the Ember Tavern / Sun Blade trace.

The connected forensic path reconstructs recorded semantic steps:

```text
Source
 -> Proposal
 -> Validation
 -> Owner Settlement
 -> State / Reflection
 -> Retrieval
 -> Compiled Context
 -> Context Seal
```

No path step is fabricated. An absent transaction renders as **MISSING**.

The Sun Blade conflict remains **UNRESOLVED** through owner Settlement, ContextReceipt unresolved evidence, the `UNRESOLVED_EVIDENCE` compiled section, and sealed context authority.

A late Green Room result is recorded after the Context Seal, remains visible for forensics, is not in the seal's admitted-result set, and is explicitly described as unable to rewrite the sealed generation.

## Authority / mutation boundary

Wave 10 remains observational by default.

- Confidence is not authority.
- SOURCE CANON, OBSERVED, INFERRED, SETTLED/CURRENT, HISTORICAL and UNRESOLVED remain distinct.
- Wave 10 registers no correction, settlement, override or mutation action.
- Why / Inspect / navigation continue through the existing UI.Core Action Router.
- Future corrections must use the owning subsystem's registered mutation contract.

## Fixture / live truth

The Phase-2 review shell drives the real UI.Core adapter and presentation paths with contract-shaped deterministic fixture readers.

Real UI code paths exercised include `createWave6ProductInterface()`, PromptPlan / ContextReceipt / ContextSeal normalizers, `PromptPlanProductionUIAdapter`, `ForensicsProductionUIAdapter`, CognitiveTransaction normalization, `buildForensicPath()`, the existing Brain workspace, Workspace Registry, Inspector, Action Router, Render Scheduler, virtualization and lifecycle runtime.

Fixture-backed review data includes Ember Tavern PromptPlan / ContextReceipt / ContextSeal, ForensicReadModel / CognitiveTransaction ledger, existing Wave 8 cognition review receipts, and review Scene / Lore / Memory / World models.

Fixture-backed readers report **FIXTURE**, never LIVE.

## State coverage

Focused acceptance covers READY, WORKING/loading, STALE, DEGRADED/fallback, EMPTY, UNAVAILABLE/missing provider, MISSING forensic stage, UNRESOLVED evidence, and rejected/stale/late work.

## Validation evidence

Implementation checkpoint `f9ff0117c6c06149bd5fbac6eee9883ecba95d28`:

- full UI.Core regression: **249 / 249 PASS**;
- Wave 7 explainability regression: **35 / 35 PASS**;
- Wave 8 Brain regression: **44 / 44 PASS**;
- Wave 9 shell regression: **19 / 19 PASS**;
- Wave 10 focused acceptance: **11 / 11 PASS**;
- Wave 10 forensic stress: **PASS**;
- JavaScript syntax: **PASS**;
- browser-facing source guard with `Buffer=undefined`: **PASS**;
- UI.Core ESM import: **PASS**.

Wave 10 stress exercised **10,011** cognitive transactions, **120** generation/forensics workspace switches and **300** Inspector cycles. DOM remained **284 nodes** before and after churn, scheduler pending work before final flush was **0**, UI signal listeners after destroy were **0 / 0 / 0**, and root children after destroy were **0**.

At the same implementation checkpoint, UI.Core Wave 9 run `36053840953`, Wave 5 run `36053841162`, Wave 4 run `36053841094`, and Wave 3 run `36053841092` were also GREEN.

## Card status

The user-facing acceptance criteria for **#145** and **#152** are demonstrably represented and tested on `Development-UI` with contract-shaped fixture-backed data.

The issues remain open pending Director acceptance / demo-ready merge policy.

**#224 remains OPEN.** Wave 10 does not prove live Scene, Lore, Runtime, Gather, Settlement/Jev, Context Compiler, Context Seal or PromptPlan integration in one real SillyTavern run.

**WAVE 10 #145/#152 UI ACCEPTANCE EVIDENCE READY / DIRECTOR ACCEPTANCE + LIVE #224 BINDING PENDING**
