# UI.Core Wave 11 — Live Brain Receipt Binding

## Purpose

Wave 11 makes the existing Phase-2 Brain, PromptPlan and Forensics UI dependable when Director assembly connects real Core, Scene, Lore, Runtime, Jev, Gather, Context Seal and PromptPlan producers.

The production entry point remains createWave6ProductInterface() with a hostBindings bundle. The host may supply readSelection, subscribe, Scene, Hot Cognition, Lore status, Cognitive Choice, scatter/runtime jobs, Candidate Bus/Sensory, Truth, corrective retrieval, Jev, Precision, Gather, Context Seal, PromptPlan, Context Receipt, Forensics and CognitiveTransaction readers.

UI.Core does not create another shell, Signal Hub, scheduler, Inspector, event bus or polling loop. The bundle is adapted into the existing Wave 6–10 production seams.

## Host selection contract

readSelection() supplies the host's currently selected cognitive context when available:

- chatId / chat namespace;
- turnId;
- generationId;
- correlationId;
- worldRevision;
- sceneRevision;
- sourceRevisionRefs[].

Readers receive the same selection object. They may return null when no record exists for that selection. A live producer must not return an unrelated previous-turn receipt as a convenience fallback.

## Coherence boundary

Wave11LiveReceiptBinding validates identity that a producer actually publishes. When both selected context and receipt contain a field, chat, turn, generation, correlation, world revision, Scene revision and source revision fences must agree.

A mismatch is contained at the affected stage. It is not allowed to fill a different turn's missing stage.

Historical generation inspection deliberately detaches current-turn correlation/revision fences unless the historical reader publishes its own matching identity.

Forensic list readers are filtered to the selected turn/generation/correlation when those identities are available. Unknown rows are not used to fill the selected forensic timeline.

## Strict live-receipt behavior

Fixture/review behavior and production behavior are intentionally separate.

In production/live mode:

- a missing Sensory/Candidate Bus receipt stays missing unless Cognitive Choice explicitly recorded retrieval as SKIPPED;
- a missing Truth receipt stays missing;
- an executed corrective pass requires its own receipt;
- an invoked Precision stage requires its own receipt;
- an executed Jev outcome requires a JevDecisionReceipt;
- an explicit Cognitive Choice Jev SKIPPED or UNAVAILABLE state may be displayed as the choice policy result;
- Gather requires a Gather receipt;
- Context Seal requires a Context Seal receipt;
- PromptPlan requires its production reader.

UI.Core does not infer that work completed from worker activity, architectural expectation, or another turn.

## LIVE / FIXTURE / DEGRADED / UNAVAILABLE

The source grammar remains the Wave 6 contract.

- LIVE — current producer returned a coherent record.
- FIXTURE — explicit review/test mode only.
- DEGRADED — producer read failed or a returned receipt conflicts with a safety/coherence boundary.
- UNAVAILABLE — no producer or no record for the selected context.

fixture and hostBindings are mutually exclusive in createWave6ProductInterface(). Production cannot silently fall back to the Ember Tavern fixtures. A stale/future revision failure is displayed as DEGRADED mode with STALE health for that stage.

## Cognitive Choice display

Wave 11 may consume richer #225-style receipt fields when Core publishes them: functionDecisions, ADMITTED/SKIPPED/DEFERRED disposition, reason code, expected value, resource cost, freshness requirement, deadline class, logical capability, execution resources, and measured saved-work fields.

This is display-only. UI.Core does not decide which functions run and does not estimate avoided backend work. Measured avoided work appears only when the receipt publishes measurements.

Logical jobs remain distinct from execution resources. One resource may service many jobs and many resources may service jobs concurrently without changing the semantic choice display.

## Jev boundary

Jev remains separate from Sidecar/coprocessor execution, Truth and owner Settlement. An invoked Jev stage without its typed decision receipt remains unavailable in strict live mode.

A Jev receipt may show DECIDED, PARTIAL, UNRESOLVED, ABSTAINED, ESCALATE_OWNER, REQUEST_OPERATOR, STALE or INVALID. None of these grant canonical authority in UI.Core. Confidence remains metadata, not authority.

## Gather / Context Seal safety

Gather statuses remain ADMITTED, STALE, LATE, REJECTED or INVALID.

If a producer supplies a Context Seal that claims a result was admitted while the selected Gather receipt marks that same result LATE, STALE, INVALID or REJECTED, UI.Core preserves the producer receipt for Advanced inspection, marks the Seal display degraded, excludes the conflicting ID from the safely displayable admitted-result count, and does not rewrite backend state.

This protects the operator surface from implying that late cognition changed an already sealed generation.

## Host lifecycle

The existing UI.Core lifecycle owns the binding. One host mount creates one Wave11LiveReceiptBinding, which feeds the existing Wave8 cognition adapter, Signal Hub, Render Scheduler, Brain, Inspector and Forensics surfaces.

On a host chat/turn/generation switch:

- binding selection updates;
- generation explainability bookmark rebinds;
- stale Inspector selection clears;
- pending Inspector render work is cancelled;
- one UI_HOST_CONTEXT_CHANGED signal is published through the existing Signal Hub;
- current workspace and Quick Dash refresh through the existing Render Scheduler.

Same-turn receipt updates refresh the selected workspace/Inspector without clearing the selection.

Destroy releases the one host subscription and then follows the normal UI.Core adapter/scheduler/signal cleanup. There is no UI polling loop.

## Phase-2 review shell

demo/phase2-shell/ remains an explicit DEMO / FIXTURE DATA review entry. It is not converted into a fake live host and does not constitute #224 live acceptance.

## Director assembly inputs still required

Wave 11 provides the UI port, not the backend producers. The assembled branch still needs compatible live producers for the current host selection and whichever cognitive stages are intended to appear: Scene, Hot Cognition, Lore, Cognitive Choice, Runtime scatter/jobs, Candidate Bus/Sensory, Truth, corrective retrieval, Jev, Precision, Gather, Context Seal, PromptPlan/Context Receipt, Forensics/CognitiveTransaction and optional Runtime/product readers.

Missing optional producers remain visible as unavailable/degraded rather than blocking the native Brain UI.
