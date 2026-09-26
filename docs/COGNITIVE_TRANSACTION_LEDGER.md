# Cognitive Transaction Ledger

The Cognitive Transaction Ledger records meaningful knowledge decisions and publications. It is distinct from Runtime Work Ledger execution history and from telemetry.

Each append-only `CognitiveTransaction` carries stable transaction/type identity, monotonic sequence/timestamp, correlation/causation identifiers, optional turn/task/generation identifiers, subsystem/owner, before/after revisions, source revision IDs, affected artifact IDs, authority context, decision/outcome, receipt references, reason code, provenance, bounded metadata and retention class.

The built-in transaction vocabulary covers source revision admission, proposals, Settlement results, supersession/contradiction, hypotheses, reflections, operator override, Context Seal, PromptPlan delivery, invalidation, reconsolidation and result routing. `CognitiveTransactionTypeRegistry` allows future types without kernel switch statements.

The ledger is append-oriented. Existing transactions are never rewritten when newer truth supersedes them. Reusing a transaction ID with identical content is idempotent; conflicting reuse fails. The ledger exposes no Settlement or world-state mutation method: a record that says `CURRENT` cannot make anything CURRENT.
