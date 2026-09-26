# UI.Core Wave 12 — SillyTavern Host Adapter

Status: **UI.CORE HOST ADAPTER READY FOR LIVE BRAIN ASSEMBLY**

This wave adds the outer host adapter required to place the existing UI.Core product beside SillyTavern and bind it to typed owner receipts. It does **not** implement Cognitive Choice, Candidate Bus, Truth, Jev, Gather, Context Seal, PromptPlan, Settlement, Scene, Lore, Memory, Runtime, or execution policy.

It does **not** satisfy #224 by itself. A real #224 PASS still requires a real SillyTavern session carrying actual owner receipts through one sealed generation.

## Verified SillyTavern boundary

Wave 12 was written against the current SillyTavern `release` host contract, not guessed selectors/events:

- `SillyTavern.getContext()` exposes `chatId`, `chat`, `eventSource`, and `eventTypes`.
- the host chat surface is `#sheld`, containing `#chat` and `#form_sheld`;
- host events used by the bridge are the published `eventTypes` values for `CHAT_CHANGED`, `CHAT_LOADED`, `MESSAGE_SENT`, `MESSAGE_RECEIVED`, `MESSAGE_EDITED`, `MESSAGE_DELETED`, `MESSAGE_UPDATED`, `MESSAGE_SWIPED`, `GENERATION_STARTED`, `GENERATION_STOPPED`, and `GENERATION_ENDED`;
- subscriptions use `eventSource.on(event, handler)` and cleanup uses `eventSource.removeListener(event, handler)`.

The adapter reads event names from `getContext().eventTypes` (or the legacy `event_types` alias). It does not hard-code private host event strings into canonical UI.Core.

SillyTavern supplies a selected chat identity. It does **not** supply Area-52's canonical turn, generation, correlation, world revision, Scene revision, or source-revision fence. Wave 12 therefore never manufactures those identities.

## Production entry point

```js
import { mountWave12SillyTavernInterface } from './src/ui-core/index.js';

const host = mountWave12SillyTavernInterface({
  // Optional when globalThis.SillyTavern.getContext() is available:
  getContext: () => SillyTavern.getContext(),

  // Typed, read-only Area-52 owner boundary:
  hostBindings: area52UiHostBindings,
});

// Extension unload / teardown:
host.destroy();
```

The adapter creates exactly one `createWave6ProductInterface()` instance. It reuses the existing Signal Hub, Render Scheduler, Front Face, workspaces, Inspector, Action Router, Wave 11 receipt binding, and `HostAdjacentMountAdapter`.

Mount priority is:

1. caller-supplied `mountRoot`;
2. caller-supplied `mountRootSelector`;
3. one adapter-owned sibling root beside verified SillyTavern `#sheld`.

It never creates or clones a chat pane.

### Layout reservation

For an adapter-owned root, the default layout reservation uses the verified desktop `#sheld` geometry: it reserves adjacent width by adjusting the host's right inset while the Area-52 root occupies the adjacent region. All touched inline styles are snapshotted and restored on destroy.

Assemblies with custom/movable host layout may provide host-approved callbacks:

```js
layout: {
  reserveWidth(widthPx) {},
  releaseWidth(lastWidthPx) {},
  onModeChange({ mode, width }) {},
}
```

These callbacks keep host-specific placement policy outside canonical UI.Core.

## Selection and subscription bridge

Wave 12 publishes Wave 11's existing single `readSelection` + `subscribe` contract.

The effective selection is:

- `chatId`: current SillyTavern chat when available;
- `turnId`, `generationId`, `correlationId`, `worldRevision`, `sceneRevision`, `sourceRevisionRefs`: owner-published values only.

If SillyTavern changes chat while the owner still reports the prior chat, Wave 12 deliberately publishes **only the new host chat ID** until the owner catches up. It drops the prior turn/generation/revision fence instead of producing a mixed identity or reusing prior-turn receipts.

One composite Wave 11 subscription fans in:

- verified SillyTavern context-change events; and
- the owner's receipt-update subscription, when supplied.

No polling loop is used. Host event payloads and owner update payloads are not copied into routine telemetry; only sanitized event/stage identity is retained.

Same-turn receipt updates use the existing Wave 11 refresh path and do not clear Inspector location. A changed selection clears stale Inspector selection and pending Inspector render work. Historical generation reads continue through Wave 11's explicit generation-aware readers rather than current-turn revision fences.

## Exact assembly-owner calls

The assembly owner supplies only readers that actually exist. Missing calls are intentionally omitted; UI.Core then renders the affected producer as `UNAVAILABLE` or, for an incoherent/erroring reader, `DEGRADED`.

The selection/subscription calls are:

| Call | Required behavior |
| --- | --- |
| `readSelection({ chatId })` | Return owner-known `chatId/turnId/generationId/correlationId/worldRevision/sceneRevision/sourceRevisionRefs`. Omit unknown fields. |
| `subscribe(listener)` | Notify after typed owner receipts/selection can be re-read. Return an unsubscribe function. Do not send raw prompts as UI telemetry. |

Typed read-only producer calls accepted by the existing Wave 11 binding are:

| Stage / surface | Owner call(s) |
| --- | --- |
| Scene | `readScene(selection)` |
| Hot Cognition | `readHotCognition(selection)` |
| Cognitive Choice | `readCognitiveChoice(selection)` |
| Runtime scatter | `readScatter(selection)` or `readRuntimeTurn(selection)` |
| Sensory / Candidate Bus | `readSensoryTrace(selection)`, `readCandidateBusEnvelope(selection)`, optional `readCandidateFusionReceipt(selection)` |
| Truth | `readTruth(selection)` |
| Corrective retrieval | `readCorrectiveRetrieval(selection)` |
| Jev | `readJev(selection)` returning a typed Jev decision receipt |
| Precision | `readPrecision(selection)` |
| Gather | `readGather(selection)` |
| Context Seal | `readContextSeal(selection)` |
| Lore readiness | `readLoreStatus(selection)` |
| PromptPlan | `readPromptPlan(selection)` |
| ContextReceipt | `readContextReceipt(selection)` |
| Context integrity | `readIntegrityReceipt(selection)` |
| Generation history | `listGenerations({limit, selection})`, `readGeneration({generationId,...selection})` |
| Forensics | `readForensic(selection)`, `listForensics(selection)` |
| Cognitive transactions | `listTransactions(selection)`, `readTransaction(id)` |
| Deep forensic links | optional `reconstructGeneration`, `reconstructTransaction`, `readRuntimeWork`, `readKnowledgeTrace`, `readLazyForensicPayload`, `searchForensics` |
| Runtime product summary | `runtimeAdapter` |
| Coprocessor telemetry | `coprocessorTelemetry` / `coprocessorAdapter` |
| Product read models | optional `story`, `characters`, `lore`, `memory`, `world`, `knowledgeAdapter` |

Aliases already accepted by Wave 11 remain accepted; the table shows the preferred assembly names.

### Authority negatives preserved

- Missing Choice, Truth, Seal, Sensory, Jev, Gather, or PromptPlan readers are never filled from Ember Tavern fixtures.
- Sensory absence is `UNAVAILABLE`; it becomes `SKIPPED` only when Cognitive Choice explicitly publishes that optimization.
- Planned/invoked Jev work is not a Jev decision. An invoked decision requires a typed Jev receipt.
- wrong chat/turn/generation/correlation, future or stale world/Scene revision, and foreign source revisions are rejected at the affected stage.
- `LATE`, `STALE`, `INVALID`, or `REJECTED` Gather rows that conflict with Seal admission degrade the display and are removed from effective admitted output.
- logical cognitive jobs and physical execution resources remain separate UI concepts.
- evidence reaching Main is shown only from Gather/Seal/PromptPlan owner receipts.
- `UNRESOLVED` remains visible in the ambiguous Sun Blade path; Jev confidence or fluent summaries never upgrade it to canon.

## HOST HARNESS visual review

`demo/wave12-host-harness/` is an explicit **HOST HARNESS / FIXTURE RECEIPTS / NOT LIVE #224 ACCEPTANCE** artifact.

It uses the **production Wave 12 mount adapter**, a SillyTavern-shaped `#sheld` host surface, and the existing Wave 11 typed receipt fixtures. Controls exercise:

- Hot-only, retrieval-heavy, and ambiguous/Jev paths;
- Normal / Detail / Advanced disclosure;
- 420 / 560 / 720 / 900 px Front Face widths;
- collapse / expand;
- destroy / remount.

The harness is for host geometry, readability, keyboard and lifecycle review only. It is not evidence of real Scene/Lore/Runtime/Jev execution.

## Validation targets

Wave 12 CI runs:

- full UI.Core regression;
- Wave 7–11 regressions;
- focused Wave 12 host/selection/authority tests;
- Wave 11 large-receipt stress;
- Wave 12 600-switch / repeated destroy-remount lifecycle stress;
- JavaScript syntax checks;
- browser-facing source guards with `Buffer` absent;
- UI.Core ESM import.

A real assembled SillyTavern smoke remains an integration-owner acceptance step for #224.
