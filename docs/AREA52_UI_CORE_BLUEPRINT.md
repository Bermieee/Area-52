# Area-52 UI.Core Blueprint

**Owner branch:** Development-UI
**Integration branch:** Development-Nexus
**Epic:** #58

## Core rule

Subsystems expose state, events and typed actions. UI.Core owns presentation, rendering lifecycle, interaction routing, cleanup, layout and visual consistency.

No Area-52 subsystem owns root DOM architecture.

## Phase 2 visual direction

UI.Core is the visual authority for all Phase 2 product and cognitive surfaces.

The canonical visual language is a compact cognitive control surface: deep navy/charcoal layered surfaces, cool cyan/blue primary accents, teal/green healthy states, amber warnings, restrained red failures, rounded elevated cards, compact pill/chip status language, crisp high-contrast typography, and soft luminous borders rather than heavy chrome.

Subsystems must consume these shared tokens and primitives instead of inventing local palettes, radii, button shapes, status indicators, card treatments, or typography systems.

The design must remain readable beside an active host chat. Compact density is a first-class presentation mode; deeper information belongs behind workspace expansion and the Inspector Framework.

Visible branding is configurable at the shell boundary. The current product name is Area-52, but product surfaces must remain ready for the planned post-Phase-2 Nexus rename without changing cognitive or UI.Core contracts. The existing `a52-` implementation namespace is an internal compatibility namespace, not a visible branding requirement.

Canonical Phase 2 UI planning references:

- `docs/UI_CORE_PHASE2_VISUAL_SYSTEM.md` — visual language, Front Face composition, widget health, density and brand readiness;
- `docs/UI_CORE_WAVE_5_FRONT_FACE.md` — product workspace foundation and Quick Dash / Expanded Front Face target;
- `docs/UI_CORE_PHASE2_PROJECT_CARD_HANDOFF.md` — card-ready implementation breakdown and existing-card mapping.

Phase 2 project cards should be cut from that handoff under #187 rather than inventing subsystem-local UI requirements.

## Runtime layers

- Design System: tokens, typography, spacing, themes, status language, responsive modes and compact-density treatment.
- Widget Runtime: lifecycle contract, registry, mount/update/destroy, subscriptions, cleanup.
- Structural Runtime: application shell, workspace registry, inspector, overlays, persistent UI state.
- Interaction Runtime: typed action router, permission/state validation, accessibility and keyboard behavior.
- Rendering Runtime: lightweight signals, frame coalescing, virtualization, lazy expensive details.
- Widget Library: primitives, structural widgets and cognitive widgets.

## Default shell

Desktop defaults to left navigation, center workspace, right contextual inspector, and a lightweight bottom runtime strip.
Responsive modes are WIDE, COMPACT and STACKED.

## Widget lifecycle

Every widget follows one lifecycle: register -> mount -> subscribe -> update/diff -> resize/show/hide -> destroy -> unsubscribe/cleanup.

Widgets declare widgetId, version, category, props/schema, supported actions, subscriptions, permissions and renderCostClass.
Render cost classes are CHEAP, NORMAL and EXPENSIVE.

## Canonical status vocabulary

General: loading, ready, empty, stale, warning, error, disabled, offline.
Runtime: ACTIVE, YIELDING, PARKED, BLOCKED, RECOVERING, COMPLETE, STALE.
Knowledge: canonical, observed, inferred, historical, superseded, contradicted, uncertain, unresolved.

## Primitive and structural widget set

Primitives: Button, IconButton, Badge, HealthPill, StatusDot, TextField, SearchField, Select, Toggle, Slider.
Information: Card, StatCard, KeyValue, ProgressBar, ProgressRing, Timeline, DataTable, VirtualList.
Containers: Panel, Section, Tabs, Accordion, SplitPane, Drawer, Modal.
Feedback: Toast, Banner, LoadingState, EmptyState, ErrorState.

## Canonical cognitive widgets

BrainStatus, WorkerPool, LifecycleLane, BatchProgress, SourceCard, ClaimCard, TemporalStateCard, ReflectionCard, ProvenanceChain, CandidateCard, TruthDecision, RerankResult, ContextPacketViewer, GraphExplorer and ShadowComparison.

## Inspector

Inspectable objects include source, claim, reflection, worker, task, batch, candidate, graph node/edge, context packet and evaluation result.
Global inspector actions include provenance, history, source, dependencies and worker/task inspection.

## Action routing

Widgets never directly call subsystem mutation methods.
UI action -> Action Router -> target/state/permission validation -> owning subsystem handler -> typed result.

## Signal-first rendering

UI.Core consumes lightweight signals such as WORKER_STATE_CHANGED, BATCH_PROGRESS_CHANGED, QUEUE_COUNT_CHANGED, COGNITIVE_MODE_CHANGED, CLAIM_STATE_CHANGED and REFLECTION_CHANGED.
Detailed snapshots are explicit and on-demand.

## Large collections

Large lorebooks, claims, candidates, events, workers, reflections and graph results use shared virtualized list/table/tree primitives.

## UI persistence

Presentation-only state may persist: workspace/view, panel dimensions, expansion state, filters/sorts and developer-detail toggles.
UI persistence never becomes canonical brain state.

## Accessibility

Keyboard navigation, semantic roles/labels, focus order/rings, reduced motion, contrast compliance, modal focus trapping and screen-reader-friendly status text are part of the base contract.

## Work items

#58 UI.Core epic; #59 design tokens; #60 widget lifecycle; #61 registry; #62 shell; #63 workspace registry; #64 inspector; #65 action router; #66 signal layer; #67 render scheduler; #68 virtualization; #69 overlay manager; #70 notifications; #71 accessibility; #72 persistent UI state; #73 primitive library; #74 cognitive widgets; #34 Brain Inspector.

## Exit criteria

UI.Core is ready when the shell/workspace/inspector contracts exist, widget cleanup is tested, action routing protects subsystem authority, signal-driven rendering is coalesced, primitives require no subsystem CSS, large collections virtualize, cognitive widgets run on mock contracts, responsive/accessibility behavior is default, and a subsystem can register UI without modifying UI.Core internals.