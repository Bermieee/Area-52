# Nexus vs Area-52 Shadow Context Scorer

The shadow scorer is evaluation-only qualification infrastructure for #45.

Inputs are explicit Nexus and Area-52 context candidates, generation/turn identity, and ground-truth or replay evaluation references. A candidate carries no authority and cannot affect live generation.

`ShadowComparisonReceipt` reports independent metrics for:
- relevance;
- stale facts;
- missing continuity;
- CURRENT-state correctness;
- historical-state correctness;
- unresolved-thread coverage;
- provenance coverage;
- unnecessary context;
- byte size;
- latency;
- next-beat usefulness.

Measurement states are MEASURED, REPLAYED, NOT_MEASURED and NOT_APPLICABLE. An unavailable latency is NOT_MEASURED with value null, never zero.

The scorer does not emit an automatic winner. `winner` remains null because incomplete or incomparable metrics cannot justify a global verdict.

The Ember Tavern fixture proves that adding a false CURRENT claim — Sun Blade current location = Ember Tavern — lowers the candidate's current-state correctness while the correct Area-52 candidate preserves the historical/current distinction.

Import/export replay is deterministic so recorded Nexus candidate structures can be evaluated later without inventing Nexus behavior. Live representative qualification remains #181.
