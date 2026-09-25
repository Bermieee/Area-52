# Delivery Learning Feedback

Delivery Learning learns presentation policy only. **Presentation may learn. Truth may not.**

## Allowed policy targets

A DeliveryPolicyRevision may change only presentation parameters: position/order, structured-context density preference, section allocation weights, segment strategy and cache characteristics.

Canonical truth, authority, Settlement, source provenance, Temporal State, memory truth and Context Seal contents are outside the policy schema and rejected as policy parameters.

## Evidence and qualification

Delivery feedback is bounded and versioned. Evidence carries a model profile, benchmark revision, evidence reference, measurement state and retention/performance metrics.

A policy begins SHADOW. Qualification requires:
- minimum sample count (default 5);
- current benchmark revision;
- matching target profile;
- MEASURED or REPLAYED evidence;
- minimum measurable improvement;
- 100% protected semantic, factual, unresolved-warning, temporal and provenance retention when those metrics are supplied;
- semantic-equivalent packet evidence;
- identical baseline/candidate sealed packet identity when hashes are supplied.

A single unusual generation therefore cannot rewrite policy. A token-saving candidate that loses an unresolved warning cannot qualify.

## Lifecycle and rollback

SHADOW -> QUALIFIED -> explicit ACTIVE. Activating a new revision supersedes the previous active revision. Every learned revision records its prior policy reference and can roll back to that known-good policy (or the base profile).

Only future PromptPlans use an activated policy. Existing PromptPlans and Context Seals are immutable/reconstructible.

The stress suite evaluates 1,200 PromptPlans, records 600 feedback samples (500 retained under the configured bound), constructs 120 candidates, exercises two model profiles, density/order/cache/reuse pressure, explicit rollback and budget/defer cases.
