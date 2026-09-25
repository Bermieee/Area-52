# Capability Profile Registry — Phase 1 Wave 5

This is the Wave 5 canonical provider-neutral capability profile contract.

A CognitiveTask requests capabilities, never a named model. Provider identity is operational provenance only and never epistemic authority.

Required profile surface:
- providerProfileId / profileId
- capabilities and capability versions
- health and availability
- resourceClass and latencyClass
- foregroundEligible and backgroundEligible
- maxConcurrency / current load
- maxContext and maxOutput
- structuredOutputSupport
- estimatedCostClass
- local / remote metadata
- fallbackCapabilities

Capability negotiation returns eligible profiles, degraded alternatives when a declared fallback capability set is used, and explicit missing requirements. It returns schedulingDecision: null. Runtime owns worker selection and execution.

Operational health states are HEALTHY, DEGRADED, SATURATED, UNAVAILABLE, COOLDOWN and PROBE. Legacy unhealthy maps to unavailable/ineligible; DEGRADED remains a usable but explicitly degraded operational profile.

Capability versions are compared independently of provider identity. Optional capability absence does not block execution. Required capability absence produces UNSATISFIED.

No provider profile field grants SOURCE_CANON, OBSERVED, SETTLED, INFERRED or any other truth authority.
