# UI.Core Wave 1 — Implementation and Acceptance Record

**Epic:** #58  
**Issues covered:** #59–#74 and #34  
**Working branch:** `Development-UI`

## Scope delivered

Wave 1 establishes the canonical UI platform without implementing cognitive authority. It includes:

- semantic design-token/theme foundation with dark defaults and a light-theme contract;
- WIDE, COMPACT, and STACKED responsive modes;
- widget metadata registry and lifecycle runtime;
- cleanup scopes for listeners, subscriptions, timers, observers, and async UI resources;
- application shell with navigation, workspace, contextual Inspector, search, and runtime strip;
- declarative Workspace Registry;
- Inspector Registry and object selection signal;
- typed Action Router with permission/state validation;
- lightweight SignalHub;
- coalescing render scheduler with CHEAP/NORMAL/EXPENSIVE classes;
- reusable list virtualization;
- centralized overlay/drawer/modal lifecycle;
- notifications/toasts and canonical status vocabulary;
- keyboard/focus/reduced-motion accessibility primitives;
- presentation-only persistent UI state;
- primitive/structural widget registrations;
- reusable cognitive widgets backed by deterministic mock UI contracts;
- mock Area-52 Brain Dashboard.

## Deterministic acceptance model

The mock brain exposes a worker transition sequence:

```text
ACTIVE -> YIELDING -> PARKED -> ACTIVE -> COMPLETE
```

Each transition is published as `WORKER_STATE_CHANGED`; the WorkerPool and LifecycleLane update from that signal rather than receiving a whole brain snapshot.

The mock temporal claim begins as:

```text
CURRENT: tavern = intact
```

and transitions to:

```text
SUPERSEDED: intact valid T0..T492
CURRENT: destroyed valid T492..
```

The old state remains inspectable with provenance (`World source UID 184`, claim ID, and `FireEvent492`).

## Brain Dashboard acceptance target mapping

1. Application shell — `ApplicationShell`.
2. Workspace switching — Brain, Runtime, Retrieval, Evaluation workspaces.
3. Contextual Inspector — `InspectorController` + registry.
4. WorkerPool — cognitive widget.
5. LifecycleLane — cognitive widget.
6. BatchProgress — cognitive widget.
7. TemporalStateCard — cognitive widget.
8. ReflectionCard — cognitive widget.
9. ProvenanceChain — cognitive widget.
10. CandidateCard / TruthDecision — cognitive widgets.
11. ContextPacketViewer — cognitive widget.
12. Simulated runtime signals — `MockBrainRuntime`.
13. Coalesced rendering — `RenderScheduler`.
14. Virtualized large list — 10,000 deterministic mock candidates.
15. Responsive layout — WIDE / COMPACT / STACKED.
16. Keyboard navigation — roving navigation, native controls, `/` search focus, focus trapping.
17. Clean mount/destroy/re-mount — lifecycle test ensures no duplicate subscription handlers.

## Validation

Run:

```bash
npm test
```

The test suite covers signal subscription cleanup, frame coalescing, render-cost order, hidden expensive work, ResourceScope cleanup, widget remount behavior, registry metadata validation, declarative workspaces, action permission/state fences, persistence failure containment, 10k-list virtualization, responsive mode thresholds, the required worker transition path, and historical claim/provenance preservation.

## Integration notes

The backend boundary is intentionally mocked. No Source Registry, Lore Study Engine, Temporal State Graph authority, memory settlement, retrieval semantics, or other cognitive owner is implemented or redesigned in this lane. Future integrations should replace mock handlers with UI-facing contracts while preserving the same Action Router / SignalHub / Inspector interfaces.
