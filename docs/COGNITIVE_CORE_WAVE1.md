# Area-52 Cognitive Core Wave 1 — Contract and Golden-World Notes

This document records the executable foundation for issues #1 and #2. The architectural authority remains `docs/AREA52_COGNITIVE_MEMORY_BLUEPRINT.md` and `PROJECT_PLAN.md`.

## Cognitive contracts

**Input contract:** provider-neutral JSON-serializable values supplied to explicit constructors in `src/contracts.js`.

**Output contract:** deterministic plain objects for SourceRecord, SourceRevision, Provenance, Entity, AliasCandidate, Claim, Reflection, CandidateBusResult, TruthGateResult, MutationProposal, SettlementReceipt, CompiledContextPacket, CacheDependency, and CognitiveTask.

**Canonical authority:** contracts define shape and validation only. They do not mutate source or world state. Source canonical authority belongs to Source Registry; learned temporal truth belongs to the Temporal State Graph/settlement owner.

**Provenance behavior:** all learned/truth-bearing artifacts carry source-revision/evidence provenance. Inference remains explicitly distinguishable through `AuthorityClass.INFERRED` and `KnowledgeStatus.INFERRED`.

**Revision/freshness identity:** exact source revisions use immutable revision IDs. Mutation proposals carry `freshnessRevisionIds`. Compiled packets and cache dependencies declare source-revision dependencies.

**Invalidators:** source-revision changes and declared artifact dependencies. The contract layer does not itself invalidate state.

**Failure behavior:** invalid or non-serializable contract input throws before an artifact can enter canonical state.

**Rebuild/recovery:** constructors are pure and deterministic; any contract object can be reconstructed from durable inputs.

**Benchmark coverage:** `tests/cognitive-core.mjs` validates serializability/determinism and the complete temporal status vocabulary.

## Golden-world harness

**Input contract:** deterministic fixture sources, ordered narrative experiences, expected current/history projections, and representative present/historical queries.

**Output contract:** assertions against exact source state, learned state, provenance, retrieval, Truth Gate classification, compiled packets, and incremental invalidation as later subsystems attach to the harness.

**Canonical authority:** the fixture is expected truth for regression purposes; it does not mutate production state.

**Provenance behavior:** every expected learned fact must ultimately trace to one or more exact source revision IDs.

**Revision/freshness identity:** fixture source records are stable; edits create new revisions rather than changing earlier fixture revisions.

**Invalidators:** only artifacts depending on an edited source revision may be invalidated.

**Failure behavior:** any divergence from the deterministic world is a test failure. Historical knowledge disappearing is a failure, as is stale possession/location being classified current.

**Rebuild/recovery:** the entire world must be reproducible from the source fixture and ordered experiences.

**Benchmark coverage:** Ember Tavern / Sun Blade is the first mandatory world. Current state, historical state, stale-state rejection, provenance, source-edit dependency cones, and compact context are expanded in issue #14 coverage.


## Source Registry and provenance core

**Input contract:** source import/replacement commands plus explicit derived-artifact dependency declarations.

**Output contract:** immutable SourceRecord/SourceRevision snapshots, deterministic SHA-256 content identity, provenance-backed derived artifacts, invalidation sets, and provenance explanations.

**Canonical authority:** Source Registry exclusively owns source identity, revision history, the active-revision pointer, and source-to-derived dependency edges. It never rewrites an earlier source revision.

**Provenance behavior:** derived artifacts declare exact source revision IDs and optional artifact parents. Provenance traversal walks those links back to exact original source text.

**Revision/freshness identity:** source revisions are `<sourceId>@<monotonic revision>` plus content hash. Currentness is a registry pointer rather than a mutation to prior revision objects.

**Invalidators:** replacement of an active source revision invalidates direct dependents and their transitive artifact children only.

**Failure behavior:** unknown source/revision/dependency references fail before registration. Re-importing an existing source fails rather than silently replacing it.

**Rebuild/recovery:** active learned artifacts can be rebuilt from active source revisions. Historical source revisions remain recoverable for audit/history.

**Benchmark coverage:** tests prove hash determinism, exact old-revision recovery, active revision advancement, transitive dependency invalidation, and survival of unrelated learned artifacts.
