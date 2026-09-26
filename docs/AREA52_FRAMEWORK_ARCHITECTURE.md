# Area-52 Framework Architecture

## Purpose

The Framework Kernel organizes participation in Area-52. It does not own cognition, scheduling, provider execution, canonical truth, or generation publication.

Permanent rule:

> Models propose. Schemas validate. Provenance explains. Revisions fence. Owners settle. Golden worlds test.

## Kernel split

### Cognitive Kernel

Owns contracts and authority boundaries: subsystem manifests, service discovery, artifact/event identity, contract compatibility, dependency declarations, repository interfaces, subsystem lifecycle, conformance, certification, Settlement ownership, Result Bus publication semantics, Context Compiler and Context Seal.

### Runtime Kernel

Owns execution: scheduling, batching, worker pools, capacity, backpressure, yield/resume, Event Spine delivery, work durability and runtime execution state.

The Framework does not create a second scheduler, Event Spine, provider router, Settlement engine, Result Bus, or prompt path.

## Framework Kernel components

`FrameworkKernel` composes these public registries and contracts:

- `ServiceRegistry` — machine-readable subsystem registration and inspection.
- `ArtifactTypeRegistry` — extensible artifact recognition/validation/routing identity.
- `EventTypeRegistry` — extensible event identity/version/schema and dedupe containment.
- `ContractVersionRegistry` — compatibility and deterministic migrations.
- `ServiceDependencyGraph` — required/optional dependency validation and cycle rejection.
- `CognitiveRepositoryRouter` — storage-neutral repository domain routing.
- `GoldenWorldCertificationMatrix` — mandatory evaluation gates for ACTIVE eligibility.
- `CognitiveServiceConformanceKit` — reusable positive/negative contract checks.

Unknown services register through these public contracts; the kernel contains no subsystem-ID switch statement.

## Authority invariants

Registration grants discoverability, schema routing, repository routing, diagnostics identity and compatibility identity. It never grants canonical truth authority.

`DIRECT_CANONICAL_MUTATION` is always rejected with `SETTLEMENT_REQUIRED`. A service may only submit a proposal to an owning Settlement contract when its declared authority permits doing so.

`DIRECT_PROMPT_INJECTION` is always rejected with `CONTEXT_SEAL_REQUIRED`. Generation-facing semantic material must still flow through an accepted publication/compiler path and Context Seal before PromptPlan delivery.

`SHADOW` and `EXPERIMENTAL` results are routed to evaluation only. `ACTIVE` means only the explicitly declared permissions are eligible; it does not bypass owner policy.

## Browser host contract

Canonical Framework modules are browser-safe and do not depend on Node built-ins, `Buffer`, `process`, CommonJS `require`, or filesystem APIs. Node-only utilities may exist under `scripts/`, but they are not part of browser-loaded Framework semantics.
