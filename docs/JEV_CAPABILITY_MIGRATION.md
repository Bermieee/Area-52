# Jev Decision Core / Capability Migration

## Purpose

Jev is a first-class **bounded adjudication service** inside Area-52. It is separate from the Sidecar/Coprocessor execution fabric and from canonical owners.

```text
Sidecar / Coprocessor = executes cognitive work
Jev                  = adjudicates bounded explicit choices
Owner / Settlement   = canonical authority
```

**Sidecar thinks. Jev adjudicates. Owners settle.**

The older capability-migration rule still applies: no physical provider, worker slot, model, or Sidecar identity is permanently "Jev". Jev tasks request provider-neutral semantic capabilities and may run on any eligible cognitive execution resource.

## Canonical path

```text
bounded domain ambiguity
 -> deterministic prefilter
 -> Jev invocation gate
 -> SKIP_JEV / INVOKE_JEV / ABSTAIN / ESCALATE / REQUEST_OPERATOR
 -> JevDecisionRequest
 -> provider-neutral bounded adjudication when invoked
 -> strict structured validation
 -> JevDecisionReceipt
 -> domain owner policy
 -> optional operator review
 -> Settlement / no-op / unresolved
```

Jev never skips the owner and never calls Settlement as a domain owner.

## JevDecisionRequest

Canonical implementation: `src/coprocessor/jev-contracts.js`.

The request carries:
- decision, turn, task, correlation and causation identity;
- a finite `options[]` set with stable typed option IDs;
- `allowedOutcomes[]`;
- explicit bounded evidence and provenance references;
- deterministic hard constraints;
- authority boundary and owner identity;
- source/world/scene/character and domain revision fences;
- freshness token;
- abstention, escalation and operator policies;
- deadline, result/resource class and cognitive layer;
- bounded expected-value routing metadata;
- optional domain adapter identity/version.

Requests are byte-bounded. Unknown evidence references and duplicate option identities fail closed. Jev does not accept a whole-world dump or an unbounded planner prompt.

## JevDecisionReceipt

A receipt exposes:
- selected and rejected option IDs;
- outcome and decision code;
- optional classification;
- machine-readable reason codes;
- evidence used;
- unresolved factors;
- confidence as metadata only;
- abstention/escalation/operator state;
- owner-settlement requirement;
- revision/freshness fence;
- provider/model/worker provenance;
- validation and latency metadata;
- foreground/late admission state.

Every receipt permanently carries:

```text
authorityGranted = false
canonicalMutation = false
settlementPerformed = false
```

Confidence, provider identity, majority agreement, rank, retrieval score, or repeated delivery never become authority.

## No hidden chain-of-thought contract

The provider output contract is strict structured data. It contains option IDs, evidence IDs, reason codes, unresolved factors, confidence and a short explanation. Arbitrary reasoning fields are rejected. Downstream correctness never depends on hidden chain-of-thought.

## Invocation Gate

Canonical implementation: `src/coprocessor/jev-invocation-gate.js`.

The gate is deterministic-first and never calls Jev to decide whether Jev should run.

- One surviving valid choice -> `SKIP_JEV`.
- Multiple evidence-backed choices with meaningful expected decision value -> `INVOKE_JEV`.
- Inadequate evidence/no safe choice -> `ABSTAIN` or owner escalation according to policy.
- Owner-only authority -> `ESCALATE`.
- destructive/operator-only policy -> `REQUEST_OPERATOR`.
- low expected decision value -> `SKIP_JEV` while preserving unresolved state.
- provider unavailable -> safe unresolved/degraded path.

Hard constraints, stale/unavailable evidence and revision fences are evaluated before semantic execution.

## Supported bounded decision shapes

The reusable kernel supports:
- `CHOOSE_ONE`;
- `CHOOSE_SUBSET`;
- `CLASSIFY_RELATIONSHIP`;
- `RANK_BOUNDED_OPTIONS`;
- `REJECT_ALL`;
- `PRESERVE_MULTIPLE`;
- `UNRESOLVED`;
- `ABSTAIN`;
- `ESCALATE`;
- `REQUEST_OPERATOR`.

A provider may select only option IDs supplied by the request. Unknown option/evidence IDs fail closed. New proposals are not permitted by default.

## Provider-neutral execution

Canonical implementation: `src/coprocessor/jev-decision-core.js`.

`JevProviderExecutor` reuses the existing `CapabilityProfileRegistry` and `ProviderAdapterRegistry`. A Jev task requests `SEMANTIC_JUDGMENT` with optional review/conflict capabilities. The same physical resource may execute Historian, Green Room, classification or Jev work at different times.

There is no permanent mapping such as `SC-B = Jev` and no dedicated Jev daemon/application requirement.

## Revision, replay and Context Seal safety

The request fingerprint includes bounded choices, evidence, constraints and revision/freshness identity. Replaying an identical decision request returns the same validated receipt without a second provider call.

Source/world/scene/character/domain revision drift or freshness-token mismatch returns `STALE`. A stale semantic result cannot be promoted to current.

If Context Seal closes before a valid Jev result arrives, the receipt remains available for audit/future cognition but its admission becomes `NEXT_TURN` and `foregroundEligible=false`.

Deep/L4 execution does not receive stronger authority than foreground execution and cannot override a newer revision.

## Abstention and escalation

Non-decision is a successful cognitive outcome. Jev may return or route to:
- `UNRESOLVED`;
- `ABSTAINED`;
- `ESCALATE_OWNER`;
- `REQUEST_OPERATOR`;
- `STALE`;
- `INVALID`;
- provider-unavailable unresolved state.

Malformed structured output uses bounded retries only. Exhausted invalid output fails closed; provider timeout/unavailability never fabricates a choice.

## Owner and operator handoff

`createJevOwnerHandoff()` exposes the proposed decision, selected/rejected alternatives, evidence/provenance, unresolved factors, authority impact and dependency impact. `evaluateJevOwnerPolicy()` proves that a domain owner may reject a valid/high-confidence Jev recommendation.

Owner approval only makes a receipt **settlement-eligible**. It does not perform Settlement. Operator-required actions remain blocked from Settlement until the owning policy/UI flow resolves them.

## Multi-domain kernel proof

Wave 8 goldens exercise the same kernel against three unrelated fixture classes:
- Lore relationship reconciliation;
- Scene boundary interpretation;
- Temporal/Truth ambiguity.

This proves kernel reuse without completing the broader #211 domain adapter matrix.

## Performance / wake policy

`JevDecisionCore.metricsSnapshot()` exposes decision count, invocation/skip/abstention rates, provider calls, retries, timeouts, latency and bounded decision payload size.

A good Jev implementation often does **not** run. Every turn does not receive an extra model call.

## Hard invariants

```text
Jev != Sidecar identity
Jev != Truth Gate
Jev != Settlement
Jev != Scene Intelligence
Jev != Lore owner
Jev != Memory owner
confidence != authority
provider identity != authority
UNRESOLVED is valid
ABSTAIN is valid
SKIP_JEV is valid
REQUEST_OPERATOR is valid
stale receipt fails closed
unknown option fails closed
late result cannot mutate Context Seal
models propose
schemas validate
provenance explains
revisions fence
owners settle
```