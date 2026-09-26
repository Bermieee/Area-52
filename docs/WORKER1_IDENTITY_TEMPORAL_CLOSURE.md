# Worker 1 — Identity and Temporal Closure

## Pre-change acceptance audit

This matrix records the audit against the original #5 and #201 scope at handoff before this closure wave. It intentionally does not make the full live demo a card-level acceptance requirement.

| Card | Original criterion | Handoff state | Existing evidence | Closure gap / action |
| --- | --- | --- | --- | --- |
| #5 | State changes never erase history | PASS | `src/temporal-state-graph.js` retains settled claims, statuses, transitions, source provenance, journal, and snapshots; `tests/native-brain-identity-retrieval.mjs` exercises current/historical correction paths. | Add story-neutral reconstruction coverage. |
| #5 | Supersession and contradiction remain distinct | PASS | `SettlementEngine` emits `SUPERSEDE` for newer changed state; `TemporalStateGraph` marks same-time incompatible evidence `CONTRADICTED`/unresolved. | Add one fixture proving transition, supersession, and contradiction side by side. |
| #5 | Current projection reconstructs from settled claims/evidence | PARTIAL | Graph snapshot/restore preserves claims, provenance, closure journal, and projection state. | Recompute slot projection on restore instead of trusting serialized claim status. |
| #5 | Inference never silently becomes canonical | BLOCKED | Conflict path rejects weaker inferred claims, but a fresh uncontested `INFERRED` claim could pass generic Settlement validation. | Hard-reject inferred canonical mutation in Settlement. |
| #201 | Explicit aliases deterministically resolve | PASS | `NativeEntityIdentityRegistry.resolveMention` resolves a unique accepted alias; existing identity regression covers source-explicit alias settlement. | Preserve and add story-neutral proof. |
| #201 | Same-name entities remain distinct | PASS | Registry stores independent stable IDs and returns an unresolved candidate set when labels collide. | Add same-world same-name fixture. |
| #201 | Ambiguous mentions can remain unresolved | PASS | `AMBIGUOUS`/multi-candidate proposals defer or settle unresolved without canonical mutation. | Preserve. |
| #201 | Historical aliases are not silently current | PARTIAL | Retired/invalidated alias rows are retained and excluded from current resolution. | Persist temporal applicability and add explicit historical-only lookup. |
| #201 | Merge/split proposals preserve evidence/provenance | PASS | Proposal/receipt shapes retain source revision and provenance refs; MERGE/SPLIT require owner settlement and do not directly mutate. | Add deterministic proof. |
| #201 | Source edits invalidate only dependent identity assertions | PASS | `invalidateSourceRevision` retires only aliases/links/proposals carrying that source revision. | Expose invalidated identity revision refs so dependent temporal projections can be targeted too. |
| #201 | Rank/confidence/model/graph signals cannot silently merge | PASS | Contract and settlement defer MODEL, GRAPH_PROXIMITY, RETRIEVAL_COACTIVATION and HEURISTIC identity signals; graph/retrieval authority flags are false. | Preserve. |
| #201 | Downstream systems use stable entity IDs | PARTIAL | Stable `entityId` is already used by Core and graph retrieval, but there was no explicit revisioned read-only identity reference contract for downstream settlement consumers. | Add bounded read-only identity/temporal reference sets and carry identity revision refs on claims/audits. |

## Closure implementation

- `src/entity-identity-registry.js`: historical alias applicability/resolution, stable revision references, targeted invalidation receipts.
- `src/contracts.js`: optional `identityRevisionRefs` on claims.
- `src/temporal-state-graph.js`: identity-revision invalidation, bounded read references, projection reconstruction on restore.
- `src/settlement-engine.js` and `src/settlement-boundary.js`: hard inference fence plus identity freshness validation/audit.
- `src/cognitive-core.js`: identity-to-temporal dependency invalidation and read-only consumer interfaces.
- `src/native-brain.js`: explicit canonical identity revision propagation into post-turn settlement; no label-match promotion.
- `tests/worker1-identity-temporal-closure.mjs`: story-neutral acceptance fixtures.
- `.github/workflows/worker1-identity-temporal-closure.yml`: exact-head focused gate.

## Consumer contract

#6 Hybrid Sensory Net, #27 Hot Cognition, and #203 Graph Walker may consume the read-only identity and temporal references. These references grant no mutation, settlement, merge/split, retrieval-admission, or final-truth authority.
