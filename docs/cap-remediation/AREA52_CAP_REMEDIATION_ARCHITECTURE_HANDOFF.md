# Area-52 Cap Remediation Architecture Handoff

## Purpose

After the current Area-52 correctness repairs are complete, perform a dedicated architecture wave to audit and repair production caps, ceilings, truncation boundaries, queue limits, retrieval limits, and residency limits.

The objective is **not** to remove limits or blindly increase constants.

The objective is:

> **Area-52 may bound work, latency, concurrency, hot residency, payload size, and prompt publication. It must not silently bound the amount of canonical knowledge that can eventually be processed or recovered.**

The working principle comes from a behavior Nexus handled well in practice:

> **Bound the amount of work performed now, not the amount of knowledge that can ultimately exist.**

Area-52 already has better infrastructure than Nexus for implementing this correctly: resumable Runtime obligations, checkpointed batches, revision fences, background/deferred work, source drillback, paging, Candidate Bus, Gather, Context Seal, and explicit authority boundaries.

The problem is that older fixed ceilings remain inside several producers and retrieval paths. In a few places Area-52 still performs operations equivalent to:

`input.slice(0, N)`

and then treats the bounded result as the complete input.

That behavior must be eliminated wherever it can silently discard semantic coverage.

---

# Starting Rule

Do **not** begin this wave until the current repair work is complete and pushed.

The current Lore chat-scoped authorization/status repair must remain intact, including the installed action:

`authorizeLorebookForChat`

and its installed-binding/status/reason propagation work.

Before making cap changes:

1. Fetch current `main`.
2. Record the exact starting SHA.
3. Review everything merged since the previous Area-52 architecture baseline.
4. Do not reset to an older SHA.
5. Preserve concurrent work.
6. Create a dedicated cap-remediation branch.
7. Keep the work reviewable in its own PR.
8. Do not merge unless explicitly authorized.

---

# Core Architecture Invariant

Every meaningful cap must be classified as one of:

`SLICE`

A bounded amount of a larger job is processed now. Remaining work is checkpointed and continues later.

`PAGE`

A bounded search/traversal window is processed. More results remain addressable through continuation or targeted expansion.

`RANK`

Only the best N items are sent downstream for this turn. The remaining knowledge still exists.

`CACHE`

Only hot/fast state is bounded. Eviction affects latency, not canonical availability.

`PHYSICAL`

A genuine resource limit such as provider context, concurrency, payload/network capacity, cost, memory safety, or runaway execution.

`DIAGNOSTIC`

Only historical/operator presentation is bounded. Authoritative runtime state must not depend on the discarded telemetry.

There should be no production semantic cap whose effective behavior is:

`TRUNCATE_AND_FORGET`

unless there is an explicit architectural reason and an explicit incomplete-coverage result.

---

# Mandatory Cap-Hit Receipt

Where practical, cap-aware components should expose enough information to distinguish complete work from bounded work.

Use existing contracts where possible rather than inventing duplicate receipt families.

Useful fields include:

- `processed`
- `remaining`
- `boundedOut`
- `coverageComplete`
- `continuationAvailable`
- `continuationCursor`
- `reasonCode`
- `limit`
- `limitType`
- `deferred`
- `fallbackAvailable`
- `canonicalKnowledgeDropped: false`

Do not require every subsystem to use those exact field names if it already has an appropriate contract.

The important requirement is that downstream systems and diagnostics can tell:

**complete result**

from:

**valid but incomplete bounded result**

from:

**failed/unavailable result**.

---

# Architectural Invariants That Must Not Be Changed

Cap remediation must increase **eventual coverage**, not instantaneous fan-out.

Preserve these systems and ownership boundaries:

- Scatter concurrency semantics.
- Gather quorum semantics.
- Candidate Bus admission authority.
- Sidecar A/B routing.
- Dynamic Fan-Out ownership.
- Provider/resource capacity control.
- Truth authority.
- Jev advisory-only authority.
- Context Seal as the foreground publication boundary.
- Revision/staleness fences.
- Current-source/freshness validation.
- Canonical mutation ownership.
- Runtime foreground priority.
- Background work yielding to generation.
- Exact source drillback.
- Story/chat isolation.
- Resource-scoped mutation admission.

Do not “fix” a knowledge cap by spawning dramatically more simultaneous workers.

The preferred shape is:

`more total work → more slices/pages/checkpoints`

not:

`more total work → more simultaneous Scatter/Sidecar pressure`.

---

# Reference Pattern Already Inside Area-52

Use the Lore Wave 2 representation system as one primary reference.

It already implements the correct basic philosophy:

`source`
→ deterministic source slicing
→ overlap
→ full coverage validation
→ coverage receipt
→ bounded representation work
→ exact source preservation

It explicitly checks complete source coverage rather than silently stopping after the first bounded slice.

The Runtime Batch Engine is the other reference pattern:

`pending work`
→ bounded adaptive slice
→ execute
→ validate
→ freshness check
→ checkpoint/commit
→ yield
→ continue

Those two patterns should guide the remediation.

---

# CAP REMEDIATION MATRIX

## 1. Lore Study — highest priority

### `MAX_SENTENCES = 96`

Current behavior effectively limits one source revision to the first 96 studied sentences.

Change semantics to:

`maxSentencesPerStudySlice = 96`

Expected behavior:

`1–96`
→ checkpoint

`97–192`
→ checkpoint

continue until complete.

A source must not be reported as fully studied when unprocessed sentences remain.

Track complete sentence coverage.

---

### `MAX_CHUNKS = 24`

Current loop behavior must be inspected carefully.

The existing logic advances the sentence index by two while comparing that index against `MAX_CHUNKS`, which appears capable of producing approximately twelve two-sentence chunks rather than twenty-four complete chunks.

Repair this so the limit means what its name says.

Use:

`24 context chunks per work slice`

with a cursor/continuation.

All source text must eventually receive contextual coverage.

---

### `MAX_ENTITIES = 96`

Do not allow entity 97+ to vanish from study.

Convert to a bounded publication/extraction slice.

Entity identity/deduplication must span the complete study session.

---

### `MAX_CLAIMS = 192`

Convert from total source ceiling to bounded processing/checkpoint size.

Claim 193+ must remain pending rather than disappear.

---

### `MAX_RELATIONSHIPS = 128`

Same principle.

Bound extraction work, not complete source knowledge.

---

### `MAX_CONCEPTS = 128`

Ontology derivation can remain bounded per slice.

Continue derivation across slices/checkpoints until all eligible concepts have been considered.

---

### Per-sentence entity candidate cap of `8`

Inspect whether overflow is silently discarded.

If so, either:

- continue entity extraction,
- use another deterministic extraction pass,
- or preserve the unresolved/unprocessed overflow explicitly.

Do not silently make the ninth meaningful entity nonexistent.

---

### Alias cap of `8`

A compact entity artifact may remain bounded, but all source aliases must remain recoverable through exact source/drillback/index structures.

---

### `MAX_RETRIEVAL_FORMS = 32`

This can remain a hard artifact-type sanity bound because the number of legitimate retrieval form types is inherently small.

If ever hit, fail explicitly rather than silently dropping forms.

---

## 2. Lore Representation

Current relevant defaults include approximately:

- source slice characters: 1,200
- overlap: 120
- max slices: 128
- contributions per slice: 48
- total contributions: 512
- relationship refs: 128
- claim refs: 192
- behavioral anchors: 64
- sensory anchors: 64
- validation refs: 768
- max representation characters: 24,000
- max provider request characters: 96,000

### 1,200-character source slicing

KEEP.

This is a good bounded processing unit.

---

### 120-character overlap

KEEP unless testing proves a better measured value.

---

### `maxSlices = 128`

Current terminal behavior can raise:

`SOURCE_SLICE_LIMIT_EXCEEDED`

Instead, support continuation/sharding.

Process up to 128 source slices in one representation work unit, checkpoint, then continue.

Final coverage receipt must still prove the complete exact source was covered.

---

### `48 contributionsPerSlice`

KEEP as bounded extraction work.

Overflow can continue in another extraction unit if necessary.

---

### `512 totalContributions`

Do not silently truncate legitimate grounded contributions.

Use representation segments/shards under the same source revision.

For example:

`representation:source:r7:segment:1`

`representation:source:r7:segment:2`

All segments retain common parent source/revision identity.

---

### Ref and anchor limits

Keep individual payloads bounded.

If complete provenance/dependency information exceeds one payload, use paged manifests/shards rather than losing freshness or authority information.

Do not truncate the full identity needed to validate source freshness.

---

### `24,000 maxRepresentationCharacters`

KEEP as one representation artifact budget.

Create additional representation segments if required.

Do not make one giant representation blob.

---

### `96,000 provider request characters`

KEEP as a physical provider/request boundary.

Split the work.

Never solve this by truncating the exact source.

---

## 3. Lore Retrieval

Current notable limits include:

- query: 512 chars
- examined records: 512
- nominations per intent: 16
- total nominations: 24
- retrieval tokens per record: 192
- candidate representation: 1,600 chars
- source/evidence/dependency refs: 64
- hierarchy depth: 12
- children per summary: 64
- source refs per summary: 4,096
- scope count: 12,000
- community scopes: 256

### Query length `512`

Do not make long user input disable Lore retrieval.

Construct a bounded retrieval representation from the complete input:

- entities
- exact names
- locations
- active threads
- important noun phrases
- explicit references
- query intent

The derived retrieval query may be bounded.

The original request identity must remain intact.

---

### `512 examined entries`

Make this:

`512 per retrieval page`

Normal turns should usually stop after page one.

Continue/search deeper when:

- exact reference was not found,
- retrieval quality is weak,
- coverage is insufficient,
- `boundedOut` is high and relevant,
- or a targeted continuation is requested by policy.

Do not automatically scan everything every turn.

---

### `16 nominations per intent / 24 total`

KEEP.

These are good Candidate Bus pressure controls.

More searching may occur upstream, but downstream publication remains bounded.

---

### `192 tokens per retrieval record`

Do not simply index the first 192 tokens of giant records.

Create bounded searchable chunks tied to a common canonical source identity.

---

### Candidate text `1,600`

KEEP as a transport/presentation bound.

Exact drillback must remain available.

---

### Candidate source/evidence/dependency refs `64`

KEEP payloads bounded, but retain complete dependency/freshness identity in a recoverable manifest if necessary.

---

### Hierarchy children `64`

Large branches should shard/page.

Do not make child 65 invisible.

---

### Hierarchy depth `12`

Determine whether this is truly an authored-tree structural safety limit or just an early implementation ceiling.

If legitimate authored hierarchy may exceed depth 12, support continuation/virtual grouping rather than silently ignoring deeper structure.

---

### Source/evidence refs `4,096`

Large summary provenance must remain recoverable through paged manifests.

---

### Scope/community capacities

Treat as derived-navigation working-set/storage limits.

They must not determine whether canonical Lore is supported.

---

## 4. Production Sparse Lore Index

Current default:

`maxArtifacts = 512`

with explicit `boundedOutCount`.

This is already partially honest.

Change the semantics from:

“first/priority 512 are the available sparse world”

to:

“512 are the current active sparse working set.”

When sparse coverage is insufficient:

- targeted exact lookup,
- page expansion,
- cold indexing,
- deterministic fallback,
- or another owner retrieval route

must remain available.

The existing exact-query prioritization should remain.

---

## 5. Scene Observation

### Narrative input `.slice(0, 6000)`

Remove terminal truncation.

Use bounded Scene observation segments under one parent observation/source revision.

Example:

`source revision`
→ Scene segment 1
→ Scene segment 2
→ Scene segment 3
→ validate/reconcile
→ owner result

Do not create three independent story events.

Foreground processing may use completed valid work.

Remaining work may continue into permitted background/next-turn behavior.

Current Context Seal semantics remain unchanged.

---

## 6. Scene Query Planning

### Query text `320 chars`

Do not simply retain the first 320 characters.

Derive a compact Scene query from complete input.

---

### Max intents `8`, hard maximum `12`

KEEP as a planning wave.

Overflow intents should be prioritized/deferred rather than silently forgotten when materially relevant.

---

### Graph traversal defaults

Current intent contracts include approximately:

- depth 3
- nodes 64
- edges 128
- candidates 32

Treat these as traversal-page budgets.

Expose incomplete coverage.

Allow targeted continuation where needed.

---

### Scene retrieval `8 results`

KEEP as ranked delivery.

---

### Temporal path default 4 / maximum 8 hops

Allow deeper explicit historical path resolution through continuation rather than treating eight as the maximum distance the system can ever know.

---

## 7. Scene Prefetch

Current:

- 32 pending
- 8 intents/pass
- TTL roughly 3 revisions

KEEP.

Prefetch is disposable optimization.

Eviction may reduce performance only.

Normal foreground retrieval remains authoritative fallback.

---

## 8. Context Compiler

Current default:

`maxFactsPerSection = 12`

Do not remove context publication limits.

Instead, make section budgets adaptive.

Inputs may include:

- remaining context window,
- model profile,
- current Scene pressure,
- unresolved conflicts,
- importance,
- active threads,
- hard rules,
- prompt budget,
- amount of high-quality evidence.

Twelve may remain the default starting point.

The important distinction:

facts not published to the prompt still exist in Area-52.

Context Compiler caps **delivery**, not knowledge.

---

## 9. Memory Historian

Current notable bounds include:

- query 600 chars
- examined artifacts 512
- candidates 48
- episodes 24
- reflections 12
- evidence bytes 65,536
- excerpt characters 1,600
- indexed terms/artifact 192

### Query `600`

Use a derived search representation.

Do not reject ordinary long narrative intent simply because the raw text exceeds 600 chars.

---

### Examined `512`

Convert to a retrieval page.

---

### Candidates `48`

KEEP as ranked nomination output.

---

### Episodes `24` / reflections `12`

KEEP as delivery/result class budgets.

Search may continue deeper when necessary.

---

### Evidence `65,536 bytes` / excerpt `1,600`

KEEP per retrieval payload.

Exact drillback remains available.

---

### Indexed terms `192`

Chunk/multi-index large Memory artifacts.

Do not make the tail of a Memory artifact undiscoverable.

---

## 10. Memory Internal Traversal / Batches

Current notable values include:

- projection slots 4,096
- journal traversal 8,192
- graph traversal claims 512
- episodes/batch 64
- reflection batch 32
- checkpoint work units 32
- summary work units 32
- consolidation jobs 4,096

### Projection/journal/graph traversal

Make large traversals pageable/resumable where they can affect knowledge access.

---

### Episode/reflection/checkpoint/summary batches

KEEP.

These are good bounded processing limits.

Checkpoint and continue.

---

### Consolidation job capacity

Do not drop work beyond queue capacity.

Use Runtime parking/backpressure.

---

## 11. Memory Vector Index

Current:

- vectors 4,096
- pending jobs 4,096
- maintenance max 16/cycle
- dense candidates max 48
- receipt history ~128

### `maxVectors = 4096`

KEEP as dense hot residency.

Eviction must be visible and recoverable.

Canonical Memory still exists.

Allow vector regeneration/wake.

Lexical/deterministic fallback must continue to work.

---

### `maxPending = 4096`

CHANGE.

Current code removes oldest pending jobs when over capacity.

Do not silently drop pending semantic maintenance.

Overflow should become parked/backpressured/reconstructable work.

Possible receipt:

`DEFERRED_BACKPRESSURE`

The Runtime remains responsible for eventual resumption where appropriate.

---

### Maintenance 16/cycle

KEEP.

Excellent bounded background behavior.

---

### Dense result maximum 48

KEEP.

Ranked output only.

---

## 12. Memory Summary / Hierarchy

Current large caps include:

- summary scopes 2,048
- child scopes 512
- episode logical IDs 512
- evidence refs 8,192
- source revision refs 8,192
- entity refs 512
- summary chars 12,000
- representative evidence 24
- drillback rows 256

Convert large summary structures into hierarchical/paged summaries.

Summary size may remain bounded.

Exact evidence must remain drillable and recoverable.

A summary is an access artifact, not the only copy of knowledge.

---

## 13. External Memory Evidence

Current raw external input:

`32,768 characters`

Convert to segmented exact evidence admission.

One enormous narrative/evidence object may create several evidence segments under a shared parent/logical source.

Do not drop everything beyond character 32,768.

---

## 14. External Mapping / Event Retention

Examples include:

- 8,192 external mappings
- 32 mapping-history entries per identity
- 2,048 external Scene proposals
- 4,096 owner events

Separate:

operational history needed for replay/freshness/recovery

from:

diagnostic/archive history.

Anything required to prove current identity, stale detection, correction lineage, or replay must remain durable/reconstructable.

Old presentation history may compact/archive.

---

## 15. Memory UI Limits

Examples:

- evidence rows 256
- episodes 128
- reflections 64
- summaries 128
- retrieval history 128
- retrieval artifacts 48

KEEP as UI/display caps.

Add pagination/virtualization where needed.

UI limits must never constrain backend knowledge.

---

## 16. Speculative Warmer

Current:

- cache capacity 24
- candidate/evidence refs max 64
- TTL default 2 turns

Cache capacity and TTL are fine.

A packet exceeding the ref budget should not cause correctness failure.

Possible outcomes:

- rank top refs,
- split warm packet,
- decline warming,
- record `WARMER_BUDGET_EXCEEDED`,
- fall back to ordinary retrieval.

Warmer failure may affect latency only.

---

## 17. Jev Advisory

Current approximately:

- 2 conflict sets/turn
- 8 members/set
- 64 advisory rows
- 240-char summaries

Keep the per-turn advisory workload bounded.

For overflow:

`UNRESOLVED / DEFERRED_JEV`

rather than permanently making large conflict sets invisible.

Do not increase simultaneous provider calls to compensate.

Jev remains advisory only.

---

## 18. Dynamic Fan-Out / Scatter

Current examples:

- max workers 16
- cost units 16
- bounded foreground/opportunistic/background nominations
- layered scatter concurrency bounded
- Sidecar concurrency default 2
- maximum layer concurrency around 8
- providers/task default 2

KEEP.

These are physical/operational caps.

Cap remediation elsewhere must not increase instantaneous Scatter pressure.

If a larger upstream task requires more work:

process more slices over time.

Do not create uncontrolled parallelism.

---

## 19. Sidecar Checkpoint Size

Current default approximately:

`131,072 bytes`

KEEP as a physical serialization/resource boundary.

If a task cannot checkpoint within the size:

split the work/checkpoint representation.

Do not remove the checkpoint safety boundary.

---

## 20. Deep Scheduler Queue

Inspect carefully.

The Hot/Deep scheduler supports:

- foreground reserve
- deep queue
- DEFER/backpressure decisions
- yielding
- checkpoints
- parked-owner state
- resume

This is good.

However, installed configuration can make the deep queue very small relative to larger workloads, and direct `enqueueDeep()` can throw when capacity is exhausted.

Correct behavior should be:

`deep scheduler at capacity`
→ upstream Runtime obligation stays parked/deferred
→ retry when capacity becomes available

not:

`capacity full`
→ obligation disappears or becomes an unrecoverable failure.

Do not make the queue infinite.

Use actual backpressure.

---

## 21. Runtime Batch Engine

Current adaptive behavior:

- base roughly 4
- max roughly 32
- slice time target around 25 ms
- foreground pressure shrinks slices
- backlog/deadline conditions can increase slice size
- checkpoint after each committed slice

KEEP.

This is the primary pattern other long-running subsystems should emulate.

---

## 22. Resource Governor

Current physical CPU/resource capacities and foreground reserve should remain.

Make tuning environment/config aware where appropriate.

Do not use Resource Governor values as semantic knowledge limits.

---

## 23. Provider Resource Limits

Examples:

- resource connections around 16
- routed candidates around 8
- fallback providers around 2
- provider concurrency per profile
- provider context/output limits

KEEP.

These are legitimate physical constraints.

Work must reshape/split/fallback around them.

---

## 24. Provider Timeouts / Health

Examples:

- provider transport ~30 sec
- discovery/health ~10 sec
- provider health event window ~20
- degraded failure threshold ~25%
- cooldown threshold ~50%
- cooldown ~30 sec

KEEP initially.

Tune from real telemetry later.

Do not confuse provider lifetime with foreground quorum lifetime.

---

## 25. Diagnostics / History

Bounded telemetry is fine.

Examples:

- histories 64/128
- shortened diagnostic strings
- limited failure arrays
- bounded details

KEEP.

But recovery/authority/freshness information must never exist solely inside disposable diagnostics.

---

# Scatter / Gather / Sidecar Safety Requirements

This wave must explicitly test that increased eventual coverage does not increase instantaneous fan-out.

Example correct Lore behavior:

500-sentence source

`Study 1–96`
→ checkpoint

`97–192`
→ checkpoint

`193–288`
→ checkpoint

`289–384`
→ checkpoint

`385–480`
→ checkpoint

`481–500`
→ validate complete coverage

Then normal Lore Retrieval runs and still returns at most the existing bounded nomination budget.

Candidate Bus / Gather / Truth / Context Seal receive the same bounded contract shape as before.

Incorrect behavior would be:

500 sentences
→ six independent cognitive workers
→ six Scatter waves
→ six candidate floods
→ Gather overload.

Do not implement the incorrect form.

---

# Atomicity / Publication Requirements

Where partial semantic processing would expose misleading incomplete owner state, stage the results until a safe publication boundary.

Use existing revisioned owner mechanisms.

Possible patterns:

- publish only after complete source study;
- publish revisioned shards with explicit complete/incomplete manifest;
- retain previous valid representation until replacement coverage completes.

Never silently replace a complete old representation with an incomplete new one unless the contract explicitly represents that state.

---

# Staleness Requirements

Every resumable page/slice must remain fenced by the appropriate identity.

Depending on subsystem:

- chat/story identity
- source revision
- Lore source revision
- Scene revision
- world revision
- Memory artifact revision
- provider/profile revision
- retrieval policy revision

If the source changes during a multi-slice job:

old remaining work must become stale.

It must not complete against the new source.

---

# Cap-Hit Test Matrix

For every semantic cap that changes, test at least:

`limit - 1`

`limit`

`limit + 1`

`2 × limit`

a materially large stress case

The test must verify more than “didn't crash.”

For each case prove one of:

- complete coverage;
- valid continuation;
- paged continuation;
- deferred work remains owned;
- canonical fallback exists;
- intentionally bounded publication only.

Also prove:

- no silent knowledge loss;
- no duplicated publication;
- no cross-chat/story leakage;
- no stale continuation publication;
- reload/recovery works where applicable;
- foreground remains responsive;
- Scatter/Gather load stays bounded;
- provider concurrency is unchanged unless explicitly intended.

---

# Required Cross-System Regression

After cap remediation, run existing suites plus focused end-to-end checks covering:

Lore source → Study → Representation → Retrieval → Candidate Bus → Truth → Gather → Context Seal.

Memory evidence → Historian/index → Retrieval → Candidate Bus → downstream publication.

Large Scene narrative → Scene observation slices → owner reconciliation → future-turn consumption.

Cold/evicted Memory vector → deterministic fallback → eventual vector maintenance.

Large Lore index → bounded first retrieval page → continuation/targeted lookup.

Oversized Warm Packet → fallback retrieval.

Jev overflow → unresolved/deferred rather than dropped.

Deep queue pressure → parked work rather than lost work.

Reload during multi-slice work → resume from valid checkpoint.

Source edit during continuation → stale slices rejected.

Chat switch during background work → wrong-chat result rejected.

---

# Diagnostics Requirements

Add truthful cap visibility.

Useful operator questions should become answerable:

- What cap was hit?
- Was it a work cap or knowledge cap?
- How much was processed?
- How much remains?
- Is continuation queued?
- Was anything bounded out of this turn?
- Is canonical data still available?
- Did a fallback execute?
- Was work dropped?
- Did the source change before completion?
- Did the result publish?
- Did the cap affect foreground latency?

Avoid noisy per-unit logging.

Aggregate where possible.

---

# Implementation Priority

Priority 0 — finish current correctness repair before starting this wave.

Priority 1 — semantic truncation risks:
Lore Study sentence/entity/claim/relationship/concept caps; Lore chunks; Scene 6,000-char truncation; external Memory raw input.

Priority 2 — silent lost work:
Memory vector pending overflow; deep scheduler/backpressure ownership; consolidation/work queue overflow.

Priority 3 — bounded search coverage:
Lore 512 examined; sparse active index; Memory Historian 512; graph traversal; temporal traversal.

Priority 4 — derived representation overflow:
Lore representation max slices/contributions; hierarchy children/depth/ref manifests; Memory summaries/hierarchy.

Priority 5 — publication tuning:
Context Compiler adaptive facts; nomination/result delivery budgets.

Priority 6 — audit remaining CACHE/PHYSICAL/DIAGNOSTIC caps and confirm they cannot affect correctness.

---

# Things Not To Do

Do not globally raise every number.

Do not make queues infinite.

Do not remove provider timeouts.

Do not remove foreground reserve.

Do not wake every Sidecar.

Do not increase Scatter concurrency to compensate for larger input.

Do not increase Candidate Bus/Gather volume simply because more source material was processed.

Do not allow partial slices to bypass revision/freshness validation.

Do not let a continuation mutate canonical state outside existing ownership.

Do not weaken tests simply because previous tests encoded a hard cap.

When a test expectation changes, document the architectural reason and replace it with a stronger coverage assertion.

Do not claim “complete coverage” without a coverage receipt or equivalent deterministic proof.

---

# Cap Ledger Requirement

Create and maintain a reviewable cap ledger during the work.

For every cap record:

| Field | Required information |
|---|---|
| Subsystem | Lore, Memory, Scene, Runtime, etc. |
| Source location | Exact file/symbol |
| Current value | Existing number/default |
| Current behavior | What happens when hit |
| Current risk | None / latency / knowledge loss / work loss / correctness |
| New classification | SLICE / PAGE / RANK / CACHE / PHYSICAL / DIAGNOSTIC |
| New behavior | Exact intended handling |
| Continuation | How remaining work survives |
| Canonical recovery | Where complete knowledge remains |
| Downstream impact | Scatter/Gather/etc. |
| Test coverage | limit-1 / limit / limit+1 / 2x / stress |
| Status | untouched / changed / validated |

The ledger is part of the deliverable.

---

# Acceptance Standard

The wave is not complete merely because all tests are green.

It is complete when we can truthfully say:

> Large knowledge does not become nonexistent because a processing limit was reached.

And:

> Increasing workload size causes Area-52 to perform more bounded/resumable work rather than create uncontrolled parallelism.

And:

> Existing downstream contracts remain bounded.

And:

> The system truthfully reports incomplete coverage instead of silently acting complete.

And:

> Canonical information remains recoverable after cache eviction, index limits, retrieval paging, queue pressure, or foreground deadlines.

---

# Desired End-State Examples

### Huge Lore source

Before:

`340 sentences → first 96 studied → remainder absent from learned model`

After:

`340 sentences`
→ `96`
→ checkpoint
→ `96`
→ checkpoint
→ `96`
→ checkpoint
→ `52`
→ complete coverage
→ normal bounded retrieval.

---

### Huge Scene message

Before:

`15,000 chars → first 6,000 observed`

After:

`15,000 chars`
→ bounded observation segments
→ foreground consumes what safely completes
→ remainder finishes through allowed continuation
→ Scene owner reconciles under the same source identity
→ later turns see complete accepted state.

---

### Large retrieval space

Before:

`>512 candidates → first bounded discovery window becomes entire universe`

After:

`page 1 = 512`
→ quality/coverage check
→ sufficient: stop
→ insufficient/exact miss: targeted page/expansion
→ rank globally enough for this request
→ publish normal <= existing candidate budget.

---

### Vector maintenance pressure

Before:

`pending >4096 → oldest pending jobs removed`

After:

`pending capacity reached`
→ new/excess obligation parked/backpressured
→ canonical Memory remains valid
→ fallback retrieval continues
→ maintenance resumes when capacity is available.

---

### Large representation

Before:

`source requires >128 slices → SOURCE_SLICE_LIMIT_EXCEEDED`

After:

`representation segment window 1`
→ checkpoint
→ window 2
→ full coverage receipt
→ bounded representation shards
→ exact source remains canonical.

---

# Final Architecture Principle

The remediation should leave Area-52 with this distinction everywhere:

**Knowledge capacity:** effectively limited only by durable storage and genuine platform constraints.

**Working-set capacity:** deliberately bounded.

**Per-turn retrieval:** deliberately bounded.

**Prompt publication:** deliberately bounded.

**Concurrency:** deliberately bounded.

**Provider usage:** deliberately bounded.

**Caches:** deliberately bounded.

**Individual processing slices:** deliberately bounded.

**Eventual semantic coverage:** not silently bounded.

That is the lesson to carry forward from Nexus without reverting Area-52 back into Nexus.

Area-52 should keep its stronger ownership, revision, Runtime, Scatter/Gather, Truth, and Context Seal architecture.

The change is simply:

> **When Area-52 reaches a limit, reshape the work instead of amputating the knowledge.**
