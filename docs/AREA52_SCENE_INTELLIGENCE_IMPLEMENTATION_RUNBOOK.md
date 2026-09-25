# Area-52 Scene Intelligence Implementation Runbook

## Wave 1 scope

Primary cards: #98, #99, #100, #101, #102, #104, #105, #106, #107, #114, #117.  
Materially advanced: #115 and the Scene-local portion of #184.

## Implementation order

1. contracts and field epistemology;
2. CurrentScene schema;
3. delta engine and stale-proposal guard;
4. cast/spatial/temporal/object/atmosphere trackers;
5. boundary detector;
6. boundary verification;
7. scene registry and revision history;
8. reconciliation/last-known-good;
9. deterministic golden fixtures;
10. stress/browser checks;
11. documentation and issue reconciliation.

## Golden fixtures required in Wave 1

- stable same-scene dialogue;
- true location transition;
- doorway/no-cut;
- cast entrance;
- cast exit;
- mentioned-but-not-present character;
- explicit time jump;
- false temporal jump;
- atmosphere change;
- source edit/correction;
- pickup/drop object;
- object mentioned only;
- false boundary recovery.

Later #115 expansion still needs flashback/parallel full Scene Stack semantics, resumed interrupted SceneEpisode retrieval and closed-episode retrieval quality.

## Metrics supported by Wave 1 fixtures

The harness can count/derive:

- boundary decision correctness for the included deterministic cases;
- false-cut regression result;
- state-delta correctness for targeted fields;
- active-cast precision for mention/entrance/exit cases;
- temporal correction/anti-cascade behavior;
- object-presence correctness;
- provenance/evidence reference presence;
- targeted recovery correctness.

Do not publish aggregate precision/recall percentages beyond what the fixture corpus actually measures.

## Validation commands

    npm test
    npm run test:scene
    npm run test:scene:stress
    npm run check
    npm run check:browser
    node -e "import('./src/scene/index.js').then(()=>console.log('Scene module import PASS'))"

## Stress target

The Wave 1 stress script processes 1,200 narrative updates and must produce at least 500 applied deltas. It asserts:

- monotonic revision ordering;
- stable scene ID;
- mention-only cast does not become presence;
- mention-only objects do not become possession;
- source edit invalidates only the target field;
- active CurrentScene remains bounded enough for live use;
- a retention policy can bound a record copy to 64 snapshots / 128 deltas.

This is not #183 final qualification.

## Browser compatibility

tests/scene-browser-compat.mjs rejects Node-only production patterns in src/scene including Buffer, node: imports, process, require, fs and path imports.

## FT002 readiness seam

Wave 1 ends at real, revisioned scene data. Later FT002 should adapt:

SillyTavern narrative -> Scene observation proposal -> CurrentScene/deltas -> scene events -> Fan-Out -> Runtime -> Result Bus -> Gather -> Seal -> PromptPlan.

Wave 1 does not claim FT002 PASS.

## Issue closure discipline

Strong closure candidates when exact-SHA CI is green: #98, #99, #100, #101, #102, #104, #105, #106, #114, #117.

#107 should remain open unless its shared Sidecar/provider acceptance is actually complete.

#115, #184, #49 and #93 remain open after Wave 1 because only the Scene-side contracts are advanced.

Do not close epic #97 while later Scene children remain deferred.

## Deferred Wave 2+

- #103 SceneEpisode Compiler;
- #108 parallel/flashback/resume Scene Stack;
- #109 transition manager;
- #110 Scene Graph;
- #111 retrieval adapter;
- #112 prefetch trigger;
- #113 Event Spine publisher;
- #177 live FT002 integration;
- #182 SillyTavern live feed adapter;
- #183 full long-run qualification;
- #173 Phase 2 Scene Studio/authoring utilities.

# Wave 2 Implementation / Validation

## Implementation sequence

1. non-linear Scene Stack;
2. deterministic SceneEpisode compilation;
3. Scene Graph;
4. bounded Scene retrieval;
5. speculative prefetch contract;
6. immutable Scene event producer;
7. SillyTavern-shaped Narrative Feed Adapter;
8. Clapperboard lifecycle manager;
9. serializable restart/reconstruction;
10. Scene-side live-intake composition;
11. Wave 2 golden worlds and metrics;
12. long-run scale/recovery qualification;
13. browser-style runtime execution;
14. exact-SHA GitHub Actions.

## Required Wave 2 negative proofs

- duplicate boundary confirmation -> one transition;
- stale Scene revision -> STALE/no mutation;
- late historical Episode -> not CurrentScene;
- A PRECEDES B -> not causality;
- parallel -> not forced PRECEDES;
- flashback -> no current-world-time advance;
- unknown Scene -> cannot resume;
- abandoned regenerate/swipe -> not CURRENT;
- delete -> dependent Scene state invalidated;
- duplicate host event -> one evidence revision;
- stale source Episode -> rejected from active retrieval;
- expired/superseded prefetch -> not active.

## Browser runtime

In addition to source scanning, tests execute the production Scene lifecycle/host path with globalThis.Buffer unavailable. Node-specific test tooling is not treated as production incompatibility.

## Stress target

Wave 2 qualifies at least:

- 5,000 host events;
- 2,500 Scene deltas;
- 500 boundary candidates;
- 100 transitions;
- 100 SceneEpisodes;
- 1,000 retrieval queries;
- source-edit invalidation of closed Scenes;
- event dedupe;
- restart reconstruction;
- explicit stack/prefetch/dedupe bounds.

Actual values are captured in the exact CI log and Wave 2 acceptance document.

## Closure discipline

#108 and #111 are Scene-owned close candidates once exact-SHA CI is green. #115 may close only when the full deterministic scenario set and truthful metrics are green.

#103 may close only if its own SceneEpisode acceptance is fully met without assuming Memory integration.

#107/#109/#110/#112/#113/#182/#183/#184/#49/#93/#177 remain open when their shared/live acceptance is not yet proven.

#173 is Phase 2 and is not implemented.

# Wave 3 Integration Runbook

## Implementation order

1. revalidate Wave 2 exact checkpoint;
2. refresh Core/Coprocessor/Runtime/Memory/UI contracts read-only;
3. add authority-negative integration contracts;
4. project live Scene into SceneIntegrationSignal;
5. align Event Publisher to shared registries/Event Spine;
6. align PrefetchRecommendation to Coprocessor Warmer;
7. publish Context invalidation intent from Clapperboard;
8. expose graph/Episode reference-only Memory proposal seam;
9. add explicit object transition proposals;
10. expose atmosphere without feedback/canonical promotion;
11. add configurable SillyTavern host bridge and reattach semantics;
12. expose SceneUiReadModel;
13. add Why/diagnostic references;
14. add Scene lane assembly manifest contribution;
15. run FT002 Scene-side preflight;
16. run 10k-event integration stress and browser execution;
17. refresh all lane heads and issue state;
18. squash Wave 3 onto accepted Wave 2 checkpoint;
19. exact-final-SHA CI.

## Permanent negative proofs

- MENTIONED_ONLY cast/object does not become active Fan-Out input.
- SceneIntegrationSignal cannot claim SOURCE_CANON/SETTLED authority.
- ObjectStateTransitionProposal cannot settle itself.
- Scene events cannot request Context Seal bypass.
- UI model mutation cannot change Scene.
- historical retrieval remains historical.
- old event/Episode/Prefetch/UI/Memory proposal is detectable as stale.
- context invalidation is idempotent and does not delete evidence.
- cross-chat ISOLATED state is not a narrative Scene Graph edge.

## Closure discipline

#109/#112/#113 close only if their own shared public-contract acceptance is satisfied.

#107/#110/#177/#182/#183/#184/#49/#93/#185/#186/#157/#97 remain open while their other-lane/live acceptance is outstanding.

#173 Phase 2 remains untouched.
