# Development Deployment — Live #224 Evidence Runbook

**Install state:** the assembled extension was promoted to `main` from CI-green deployment head `ad8bdea5d4e3b9248841b4e5f60f8fb0e7cabea9`. The prior Phase 1 `main` remains recoverable at tag `pre-deployment-main-2026-09-24`.

**Gate state:** **LIVE DEMO PENDING** until a real SillyTavern session completes the operator steps below. The browser-shaped test and deterministic rehearsal are prerequisites, not substitutes for the live gate.

## What this package adds

The repository's default `main` branch is now a directly loadable SillyTavern extension surface:

- root `manifest.json`, `index.js`, and `style.css`;
- the production Wave 12 host-adjacent UI;
- one assembled `DevelopmentDeploymentBrain` with one local cognitive execution resource;
- the accepted Ember Tavern / Mara / Eris / Sun Blade lore fixture loaded through native Lore Study;
- host-message source registration using the exact user message text;
- native Scene observation sourced from the live SillyTavern message;
- simple, retrieval-heavy, ambiguous/Jev, and controlled no-Jev evidence capture;
- Context Seal + PromptPlan generation;
- pre-generation SillyTavern extension-prompt injection;
- an explicit operator confirmation step for Prompt Inspector and UI trace review.

The extension never marks GitHub #224 complete. It emits a `DevelopmentDeploymentLiveDemoEvidence` record and leaves final acceptance to the Director.

## Install from `main`

Use SillyTavern's Git extension installer with `https://github.com/Bermieee/Area-52`, or place a checkout of `main` in the SillyTavern third-party extensions directory. Restart or reload SillyTavern after installation. The previous development-branch-only instruction no longer applies.

Example Git operation from the target extensions directory:

```bash
git clone --branch main --single-branch https://github.com/Bermieee/Area-52.git area52
```

Confirm the loaded extension says **Area-52 — Development Deployment**.

## Live acceptance sequence

Open one real chat. Arm the Area-52 live evidence control, then send these as real user messages in order:

1. **Simple / Hot path**
   `Mara and Eris are inside the Ember Tavern with the Sun Blade present. Where are we?`

   Expected: native Scene is established from the host message; no expensive Runtime scatter job; sealed PromptPlan is injected.

2. **Retrieval-heavy**
   `Tell me about Mara and the Ember Tavern history.`

   Expected: Lore + Graph work execute through the one local resource; authored lore drillback and Truth/Gather/Seal/PromptPlan stay coherent.

3. **Ambiguous / Jev**
   `Mara and Eris reach the Ember Tavern Ruins. What happened to the Sun Blade?`

   Expected: native Scene location revision advances; Lore + Graph + bounded Jev run; Jev abstains/preserves owner authority; Sun Blade conflict remains unresolved; the PromptPlan is injected.

The ambiguous turn also runs a controlled **Jev unavailable** control on a separate one-resource Brain. That result is evidence-only and is not injected into Main.

## Operator confirmation

After the ambiguous generation:

1. Inspect the Area-52 UI beside the real SillyTavern chat. Verify the selected chat/turn/generation is the one just sent, and inspect Scene, Cognitive Choice, Runtime resources, Truth/Jev, Gather, Context Seal, PromptPlan and Forensics.
2. Open SillyTavern Prompt Inspector/itemization for the generated response and verify the `area52-development-deployment` extension prompt appears in the request context for that generation.
3. Click **Confirm Prompt Inspector + UI trace**.
4. Click **Copy evidence**, or run:

```js
JSON.stringify(Area52DevelopmentDeployment.exportLiveEvidence(), null, 2)
```

A complete record has:
- `checks.simple/retrieval/ambiguous/degraded === true`;
- `oneResource === true`;
- each live turn has a verified Context Seal and PromptPlan injection receipt;
- the ambiguous Scene delta includes `location`;
- the Jev proposal has no mutation authority;
- the degraded control reports `safe === true`;
- operator Prompt Inspector and UI trace confirmations are true;
- `liveEvidenceComplete === true`;
- `issue224AutomaticPass === false`.

Attach the exported JSON to Director review (or commit it as a dated evidence artifact if desired). Only the real browser session can fill this section; no fixture JSON is pre-generated here.

## Current evidence boundary

Exact-head GitHub Actions proves the assembly, browser imports, owner receipts, source digests and deterministic one-resource/degraded scenarios. It cannot prove that a specific SillyTavern installation rendered the UI or that a specific model request contained the injected PromptPlan. Those two facts remain operator/live-host evidence until the run above is completed.
