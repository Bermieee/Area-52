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
