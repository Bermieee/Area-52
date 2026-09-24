# Area-52 Scene Intelligence Reference Documentation

## Public exports

Wave 1 exports from src/scene/index.js.

### Contracts and enums

- ObservationClass: OBSERVED, INFERRED, UNRESOLVED, UNKNOWN.
- SceneLifecycle: OPEN, CLOSED, SUSPENDED.
- CastPresence: PRESENT, DEPARTED, OFFSCREEN_RELEVANT, UNCERTAIN, MENTIONED_ONLY.
- ObjectPresence: PRESENT, HELD, CARRIED, WORN, CONTAINED, VISIBLE, DEPARTED, REMOVED, DAMAGED, DESTROYED, MENTIONED_ONLY, UNCERTAIN.
- BoundaryStatus and BoundaryType.
- DeltaReason and RefreshReason.
- createEvidenceRef, createFieldState, createSceneObservationProposal, createSceneDelta, createBoundaryCandidate, createSceneSnapshot.

### Runtime components

- SceneStateExtractor — provider-neutral proposal builder that attaches evidence without granting authority.
- SceneDeltaEngine — deterministic field-level proposal validation/application and drift detection.
- SemanticBoundaryDetector — weighted semantic candidate nomination.
- BoundaryVerifier — confirmation/contradiction window with explicit-transition override, debounce/hysteresis and false-cut recovery.
- SceneRegistry — stable IDs, revision snapshots, lifecycle, source-edit invalidation, suspend/resume.
- ActiveCastResolver — presence-state resolution without mention promotion or weak-mention downgrades.
- SpatialStateTracker — scene-local spatial proposals with view-vs-location separation.
- TemporalStateTracker — temporal anchors, correction and anti-cascade protection.
- ObjectStateTracker — object presence/possession observation plus durable proposal seam.
- AtmosphereTracker — inferred scene-scoped atmosphere dimensions.
- SceneReconciler — last-known-good tracking and targeted rollback/correction.
- SceneIntelligenceRuntime — minimal coordinator for deterministic tests and future adapters.

## Evidence model

Scene production code stores references, not cloned source text. Evidence references are expected to resolve externally to chat/message IDs, source revisions and evidence spans.

A non-UNKNOWN FieldState requires evidenceRefs. Confidence is metadata, not authority. Provider confidence of 1.0 cannot promote INFERRED to OBSERVED or SETTLED.

## CurrentScene data readiness

SceneIntelligenceRuntime.publicSignals(sceneId) returns a lightweight object suitable for later UI/Fan-Out adapters:

- sceneId / sceneRevision;
- activeCast;
- location;
- activeThreads;
- conflictSignals / uncertainFields;
- boundaryState;
- objects;
- atmosphere;
- health.

No DOM, UI persistence or UI.Core dependency exists in Scene core.

## Safe failure behavior

- stale proposal -> reject;
- unsafe drift -> return delta with fullRefreshRequired=true and do not apply by default;
- weak boundary -> pending/rejectable candidate;
- explicit false cut -> recoverable state with evidence;
- unsupported mention -> mentioned-only rather than presence/possession;
- derived time from prior inference -> unresolved;
- source edit -> dependent fields unresolved while unrelated fields survive;
- bad field -> targeted rollback to last-known-good.

## Memory ownership boundary

Scene state is live observation/inference. Durable episodic storage, durable object/world truth and settlement remain external. Scene may produce evidence-backed proposals/signals only.

## Sidecar / provider boundary

The core accepts provider-neutral proposals and has no model/provider imports. A future specialist can generate SceneObservationProposal; deterministic Scene code decides whether it is structurally admissible and whether it can be applied.

## Runtime / Event Spine boundary

Wave 1 does not schedule work and does not publish Event Spine events. Later adapters may translate stable public Scene data and verified Scene decisions into the Runtime/Event Spine contracts.

## UI boundary

Wave 1 implements no UI. The public data contract carries CurrentScene, health, revision, deltas, cast, location/time, objects, threads, atmosphere, boundary state, evidence, confidence and warnings so UI.Core can build the later Scene Board/Scene Studio without Scene-owned DOM.
