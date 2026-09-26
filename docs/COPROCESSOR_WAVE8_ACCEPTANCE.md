# Cognitive Coprocessor / Jev Wave 8 Acceptance

Working branch: `Development-Sidecar/Jev`

Starting SHA: `60e16ebfa96d8fb55eb86965c00b2c5aed65b9f5`

## Required capability

Wave 8 is accepted when the branch provides a reusable Jev service that:
- accepts bounded, revision-fenced explicit choice problems;
- deterministically decides whether semantic adjudication is necessary;
- evaluates only supplied valid options against supplied evidence;
- emits a validated audit receipt;
- may decide, preserve multiple, reject all, abstain, remain unresolved or escalate;
- returns control to the owning subsystem without canonical mutation authority.

## Focused validation

The Wave 8 suite covers:
- request/receipt contracts;
- stable option/evidence identity;
- deterministic prefilter and expected-value invocation gate;
- provider-neutral capability/profile execution;
- choose-one/subset, preserve/reject/unresolved/abstain/escalate/operator outcomes;
- stale, malformed, unknown-option/evidence and timeout/unavailable paths;
- bounded retry behavior;
- replay/idempotency;
- Context Seal late routing;
- owner rejection and operator-review handoff;
- Lore/Scene/Temporal multi-domain fixtures;
- single-resource and multiple-resource execution;
- browser-safe module source;
- focused bounded stress and performance counters.

Exact final SHA, test counts, stress metrics and Actions run IDs are reported in the Wave 8 final handoff so the reported CI run can remain exact-head.