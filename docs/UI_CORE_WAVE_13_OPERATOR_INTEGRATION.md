# UI.Core Wave 13 — Operator UI + Brain Wiring Handoff

**Branch:** `Development-UI`  
**Starting head:** `3bd0dc1bca7dcec19669a1eea9ba0d13fab88ff9`  
**Cards:** #243, #244, UI ownership for #246 and #247, support for #224  
**Completion claim:** **UI.CORE OPERATOR UI READY FOR WORKER 4 LIVE ASSEMBLY**

This wave makes UI.Core usable as the operator surface for one integrated Brain. It does not implement Core policy, Runtime scheduling, Worker 2 provider routing, Jev authority, Lore learning, or deployment. Worker 4 remains the assembly/deployment owner and #224 remains open until the real live gate passes.

## Owner contracts reviewed

### Core / Worker 1

Reviewed current `Development-Nexus` head `ba4619f56db8e4f94873256dc26589e1680b7d29` and the Core UI observation / Cognitive Choice contracts.

UI.Core continues to treat owner receipts as observational. Selection and revision fences remain authoritative inputs to display coherence; the UI never upgrades retrieval, Jev output, or a fluent summary into truth.

### Coprocessor / Jev / Worker 2

Reviewed current `Development-Sidecar/Jev` head `daa3d7218b2a1d90e68fcab01217559a512180c1`.

Consumed semantics:

- `CognitionUiState` is read-only telemetry, not scheduling authority.
- provider health vocabulary: `HEALTHY / DEGRADED / SATURATED / UNAVAILABLE / COOLDOWN / PROBE`;
- capability profiles expose provider/model identity, capabilities, placements, health, availability, load and concurrency;
- logical cognitive jobs remain distinct from physical execution resources;
- Jev is optional proposal-only cognition and requires a typed Jev receipt before UI says it decided;
- provider/capability selection remains Worker 2 / Runtime-owned.

**Current integration gap:** Worker 2 does not yet publish a public operator control API for connect/disconnect/test. Wave 13 therefore defines the UI-side host seam below. It does not implement provider construction, credentials, routing, health policy, cooldown, probes or scheduling inside UI.Core.

### Native Lore

Reviewed accepted `Development-Lorebook-Editor` head `fa74d3e792d3d8aa4dc4879271bcfc42f43e7c2c`.

Wave 13 preserves the native Lore lifecycle:

```
authored source accepted
  -> exact source revision
  -> DUE/PENDING/ACTIVE/CHECKPOINTED study
  -> validation
  -> learned revision publication
  -> CURRENT retrieval representations
```

Accepted source is **not** presented as learned Lore. `STALE_OR_UNLEARNED`, `INVALID`, source revision, learned revision and retrieval representation counts remain distinct.

## #243 — vertical movable rail

Real SillyTavern mounting now defaults to Wave 13 floating navigation.

The seven product sections remain:

- Home
- Story / Scene
- Characters
- Lore
- Memory
- World
- Brain

The rail is vertical and intentionally visually distinct. Selecting an item opens the existing UI.Core workspace shell in one pop-out card; no second ApplicationShell, Signal Hub, Inspector or fake chat is created.

### Interaction

- rail drag handle: pointer/touch via Pointer Events;
- rail drag handle: arrow keys move 16px, Shift+Arrow semantics are reserved for larger movement by the controller;
- card drag handle: pointer/touch and arrow keys;
- card controls: shrink, expand, minimize/restore, close;
- Escape closes the card;
- selected workspace survives minimize/close/reopen;
- position and minimized state persist through UIStateStore;
- rail/card coordinates are clamped to reachable viewport bounds;
- near the right edge the card opens left; near the left edge it opens right;
- card width is clamped on narrow screens rather than rendering off-screen.

The outer SillyTavern adapter reserves only the 76px rail width. The floating card is allowed to extend into available viewport space without shrinking the host chat by the entire card width.

Required stylesheet: `styles/ui-core-wave13.css`.

## #244 — truthful Brain state

`Wave13OperationalStatusAdapter` reports these operator states independently from module registration:

- `LIVE`
- `WORKING`
- `IDLE`
- `WAITING_FOR_TURN`
- `DISCONNECTED`
- `UNAVAILABLE`
- `DEGRADED`

Each stage record carries the selected chat/turn/generation identity when available, freshness/error information and an operator reason.

Key rules:

- selected chat + no turn -> turn-bound producers report `WAITING_FOR_TURN`;
- exported reader + selected turn + no receipt -> `IDLE`;
- no exported reader -> `UNAVAILABLE` with an assembly-contract reason;
- optional resource absent -> `DISCONNECTED` or `UNAVAILABLE`, never fabricated live;
- coherence/read failure -> `DEGRADED`;
- stale prior-chat receipts remain rejected by Wave 11 fences;
- host chat changes clear stale Inspector selection and refresh the current workspace;
- same-turn receipt updates preserve operator location.

Selected-turn Runtime scatter can now satisfy the visible Runtime status when a separate scheduler telemetry adapter is absent. The UI labels it as a **selected-turn Runtime receipt**, not full scheduler telemetry.

Coprocessor is not inferred from Core Cognitive Choice. If Worker 2 `CognitionUiState` / contribution telemetry is not exported, the Coprocessor status says that explicitly.

Routine status telemetry does not copy raw prompts or message bodies.

## #246 — Worker 2 optional resource UI contract

Wave 13 accepts the following **host-exported** read/actions. The names are deliberately owner-facing adapters; UI.Core does not implement their effects.

Preferred reads:

```js
listResourceProfiles()
listResourceConfigurations() // optional
```

Accepted aliases include `listResources`, `listCapabilityProfiles`, `readResourceStatus` and `listAvailableResources`.

Preferred actions:

```js
connectResource({
  kind,       // "SIDECAR" | "JEV"
  profileId,
  endpoint,   // local endpoint if applicable
  modelId,
  local: true
})

testResource({ id, kind, providerId, modelId, ... })
disconnectResource({ id, kind, providerId, modelId, ... })
```

Accepted aliases: `mountResource`, `probeResource`, `testConnection`, `unmountResource`.

The returned/read resource profile should expose Worker 2's real values where applicable:

```js
{
  id | profileId | resourceId,
  kind,
  providerId,
  modelId,
  workerId,
  local,
  health,
  availability,
  connected,
  capabilities: [],
  placements: [],
  currentLoad,
  concurrencyCapacity,
  lastError
}
```

The Brain workspace shows actual capabilities, placement, health/load, latest connection-test result and actionable failure text. With no optional resource, it states that native cognition remains available.

### Worker 4 / Worker 2 gap

At the Worker 2 head reviewed for this wave, capability/profile/health contracts exist but the public connect/test/disconnect action seam above does not. Worker 4 must not fake those actions. Either:

1. Worker 2 exports the actions through its supported resource manager; or
2. Worker 4 supplies a thin assembly adapter that delegates to Worker 2's actual supported control plane.

UI.Core will enable controls only when those actions are present.

## #247 — Lore Study UI contract

Preferred host reads:

```js
readLoreStudySurface(selection)
// or:
readLoreStatus(selection)
readLoreStudyStatus(selection)
```

Preferred owner actions:

```js
acceptLorebook({
  id,
  title,
  metadata,
  entries: [{ uid, content, metadata }],
  fullSnapshot: true
})

runLoreStudy({ scope: "DUE" })
```

Accepted aliases for source acceptance: `submitLorebook`, `enqueueLorebook`, `ingestLorebook`.

Accepted aliases for study execution: `startLoreStudy`, `runDueLoreStudy`.

The UI accepts:

- plain text as one authored entry; or
- structured JSON with arbitrary lorebook/entry identities.

It performs only input-shape validation locally. Source identity, exact revisions, obligation creation, learning, validation, provenance and retrieval readiness remain Lore-owner responsibilities.

Displayed distinctions:

- accepted source entry count;
- learned/current count;
- retrieval-ready count;
- due / active / invalid obligations;
- source revision ID;
- learned revision ID;
- `CURRENT` vs `STALE_OR_UNLEARNED`;
- retrieval representation count;
- unresolved marker/provenance metadata.

Invalid JSON or entries missing UID/content never call the Lore owner and never appear as learned.

## Worker 4 host bindings

The existing Wave 12 SillyTavern adapter still owns the one composite host subscription. Wave 13 extends its allowlist for:

```
readMemoryStatus
readLoreStudyStatus / readLoreStudySurface
readRuntimeStatus
readCognitionUiState
readCoprocessorChoiceContribution

resource reads/actions listed above
Lore reads/actions listed above
```

Existing Wave 11 reads remain unchanged: Scene, Hot Cognition, Choice, scatter, Sensory/Candidate Bus, Truth, corrective retrieval, Jev, Precision, Gather, Context Seal, PromptPlan, ContextReceipt, integrity and Forensics.

## Host-ready mount

```js
import { mountWave12SillyTavernInterface } from './src/ui-core/index.js';

const area52 = mountWave12SillyTavernInterface({
  getContext: () => SillyTavern.getContext(),
  hostBindings: integratedBrain.hostBindings(),
  // floatingNavigation defaults true for the real host adapter
});

// extension unload
area52.destroy();
```

Worker 4 must load `styles/ui-core-wave13.css` after the earlier UI.Core styles.

## Generic HOST HARNESS

`demo/wave13-operator-harness/` is an explicit:

**HOST HARNESS / SIMULATED OWNER RECEIPTS / NOT LIVE #224 ACCEPTANCE**

It uses the production SillyTavern mount adapter and two unrelated story settings:

- Moon Harbor
- Glass Orchard

It exercises:

- selected chat with no active turn;
- publishing a turn without reload;
- switching unrelated stories;
- movable rail/card;
- resource read/connect/test/disconnect UI through a simulated owner;
- Lore acceptance and learning through a simulated owner.

No Ember Tavern/Sun Blade check is used to decide product UI behavior.

## Short Worker 4 live test

1. Install/launch Area-52 in a real SillyTavern session and verify only one red vertical rail appears beside the real chat.
2. Drag the rail near both viewport edges. Open every product section and verify the card flips to available space, remains reachable, resizes/minimizes/restores/closes with mouse and keyboard.
3. Select a chat before generation. Home/Brain should show `WAITING_FOR_TURN` for turn-bound producers rather than stale prior-chat data.
4. Run a normal generation. Verify Scene, Runtime receipt, Choice, Gather/Seal and PromptPlan bind the exact selected chat/turn/generation and refresh without page reload.
5. Switch chats during/after work. Confirm the previous chat's Scene and receipts disappear as current immediately.
6. Attach a real Worker 2 sidecar and a real Jev resource through the exported control actions. Verify real profile identity, capabilities, health and connection test. Disconnect each and confirm the native Brain remains usable.
7. Submit a small, arbitrary non-demo Lorebook. Confirm source acceptance first, then study progress/completion, exact source/learned revisions and retrieval readiness.
8. Run a retrieval-heavy turn using that Lore and inspect what actually reaches Gather/Seal/PromptPlan.
9. Run a bounded ambiguous turn. Verify Jev only appears as decided when a typed Jev receipt exists; preserve `UNRESOLVED` if owner truth remains unresolved.
10. Exercise one controlled failure (resource unavailable or Lore invalid/stale). Verify useful degraded reason and no fabricated prompt contribution.
11. Destroy/remount the extension and verify one host subscription, one shell and no retained listeners/root children.

Only after those steps use real owner receipts through one sealed generation should #224 be considered for completion.
