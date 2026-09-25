# UI.Core Phase 2 — Project Card Handoff

**Owner lane:** `Development-UI`  
**Planning gate:** #187 — Phase 2 UI.Core Design-System + Workspace Conformance Gate  
**Phase 2 program:** #156 / #157  
**Current product name:** Area-52  
**Planned post-Phase-2 product name:** Nexus  
**Purpose:** convert the accepted UI direction into project-card-ready implementation work without duplicating existing subsystem architecture cards.

---

## 1. Decisions already locked

The following are no longer open design questions for Phase 2 planning:

- UI.Core remains the only presentation/runtime architecture.
- New Phase 2 surfaces use the UI.Core token, primitive, workspace, inspector, action, signal, render, overlay, notification, accessibility and persistence systems.
- The canonical visual style is defined by `docs/UI_CORE_PHASE2_VISUAL_SYSTEM.md`.
- The product should look like a compact cognitive control surface:
  - deep navy/charcoal layered surfaces;
  - cyan/blue interaction accents;
  - teal/green healthy states;
  - amber warning/uncertainty states;
  - restrained red failure/conflict states;
  - rounded elevated widgets;
  - compact status pills;
  - crisp high-contrast typography;
  - soft luminous borders rather than decorative animation.
- The Front Face must coexist with SillyTavern chat.
- Area-52 does not own, reproduce or embed a fake SillyTavern chat column.
- The Front Face has a narrow **Quick Dash** collapsed state and an **Expanded** product-workspace state.
- Compact presentation is first-class, but readability takes priority over density.
- Widget health is a shared UI.Core concern.
- Progressive disclosure remains:
  - NORMAL — what is happening;
  - DETAIL — what changed/found/decided;
  - ADVANCED — exact evidence, revisions, workers and machinery.
- Visible branding is configurable so Area-52 can become Nexus after Phase 2 without a UI rewrite.
- Existing `a52-` implementation names may remain internal compatibility identifiers after the public rename.

---

## 2. Existing cards that must not be duplicated

These cards already own the underlying feature/system intent. New UI cards should reference them rather than recreate their backend scope.

| Existing card | Existing authority |
|---|---|
| #58–#74 | UI.Core platform, primitives, shell, registry, inspector, actions, signals, rendering, virtualization, overlays, notifications, accessibility, persistence |
| #116 | Phase 1 Scene Intelligence UI workspace foundation |
| #145 | PromptPlan + Adaptive Context Runtime inspector |
| #152 | Cognitive Transaction Ledger + forensic timeline inspector |
| #168 | Phase 2 Authoring/Lorebook/Continuity umbrella |
| #169 | Lore merge/dedup/reconciliation |
| #170 | Lore summarization / Lean-Balanced-Heavy representations |
| #171 | Keyword generation + trigger diagnostics |
| #173 | Advanced Scene Intelligence authoring/scanner utilities |
| #174 | Character Card Memory Banks + layered personal memory |
| #175 | Hierarchical story/arc/scene summary logic |
| #176 | Lore maintenance / QA / batch repair |
| #187 | Phase 2 UI.Core conformance gate |
| #33 / #86 | runtime/coprocessor telemetry feeding operator-visible activity |

Cards below are therefore UI implementation/planning units, not replacements for those system cards.

---

# 3. New project cards recommended

## CARD UI-P2-01 — Front Face Dock: Quick Dash + Expanded Workspace

**Type:** new UI.Core implementation card  
**Owner:** Development-UI  
**Related:** #62, #63, #72, #187  
**Depends on:** existing Wave 5 Front Face and accepted UI.Core shell

### Purpose

Create the host-friendly Area-52 Front Face presentation model used beside SillyTavern.

### Scope

Implement two operator-controlled states using the same UI.Core components:

**Quick Dash / collapsed**
- narrow dock/rail;
- product identity;
- brain-health summary;
- current-scene summary;
- needs-attention indicator;
- compact cognitive-activity state;
- expand/navigation affordance.

**Expanded**
- Home;
- Story / Scene;
- Characters;
- Lore;
- Memory;
- World;
- Brain;
- existing Inspector integration.

### Rules

- do not render or clone SillyTavern chat;
- do not introduce a second shell/runtime;
- Quick Dash must remain readable;
- detailed metrics do not get squeezed into collapsed mode;
- collapse/expand is presentation state only;
- host chat must remain usable while the dock is present;
- same design language in both states.

### Persistence

Persist presentation-only:
- collapsed/expanded;
- selected workspace;
- panel width;
- density;
- inspector visibility/width.

### Acceptance

- user can collapse to a narrow useful rail while chatting;
- user can expand into the full Area-52 Front Face;
- no fake/duplicate chat column exists;
- keyboard navigation works in both states;
- expansion/collapse leaves cognitive state untouched;
- UI.Core lifecycle cleanup remains green;
- responsive behavior degrades cleanly when host width is constrained.

---

## CARD UI-P2-02 — Widget Health Grammar + Health Surface Adoption

**Type:** new UI.Core foundation card  
**Owner:** Development-UI  
**Related:** #33, #70, #74, #86, #187

### Purpose

Make cognitive/widget health understandable without forcing operators into diagnostics.

### Scope

Standardize presentation for:
- healthy/ready;
- active/working;
- recovering;
- warning/uncertain;
- stale;
- degraded;
- blocked/error;
- parked/inactive;
- inferred;
- historical.

Use existing canonical backend statuses; do not invent parallel cognitive states.

### UI behavior

Normal view should answer:
1. is this available?
2. is it healthy/working/degraded/stale/blocked?
3. what is affected?
4. what can the user inspect/do?

Advanced inspection may reveal:
- worker/provider/model;
- correlation IDs;
- raw failure cause;
- retries/fallback path;
- exact diagnostic payload.

### Required primitives

Build on:
- `HealthPill`;
- `Badge`;
- `StatusDot`;
- `StateMessage`;
- Notification Center;
- Inspector Framework.

### Acceptance

- color is never the only health signal;
- all health states have readable text;
- degraded-but-contained states do not look equivalent to hard failure;
- routine active work does not spam notifications;
- health state can be used consistently by Scene, Memory, Lore, Brain and PromptPlan surfaces;
- reduced-motion and screen-reader behavior pass.

---

## CARD UI-P2-03 — Phase 2 Workspace Composition Kit

**Type:** new shared UI.Core card  
**Owner:** Development-UI  
**Related:** #73, #74, #187

### Purpose

Prevent every Phase 2 worker from independently composing cards, toolbars and inspector layouts.

### Establish three reusable composition patterns

**Compact/operator-first**
- dominant state;
- 2–4 summaries;
- needs attention;
- meaningful activity.

**Dashboard/workspace**
- primary object;
- supporting state;
- history/activity;
- workflow/attention.

**Inspector-heavy**
- collection/timeline;
- selected object/workflow;
- Inspector.

### Scope

Define reusable composition conventions for:
- headers;
- action placement;
- status/health placement;
- authority badges;
- card grouping;
- empty/loading/degraded states;
- toolbars;
- compact density;
- inspector handoff;
- destructive workflow preview/approval.

### Acceptance

- Scene, Character, Lore, Memory, Brain, PromptPlan and Forensics can use shared patterns without subsystem-specific layout frameworks;
- no new root shell;
- no duplicate modal/drawer implementation;
- patterns remain responsive in WIDE / COMPACT / STACKED.

---

## CARD UI-P2-04 — Authority + Provenance Visual Grammar

**Type:** new UI.Core foundation card  
**Owner:** Development-UI  
**Related:** #3, #37, #47, #64, #74, #187

### Purpose

Make it immediately clear whether Area-52 knows, observed, settled, inferred, historically knew, or has not resolved something.

### Required authority labels

- SOURCE CANON;
- OBSERVED;
- SETTLED / CURRENT;
- INFERRED;
- UNRESOLVED / UNCERTAIN;
- HISTORICAL / SUPERSEDED;
- SHADOW / EXPERIMENTAL.

### Rules

- never rely only on color;
- labels/icons/card treatment must remain accessible;
- confidence must not be presented as authority;
- unresolved should visually preserve competing alternatives;
- inferred state must never visually masquerade as settled truth.

### Reuse

- shared badges;
- knowledge action bar;
- Source / Provenance / History / Dependencies / Settlement / Evidence actions;
- TemporalStateCard;
- ReflectionCard;
- ProvenanceChain.

### Acceptance

A user can distinguish source truth, observation, settled state, inference, unresolved conflict and history without opening raw diagnostics.

---

## CARD UI-P2-05 — Brain Pulse / Cognitive Activity Front Face

**Type:** new product UI card  
**Owner:** Development-UI  
**Related:** #33, #75–#96, #86, #187  
**Data dependency:** telemetry must expose required lightweight signals

### Purpose

Give normal users the answer: “the brain is doing something useful.”

### Normal

Show:
- overall brain health;
- current cognitive focus;
- foreground status;
- background status;
- meaningful coalesced activity;
- needs attention;
- next background work when useful.

### Detail

May add:
- HOT / DEEP;
- REQUIRED / OPPORTUNISTIC / DEFERRED;
- capability-group counts;
- background completion;
- contained late/fallback events;
- result destination.

### Advanced

Inspector may expose:
- physical worker;
- provider/model;
- batch;
- queue;
- timing/deadline;
- correlation;
- stale/rejected/fallback details.

### Rule

Capability/task meaning appears before provider/worker identity.

### Acceptance

- high-frequency worker signals coalesce into low-noise product activity;
- normal UI does not become a worker-wall dashboard;
- fallback/degraded states explain impact;
- raw telemetry remains on-demand.

---

# 4. UI child cards to create under existing Phase 2 feature cards

## CARD UI-P2-SCENE — Scene Board + Scene Studio

**Parent/reference:** #173  
**Foundation:** #116  
**Owner:** Development-UI + Scene Intelligence data owner

### Normal Scene Board

- location;
- narrative time;
- active cast;
- immediate objects;
- atmosphere with authority;
- active threads;
- recent change;
- scene stability/boundary state;
- continuity warning summary.

### Detail

- field authority;
- boundary confidence;
- supporting/contradictory evidence counts;
- spatial/temporal interpretation;
- unresolved observations;
- episode relation.

### Advanced Scene Studio

- scene history;
- current vs prior scan comparison;
- Scene Stack/flashback/parallel/resume visualization;
- rescan;
- operator correction;
- merge/split;
- episode repair;
- continuity warning inspection;
- promotion/extraction previews routed through proper authority.

### Acceptance

Scanner observation never visually becomes world truth merely because the scan changed.

---

## CARD UI-P2-CHAR — Character Workspace: Truth vs Perspective

**Parent/reference:** #174  
**Related:** #78  
**Owner:** Development-UI + Memory/Character owners

### Required visual layers

- Source Identity;
- Current State;
- Relationships;
- Personal Memory;
- Beliefs / Knowledge;
- Secrets / Knowledge Fences;
- Green Room;
- Historical / Superseded.

### Key interaction

Perspective Lens:
- WORLD TRUTH;
- PERSONAL MEMORY;
- BELIEF;
- KNOWLEDGE FENCE.

### Rules

- character memory is not world truth;
- belief may be false;
- Green Room is visibly temporary/inferred;
- private knowledge must not visually blur with omniscient knowledge.

### Acceptance

An operator can tell what is true about a character, what they remember, what they believe, and what they cannot know.

---

## CARD UI-P2-LORE — Lore Studio Workspace Shell

**Parent/reference:** #168  
**Children/data:** #169, #170, #171, #176  
**Owner:** Development-UI + Lorebook owner

### Workspace

Stable Lore Tree/browser at left with center workflow and contextual Inspector.

### Modes

- Browse / Author;
- Merge / Reconcile;
- Representations;
- Keywords;
- Maintenance / QA;
- History.

### Rules

- Lore Tree remains first-class;
- utilities operate on the same source material rather than becoming separate mini-apps;
- destructive workflows remain proposal-first;
- exact source and provenance stay recoverable.

### Acceptance

All four Phase 2 lore utilities compose as one Lore Studio without separate visual systems.

---

## CARD UI-P2-LORE-MERGE — Merge / Reconcile Review

**Parent/reference:** #169  
**Recommended child of Lore Studio**

### Required buckets

- shared;
- unique to A;
- unique to B;
- conflicting / unresolved.

### Flow

proposal -> inspect/edit -> validate -> approve -> Settlement.

### Advanced

- exact diff;
- provenance;
- semantic overlap;
- source revisions;
- reconstruction/rollback path.

### Acceptance

No semantic similarity display implies source deletion authority.

---

## CARD UI-P2-LORE-REP — Representation Ladder

**Parent/reference:** #170

Show Exact Source / Heavy / Balanced / Lean as derived resolutions, not competing canon.

Required:
- token/character size;
- source revision;
- compression ratio;
- fact/texture/relationship/temporal retention checks;
- hard-cap compliance;
- stale/regeneration state.

Acceptance: derived summary is always visibly derived from recoverable source.

---

## CARD UI-P2-LORE-KEY — Keyword Lab

**Parent/reference:** #171

Required:
- keyword suggestion table;
- collision risk;
- broad-key warning;
- representative trigger simulation;
- intended activation;
- unrelated activation;
- missed retrieval;
- precision/recall estimate when supported;
- operator approval/editing.

Acceptance: UI optimizes discriminative retrieval rather than rewarding maximum trigger count.

---

## CARD UI-P2-LORE-QA — Lore Maintenance / Batch Repair

**Parent/reference:** #176

Required issue table:
- duplicate;
- near duplicate;
- broad key;
- orphan;
- broken reference;
- stale representation;
- oversized entry;
- temporal conflict;
- weak provenance;
- dead retrieval form;
- alias inconsistency.

Batch action must create reviewable proposals, not direct silent mutation.

---

## CARD UI-P2-MEMORY — Story Memory Atlas

**Parent/reference:** #175  
**Owner:** Development-UI + Memory owner

### Hierarchy

raw turn -> scene -> episode -> chapter/session -> arc -> story.

### Requirements

- breadcrumb drill-down;
- source ranges;
- revision/provenance;
- derived-summary labels;
- unresolved contradictions;
- stale/regeneration state;
- ability to return to raw evidence.

### Acceptance

Higher-level summaries never visually become source truth.

---

# 5. Existing cards that should be refined, not replaced

## #145 — PromptPlan + Adaptive Context Runtime inspector

Use the UI concept **Context Delivery**.

### Normal

- planned/final estimated prompt size;
- budget usage;
- high-level allocations;
- reused vs updated;
- deferred/dropped count;
- Context Seal state.

### Detail

Segment table:
- section;
- token allocation;
- REUSED / REBUILT / DEFERRED / DROPPED;
- reason;
- model profile;
- cache eligibility.

### Advanced

- exact segment identity;
- revisions/reuse keys;
- ordering;
- integrity receipt;
- fallback;
- raw rendered prompt only as explicit inspection.

### Add concept

**Context Receipt** for completed generations:
- size;
- reuse ratio;
- primary segments;
- required omissions;
- optional late results;
- seal validity.

---

## #152 — Cognitive Transaction Ledger + forensic timeline inspector

Use two entry modes:

### Contextual Why?

From an inspectable object:
- Why unresolved?
- Why omitted?
- Why fallback?
- Why historical?
- Why scene split?

### Full Forensics

Meaningful pipeline:
source -> cognition -> proposal -> validation -> Settlement -> Context -> generation.

Keep two distinct lanes when needed:
- Runtime Work Ledger;
- Cognitive Transaction Ledger.

Do not create a permanent raw log console.

---

## #187 — UI.Core conformance gate

Update/interpret #187 as the mandatory gate for every card above.

Each Phase 2 UI card should confirm:

- shared UI.Core tokens;
- shared shape/typography language;
- HealthPill/status grammar where relevant;
- compact mode;
- authority labels where knowledge appears;
- Action Router for mutations;
- Inspector for deep detail;
- Render Scheduler/signal-first updates;
- virtualization for large collections;
- Overlay Manager for dialogs/drawers;
- accessibility/keyboard behavior;
- presentation-only persistence;
- no subsystem root DOM or parallel design system.

---

# 6. Recommended card creation order

Do not start by building every Phase 2 workspace independently.

Recommended order:

1. **UI-P2-01 Front Face Dock**
2. **UI-P2-02 Widget Health**
3. **UI-P2-04 Authority + Provenance Grammar**
4. **UI-P2-03 Workspace Composition Kit**
5. **UI-P2-05 Brain Pulse**
6. **UI-P2-SCENE Scene Board / Studio**
7. **UI-P2-CHAR Character Workspace**
8. **UI-P2-LORE Lore Studio shell**
9. Lore utility child surfaces as their backend contracts are ready
10. **UI-P2-MEMORY Story Memory Atlas**
11. Refine/implement **#145 Context Delivery**
12. Refine/implement **#152 Forensics**

The Phase 1/Phase 2 evidence gate (#157) remains authoritative over actual promotion timing.

---

# 7. Cross-cutting acceptance card recommended

## CARD UI-P2-X — Compact Host-Coexistence + Visual Conformance Acceptance

**Type:** new UI acceptance/evaluation card  
**Owner:** Development-UI  
**Related:** #71, #187

### Purpose

Prove the complete Phase 2 interface remains usable as a SillyTavern-adjacent control surface.

### Test matrix

- Front Face collapsed;
- Front Face expanded;
- inspector open/closed;
- WIDE;
- COMPACT;
- STACKED;
- keyboard-only;
- reduced motion;
- screen-reader status text;
- long labels;
- high card counts;
- warning/error/degraded states;
- stale/inferred/historical/unresolved authority states;
- light-theme compatibility even if dark remains the primary product presentation.

### Acceptance

- host chat remains practically usable;
- no mandatory text becomes unreadably small;
- no authority state depends only on color;
- no status storms cause render churn;
- large collections remain virtualized;
- no overlay traps/leaks focus;
- lifecycle cleanup tests remain green;
- every Phase 2 surface visibly belongs to one product.

---

# 8. Definition of Done for any Phase 2 UI card

A card is not UI-complete merely because the happy-path screenshot looks correct.

Every UI card should include:

- NORMAL / DETAIL / ADVANCED behavior where applicable;
- loading / empty / stale / warning / error / disabled/offline behavior where applicable;
- authority treatment for knowledge-bearing content;
- keyboard and focus behavior;
- reduced-motion compliance;
- compact behavior;
- Inspector path for deep detail;
- Action Router path for mutations;
- signal/render scheduling behavior;
- cleanup/destroy coverage;
- persistence limited to presentation state;
- no raw JSON-first normal UI;
- no provider/model-first normal UI unless that is the object being intentionally inspected;
- conformance against #187 and `docs/UI_CORE_PHASE2_VISUAL_SYSTEM.md`.

---

# 9. Planning summary for project-board creation

### Create as new UI cards

- Front Face Dock — Quick Dash + Expanded Workspace
- Widget Health Grammar + Adoption
- Phase 2 Workspace Composition Kit
- Authority + Provenance Visual Grammar
- Brain Pulse / Cognitive Activity
- Scene Board + Scene Studio UI child
- Character Truth-vs-Perspective UI child
- Lore Studio Workspace Shell
- Lore Merge/Reconcile UI child
- Lore Representation Ladder UI child
- Lore Keyword Lab UI child
- Lore Maintenance/Batch Repair UI child
- Story Memory Atlas UI child
- Compact Host-Coexistence + Visual Conformance Acceptance

### Refine existing cards instead of duplicating

- #145 PromptPlan / Context Delivery
- #152 Forensics
- #187 UI.Core Conformance Gate

### Do not create separate cards for

- a new Phase 2 design system;
- a second shell;
- a separate Sidecar UI framework;
- a separate Scene UI framework;
- a fake SillyTavern chat pane;
- a provider/model dashboard as the default Brain UI;
- a permanent debug console.

---

## Canonical documents

- `docs/AREA52_UI_CORE_BLUEPRINT.md`
- `docs/UI_CORE_PHASE2_VISUAL_SYSTEM.md`
- `docs/UI_CORE_WAVE_5_FRONT_FACE.md`
- this handoff: `docs/UI_CORE_PHASE2_PROJECT_CARD_HANDOFF.md`

This handoff is planning material. It does not itself promote Phase 2 candidates past #157 or grant UI authority over cognitive state.
