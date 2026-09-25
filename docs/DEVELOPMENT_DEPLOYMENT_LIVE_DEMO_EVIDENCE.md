# Development Deployment — Live #224 Evidence Runbook

**Gate state:** **LIVE DEMO PENDING.** Automated and browser-shaped evidence can prepare this candidate, but only a real SillyTavern session plus Director review can close #224.

## Installation and update behavior

Area-52 is one SillyTavern extension. Jev/sidecars remain optional resources; no database, Redis, Dapr, remote provider, or secondary install is required for native operation.

The first demo's HTTP 500 was caused by the installed Git checkout no longer being fast-forwardable after repository history changed. SillyTavern's update endpoint performs a normal pull of the extension's current branch and intentionally reports pull failures as HTTP 500; Area-52 must not force-reset user checkouts to hide that condition.

For this review candidate:

1. Open **Manage Extensions** in SillyTavern.
2. If Area-52 is already a normal Git install, use **Switch branch** and select `Development-Deployment`.
3. If the old checkout is divergent or is no longer a Git repository, delete Area-52 through Manage Extensions, reinstall `https://github.com/Bermieee/Area-52`, then use **Switch branch** to select `Development-Deployment`. This is the supported recovery path; do not manually replace the extension folder.
4. Reload SillyTavern.
5. Reopen Manage Extensions. The version row should report `0.3.0-development-deployment` plus `Development-Deployment-<short commit>`. Compare that commit with the SHA in the Worker 4 Director handoff.
6. When a newer fast-forward commit exists on the selected branch, SillyTavern's normal update path must advance the checkout and, after reload, the displayed short commit must change.

The manifest enables normal automatic update checks. SillyTavern's per-extension download icon is shown only when its version check reports an update; its absence by itself does not prove that update support is missing.

## Story-independent live behavior

The live adapter no longer loads the deterministic Ember Tavern fixture and no longer requires any named scene, character, or object. On a first turn with no extractable location, Scene Intelligence opens the selected chat's Scene with unknown fields rather than inventing a setting or rejecting the turn.

The deterministic Ember fixture still exists in the repository only for regression tests. It is not imported by the live SillyTavern adapter.

## Operator test

Use **two unrelated real chats**. Do not use Ember Tavern, Mara, Eris, or Sun Blade for this gate.

### Chat A — ordinary story

1. Arm the Area-52 evidence control.
2. Send an ordinary in-character turn that does not name a location, such as a character examining an object or continuing dialogue.
3. Verify the turn is accepted, a Scene exists, unknown fields remain unknown rather than being fabricated, and a sealed PromptPlan is injected.
4. Send a second turn that explicitly names your actual location and requests relevant history.
5. Verify Scene revision/delta, Retrieval, Truth, Gather, Context Seal, and PromptPlan receipts are tied to this chat/turn/generation.

### Chat B — unrelated story

1. Switch to a completely unrelated chat.
2. Send an ordinary turn and then a turn involving genuinely uncertain or conflicting story evidence.
3. Verify Area-52 binds receipts to Chat B rather than reusing Chat A selection/state.
4. Verify the deterministic built-in Jev path is labeled **FIXTURE**. It does not satisfy FT005. A real configured provider/sidecar call must carry separate provider provenance before #180 can pass.

### Prompt delivery

For at least one generation in each chat:

1. Open SillyTavern's Prompt Inspector/itemization.
2. Verify the `area52-development-deployment` extension prompt is present in the request context.
3. Match its PromptPlan/generation/context-seal identifiers to the Area-52 evidence record.
4. Confirm that a late/stale optional result does not alter the already sealed context.

## Lore Study evidence

The deployment Brain now records Lore ingestion as separate `accepted`, `processed`, and `retrievable` states. That backing contract is not a substitute for #247's required production Lore Study UI.

Until Worker 3's #247 UI is present on the accepted UI lane, **Lore Study UI acceptance remains blocked**. Do not call #247 or #224 complete based on console/API ingestion alone.

## UI and optional-resource evidence boundary

Current Worker 4 evidence distinguishes execution from registration:

- Scene Intelligence, Retrieval, Truth, Cognitive Choice, Runtime, Gather, and PromptPlan report whether they actually ran or were skipped/unavailable for the selected turn.
- UI producer diagnostics are explicitly marked registration-only and cannot create a live pass by themselves.
- the native deterministic Jev path is labeled `FIXTURE`, with `realProviderCallObserved=false` and `ft005LivePass=false`;
- Memory reports skipped when no Memory task was admitted;
- Forensics/Transactions report unavailable when no live owner binding exists.

The following remain external blockers until their owning lanes deliver and Worker 4 integrates them: #243 production vertical/draggable/edge-aware navigation, #246 Jev/sidecar connection controls and inspection, #247 Lore Study ingestion UI, and #180 a real-provider call plus controlled failure evidence.

## Export and review

After the real checks, click **Confirm Prompt Inspector + UI trace**, then **Copy evidence**, or run:

```js
JSON.stringify(Area52DevelopmentDeployment.exportLiveEvidence(), null, 2)
```

Expected properties include:

- `twoStoryCoverage === true`;
- each tested live turn has a verified Context Seal and PromptPlan injection receipt;
- `providerEvidence.realProviderCallObserved === false` until a real provider is integrated and exercised;
- the controlled Jev-unavailable probe is labeled `SIMULATED_FAILURE_PROBE`;
- `operatorReview.liveSillyTavernConfirmed === true` after the button is clicked;
- `issue224AutomaticPass === false`;
- `liveEvidenceComplete === false` even after operator capture, because Director approval and remaining live gates are intentionally external to this record.

Attach the exported evidence and screenshots to Director review. Promotion to `main` remains prohibited until the required live gates are complete and approved.
