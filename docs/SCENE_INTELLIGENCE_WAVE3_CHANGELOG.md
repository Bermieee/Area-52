# Scene Intelligence Wave 3 Changelog

## Integration contracts

Added:

- `src/scene/integration-contracts.js`
- `src/scene/context-invalidation.js`
- `src/scene/scene-memory-handoff.js`
- `src/scene/scene-ui-read-model.js`
- `src/scene/host-bridge.js`
- `src/scene/scene-integration-view.js`
- `src/scene/scene-assembly-manifest.js`

## Event integration

`SceneEventPublisher` now:

- exposes Runtime registry descriptors;
- exposes Core registry descriptors;
- adapts to Runtime Event Spine;
- validates event/payload major compatibility;
- rejects authority / Settlement / Context-Seal bypass;
- deep-freezes the event before downstream publication;
- preserves source/Scene revision fences and dedupe identity.

## Scene public signal

`SceneLifecycleRuntime` now exposes:

- `integrationSignal(chatId)`;
- `fanOutInput(chatId)`;
- `uiReadModel(chatId)`.

The signal is projected from live Scene state rather than maintained as a second truth store.

Mentioned-only cast/object observations are retained for inspection while excluded from active downstream Fan-Out inputs.

## Context invalidation

Confirmed transitions/resumes publish idempotent `SceneContextInvalidationSignal` intents.

Resume invalidation keeps the same conceptual Scene ID and records old/new resumed revisions.

Context invalidation never deletes evidence and has no direct Core mutation authority.

## Memory handoff

Added:

- `SceneGraphReferenceSet`;
- `SceneExperienceProposal`;
- freshness checks.

The handoff references Episode/Graph artifacts rather than copying graph state or writing Memory directly.

## Object continuity

Expanded object-state vocabulary with HIDDEN and proposal-only transitions for:

- pickup;
- drop;
- transfer;
- damage;
- destruction;
- removal;
- hidden;
- uncertain.

Mention-only remains non-possession.

## Atmosphere

Added an explicit next-Scene boundary method and regression coverage proving prior inferred atmosphere does not seed a neutral next Scene.

## Host integration

Added configurable `SillyTavernHostBridge` with:

- explicit capability reporting;
- host-event -> HostActivity normalization;
- source-revision-idempotent reattachment;
- duplicate active chat-state suppression.

No SillyTavern event-name assumptions are hard-coded into canonical Scene logic.

## UI / diagnostics

Added immutable `SceneUiReadModel` with:

- Scene revision fencing;
- epistemic distinctions;
- UI.Core product/general health mappings;
- provenance;
- diagnostic references.

Boundary verifier now retains bounded decision history so rejected/confirmed boundaries remain explainable through Why references.

## Retrieval

Optimized retrieval to precompute current-Scene adjacency once per query.

Added exact semantic-match ranking so recency cannot outrank an exact Episode match in repeated-cast near-duplicate scenes.

## Assembly

Added `SceneAssemblyLaneManifest` listing production/test/docs/browser-visible paths, downstream adapter expectations, shared-contract dependencies and integration-only patch expectations.

## Validation

Added:

- `tests/scene-wave3.mjs`;
- `tests/scene-wave3-preflight.mjs`;
- `tests/scene-wave3-browser-runtime.mjs`;
- `tests/scene-wave3-stress.mjs`.

The Scene workflow now runs Wave 1+2+3 validation and serializes branch stress qualification with cancel-in-progress concurrency.
