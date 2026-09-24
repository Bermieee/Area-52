# Cognitive Coprocessor — Phase 1 Backlog Wave 2 Acceptance

## Scope and checkpoint

Accepted start: `Development-Sidecar/Jev@bbc19573a4bedc246f0f7d1851bd61276f40f7f6`.

Wave 2 implementation checkpoint: `acc27b9526eca8b88ce5bffc82297a7580ee5f8b`.

This wave completes the Sidecar-facing Runtime integration, Cognitive Data Plane, benchmark and provider-qualification readiness contracts. It does not claim Runtime-owned execution acceptance, live FT005 acceptance, integration-wide browser acceptance, or Phase 2 Provider Intelligence.

## Exact validation at implementation checkpoint

GitHub Actions at `acc27b9526eca8b88ce5bffc82297a7580ee5f8b`:

- Cognitive Coprocessor Wave 1 run #37 — PASS — run `35956409070`.
- Cognitive Coprocessor Wave 2 run #16 — PASS — run `35956409116`.
- full regression: 126/126 PASS;
- Wave 1 focused: 40/40 PASS;
- Wave 2 focused: 62/62 PASS;
- stress suites: 6/6 PASS;
- JavaScript syntax sweep: PASS;
- Coprocessor ESM module import: PASS.

The accepted Wave 1 baseline was 91/91, so this wave adds 35 deterministic regression tests without weakening the prior suite.

## New pressure evidence

- 2,500 capability negotiations under provider health/load/version/fallback churn;
- 1,200 exact/stale artifact-reference operations with no latest-revision substitution;
- 1,500 duplicate canonical TURN_EVENT deliveries with mixed HOT/DEEP obligations;
- preserved 2,100-task deterministic swarm stress;
- preserved 1,000+ turn / 5,000+ task Wave 2 swarm stress.

Observed new-stress counters at the implementation checkpoint:

- capability negotiation: 2,500 iterations, 2,131 eligible nominations, 64 degraded fallback negotiations, 398 intentionally empty outcomes;
- artifact references: 1,200 operations, 800 EXACT, 400 STALE, 0 silent missing/latest substitutions;
- Turn Event/obligation: 1,500 turns, 1,500 duplicate deliveries safely contained, 750 HOT and 750 DEEP obligations.

## Contract acceptance

### Capability negotiation / #82 / #124

DONE on the Sidecar-facing contract:

- primary and ordered fallback capability sets;
- minimum/preferred versions;
- layer and HOT/DEEP placement;
- foreground/background eligibility;
- context/output/structured-output requirements;
- latency/cost budgets;
- resource hints;
- explicit missing capabilities, incompatibilities and constraint failures;
- eligible implementation descriptors;
- provider/model identity remains metadata;
- `schedulingDecision: null` and `authorityGranted: false` remain explicit.

BLOCKED ON OTHER LANE for complete shared-card closure: Runtime still owns the actual scheduling/resource decision and end-to-end execution acceptance.

### Event Spine / #89

DONE on the Sidecar-facing contract:

- consumes Framework-shaped `CognitiveEventEnvelope` TURN_EVENT;
- preserves event/turn/correlation/causation identity, revision fences, dedupe identity, delivery attempt and cognitive layer;
- rejects incompatible event versions;
- duplicate delivery remains idempotent through the Sidecar event hub.

BLOCKED ON OTHER LANE for complete shared-card closure: Runtime owns Event Spine delivery/subscription execution.

### HOT / DEEP / #88

DONE on the Sidecar-facing obligation contract:

- HOT/DEEP classification;
- result class;
- resource hints;
- legal-yield metadata;
- checkpoint boundary;
- partial-result semantics;
- resume identity;
- batch slice;
- explicit Runtime checkpoint-storage ownership.

BLOCKED ON OTHER LANE for complete shared-card closure: Runtime owns Resource Governor, actual preemption/yield/resume and worker pools.

### Deadline / quorum / #94

DONE on the Sidecar-facing obligation contract:

- soft/hard deadline;
- result class;
- quality weight;
- fallback contract;
- foreground sensitivity;
- REQUIRED bounded fallback;
- OPPORTUNISTIC no-Seal-authority behavior;
- DEFERRED excluded from foreground.

BLOCKED ON OTHER LANE for complete shared-card closure: Runtime owns live enforcement under resource pressure.

### Cognitive Data Plane / #81

DONE on the Sidecar-facing contract:

- Core-compatible artifact identity and repository seam;
- exact revision semantics;
- `EXACT`, `STALE`, `SUPERSEDED`, `MISSING`, `INVALID` outcomes;
- owner/type/hash/revision validation;
- bounded slice retrieval;
- reference-first browser-native transfer path;
- transport compatibility matrix;
- measured serialized bytes and clone/JSON timings;
- unavailable copy-count/memory/repository-latency metrics are `NOT_MEASURED`, never zero.

BLOCKED ON OTHER LANE for complete shared-card closure: Core owns Artifact Registry/Repository persistence and Runtime owns any external transport lifecycle.

### Benchmark harness / #87

PARTIAL:

- deterministic coverage now includes fan-out, zero-worker, quorum, late results, structured validity, malformed rejection, retry/fallback, stale/future rejection, provider interchangeability, batch throughput when available, artifact-reference savings, serialization cost and telemetry volume;
- measurement states distinguish `MEASURED`, `NOT_MEASURED`, `NOT_APPLICABLE`;
- real CPU/RAM/provider-token/provider-cost metrics are not fabricated.

Keep open while real-provider and remaining subsystem measurements are outside this lane.

### Precision benchmark / #42

PARTIAL:

- intent-opposite corpus exists for enter/leave, intact/destroyed, trust/distrust, carry/drop, heal/injure, present/departed and CURRENT/HISTORICAL;
- deterministic baseline and provider-neutral precision adapter seam are measured;
- FlashRank remains an optional external/local adapter candidate;
- ColBERTv2 remains deferred from direct browser deployment;
- no external-model quality claim is made.

Keep open until an empirical external precision benchmark is run.

### Structured output / #46

DONE for Sidecar compatibility:

- transport/reference layers do not bypass specialist parsing/validation/normalization;
- malformed provider output remains typed failure;
- provider interchange preserves normalized output contracts;
- native provider function calling is not required.

Keep shared card open for Framework/integration acceptance.

### FT005 / #180

READY, NOT PASSED:

- configurable provider A/B profiles;
- capability negotiation;
- Runtime-selected eligible profile seam;
- real structured output path;
- timeout/unavailable/malformed/cancellation typed failures;
- bounded A-failure -> B fallback drill;
- usage telemetry path;
- provider identity remains metadata;
- no credentials committed;
- no native function-call dependency.

Actual FT005 remains open until an integrated `main` SillyTavern real-provider run passes.

### Browser host / #185

Sidecar contribution DONE:

- all new integration-visible Sidecar modules are scanned against `Buffer`, `node:*`, `process.`, `require()` and filesystem imports;
- browser-native path uses standard browser-compatible primitives;
- Node/Python/external transport candidates stay outside browser runtime modules.

Keep #185 open for integration-wide clean-install/reload/live SillyTavern acceptance.

## #75 epic audit

- structured worker contract — DONE in Sidecar;
- capability/model routing — DONE Sidecar contract / BLOCKED ON OTHER LANE for Runtime execution;
- Cognitive Data Plane — DONE Sidecar contract / BLOCKED ON OTHER LANE for Core/Runtime integration;
- Turn Event fan-out — DONE Sidecar contract / BLOCKED ON OTHER LANE for Runtime delivery;
- Gather/compiler/freshness/Context Seal compatibility — DONE in Sidecar;
- failure/fallback — DONE in Sidecar;
- telemetry — DONE bounded Sidecar contract / shared UI presentation remains elsewhere;
- benchmark harness — PARTIAL, real-provider/external measurements remain;
- speculative warmer #77 — DEFERRED;
- durable Green Room #78 — DEFERRED;
- continuous consolidation #79 — DEFERRED;
- Streaming Truth #80 — OBSERVE preserved; hard interception not accepted.

The epic remains open.

## Phase boundary

Not started in this wave:

- learned provider preference/provider intelligence;
- predictive cognition;
- meta-cognition;
- autonomous self-maintenance;
- #77 speculative warmer;
- #78 durable Green Room integration;
- #79 continuous consolidation.

No provider, Runtime slot, transport or artifact reference gains truth, Settlement, canonical mutation or Context Seal authority.
