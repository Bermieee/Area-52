# UI.Core Wave 6 Acceptance

## Acceptance posture

Wave 6 is a real UI architecture and production-wiring wave.

Acceptance is based on product behavior, typed adapter seams, lifecycle cleanup and regression evidence. A screenshot or fixture-only demo is not sufficient.

## Implemented surfaces

- host-adjacent Quick Dash;
- Expanded Front Face using the existing ApplicationShell;
- Home operator summary;
- live Scene read-model projection;
- honest Characters/Lore/Memory/World unavailable states when producers are absent;
- Brain Pulse;
- PromptPlan / Context Delivery projection;
- Context Receipt projection where explicitly supplied;
- Advanced forensic entry point;
- shared health grammar;
- shared authority/provenance grammar;
- shared composition patterns;
- configurable branding;
- explicit fixture/production separation.

## Deterministic acceptance

Wave 6 focused suite covers:

- source-mode separation;
- fixture cannot report LIVE;
- health mapping;
- authority semantics independent of confidence;
- SceneUiReadModel consumption;
- Scene degraded/unsupported states;
- Runtime and Coprocessor telemetry adapters;
- PromptPlan / seal / Context Receipt contracts;
- Forensic read model;
- missing producer behavior;
- presentation persistence;
- 1,000 collapse/expand cycles;
- host-width reserve/release;
- shared product workspace registry;
- same-shell collapsed/expanded behavior;
- no fake chat surface;
- Quick Dash listener replacement;
- Brain Pulse coalescing;
- lifecycle cleanup;
- source health semantics;
- disabled unavailable Action Router paths;
- Normal/Detail/Advanced PromptPlan disclosure;
- forensic virtualization;
- WIDE/COMPACT/STACKED;
- browser-source safety;
- Buffer-unavailable execution;
- accessible status text;
- configurable Nexus branding;
- 500 workspace switches;
- 500 Inspector select/clear cycles.

## Focused stress evidence

The Wave 6 stress harness exercises:

- 5,000 UI signal transitions;
- 2,000 Brain Pulse updates;
- 1,000 collapse/expand cycles;
- 500 workspace switches;
- 500 Inspector cycles;
- 250 responsive transitions;
- a logical 100,000-row collection.

Measured invariants:

- Quick Dash scheduler jobs after 5,000-signal burst: 1;
- Brain Pulse scheduler jobs after 2,000 updates: 1;
- Brain Pulse pending keys: 64;
- Brain Pulse render flushes: 1;
- Brain Pulse retained activity: 20;
- Inspector scheduler pending after 500 cycles: 2 keyed jobs;
- virtual mounted window: 22 rows;
- live listener snapshot: workspace 1 / Inspector 1 / wildcard 1;
- post-destroy listener counts: 0 / 0 / 0;
- root children after destroy: 0;
- presentation state restored after remount: true.

## Accessibility

Wave 6 preserves UI.Core accessibility and adds:

- semantic role=status for health/authority surfaces;
- text + glyph + structural authority encoding;
- keyboard-compatible Action Router buttons;
- no unavailable action that appears successful;
- reduced-motion CSS;
- responsive stack behavior.

## Browser safety

Acceptance requires:

- JavaScript syntax pass;
- browser-source guard pass;
- Wave 6 execution with Buffer unavailable;
- UI.Core ESM import pass;
- clean mount/unmount in the synthetic browser host.

## Card decisions

### #196 Front Face Dock

Implementation satisfies the UI-owned requirements. Candidate for close after exact-final CI.

### #197 Widget Health Grammar

Canonical health/source-mode grammar and health surface adoption are implemented. Candidate for close after exact-final CI.

### #198 Workspace Composition Kit

Compact/Dashboard/Inspector-heavy composition contracts are reusable and adopted. Candidate for close after exact-final CI.

### #199 Authority + Provenance Grammar

Shared authority visual grammar and disabled-unavailable provenance actions are implemented. Candidate for close after exact-final CI.

### #200 Brain Pulse

Product-facing Brain Pulse with coalesced Runtime/Coprocessor activity is implemented. Candidate for close after exact-final CI.

### #145 PromptPlan / Adaptive Context inspector

Remain OPEN at worker acceptance unless assembled Core binds the real PromptPlan/Seal readers. UI consumer contract is ready; UI does not claim the producer binding.

### #152 Cognitive Transaction Ledger / forensics

Remain OPEN at worker acceptance unless assembled Core binds real ledger/forensic readers. UI consumer/virtualized Advanced surface is ready.

### #33 / #86

Remain shared. Wave 6 consumes accepted telemetry shapes but does not own Runtime/Coprocessor producer completion.

### #187

Remain OPEN as the broad Phase 2 UI conformance gate until its full project-level acceptance is satisfied.

## Explicit non-work

Wave 6 did not implement:

- Scene backend;
- Memory backend;
- Lore Study;
- Context Compiler;
- Runtime scheduler;
- Coprocessor execution;
- Settlement;
- provider routing;
- FT002/FT005/FT006 expansion;
- a second UI framework.
