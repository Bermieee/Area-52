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
