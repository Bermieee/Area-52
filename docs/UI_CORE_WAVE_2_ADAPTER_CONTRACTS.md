# UI.Core Wave 2 — Adapter Contracts

**Branch:** `Development-UI`  
**Baseline:** `dc8758144c3c27b4a0f2dad0844bec65ebd25437`

Wave 2 keeps UI.Core observational and authority-neutral. Backend implementations are consumed through typed UI-facing adapters; widgets do not import backend implementation objects.

## SceneUIAdapter

Required methods:

- `getCurrentScene()`
- `getBoundaryState()`
- `getSceneEpisode(id)`
- `getSceneHistoryPage({ offset, limit })`
- `getRelatedScenes(sceneId)`
- `subscribeSceneDeltas(handler)`

Scene events include `LOCATION_CHANGED`, `ACTIVE_CAST_CHANGED`, `TIME_SHIFT_DETECTED`, `VIBE_CHANGED`, and `SCENE_STATE_DELTA`. UI.Core applies field-keyed render invalidations through the existing RenderScheduler rather than redrawing the workspace snapshot.

## RuntimeUIAdapter

Required methods:

- `getOverview()`
- `getLifecyclePage({ offset, limit })`
- `getWorkers()`
- `getBatches()`
- `getLedgerPage({ offset, limit })`
- `subscribeRuntime(handler)`

Lifecycle obligations are independent records. A PARKED worker does not remove or hide a queued cognitive obligation.

## CoprocessorUIAdapter

Required methods:

- `getTurnSwarm(turnId)`
- `getGather(turnId)`
- `getContextSealTimeline(turnId)`
- `subscribeCoprocessor(handler)`

Worker results carry explicit `REQUIRED`, `OPPORTUNISTIC`, or `DEFERRED` classes. Gather state exposes expected/completed workers, required missing work, foreground quorum, deadline, Context Seal state, and late results. Results completed after `CONTEXT SEALED` are shown as `NEXT TURN` or `BACKGROUND`; they never appear to have contributed to the sealed foreground context.

## KnowledgeUIAdapter

Required methods:

- `inspectSource(ref)`
- `inspectProvenance(ref)`
- `inspectHistory(ref)`
- `inspectDependencies(ref)`
- `inspectSettlement(ref)`
- `inspectEvidence(ref)`

All six operations are read-only Inspector interactions. Widgets invoke them through the existing ActionRouter using `knowledge:inspect`. Returned settlement details explicitly identify the owning subsystem as the authority boundary.

## Adapter injection

`createBrainDashboard({ adapters })` accepts a real adapter bundle. Omitting adapters installs the deterministic Ember Tavern / Sun Blade fixture implementing the same interfaces.

The intended integration seam is:

```text
brain subsystem
  -> typed UI adapter
  -> small state/signal contract
  -> UI.Core workspace/widget/Inspector
```

not:

```text
widget
  -> backend internals
  -> direct mutation
```
