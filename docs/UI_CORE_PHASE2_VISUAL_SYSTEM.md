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

Widget health is a Phase 2 foundation concern, not a per-workspace decoration.

A widget should answer, in order:

1. is this surface available and trustworthy enough to use?
2. is it healthy, working, degraded, stale or blocked?
3. what does that state affect?
4. what deliberate inspection/action is available?

Normal UI should summarize health. Diagnostic causes such as provider errors, worker IDs, correlation IDs and raw failures belong behind inspection unless they directly require operator action.

Health should communicate meaning before diagnostics.

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

## Front Face composition

The Phase 2 Front Face is a slide-out Area-52 surface that coexists with SillyTavern rather than replacing or reproducing SillyTavern chat.

It has two operator-controlled presentation states:

### Quick Dash / collapsed

A narrow dock/rail remains available beside the host chat. It should expose only high-value glanceable state:

- product mark/name;
- current overall brain health;
- current scene identity/state;
- needs-attention count;
- compact cognitive-activity indication;
- navigation/expand affordance.

The Quick Dash must not become a miniature dashboard full of unreadable metrics.

### Expanded

The same dock expands into the Area-52 product workspace. It may expose Home, Story/Scene, Characters, Lore, Memory, World and Brain while the host chat remains outside Area-52 and continues to be usable.

Expanded mode reuses the same UI.Core cards, pills, buttons, workspace registry and inspector contracts. It is not a second UI implementation.

### Host coexistence rule

Area-52 does not capture, clone or visually reproduce SillyTavern chat inside the Front Face. The host application owns chat presentation. Area-52 owns its cognitive product surface.

Collapse/expand state, selected workspace, panel size and presentation density are presentation-only state and may persist through UIStateStore.

## Density

Compact presentation is first-class because the Front Face is expected to coexist with an active SillyTavern chat.

`.a52-density-compact` reduces panel/control density without changing semantic content or backend state.

Collapsed and expanded Front Face states use the same components at different densities rather than separate CSS systems.

### Readability floor

Compact does not mean microscopic. Phase 2 work must preserve:

- readable body and status text;
- visible authority labels;
- keyboard/focus affordances;
- distinguishable widget boundaries;
- sensible truncation with inspector access to full detail.

If information cannot remain readable in Quick Dash, it belongs in Expanded or Inspector rather than being compressed further.

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


## Workspace composition pattern

Phase 2 workspaces should normally follow one of three shared compositions:

1. **Compact/operator-first** — one dominant state, a few secondary summaries, attention and meaningful activity.
2. **Dashboard/workspace** — primary object plus supporting state, history/activity and workflow/attention.
3. **Inspector-heavy** — collection/timeline, selected object/workflow and contextual Inspector.

The dashboard/workspace form is the default for expanded product workspaces. Inspector-heavy composition is deliberate Advanced/authoring/forensic territory.

## Planning handoff

Card-ready Phase 2 UI work is defined in `docs/UI_CORE_PHASE2_PROJECT_CARD_HANDOFF.md`. That handoff must be used with #187 so new cards extend existing subsystem issues rather than duplicating backend architecture.

# Wave 6 Addendum — Health, Authority, and Host Density

Wave 6 applies the accepted visual system to the host-adjacent product interface.

## Health presentation

Health is encoded with text, status structure and restrained color:

- READY — teal/green;
- WORKING — cyan/blue;
- DEGRADED / STALE — amber;
- BLOCKED — restrained red;
- UNAVAILABLE — muted/recessed;
- IDLE — historical/recessed.

A health surface should answer:

1. is the capability available?
2. what is its current health?
3. what does that affect?
4. what can the operator inspect?

NORMAL surfaces describe impact first. Provider, worker, task, queue and correlation detail remain Advanced.

## Authority presentation

Authority is never color-only.

Wave 6 uses both glyph and border grammar:

- SOURCE CANON / SETTLED / CURRENT — solid;
- OBSERVED — solid neutral/blue;
- INFERRED — dotted;
- UNRESOLVED / UNCERTAIN — divided/double treatment;
- HISTORICAL / SUPERSEDED — dashed/recessed;
- SHADOW / EXPERIMENTAL — explicitly non-authoritative glyph/label.

Confidence and retrieval rank do not alter authority styling.

## Host density

The collapsed Quick Dash is intentionally narrow and low-information.

Expanded mode preserves compact card geometry, rounded corners, cyan/teal accents, crisp high-contrast text and muted support copy. It does not introduce a second typography system or subsystem-specific palette.

Reduced-motion behavior is preserved.

# Wave 8 Addendum — Cognitive Path Visual Grammar

Wave 8 uses the existing UI.Core visual language.

Pipeline stage state is encoded with text, glyph and structure:

- COMPLETE — check / healthy solid edge;
- ACTIVE — active marker / cyan accent;
- SKIPPED — dash / dashed edge;
- DEFERRED — forward marker / dotted edge;
- UNAVAILABLE — hollow/recessed;
- DEGRADED / STALE — amber structured warning;
- INVALID / FAILED — restrained red + double/failure edge.

Status never relies on color alone.

NORMAL remains meaning-first and does not lead with worker IDs, provider IDs, model IDs, queue depth, or raw scores.

DETAIL explains cognition mechanics.

ADVANCED exposes exact identities, revisions, resource/provider data, candidate metadata, diagnostic references and forensic cross-links.

Jev confidence and retrieval/Precision score use neutral metadata styling rather than authority styling.
