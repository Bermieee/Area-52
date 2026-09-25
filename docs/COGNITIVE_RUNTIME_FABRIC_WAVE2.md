# Cognitive Runtime Fabric Wave 2 — Deep Cognition, Sleep + Extensible Runtime Hosting

**Repository:** `Bermieee/Area-52`  
**Owner branch:** `Development-Worker-Director`  
**Accepted starting SHA:** `89ce5f4610be28fd6d579d0ab883db67f5dc7676`  
**Read-only Nexus compatibility reference used during implementation:** `Development-Nexus@5980ad2372fa9fbbd1b64111fdc790aaa0aa17fa`  
**Primary Runtime-owned cards:** #28, #32  
**Shared framework surfaces:** #124, #125, #131, #33

## 1. Purpose

Wave 1 proved how a known cognitive obligation executes safely. Wave 2 turns that substrate into an extensible hosting framework that can continuously accept work from cognitive systems that Runtime does not semantically understand.

The governing invariants are:

> **Runtime schedules capabilities and obligations, not hard-coded subsystem personalities.**

and:

> **Lifecycle decides that cognition is needed. Runtime decides when and where it may execute. Runtime does not decide what the resulting belief means.**

Wave 2 therefore adds generic Deep/Sleep orchestration, external obligation-producer hosting, versioned capability discovery/negotiation, required/optional service dependencies with graceful degradation, and a version-aware extensible Event type registry. Result Bus, Context Seal, Settlement, Truth/Precision publication, Memory semantics, Lore semantics, Reflection policy and specialist workers remain outside this lane.

## 2. Compatibility with current Nexus publication contracts

Wave 2 was implemented after re-fetching the moving `Development-Nexus` branch and reading the current Result Bus, Context Seal, publication, precision and Settlement boundary contracts at `5980ad2372fa9fbbd1b64111fdc790aaa0aa17fa`.

Runtime keeps those ownership boundaries intact:

- Runtime completion emits an execution/result-ready envelope containing task identity, producer/owner, correlation/causation, explicit source revision IDs/set, world revision, scene revision, degradation state and whether completion occurred after a supplied Context-Seal check.
- Specialist producers/profiles may declare an opaque `resultContract` (requested destination, result class/type/payload class, or future adapter metadata). Runtime preserves it without interpreting it.
- Runtime does **not** select an effective Result Bus destination; current Nexus Result Bus remains responsible for freshness, late routing, and the requested-to-effective destination decision.
- Runtime does **not** mutate a sealed packet.
- Runtime does **not** settle proposals or promote model output to canonical state.
- A host integration may adapt the completion envelope plus the specialist-declared `resultContract` into the canonical Nexus `CognitiveResult`; Runtime does not invent semantic result type, authority class, payload meaning, or effective route.

## 3. Deep Cognition Runtime (#28)

`src/runtime/deep-cognition.js` adds generic Deep-work profiles.

A profile can declare:

- task type and owner;
- required/versioned capability requests;
- preferred and minimum cognitive layer;
- resource limits;
- batch hints;
- checkpoint policy;
- task/service dependencies;
- revision fences;
- priority/deadline class;
- foreground sensitivity;
- expected cost metadata;
- yield policy;
- optional fallback capability sets.

Deep profiles default to L3 and may request L4 where the profile permits it. Runtime never switches on specialist task names such as Lore Study or Reflection.

Accepted behavior now proves:

- generic L3 admission;
- bounded multi-slice progress;
- borrowed background capacity;
- generation-driven cooperative yield;
- checkpoint then park;
- resume from the next uncommitted unit;
- partial completion;
- reload recovery;
- stale revision containment;
- persistent L0/L1/L2 arrival while legitimate L3 continues making progress when spare non-reserved capacity exists.

## 4. Maintenance / Sleep Runtime (#32)

`src/runtime/sleep-runtime.js` adds explicit L4 maintenance hosting.

Eligibility is generic and may consider:

- idle-cycle threshold;
- generation/foreground pressure;
- L2/L3 queue depth;
- maintenance due flag;
- explicit operator request;
- maximum outstanding maintenance work.

Sleep budgets support:

- per-resource ceilings, including CPU/GPU/IO/provider-like resource classes;
- maximum units per atomic slice;
- inherited Wave 1 foreground reservation;
- bounded outstanding L4 obligations.

Sleep work remains ordinary lifecycle work at deepest priority. Generation immediately makes active Sleep leases revocable, but the atomic slice still validates, passes freshness, commits/checkpoints and then parks. No hard kill occurs mid-mutation.

Repeated maintenance due triggers reuse Lifecycle dedupe/coalescing. The Sleep admission budget therefore does not multiply an already valid identical maintenance obligation.

## 5. Specialist obligation-producer hosting

`src/runtime/obligation-producers.js` defines a generic producer boundary.

A specialist owner registers a descriptor containing operational metadata such as:

- `producerId`;
- opaque obligation type;
- requested layer;
- capability requirements;
- service dependencies;
- priority/deadline class;
- resource/batch hints.

The producer supplies the opaque payload and executor. Runtime hosts it without interpreting the cognitive meaning.

Typed Event subscriptions can be bound to a producer adapter. The external specialist supplies the event-to-obligation mapping and executor factory; Runtime supplies correlation, scheduling, durability, capability routing, dependencies, batching, yield/resume and telemetry.

Fixtures prove hosting for:

- externally supplied L2 post-turn-like work after `GENERATION_COMPLETED`;
- externally supplied L3 study-like work;
- externally supplied L3 reflection-like work;
- a synthetic `WORLD_ECONOMY` subsystem unknown to Runtime.

These fixtures are hosting proofs only. They do not implement #29, #30 or #31 semantics.

## 6. Capability discovery + negotiation (#124 Runtime portion)

`src/runtime/capability-registry.js` now supports capability descriptors rather than only string capability names.

Worker descriptors can include:

- capability ID;
- capability version;
- implementation/provider identity;
- supported layers;
- resource profile;
- health and availability;
- concurrency/current load;
- latency score/class;
- quality/profile metadata;
- foreground/background eligibility.

Tasks can declare:

```text
primary capability requests
  -> minimum version
  -> preferred version
fallback capability request sets
```

Provider selection remains deterministic for equivalent inputs. It considers compatibility, layer eligibility, foreground/background eligibility, resource limits/governor policy, health, availability, load, preferred version, quality, latency and stable worker ID tie-breaking.

Fixtures prove:

- discovery by capability/version;
- `RERANK >= 1`, preferred v2;
- v2 selection over faster v1 when v2 is preferred;
- GPU provider disappearance -> CPU provider of the same capability;
- provider recovery -> future tasks may use the recovered provider;
- declared deterministic fallback capability when primary capability is unavailable;
- existing Wave 1 CPU/GPU Resource Governor policy remains green.

Task semantics do not change when provider identity changes.

## 7. Service dependency graph + graceful degradation (#125 Runtime portion)

`src/runtime/dependency-graph.js` adds Runtime-owned service dependency state.

A service can declare required and optional dependencies. Runtime supports:

- startup validation;
- required dependency readiness;
- optional dependency absence;
- degraded service state;
- runtime availability changes;
- recovery when a dependency appears;
- circular service dependency rejection.

Task obligations may also declare service dependencies.

Behavior:

```text
required missing
 -> lifecycle remains ELIGIBLE
 -> execution BLOCKED
 -> same task re-evaluates when service appears
 -> no duplicate obligation needed
```

and:

```text
optional missing
 -> task remains executable
 -> durable execution record marked DEGRADED
 -> declared capability fallback may be used
 -> future tasks use richer path after dependency recovery
```

Wave 2 also adds task-to-task dependency-cycle detection at Lifecycle admission. A newly closed cycle is rejected and diagnosed instead of silently deadlocking forever.

A scheduler defect discovered by the Wave 2 telemetry fixture was repaired here: an already-blocked task no longer rewrites the identical `BLOCKED` state each scheduler cycle. This makes `drain()` truthful under permanently unavailable dependencies instead of manufacturing update progress until a cycle ceiling.

## 8. Extensible Event type registry (#131 Runtime portion)

`src/runtime/event-type-registry.js` adds a stable, version-aware Event vocabulary while preserving the Wave 1 immutable Event Spine.

`src/runtime/event-spine.js` now uses registered descriptors rather than requiring all future cognitive events to be hard-coded in `EVENT_TYPES`.

The stable envelope includes:

- event ID/type;
- schema version;
- producer;
- causation/correlation IDs;
- optional turn/task IDs;
- source/world/scene revision fences;
- sequence/time;
- dedupe identity;
- payload.

Registration uses a declarative payload schema (`required`, simple property types, `allowUnknown`). Event registration does not accept arbitrary executable schema code.

Accepted behavior proves:

- dynamic future event registration;
- registered event flow without Event Spine kernel modification;
- unknown optional fields;
- compatible major-version resolution;
- unsupported major rejection;
- unregistered event rejection;
- duplicate type/version rejection;
- malformed payload rejection;
- preserved correlation/causation/dedupe identity;
- non-fatal subscriber failure diagnostics.

## 9. Synthetic future subsystem proof

The deterministic fixture introduces a subsystem named `WORLD_ECONOMY` that appears nowhere in Scheduler or Worker Director implementation.

The subsystem:

1. registers a new Event type;
2. registers an obligation producer;
3. subscribes through the generic producer adapter;
4. creates a new opaque L3 obligation type;
5. requests a generic capability;
6. declares an optional enrichment dependency;
7. executes degraded while enrichment is absent;
8. batches/checkpoints;
9. yields on generation;
10. parks;
11. resumes;
12. completes.

No `WORLD_ECONOMY` branch or task-name condition exists in Scheduler/Worker Director.

## 10. Integrated Wave 2 scenario

`tests/runtime-wave2.mjs` contains the integrated acceptance path:

1. external L3 study work begins;
2. background capacity is used;
3. `WORLD_ECONOMY` dynamically registers Event + producer + L3 work;
4. optional enrichment is absent and the task is marked degraded;
5. generation arrives;
6. active L3 work yields after safe slice commit/checkpoint;
7. L1 foreground work runs;
8. generation completion creates an external L2 nearline obligation;
9. L2 executes ahead of resumed Deep work;
10. enrichment and richer capability provider appear;
11. Deep work drains;
12. Runtime becomes idle enough for L4 maintenance;
13. L4 maintenance starts;
14. another generation preempts it safely;
15. the Runtime reloads from the Work Ledger;
16. L4 committed slices remain committed and resume without replay.

## 11. Result/Seal compatibility seam

`WorkerDirector` accepts optional integration callbacks:

- `isTurnSealed(turnId)` — read-only publication timing check;
- `resultSink(envelope)` — external result handoff.

A completed task produces `RUNTIME_RESULT_READY` telemetry and an envelope with revision/timing truth plus any opaque specialist-declared `resultContract`. If a supplied seal check says the turn is already sealed, `late=true` is recorded. Runtime does not choose `NEXT_TURN`, `BACKGROUND`, `SETTLEMENT`, or another effective Result Bus destination; the current Nexus Result Bus contract performs freshness/late routing.

## 12. Telemetry extension (#33 Runtime portion)

Wave 1 signals remain intact. Wave 2 additionally exposes lightweight signals for:

- `DEEP_ADMITTED` / `DEEP_ACTIVE`;
- `SLEEP_ADMITTED` / `SLEEP_DEFERRED` / `SLEEP_ACTIVE`;
- `DEPENDENCY_BLOCKED`;
- dependency registration/availability;
- `DEGRADED_EXECUTION` / `DEGRADATION_CLEARED`;
- capability provider registration/health/availability;
- `CAPABILITY_NEGOTIATED` / `CAPABILITY_FALLBACK`;
- Event registration/rejection/subscriber failure;
- dependency cycle rejection;
- starvation-protection decisions;
- `RUNTIME_RESULT_READY` and late timing truth.

Telemetry remains bounded and non-authoritative. A failing telemetry sink still cannot stop cognition. Full Work Ledger snapshots remain explicit/on-demand.

## 13. Validation

Exact local green tree before publication:

```text
Wave 1 deterministic regression: 29/29 PASS
Wave 2 deterministic:            27/27 PASS
Wave 1 stress:                   2,200 obligations PASS
Wave 2 stress:                   5,200 obligations + 578-event storm PASS
Source module-load:              19/19 PASS
Test syntax:                      5/5 PASS
```

Wave 2 stress result:

```text
submitted=5200
eventStorm=578
accepted=2569
rejected=2631
deduped=24
records=2802
completed=2435
superseded=223
cancelled=144
maxOpen=1000
open=0

completed by layer:
L0=573
L1=533
L2=476
L3=520
L4=333

commit attempts=2796
unique commits=2796
duplicate commit attempts=0
```

The stress run mixes all five layers, capability versions, several provider/resource profiles, required and optional dependencies, provider unavailability/recovery, repeated generation pressure, yield/resume, L4 maintenance, dedupe, supersession, dynamic future-subsystem events and a separate durable reload probe.

## 14. Recovery behavior

Wave 1 recovery contracts remain authoritative and green:

- completed slices do not replay;
- in-doubt irreversible commit remains `RECOVERING` until explicitly reconciled;
- stale active revision output cannot late-commit;
- worker failure retries from the last committed checkpoint.

Wave 2 additionally proves:

- L3 and L4 progress survives reload;
- required-dependency blocked work survives reload and resumes under the same task ID after dependency discovery;
- capability providers may be rediscovered after process restart;
- specialist profiles/producers/Event registrations are host configuration and can be re-registered without changing durable task identity.

## 15. Files

New Runtime files:

```text
src/runtime/deep-cognition.js
src/runtime/dependency-graph.js
src/runtime/event-type-registry.js
src/runtime/obligation-producers.js
src/runtime/runtime-host.js
src/runtime/sleep-runtime.js
```

Wave 1 Runtime files extended compatibly:

```text
src/runtime/batch-engine.js
src/runtime/capability-registry.js
src/runtime/event-spine.js
src/runtime/index.js
src/runtime/lifecycle.js
src/runtime/scheduler.js
src/runtime/work-ledger.js
src/runtime/worker-director.js
```

New Wave 2 tests:

```text
tests/runtime-wave2.mjs
tests/runtime-wave2-stress.mjs
```

Validation/package scripts are updated in `package.json` and `tests/syntax.mjs`.

## 16. Known limitations / later integration

1. Runtime continues to use the replaceable Wave 1 persistence abstraction; no final Area-52 storage backend is selected.
2. Service/provider discovery is an in-process reference implementation. Cross-process discovery/transport remains future benchmark work.
3. External executors, producer profiles, service registrations and capability providers must be re-registered by the host after process restart; durable obligation/progress identity remains in the Work Ledger.
4. Result Bus and Context Seal are read-only compatibility boundaries in this lane, not implementations.
5. Deep/Sleep profiles describe execution policy only; cognitive eligibility and semantic meaning remain specialist-owned.
6. Sleep time budgets are enforced through safe atomic-slice sizing/adaptation, not unsafe mid-mutation hard kills.
7. Shared #124, #125, #131 and #33 cannot close from Runtime work alone.
8. #27 Hot Cognition and #29-#31 specialist lifecycle semantics remain intentionally untouched.

## 17. Ownership / governance

No new branch is required for this work. `Development-Worker-Director` is the only implementation workspace. Other branches are read-only references. No merge into `Development-Nexus` or `main` is part of Wave 2.
