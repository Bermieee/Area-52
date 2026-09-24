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
