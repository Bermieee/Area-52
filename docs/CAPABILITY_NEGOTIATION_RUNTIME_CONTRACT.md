# Capability Negotiation ↔ Runtime Contract

Phase 1 Wave 2 keeps cognition semantics in the Sidecar and scheduling authority in Runtime.

`createCapabilityRequirement(task)` converts a `CognitiveTask` into provider-neutral requirements: versioned primary capabilities, ordered fallback capability sets, cognitive layer, HOT/DEEP placement, foreground/background eligibility, context/output requirements, structured-output requirement, latency/cost budgets, resource hints and result class.

`negotiateCapabilities(registry, task, constraints)` returns a `CapabilityNegotiation` containing requested capabilities, eligible implementation descriptors, degradation/fallback-set information, missing capabilities, capability incompatibilities and non-capability constraint failures. It intentionally carries `schedulingDecision: null` and `authorityGranted: false`.

Runtime may select one eligible `profileId` and pass it back to the provider execution layer. Provider/model identity remains implementation metadata. Changing MiMo, GLM, DeepSeek or another compatible implementation does not change task schema, compiler lane, freshness rules, Settlement rights or Context Seal rights.

Failure reasons are explicit for unavailable/unhealthy providers, saturated concurrency, foreground/background ineligibility, unsupported layer/placement, missing structured output, context/output overflow, cost and latency budgets, and capability version mismatch.
