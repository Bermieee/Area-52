# Worker 2 Layered Scatter / Sidecar / Jev handoff

## Lineage and ownership

- Repository: `Bermieee/Area-52`
- Exact base for this wave: `main@ea66ddce461803d5279b4497f6604e3d75d6def6`
- Worker branch: `Development-Sidecar-Jev-Layered-Scatter-W2`
- Review PR: #262
- `Development-Scene-Scanner` / PR #257 is intentionally not a base or integration dependency.
- The older `Development-Sidecar/Jev` branch was inspected but is 449 commits behind the verified main base. It was not merged wholesale. Existing integrated Worker 2 contracts on main remain the baseline.
- Worker 1 remains owner of Core Cognitive Choice, lifecycle obligations, continuous Gather, Context Seal, PromptPlan and final provider-role repair.
- Worker 3 remains owner of UI/Diagnostics and journal presentation.
- Worker 4 remains owner of Lore.

## Layer policy

The Sidecar foreground policy is now:

1. `HOT_EXACT`: cheap current-state / exact / deterministic-or-cheap advisory work.
2. `EVIDENCE_EXPANSION`: graph, dense/episodic/historian-style evidence expansion explicitly nominated by preceding signals.
3. `PRECISION`: only high-value choices whose preceding evidence remains unresolved.
4. `DEEP`: consolidation/study/prefetch is parked outside the foreground deadline.

Independent eligible work may remain concurrent *inside* one layer. Layering is not a directive to serialize every task. A cooperative event-loop yield is inserted only between populated foreground layers.

## Worker 1 runtime / receipt contract

`LayeredScatterOwnerPolicy` and `LayeredScatterOwnerReceipt` are exported from `src/coprocessor/layered-scatter-owner-contract.js`.

Required owner behavior:

- Required work must either produce an owner-admissible fresh result before Seal or use the task's declared deterministic fallback.
- Opportunistic work is admissible only when it is fresh and returned before Seal.
- Deferred or late work cannot mutate the sealed turn. It may only be considered by a later fresh turn/background owner.
- Gather should consume each completed layer continuously rather than waiting for every nominated task.
- Precision is an evidence-dependent layer, not an unconditional second pass.
- Jev is an advisory finite-choice service only when the owner explicitly requests bounded ambiguous adjudication.
- `physicalAttempted`, `returned`, and `ownerAdmissible` are distinct receipt states. A connected/qualified resource is not an execution.
- The receipt itself has no truth, mutation, settlement, final-choice or Context Seal authority.

Each task receipt carries: task/option, layer, trigger, result class, state, physical-attempt flag, returned flag, owner-admissible flag, required-fallback obligation, provider/resource/result refs, failure, fallback, late/stale/invalid, skip reason, and compacted-byte count.

## Worker 3 read-only telemetry contract

`projectLayeredScatterReadModel()` in `src/coprocessor/layered-scatter.js` is the Worker 2 producer boundary. Worker 3 can consume it without importing Sidecar authority.

Selection scope: chat, turn, generation, correlation.

Wave fields: trigger, layer, parent receipt, start/completion, queue depth, concurrency, task count, admitted/skipped/deferred/failed, fallback count, cost class, retained bytes and released bytes.

Task fields: task, turn/generation/correlation, parent receipt, layer, trigger, decision/reason, queue/concurrency, duration, fallback, cost class and resource ref.

Lifecycle fields are separated per resource/service capability:
- configured
- qualified
- physical attempted
- returned
- owner accepted (only from an owner receipt)
- skipped
- failed

The projection explicitly excludes raw prompts, story/Lore bodies, credentials and hidden reasoning and has no mutation/truth/settlement/Seal/final-choice authority.

## Replay, lateness and memory

- The same checkpoint ID is single-flight and replay-safe; repeated execution observes the prior execution instead of starting duplicate physical work.
- Generation identity is part of checkpoint identity, so a new regeneration can create a distinct checkpoint while reload/replay of the same generation does not duplicate it.
- A stale checkpoint is rejected before physical work.
- A pre-sealed layer is skipped without physical work.
- Results that return stale/late/invalid are not owner-ready.
- Non-admissible provider result payloads are compacted immediately to metadata/result refs rather than retained in the Sidecar record.
- Ready payloads are retained only for the explicit owner handoff.

## Jev evidence class

Wave 22 reuses the accepted Jev golden corpus to compare deterministic-only and Jev-assisted ambiguous decisions for validity/correctness, safe abstention, false certainty, ambiguous resolution, latency and token-proxy cost.

Fixture runs are labeled `LOCAL_DETERMINISTIC`. Fixture provider calls are counted separately and **never** promoted to authenticated live execution.

FT005 remains open unless an authenticated optional provider physically executes in installed SillyTavern and the owner admits that result.

## Validation scope

Dedicated CI runs:
- focused Layered Scatter failure/recovery/replay tests;
- Jev usefulness evidence classification;
- syntax/module import closure;
- exact-base versus exact-head full Node regression delta;
- exact-main versus exact-head Chromium same-workload benchmark.

Chromium is browser/main-thread evidence, not an installed-SillyTavern performance pass. Installed host proof, real authenticated optional-provider execution, and full Core Gather/Context Seal timing remain explicit owner/integration acceptance items.
