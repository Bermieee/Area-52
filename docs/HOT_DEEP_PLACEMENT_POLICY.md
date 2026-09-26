# HOT / DEEP Placement Policy — Phase 1 Wave 5

Placement is a Sidecar recommendation, not a Resource Governor decision.

HOT recommendations include generation-adjacent validation, Green Room, Precision rerank, bounded Truth judgment and Streaming Truth.

DEEP recommendations include Lore Study, consolidation, Reflection, ontology/graph enrichment, cold embeddings and compression maintenance. Wave 5 defines these contracts only; it does not implement Lore, Memory or Phase 2 cognition.

Placement output includes:
- executionClass
- preemptionPolicy
- yieldPolicy
- resumeRequired
- foregroundReserveEligibility
- runtimeDecisionAuthority: false

DEEP work yields to foreground generation. Where resumability exists, a checkpoint records completed/remaining units and the source revision fence. Resume against the same fence continues from checkpoint. A changed source/world/scene/character revision invalidates the checkpoint and requires replanning rather than blindly continuing old work.
