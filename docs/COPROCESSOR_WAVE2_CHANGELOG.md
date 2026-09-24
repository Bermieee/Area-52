# Coprocessor Phase 1 Backlog Wave 2 — Changelog

- Added `CapabilityNegotiation` and provider-neutral `CapabilityRequirement` structures.
- Added profile-level incompatibility and constraint-failure diagnostics without returning a scheduling decision.
- Added `profileId` to Runtime capability descriptors and a Runtime-selected provider execution option.
- Added canonical Framework `CognitiveEventEnvelope` TURN_EVENT producer/consumer adapters with duplicate safety.
- Expanded Runtime obligations with soft/hard deadline budget, quality weight, fallback contract, resource hints, HOT/DEEP placement, yield legality, checkpoint/resume identity and explicit no-authority flags.
- Added Core-compatible exact-revision Artifact References, bounded slice retrieval and typed reference status.
- Added browser-native Cognitive Data Plane transfer benchmarks and transport compatibility matrix.
- Added integration benchmark measurement-state contract.
- Added intent-opposite precision corpus and deterministic precision adapter seam for #42 follow-up.
- Added FT005 provider qualification runner and external provider readiness script.
- Added deterministic integration tests and Wave 2 integration stress tests.
- Preserved Wave 1 browser-safe, freshness, Gather, Context Seal, Green Room and provider-neutral behavior.
- No new branch, no Runtime/Core/Scene/Memory merge and no merge to `main`.
