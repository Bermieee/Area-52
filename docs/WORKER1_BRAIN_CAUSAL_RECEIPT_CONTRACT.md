# Worker 1 Brain causal receipt contract

This development-branch contract separates five different facts that must never be collapsed:

1. owner-declared expected work;
2. logical Runtime admission;
3. physical execution;
4. result return;
5. explicit owner admission and, when required, Settlement.

A configured resource, qualified provider, scheduled task, or Cognitive Choice admission is **not** physical execution evidence.

## Bounded causal evidence

Runtime stores at most 64 causal receipts per task. A receipt contains only identifiers, finite lifecycle/reason codes, exact chat/turn/generation/correlation identity, revision fences, parent/consumer IDs, duration when measured, and explicit owner acceptance. Raw prompts, story/Lore bodies, credentials, provider output bodies, and hidden reasoning are excluded.

NativeBrainSelectedTurnReceipt@2 projects the same boundary into Worker 3's selected-turn journal. Missing host/provider/optional-owner evidence is NO_EVIDENCE; it is never inferred from configuration.

## Owner obligation reconciliation

CognitiveObligationReconciler accepts only explicit owner declarations carrying ownerSignalId. It can report DONE, DUE, BLOCKED, FAILED, SKIPPED_WITH_REASON, DEFERRED, STALE, or LATE. It may admit missing work only when the owner declaration has an executor and its declared prerequisites are already DONE.

Default completion requires physical execution, result return, and explicit owner admission. Owners that require canonical mutation can additionally require SETTLEMENT.

## Worker boundaries

Scene, Lore, and Memory remain authoritative for their own claims and durable changes. This contract does not make Truth, Retrieval, Runtime, optional Jev, or provider scores canonical. Worker 2 remains the optional-resource/Scene execution owner; Worker 3 remains the UI/Diagnostics presentation owner; Worker 4 remains the Lore owner.

## Exact host observation and delivery identity

Worker 1 exposes bounded host evidence without copying prompt or story bodies. Host observation and provider-delivery evidence are fenced to the selected chat, turn, generation and correlation identity. Prompt delivery additionally checks the Context Seal ID, sealed packet hash and semantic-manifest identity. Cross-generation or cross-Seal evidence is rejected or recorded as a mismatch rather than attached to the selected turn.

Owner expected-work declarations are snapshot-safe. Reload restores declarations and revision fences but intentionally does not restore an executor claim; an owner must reattach a real executor before reconciliation may admit missing work.

## Scatter/Gather load finding and layered design

The current NativeTurn Runtime admits every supplied REQUIRED, OPPORTUNISTIC and DEFERRED job into the scheduler immediately. The Worker 1 deterministic load probe uses nine jobs: 2 REQUIRED, 4 OPPORTUNISTIC and 3 DEFERRED. It records all 9 queued before execution, including 7 jobs that are not Seal-critical. This is evidence of avoidable pre-Seal queue pressure; it is not evidence that job count alone should change routing.

The proposed layered Scatter contract is: current and cheap owner evidence plus REQUIRED work first; conditional retrieval expansion only when freshness, quality or ambiguity evidence warrants it; bounded optional Jev or Precision only while a foreground decision still depends on it; and DEFERRED or deep work after Seal. This wave records the measurement and contract only. Activating that scheduling policy remains an execution-owner integration change and requires before/after time-to-Seal and peak-resource evidence.

## Adaptive Context inherited defect

The 4,096-token `small and large delivery budgets preserve protected truth/source identity while optional lore is omitted without authority promotion` case remains intentionally non-green. On this branch it fails at the large-plan assertion because one section is dropped or deferred when the test requires zero. Worker 1 does not treat that as repaired by the causal/provider-role changes.

## Assembled owner paths

Scene REQUIRED retrieval needs now enter the expected-work journal from the real Scene integration signal. Sensory/Truth execution can supply physical-execution and result-return evidence, but Scene owner acceptance remains explicitly missing until the Scene owner publishes it; the reconciler therefore stays DUE instead of manufacturing completion.

Lore `LoreSourceRevisionChanged` events register the owner's `studyObligationId` as expected work. Worker 1 does not invent Lore study execution or acceptance. Those stages remain DUE until the Lore owner path supplies evidence.

Post-turn Memory writeback is reconciled at the real `admitExternalEvidenceMapping` boundary. An attached Memory owner that returns `ADMITTED` yields physical, returned, and explicit owner-admission stages and can reconcile DONE. When the optional Memory owner is not attached, the row is `SKIPPED_WITH_REASON / OPTIONAL_RESOURCE_UNAVAILABLE` while native Brain learning remains available.

Direct owner evidence is retained in the reconciler snapshot with the same bounded causal receipt shape as Runtime evidence. Reload therefore preserves returned/rejected evidence without restoring a fake executor. Owner rejection remains FAILED after reload.

## Layered Scatter planning contract

`planLayeredScatter()` is now a non-activating Runtime planning contract. It partitions admitted work by result class and an explicit foreground-dependency declaration: REQUIRED or declared foreground dependencies are Seal-critical; other OPPORTUNISTIC work is conditional; DEFERRED work is post-Seal. The planner explicitly records `jobCountIgnored:true` and `schedulingActivated:false`, so this wave does not silently change Worker 2 routing.

## Final bounded-evidence hardening

Direct owner evidence retains at most 64 causal receipts per expected-work row while keeping a monotonic evidence sequence in the durable reconciler snapshot. Eviction therefore cannot cause receipt-ID reuse after the retention window wraps.

NativeTurn Runtime accepts optional `chatId` and `generationId` on the turn envelope, propagates them with turn/correlation and source/world/scene revision fences into the normalized job obligation, and emits the same identity on causal receipts and result envelopes. Legacy callers may omit the two fields; selected-turn Brain integration must provide them when exact generation attribution is required.

The execution probe confirms the proposed layered partition reduces peak queued work from 9 to 2 for the measured fixture while both eager and layered cases perform exactly 2 provider invocations before the foreground quorum seals. Eager execution leaves 7 non-required tasks open at Seal; the layered fixture leaves 0. `foregroundProviderWorkDelta` is 0 and `productionRoutingChanged` remains false: this is evidence for a future execution-owner scheduling change, not an activated production policy.

A missing Memory owner writeback receipt is now represented consistently as `NO_EVIDENCE` in both obligation reconciliation and the selected-turn UI receipt. Physical invocation alone cannot promote the Memory stage to owner accepted.


## Worker 4 Lore owner receipt consumer

Brain now accepts the bounded Worker 4 `LoreStudyRunReceipt` as owner evidence through `recordLoreStudyOwnerReceipt()`. It does not schedule, execute or approve Lore work. A matching declared `studyObligationId` is required first.

- `COMPLETED` records physical execution, returned result and Lore owner admission.
- `CHECKPOINTED` records physical execution and a returned partial result but remains DUE because owner admission is still missing.
- `FAILED` or `INVALID` records failed work.
- `SUPERSEDED` records stale work.
- Unknown obligation IDs remain `NO_EXPECTED_WORK` and do not create obligations.
- Replayed owner receipts reuse deterministic receipt IDs, so the bounded causal journal does not duplicate the same owner evidence.

No raw Lore bodies, prompts, credentials or hidden reasoning are copied into the reconciliation receipt.

## Broad CI validation window

The broad Cognitive Core job previously had a 10-minute job timeout while the growing `npm test` suite alone could consume most or all of that budget, causing exact-head runs to be cancelled before later acceptance steps. Development-Nexus now uses a 20-minute job timeout so broad exact-head validation can complete; this changes validation capacity only, not runtime routing or product behavior.
