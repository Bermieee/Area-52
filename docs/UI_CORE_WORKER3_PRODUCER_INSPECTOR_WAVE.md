# Worker 3 UI Producer / Inspector Wave

Baseline checked before editing: `main@1e4938b8eb10ad86f83417fad5056b00f31972a9`.

Worker 3 integration branch: `Development-UI-Worker3`.

## Ownership boundary

Worker 3 owns selected-turn producer wiring, PromptPlan/Adaptive Context inspection, bounded cognitive forensics, generic Memory workspace registration, and live-host listener correctness for this wave.

Worker 4 retains the visible Arm/Disarm demo harness, selected-lorebook auto-load, and compact telemetry plots. Worker 3 does not edit `index.js` and does not redesign Lore or telemetry plot surfaces. Automatic installed-session startup remains required.

## Selected-turn evidence rule

Every live UI read is scoped to the current chat / turn / generation identity. A receipt with a conflicting chat, turn, generation, correlation, world/scene revision, or source revision is rejected by the Wave 11 live binding instead of being displayed as current.

The operational producer list includes Scene, Runtime, Coprocessor, Cognitive Choice, Sensory, Truth, Jev, Gather, Context Seal, PromptPlan, Generation, Learning, Lore, Memory, and Forensics. Missing optional producers remain UNAVAILABLE; a connected resource is not evidence of execution or owner acceptance.

## Worker 2 lifecycle contract

From the Worker 2 contract snapshot inspected at `Development-Sidecar/Jev@fa67f4d253a52e8cea054f39f73c475b709298b1`, `CognitionUiState` resource rows publish independent evidence for:

- configured / connected
- selected-model qualified / callable
- physical execution attempted / succeeded
- owner accepted

UI.Core preserves those as separate fields. It must not derive physical execution or owner acceptance from connection health. The Connections surface and diagnostics consume these owner fields directly when that Worker 2 read model is integrated.

## Worker 1 PromptPlan delivery contract

The checked-out main baseline does **not** publish a host-observation receipt. Therefore the current UI may show PromptPlan planning data and any actual ContextReceipt/Context Seal that exists, but must show real-host observation as UNAVAILABLE.

From the Worker 1 contract snapshot inspected at `Development-Nexus@ba19ef76a311b90a9a9db1b0ab7d4cf3559eb8f0`, the branch adds the integration seam expected by this UI:

- `readPromptDeliveryReceipt(selection)`
- `attachObservedHostPromptEvidence(receipt, evidence)`
- `promptDeliveryIntegrationContract()`

The branch receipt distinguishes `PLANNED_NOT_OBSERVED`, `OBSERVED_MATCH`, and `OBSERVED_MISMATCH`, and carries metadata such as generation/turn identity, Context Seal identity, sealed-packet/semantic-manifest identities, planned roles/sections, omissions, and a sanitized observed-host evidence record.

UI.Core already accepts `readPromptDeliveryReceipt` through the host binding and Wave 11 identity fence. It retains metadata only; raw prompt text, provider secrets, and raw payloads are not copied into the UI read model.

## PromptPlan inspector evidence classes

The Context Delivery and Why This Generation surfaces render three independent evidence classes:

1. **Planned** — PromptPlan sections, omissions/deferrals, model profile, token budget, revisions, and Context Seal identity.
2. **Injected / compiled** — only an actual ContextReceipt published for the selected turn.
3. **Observed in real host prompt** — only an ObservedHostPromptEvidence / PromptDeliveryReceipt published for that exact generation.

A plan is never promoted to observed host execution.

## Cognitive forensics

The forensic generation read is bounded to at most 512 transaction rows. It requires the selected chat/turn/generation where producer identity is available, excludes foreign chats, and treats a transaction with an explicit generation ID as generation-exact so a regeneration cannot leak into the selected generation. Turn-only records may be admitted only when they match the selected forensic turn.

Missing stages remain explicit. Rejection, stale, and late reasons are represented by receipt metadata and references. Raw prompt content and secrets are not required for the timeline.

## Live-host event bridge

The installed session remains auto-started. Functional SillyTavern listeners now record their own narrative-event metadata for overlapping events, so the session does not register a second observer for the same event. This preserves the #182 narrative feed while avoiding duplicate host listener counts and duplicate lifecycle handling.

## Demo connection lock persistence

The Connections workspace now persists one non-secret saved lock per optional role: **Jev**, **Sidecar**, and **Vectoring**. Once Worker 2 accepts/configures a resource, UI.Core stores only a whitelisted profile: role/resource identity, display name, transport kind, safe endpoint, selected model, capabilities, provider/profile/worker IDs, concurrency, locality, and lock/connection metadata.

On a fresh UI mount, saved profiles are rehydrated into Worker 2 as `CONFIGURED` resources when the owner inventory is empty. The UI then shows **SAVED LOCK** and preserves the endpoint/model/capability information instead of requiring the operator to re-enter it after every demo reload.

Provider credentials are deliberately excluded from Area-52 persistence. Worker 2 still publishes `ResourceCredentialStorage.SESSION_MEMORY_ONLY` for direct provider credentials, so API keys/tokens are never serialized into UI state. For the installed SillyTavern demo, Jev may instead bind to a SillyTavern Connection Manager profile. UI.Core persists only the Connection Profile ID/name; the deployment bridge supplies a host-managed provider adapter that sends requests through SillyTavern's ConnectionManagerRequestService, where the server-side secret reference remains owned by SillyTavern. Worker 2 receives `credentialRequired:false` only for this host-managed adapter and still requires a real probe before the resource becomes callable. If no Connection Manager profile is bound, the direct session-credential path remains unchanged.

The operator can remove a saved lock without pretending the current owner record was mutated: **Forget saved lock** stops future persistence for that role during the current runtime, while the existing Worker 2 resource remains configured until the runtime reloads.

## Validation status

Code/host-event tests can establish identity fencing, bounded reads, unavailable-producer behavior, regeneration containment, stale/late containment, and listener topology. They cannot establish a real SillyTavern operator pass.

Until a director/operator runs a real installed turn, live behavior is **PENDING OPERATOR TEST** and #224 must remain incomplete.


## Automated acceptance coverage used by this wave

- `tests/deployment-live-host.test.mjs`: direct host sequence, single listener topology, user-turn narrative event, generation preparation, prompt-ready injection, assistant completion, post-turn learning, cross-chat completion rejection, no raw prompt/response capture, and mounted Jev qualification through a SillyTavern Connection Manager profile without exposing its server-side secret reference.
- `tests/wave12-sillytavern-host.test.mjs`: chat switching, stale-owner identity drop, remount/reload idempotence, missing Choice/Truth/Seal, Sensory unavailable vs owner-declared skip, late Gather/Seal containment, small-window workspace behavior.
- `tests/wave13-operator-ui.test.mjs`: workspace navigation, cross-chat Scene containment, diagnostics following chat switches, Worker 2 connection/qualification lifecycle, Lore/Memory selected-chat presentation.
- `tests/worker3-ui-producer-inspector-wave.test.mjs`: plan/injection/observation separation, raw-secret exclusion, foreign-generation delivery rejection, bounded forensic reconstruction, and regeneration containment.

These are realistic host/owner contract tests, not a substitute for the next installed SillyTavern operator turn.
