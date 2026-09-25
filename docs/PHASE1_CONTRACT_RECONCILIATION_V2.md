# Phase 1 Contract Reconciliation V2

Wave 6 reconciles Core against accepted public checkpoints, while treating later moving heads as drift inputs rather than automatically trusted integration sources.

## Accepted checkpoints used by rehearsal

| Lane | Accepted checkpoint | Moving head observed | Acceptance evidence |
|---|---|---|---|
| Core | `eabf052b95d67752236365252420286d6323791f` | Wave 6 work advances only on `Development-Nexus` | Cognitive Core CI `35964450102` |
| Coprocessor | `d9b195332671d802639e6f9e7174de74f23a4b1e` | `d9b195332671d802639e6f9e7174de74f23a4b1e` | Coprocessor Wave 4 `35963531808`; historical implementation checkpoint `8eca22f0ae474a77914d8606148e433965aff205` |
| Scene | `5ad7567225720292d759d4a75afe84479deb6c1a` | `bee29f03de586e7f77728a5a1b6b50dbec0fdf8b` | Scene Wave 1+2 `35958003150` |
| Runtime | `890f8576bcfcc4c056b959271027242dc6af7d7c` | same at reconciliation | accepted handoff checkpoint |
| UI | `14259dbd25601d2984846edd2d75b5ef4ec6a6d2` | same at reconciliation | accepted handoff checkpoint |
| Memory | foundation only | foundation only | not accepted as a real Memory implementation |
| Lore | foundation only | foundation only | not accepted as a real Lore implementation |

## Allowed row states

Every reconciliation row is exactly one of:

- `COMPATIBLE`
- `PARTIAL`
- `BLOCKED_ON_OTHER_LANE`
- `MISMATCH`

Validated Wave 6 reconciliation checkpoint `e17e71cbedce17b933026e7f9fd208d88a20d202`, CI `35967412490`:

**COMPATIBLE 8 / PARTIAL 26 / BLOCKED_ON_OTHER_LANE 38 / MISMATCH 0**.

| Pair | Compatible | Partial | Blocked on other lane | Mismatch |
|---|---:|---:|---:|---:|
| Core ↔ Scene | 3 | 6 | 3 | 0 |
| Core ↔ Coprocessor | 3 | 8 | 1 | 0 |
| Core ↔ Runtime | 2 | 5 | 5 | 0 |
| Core ↔ UI read models | 0 | 7 | 5 | 0 |
| future Core ↔ Memory | 0 | 0 | 12 | 0 |
| future Core ↔ Lore | 0 | 0 | 12 | 0 |

The blocked rows are explicit missing ownership/integration surfaces; they are not treated as compatibility or as mismatches.

## Shared contract closure

### #46 Structured output — CLOSED

Core and accepted Coprocessor Precision output agree on:

`provider output -> parse -> type/schema -> semantic validation -> normalization -> canonical-ready eligibility`.

Provider A object output and Provider B JSON output normalize to the same canonical object. Invented IDs, duplicate IDs, authority escalation, wrong revision, invalid score, unsupported schema major, malformed JSON and truth/task contradiction all fail before canonical-ready admission.

### #125 Dependency graph — CLOSED

Core and Runtime agree on:

- required dependency absent -> BLOCKED;
- optional dependency absent -> DEGRADED;
- dependency appears -> READY/recovered;
- dependency disappears -> DEGRADED/BLOCKED correctly;
- cycle -> deterministic failure.

Service dependency availability remains distinct from provider capability negotiation.

### #131 Event registry — CLOSED

Core, Runtime and accepted Scene event contracts reconcile on extensible registration, compatible version handling, safe unknown/major failure, idempotent dedupe, causation/correlation and revision fencing. Future event types can register without Event Spine internals changing.

## Moving-head drift

Validated drift result:

- Core: `NO_CHANGE`
- Coprocessor: `NO_CHANGE`
- Runtime: `NO_CHANGE`
- UI: `NO_CHANGE`
- Scene: `COMPATIBLE_EXTENSION`

Counts: **NO_CHANGE 4 / COMPATIBLE_EXTENSION 1 / REQUIRES_ADAPTER 0 / BREAKING_CHANGE 0 / UNKNOWN 0**.

The Scene moving head is inspected as an extension but is not silently substituted for the independently accepted Scene checkpoint.
