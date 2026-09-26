# Core Wave 10 Changelog

## Wave 9 -> Wave 10

Wave 9 established deterministic per-turn Cognitive Choice. Wave 10 replaces the synthetic/fixed Scene fixture boundary in the Core FT002 path with consumption of the accepted native Scene Intelligence public contracts.

Accepted integration reference:

- Scene branch: `Development-Scene-Scanner`
- Scene Wave 3 checkpoint: `3aaf1c1e9e7e8703dc8c66c5542efb03cc9873cf`
- Scene contract version: 1.x public integration surface

No Scene implementation is copied into Core.

## Production implementation

### Added

- `src/scene-core-integration.js`
  - validates `SceneIntegrationSignal`, normalized Scene events and `SceneContextInvalidationSignal`;
  - registers accepted Scene event types in the existing Core `EventTypeRegistry`;
  - preserves Scene identity, per-Scene revision, source revisions, correlation/causation provenance and relationship metadata;
  - fences duplicate, stale, retired-Scene and conflicting same-revision artifacts;
  - translates Scene changes into logical cognition needs without scheduling physical workers;
  - applies targeted Scene working-context invalidation without evidence deletion;
  - emits bounded authority-negative Core integration receipts/diagnostics.

### Modified

- `src/hot-cognition-runtime.js`
  - carries Scene atmosphere;
  - consumes native whole-object-list transition payloads without treating them as canonical state.

- `src/cognitive-core.js`
  - owns the Scene/Core bridge;
  - routes accepted public Scene signals/events/invalidation through that bridge;
  - exposes Scene integration snapshots/diagnostics;
  - preserves non-Scene cognitive-event behavior.

- `src/cognitive-choice-controller.js`
  - accepts real Scene integration context;
  - prevents Hot-only reuse when Scene context is explicitly stale/invalidated;
  - records Scene identity/source/provenance/invalidation revision data in `CognitiveChoiceReceipt`.

- `src/generation-publication.js`
  - Scene revision is now fenced by Scene identity, not a global monotonic number across unrelated Scenes;
  - significant Scene change can add active Scene anchors to retrieval;
  - native Scene trace enters the sealed packet/dependency set;
  - exposes deterministic Gather receipt with Scene revision/provenance;
  - notifies the Scene bridge when the matching Context Seal closes.

- `src/prompt-planner.js`
  - PromptPlan diagnostics carry the Scene ID/revision/provenance/invalidation trace.

- `src/core-ui-read-models.js`
  - Core read models expose Scene identity and Scene integration trace for downstream UI consumption.

- `src/core-assembly-manifest.js`
  - includes the Scene/Core integration bridge.

## Correctness rules

- Scene Intelligence remains descriptive perception.
- Truth Gate remains classification.
- Settlement owners remain the only canonical mutation authority.
- `MENTIONED_ONLY` never becomes an active cognition anchor.
- Scene revisions are scoped to Scene identity. A newly opened Scene may legitimately begin at revision 1 after an older Scene reached a higher revision.
- A confirmed boundary may invalidate Scene working context; a boundary candidate cannot.
- Context invalidation never means narrative evidence deletion.
- Flashback/parallel/resume relationships survive the Core path without becoming current-world truth.
- Late/stale Scene artifacts cannot mutate a sealed generation.
- Logical Scene cognition needs do not schedule physical sidecars.

## Real native Scene acceptance

Dedicated CI checks out the accepted Scene checkpoint into a nested read-only integration reference and executes Scene's own:

- `SceneLifecycleRuntime`;
- `SceneEventPublisher`;
- `SceneContextInvalidationPublisher`;
- `integrationSignal()`.

The produced native artifacts are then consumed by the Wave 10 Core path. No synthetic `CurrentScene` object is used for this acceptance.

Required scenarios cover stable same-Scene dialogue, confirmed location transition, false doorway boundary, cast entrance/exit, mentioned-only exclusion, time shift, flashback, parallel Scene, interrupt/resume, correction, stale/late containment, targeted PromptPlan reuse and inherited Ember Tavern truth/history/unresolved invariants.

## Scope boundaries retained

Not implemented in this lane:

- Scene Registry/extractor/delta/boundary/cast/spatial/temporal/Episode internals;
- Worker Director scheduling/resource pools;
- Jev internals;
- UI rendering;
- live SillyTavern host producer changes;
- assembled `main` FT002 execution.

#177 therefore remains open until assembled-main/live acceptance.
