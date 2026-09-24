# FT002 Core Preflight

Status after Worker 1 Wave 10: **CORE NATIVE-SCENE INTEGRATION READY / LIVE MAIN PENDING**.

Wave 10 supersedes the former fixture-only Core Scene preflight. The dedicated FT002 Core acceptance now consumes artifacts emitted by the accepted Scene Intelligence Wave 3 runtime itself from the exact read-only checkpoint `3aaf1c1e9e7e8703dc8c66c5542efb03cc9873cf`.

Native acceptance path:

```text
NarrativeEvidence
  -> SceneLifecycleRuntime
  -> SceneIntegrationSignal / normalized Scene events / SceneContextInvalidationSignal
  -> SceneCoreIntegrationBridge
  -> Hot Cognition
  -> Cognitive Choice
  -> Sensory / Truth / Precision / Jev seam
  -> Result Bus / Gather
  -> Context Seal
  -> Adaptive Context Runtime
  -> PromptPlan
```

Core does not import or duplicate Scene implementation. CI checks out the accepted Scene checkpoint under a nested read-only integration path and runs Scene's own public runtime/publishers.

Checks include:

- per-Scene identity + revision fencing;
- source revision/correlation/causation provenance retention;
- active cast contains PRESENT participants only;
- MENTIONED_ONLY observations remain observable but never active anchors;
- stable same-Scene dialogue can remain Hot-only;
- confirmed transition makes retrieval/cognition eligible;
- doorway boundary candidate causes no false close/open reset;
- cast entrance/exit changes active anchors without stale activation;
- explicit time shift survives generation-facing publication;
- FLASHBACK_OF, PARALLEL_TO and RESUMES relations remain distinguishable;
- corrected newer inference fences the old revision;
- SceneContextInvalidationSignal invalidates working context, never evidence;
- stale/late Scene artifacts cannot alter an already sealed generation;
- Scene ID/revision/provenance survive Gather, Context Seal and PromptPlan diagnostics;
- targeted PromptPlan reuse preserves stable non-Scene segments where the existing Adaptive Context policy permits it;
- FT001 Ember Tavern truth/history/unresolved invariants remain intact.

The Ember Tavern inherited invariants remain:

- Ember Tavern CURRENT state = destroyed;
- Sun Blade historical location = Ember Tavern;
- Sun Blade current location = unknown;
- conflicting Blade-fate evidence remains unresolved.

This is **not live FT002 PASS**. #177 remains open until assembled `main` runs the live SillyTavern -> Scene -> Runtime/Sidecar -> Gather -> Seal -> PromptPlan path.
