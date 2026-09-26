# Worker 2 — Layered Scatter, Sidecar Execution and Jev Evidence Wave

Branch: `Development-Worker2-Layered-Scatter-Jev`  
Base: `main@ea66ddce461803d5279b4497f6604e3d75d6def6`  
Review PR: #260  
Owner: Worker 2  
Status: review wave; do not merge or update `main` from this work packet.

## Scope and ownership boundary

This wave optimizes the accepted Turn Event / Fan-Out / Gather contracts. It does not redefine the accepted contracts behind #89, #90, #91, #93, #94 or #95.

Worker ownership remains explicit:

- Worker 1 owns Brain/Core Cognitive Choice, Lifecycle obligations, Context Seal, PromptPlan and final provider-role repair.
- Worker 2 owns Sidecar/Jev execution policy, resource routing evidence and the runtime/receipt contracts in this branch.
- Worker 3 owns UI and Diagnostics consumers. This branch publishes read-only bounded receipts but does not modify the UI read model.
- Worker 4 owns Lore. No Lore runtime or hierarchy behavior is changed.

The stale `Development-Sidecar/Jev` branch was not used as the code base because it was hundreds of commits behind current `main`. Only still-relevant narrow Jev evidence fields were ported explicitly. `Development-Scene-Scanner` / PR #257 was not used as the base.

## Layered Scatter policy

A turn keeps the original immutable fan-out plan and task identities, then maps eligible work into ordered admission layers:

1. **HOT_SIGNAL** — cheap deterministic turn/current-state signal evaluation. No provider work.
2. **RETRIEVAL** — Historian/retrieval work when its wake signals require it.
3. **EXPANSION** — graph/current-state expansion and independently signalled precision work. Independent tasks remain concurrent inside the layer.
4. **PRECISION** — Truth/precision only when ambiguity still warrants it. A clean graph result with no unresolved/conflicting refs may satisfy the precision obligation through its declared fallback instead of another physical provider call.
5. **DEEP** — consolidation/deep work is checkpointed/deferred outside the foreground deadline.

The policy is not “serialize the same work.” Known independent ambiguity can keep Graph + Truth concurrent in EXPANSION; staging is used only when a preceding result can actually avoid or downgrade later work.

Jev has an additional bounded gate. It is admitted only when:

- the owner explicitly requests the Jev stage and the choice proposal nominates it;
- the request is still pre-Seal and before deadline;
- expected decision value meets the configured threshold; and
- a finite unresolved choice remains.

Jev remains advisory and has no truth, Settlement, canonical mutation, final choice or Context Seal authority.

## Continuous Gather and fallback rules

`GatherCoordinator` remains the canonical accepted Gather contract.

Layer execution feeds accepted fresh results into Gather continuously. Required work either:

- returns fresh before the task hard deadline; or
- takes its declared typed fallback while the revision fence is still fresh and the turn is still pre-Seal.

Opportunistic work can be skipped under deadline pressure. Deep work is deferred. Results that become stale or late are rejected from the sealed foreground turn.

A required fallback is **not** a way around freshness. Revision state is checked at layer boundaries and immediately before fallback synthesis. If the turn revision changed, the stale result is rejected and a fallback is not manufactured against the older revision.

Provider execution already carries a deadline abort controller. Gather closure therefore does not intentionally wait beyond a worker hard deadline for optional work.

## Replay, reload and repeated-turn fence

The checkpoint identity now includes chat and generation identity in addition to turn/correlation/proposal/revision/task identity.

Within a runtime instance, a completed checkpoint is remembered. Replaying it:

- performs zero new physical provider attempts;
- returns a replay receipt; and
- after Seal, strips prior owner-admissible results and Jev receipt instead of re-admitting old work.

A serialized pre-execution checkpoint can be loaded into a new runtime and resumed normally. Once completed in that runtime, repeating the same persisted checkpoint is deduplicated.

Durable persistence of the **completed-checkpoint cache itself** across a full host process restart remains an installed-host/owner persistence integration item; this branch does not pretend an in-memory completion cache is durable storage.

## Peak-retention reduction

The pre-layer result object remains available while the layer is executing and being normalized. After a result is accepted at the layer boundary, the retained result is reconstructed into the valid `CognitiveWorkerResult` contract with:

- payload;
- provenance;
- revision/freshness identity;
- result/worker/provider/model identity;
- bounded measurement class/cost-status evidence; and
- bounded validation status.

Large transient provider metadata/diagnostic structure is not retained for every completed layer. The Wave 21 evaluation reports a retained-byte estimate; this is not a browser heap claim.

## Worker 1 runtime/receipt handoff

Worker 1 may consume the existing fan-out/Gather contracts plus the following Worker 2 evidence without granting Worker 2 authority:

### Runtime qualification evidence

`runtime-director-bridge.js` now preserves:

- `requestedCapabilities`
- `missingCapabilities`
- `incompatibilities`
- `constraintFailures`
- `missingRequirements`
- `optionalCapabilitiesAvailable`

These are qualification facts only. WorkerDirector/Lifecycle authority remains Worker 1-owned.

### Jev owner cognitive receipt

The Jev owner handoff now separates:

- provider attempt count;
- physical-success count;
- provider/profile/resource/worker/model identity;
- measurement class;
- latency class;
- cost class/status;
- stale/post-Seal status;
- owner review performed;
- owner decision; and
- owner accepted.

A connected/qualified Jev resource is not counted as a physical decision. An admitted Jev service that deterministically skips is recorded as skipped, not returned.

## Worker 3 read-only telemetry contract

`LayeredScatterWaveReceipt@1` and per-layer receipts expose bounded metadata only:

- selected `chatId / turnId / generationId`;
- correlation and parent receipt/checkpoint identity;
- trigger and layer;
- admission / skip / defer / fallback reason;
- queue depth and peak same-layer concurrency;
- layer duration;
- logical job count;
- physical attempt count and returned count;
- fallback / skipped / failed / deferred counts;
- retained-byte estimate;
- cost class;
- Gather close time, quorum state, late and stale counts;
- separate Sidecar / Jev / Vectoring configured, qualified, physical-attempt, returned, owner-accepted, skipped and failed state.

The read model explicitly declares no raw prompt, story body, Lore body, credentials or hidden reasoning, and carries no truth/Settlement/mutation/Seal authority.

Worker 3 should consume this receipt; Worker 2 does not patch Worker 3 UI projection logic in this PR.

## Jev usefulness benchmark contract

`JevUsefulnessBenchmark@1` compares deterministic-only and Jev-assisted cases on:

- correctness;
- abstention;
- false certainty;
- mean / p95 latency;
- physical provider executions;
- owner acceptance; and
- cost, only when measurement class is `MEASURED_LIVE`.

Fixture/local deterministic execution is reported separately from live provider execution. Local fixture evidence cannot close the measured OpenRouter/provider criteria in #212 or FT005.

## Failure/recovery matrix

Wave 21 coverage includes:

- quiet turn / zero optional physical execution;
- retrieval-heavy planning;
- Scene transition with foreground Graph and Deep consolidation deferral;
- clean current-state turn where Graph prevents needless Truth physical execution;
- explicit ambiguity retaining same-layer Graph + Truth concurrency;
- provider unavailable;
- provider timeout;
- revision drift / stale result;
- post-Seal replay rejection;
- chat and regeneration checkpoint isolation;
- serialized checkpoint reload;
- repeated checkpoint resume without duplicate physical execution;
- Sidecar/Jev/Vectoring lifecycle-state separation; and
- Jev deterministic-vs-assisted fixture evidence.

Preserved suites additionally cover the accepted native swarm, Jev replay, provider routing and backend closure contracts.

## Performance claim boundary

The same-workload Wave 21 evaluation compares an unlayered two-job physical-state burst to the layered path and separates:

- Scatter planning;
- physical worker/provider attempts;
- provider execution latency;
- result normalization latency;
- Gather close time;
- retained bytes; and
- logical work avoided.

Journal publication and main-thread/UI handoff are explicitly marked downstream/unmeasured in the Worker 2 report because Worker 3 owns those surfaces.

This is a Node/local-deterministic benchmark. It is **not** an installed-SillyTavern browser performance pass and does not claim browser long-task or peak-heap improvement. The previously observed Chromium long task near 912 ms remains a reason installed-host profiling is required after integration.

## Baseline debt and review rule

The current main baseline already has red cross-owner suites. The exact-main-derived integration evidence shows two Native Brain identity/budget failures. Main's existing Worker 3 cognition resource projection also lets an explicit stored `false` physical-attempt flag mask positive per-turn execution telemetry; this branch deliberately does not patch that UI-owned file.

Wave 21 CI therefore treats changed-surface suites, preserved Worker 2 contracts, syntax and module import as blocking. The full repository regression remains visible and is classified against the inherited baseline rather than hidden.

## Installed-host proof still required

Do not close FT005 from this branch.

Remaining installed SillyTavern evidence includes:

- authenticated optional provider executes through real owner admission;
- Jev, Sidecar and Vectoring configured/qualified/attempt/returned/owner-accepted states observed in the installed host;
- same installed workload before/after browser main-thread long-task and peak/retained memory profiling;
- user-visible responsiveness and time-to-Seal under ordinary, retrieval-heavy and transition turns;
- provider unavailable/timeout/late/stale paths in the installed host;
- chat switch, regeneration and full reload evidence with no duplicate physical execution or late admission; and
- measured live Jev usefulness/latency/cost corpus.

FT005 remains In Progress until those conditions are met.
