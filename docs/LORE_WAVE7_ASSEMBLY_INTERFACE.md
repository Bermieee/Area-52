# Lore Wave 7 Assembly — Worker 3 Interface Handoff

## Candidate boundary

The owner backend is assembled on `Integration-Lore-Wave7` from `main@c671fbf7ff603b04311f9fe7e82ca050049354f2` with Lore source `f983d4de9168ce3a6add1ec002a3372b96b873b9`.

Worker 4 owns the Lore owner/host contract. Worker 3 owns visible UI. This candidate intentionally does **not** edit `src/ui-core` and does not claim Settlement is visible in SillyTavern yet.

The selected Lorebook discovery seam already exists in Worker 3's SillyTavern host adapter. It yields exact SillyTavern UIDs/content plus a `SillyTavernLorebookDiscoveryReceipt`; the assembled study owner rejects invented fallback Lorebook identity.

## Study owner

Bindings exported by `DevelopmentDeploymentBrain.hostBindings()`:

- `loreIntelligenceService`
- `loreStudyService`
- `loreOperatorHost` / `loreStudyHost` / `loreHost`
- `loreBrainInterface`

Study actions: `acceptLorebook`, `submitLorebook`, `ingestLorebook`, `runLoreStudy`, `startLoreStudy`, `retryLoreStudy`.

Acceptance is not readiness. UI should continue to use owner status / entry states and not infer learned or retrieval-ready state from an acceptance receipt.

## Authoring owner

Bindings exported:

- `loreAuthoringService`
- `loreAuthoringHost`
- `loreAuthoringOperator`

The host is `LoreAuthoringOperatorContract` v2. Except for the assembly-only `availability` read, owner methods use the safe result shape:

```text
{ ok: true, value, error: null }
{ ok: false, value: null, error: LoreAuthoringError }
```

Read models:

```text
sourceDiscoveryIdentity
reviewStates
worker1InvalidationContract
worker3AuthoringContract
progress
draftReview
finalPreview
settlement
worker1Receipts
availability
```

Actions:

```text
previewEditImpact
semanticChangeReport
proposeTree
previewMerge
startTreeBuild
startMergeBuild
resumeAuthoringBuild
recordDraftDecision
reclassifyAfterTaxonomyEdit
computeFinalPreview
approveFinalPreview
applySettlement
restoreSettlement
```

## UI state machine

Worker 3 should present the owner lifecycle without manufacturing success:

```text
startTreeBuild/startMergeBuild
  -> BUILDING or CHECKPOINTED
  -> resumeAuthoringBuild until DRAFT_REVIEW
  -> draftReview
  -> recordDraftDecision (ACCEPT / CHANGE / DEFER / REJECT) per action
  -> optional reclassifyAfterTaxonomyEdit
  -> computeFinalPreview
  -> FINAL_PREVIEW only when deterministic validation is valid
  -> approveFinalPreview with explicit operatorApprovalId
  -> READY_TO_SETTLE
  -> applySettlement in bounded batches
  -> CHECKPOINTED or SETTLED
  -> optional restoreSettlement
  -> RESTORING / CHECKPOINTED / RESTORED
```

If a source/dependency/output fence changes, the owner returns the plan to Draft Review or reports a safe blocked/failed state. The UI must display that state; preview success is never Settlement success.

`availability()` is the assembly read for the contract itself. If the owner contract is absent, Worker 3's existing adapters already fail closed with explicit unavailable errors. Do not synthesize an Apply control from preview capability alone.

## Worker 1 receipts

After a guarded Settlement or restoration, the deployment host records `LoreWorker1SettlementReceipts` containing exact `LoreSourceRevisionChanged` events and `LoreInvalidationReceipt` records. The normal `LoreStudyRuntime` backlog remains the only study queue.

The live host forwards **only newly accepted revision events** to an attached native Brain invalidation contract. Resume/reload does not re-forward already fenced events.

## Current visible-UI gate

Worker 3's current `Wave13LoreAuthoringUIAdapter` remains intentionally `destructiveApply: false`. That is correct for this candidate: backend actions are assembled and tested independently, but no Worker 4 commit claims the visible Settlement controls exist.

Required real SillyTavern acceptance remains open until an operator:
1. selects two real World Info Lorebooks;
2. loads/accepts/studies both;
3. reviews and explicitly approves a Tree or merge Final Preview through Worker 3's eventual controls;
4. applies Settlement;
5. reloads and resumes any pending work;
6. verifies changed/new sources alone enter study backlog;
7. restores and confirms original authored source remains recoverable.
