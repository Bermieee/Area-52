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
