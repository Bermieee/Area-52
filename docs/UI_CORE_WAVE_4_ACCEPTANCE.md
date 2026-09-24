# UI.Core Wave 4 — Acceptance / Changelog

**Working branch:** `Development-UI`  
**Starting accepted SHA:** `05bdd1eedd70ac57bb85288caf2530c1f99e0595`  
**Implementation commit:** `7f1611ae3832555d7864de35f26afaf3e39ae658`  
**Runtime reference:** `Development-Worker-Director@89ce5f4610be28fd6d579d0ab883db67f5dc7676`  
**Latest Cognitive Core head reconciled read-only before acceptance:** `Development-Nexus@76f51746cbde576bdbf4daedccc1cdea7c352eac`

## Acceptance result

**PASS**

The primary #128 criterion is proven: a synthetic subsystem that does not exist in UI.Core production source registers a workspace and inspector after the Application Shell is already mounted. It also exposes lazy telemetry and a typed read-only action, degrades/recoveries through typed presentation state, and unregisters without leaving action or telemetry resources behind.

The synthetic `World Economy` implementation exists only under `tests/fixtures/wave4-synthetic-extension.mjs`. Application Shell has no World Economy or subsystem-specific conditional.

## Change log

### Presentation discovery

Added `UIExtensionRegistry` and versioned `UI Extension Descriptor` validation.

Descriptors advertise presentation metadata only:

- identity/display;
- workspaces;
- inspectors;
- telemetry surfaces;
- typed actions;
- lifecycle;
- capabilities;
- dependencies;
- permissions/authority hints;
- availability/degradation.

Executable functions are rejected inside descriptors. Approved UI code is supplied separately through bindings.

### Dynamic workspace lifecycle

`WorkspaceRegistry` now supports update/unregister/subscription.

Application Shell observes generic registry changes, updates navigation after mount, rerenders an updated current workspace and safely falls back when a selected dynamic workspace unregisters.

### Dynamic inspector lifecycle

`InspectorRegistry` now supports collision detection, enumeration, subscription and unregister.

InspectorController observes registry changes so removed specialized surfaces cannot remain stale.

### Dynamic action lifecycle

ActionRouter now rejects duplicate action/subsystem registrations and exposes presence inspection used by lifecycle tests.

Extension actions always traverse ActionRouter. Extension metadata cannot inject an executable bypass.

### Lazy telemetry

Extension telemetry is inert until explicitly subscribed.

Active telemetry subscriptions are tracked and released on extension unregister. Mounted-workspace subscriptions can also be owned by the workspace ResourceScope.

### Lifecycle/degradation presentation

Supported presentation states:

```text
EXPERIMENTAL / SHADOW / ACTIVE / DEPRECATED
AVAILABLE / DEGRADED / UNAVAILABLE / SHADOW
```

UI.Core displays these supplied values but does not promote/demote systems or determine dependency truth.

### Version compatibility

UI extension schema major `1` is accepted.

Compatible unknown optional fields are tolerated. Incompatible major versions and malformed descriptors fail locally with understandable diagnostics before partial registration.

### Unknown artifacts/events

Added generic artifact inspection for common framework metadata and bounded payload summary.

Added generic Event Spine envelope inspection. Known valid event types can receive richer presentation; unknown valid types remain safely inspectable; incompatible schema major fails visibly.

### Runtime Wave 1 adapter readiness

Added `RuntimeWave1UIAdapter` against the accepted Runtime Wave 1 public vocabulary rather than UI-invented execution semantics.

It translates:

- lifecycle vs execution;
- L0–L4 queue/utilization;
- worker capabilities/resources;
- foreground reserve/background borrowing;
- batch/checkpoint/yield;
- recovery;
- Work Ledger summary/detail;
- bounded telemetry;
- Event Spine events.

The UI-side contract fixture follows the published safe-yield path and preserves the key invariant that lifecycle remains `ELIGIBLE` while execution is `PARKED`.

### Performance

Dynamic registration preserves the Wave 3 signal-first model. 128-extension stress proves registration is lazy and deterministic. Large Runtime state remains paged/on-demand rather than continuously replicated.

## Integrated 22-step scenario

The deterministic acceptance test proves:

1. existing built-ins operate;
2. unknown descriptor arrives;
3. descriptor validates/registers;
4. workspace is discovered without shell subsystem code;
5. workspace mounts;
6. inspector is discovered;
7. lifecycle is SHADOW;
8. telemetry flows;
9. optional dependency loss produces DEGRADED;
10. dependency recovery restores surface state;
11. generic unknown artifact is inspectable;
12. Runtime contract fixture exposes active L3 work;
13. generation starts;
14. Runtime requests yield;
15. bounded slice checkpoints and parks;
16. lifecycle remains ELIGIBLE while execution is PARKED;
17. L1 foreground work executes;
18. background L3 resumes from checkpoint;
19. extension unmounts/unregisters;
20. workspace/inspector/actions/listeners disappear;
21. built-in UI remains operational;
22. no cognitive authority changes.

## Validation

Implementation SHA `7f1611ae3832555d7864de35f26afaf3e39ae658`:

- **77/77 tests PASS**;
- JavaScript syntax PASS;
- UI.Core index import PASS;
- Wave 4 Actions run `35824723025` SUCCESS;
- preserved Wave 3 Actions run `35824722974` SUCCESS.

## Issue disposition

### #128

Full UI-owned acceptance is satisfied and may be closed as completed.

### #33

UI integration readiness materially advanced: the adapter now matches the accepted Runtime Wave 1 contract and deterministic safe-yield semantics. Keep open until the real Runtime implementation and UI coexist in an integrated branch and pass end-to-end.

### #86

Keep open. No real Sidecar/Jev integration occurred in this wave.

### #121–#127 and #129–#131

Do not close based on Wave 4. UI.Core provides only presentation-facing extension seams; it does not implement canonical manifest/artifact/migration/dependency/lifecycle/conformance/certification/event-registry authority.

## Known limitations / remaining dependencies

- Runtime telemetry uses a constructor-provided sink in accepted Runtime Wave 1. The future integrated host must fan that sink into the UI bridge; UI.Core does not modify Runtime ownership.
- Canonical #121 manifest shape does not yet exist on this UI branch; future integration should translate it into the data-only UI extension descriptor rather than replacing the UI registry.
- Generic artifact/event views intentionally provide bounded summaries, not permanent deep-state polling.
- Project board Status-column mutation depends on GitHub Projects V2 support; issue closure may be reflected by board automation, but UI.Core code does not control project metadata.

## Branch discipline

- no new branch created;
- no other branch used as workspace;
- `Development-Nexus` inspected read-only only;
- `Development-Worker-Director` inspected read-only only;
- no merge to `Development-Nexus`;
- no merge to `main`.
