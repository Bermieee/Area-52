# Scene Intelligence Wave 2 Acceptance

**Branch:** `Development-Scene-Scanner`  
**Accepted starting checkpoint:** `61fcba381ccac19d5784a51500bcefe22be8bf33`  
**Scope:** Phase 1 Scene lifecycle, Episodes, graph, retrieval, event production, host normalization and Scene-side FT002 readiness.

## Acceptance posture

Wave 1 acceptance remains mandatory and is re-run by the Wave 1+2 CI gate.

Wave 2 proves the Scene-owned backend contract. It does not claim live FT002, live SillyTavern integration, Runtime execution, Sidecar execution, Memory settlement or Phase 2 UI.

## Deterministic coverage

The reconciled Wave 2 candidate run executes 86 deterministic/golden/browser-runtime tests with zero failures.

Covered Wave 2 behavior includes:

- Scene Stack non-linear relationships;
- flashback suspension and same-ID resume;
- parallel Scene topology;
- interruption/resume;
- impossible/unknown resume rejection;
- SceneEpisode derivation/provenance/idempotence;
- source-revision Episode revisioning;
- stale/late Episode freshness rejection;
- Clapperboard transition idempotence;
- stale transition rejection;
- EPISODE_PENDING partial recovery;
- graph membership/provenance;
- adjacency != causality;
- bounded reference-first Scene retrieval;
- historical Episode != CurrentScene;
- stale retrieval rejection;
- Prefetch expiry/cancellation;
- immutable/deduplicated Scene events;
- Runtime EventTypeRegistry/EventSpine-compatible descriptors/meta;
- host edit/regenerate/swipe/delete/continue/chat-switch/reload semantics;
- duplicate host-event idempotence;
- chat namespace isolation;
- host evidence -> real CurrentScene revision;
- abandoned-evidence Scene invalidation;
- interrupt -> JSON reload -> temporary close -> same-ID resume;
- browser-style execution with `globalThis.Buffer = undefined`.

## Golden metrics

The labeled golden boundary set produced:

- TP: 5
- FP: 0
- FN: 0
- TN: 2
- boundary precision: 1.0
- boundary recall: 1.0
- false-cut rate: 0

The golden SceneEpisode contract check retained 18 / 18 required fields while preserving OBSERVED / INFERRED / UNRESOLVED distinctions:

- SceneEpisode fidelity: 1.0

The labeled two-query retrieval golden set ranked the expected SceneEpisode first in both cases:

- precision@1: 1.0

These values describe the deterministic fixture corpus only. They are not presented as universal model-quality estimates.

## Wave 2 scale / recovery run

A green GitHub Actions reference execution measured:

- host events: 5,000 accepted
- duplicate host replay probe: 25 duplicates contained
- Scene deltas: 2,600
- boundary candidates: 520
  - TP 120
  - FP 0
  - FN 0
  - TN 400
- boundary precision: 1.0
- boundary recall: 1.0
- false-cut rate: 0
- Scene transitions: 130
- non-stale SceneEpisodes after closed-scene source edits: 110
- Scene events: 652
- duplicate-event replay suppression: 99 / 100 duplicate attempts suppressed
- retrieval queries: 1,000
- non-empty retrievals: 1,000
- retrieval precision@1: 1.0
- closed Scenes source-edited: 20
- maximum rebuild scope: 1 field
- stale Scene event containment: PASS
- provenance completeness: 1.0

Reference CI-run timing on GitHub hosted infrastructure:

- 2,600 delta applications: ~1.043 s / ~2,493 deltas per second
- 1,000 retrieval queries: ~3.271 s / ~3.271 ms average
- 20 closed-scene targeted edits: ~26.6 ms

Performance numbers are environment-dependent; correctness counts and boundedness invariants are the acceptance criteria.

## Boundedness

Measured active/live bounds:

- active CurrentScene: 1,509 bytes at end of stress
- maximum active CurrentScene during stress: 2,692 bytes
- serialized lifecycle/history test state: 11,772,064 bytes for the complete 130-transition / 2,600-delta retained test history
- Scene Stack frames: 65 maximum retained in the final stress state
- resumable/live frames: 1
- Prefetch pending limit reached but bounded at: 32
- Event dedupe window: bounded by publisher configuration
- host-event dedupe window: bounded by adapter configuration

Large retained historical state is deliberately separable from the small active Scene object and is exposed for the persistence owner; Wave 2 does not silently delete evidence history to reduce the test-state size.

## Object continuity

Wave 2 carries Scene-local object transitions into SceneEpisode and graph/event contracts.

The durable proposal remains non-authoritative. Temporal / Memory / Settlement still owns durable object truth.

#184 therefore remains open.

## Atmosphere

Atmosphere remains INFERRED, SCENE-SCOPED and NON-CANONICAL.

Wave 2 adds Episode atmosphere trajectory and VIBE_CHANGED publication/retrieval metadata compatibility. No self-reinforcing atmosphere authority is introduced.

#107 remains shared/open.

## Narrative host boundary

The host-normalization contract proves:

- edits append revisions;
- regeneration invalidates abandoned output;
- selected swipe is the only current alternate;
- delete invalidates dependent Scene fields;
- CONTINUE stays in the correct chat/message lineage;
- chat switch isolates Scene namespaces;
- duplicate delivery does not duplicate evidence;
- restart reconstruction is serializable.

This is SillyTavern-shaped contract acceptance, not a live SillyTavern qualification. #182 remains open.

## FT002

Scene-side readiness is established:

host-normalized evidence -> CurrentScene/SceneDelta -> normalized Scene events -> lifecycle/episode refs -> retrieval quality/prefetch/Fan-Out-ready signals.

The Scene lane reports:

**SCENE SIDE READY**

It does not report FT002 PASS.

#177 remains open until assembled Runtime + Sidecar + Result Bus/Gather + Context Seal + PromptPlan + live SillyTavern qualification.

## Closure recommendation

Scene-owned acceptance is complete for:

- #108 Scene Stack
- #111 Scene Retrieval Adapter
- #115 Scene golden-world harness

The SceneEpisode Compiler requirements in #103 are also complete as a derived, idempotent, provenance-backed Scene artifact contract; Memory participation remains downstream and does not grant the compiler canonical-store authority.

Shared/live cards remain open:

- #107
- #109
- #110
- #112
- #113
- #177
- #182
- #183
- #184
- #49
- #93
- #97 epic

## Phase 2

#173 and all Scene Studio/authoring UI work were explicitly not started.


## Cross-lane contract reconciliation

Final read-only refresh found:

- Cognitive Core / Framework: `Development-Nexus@1e6e88dbeeb929b48310a6b2e1f72b4e88a3dac2`;
- Cognitive Coprocessor / Data Plane: `Development-Sidecar/Jev@4b0a0382856a5306f716b1b0ec3f9d931322b0d0`;
- Runtime Fabric: `Development-Worker-Director@890f8576bcfcc4c056b959271027242dc6af7d7c`;
- UI.Core: `Development-UI@14259dbd25601d2984846edd2d75b5ef4ec6a6d2`;
- main remains `daad62cc62c27acd12f7d77bf1fec5bdfc06ca45`.

Worker 2 introduced the shared Cognitive Data Plane / ArtifactReference 1.0 contract while this wave was active. SceneEpisode references were reconciled to that vocabulary without merging branches: owner, storage domain, exact revision, sourceRevisionSet, sceneRevision fence, contentHash, optional slice/expiry fields, and explicit no-authority flags.

Scene event envelopes likewise expose Runtime-compatible revision fences/dedupe metadata plus CognitiveEventEnvelope-style sourceRevisionSet/eventVersion/payloadSchemaVersion fields.

No conflicting Core Scene authority contract was introduced by the refreshed Core changes.

Host chat switching is represented internally as `ISOLATED` stack presentation rather than PARALLEL_TO, preventing different SillyTavern chats from acquiring a false narrative relationship.
