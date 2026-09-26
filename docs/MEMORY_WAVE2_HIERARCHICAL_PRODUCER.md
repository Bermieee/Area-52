# Area-52 Memory Wave 2 — Hierarchical Story Memory

**Branch:** `Development-Memory`  
**Primary:** #175 Hierarchical Summary Logic + Story/Arc/Scene Compaction  
**Memory-owned supporting work:** #9 Reflection/consolidation, #79 Sleep Cycle work units, #205 Historian retrieval.  
**Preparation only:** #178 FT003 and #224 Live Brain Demo remain integration/live-owner work.

## Outcome

Wave 2 adds a browser-safe, deterministic, revisioned hierarchy above Wave 1 exact evidence:

```text
exact raw/source evidence
  -> Scene Episode / confirmed source range
  -> Scene Summary
  -> Chapter or Session Summary
  -> Arc Summary
  -> Story Summary

query
  -> resolution policy
  -> smallest useful fresh resolution
  -> CandidateNomination-compatible reference
  -> exact source drillback when precision/conflict requires it
```

A hierarchical summary is **derived navigation and recall material**. It is never independent evidence, never becomes canon because it is fluent or highly ranked, and never owns Candidate Bus admission, Truth, Settlement, context injection or Context Seal.

## Production modules

Wave 2 adds:

- `src/memory-summary-hierarchy.js`

and extends:

- `src/memory-contracts.js`
- `src/memory-temporal-producer.js`
- `src/memory-integration-surface.js`
- `tests/memory-wave2.mjs`
- `tests/memory-wave2-stress.mjs`
- `tests/memory-browser-safe.mjs`
- `.github/workflows/memory-wave1-ci.yml`
- `package.json`

The Cognitive Memory Blueprint remains the architectural reference; Wave 2 does not rewrite its authority model.

## Hierarchical artifact contract

Each `MemorySummaryScope v1.0.0` has:

- explicit `scopeRef`, scope ID and level: SCENE, CHAPTER, SESSION, ARC or STORY;
- revisioned scope definition;
- parent/child scope edges;
- exact evidence refs and/or episode logical IDs;
- bounded source selector over append sequence, world revision, Scene revision and narrative time;
- optional narrative time range and provenance;
- summary-policy and compiler revisions;
- a hard character budget.

Each `MemoryHierarchicalSummary v1.0.0` has:

- stable scope identity plus artifact revision;
- exact evidence refs and the exact source-revision set;
- source-range bounds and a source-range hash;
- exact child artifact revisions;
- narrative time range;
- settled Temporal-State claim references;
- unresolved-set references;
- inferential Reflection references;
- entity and knowledge fences;
- compiler/policy revisions and dependency fingerprint;
- provenance, cost and budget diagnostics;
- retained previous revisions;
- explicit `DERIVED`, navigation-only, non-independent-evidence authority flags.

Multiple resolutions coexist. Rebuilding an Arc does not overwrite its Scene summaries or raw sources.

## Grounded deterministic compiler

The native compiler does not need a provider, embedding service, database, SQL, Redis, Dapr, vector server or plugin.

Parents require fresh validated child artifacts, but a parent is **not validated against child prose**. Child artifacts contribute their exact source range; the parent recompiles from exact local evidence plus current/historical/unresolved Temporal-State records and fresh inferential Reflections.

Compilation preserves:

- source-canon/hard-rule evidence;
- current and historical transitions;
- unresolved competing alternatives;
- exact source drillback;
- character knowledge boundaries;
- Reflections as visibly `INFERRED NON-CANON`.

If mandatory grounded material cannot fit the requested cap, compilation fails with `MEMORY_SUMMARY_BUDGET_IMPOSSIBLE`. It does not silently delete a hard rule, contradiction or unresolved alternative.

## Incremental evolution and work units

Source invalidation, source removal, new evidence within an open selector, corrected episode revision, Reflection support change, Settlement change, or scope-definition/boundary change stales only the affected scope and its ancestors.

Unrelated scope identities remain reusable. Old source records and old summary revisions remain retained.

Compaction exposes bounded `MemorySummaryCompactionWorkUnit v1.0.0` objects with:

- expected scope-definition revision;
- expected dependency fence;
- compiler/policy revisions;
- no Runtime scheduling, worker, canonical-mutation or Context-Seal authority.

A late result whose fence moved fails with `MEMORY_SUMMARY_WORK_FENCE_CHANGED`. The work queue is snapshot/reload safe and resumable. Runtime still owns physical L3/L4 scheduling and yield.

## Resolution-aware Historian

`MemoryTemporalProducer.queryHistorian()` and the public Jev `HistorianMemoryRequest` resolver now use the same policy:

- precision/exact/who/which/immediately/before/after/when/where queries prefer exact Historian evidence;
- broad, distant, overview, recap, story/arc/history queries try higher summary tiers first;
- Scene-style recall tries Scene resolution first;
- if a useful fresh summary is unavailable, exact Historian retrieval is the safe fallback.

Summary traversal is tiered. Once a useful preferred tier is found, lower tiers are not scanned merely to nominate the same source range again. Summary nominations dedupe by source-range coverage and remain `CandidateNomination v1.0.0` compatible.

A summary nomination includes its artifact ID/revision, source-range hash, bounded representative evidence/source refs, full source/evidence counts, knowledge fence and exact-drillback metadata. The full artifact retains the exact source set even when the CandidateNomination transport is bounded.

Character-perspective retrieval is conservative: a summary is eligible only if the character is known to have access to every exact evidence record in that summary. Otherwise Memory falls back to a smaller/exact safe resolution or returns no such summary.

## Reflection interplay

Fresh recurring supported episodes may still revise `INFERRED` Reflections under Wave 1 rules. A summary may carry those Reflection references as explicitly non-canonical recall material.

When support is corrected, removed or made stale:

- dependent Reflection freshness fails closed;
- dependent summaries are invalidated;
- Historian rebuild/retrieval excludes stale artifacts;
- confidence may affect rank but grants no Settlement authority.

Wave 1 Green Room expiry and Temporal State semantics are unchanged.

## Public API and adapter path

The existing Memory API remains `1.0.0` for Wave 1 compatibility. Wave 2 adds `MEMORY_HIERARCHY_API_VERSION=1.0.0` and `MEMORY_HIERARCHY_CONTRACT_VERSION=1.0.0`.

New producer/integration methods:

- `defineSummaryScope(input)`
- `summaryWorkUnits(options)`
- `compileSummaryWorkUnit(workUnit, options)`
- `runSummaryCompaction(options)`
- `summaryArtifact(scopeRef, options)`
- `summaryHistory(scopeRef)`
- `summaryStatus()`

Minimal assembly:

1. **Scene/Core boundary adapter:** after a confirmed Scene/session/arc boundary, register exact source selectors, episode logical IDs and parent/child scope edges. Opaque external refs remain stale until mapped to exact Memory evidence.
2. **Runtime adapter:** request bounded work units or call bounded compaction at Runtime-owned L3/L4 opportunities. Runtime owns scheduling/yield; Memory owns only resumable work.
3. **Historian/Jev adapter:** existing `HistorianMemoryRequest v1.0.0` can receive exact or hierarchical Memory artifacts through the producer resolver.
4. **Core Candidate Bus/Truth/Settlement/Seal:** consume nominations as evidence references only. Drill to exact source where precision/conflict requires it. Core alone admits, settles and seals.

## Bounds

| Contract | Bound |
|---|---:|
| summary scopes | 2,048 |
| child scopes / scope | 512 |
| episode logical IDs / scope | 512 |
| exact evidence refs / summary | 8,192 |
| exact source revisions / summary | 8,192 |
| entities / summary | 512 |
| summary characters | 12,000 |
| minimum explicit summary budget | 128 |
| representative evidence anchors | 24 |
| compaction work units / call | 32 |
| exact drillback rows / call | 256 |
| Historian examined artifacts | 512 |
| Historian nominations | 48 |
| retained diagnostics | 128 |

## Representative Wave 2 stress

Connector runtime gate on the branch implementation:

- raw events: **3,000**
- episode artifacts: **1,000**
- hierarchy scopes: **111** (100 Scene, 10 Arc, 1 Story)
- initial build batches at 16 units: **7**
- correction rebuild batches: **1**
- retained summary revisions after correction: **114**
- fresh current summaries: **111**
- initial hierarchy build time in this harness: **3,157 ms**
- exact baseline query time: **3 ms**
- hierarchical query time: **13 ms**
- exact baseline artifacts examined: **40**
- hierarchical summary artifacts examined: **1**
- examined-artifact reduction: **39**
- hierarchy base-query bypass: **true**
- stale nominations during rebuild: **0**
- invalidated summary artifacts across 10 source corrections: **30**
- unrelated Arc identity preserved: **true**
- raw evidence loss: **0**
- pending work after rebuild/reload: **0**
- estimated retained hierarchy UTF-16 bytes: **3,325,300**
- compile evidence visits: **12,300**
- recorded summary Historian artifacts examined: **10**
- recorded exact-base queries avoided: **2**

The retrieval benefit is traversal work, not a claim that summary lookup is always faster. In this harness the hierarchical query took longer wall-clock time (13 ms vs 3 ms) despite examining 1 vs 40 retrieval artifacts. Production profiling should therefore track both traversal and latency.

## Required golden semantics

The production-path goldens prove:

- Ember Tavern INTACT before the fire and DESTROYED afterward remain separately reconstructible;
- Eris carrying/placing the Sun Blade remains historical;
- DESTROYED_IN_FIRE versus REMOVED_BEFORE_FIRE remains UNRESOLVED in summaries and Historian output;
- broad Tavern recall can use Story/Arc navigation;
- the immediate-pre-fire Blade query drills to exact Scene Episode evidence;
- no current Blade location is fabricated;
- Eris cannot receive Mara-only secret evidence via a world summary;
- one source correction stales/rebuilds only its Scene and ancestor cone while an unrelated Arc retains identity;
- impossible caps fail explicitly;
- interrupted/reloaded compaction resumes without duplicate publication or raw loss;
- late background results fail their revision fence.

## Ownership status

- #175: Memory-owned producer behavior implemented; keep open for assembly/integration acceptance.
- #9: Wave 2 summary/Reflection dependency interplay implemented; broader learning policy remains open.
- #79: resumable bounded Memory work is ready; Runtime scheduling/yield remains open.
- #205: resolution-aware direct and Jev resolver output is ready on the Memory lane; integrated Candidate Bus path remains open.
- #178: Memory output prepared; FT003 is not passed by this branch.
- #224: not passed.
