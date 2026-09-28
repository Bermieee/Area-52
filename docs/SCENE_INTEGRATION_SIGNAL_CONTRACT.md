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


## Asynchronous semantic observation

Semantic Scene extraction is scheduled through Area-52 Runtime/Coprocessor execution and does not create a second Scene queue or store.

The immediate host path registers the narrative source revision and may use the deterministic Scene owner path without waiting for OPPORTUNISTIC semantic work. Semantic work retains its original chat/turn/generation/correlation/causation identity, source revision fence, Scene base revision, and physical provider lineage.

When a semantic result completes after the foreground path has moved on:

1. Runtime publishes the normal result-ready envelope.
2. Core Result Bus revalidates freshness and routes the result to `NEXT_TURN` or `BACKGROUND`.
3. Scene owner revalidates active chat, exact current source revision, exact Scene base revision, bounded proposal schema, and any Jev advisory fence.
4. Only an explicit Scene-owner acceptance may mutate CurrentScene for future turns.

The future/background owner path does not bypass the original-turn sealed check. It is a distinct consideration path after Result Bus forwarding. It cannot reopen Gather, alter sealed packet bytes/hash, delete raw narrative history, grant canonical authority, or relabel the original execution as a newer turn.

Edits/deletes, chat supersession, newer same-lane jobs, explicit operator cancellation, source-revision invalidation, and Scene-revision invalidation make obsolete work cancellable or stale. Provider/network failures remain explicit execution failures.

This behavior applies #90 Gather and #94 foreground quorum semantics while preserving #95 compiler ownership, #213 Scene/Jev separation, and the #177 Scene → Runtime → Result Bus → Gather/Seal architecture.
