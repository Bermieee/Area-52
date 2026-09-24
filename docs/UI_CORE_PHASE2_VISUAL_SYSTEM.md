# UI.Core Phase 2 Visual System

**Owner branch:** `Development-UI`  
**Status:** canonical visual direction for Phase 2  
**Current product name:** Area-52  
**Planned post-Phase-2 product name:** Nexus

## Purpose

This document freezes the product-facing visual language selected for Phase 2.

UI.Core remains the only design system. Scene Intelligence, Character Memory, Lore, Memory hierarchy, Cognitive Activity, PromptPlan, diagnostics and future extensions must compose the same tokens and primitives rather than introducing subsystem-specific styling.

The target is a calm, compact cognitive control surface that remains readable beside an active SillyTavern chat.

## Visual character

- deep navy / charcoal layered surfaces;
- cool cyan / blue primary accents;
- teal / green for healthy, ready and settled-positive states;
- amber for warning, uncertainty and stale attention states;
- restrained red for blocked, contradicted and error states;
- rounded elevated cards with soft luminous borders;
- compact pill/chip status controls;
- crisp high-contrast typography;
- muted blue-gray secondary text;
- subtle depth and glow, not decorative animation.

## Design tokens

The canonical values live in `styles/ui-core.css`.

Token families include:

- spacing: `--a52-space-*`;
- radii: `--a52-radius-*` and `--a52-radius-pill`;
- layered surfaces: `--a52-surface-0..3` and `--a52-surface-elevated`;
- borders: `--a52-border`, `--a52-border-strong`, `--a52-border-soft`;
- typography colors: `--a52-text`, `--a52-text-strong`, `--a52-muted`, `--a52-subtle`;
- interaction accents: `--a52-accent`, `--a52-accent-strong`, `--a52-accent-soft`, `--a52-teal`;
- semantic status colors: success/canonical, observed, inferred, historical, unresolved, warning, stale and error;
- elevation: `--a52-shadow-sm`, `--a52-shadow`, `--a52-glow`;
- density: `--a52-control-height`, `--a52-panel-padding`, `--a52-panel-padding-compact`.

Do not copy raw colors into subsystem CSS when a UI.Core token expresses the intended role.

## Shape language

### Cards

Cards are rounded, lightly elevated, bordered surfaces. They should feel like related instruments in one console.

Use shared `.a52-card` treatment. Subsystems may arrange cards differently but should not redefine their own card chrome.

### Buttons

Shared buttons use consistent rounded geometry and support presentation variants:

- `secondary` — default;
- `primary` — deliberate main action;
- `quiet` — low-emphasis utility action;
- `danger` — destructive or high-risk action.

Supported density sizes begin with `md` and `sm`.

Variant styling is presentational only. Action authority still belongs to Action Router and the owning subsystem.

### Pills and badges

Pills are the canonical compact language for health, authority and state.

Use `Badge` for concise labels and `HealthPill` for readable widget/system health.

Status meaning must never rely on color alone; the visible label and accessible status text remain required.

## Widget health

Widget health should communicate meaning before diagnostics.

Examples:

- `ready`, `ACTIVE`, `COMPLETE`, `canonical`, `CURRENT`: healthy / positive;
- `observed`: direct observation;
- `loading`, `RECOVERING`: active transitional state;
- `warning`, `YIELDING`, `stale`, `STALE`, `UNRESOLVED`, `UNCERTAIN`: attention;
- `error`, `BLOCKED`, `CONTRADICTED`: failure/conflict;
- `inferred`: explicitly inferred;
- `historical`, `SUPERSEDED`, `PARKED`, `disabled`, `offline`: inactive/historical.

Health presentation does not create new cognitive state. It maps existing canonical statuses into the shared visual grammar.

## Typography

Use the UI.Core system sans stack. Do not ship a subsystem-specific font.

Hierarchy:

1. workspace/product title;
2. card title;
3. primary value/stat;
4. ordinary body text;
5. muted support text;
6. eyebrow/compact uppercase labels.

Dense dashboards should remain readable rather than maximizing information per pixel.

## Density

Compact presentation is first-class because the Front Face is expected to coexist with an active SillyTavern chat.

`.a52-density-compact` reduces panel/control density without changing semantic content or backend state.

A future collapsed/expanded Front Face should use the same components at different densities rather than separate CSS systems.

## Motion

Motion is supportive only:

- small hover/press transitions;
- no constant ambient animation;
- no pulsing wall of status indicators;
- no animation required to understand state;
- respect `prefers-reduced-motion`.

## Authority visualization

Knowledge authority remains explicit in text and structure.

Color may reinforce, but never replace, labels such as:

- SOURCE CANON;
- OBSERVED;
- SETTLED / CURRENT;
- INFERRED;
- UNRESOLVED / UNCERTAIN;
- HISTORICAL / SUPERSEDED;
- SHADOW / EXPERIMENTAL.

## Progressive disclosure

The visual system serves the existing three levels:

- **NORMAL:** what is happening;
- **DETAIL:** what changed, was found or was decided;
- **ADVANCED:** exact evidence, workers, revisions and machinery.

Raw JSON, prompts, model payloads and deep diagnostic metadata do not belong in permanent Level 1 surfaces.

## Brand readiness

Visible product branding is provided by the Application Shell through configurable `productName` and `productTagline`.

Default today:

- productName: `Area-52`;
- productTagline: `Cognitive Story System`.

The planned rename to Nexus should change visible configuration/content, not the cognitive contracts or design system.

The existing `a52-` CSS/implementation prefix may remain as an internal compatibility namespace after the public rename.

## Phase 2 conformance rule

A Phase 2 UI is conformant when it:

1. uses UI.Core tokens instead of a local palette;
2. uses shared cards, buttons, pills/badges and status language;
3. uses Workspace/Inspector/Action Router contracts;
4. supports compact presentation;
5. keeps authority accessible without color dependence;
6. introduces no parallel typography, shape, status or overlay system;
7. remains visually coherent with Home, Scene, Characters, Lore, Memory, World and Brain.
