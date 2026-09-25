# Area-52 UI.Core Widget Contracts

**Owner branch:** `Development-UI`  
**Parent epic:** #58  
**Initial implementation:** UI.Core wave 1

## Architectural boundary

UI.Core owns presentation, layout, render scheduling, widget lifecycle, interaction routing, cleanup, overlays, accessibility, and presentation-only persistence. Cognitive subsystems own their state and mutations. Widgets receive state and lightweight signals; mutation requests travel through the typed `ActionRouter`.

A widget must never reach directly into a cognitive store.

## Widget registration contract

Every widget registers:

```js
{
  widgetId,
  version,
  category,          // primitive | structural | cognitive | diagnostic
  propsSchema,
  supportedActions,
  subscriptions,
  permissions,
  renderCostClass,   // CHEAP | NORMAL | EXPENSIVE
  create(context)
}
```

Duplicate widget IDs are rejected. Missing lifecycle metadata is rejected at registration time.

## Lifecycle contract

The runtime sequence is:

```text
register
  -> mount
  -> subscribe
  -> update/diff
  -> resize/show/hide
  -> destroy
  -> unsubscribe/cleanup
```

Every mounted widget receives a `ResourceScope`. The scope owns cleanup for listeners, signal subscriptions, observers, timers, and abortable async UI resources. `destroy()` is idempotent. A destroyed widget may be mounted again as a fresh instance without retaining handlers from the previous instance.

## Signal contract

`SignalHub` emits small immutable envelopes:

```js
{
  type,
  payload,
  sequence,
  timestamp,
  source,
  revision
}
```

Initial canonical signals:

- `WORKER_STATE_CHANGED`
- `BATCH_PROGRESS_CHANGED`
- `QUEUE_COUNT_CHANGED`
- `COGNITIVE_MODE_CHANGED`
- `CLAIM_STATE_CHANGED`
- `REFLECTION_CHANGED`

UI-only selection/workspace/activity signals use the same bus but do not become brain state.

## Render contract

`RenderScheduler` owns frame publication. Invalidation keys deduplicate repeated updates before the next browser frame. Work is ordered by render cost. Hidden lazy `EXPENSIVE` work is skipped. This prevents telemetry storms from turning observability into a foreground workload.

## Action contract

```text
UI action
  -> ActionRouter
  -> action exists?
  -> permissions valid?
  -> target state valid?
  -> optional payload validation
  -> owning subsystem handler
  -> typed result
```

UI.Core does not settle claims or mutate canonical memory. In the Brain Dashboard, the subsystem handler is a deterministic mock used only to prove the boundary.

## Inspector contract

Inspectable objects declare a `kind`. `InspectorRegistry` maps that kind to a renderer. A selection publishes `UI_INSPECT_SELECTION_CHANGED`; the Inspector loads the appropriate object detail on demand.

The first mock Inspector supports worker, claim, reflection, candidate, graph, rerank, shadow, and fallback object views. Claim inspection includes temporal history and provenance.

## Workspace contract

Subsystem UI plugs into the shell declaratively:

```js
{
  id,
  title,
  icon,
  views,
  supportedActions,
  render(container)
}
```

UI.Core owns the shell. Workspace code receives only the workspace host; it does not modify the shell root.

## Persistence contract

`UIStateStore` contains presentation state only. Storage read/write failures are swallowed into `lastError` and defaults, so UI persistence failure cannot affect cognitive behavior.

## Virtualization contract

`computeVirtualWindow()` calculates the visible window and overscan. `VirtualListController` mounts only visible rows while keeping a logical scroll height for the complete collection. The deterministic demo uses 10,000 retrieval candidates without creating 10,000 DOM nodes.

## Overlay contract

`OverlayManager` owns modal/drawer/popover stacking, focus ownership, Escape handling, backdrop handling, cleanup, and STACKED-mode modal-to-drawer conversion. Each overlay has a cleanup scope.

## Accessibility contract

The platform defaults to semantic landmarks, native buttons/inputs, visible focus rings, keyboard workspace navigation, `/` search focus, modal focus trapping, reduced-motion support, status text, and labeled Inspector/search regions.

## Initial cognitive widget registry

Wave 1 registers:

- BrainStatus
- WorkerPool
- LifecycleLane
- BatchProgress
- SourceCard
- ClaimCard
- TemporalStateCard
- ReflectionCard
- ProvenanceChain
- CandidateCard
- TruthDecision
- RerankResult
- ContextPacketViewer
- GraphExplorer
- ShadowComparison

`VirtualCandidateList` is an implementation helper proving large diagnostic collections.
