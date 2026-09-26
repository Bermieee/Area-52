# Wave 11 — Native Coprocessor + Optional Jev/Sidecar Contract

Version: `11.0.0`

## Rule

The ordinary Area-52 path is native-first. `createNativeCoprocessorServices()` performs no network call, requires no external plugin/service/database/provider, and registers the built-in deterministic capability inventory. Optional Jev and sidecar slots exist only when the host explicitly supplies configuration and an adapter.

The native turn path deterministically filters unavailable, stale, and hard-rejected choices. One surviving choice may be returned as a bounded native decision. Multiple viable choices remain `UNRESOLVED` and may suggest optional `SEMANTIC_JUDGMENT`; zero viable choices remain `UNRESOLVED`. None of these results settle owner state.

## Optional resource boundary

Optional slots declare kind (`JEV` or `SIDECAR`), slot/profile/provider IDs, capabilities, locality, health, concurrency, placement, latency/cost classes, structured-output support and limits. Missing, disabled, unavailable, overloaded, or incompatible slots are reported as degraded rather than silently replaced by an external service.

Capability negotiation is descriptive. The contract exposes eligible profiles but makes no Runtime/Worker Director scheduling decision. Provider identity, model identity, confidence and agreement grant no authority.

## Hot/deep and admission

HOT work is foreground eligible and bounded by the task deadline. DEEP work is not foreground-reserve eligible, yields to foreground, and resumes only from a fresh checkpoint. Optional results are admitted only before the hard deadline, before Context Seal, and against the same revision fence. Malformed, expired, stale, or sealed results are diagnostic/next-turn only.

## Assembly seam

`Area52CoprocessorAssemblySeam@11.0.0` exposes only the task request, capability inventory, native result, optional proposal, Jev receipt, degraded reason, revision fence, Context Seal eligibility and telemetry. It explicitly does not instantiate a Worker Director, Candidate Bus, Truth Gate, or owner Settlement.

`scripts/wave11-host-example.mjs` demonstrates the same host-neutral entry path first with no optional slots and then with one explicitly configured local Jev-capable slot.

## Repair boundary

Wave 11 does not edit `jev-domain-adapter.js` or JevDecisionCore replay logic. #211 replay-freshness/cache retention remains repair-owned; adapter replay acceptance remains pending Director-coordinated repair integration.