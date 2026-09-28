# Native Sidecar Swarm and Jev Brain Handoff Contract

**Version:** 1.1.0  
**Owner:** Worker 2 / Coprocessor + Jev  
**Authority owner:** Brain Core / Worker 1

## Purpose

The native sidecar swarm is an optional execution contribution inside the Area-52 Brain. It requires no Redis, Dapr, SQL server, remote orchestration service, external database, or second Area-52 install. Zero connected resources is a valid operating state.

The Coprocessor nominates bounded specialist work, places that work on connected capability resources, validates provider output, contains stale/late/invalid work, and returns evidence to Brain Core. It does not decide what becomes final generation-facing evidence.

## Host API

`createCoprocessorResourceHost()` exposes the existing resource lifecycle plus:

- `actions.prepareSwarmTurn(input)`
- `execution.runSwarmTurn(input)`
- `execution.executeSwarmCheckpoint(checkpoint, options)`
- `read.swarm()`
- `read.swarmTurn(turnId)`
- `durability.validateCheckpoint(checkpoint, maxBytes?)`

Resource actions remain:

- `addResource`
- `connectResource`
- `disconnectResource`
- `testResource`

## Turn execution

`NativeSidecarSwarm.runTurn()` combines:

1. `DynamicFanOutPlanner.planChoice()`;
2. the live connected capability-profile inventory;
3. bounded placement across one or more physical resources;
4. specialist provider execution and structured normalization;
5. revision-fence validation;
6. deadline and generation-seal containment;
7. optional Jev execution only when the owner gate nominates it;
8. a `CoprocessorChoiceExecutionTrace`;
9. a `NativeSidecarSwarmContribution` for Brain Core.

One resource may execute multiple logical jobs serially within capacity. Additional resources may allow parallel placement but do not change the logical task contract.

## Brain Core handoff

The primary return value is `NativeSidecarSwarmContribution`.

Important fields:

- `choiceContribution`: the Wave 13 proposal/execution contribution.
- `executionTrace`: logical option -> physical provider/worker execution evidence.
- `resultsForOwner`: provider results that passed Coprocessor schema, capability, revision, authority-boundary, deadline and seal checks.
- `jevReceipt`: bounded Jev receipt when Jev actually ran.
- `resultSummary`: safe diagnostics without raw prompts.
- `ownerAdmissionRequired: true`.

`resultsForOwner` means **eligible for owner consideration**, not admitted evidence. Worker 1 must still combine current Candidate Bus, retrieval-quality, Truth, corrective-retrieval, Precision, Gather and Context Seal state and may reject any Coprocessor result.

The contribution always declares:

- `truthAuthority: false`
- `precisionAuthority: false`
- `settlementAuthority: false`
- `canonicalMutationAuthority: false`
- `finalChoiceAuthority: false`
- `contextSealAuthority: false`

## Safety and freshness

A provider result is excluded from `resultsForOwner` when it is:

- malformed or schema-invalid;
- capability-invalid;
- authority-escalating;
- stale against the current source/world/Scene/Character revision fence;
- completed after its hard foreground deadline;
- observed after the owner reports the generation/context seal closed;
- aborted, timed out, disconnected, or otherwise failed.

For the **original turn**, late/stale/invalid results remain excluded from `resultsForOwner`. This rule is unchanged and must not be weakened to reopen the original Gather or Context Seal.

### Forward/background consideration after foreground closure

Area-52 also has the Result Bus routing defined by `RESULT_BUS_CONTRACT.md`. A provider result excluded from the original-turn `resultsForOwner` solely because foreground closed may still become a distinct future/background consideration when all of the following hold:

- the physical Runtime execution completed successfully and preserves its original task/turn/generation/correlation/causation identity;
- source/world/Scene/Character revision fences are freshly revalidated;
- Result Bus accepts the result and routes it to `NEXT_TURN` or `BACKGROUND`;
- the receiving owner runs its normal owner-specific validation again before mutation.

This is **not** a second `resultsForOwner` entry and does not relabel the execution as a newer turn. It is a forward/background Result Bus route carrying original physical lineage. Stale, foreign-chat, cancelled, superseded, malformed, or invalid results remain excluded and cannot mutate current owner state. Duplicate delivery is idempotent at Result Bus and must not duplicate owner mutation.

Scene semantic extraction uses this distinction: its OPPORTUNISTIC foreground window may close while valid provider work continues under Runtime/provider capacity. A fresh later completion routes `NEXT_TURN`; POST_RESPONSE DEFERRED completion routes `BACKGROUND`. Scene owner acceptance is explicit and still requires exact current source and Scene revision fences. Neither route can reopen an already sealed generation.

## Jev

Jev is separate from ordinary specialist execution.

The owner gate determines whether bounded ambiguity warrants Jev. A clear deterministic case remains `SKIP_JEV`. If the owner nominates Jev, the connected resource lifecycle enforces capability, availability and concurrency just like other optional work.

Valid Jev outcomes include decision, partial decision, `UNRESOLVED`, abstention, owner escalation and operator request. No Jev outcome settles canonical truth by itself.

## Durability

`prepareSwarmTurn()` emits a bounded JSON-serializable `CoprocessorSwarmCheckpoint` containing turn identity, revision fence, proposal and pending task envelopes. It intentionally excludes resolved provider prompts/responses and private resource credentials.

A checkpoint can be stored by the host's normal extension persistence and later supplied to `executeSwarmCheckpoint()`. The resume path revalidates the revision fence before any provider call. A stale checkpoint fails closed without executing optional cognition.

No external durability service is required.

## Worker 3 read model

`read.swarm()` provides:

- ready resource count;
- active capabilities;
- bounded turn history;
- last-turn assignments;
- Jev status;
- failure/late/stale state;
- authority flags.

`read.swarmTurn(turnId)` returns the bounded per-turn assignment summary. It contains physical resource/profile/provider/worker identity, state, timing, failure code and result ID, but not raw private prompt content.

## Measurement classes

- **MEASURED_LIVE** — an operator-configured actual provider endpoint.
- **LOCAL_DETERMINISTIC** — local deterministic adapter or loopback transport executed for real on the host.
- **SIMULATED** — synthetic estimate/failure injection only.

Local deterministic wall time is not reported as live-provider latency. A skipped live smoke is not a live-provider pass.
