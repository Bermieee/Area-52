# Area-52 Scene Intelligence Blueprint

**Owner branch:** Development-Scene-Scanner  
**Epic:** #97  
**Wave:** Phase 1 / Wave 1 — live perception foundation

## Mission

Scene Intelligence is Area-52's live narrative perception layer. It answers **what is happening right now** and **what changed since the previous narrative state** without granting scanner inference canonical world authority.

## Authority invariant

Narrative evidence -> scene observation/inference -> revisioned CurrentScene -> proposals/signals for the appropriate owner / Truth / Settlement.

Scene Intelligence may classify a field as OBSERVED, INFERRED, UNRESOLVED or UNKNOWN. It does not create SETTLED world truth.

Provider confidence never upgrades authority.

## Wave 1 data flow

Narrative evidence -> provider-neutral SceneObservationProposal -> deterministic validation -> SceneDelta -> revisioned CurrentScene -> boundary candidate -> confirmation window -> stable SceneRegistry -> reconciliation/last-known-good.

Field specialists feed the proposal/delta model:

- Active Cast Resolver;
- Spatial State Tracker;
- Temporal State Tracker;
- Object State Tracker;
- Atmosphere Tracker.

## CurrentScene

CurrentScene carries:

- stable sceneId;
- monotonically increasing revision;
- lifecycle (OPEN, CLOSED, SUSPENDED);
- source range and source revision references;
- field states for location, narrative time, active cast, immediate objects, active relationships, active threads, active objectives, atmosphere and boundary state;
- field evidence and unresolved-field index;
- provenance;
- timestamps;
- health/warning presentation data suitable for later UI.Core consumption.

Each meaningful field is a FieldState containing:

- value;
- confidence;
- evidenceRefs[];
- observationClass;
- revision;
- provenance[];
- optional metadata.

Every non-UNKNOWN FieldState requires evidence references. A populated field cannot exist without traceable narrative evidence.

## Delta-first updates

Wave 1 updates CurrentScene through bounded field deltas. Unchanged fields are not rewritten. A proposal must target the current base revision; stale proposals are rejected.

The Delta Engine requests BOUNDED_FULL_REFRESH_REQUIRED behavior by returning fullRefreshRequired=true when drift is unsafe, including impossible transitions, temporal-sequence breakage, accumulated contradictions, excessive uncertain chains, suspicious cast churn or broad source-edit fanout.

A refresh request does not silently apply the suspicious state.

## Scene boundaries

Boundary detection emits a candidate; it does not close a scene. Signals include location transition, major time jump, sleep/wake, explicit break, cast replacement, combat transition, objective resolution, completed travel, flashback, parallel shift and discontinuity.

Verification uses support, contradiction, confirmation windows, debounce and hysteresis. Strong explicit transitions may confirm immediately. Weak doorway signals remain pending/rejectable. False-cut recovery is explicit and evidence-backed.

Flashback/parallel meaning is retained as boundary type for later Scene Stack work; Wave 1 does not implement #108.

## Stable identity and history

SceneRegistry owns stable scene identity and stores revision snapshots/deltas. Source edits append a new revision and invalidate only dependent scene fields. Stable scene IDs do not change merely because one field is corrected.

Scene suspend/resume is representable now for later Scene Stack integration.

## Field specialist rules

### Cast

States: PRESENT, DEPARTED, OFFSCREEN_RELEVANT, UNCERTAIN, MENTIONED_ONLY.

Mention does not equal presence. A later weak mention cannot downgrade a stronger established PRESENT state.

### Spatial

Tracks scene-local location/sub-location, containment/proximity and explicit transitions. Looking at a location does not move the scene there. Durable world location remains external authority.

### Temporal

Tracks explicit anchors, elapsed time, time skips, sleep/wake, flashback, parallel shifts, uncertainty and correction. An inferred time cannot be used as evidence to create a stronger inferred time. Corrections preserve the earlier interpretation through revision/provenance.

### Objects

States: PRESENT, HELD, CARRIED, WORN, CONTAINED, VISIBLE, DEPARTED, REMOVED, DAMAGED, DESTROYED, MENTIONED_ONLY, UNCERTAIN.

Mention does not equal presence or possession. A later mention does not erase stronger held/present state. Scene-local object observations may carry a durable-state proposal, but durable truth belongs to Memory/Temporal/Settlement.

### Atmosphere

Dimensions include tension, danger, intimacy, urgency, uncertainty, humor, grief and hostility. Atmosphere is always INFERRED, scene-scoped and non-canonical. Scanner output cannot self-reinforce atmosphere on the next revision without new narrative evidence.

## Reconciliation

Every tracker must be recoverable. SceneReconciler keeps a last-known-good snapshot and supports targeted field rollback/correction. Repairing a bad time field does not erase good location, cast, object or thread state.

Current active-field evidence is bounded; retention policy can bound historical snapshots/deltas without changing current scene truth.

## Compatibility seams

Wave 1 publishes no Event Spine events and invokes no Sidecar. It exposes stable public Scene data that later integration can translate to:

- active cast;
- location;
- active threads;
- conflict/uncertain fields;
- boundary state;
- scene revision;
- objects;
- atmosphere;
- scene health.

This is suitable for later Dynamic Fan-Out (#93), CRAG/Self-RAG control (#49), UI.Core Scene Board/Studio, and Function Test 002 without duplicating their owners.

## Browser target

Production Scene modules use browser-safe standard JavaScript only. Node-specific dependencies are isolated to tests/CI.

## Deferred work

Wave 1 explicitly does not implement #103, #108–#113, #177, #182, #183 or #173.

# Wave 2 — Lifecycle, Episodes, Graph, Retrieval and Host Intake

## Continuity objective

Wave 2 extends live perception into narrative continuity:

NarrativeEvidence -> CurrentScene -> confirmed lifecycle transition -> SceneEpisode -> Scene Stack / Scene Graph -> retrieval + adjacency -> normalized Scene events -> prefetch recommendations.

The host boundary is:

SillyTavern activity -> NarrativeFeedAdapter -> immutable revisioned Area-52 evidence -> Scene Intelligence.

Wave 2 remains Phase 1 backend cognition. It does not implement Scene Studio or UI.

## Scene Stack

Scene Stack is the bounded live topology view. Relationships are:

- CONTINUES
- PRECEDES
- PARALLEL_TO
- FLASHBACK_OF
- INTERRUPTS
- RESUMES

Only one frame owns active narrative focus. Flashback, parallel and interruption suspend the prior resumable frame. RESUMES reactivates the same conceptual Scene ID. Unknown/non-resumable Scenes cannot resume. Closed frames are bounded in the live stack; durable relationship history belongs in Scene Graph.

## SceneEpisode

SceneEpisode is a DERIVED artifact keyed by sceneId + sceneRevision + source revision set. It retains source range/revisions, participants, location/time FieldStates, events, claims/signals, state/object transitions, threads, atmosphere trajectory, Scene relationships, compact retrieval text, provenance, and a reference-first artifact descriptor/digest.

Compilation is deterministic/idempotent for the same revision. Source revision changes produce a new Episode revision rather than rewriting the old derivation. A SceneEpisode never becomes SOURCE_CANON merely because it is coherent.

Memory decides how/when a SceneEpisode enters durable experience storage.

## Clapperboard lifecycle

Confirmed boundaries are coordinated by ClapperboardTransitionManager. Linear continuation closes the prior Scene, derives its Episode, records the graph relationship, opens the next Scene, publishes lifecycle events, and emits a speculative prefetch recommendation.

FLASHBACK_OF, PARALLEL_TO and INTERRUPTS suspend rather than falsely close the prior conceptual Scene. RESUMES closes/finalizes the temporary Scene and reopens the original Scene ID.

Transition delivery is candidate-deduplicated and revision-fenced. Duplicate confirmation cannot create duplicate Episodes, next Scenes, or graph edges. Episode compilation failure returns EPISODE_PENDING while retaining recoverable Scene lifecycle state.

## Scene Graph

Scene Graph is narrative topology, not the Temporal State Graph and not world ontology.

Supported narrative edges include Scene precedes/continues/parallel/flashback/interrupt/resume plus entity/event/object/thread membership.

Adjacency is never interpreted as causality. Edges carry evidence/provenance or derivation references.

## Scene retrieval

SceneRetrievalAdapter returns bounded SceneEpisode references and metadata rather than copying full Episodes. Scoring may use semantic overlap, entities, location, active threads, adjacency and recency. Results preserve source range/source revision references and relationship to the active Scene for drill-down.

A relevant historical Episode remains historical evidence; retrieval does not mutate CurrentScene or world truth. Stale source-revision Episodes are fenced out.

Retrieval exposes HIGH/MIXED/LOW quality classification for the shared retrieval-control policy without implementing a second CRAG/Self-RAG engine.

## Prefetch

ScenePrefetchTrigger produces expiring, revision-fenced recommendations only. Recommendations can include entity/location/thread/Scene refs, priority and evidence. They may be ignored or cancelled. Scene never directly wakes Sidecars.

## Scene event production

SceneEventPublisher produces immutable, versioned, deduplicated Scene events compatible with Runtime Event Spine metadata: event/type/version, producer, correlation/causation/turn identity, scene revision fence, source revisions, sequence, dedupe identity and payload.

Scene events create signals/obligations; they grant no mutation authority.

## Narrative Feed Adapter

NarrativeFeedAdapter normalizes USER_SEND, ASSISTANT_GENERATION_COMPLETE, REGENERATE, SWIPE_SELECTED, EDIT, DELETE, CONTINUE, CHAT_LOAD, CHAT_SWITCH, NEW_CHAT, IMPORT_OR_RELOAD and LORE_CHANGE into host-neutral NarrativeEvidence.

It preserves chat/message/revision/turn/source identities and causation/correlation/order. Edits append revisions. Regeneration and swipe replacement invalidate abandoned current evidence. Delete emits invalidation. Duplicate host delivery is idempotent. Chat IDs namespace evidence and CurrentScene identity.

Unsupported/invalid host activity returns typed failure rather than fabricated narrative evidence.

## Restart and revision fencing

SceneRegistry, SceneStack, SceneEpisodeCompiler, SceneGraph, NarrativeFeedAdapter and Prefetch state expose serializable export/import contracts. Reconstruction preserves conceptual Scene IDs and source/evidence lineage.

Late Scene events and transition work are revision-fenced. A result for an older Scene revision cannot become active state for a newer revision.

## Nervous-system readiness

SceneLifecycleRuntime composes the host-normalization and Scene-side lifecycle contracts without owning provider scheduling or Runtime execution. Its public signal artifact extends Wave 1 with Scene relationship, Episode refs, retrieval quality and prefetch recommendations for later Dynamic Fan-Out/Runtime adapters.

The Wave 2 branch may report SCENE SIDE READY for FT002. Live FT002 remains an integration/main acceptance and is not claimed here.
