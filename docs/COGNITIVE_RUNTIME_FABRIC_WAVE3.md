# Cognitive Runtime Fabric — Wave 3

## Scope

Wave 3 connects the accepted Wave 1/2 Runtime Fabric to the native cognitive execution path. Runtime consumes an immutable canonical `TURN_EVENT` carrying an already-admitted set of logical `CognitiveTask` jobs, turns those jobs into durable Runtime obligations, matches them to execution resources by capability/profile, executes them, enforces foreground completion rules, and emits result-ready envelopes to the external Gather/Result Bus seam.

The invariant is:

> Lifecycle decides that cognition is needed. Runtime decides when and where it may execute. Cognitive owners decide what the result means.

Runtime does not become Cognitive Choice, Jev, Truth Gate, Scene Intelligence, Lore, Memory, Result Bus semantic authority, Context Seal, or Settlement.

## Native turn path

```text
TURN_EVENT
 -> admitted CognitiveTask jobs
 -> native Runtime obligations
 -> capability/version/resource negotiation
 -> one or many physical execution resources
 -> concurrent execution where capacity permits
 -> REQUIRED/OPPORTUNISTIC/DEFERRED foreground policy
 -> result-ready envelopes
 -> external Gather / Result Bus
```

`NativeTurnRuntime` is deliberately a consumer of admitted jobs. It does not reimplement Dynamic Fan-Out need/expected-value semantics.

## Logical jobs are not workers

A logical role such as Historian, Green Room, Graph lookup, Truth/Precision, or Jev is represented by task type plus capability requirements. Physical resources are generic execution capacity.

There is no permanent Sidecar A/B slot, Jev process, Historian daemon, or Green Room daemon. A resource advertising `SEMANTIC_JUDGMENT` can execute a Jev task and later execute another compatible semantic task. Resource identity and provider identity are retained only as provenance and never grant epistemic authority.

The same cognitive object contract is preserved in one-, two-, and multi-resource configurations. Additional resources change placement/concurrency/latency/provenance only.

## Provider execution seam

`ProviderExecutionRegistry` binds registered Runtime resources to provider adapters. An adapter exposes an `invoke` operation and may expose output validation. Runtime supplies the scheduler-selected worker/profile to the adapter.

The production core:
- is provider-neutral;
- stores no credentials;
- applies capability/version/resource selection before invocation;
- enforces per-job provider/hard-deadline timeouts;
- rejects malformed declared output;
- retains worker/provider/model/implementation provenance;
- supports cancellation;
- marks unavailable/degraded resources so a bounded retry may select another compatible provider;
- permits health/availability recovery.

`scripts/runtime-wave3-provider-smoke.mjs` is an opt-in JSON HTTP smoke seam. It reads credentials/configuration only from the operator environment. Passing that smoke does not equal FT005; FT005 still requires assembled `main`, SillyTavern, and a real provider run.

## Foreground quorum

`ForegroundQuorumController` interprets only scheduling class metadata:

### REQUIRED
Must reach a successful Runtime completion or a bounded deterministic/degraded fallback. No missing resource, provider failure, or hard deadline can produce infinite foreground waiting.

### OPPORTUNISTIC
May execute concurrently but is never part of the required wait set. If still pending when REQUIRED closes, foreground closes without it. A later completion is reported honestly and remains external-admission material.

### DEFERRED
Never belongs to foreground quorum. It remains scheduled background/Deep work.

Soft and hard deadlines are task metadata; Runtime does not invent a universal millisecond SLA. Soft deadline may enable fallback policy. Hard deadline ends foreground waiting. Provider timeout is a typed execution failure.

## Nonblocking execution

Wave 2 `WorkerDirector.runCycle()` remains backward-compatible when called normally: it waits for active assignments as previous tests expect. Wave 3 adds an explicit `waitForTaskIds` execution signal used by foreground quorum. Runtime may start other eligible work but only awaits the REQUIRED set. In-flight bookkeeping prevents duplicate execution.

## Result-ready boundary

Runtime emits an opaque completion/failure/fallback envelope preserving:
- task/turn/correlation/causation identity;
- producer and owner;
- selected worker/provider/model provenance;
- source/world/scene/character revisions;
- freshness token;
- result class;
- requested destination, when supplied;
- completion/late state;
- degraded/fallback/failure state;
- opaque specialist/provider output;
- validation metadata.

Runtime does not assign the effective Result Bus destination, truth status, canonical authority, Settlement result, or Context Seal contents. Every Wave 3 envelope explicitly records `authorityGranted:false`, `canonicalMutation:false`, and `settlementPerformed:false`.

## Late/stale containment

An external `isTurnSealed(turnId)` fence determines whether a completion is late. Late completion is still reported, but its envelope is marked `AFTER_SEAL`; Runtime does not reopen the quorum or mutate a sealed generation.

Lifecycle freshness is checked before commit. A superseded/cancelled revision cannot commit as current work. Conflict-key supersession and Wave 1/2 checkpoint rules remain intact.

## Generation pressure and durability

Wave 1/2 Resource Governor, checkpoint, yield, park/resume, Work Ledger, and reload behavior remain authoritative. Native cognitive obligations use those same mechanisms. Background/Deep work yields at checkpoint boundaries when generation begins; committed units are not replayed.

Native obligations persist enough of the original cognitive-task contract to reattach their provider executor after reload. Provider secrets/adapters themselves are not persisted.

## No orchestration middleware dependency

The native path uses Area-52 Event Spine, Lifecycle, scheduler, Resource Governor, Work Ledger, provider adapter seam, and result-ready callback. It has no Dapr/LangGraph/external orchestrator requirement. Such systems remain optional benchmark/integration material.

## Jev boundary

Wave 3 consumes the accepted Jev contract shape only as a logical `JEV_DECISION` task requiring `SEMANTIC_JUDGMENT`. Runtime neither interprets the Jev receipt nor grants it authority.

> Runtime executes. Jev adjudicates. Owner settles.

## Remaining live-main dependencies

This branch does not claim:
- FT005 PASS;
- #222 full integrated PASS;
- #224 Live Brain Demo PASS.

Those require deliberate assembled-`main` integration, live SillyTavern execution, real provider qualification, Gather/Result Bus integration, Context Seal/PromptPlan, UI.Core visibility, and the remaining Phase-2 subsystems.
