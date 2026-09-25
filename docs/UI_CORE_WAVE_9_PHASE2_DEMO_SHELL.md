# UI.Core Wave 9 — Phase-2 Reviewable Demo Shell

## Purpose

Wave 9 turns the accepted Wave 8 Brain workspace into a repeatable product-review surface before the full live #224 assembly exists. It is deliberately a host around UI.Core, not a second UI runtime.

The shell exists so the director can open one deterministic product surface, click through every primary workspace, inspect Normal/Detail/Advanced disclosure, compare dock widths and host layouts, switch cognitive scenarios, open the shared Inspector, and capture stable screenshots.

## Relationship to project cards

- **#187** remains the visual/design-system conformance gate. Wave 9 uses its canonical visual and accessibility grammar.
- **#196** Front Face Dock remains the accepted host-adjacent foundation.
- **#226** remains accepted Wave 8 cognition UI and is preserved inside Brain.
- **#145** Context Delivery remains an existing production surface reached through Brain/advanced navigation.
- **#152** Cognitive Forensics remains the existing forensic surface reached through contextual Why? and Brain/Advanced.
- **#224** remains OPEN. Wave 9 supplies the product shell that the live Brain demo will inhabit; fixture review does not satisfy the live gate.

## Architecture

The shell calls `createWave6ProductInterface()` and reuses the existing WorkspaceRegistry, InspectorController, ActionRouter, SignalHub, RenderScheduler, OverlayManager, persistence, virtualization and design tokens. Review workspaces update existing product workspace registrations; they do not create another registry or shell architecture.

Review controls live outside the Area-52 product boundary. Scenario changes destroy/remount the accepted product interface against a new deterministic fixture while preserving UI.Core presentation state. The eventual live transition is provider replacement rather than workspace rewrite.

## Workspace map

Primary navigation is `Home / Story / Characters / Lore / Memory / World / Brain`.

Home answers story-now and Brain-health questions. Story presents current Scene without adding Scene semantics. Characters separates identity, current state, relationships, personal memory, knowledge/belief, inference and history. Lore keeps the human-authored tree first-class and shows learned status/entry provenance. Memory distinguishes Experience/Episode/Reflection and current/historical/unresolved. World shows temporal current/history/conflicts. Brain preserves the Wave-8 cognition path.

## Fixture / live separation

All Wave-9 review scenarios are `FIXTURE` and the shell displays `DEMO / FIXTURE DATA`. Production adapters are not replaced. In production mode, absent producers continue to report `UNAVAILABLE`.

The centralized review-data layer is `demo/phase2-shell/scenarios/index.js`. It supplies one coherent Ember Tavern / Sun Blade world across workspaces and maps six scenarios to the same public product/cognition shapes used by the existing UI.

## Review scenarios

1. Healthy / Active Brain.
2. Hot-only turn with unnecessary cognition skipped.
3. Retrieval-heavy turn with Sensory, Truth, Precision, Gather and Seal.
4. Ambiguous / Jev with UNRESOLVED evidence and Jev abstention/decision semantics; Settlement remains separate.
5. Degraded with timeout/correction failure, stale, late and malformed result containment.
6. Empty / Fresh Install with intentional empty/unavailable product states.

## Responsive / width review

Host-layout presets: Wide desktop, Normal desktop, Compact host-adjacent, Narrow / stacked.

Dock presets: collapsed rail, 420px, 560px, 720px, 900px.

These are review affordances around the existing Front Face presentation state. They make coexistence criticism easy without turning review controls into production UI.

## Static hosting

Entry point: `demo/phase2-shell/index.html`. No bundler is required. Serve the repository root through static HTTP and open `/demo/phase2-shell/`.

## Brand readiness

Visible product configuration remains `Area-52` / `Cognitive Story System`. Review chrome explicitly notes that the brand token is Nexus-ready, but Wave 9 does not rename the product or change UI.Core architecture.

## Known backend gaps

The shell does not implement Scene, Lore Study, Memory, Temporal State, Runtime, Truth, Candidate Bus, Jev or Settlement. Real #224 completion still depends on assembled live producers, real host evidence, real execution resources, live Gather/Seal/PromptPlan, and live failure/recovery evidence.

**PHASE-2 DEMO SHELL READY FOR DIRECTOR VISUAL REVIEW / LIVE #224 BINDING PENDING**
