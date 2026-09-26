# Worker 2 Demo Visibility and Inspection Audit

## Scope

Branch: `Development-Demo-Visibility/Worker-2`

Baseline main: `1e4938b8eb10ad86f83417fad5056b00f31972a9`

This wave changes demo/UI visibility only. It does not edit Jev decision logic. Worker 3's current `Development-Sidecar/Jev` delta has no overlapping `src/ui-core/**` or UI style files with this branch at the time of this audit.

The source of truth remains published owner receipts/read models. Configuration, connection, logical mapping, physical execution, Gather return, Context Seal admission, PromptPlan creation, and host prompt receipt are deliberately separate states.

## #258 — Inspect controls

Every `UI_INSPECT_SELECTION_CHANGED` event now makes the Inspector visible. Home producer cards resolve through an exact selected chat/turn/generation inspection map rather than inspecting only their health badge.

Covered producer details:

- Scene
- Runtime / Scatter mapping
- Coprocessor physical execution
- Cognitive Choice
- Truth
- Jev
- Gather
- Context Seal
- PromptPlan / Context Delivery

Missing owner receipts are rendered as an `UnavailableProducerReceipt` with the owner's reason; the UI does not invent a successful receipt.

Scatter/Gather receipt controls carry the current selection identity into the Inspector. Inspect-labelled buttons use the dedicated visible `inspect` treatment instead of the low-emphasis quiet treatment.

## #257 — Continuous activity feed

The shell activity area is now backed by the local evidence journal.

- entries are ordered oldest visible at the top and newest at the bottom;
- unchanged evidence is de-duplicated and does not jump back to the bottom on every refresh;
- only a bounded recent stack is rendered;
- older visible entries have progressively lower opacity;
- hover/focus exposes the longer receipt-derived explanation;
- each entry is a native button, so pointer and keyboard activation share the same action;
- activation rechecks exact chat/turn/generation before opening the Inspector;
- a stale old-chat button refuses to inspect against the newly selected chat.

The feed summarizes owner evidence, for example "6 logical jobs mapped to 1 resource identity" or "1 physical execution attempt succeeded", rather than repeating bare lifecycle messages.

## #256 — Durable local evidence journal and export

`DemoEvidenceJournal` uses the UI's browser storage. It is bounded by turn and by entries per turn and survives UI destroy/remount or browser reload using the same local storage.

Persisted records are metadata only:

- exact chat / turn / generation identity;
- Scatter receipt reference, logical job count, and mapped resource identities;
- physical resource-attempt status only when selected-turn execution evidence exists;
- Gather receipt reference and dispositions;
- Context Seal receipt reference and admitted/result containment IDs;
- PromptPlan identifier and token/seal metadata;
- post-response learning receipt identity/status;
- bounded producer status / receipt references.

The export is one readable JSON document. It explicitly records:

- `rawPromptsPersisted: false`
- `storyTextPersisted: false`
- `credentialsPersisted: false`
- `hiddenReasoningPersisted: false`
- `externalDatabaseUsed: false`

Settings exposes **Export selected turn evidence** for the exact selected chat/turn/generation.

## #245 — Demo validation audit

### Evidence semantics

The demo must read the pipeline in this order:

1. **Scatter mapping** — proves logical jobs were assigned/mapped to resource identities. It does not prove provider execution.
2. **Coprocessor physical execution** — proves attempts and success/failure from selected-turn execution telemetry.
3. **Gather** — proves returned results and their dispositions.
4. **Context Seal** — proves which result IDs were admitted to sealed generation context.
5. **PromptPlan** — proves owner context preparation only.
6. **SillyTavern host prompt receipt/injection** — separate live-host evidence; a PromptPlan alone is never promoted to this state.
7. **Learning** — proves post-response owner write-back only when its receipt exists.

The focused regression includes the required ambiguity case: **six logical jobs mapped to one resource identity** while only **one physical execution attempt** is recorded. Those counts remain distinct through persistence/export.

### Automated verification

On Worker 2 exact-head CI:

- focused Inspect/activity/journal/export tests pass;
- Wave 12 host acceptance passes;
- browser-facing imports pass without Node globals;
- focused syntax checks pass;
- durable journal destroy/remount test passes;
- selected-turn stale-feed rejection passes;
- six-logical-to-one-resource mapping vs physical-execution test passes.

The full Wave 13 baseline suite has six pre-existing failures on the baseline `main` SHA. Worker 2 observes these as non-gating debt rather than relabeling them:

- Brain delivery/learning wording expectation;
- connection model-discovery timing;
- Memory workspace registration;
- Lore derived-authority wording;
- Worker 4 v2 authoring lifecycle control expectation;
- Worker 4 review-only authoring wording.

### Installed-host scripted blocker

`tests/deployment-live-host.test.mjs` currently reports two listener-count failures on the Worker 2 head:

- `armed session processes MESSAGE_SENT and records operator-visible failures`
- `native Brain host lifecycle seals before model request and learns completed assistant response`

Both report two listeners where the test expects one.

This test is a scripted host probe, not a live SillyTavern acceptance gate. The workflow separately checks the exact baseline main SHA so this can be classified against baseline rather than hidden. Regardless of scripted status, live demo acceptance remains pending until the director reloads the installed extension and observes a real turn.

## Operator walkthrough

1. Reload/update the installed Area-52 extension, select the intended SillyTavern chat, and send one new turn.
2. On **Home**, read **Brain activity**:
   - **Jobs mapped** is the Scatter logical count and mapped resource identities.
   - **Physical execution** is separate selected-turn Coprocessor execution telemetry.
   - **Results returned** comes from Gather.
   - **Context admitted** comes from Context Seal.
3. Open **Connections → Fan-out → Gather**. Identify each logical job and the resource identity it mapped to. Do not call those mappings executions.
4. Return to **Home** and choose **Inspect details** on a producer:
   - Runtime shows mapping;
   - Coprocessor shows physical attempts/success/failure;
   - Choice/Truth/Jev/Gather/Seal show their owner detail;
   - missing receipts show `UNAVAILABLE` plus the reason.
5. In the bottom activity feed, hover/focus a notice to read its explanation, then activate it. Confirm the Inspector opens the same exact chat/turn/generation evidence.
6. Open **Settings → Local evidence journal** and choose **Export selected turn evidence**. Inspect the JSON and verify the same chat/turn/generation plus Scatter/resource/Gather/Seal/PromptPlan/learning metadata.
7. Reload the extension/UI. Select the same turn if the host still exposes it and confirm the local journal remains available. Confirm a different chat does not display/open the old chat's activity as current.
8. In live SillyTavern, separately verify that the host actually received/injected the generated prompt. Do not use PromptPlan existence as that proof.

## Live acceptance still required

Automated checks establish UI wiring, selection fencing, local persistence, export safety, and receipt-state separation. They do **not** establish:

- that the director's installed extension has refreshed to this branch/build;
- that a real OpenRouter/Jev/Sidecar resource executed;
- that SillyTavern accepted the prompt for a real model request;
- that browser download behavior was observed in the director's installed client.

Those remain live operator checks.


## Receipt-boundary closure addendum

The final Worker 2 closure removes one invalid inference found during the Trello acceptance audit: **PromptPlan or Context Seal existence is no longer treated as SillyTavern prompt delivery**.

The installed live session now publishes a metadata-only `SillyTavernHostDeliveryReceipt` for the exact chat / turn / generation. It advances independently through prepared, request-payload-injected, completed/learned, or aborted evidence. The receipt carries only timestamps, IDs, bounded hashes/counts, hook identity, and status; it does not carry raw prompt/story/response text, credentials, or hidden reasoning. The Home/Diagnostics delivery stage is LIVE only after the host request hook reports the prepared payload was injected.

The continuous feed now has two layers: durable evidence remains in the local journal, while the visible transient stack has a readable fresh window, a fading window, then expires. Pointer hover and keyboard focus pause dismissal; release resumes it. Reduced-motion clients disable transition animation without changing evidence timing or accessibility.

Settings now reports journal storage health and retention counts, exposes a short selected-turn evidence timeline, provides both **Export selected turn evidence** and **Clear local evidence journal**, and distinguishes persistent browser storage from memory fallback.

Additional focused regression covers storage failure, bounded turn retention, exact-chat isolation, host-delivery redaction, and transient-feed fade/pause/expiry. These are automated contract checks only. The director still must validate the installed SillyTavern extension update/reload, real browser download, real provider execution, and a real host request injection before the live demo gate can be called passed.
