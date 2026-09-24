# FT002 Scene-Side Preflight

This document defines the Worker 3 preflight boundary. It does **not** claim FT002 PASS; only assembled `main` can pass FT002.

## Legal Scene-side chain

```text
NarrativeEvidence
  -> CurrentScene / SceneDelta
  -> SceneIntegrationSignal
  -> normalized Scene event
  -> Fan-Out-compatible Scene input
```

The preflight does not execute Runtime scheduling, workers, Gather, Context Seal or PromptPlan.

## Deterministic scenarios

The Wave 3 preflight covers:

- stable same-Scene dialogue with no unnecessary cut;
- real location transition;
- doorway/no-cut;
- explicit cast entrance;
- MENTIONED_ONLY participant kept out of active Fan-Out cast;
- explicit narrative time shift;
- flashback;
- parallel Scene;
- interruption/resume with same conceptual Scene ID;
- targeted correction using independent source evidence;
- regenerate;
- swipe selection;
- delete/invalidation;
- inherited Ember Tavern / Sun Blade truth boundary.

## Inherited FT001 invariant

The preflight explicitly preserves:

- Ember Tavern CURRENT = destroyed;
- Sun Blade HISTORICAL = Tavern;
- Sun Blade CURRENT = unknown;
- destroyed-vs-removed fate conflict = unresolved.

A historical Scene retrieval result is evidence only and cannot convert the historical Tavern association into the current Blade location.

## Success wording

If the exact Wave 3 gate is green, Worker 3 may report:

```text
SCENE INTEGRATION PREFLIGHT GREEN
READY FOR FT002 MAIN ASSEMBLY
```

It must not report FT002 PASS.
