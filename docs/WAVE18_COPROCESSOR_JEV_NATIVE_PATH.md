# Wave 18 Coprocessor / Jev Native Path Contract

Wave 18 extends the Wave 17 backend contract without replacing it. The existing
`createCoprocessorResourceHost()` actions, reads, execution calls, credential handling,
browser-safe provider transport, and owner-handoff semantics remain unchanged.

## Authority boundary

Wave 18 code may schedule work, compute bounded proposals, checkpoint background work,
and publish diagnostic/read models. It does **not** own Truth, Precision, Character
definition, durable Memory Settlement, Context Seal, final choice, or canon.

Native Brain remains valid with:

- zero Sidecars,
- zero Jev resources,
- zero Vectoring resources,
- no external database,
- no orchestration middleware.

## #77 Speculative Context Warmer

`SpeculativeWarmCoordinator` now carries a chat identity fence in addition to scene,
world, character-state, source-revision, intent, retrieval-policy and TTL fences.

Reuse requires all relevant fences to remain valid. Fresh reuse is still only
`REVALIDATE_FOR_CORE_ADMISSION`; a predicted packet never becomes truth because it was
predicted. Scene/world/policy divergence is discarded. Source/character divergence may
only expose bounded references for foreground recheck. Queued/parked work is cancelled
on divergence. Results arriving after Context Seal are not foreground-eligible.

Measured fields include queue time, execution time, foreground-yield wait, useful fresh
reuse, false warm hits, stale/invalid discard, cancellation and avoided pipeline stages.
A cache hit is not reported as zero latency.

## #88 Hot versus Deep placement

`NativeHotDeepScheduler` is a local cooperative scheduler. HOT work has foreground
priority. DEEP work borrows spare capacity, checkpoints between slices, yields while the
foreground reserve is active, and resumes after release.

The scheduler deliberately separates:

- logical work IDs from physical resource slots,
- execution completion from owner acceptance,
- queue time from execution time,
- checkpoint/resume from durable owner Settlement.

Low expected-value optional work can be skipped. A single physical slot can service many
logical jobs. Zero optional resources continue through the native path.

## #78 Character Green Room

Green Room values are typed, provenance-bearing, `INFERRED` proposals. Perspective
validation rejects direct evidence that is not available to the character. Green Room
state remains separate from authored character definition, settled personal memory and
world truth.

`admitGreenRoomBatchToMemoryOwner()` only reports owner acceptance when a Memory owner
implements `acceptGreenRoomBatch` or `ingestGreenRoomBatch` and returns the expected
owner receipt. If that contract is absent the result is
`OWNER_CONTRACT_UNAVAILABLE` with `pendingOwnerIntegration=true`.

## #79 Continuous Memory Consolidation

`createMemoryConsolidationDeepWork()` is an adapter for an owning Memory implementation
that supplies:

- `startConsolidation(jobs, options)`
- `consolidationWorkUnits(sessionId, options)`
- `runConsolidation(sessionId, options)`

The Sidecar scheduler may run slices, checkpoint, yield and resume. Only the Memory owner
may validate source revisions and publish durable artifacts. The Wave 18 adapter reports
`ownerAccepted` only from owner-published artifact IDs. If the owner contract is absent
the factory returns `OWNER_CONTRACT_UNAVAILABLE`; it does not synthesize acceptance.

## #211 Jev Memory / Temporal adapters

Wave 18 adds two registered Jev domains:

- `MEMORY`: bounded knowledge/belief classification and consolidation review.
- `TEMPORAL`: bounded transition/contradiction/temporally-distinct review.

Both use the same generic Jev core and the same bounded request/receipt path as Lore,
Scene and Retrieval/Truth. Unsafe options that claim durable mutation, owner bypass or
authority are rejected before Jev. Jev may deterministically skip, decide, remain
unresolved, abstain or escalate. It always returns an owner proposal.

`requestJevOwnerReview()` records the owning domain's explicit
`ACCEPTED | REJECTED | UNRESOLVED | DEFERRED` decision. Post-seal Jev results remain
non-foreground and are available only for an owner-directed later path.

## Bounded operator read model

`createWave18CoprocessorReadModel()` exposes only the operational fields needed to
inspect:

- HOT/DEEP choice and timing,
- prefetch reuse/discard/cancellation counts,
- Green Room proposal summaries,
- consolidation execution/owner status,
- owner acceptance,
- Jev bounded decision metrics.

It does not expose prompts, raw evidence bodies, provider credentials or authorization
headers. Worker 3 can consume this read model later without changing the Wave 17
resource-host API.

## Deterministic two-story acceptance

The Wave 18 evaluator uses two unrelated fixtures.

**Story A — Ember Road**

- quiet turn: optional work is skipped and the native Brain decides with zero resources;
- likely next location: a prefetched packet is produced, then explicitly revalidated by
  Core before reuse;
- fast scene change: an old packet is stale/discarded and queued work for the old branch
  is cancelled.

**Story B — Harbor Siege**

- multi-character interaction: two Green Room proposals remain inferred and receive an
  owner receipt;
- long conversation: consolidation is classified DEEP, yields to foreground work,
  checkpoints, resumes and completes only through the Memory owner contract.

The evaluator also exercises Memory deterministic skip, Memory abstention, Temporal
conflicting evidence, and a late post-seal Temporal result with explicit owner decisions.

## Evidence classes

### LOCAL_DETERMINISTIC

Repository fixtures, deterministic provider adapters, fake clocks and explicit owner
fixtures. This class can prove contracts, routing, fences, timing accounting and authority
boundaries. It is not external-provider evidence.

### SIMULATED_FAILURE

Repository tests for queue saturation, divergence cancellation, stale revisions,
post-seal rejection, missing owner contracts and prior provider failure/fallback suites.
These are deliberate injected conditions.

### MEASURED_LIVE

Requires an operator-configured provider through the existing session-memory credential
path. Wave 18 stores no OpenRouter key and does not require one in CI. Until an operator
runs the live path, external usefulness, latency, model behavior and cost remain
`REQUIRES_OPERATOR_CONFIGURED_PROVIDER`.

## Standing card status after Wave 18 branch work

- **#77 Speculative Context Warmer:** implementation/acceptance substantially covered;
  product integration still depends on Scene/Core producers supplying live hints and
  owner/Core revalidation.
- **#88 Hot vs Deep placement:** native scheduler and measurements implemented; final
  Runtime/Core policy ownership and production tuning remain integration work.
- **#78 Character Green Room:** perspective-safe proposals and owner bridge implemented;
  final Character/Scene/Memory owner wiring remains cross-branch work where not present.
- **#79 Continuous Memory Consolidation:** bounded Deep adapter implemented; real Memory
  owner contract must be supplied by the owning branch before durable integration can be
  claimed.
- **#211 Jev Domain Adapter Matrix:** Lore/Scene/Retrieval/Memory/Temporal now share the
  generic core. Memory/Temporal owner settlement remains external by design.
- **#81 Cognitive Data Plane:** no new external IPC service added. Wave 18 does not claim
  measured zero-copy benefit.

Parent goals **#75**, **#206** and **#222** remain open.
