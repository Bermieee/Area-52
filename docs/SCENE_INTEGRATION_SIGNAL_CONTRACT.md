# Scene Integration Signal Contract

`SceneIntegrationSignal` is the canonical provider-neutral Scene-facing integration artifact for Phase 1.

It is a frozen descriptive snapshot derived from the current Scene state. It is not a second Scene store.

## Identity and freshness

Every signal includes:

- `sceneId`
- `sceneRevision`
- `sourceRevisionRefs` / `sourceRevisionSet`
- provenance references

Consumers must treat a signal for an older Scene revision as stale.

## Current narrative inputs

The signal exposes:

- location
- narrative time
- active cast
- full cast observations
- active threads
- active objects
- full object observations
- uncertain fields / conflict signals
- boundary state
- Scene relationship / transition type
- previous/resumed Scene references
- recent SceneEpisode references
- retrieval quality
- prefetch recommendations
- object transition references
- inferred atmosphere
- health
- diagnostic/Why references

`activeCast` contains only PRESENT participants. `MENTIONED_ONLY` remains visible through `castObservations` but is not admitted to the active Fan-Out input. Likewise a mentioned-only object stays in `objectObservations` but is not promoted to active object context.

## Authority

The signal is always `authority: DESCRIPTIVE`.

It grants no:

- Settlement authority;
- canonical mutation authority;
- Context Seal bypass;
- Runtime scheduling authority.

Attempts to create a SceneIntegrationSignal with SOURCE_CANON/SETTLED/CANONICAL authority or an authority-bypass flag are rejected.

## Consumers

The intended consumers are:

- Coprocessor Dynamic Fan-Out;
- Runtime obligation/event consumers;
- Core/Context diagnostics;
- UI read-model projection.

Consumers should depend on this public contract rather than reaching into Scene Registry Maps, Scene Stack frames or mutable CurrentScene internals.
