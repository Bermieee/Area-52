# Cognitive Coprocessor Wave 1 — Changelog

## Added

- provider-neutral CognitiveTask / CognitiveWorkerResult contracts;
- revision/freshness identity contract;
- typed worker failure contract;
- Turn Correlation Envelope and CloudEvents mapping;
- immutable/deduplicated Turn Event Hub;
- Dynamic Fan-Out Planner with zero-worker path;
- REQUIRED / OPPORTUNISTIC / DEFERRED semantics;
- explicit soft/hard deadline policy;
- capability profiles and Runtime-compatible descriptor mapping;
- deterministic structured-output validation and bounded retry;
- deterministic Gather Coordinator;
- disagreement/provenance/freshness-preserving GatherBundle;
- Nexus Result Bus and Context Seal boundary adapters;
- deterministic One-Key Swarm orchestration proof;
- Jev capability migration map;
- lightweight coprocessor telemetry vocabulary;
- deterministic benchmark metrics;
- Ember Tavern / Sun Blade acceptance fixture;
- 2,100-task stress fixture;
- dedicated CI workflow.

## Corrected

The older Sidecar runbook said Sun Blade was definitively destroyed CURRENT. Wave 1 aligns the copied runbook with the current golden world: the Tavern is destroyed CURRENT, while the Blade's current fate/location remains UNRESOLVED/unknown with competing credible evidence.

## Explicitly deferred

- production Historian;
- production Graph Walker;
- production Green Room;
- production Truth/Precision provider;
- Speculative Context Warmer;
- Memory Consolidation;
- Streaming Truth Monitor;
- Dapr;
- Arrow/shared-memory data-plane work;
- provider benchmarks and real token/cost measurements.
