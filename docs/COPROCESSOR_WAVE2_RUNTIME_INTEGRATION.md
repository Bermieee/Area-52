# Cognitive Coprocessor — Phase 1 Backlog Wave 2 Runtime Integration

Starting checkpoint: `Development-Sidecar/Jev@bbc19573a4bedc246f0f7d1851bd61276f40f7f6`.

This wave completes Sidecar-facing Runtime/data-plane contracts without taking Runtime ownership and without starting Phase 2 Provider Intelligence.

Implemented surfaces:

- provider-neutral capability requirement and negotiation contract;
- Runtime-selected provider profile execution seam;
- Framework-shaped canonical `TURN_EVENT` adapter with version/fence/dedupe preservation;
- richer Runtime obligation metadata for HOT/DEEP, deadlines, fallback, checkpoint/yield/resume and quality weight;
- Core-compatible exact-revision Artifact Reference contract and Cognitive Data Plane;
- bounded slice retrieval and stale/superseded/missing/invalid reference outcomes;
- payload-vs-reference transport benchmark with explicit unavailable metrics;
- benchmark result status (`MEASURED` / `NOT_MEASURED` / `NOT_APPLICABLE`);
- intent-opposite precision benchmark corpus and provider-neutral adapter seam;
- FT005 real-provider readiness harness with external configuration and forced-A-outage drill;
- permanent browser-safety and authority-negative regressions;
- new pressure tests for 2,500 capability negotiations, 1,200 artifact-reference operations and 1,500 duplicate Turn Event deliveries/mixed obligations.

Runtime still owns scheduling, Resource Governor, Event Spine delivery, worker pools, Work Ledger, batching infrastructure, yield/resume lifecycle and backpressure. Core still owns Artifact Registry/Repository semantics, Result Bus, Truth, Settlement, Context Compiler and Context Seal.

Explicitly not started: speculative warmer #77, durable Green Room #78, continuous consolidation #79, learned provider selection, predictive/meta cognition and autonomous self-maintenance.
