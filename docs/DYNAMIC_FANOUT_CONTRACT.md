# Dynamic Fan-Out Contract

Wave 3 replaces fixed worker wake-up with a bounded expected-value plan. `DynamicFanOutPlanner` consumes provider-neutral turn, Scene, cache, retrieval, capability, health/load, latency, cost, and revision signals. It does not select a provider or Runtime execution slot.

Each accepted nomination exposes role/task type, required capabilities, result class, expected value, reason codes, required inputs, freshness fence, cost estimate, latency class and fallback. Provider identity is null and canonical authority is false.

Independent deterministic caps bound total workers, foreground workers, opportunistic workers, background nominations, estimated cost units and aggregate foreground deadline exposure. Missing capabilities, unavailable/unhealthy roles and saturated roles are not nominated. Runtime Resource Governor remains final execution owner.

Zero workers is a successful plan when hot state already satisfies the turn or no eligible cognition clears the expected-value threshold.
