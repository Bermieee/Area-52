# Area-52 Native Brain — subsystem completion acceptance

Branch: `Development-Nexus`

## Branch coordination

- Director-observed baseline: `ba4619f56db8e4f94873256dc26589e1680b7d29`.
- Verified live branch before this completion pass: `0be5cf077828fbdcefd0854f00bfed8599551a87`, already 23 commits ahead / 0 behind the observed baseline.
- Verified `main` before editing: `bb0c1dd82a955ecccb1253c06fc04d7754fb7611`.
- No new branch was created and no UI, Jev/sidecar, Lore Study, or `main` owner files were taken over.

## Strongest valid claim

**NATIVE BRAIN SUBSYSTEM READY FOR MAIN/HOST ASSEMBLY.**

The in-process Brain now owns the native incoming-turn -> cognition -> retrieval -> Truth/Gather/Context Seal -> PromptPlan -> host-generation handoff -> post-turn observation -> safe learning loop without requiring Jev, a sidecar, an external database, SQL, a remote cognition model, or user-managed orchestration.

This is **not** a live SillyTavern / #224 acceptance claim. The repository suite includes deterministic acceptance and a host-callback contract test; the real SillyTavern generation path still has to assemble this branch with Worker 3's host adapter on `main`.

## Native loop

`Area52NativeBrain`:

1. activates the selected chat and consumes Scene owner state;
2. optionally queries Worker 4's `LoreBrainRetrievalInterface@1` and preserves exact source drillback plus the owner source-revision fence;
3. runs Hot Cognition / Cognitive Choice and can explicitly skip unnecessary long-term work;
4. retrieves through native Lore, native Memory, active continuity, graph, temporal, sparse and other registered native channels;
5. sends candidates through Candidate Bus, Truth, optional precision, Gather and Context Seal;
6. compiles and delivers a model-aware PromptPlan;
7. exposes `runTurn(...,{generate})` so the sealed rendered context is the input to the host generation callback;
8. admits the returned narrative as exact experience, then allows only Core Settlement to canonicalize supported observations;
9. records reflections as INFERRED and revision-dependent;
10. schedules non-canonical retrieval feedback on the native Worker Director and can recover that work after reload.

## Corrections, perspective, and late work

- Character-knowledge perspective now fences both native Memory retrieval and the Hot Cognition recent-episode tail. Private narrative evidence is not copied into another character's context.
- Correcting a narrative source invalidates its prior source revision, updates the hot narrative tail, invalidates dependent Temporal claims, and fences reflections whose dependency revision is no longer active.
- Context Seal remains the hard foreground boundary. Late required results cannot mutate the already sealed generation.
- Snapshot/reload restores Source Registry, Temporal State Graph, Hot Cognition, Context Seal state, native knowledge, feedback state, turns, Scene signals and Runtime ledger.
- Native feedback work is bounded, resumable and non-canonical.

## Worker 4 Lore Study contract consumed

The Brain accepts Worker 4's published `LoreBrainRetrievalInterface@1`:

- constructor option: `new Area52NativeBrain({loreInterface})`
- runtime attach: `brain.attachLoreInterface(loreInterface)`
- required method: `loreInterface.query({query,intent})`
- required packet: `LoreBrainRetrievalPacket@1`
- consumed fields: `sourceRevisionFence[]`, `indexRevision`, `ontologyRevision`, `nominations[].drillback[].sourceId`, `sourceRevisionId`, `exactAuthoredText`
- owner revision IDs are preserved in provenance and exposed as `selection.ownerSourceRevisionRefs[]`
- Lore Study does not gain Candidate Bus admission, Truth, Settlement or Context Seal authority.

If the Lore interface is absent or errors, the native Brain remains usable with already accepted local Lore and reports `NOT_ATTACHED` / `DEGRADED` rather than inventing Lore.

## Worker 2 optional execution seam

`brain.attachJevAdapter(adapter)` delegates to the existing Cognitive Choice optional Jev boundary. The receipt explicitly keeps `required:false` and `nativePathAvailable:true`. Missing Jev remains a valid native condition and cannot grant authority.

## Worker 3 UI / SillyTavern binding contract

`brain.uiBindings()` returns the Wave 11/12-compatible read-only owner surface:

- `readSelection({chatId})`
- `subscribe(listener)`
- `readScene(selection)`
- `readHotCognition(selection)`
- `readCognitiveChoice(selection)`
- `readSensoryTrace(selection)`
- `readCandidateBusEnvelope(selection)`
- `readCandidateFusionReceipt(selection)`
- `readTruth(selection)`
- `readCorrectiveRetrieval(selection)`
- `readGather(selection)`
- `readContextSeal(selection)`
- `readLoreStatus(selection)`
- `readPromptPlan(selection)`
- `readContextReceipt(selection)`
- `listGenerations({limit,selection})`
- `readGeneration({generationId,...selection})`

Selection is chat/turn/generation/correlation/world/Scene/source-revision aware. Subscription events contain stage + selection only and explicitly carry no raw prompt or response.

Worker 3 should pass this object as the owner `hostBindings` to the existing Wave 12 SillyTavern host adapter. Do not synthesize missing owner identities in UI.

## Acceptance scenarios

Deterministic native Brain coverage includes:

- two unrelated ordinary story worlds;
- multi-turn prior-experience retrieval;
- accepted Lore retrieval;
- Worker 4 Lore Brain packet ingestion;
- changed Scene / scene revision;
- quiet turn with a valid Hot-only / low-work choice;
- contradictory observations remaining unresolved;
- current -> historical transition;
- corrected narrative source and preserved history;
- stale dependent reflection rejection;
- character-perspective privacy;
- snapshot/reload;
- interrupted feedback recovery without duplicate publication;
- late post-seal result rejection;
- no Jev / no sidecar / no external database / no remote cognition model;
- Worker 3 read-selection/subscription surface.

Host-contract coverage additionally executes `runTurn` with a generation callback and proves the returned narrative is learned after sealed context delivery. It is a host API contract test, not a live SillyTavern session.

## Standing-card evidence

| Card | Native Brain evidence | Whole-card status |
| --- | --- | --- |
| #27 Hot Cognition Runtime | Scene/location/cast/continuity/recent tail stay warm; quiet turns can use Hot-only work; recent tail is perspective fenced. | Brain path ready; shared Scene/assembly acceptance remains outside this branch. |
| #6 Hybrid Sensory Net / Candidate Bus | Native Lore + Memory plus existing continuity/graph/temporal/sparse channels nominate into the same deduplicating, revision-aware Candidate Bus; no retriever self-admits. | Native self-contained path ready; broader optional hybrid/backend children remain separate. |
| #5 Temporal State Graph | Current/historical/unresolved are exercised; corrections preserve history; competing observations remain unresolved; only Settlement mutates canonical state. | Native loop acceptance ready; card remains open until Director chooses issue-level closure. |
| #11 Cognitive Runtime Fabric | Native Worker Director schedules bounded nearline feedback, persists ledger/checkpoint state, recovers after reload, and respects sealed-generation fences. | Native Brain work is ready; the umbrella epic still includes other owner lifecycles. |
| #39 Learning Feedback Loop | Completed turns produce non-canonical feedback that adjusts future channel utility only; it cannot settle claims. Dependency-stale reflections are fenced. | Native feedback path ready; broader Memory reconsolidation/maturation remains Memory-owned. |
| #133 Adaptive Context Runtime | Sealed semantic packet -> PromptPlan -> rendered host payload is exercised; delivery remains model-profile/budget aware and cannot rewrite truth. | Native delivery path ready; real SillyTavern assembly/live acceptance remains. |

No Trello card is closed by this branch-only acceptance.

## Validation labels

- **DETERMINISTIC**: repository Node acceptance/regression suites, including ordinary stories, contradiction, correction, privacy, reload, late-result and owner-contract tests.
- **HOST-CONTRACT**: `runTurn` invokes a generation callback with the sealed rendered context and learns the returned response.
- **LIVE**: not claimed. A real SillyTavern generation using Worker 3's `main` host adapter has not been executed from `Development-Nexus`.

## Remaining deficiencies

1. Worker 3 still has to assemble `brain.uiBindings()` and the native generation call into the real SillyTavern host on `main`; until that happens, there is no live #224 / real-host pass.
2. Worker 4's Lore Study implementation remains on its owner branch. This branch consumes its public `LoreBrainRetrievalInterface@1` but does not merge or own Lore Study.
3. Optional Jev/sidecar execution remains Worker 2-owned. Native operation does not depend on it.
4. Umbrella cards #6, #11 and #39 contain broader optional/other-owner work beyond the native Brain loop and should not be closed solely from this branch.

## Direct owner-contract integration follow-up

The native Brain now consumes the published owner contracts without copying owner stores into Core:

- **Lore:** when a Worker 4 `LoreBrainRetrievalInterface v1` is attached, the Brain registers `OWNER_LORE` and does **not** register the fallback `NATIVE_LORE` channel. The channel queries `brainInterface().query()` only when Cognitive Choice actually runs retrieval, validates exact authored drillback plus `sourceRevisionFence[]`, carries the owner source revision into Candidate Bus / Truth / Gather / Seal, and leaves the owner revision outside Core's `SourceRegistry`.
- **Memory:** when a `MemoryIntegrationSurface v1.x` is attached, the Brain registers `OWNER_MEMORY` and does **not** register fallback `NATIVE_MEMORY`. Historian nominations require exact `drillDown()` evidence, preserve Memory authority/temporal status and perspective, and flow through the normal Candidate Bus / Truth / Gather / Seal path. Core does not self-admit Memory nominations.
- **Trusted external revision fences:** only registered owner channels marked as owner-revision sources can extend the current source-revision fence. Result Bus revalidates those refs through Core before foreground use. A later owner query can replace the fence; a corrective pass that does not execute an owner channel does not erase the primary-pass owner fence.
- **Quiet-turn bound:** owner Lore/Memory queries are no longer performed before Cognitive Choice. A `HOT_SUFFICIENT` turn leaves both owner channels uncalled and records `SKIPPED / HOT_SUFFICIENT`.
- **Post-generation Memory write-back:** after a completed narrative, Core can send exact observed narrative evidence through Memory's `admitExternalEvidenceMapping` contract. Corrections reuse the same external evidence identity with a higher Core artifact revision and a new source revision. This mapping grants no Settlement or Context Seal authority; Scene/Memory remain responsible for episode/hierarchy interpretation.
- **Fallback invariant:** with no owner interface attached, the local `NATIVE_LORE` / `NATIVE_MEMORY` deterministic fallback remains available so one local Brain resource still works without an external service. When the real owner is attached, the owner channel replaces the corresponding fallback retrieval channel to avoid parallel owner-store retrieval.

Current owner references consumed during this follow-up:

- Memory: `Development-Memory@51aa0d6e7293ddeaa3899e81f6699794d0c22b2c` — `MemoryIntegrationSurface v1.0.0`.
- Lore: `Development-Lorebook-Editor@0adfdf9ae7221905baab2ea9c8f36f3c47b84c37` — `LoreBrainRetrievalInterface v1` plus Wave 6 `LoreSourceRevisionRetrievalInvalidationContract v1`.
- Optional Jev: `Development-Sidecar/Jev@fa7138271e451a4fb4891bcb1c064e71d1a768bb` — still optional and not a native-path dependency.
- UI host reference was re-verified during this pass at `main@4ea027c805bf5495429aa8b5a4fcf98c5520fac6`; Worker 3's Wave 12 host allowlist includes the native Brain read surface plus current Memory/Lore/resource readers. `main` remains Worker 3-owned and was not merged or overwritten here.

### Worker 3 contract

Instantiate/restore one `Area52NativeBrain` for the active Brain resource, pass real chat/turn/generation/correlation identity, route Scene owner updates into `observeScene()`, call `prepareTurn()` (or `runTurn()`) before the actual model request, send `prepared.rendered` to the real generation, then call `completeTurn()` with the returned assistant narrative. Bind the UI through `brain.uiBindings()`; the surface now includes selection, Scene, Hot Cognition, Cognitive Choice, a selected-turn `readScatter` execution receipt, Sensory/Candidate Bus, Truth, Jev/Precision receipts when present, Gather with returned-result rows, Context Seal, Lore status, Memory status, Runtime status, PromptPlan, context receipt, generation list/read, and subscriptions. Worker 3's current `main` already accepts `readScatter` / `readGather` in the owner-binding allowlist. Missing owner data remains unavailable/degraded rather than being inferred by UI.

### Worker 4 contract

Attach `loreService.brainInterface()` with `brain.attachLoreInterface(...)`. Keep exact authored source revisions and drillback current; derived summaries/ontology remain navigation/ranking material and never gain `SOURCE_CANON`, Settlement, Candidate Bus admission, or Context Seal authority. When an authored source changes, publish Worker 4's `LoreSourceRevisionChanged` event (`sourceId`, `lorebookId`, `uid`, `previousSourceRevisionId`, `sourceRevisionId`, `contentHash`) and route it to `brain.acceptLoreRevisionChange(event)` before the next generation. The Brain invalidates the old revision from current owner evidence and any dependent Hot Cognition state, but deliberately does **not** trust the replacement revision until a fresh owner retrieval returns exact drillback fenced by that revision. Historical authored revisions remain owner-side audit/history.

### Remaining assembly deficiency

This branch can prove the native subsystem and owner-consumer contracts, but it cannot truthfully claim the **live SillyTavern generation loop** is complete until Worker 3's current `main` host path instantiates this Brain and the assembled build proves: real user Send -> Brain prepare/seal -> real model generation -> Brain completion/write-back. The exact published Memory Wave 4 and Lore Wave 6 owner implementations are now exercised together by `scripts/native-brain-owner-integration.mjs` in Cognitive Core CI. A real assembled SillyTavern session is still required for the live host gate; deterministic cross-owner CI is not a substitute for that live acceptance.


## 2026-09-25 native completion audit

This pass started by re-verifying the requested baseline and live branches before editing:

- requested/last-observed `Development-Nexus`: `ba4619f56db8e4f94873256dc26589e1680b7d29`;
- actual live `Development-Nexus` at takeover: `9049e75a46c7b5d2f2103eff124067a49593c770`, **62 commits ahead / 0 behind** that observed baseline;
- `main` at takeover: `4ea027c805bf5495429aa8b5a4fcf98c5520fac6`;
- no new branch was created and no `main`, UI, Lore, Memory, or Jev owner file was overwritten.

The takeover head's exact CI run `36092447684` failed only in the newly changed native Brain path: 11 native tests all raised `ReferenceError: memorySettlementReceipts is not defined`. The pre-existing non-Brain regressions in that run remained green. The completion pass repaired that regression and added direct owner-contract coverage rather than hiding it in the report.

### Native owner integration added

- Completed-turn Core Settlements are now mirrored into an attached Memory owner **after** exact narrative evidence mapping. Memory receives the original Core proposal/decision plus explicit evidence-artifact descriptors; Memory still cannot create Settlement authority.
- Corrections invalidate the prior Memory mapping, admit the corrected exact source revision, and mirror the corrected Core Settlement. This preserves Memory history while moving the current projection.
- Worker 4 Wave 6 source-edit invalidation is now a first-class Brain input through `acceptLoreRevisionChange(event)`. Old Lore revision fences are removed immediately; the replacement revision is not trusted until exact owner retrieval proves it.
- Failed attached Lore or Memory retrieval degrades the affected channel and clears unproven owner revision fences without preventing the native sealed generation path.
- `scripts/native-brain-owner-integration.mjs` checks out and imports the exact accepted Memory Wave 4 and Lore Wave 6 owner implementations in CI. It runs a sealed `runTurn(...,{generate})` callback, proves owner Lore reached the generation payload, writes the resulting narrative into real Memory, mirrors a real Core Settlement, corrects the narrative, and requires the real Memory current projection to move to the corrected state.

### Updated standing-card evidence

| Card | Additional completion evidence from this pass |
| --- | --- |
| #27 Hot Cognition Runtime | Worker 4 source edits now invalidate only Hot segments that actually depend on the replaced Lore revision; unrelated Hot state is not blanket-cleared. |
| #6 Hybrid Sensory Net / Candidate Bus | Real Lore Wave 6 and Memory Wave 4 owner implementations are exercised through the same native Candidate Bus/Truth/Gather/Seal path in exact-head CI; optional owner failure remains degraded rather than fatal. |
| #5 Temporal State Graph | Core Settlement now crosses the real Memory evidence bridge after exact evidence mapping; correction moves Memory's current projection while retaining the superseded source/history. |
| #11 Cognitive Runtime Fabric | Native generation remains self-contained when owner retrieval fails; owner contracts are synchronous foreground inputs while optional Jev/sidecar execution remains non-required. |
| #39 Learning Feedback Loop | Exact narrative experience and corrected experience are durably written to the real Memory owner; canonical state still changes only through Core Settlement. Retrieval feedback remains non-canonical rank bias. |
| #133 Adaptive Context Runtime | The real-owner integration test sends the sealed rendered PromptPlan into the generation callback before any post-turn learning and verifies the same Context Seal identity at the callback boundary. |

### Live versus deterministic labels

- **DETERMINISTIC:** repository regression/focused suites and the pinned real-owner Memory/Lore integration job.
- **HOST-CONTRACT:** `runTurn` generation callback receives sealed rendered context and the returned narrative is learned afterward.
- **LIVE:** still not claimed. Worker 3 must wire the current `main` SillyTavern host to this Brain and execute a real user-send -> prepare/seal -> model request -> response -> completion/write-back loop.

The Brain should therefore be described as **native subsystem ready for live host assembly**, not 100% complete, until that real host loop passes.
