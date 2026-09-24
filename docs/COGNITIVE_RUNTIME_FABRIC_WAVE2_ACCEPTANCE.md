# Cognitive Runtime Fabric Wave 2 — Acceptance Evidence

## Validation commands

```bash
npm test
npm run check
```

## Green result

```text
Runtime Fabric deterministic suite: 29/29 PASS
Runtime Fabric Wave 2 deterministic suite: 27/27 PASS
Runtime Fabric stress: 2200 submitted; accepted=798; rejected=1402; completed=700; superseded=34; cancelled=65; open=0
Runtime Fabric stress suite: PASS
Runtime Fabric Wave 2 stress: submitted=5200; eventStorm=578; accepted=2569; rejected=2631; deduped=24; records=2802; completed=2435; superseded=223; cancelled=144; maxOpen=1000; open=0
Completed by layer: {"L0":573,"L1":533,"L2":476,"L3":520,"L4":333}
Commit attempts=2796; uniqueCommits=2796; duplicateCommitAttempts=0
Runtime Fabric Wave 2 stress suite: PASS
Syntax/module-load sweep: src 19/19 PASS; test syntax 5/5 PASS
```

## Acceptance matrix

| Contract | Deterministic / stress evidence |
|---|---|
| L3 Deep admission | Generic Deep profile accepts opaque external task |
| Deep background borrowing | Resource Governor lease under idle capacity |
| Bounded Deep progress | Multi-unit jobs sliced/checkpointed |
| Deep yield/park/resume | Generation preemption fixture |
| Deep reload | L3 durable reload probe |
| Persistent-work starvation protection | Continuous L0/L1/L2 arrivals while L3 progresses with spare capacity |
| L4 idle eligibility | Sleep eligibility fixture |
| Sleep resource budget | CPU/GPU profile budget selects legal worker |
| Sleep slice budget | `maxSliceUnits=1` fixture |
| Sleep outstanding budget | new maintenance deferred at limit; duplicate still deduped |
| Maintenance dedupe | repeated due trigger maps to one durable task |
| Sleep safe preemption | L4 generation-yield/checkpoint/park/resume fixture |
| No foreground delay | L1 completes while L4 is parked |
| External L2 hosting | `GENERATION_COMPLETED` -> external producer -> L2 obligation |
| External L3 study/reflection hosting | two opaque producer-owned L3 task types |
| Capability versions | RERANK v1/v2 and structured LLM v3 fixtures |
| Capability discovery | version-filtered discovery fixture |
| Deterministic provider selection | preferred v2 vs faster v1 fixture |
| CPU/GPU policy | Wave 1 reserve regression remains green |
| Provider disappearance/recovery | GPU unavailable -> CPU; GPU recovery -> future GPU selection |
| Declared capability fallback | deterministic fallback capability -> degraded execution |
| Required dependency missing | same valid obligation becomes BLOCKED |
| Dependency recovery | BLOCKED task resumes after service availability without recreation |
| Optional dependency missing | task executes DEGRADED |
| Optional dependency recovery | later task uses non-degraded path |
| Startup dependency validation | required vs optional missing service report |
| Service dependency cycle | registration rejected with explicit cycle diagnostic |
| Task dependency cycle | lifecycle admission rejected; no silent deadlock |
| Dynamic Event registration | unknown future Event type registered without Event Spine rewrite |
| Event envelope | schemaVersion/producer/correlation/causation/revision fences/dedupe preserved |
| Event unknown fields | optional future fields accepted when schema allows |
| Unsupported Event version | incompatible major rejected |
| Unregistered Event | rejected/diagnosed |
| Duplicate registration | rejected/diagnosed |
| Malformed payload | rejected/diagnosed |
| Synthetic future subsystem | `WORLD_ECONOMY` completes via Event + producer + capability + optional dependency |
| Late/result handoff truth | completion seam records `late`, revision fences, and preserves opaque specialist `resultContract`; no Context Seal mutation or effective-route choice |
| L3/L4 reload no replay | committed slice identity preserved |
| In-doubt commit | Wave 1 reconciliation regression remains green |
| Deep/Sleep telemetry | admitted/active/yield/park/resume/complete signals |
| Dependency telemetry | blocked/degraded/recovered/cycle signals |
| Capability telemetry | negotiation/provider state/fallback signals |
| Event telemetry | registration/rejection/subscriber-failure signals |
| Telemetry failure | Wave 1 non-fatal sink regression remains green |
| Wave 2 integrated scenario | all 32 required orchestration stages represented in one deterministic flow |
| 5,000+ stress | 5,200 direct submissions + 578 future-subsystem Events |
| Bounded queue | `maxOpen=1000`, never above configured bound |
| No permanent starvation | completion observed in L0-L4 |
| No duplicate irreversible commits | 2,796 commit attempts = 2,796 unique; duplicates=0 |
| No deadlock | final `open=0` |
| Wave 1 regressions | 29/29 deterministic + 2,200 stress PASS |
| Module/syntax | 19/19 src imports + 5/5 test syntax PASS |

## Integrated scenario summary

The Wave 2 scenario proves that an externally-created L3 obligation and a completely unknown future subsystem may execute concurrently, degrade truthfully when optional enrichment is absent, yield at generation pressure, allow L1 foreground execution, accept L2 post-turn work after generation, resume Deep work, recover richer capability/dependency availability, enter L4 maintenance during idle conditions, preempt Sleep safely on another generation and survive reload without replay.

Runtime never interprets the specialist payload and never becomes Result Bus, Context Seal or Settlement authority.

## Shared cards intentionally not closed by Runtime evidence alone

- #124 — Sidecar/Jev integration remains shared.
- #125 — Nexus shared dependency-framework acceptance remains.
- #131 — Nexus canonical Event framework reconciliation remains.
- #33 — UI + Runtime integrated observability remains.

## Cards eligible for Runtime-owned closure

- #28 — Deep Cognition Runtime.
- #32 — Maintenance + Sleep cognition.
