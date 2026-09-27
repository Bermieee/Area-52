# Cognitive obligation reconciliation and causal telemetry

The existing Lifecycle Core owns durable task obligations; the Work Director owns execution. `CognitiveObligationReconciler` adds an owner-supplied expectation check: for a source or turn revision, which steps were expected, which durable tasks exist, what completed, and why a step is still missing or blocked.

Owners provide ordered `stepId` entries with a revision-specific `dedupeKey`, an obligation, optional `dependsOn` step IDs, an executor, and a compact event cause. `inspect()` is read-only. `reconcile()` submits a missing step only when its prior expected steps are done and an executor was supplied. It never fabricates work, calls a provider, accepts an owner result, or grants canonical mutation authority on its own. A Jev decision can be one owner-defined step, but its result remains a proposal requiring the owner's separate admission contract.

Each reconciliation row reports `MISSING`, `DUE`, `BLOCKED`, or `DONE` with a reason and task ID. Runtime task records preserve an event type, event ID, correlation ID, and turn ID; payloads and credentials are excluded. `WorkerDirector.explainObligation(taskId)` returns the task's status, cause, dependency statuses, bounded progress counts, and observed owner→Runtime and Runtime→worker handoffs. Those handoffs can be reconstructed from the durable ledger after a reload. `WorkerDirector.snapshot().lifecycle` now exposes owner, task type, cause, and reason for existing UI/diagnostic consumers.

Example owner expectation after `SOURCE_CHANGED`:

```text
study source revision -> update index -> publish retrieval readiness
```

If study has no executor, the first step is `BLOCKED: executor-not-provided`; index remains `BLOCKED: dependency-not-done:study`. If study is admitted but no compatible resource is available, the durable task remains eligible while execution reports `no-compatible-provider-or-resource`. Once the owner supplies a compatible resource and the task completes, a later reconciliation may admit indexing. Repeating the same expectation uses the revision-specific dedupe key rather than duplicating work.

This is the Runtime foundation, not a claim that every Lore, Scene, Memory, and Brain lifecycle is already declaring expectations. Those owners must publish their expected steps and owner-acceptance receipts for a complete cross-system lifecycle trace. UI may consume the new read fields but should not infer successful owner acceptance from worker completion.
