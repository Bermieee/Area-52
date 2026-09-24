# Phase 1 Contract Reconciliation V2

Wave 6 reconciles Core against accepted public checkpoints, while treating later moving heads as drift inputs rather than automatically trusted integration sources.

## Accepted checkpoints used by rehearsal

| Lane | Accepted checkpoint | Moving head at Wave 6 start | Acceptance evidence |
|---|---|---|---|
| Core | `eabf052b95d67752236365252420286d6323791f` | same | Cognitive Core CI `35964450102` |
| Coprocessor | `8eca22f0ae474a77914d8606148e433965aff205` | `d9b195332671d802639e6f9e7174de74f23a4b1e` | Coprocessor Wave 4 `35963150929` |
| Scene | `5ad7567225720292d759d4a75afe84479deb6c1a` | `bee29f03de586e7f77728a5a1b6b50dbec0fdf8b` | Scene Wave 1+2 `35958003150` |
| Runtime | `890f8576bcfcc4c056b959271027242dc6af7d7c` | same | accepted handoff checkpoint |
| UI | `14259dbd25601d2984846edd2d75b5ef4ec6a6d2` | same | accepted handoff checkpoint |
| Memory | foundation only | same | not accepted as a real Memory implementation |
| Lore | foundation only | same | not accepted as a real Lore implementation |

## Allowed row states

Every reconciliation row is exactly one of:

- `COMPATIBLE`
- `PARTIAL`
- `BLOCKED_ON_OTHER_LANE`
- `MISMATCH`

Functional Wave 6 result: **COMPATIBLE 5 / PARTIAL 15 / BLOCKED_ON_OTHER_LANE 52 / MISMATCH 0**.

The high blocked count is intentional: the matrix now includes future Memory/Lore rows and contract families that are absent outside their owning lanes. Missing ownership never becomes a false compatibility claim.

## Shared closure findings

### Structured output

Core and accepted Coprocessor Precision output agree on parse -> type/schema -> semantic validation -> normalization -> canonical eligibility. Provider identity remains metadata. Invented IDs, duplicates, revision mismatch, score errors, unsupported versions, malformed JSON, authority changes and truth-status changes are rejected before `canonicalReady`.

### Dependency state

Core and Runtime agree on required/optional dependency semantics. Required absence blocks. Optional absence degrades. Appearance recovers readiness. Disappearance returns to degraded/blocked as appropriate. Cycles fail deterministically. Provider capability discovery remains a separate contract from service dependency availability.

### Event registry

Core, Runtime and accepted Scene event contracts reconcile on extensible registration, version compatibility, payload validation, dedupe identity, causation/correlation and revision fencing. New event classes can register without Event Spine internals changing.

## Moving-head drift

Wave 6 drift result at the functional checkpoint:

- Core: `NO_CHANGE`
- Coprocessor: `NO_CHANGE`
- Runtime: `NO_CHANGE`
- UI: `NO_CHANGE`
- Scene: `COMPATIBLE_EXTENSION`

No accepted assumption is silently rebound to the Scene moving head. The added Scene Integration Signal / invalidation contracts are observed as extensions until separately accepted.
