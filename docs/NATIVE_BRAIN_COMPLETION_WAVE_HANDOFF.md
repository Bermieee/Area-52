# Area-52 Native Brain Completion Wave — Worker 1 handoff

## Evidence labels

- **DETERMINISTIC:** Node regression and exact published Lore/Memory owner integration.
- **HOST-CONTRACT:** `Area52NativeBrain.runTurn(input,{generate,completeOptions})` passes the sealed `prepared.rendered` payload to the supplied generation callback and learns only after that callback returns.
- **LIVE:** not claimed by Worker 1. A real assembled SillyTavern Send -> model request -> response -> completion loop still belongs to Worker 3/integration.

## Coordination snapshot

At the start of this wave:
- `Development-Nexus`: `be10eb8923631f4697bad8abb38d733a25f465eb`
- `main`: `d610b70e566514b9edbcbca8b27ee27ac42e8f94`
- Lore owner: `Development-Lorebook-Editor@0adfdf9ae7221905baab2ea9c8f36f3c47b84c37`
- Memory owner: `Development-Memory@51aa0d6e7293ddeaa3899e81f6699794d0c22b2c`

Worker 3's newer `main` is authoritative for UI/host files. This branch does not merge or overwrite it.

## Completion-wave fix

Authored Lore revisions now have a durable Brain-side admission fence.

When `LoreSourceRevisionChanged` arrives, the replaced revision is immediately distrusted, dependent Hot Cognition is invalidated selectively, and the replacement remains `PENDING_EXACT_RETRIEVAL`. Owner Lore retrieval must then return exact authored drillback fenced by the expected revision. If the owner exposes `sourceRevision(sourceId)`, that current revision must also match. Only then does the Brain mark the replacement trusted.

The distrust/pending/trusted state survives Brain snapshot/reload. A stale self-fenced owner packet therefore cannot resurrect the replaced revision into Candidate Bus, Truth, Gather, or Context Seal after an edit or reload. Unrelated Lore remains independently admissible.

## Worker 3 generation hook contract

For each selected story/chat, own one Brain instance or restore it from the story's persisted Brain snapshot. Attach the current Lore `brainInterface()` and Memory `MemoryIntegrationSurface`; route Worker 4 `LoreSourceRevisionChanged` events into `brain.acceptLoreRevisionChange(event)` before the next generation.

For a real generation:
1. Resolve stable `chatId`, unique `turnId`, `generationId`, and optional `correlationId`.
2. Push the current Scene owner signal with `brain.observeScene(chatId, signal)`, or pass that signal as `sceneSignal` to `runTurn`.
3. Call `brain.runTurn(input,{generate,completeOptions})`.
4. The `generate` callback receives `prepared.rendered` plus `selection`, `promptPlan`, and `contextSealReceipt`. Put that exact rendered payload into the actual SillyTavern model request. Do not rebuild semantic context from UI rows.
5. Return the actual assistant response text from `generate`.
6. Only after the response returns does `runTurn` call `completeTurn`, admit exact narrative experience, mirror validated Core settlements to Memory, and schedule non-canonical learning feedback.
7. Persist `brain.snapshot()` at a host-owned durable checkpoint after completion/correction.

The current `main/src/deployment/sillytavern-live.js` demo injects a PromptPlan with `setExtensionPrompt` around `DevelopmentDeploymentBrain`; that is not equivalent to this callback contract and must not be counted as Native Brain live acceptance.

## Expected UI receipts

Pass `brain.uiBindings()` into the current Wave 12 host binding surface. Worker 3's current allowlist already accepts the relevant families. Expected owner reads include selection, Scene, Hot Cognition, Cognitive Choice, Scatter, Sensory/Candidate Bus, Truth, corrective retrieval, optional Jev/Precision, Gather, Context Seal, Lore status, Memory status, Runtime status, PromptPlan, context receipt, and generation list/read. Subscription events are stage + selection only and contain no raw prompt/response.

## Live end-to-end acceptance procedure

Use a real SillyTavern story and real generation provider. Capture receipts for:
- user Send creates one stable turn/generation identity;
- Scene observation is current before Brain preparation;
- Context Seal is sealed before the provider call;
- the actual provider request contains the exact `prepared.rendered` semantic payload for that seal;
- late/stale results are absent from that request;
- provider response returns before `TURN_LEARNED`;
- exact narrative experience is recoverable afterward;
- Memory write-back/settlement receipts correspond to that same turn/generation;
- a quiet continuation records retrieval as explicitly skipped when Hot is sufficient;
- a Lore edit immediately excludes the replaced revision and the replacement appears only after exact owner retrieval;
- reload preserves the current world, seal history, and Lore revision distrust/trust state.

Only that assembled run should be labeled **LIVE**.

## Integration route into main

Do not merge `Development-Nexus` wholesale: `main` and the Brain branch have diverged from `ba4619f56db8e4f94873256dc26589e1680b7d29`, and `main` contains Worker 3 UI/deployment work that must remain authoritative.

Integration should transplant/reconcile the Native Brain source set and its Core contract changes onto the then-current `main`, while retaining Worker 3's `src/ui-core/**`, `demo/**`, and host/deployment edits. The critical Worker 1 source surfaces are:
- `src/native-brain.js`
- `src/native-knowledge-store.js`
- `src/native-learning-feedback.js`
- `src/owner-knowledge-channels.js`
- the Worker 1 `src/runtime/**` native execution support used by Native Brain
- the corresponding Core revisions in Cognitive Choice, Cognitive Core, Sensory Net, Truth, Context compiler/seal/publication, Result Bus, source/temporal state, and prompt delivery.

Re-run the merged main tests rather than resolving overlaps by taking either branch wholesale. Keep the exact Worker 4 owner refs above until a newer owner head is explicitly revalidated.

## Standing cards

- **#27 Hot Cognition:** quiet Hot-only path and selective Lore-dependent invalidation are deterministic evidence; live assembled Scene/host acceptance remains.
- **#6 Sensory Net/Candidate Bus:** Lore/Memory nominations, provenance, dedup/revision fencing, stale Lore rejection, and independent owner degradation are deterministic evidence; umbrella card remains open.
- **#5 Temporal State Graph:** current/historical/unresolved correction and exact Core -> Memory settlement mapping are exercised across turns/reload; live host does not change Settlement ownership.
- **#11 Runtime Fabric:** bounded local feedback, cancellation/recovery primitives, checkpoint/reload, and sealed late-result containment remain native; broader owner/runtime epic work remains outside this branch.
- **#39 Learning Feedback:** exact completed narrative is retained and feedback remains non-canonical; unsupported text is not promoted to canon.
- **#133 Adaptive Context Runtime:** sealed source-backed context reaches the generation callback before learning; real SillyTavern provider delivery is still the remaining live gate.

## Remaining native/assembly deficiencies

The Native Brain is not “100% complete.” The remaining acceptance gap is the assembled SillyTavern host loop on current `main`, plus exact-head CI for this completion-wave commit. If CI is queued, the wave remains validation-pending.
