# UI.Core Wave 8 Acceptance

## Primary issue

#226 — UI: Live Brain Cognition Workspace — Sensory Net, Truth, Jev, Gather + Seal

## Acceptance posture

Wave 8 is accepted on UI-owned behavior only when:

- the existing Brain workspace presents one coherent cognition path;
- missing producers remain UNAVAILABLE;
- explicit fixtures remain FIXTURE;
- stage execution is not inferred from architectural existence;
- skipped/deferred/LOW/ABSTAINED/UNRESOLVED remain valid outcomes;
- stale/late/invalid work cannot appear as current generation contribution;
- authority is never inferred from rank, channel count or confidence;
- Jev remains separate from Settlement;
- large collections stay bounded/virtualized;
- lifecycle/browser/accessibility regressions remain green.

The project-level #224 gate is broader and is not closed by UI fixture evidence.

## Required cognitive scenarios

### Hot-only

Fixture proves:

- Brain chose Hot Cognition;
- retrieval explicitly SKIPPED;
- Sensory explicitly SKIPPED;
- Truth explicitly SKIPPED;
- Jev explicitly SKIPPED;
- Precision explicitly SKIPPED;
- reasons come from the fixture Choice receipt.

### Retrieval-heavy

Fixture proves:

- 10 candidate cognition jobs;
- 4 admitted;
- 5 skipped;
- 1 deferred;
- 18 Sensory nominations -> 7 unique;
- four channel summaries;
- HIGH retrieval;
- CURRENT / HISTORICAL / UNRESOLVED Truth rows;
- Precision 7 -> 5;
- Gather 5 admitted;
- Context Seal SEALED;
- PromptPlan linked.

### Ambiguous / Jev

Fixture proves:

- MIXED retrieval;
- one bounded corrective pass;
- UNRESOLVED evidence preserved;
- Jev invoked;
- Jev ABSTAINED;
- owner settlement remains NO_MUTATION;
- Jev confidence remains metadata.

### Controlled degradation

Fixture proves:

- degraded retrieval channel;
- failed bounded corrective pass;
- Jev producer unavailable;
- Scene result STALE and excluded;
- Green Room result LATE and routed for future cognition;
- malformed Graph result INVALID and excluded;
- Context Seal still publishes only admitted current result.

## Ember Tavern / Sun Blade

The deterministic acceptance fixture contains:

- CURRENT Ember Tavern = destroyed;
- HISTORICAL Sun Blade = left at Ember Tavern;
- CURRENT Sun Blade location = unknown;
- competing destroyed in fire vs removed before fire;
- Truth = UNRESOLVED;
- Jev may be invoked but does not force Settlement;
- final admitted evidence never claims a false current possession/location.

## Live binding status

Wave 8 has typed optional seams for Worker-1/2 output.

Current contract status:

- Candidate Bus/Sensory contracts exist;
- TruthAssessment / correction contracts exist;
- PrecisionResult exists;
- ContextSealReceipt exists;
- PromptPlan/ContextReceipt/Forensic read models exist;
- SceneUiReadModel exists on the Scene lane;
- Worker 1 has landed canonical `CognitiveChoiceReceipt` v1.0.0 on `Development-Nexus`;
- Worker 2 has landed canonical `JevDecisionReceipt` v1.0.0 on `Development-Sidecar/Jev`;
- Wave 8 has focused contract-conformance tests for both receipts;
- assembled live Gather/Lore-status and cross-lane producer proof remain integration dependencies.

The UI branch does not copy Worker 1/2 production code. Until Integration supplies the owning live readers on an assembled build, production UI shows UNAVAILABLE. Deterministic contract-shaped test/demo data remains explicitly FIXTURE.

## Regression requirements

Final exact-head Wave 8 validation must run:

- `npm test`
- `npm run test:ui:wave8`
- `npm run test:ui:wave6`
- `npm run test:ui:wave6:stress`
- `npm run test:ui:wave8:stress`
- JavaScript syntax checks
- Wave 8 browser-source guard
- UI.Core ESM import

## Stress requirements

Wave 8 stress exercises at least:

- 5,000 cognition activity signals;
- 1,000 cognition-path updates;
- 500 generation selections;
- 500 Inspector cycles;
- 500 workspace switches;
- 10,000 candidates;
- 10,000 Gather results;
- 20,000 forensic metadata rows;
- 1,500 rapid stale/late updates.

Acceptance requires bounded scheduler work, bounded virtual windows/DOM, one released cognition subscription, zero tracked listeners after destroy, empty root after destroy, and restored presentation state.

## Issue discipline

#226 may close after exact-final UI validation.

#224 and #225 remain open/shared.

#145 and #152 remain open until real assembled producer bindings—not fixtures—satisfy their full acceptance.

#187 remains the broad Phase-2 UI conformance gate until project-level promotion.
