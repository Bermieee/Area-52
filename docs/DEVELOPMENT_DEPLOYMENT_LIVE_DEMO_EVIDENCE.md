# Development Deployment — Live #224 Evidence Runbook

**Gate state:** **LIVE DEMO PENDING.** Workers 1–3 are integrated on `Development-Deployment`, but #224 cannot close until this exact candidate is exercised in the user's SillyTavern instance and reviewed by the Director.

## Installation / update gate

Area-52 remains one SillyTavern extension. Jev and sidecars are optional execution resources; no external database, Redis, Dapr, remote provider, or second install is required for native Brain operation.

The first demo's HTTP 500 plus the later missing Update control points to the installed extension no longer being a healthy Git-managed checkout. SillyTavern's updater requires the extension directory to be a Git repository and reports update exceptions as HTTP 500; its version probe returns blank branch/commit metadata for a non-repository. A divergent checkout can also make the normal pull fail. The SillyTavern server log distinguishes those cases. Area-52 must not hide either condition with a force reset.

1. Open **Manage Extensions**.
2. For a healthy Git install, use **Switch branch** and select `Development-Deployment`.
3. If the old install is divergent or no longer a valid Git checkout, remove Area-52 through Manage Extensions, reinstall `https://github.com/Bermieee/Area-52`, then use **Switch branch** to select `Development-Deployment`. Do not manually replace the extension folder.
4. Reload SillyTavern.
5. Reopen Manage Extensions. Verify version `0.3.1-development-deployment` and the displayed `Development-Deployment-<short SHA>` matches the Worker 4 handoff.
6. After a newer fast-forward commit is published on this branch, use SillyTavern's normal update path, reload, and verify the displayed commit changes.

The manifest enables normal automatic update checking. SillyTavern can hide the per-extension update icon when no update is detected, so the icon's absence alone is not an update failure.

## UI gate

Verify the installed extension—not a standalone harness—shows:

- vertical draggable navigation;
- edge-aware pop-out cards and shrink/expand behavior;
- truthful producer/operational states;
- **Jev / sidecar resources** with Connect, Test, and Disconnect controls;
- **Lore Study** with Accept for study and Run pending study controls.

A mounted panel or registered producer is not enough. The status view must change in response to actual owner reads/actions.

## Lore Study gate

Use the Lore Study form with a small lorebook unrelated to the deterministic Ember fixture.

1. Submit authored lore with **Accept for study**.
2. Confirm the owner read model reports the source as accepted but not yet learned/retrieval-ready.
3. Run **Run pending study**.
4. Confirm the owner read model reports processed/current knowledge and retrieval representations for the accepted source.
5. Use that lore in a later story turn and verify the retrieved evidence drills back to the authored source revision.

Acceptance, processing, and retrievability are distinct states. A successful submission alone does not pass #247.

## Story-independent turn gate

Use **two unrelated real chats**. Do not use Ember Tavern, Mara, Eris, or Sun Blade.

### Chat A

1. Arm Area-52 live evidence.
2. Send an ordinary in-character turn that does **not** explicitly name a location.
3. Verify the turn is accepted, a Scene exists, and unknown fields remain unknown rather than being invented.
4. Send a second turn naming the actual location and requesting relevant history.
5. Verify Scene revision/delta, Retrieval, Truth, Gather, Context Seal, and PromptPlan receipts all match Chat A's chat/turn/generation.

### Chat B

1. Switch to a completely unrelated chat.
2. Send an ordinary turn, then a turn involving genuinely conflicting/uncertain story evidence.
3. Verify receipts bind to Chat B and do not reuse Chat A state.
4. Verify the ambiguous turn records Jev execution as either a measured live provider call, deterministic fixture/fallback, or a specific unavailable/failure state.

## Prompt delivery gate

For at least one generation in each chat:

1. Open SillyTavern Prompt Inspector/itemization.
2. Verify the `area52-development-deployment` extension prompt is present in the actual request context.
3. Match PromptPlan, generation, and context-seal IDs to Area-52 live evidence.
4. Confirm the sealed context is unchanged by any late/stale optional result.

## Optional resource / FT005 gate

Native operation must first work with **no optional resource attached**.

Then, if a real OpenAI-compatible local Jev/sidecar endpoint is available:

1. In **Jev / sidecar resources**, choose the resource type, enter profile ID, endpoint, and model ID, then Connect.
2. Test the resource and verify the UI reports the actual connection/health result.
3. Generate an ambiguous turn that invokes Jev.
4. Export evidence and verify `providerEvidence.realProviderCallObserved === true`, `providerEvidence.ft005LivePass === true`, and provider provenance is `MEASURED_LIVE`.
5. Disconnect the resource and repeat a native turn; the Brain must continue safely.

The deterministic built-in Jev is labeled fixture/fallback evidence and never satisfies #180/FT005.

Automated Worker 2 tests cover timeout, unavailable, malformed-output, and connection-state degradation. The live gate still needs at least the real connected call plus disconnected/native behavior; record any live provider failure rather than converting it into a fixture pass.

## Export / review

After the two-story, Prompt Inspector, UI, Lore, and any available real-provider checks, click **Confirm Prompt Inspector + UI trace**, then **Copy evidence**, or run:

```js
JSON.stringify(Area52DevelopmentDeployment.exportLiveEvidence(), null, 2)
```

Expected properties include:

- `twoStoryCoverage === true`;
- tested turns have verified Context Seal and PromptPlan injection receipts;
- measured provider evidence is clearly distinct from deterministic fixture evidence;
- controlled Jev-unavailable probe is labeled `SIMULATED_FAILURE_PROBE`;
- `operatorReview.liveSillyTavernConfirmed === true`;
- `issue224AutomaticPass === false`;
- `liveEvidenceComplete === false` because Director approval remains external to this record.

Attach the evidence JSON and screenshots to Director review. Do not promote to `main` until this live gate, exact-head CI, and Director approval are all complete.
