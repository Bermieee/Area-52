# UI.Core Wave 10 — Generation Context + Cognitive Forensics

## Purpose

Wave 10 connects the existing #145 PromptPlan / Adaptive Context UI and #152 Cognitive Transaction / Forensics UI into one operator flow:

```text
Brain
  -> Why did this generation receive this context?
  -> Inspect context plan
  -> Brain Inspector
  -> Why This Generation?
  -> Cognitive Forensics
  -> recorded source-to-seal path
```

It extends the accepted UI.Core / Phase-2 shell. It does not create another workspace registry, inspector, action router, render scheduler, signal hub, overlay system, or theme.

## Operator walkthrough — Ember Tavern / Sun Blade

1. Serve the repository root and open `/demo/phase2-shell/`.
2. Select **Ambiguous / Jev**.
3. Expand Area-52 and open **Brain**.
4. Under **Generation Context**, read the current generation summary:
   - available / allocated / remaining budget;
   - reused, rebuilt and updated sections;
   - dropped / deferred counts;
   - model profile;
   - fallback;
   - final packet estimate;
   - unresolved evidence count.
5. Choose **Inspect context plan**.
6. In Detail view, the shared Inspector shows ordered context sections, revision fences, source revision identities, authority labels and the recorded decision trail.
7. Choose **Why This Generation?** to inspect each allocation in order. Each section exposes its owner-published reason; missing reasons stay explicitly unavailable.
8. Choose **Forensics**. The semantic path shows only recorded steps:
   `Source -> Proposal -> Validation -> Owner Settlement -> State / Reflection -> Retrieval -> Compiled Context -> Context Seal`.
9. The Sun Blade settlement remains **UNRESOLVED**. The ContextReceipt carries both competing alternatives and the compiled `UNRESOLVED_EVIDENCE` section retains UNRESOLVED authority.
10. The late Green Room result appears after the seal in history. It is not included in the Context Seal admitted-result list and the UI states that it did not alter the sealed generation.

## Normal / Detail / Advanced

### Normal

Normal Brain presentation answers the operator question without raw payloads:

- generation identity;
- budget;
- allocation/reuse/rebuild summary;
- dropped/deferred summary;
- model profile;
- fallback state;
- final packet estimate;
- unresolved-evidence count.

The **Why This Generation?** workspace shows ordered section allocations with token estimates and recorded reasons.

### Detail

Detail Inspector adds:

- world / Scene revision fences;
- source revision references;
- source subsystem;
- authority labels;
- unresolved evidence;
- semantic decision trail.

### Advanced

Advanced inspection may expose exact read-only payloads and lazy retained forensic details. Provider/debug detail is not rendered in Normal or Detail.

## Authority and mutation boundary

Wave 10 is observational by default.

- Confidence is never mapped to authority.
- SOURCE CANON, OBSERVED, INFERRED, SETTLED/CURRENT, HISTORICAL and UNRESOLVED remain visually and structurally distinct.
- No Wave 10 action settles, corrects, overrides or mutates cognitive state.
- Navigation, Why and Inspect operations continue through UI.Core Action Router contracts.
- Future correction controls must route through the owning subsystem's registered Action Router contract; UI.Core does not become mutation authority.

## Recorded-only forensic path

`buildForensicPath()` maps existing CognitiveTransaction rows into an operator path.

A path step is marked `MISSING` when no corresponding transaction exists. The UI does not promote reference-only or absent data into a fabricated completed cognitive step.

Loading review data intentionally demonstrates a partial Source / Proposal path with missing downstream stages.

## Fixture and live separation

The Phase-2 review shell uses realistic contract-shaped fixtures through the same reader seams used by production UI:

- `PromptPlanReadModel`;
- `ContextReceiptReadModel`;
- `ContextSealReceipt`;
- `ForensicReadModel`;
- `CognitiveTransaction`.

The reader adapters explicitly report `FIXTURE`; fixture data cannot visually masquerade as LIVE.

The demo now includes two additional full-shell review states:

- **Context loading** — PromptPlan assembly is WORKING and no Context Seal is implied;
- **Stale context view** — an older Scene revision is shown with STALE health.

The pre-existing Healthy, Hot-only, Retrieval-heavy, Ambiguous/Jev, Degraded and Empty/Fresh Install scenarios remain available.

## Real UI contracts vs fixture-backed data

### Real UI.Core code paths

- `createWave6ProductInterface()`;
- `PromptPlanProductionUIAdapter`;
- `ForensicsProductionUIAdapter`;
- PromptPlan / ContextReceipt / ContextSeal normalization;
- generation explainability;
- CognitiveTransaction normalization;
- ForensicMetadataIndex;
- existing Workspace Registry;
- existing Inspector Controller / Inspector Registry;
- existing Action Router;
- existing Render Scheduler;
- existing virtualization and lifecycle cleanup;
- Wave 8 Brain workspace.

### Fixture-backed in `demo/phase2-shell/`

- Ember Tavern PromptPlan / ContextReceipt / ContextSeal values;
- Ember Tavern ForensicReadModel and CognitiveTransaction rows;
- Wave 8 cognition receipts;
- Scene / character / lore / memory / world review data.

### Still live-binding work

#224 remains open. Demo-ready live integration still requires real host Scene, Lore, Memory, Runtime, Result Bus/Gather, Settlement/Jev, Context Compiler, Context Seal and PromptPlan producers to publish these contracts in one live SillyTavern run.

## States

The connected UI handles:

- healthy / ready;
- working / loading;
- stale;
- degraded / fallback;
- empty;
- missing provider / unavailable;
- missing forensic stage;
- unresolved evidence;
- rejected / stale / late results.

Late results remain historical/forensic evidence and cannot visually rewrite an already sealed generation.

## Layout and accessibility

Wave 10 stays within the existing Phase-2 responsive and visual system:

- wide, compact and stacked UI.Core behavior;
- Phase-2 dock width presets;
- keyboard-addressable controls;
- semantic timeline / path labels;
- non-color authority and health labels;
- visible focus inherited from UI.Core;
- reduced-motion support;
- virtualized forensic activity;
- shared Inspector;
- normal destroy/recreate lifecycle.

## Card status

Wave 10 supplies user-facing acceptance evidence for #145 and #152 on `Development-UI`.

It does not close #224 and does not claim Phase 2 complete.

Director acceptance / demo-ready merge remains a separate gate.
