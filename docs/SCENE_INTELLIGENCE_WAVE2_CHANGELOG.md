# Scene Intelligence Wave 2 Changelog

**Branch:** `Development-Scene-Scanner`  
**Starting checkpoint:** `61fcba381ccac19d5784a51500bcefe22be8bf33`

## Added

### Scene lifecycle topology
- bounded `SceneStack` with CONTINUES / PRECEDES / PARALLEL_TO / FLASHBACK_OF / INTERRUPTS / RESUMES;
- explicit suspend/resume semantics;
- impossible/unknown resume rejection;
- serializable stack state and bounded closed-frame retention.

### SceneEpisode derivation
- deterministic/idempotent SceneEpisode compiler;
- source-range/source-revision/provenance retention;
- OBSERVED / INFERRED / UNRESOLVED field-summary preservation;
- derived state transition history;
- Scene-local object transition proposals;
- atmosphere trajectory;
- reference-first artifact descriptor with revision/slice/digest/provenance;
- stale Episode freshness check.

### Clapperboard lifecycle
- confirmed-boundary lifecycle coordinator;
- linear close -> Episode -> graph -> open;
- flashback/parallel/interruption suspend semantics;
- same-ID resume;
- transition dedupe by confirmed-boundary identity;
- stale revision fence;
- EPISODE_PENDING partial recovery.

### Scene Graph
- Scene narrative relationship edges;
- entity/event/object/thread membership edges;
- evidence/provenance on edges;
- adjacency explicitly separated from causality;
- serializable graph state.

### Scene retrieval
- bounded SceneEpisode reference candidates;
- semantic/entity/location/thread/adjacency/recency score signals;
- source-range/source-revision drill-down metadata;
- historical relation preservation;
- stale source-revision fencing;
- HIGH/MIXED/LOW retrieval-quality output.

### Prefetch
- revision-fenced speculative recommendations;
- entity/location/thread/Scene references;
- expiry, supersession cancellation and bounded pending set;
- recommendations on transitions and meaningful live Scene deltas;
- no direct Sidecar invocation.

### Scene event producer
- immutable versioned Scene event envelopes;
- Runtime Event Spine-compatible metadata projection;
- event type registration descriptors;
- scene/source revision fences;
- dedupe identity;
- correlation/causation/turn identity;
- bounded dedupe window.

### Narrative Feed Adapter
- USER_SEND;
- ASSISTANT_GENERATION_COMPLETE;
- REGENERATE;
- SWIPE_SELECTED;
- EDIT;
- DELETE;
- CONTINUE;
- CHAT_LOAD;
- CHAT_SWITCH;
- NEW_CHAT;
- IMPORT_OR_RELOAD;
- LORE_CHANGE;
- stable chat/message/revision/source/turn/correlation/causation identity;
- abandoned regenerate/swipe invalidation;
- deletion invalidation;
- duplicate host-event idempotence;
- chat isolation;
- serializable restart state.

### Scene-side live intake
- host activity -> revisioned NarrativeEvidence -> real CurrentScene/SceneDelta;
- Scene-specific normalized event publication;
- source invalidation propagated into dependent Scene fields/Episodes;
- automatic chat Scene namespace;
- lifecycle signal artifact for later Runtime/Fan-Out integration.

### Recovery
- serializable Scene Registry / Stack / Episodes / Graph / host feed / Prefetch / transition state;
- interrupt -> reload -> temporary close -> original Scene resume proof;
- stale event and late Episode result fencing.

## Validation expansion

Wave 1 deterministic and stress acceptance remains mandatory.

Wave 2 adds:
- lifecycle/stack tests;
- Episode tests;
- transition/idempotence/partial-recovery tests;
- graph/provenance/non-causality tests;
- retrieval/stale-source tests;
- prefetch expiry/cancellation tests;
- immutable event/dedupe/Event Spine compatibility tests;
- SillyTavern-shaped regenerate/swipe/edit/delete/continue/chat-switch/reload tests;
- restart/reconstruction tests;
- browser runtime execution with `globalThis.Buffer = undefined`;
- labeled golden-world metrics;
- 5,000-event scale/recovery stress.

## Explicitly not added

- no Scene Studio or Phase 2 UI;
- no Runtime scheduler/Event Spine implementation;
- no Sidecar/provider scheduler;
- no Settlement/world-truth authority;
- no Memory canonical-store mutation;
- no live FT002/main integration.
