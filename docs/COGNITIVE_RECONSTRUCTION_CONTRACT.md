# Cognitive Reconstruction Contract

`CognitiveReconstructor` rebuilds bounded decision/change chains from the Cognitive Transaction Ledger using stable correlation, causation, revision, artifact, turn and generation references.

Reconstruction preserves original transaction order and historical records. Internal cognitive causation links use transaction IDs; missing links return `PARTIAL_RECONSTRUCTION` and explicit missing references instead of inferred replacement evidence. Cycles are detected and reported rather than recursively followed.

External Runtime Work Ledger, Result Bus, Settlement, PromptPlan, Context Seal and Sidecar telemetry references remain references. Their authority is not duplicated into the transaction ledger.

Source-edit reconstruction therefore preserves both the old source revision trail and the later invalidation/relearning trail. Late or stale work is reconstructible as late/stale and cannot be retroactively described as participating in an already sealed generation.
