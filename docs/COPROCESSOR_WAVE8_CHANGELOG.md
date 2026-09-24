# Coprocessor / Jev Wave 8 Change Log

Starting SHA: `60e16ebfa96d8fb55eb86965c00b2c5aed65b9f5`

## Added

- `src/coprocessor/jev-contracts.js`
  - canonical `JevDecisionRequest` / `JevDecisionReceipt`;
  - stable option/evidence identity;
  - revision/domain/freshness fences;
  - request fingerprint/replay identity;
  - owner and operator handoff contracts;
  - explicit non-authority markers.
- `src/coprocessor/jev-invocation-gate.js`
  - deterministic prefilter;
  - expected-value routing;
  - skip/invoke/abstain/escalate/operator decisions.
- `src/coprocessor/jev-decision-core.js`
  - capability/profile-based provider-neutral execution;
  - strict structured provider validation;
  - bounded retries and degraded/unavailable handling;
  - replay/idempotency;
  - stale/Context-Seal admission safety;
  - performance counters.
- Wave 8 focused, golden, authority-negative and stress suites.
- exact-branch Wave 8 GitHub Actions workflow.

## Boundaries preserved

Wave 8 does not implement Worker 1's Cognitive Choice Controller, Settlement ownership, Scene Intelligence, Lore/Memory mutation, Truth Gate ownership, UI rendering or Worker Director internals.

The same physical cognitive resource can execute Jev and other cognitive jobs. Jev remains a protocol/service, not a dedicated Sidecar identity.

## Deferred

- #211 full domain adapter matrix;
- #212 comparative/evaluation corpus;
- #225 Worker 1 integration;
- #224 full live Brain demo integration;
- Worker 3 visualization.