# UI.Core Wave 6 — Product Interface + Live Wiring

## Purpose

Wave 6 turns the accepted UI.Core framework and Wave 5 product concepts into a host-adjacent product interface that can consume real subsystem read models without becoming a backend owner.

The production entry point is:

```js
createWave6ProductInterface({ root, bridges, productName, hostMountAdapter })
```

It reuses the accepted UI.Core services:

- SignalHub
- RenderScheduler
- WidgetRegistry
- WorkspaceRegistry
- InspectorRegistry / InspectorController
- ActionRouter
- OverlayManager
- NotificationCenter
- ApplicationShell
- persistent UI state
- virtualization

There is no second shell, subsystem-local render loop, or chat implementation.

## Host-adjacent Front Face

The Front Face is one product with two presentation states.

### Quick Dash / collapsed

The collapsed dock is a narrow host-side rail. It shows only:

- configurable product identity;
- overall Brain health;
- current Scene identity;
- needs-attention count;
- one coalesced cognitive activity summary;
- expand affordance.

It does not attempt to fit the full dashboard into the rail.

### Expanded

The same ApplicationShell expands into:

- Home
- Story / Scene
- Characters
- Lore
- Memory
- World
- Brain
- contextual Inspector

Engineering workspaces remain Advanced under Brain.

The product does not render or own SillyTavern chat.

## Host mount seam

`HostAdjacentMountAdapter` accepts host-owned callbacks:

- `reserveWidth(width)`
- `releaseWidth(width)`
- `onModeChange({mode,width})`

Canonical UI.Core does not guess SillyTavern DOM selectors or event names. The final host integration layer can supply those callbacks without changing UI architecture.

## Presentation state

`FrontFacePresentationState` persists only:

- collapsed / expanded;
- Front Face width;
- density;
- Inspector visibility;
- Inspector width;
- last product workspace.

These values are UI state only. They never include Scene, World, Memory, truth, authority, or generation state.

## Production data modes

Every product source is one of:

- LIVE
- DEGRADED
- UNAVAILABLE
- FIXTURE

Fixtures are legal only when explicitly supplied to the production bootstrap. Every available fixture surface is labeled FIXTURE; missing fixture surfaces remain UNAVAILABLE.

A fixture-backed source is rejected if it attempts to identify itself as LIVE.

## Production adapters

### Scene

`SceneProductionUIAdapter` consumes the accepted `SceneUiReadModel`.

It exposes:

- exact Scene ID/revision;
- location;
- narrative time;
- cast;
- objects;
- active threads;
- inferred atmosphere;
- boundary state;
- SceneEpisode reference;
- prefetch state;
- unresolved fields;
- provenance and diagnostics.

It does not perform Scene extraction or Settlement.

### Runtime

`RuntimeProductionUIAdapter` consumes the existing Runtime UI bridge contract:

- telemetry summary;
- Runtime Work Ledger pages/details;
- recovery rows;
- lightweight subscription.

Normal product text describes operational impact rather than worker/provider machinery.

### Coprocessor

`CoprocessorProductionUIAdapter` consumes either accepted Coprocessor telemetry or the existing Coprocessor UI adapter.

Normal surfaces expose:

- meaningful cognition activity;
- warm hits;
- fallback impact;
- stale drops;
- result destinations.

Provider/model identity is not required for NORMAL.

### PromptPlan / Context Delivery

`PromptPlanProductionUIAdapter` consumes injected Core read callbacks for:

- PromptPlan;
- ContextSealReceipt;
- optional completed-generation Context Receipt;
- optional integrity receipt.

It displays budget, allocated context size, reuse/update counts, dropped/deferred material and seal state. It does not run the Context Compiler.

### Forensics

`ForensicsProductionUIAdapter` consumes read-only Cognitive Transaction Ledger and Forensic Bundle readers.

The full timeline is an Advanced workspace and uses UI.Core virtualization.

## Missing producer behavior

A missing read producer is not replaced by fixture data.

It displays UNAVAILABLE / NOT CONNECTED.

At Wave 6 worker acceptance, direct assembled bindings are still required for:

- final SillyTavern mount callbacks;
- Core PromptPlan / ContextSeal reader injection on the assembled application;
- completed-generation Context Receipt where a dedicated producer is exposed;
- Cognitive Transaction Ledger / ForensicBundle application binding;
- Memory product read model;
- Lore product read model;
- World product read model;
- Characters product read model.

The UI consumer contracts exist; backend ownership remains outside UI.Core.

## Health grammar

Wave 6 canonical health states are:

- READY
- WORKING
- DEGRADED
- STALE
- BLOCKED
- UNAVAILABLE
- IDLE

Product surfaces show availability, health and impact together. DETAIL/ADVANCED may expose the machinery that caused the condition.

## Authority grammar

Shared authority treatments include:

- SOURCE CANON — ◆
- OBSERVED — ◉
- SETTLED / CURRENT — ✓
- INFERRED — ✦
- UNRESOLVED — ◇
- UNCERTAIN — ?
- HISTORICAL / SUPERSEDED — ◷
- SHADOW — ◫
- EXPERIMENTAL — ⚗

The CSS also changes border structure (solid / dotted / double / dashed), so meaning does not depend on color.

Confidence is not authority. Retrieval rank is not authority.

## Provenance actions

The existing shared provenance action bar remains the route for:

- Source
- Provenance
- History
- Dependencies
- Settlement
- Evidence

Wave 6 disables an action when the Action Router has no registered owning backend. The UI never fakes success.

## Brain Pulse

`BrainPulseModel` is a bounded product-facing projection over Runtime/Coprocessor activity.

NORMAL:

- overall Brain health;
- current focus;
- foreground cognition;
- background cognition;
- meaningful coalesced activity;
- needs attention.

DETAIL adds HOT/DEEP, warm/fallback/stale counts and result destinations.

ADVANCED exposes engineering workspaces and forensics.

Routine worker transitions remain in Brain Pulse. They do not generate prominent notifications.

## Render coalescing

Quick Dash signal bursts invalidate one stable scheduler key.

Brain Pulse batches its pending activity under one scheduler key.

It retains at most the configured activity budget rather than turning every runtime transition into a DOM redraw.

## Browser / lifecycle rules

Wave 6 production source has no Node-only imports.

Destroying the product releases:

- SignalHub subscriptions;
- Brain Pulse subscriptions;
- Quick Dash listeners;
- workspace scopes;
- Inspector subscriptions;
- host width reservation;
- overlays;
- scheduler state.

The product bootstrap supports configurable branding so a future Area-52 -> Nexus rename does not require an architecture rewrite.
