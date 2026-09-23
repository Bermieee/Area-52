# PromptPlan Contract

`PromptPlan` is a temporary generation-presentation artifact. It is not memory, truth, authority or canonical state.

Required identity fields include:

- `promptPlanId`, `generationId`, `turnId`;
- `contextSealId`, `sealedPacketHash`;
- `modelProfileId`, `modelProfileRevision`, `deliveryPolicyRevision`;
- optional `previousPromptPlanId` when reuse comparison is part of the declared inputs.

The plan records ordered sections, physical segments, allocation totals/targets, placement strategy, reuse decisions, cache decisions, fallbacks, dropped/deferred material, revision dependencies, world/scene revisions and a deterministic diagnostic receipt.

A plan is reconstructible from its declared packet/seal/profile/envelope/contribution/previous-plan inputs. No wall-clock timestamp or hidden cache state participates in plan identity.

### Semantic rule

A plan may change representation, order, grouping, budget and cache treatment. It may not change the sealed packet's facts, authority, temporal qualifiers, contradiction state, unresolved state or provenance dependencies.

### Disposal

The runtime does not retain a PromptPlan history. Callers may retain one explicitly as the declared predecessor for reuse comparison or later forensic tooling. Sending a plan to Main does not create memory.
