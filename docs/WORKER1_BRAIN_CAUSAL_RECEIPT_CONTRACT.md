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
