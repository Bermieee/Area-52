# UI.Core Wave 4 — Framework Discovery + Runtime Integration Preparation

**Branch:** `Development-UI`  
**Starting UI SHA:** `05bdd1eedd70ac57bb85288caf2530c1f99e0595`  
**Kickoff Cognitive Core reference requested:** `bd42966f3e0fd28cefacacabd1458ef080c32ea7`  
**Actual Cognitive Core head inspected read-only:** `d06b6e033758a0c5934e233fa68cb689cbca798f`  
**Runtime Wave 1 reference inspected read-only:** `Development-Worker-Director@89ce5f4610be28fd6d579d0ab883db67f5dc7676`

## Purpose

Wave 4 makes UI.Core open-ended without turning it into a second Cognitive Kernel framework.

The UI owns only presentation discovery:

```text
registered cognitive service
        |
        v
UI Extension Descriptor (data only)
        |
        v
UIExtensionRegistry
  |       |        |        |
  v       v        v        v
workspace inspector telemetry typed action
        \    |      /
          UI.Core Shell
```

Canonical service identity, artifact identity, migrations, dependency authority, lifecycle promotion, conformance, certification and canonical event registration remain outside UI.Core.

## Core behavior

`UIExtensionRegistry` validates a schema-versioned descriptor and a separate UI binding.

The descriptor is data only. It may name:

- extension/subsystem identity;
- display metadata;
- workspace surfaces;
- inspector surfaces;
- lightweight telemetry surfaces;
- typed action metadata;
- lifecycle state;
- required/optional capabilities;
- dependencies;
- permission/authority hints;
- availability/degraded state.

Executable renderers, adapter instances, telemetry subscriptions and action handlers live in the separately supplied UI binding. The registry recursively rejects executable functions embedded inside a descriptor.

Registration preflights all collisions and missing required bindings before mutating any UI registry.

## Dynamic shell discovery

`WorkspaceRegistry` now supports subscribe/update/unregister in addition to register/get/list.

`ApplicationShell` listens to generic workspace-registry changes and rebuilds navigation through one generic path. It contains no switch or subsystem-name knowledge for dynamic services.

If the currently selected dynamic workspace disappears, the shell selects the first remaining workspace and releases the previous workspace scope.

## Inspector discovery

`InspectorRegistry` now supports duplicate rejection, subscribe, list, has and unregister.

`InspectorController` observes registry changes. Unregistering a specialized inspector therefore replaces its mounted content with the normal fallback path rather than retaining a stale renderer.

Unknown framework artifacts and Event Spine envelopes also have safe generic inspection models.

## Action discovery

Dynamic actions always register through the existing `ActionRouter`.

`ActionRouter` now rejects duplicate subsystem/action registrations and exposes read-only presence inspection for lifecycle tests. A descriptor cannot carry a function that bypasses routing.

The extension registry creates a UI routing namespace per extension and invokes only an approved binding handler after normal Action Router permission/state validation.

Registering a surface grants no canonical mutation authority.

## Telemetry discovery

Telemetry descriptors are inert until a consumer explicitly subscribes. UI.Core does not begin deep polling when an extension registers.

Active telemetry subscriptions are tracked per extension and forcibly released on unregister. The workspace scope also owns any telemetry subscription it starts while mounted.

## Lifecycle and degradation

UI-owned presentation vocabulary:

- `EXPERIMENTAL`
- `SHADOW`
- `ACTIVE`
- `DEPRECATED`

Availability presentation:

- `AVAILABLE`
- `DEGRADED`
- `UNAVAILABLE`
- `SHADOW`

UI.Core displays supplied states. It does not decide promotion, demotion or dependency truth.

An optional dependency loss can be represented by updating the extension to `DEGRADED`; the workspace remains registered and receives the supplied dependency status. `UNAVAILABLE` produces a safe diagnostic instead of crashing the shell.

## Version handling

UI extension descriptor schema major `1` is supported.

- compatible 1.x descriptors load;
- unknown optional fields are retained/ignored safely;
- incompatible major versions fail locally with `UIExtensionCompatibilityError`;
- invalid descriptors fail before partial registration;
- collisions fail before partial registration.

## Generic artifact/event compatibility

Unknown artifacts can be normalized to:

- artifact ID/type;
- schema version;
- owner;
- authority;
- revision;
- status;
- provenance;
- dependencies;
- invalidators;
- bounded payload summary.

Event Spine envelopes preserve the accepted Runtime fields:

- event ID/type;
- causation/correlation;
- turn/task;
- source/world/scene revisions;
- sequence/time;
- dedupe identity;
- bounded payload summary.

Known event types may receive rich presentation. Unknown valid event types receive generic presentation. Unsupported event schema majors produce a visible incompatible diagnostic.

## Runtime Wave 1 integration preparation

`RuntimeWave1UIAdapter` consumes a narrow bridge instead of importing Worker Director implementation objects.

Bridge functions:

- `snapshot()`
- `listLedger()`
- `listTelemetry()`
- optional `listEvents()`
- optional `subscribeTelemetry(handler)`
- optional `subscribeEvent(type, handler)`

The adapter translates accepted Runtime Wave 1 lifecycle/execution/resource vocabulary into existing UI observability surfaces while preserving canonical names and detailed Work Ledger fields.

The contract fixture is based on the published Runtime Wave 1 sequence:

```text
L3 Lore Study ACTIVE
 -> generation begins
 -> WORK_YIELD_REQUESTED / YIELDING
 -> bounded slice checkpoint
 -> PARKED, lifecycle still ELIGIBLE
 -> L1 foreground ACTIVE
 -> generation completes
 -> WORK_RESUMED / L3 ACTIVE
 -> next slice
 -> SATISFIED / COMPLETE
```

It is a UI-consumption fixture, not a scheduler/Worker Director reimplementation.

## Performance

Wave 4 preserves:

- keyed render coalescing;
- paging;
- virtualization;
- on-demand detail;
- lazy telemetry subscription;
- ResourceScope cleanup;
- mount/destroy/remount safety.

Stress acceptance registers 128 unknown synthetic extensions without mounting them, verifies deterministic ordering/collision safety, and unregisters all surfaces/resources cleanly.

## Branch discipline

All Wave 4 implementation is confined to `Development-UI`.

`Development-Nexus` and `Development-Worker-Director` are read-only references. No merge to Nexus or main is part of this wave.
