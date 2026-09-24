# UI.Core Wave 5 — Front Face

## Purpose

Wave 5 adds the human-facing Area-52 product layer without replacing Brain Inspector or creating a second UI runtime.

The Front Face uses the existing Workspace Registry, Inspector Registry, Widget Registry, Action Router, Signal Hub, Render Scheduler, ResourceScope cleanup, persistent UI state, responsive controller, and notification system.

## Product navigation

Primary product destinations are:

- Home
- Story / Scene
- Characters
- Lore
- Memory
- World
- Brain

Product workspaces declare `navigation.level = "product"`. Existing engineering workspaces remain registered as advanced workspaces and are exposed from the Brain gateway. If no product workspaces are registered, ApplicationShell retains the pre-Wave-5 navigation behavior.

## Home

Home presents lightweight product summaries only:

- current story and scene;
- Brain Status;
- world, memory, lore and background cognition summaries;
- Brain Activity;
- operator-relevant notifications;
- recent changes and PromptPlan presentation at deeper display levels;
- generic summary contributions from dynamically registered UI extensions.

Home does not load large backing collections.

## Authority

Front Face is observational. It does not settle claims, mutate memory, rewrite lore, promote lifecycle state, or write canonical world state. Inspection delegates to the existing Inspector Framework.

Deterministic product fixtures are marked as fixtures and do not imply backend integration.


## Phase 2 visual carry-forward

Wave 5 Front Face is the base product composition for Phase 2, not a separate visual skin.

Phase 2 surfaces inherit the canonical UI.Core visual language:

- deep navy/charcoal layered surfaces;
- cyan/blue primary interaction accents;
- teal/green healthy states, amber warnings and restrained red errors;
- rounded cards and compact pill/chip status controls;
- crisp high-contrast typography with muted secondary text;
- compact spacing suitable for coexistence beside an active SillyTavern chat;
- soft borders/glow used for hierarchy rather than decorative animation;
- shared widget-health treatments through canonical status values and `HealthPill`;
- shared button variants and sizes rather than workspace-specific controls.

Future slide-out/collapsed Front Face work should compose these same primitives at different densities. Expanded views must not introduce another design system.

Visible shell branding is configurable. Area-52 remains the current name; the planned post-Phase-2 Nexus rename is a product configuration change rather than a UI rewrite.


## Phase 2 Front Face target

Wave 5 remains the product-workspace foundation. Phase 2 should add a host-friendly presentation shell around it rather than replacing the workspace model.

### Quick Dash

Collapsed state is a narrow Area-52 rail/dock intended to remain visible while the operator reads and writes in SillyTavern.

Quick Dash content is intentionally bounded:

- brand/product identity;
- brain-health summary;
- current-scene summary;
- needs-attention indicator;
- cognitive-activity summary;
- expand/navigation affordance.

Detailed cards, histories, workers, PromptPlan allocations and diagnostics do not belong in the collapsed rail.

### Expanded workspace

Expanding the dock reveals the existing product destinations:

- Home;
- Story / Scene;
- Characters;
- Lore;
- Memory;
- World;
- Brain.

Expanded state uses the existing Workspace Registry and UI.Core components. Advanced evidence continues to use the Inspector Framework and canonical overlays/drawers.

### SillyTavern boundary

The Front Face does not own SillyTavern chat and should not reserve a fake chat column. It should slide/dock beside or over the host according to integration constraints while allowing the operator to collapse it quickly.

### Persistence

The following may persist as UI-only state:

- collapsed / expanded;
- selected workspace;
- panel width;
- compact / standard density;
- inspector visibility/width;
- filters and expansion state already allowed by UI.Core.

None of these become cognitive state.

## Phase 2 design references

Canonical design and planning references:

- `docs/UI_CORE_PHASE2_VISUAL_SYSTEM.md`
- `docs/UI_CORE_PHASE2_PROJECT_CARD_HANDOFF.md`
- #187 — Phase 2 UI.Core Design-System + Workspace Conformance Gate
