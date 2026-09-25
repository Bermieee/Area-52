# Area-52 Phase-2 Review Shell

This directory is the broad, static product-review entry point for UI Wave 9. It hosts the accepted UI.Core Front Face beside a neutral **HOST-OWNED SURFACE** so the director can judge how much SillyTavern reading space Area-52 consumes without rendering fake chat.

## Launch

Serve the repository root with any ordinary static HTTP server, then open:

`/demo/phase2-shell/index.html`

Examples from the repository root:

- `python -m http.server 8000` then open `http://localhost:8000/demo/phase2-shell/`
- `npx serve .` then open the printed URL plus `/demo/phase2-shell/`

No bundler, Node application server, backend, credentials, or build step is required. The browser loads repository-relative UI.Core modules and styles directly.

For static hosting, publish the repository root (or preserve the same relative paths for `demo/phase2-shell/`, `src/ui-core/`, `styles/`, and `tests/fixtures/wave8-cognition-fixtures.mjs`). The shell itself has no server-side dependency.

## Review controls

The top review bar is intentionally outside the product surface. It preserves the six Wave-9 scenarios and adds Wave-10 **Context loading** and **Stale context view** states, plus Normal/Detail/Advanced disclosure, Wide/Desktop/Compact/Narrow host-layout presets, collapsed/420/560/720/900 Area-52 widths, Inspector visibility and deterministic reset.

Every scenario is visibly labeled **DEMO / FIXTURE DATA**. Fixture cognition never masquerades as live production cognition. Production bindings from Waves 6–8 remain separate and continue to report `UNAVAILABLE` when their real producer is absent.

## Workspace map

Primary product navigation remains one UI.Core application:

`Home → Story → Characters → Lore → Memory → World → Brain`

The Brain workspace remains the Wave-8 cognition surface. Context Delivery and full Forensics remain engineering/advanced destinations reached from Brain and contextual Why?/Inspector paths rather than crowding primary navigation. The same Inspector Framework is used everywhere.

## Review world

The default cohesive fixture is **Ember Tavern / Sun Blade**: Ember Tavern is SETTLED destroyed; Eris historically carried the Sun Blade there; the Blade's current fate remains UNRESOLVED; bounded ambiguity can reach Jev; false current Blade location is excluded from sealed generation context.

## Wave 10 context / forensics walkthrough

For the connected #145/#152 review path, choose **Ambiguous / Jev**, open **Brain**, and use the **Generation Context** card. It summarizes the current budget, reuse/rebuild/drop/defer decisions, model profile, fallback and final packet estimate. **Inspect context plan** opens the shared Inspector; **Why This Generation?** shows ordered section allocations; **Forensics** reconstructs the recorded Source → Proposal → Validation → Owner Settlement → State/Reflection → Retrieval → Compiled Context → Context Seal path.

The Sun Blade conflict remains visibly **UNRESOLVED** through the ContextReceipt and sealed context. A recorded late result remains visible after the seal but is not shown as mutating the sealed generation. These readers use contract-shaped fixture data and explicitly report **FIXTURE**, not LIVE.

## What remains live-integration work

This shell is a reviewable product surface, not the Phase-2 completion gate. #224 still requires an assembled live SillyTavern session, real Scene Intelligence, real Lore study/retrieval, Core cognitive choice, Sidecar/Coprocessor execution, bounded Jev, Gather, Context Seal and PromptPlan running together with real receipts and failure/recovery proof.

Status: **PHASE-2 DEMO SHELL READY FOR DIRECTOR VISUAL REVIEW / LIVE #224 BINDING PENDING**.
