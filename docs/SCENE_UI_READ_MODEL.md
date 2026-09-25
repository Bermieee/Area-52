# Scene UI Read Model

`SceneUiReadModel` is a compact immutable observation contract for UI.Core. It is infrastructure for Phase 1; it is not Phase 2 Scene Studio UI.

## Contents

The model exposes:

- Scene ID and revision;
- lifecycle;
- source revision refs;
- location;
- narrative time;
- active cast;
- active threads;
- objects;
- inferred atmosphere;
- boundary state;
- relationship to prior Scene;
- latest SceneEpisode reference;
- latest delta summary;
- uncertain fields;
- prefetch state;
- health;
- provenance refs;
- diagnostic/Why refs.

UI receives values, not Scene internal Maps or mutable registry records.

## Revision fencing

Every read model names the Scene revision it describes.

`isSceneUiReadModelFresh(model,{sceneId,revision})` allows an adapter to reject an r7 snapshot after r8 becomes current.

## Health

Backend health states are:

- READY
- WORKING
- DEGRADED
- STALE
- REBUILD_REQUIRED
- ERROR

The projection also exposes a UI.Core-compatible product-health value. Unresolved fields degrade the snapshot; source-edit invalidation requires rebuild; missing provenance/evidence degrades health.

## Epistemology

- MENTIONED_ONLY remains MENTIONED_ONLY.
- uncertain objects remain uncertain.
- atmosphere is labeled inferred/contextual and `canonical:false`.
- historical Scene retrieval is not current world truth.

## Authority

The model is `READ_ONLY`. Mutating the returned object cannot mutate Scene state; the object is deeply frozen and carries no Settlement/Context-Seal/mutation authority.
