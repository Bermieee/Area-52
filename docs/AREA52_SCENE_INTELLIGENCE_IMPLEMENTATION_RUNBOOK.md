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
