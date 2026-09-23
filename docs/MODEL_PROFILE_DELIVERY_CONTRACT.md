# Model Profile + Delivery Adapter Contract

A `ModelProfile` contains presentation policy only:

- schema/revision identity;
- context window and reserved generation tokens;
- role/system capabilities;
- structured-context preference;
- position order;
- stable/revisioned/volatile band mapping;
- segmentation strategy;
- cache characteristics;
- token-estimator identity;
- segment constraints;
- long-context/fallback policy;
- adapter identity;
- delivery-policy revision.

Wave 4 ships two deterministic reference profiles:

- `CACHE_STABLE` — band-grouped presentation and stable-prefix reuse emphasis;
- `RECENCY_WEIGHTED` — slot-atomic segmentation and current-state proximity emphasis.

These names are test policies, not provider performance claims.

## Adapter boundary

Adapters receive a valid PromptPlan and may only render it. They cannot retrieve facts, settle claims, change authority, strip temporal qualifiers or introduce post-seal semantics.

The runtime validates the adapter's semantic manifest and seal identity after rendering. Mutation produces `ADAPTER_SEMANTIC_MUTATION`/integrity rejection before the rendered input is accepted.
