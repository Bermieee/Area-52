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


## Lore Study Engine foundation

**Input contract:** one active SourceRevision plus immutable source metadata and a replaceable extraction adapter.

**Output contract:** contextual source representation, entity mentions/aliases, atomic claims, relationships, temporal classifications, and typed mutation proposals. Exact source text remains exclusively owned by Source Registry.

**Canonical authority:** study outputs are derived/proposed knowledge only. Lore Study cannot directly mutate temporal world state.

**Provenance behavior:** every contextual/entity/claim/relationship/closure artifact depends on the exact studied SourceRevision. Settlement proposals carry that same freshness fence.

**Revision/freshness identity:** artifact IDs include the exact source revision. Relearning a changed source creates new derived identities rather than rewriting old artifacts.

**Invalidators:** source replacement invalidates contextual representations and every transitive dependent artifact from the old source revision.

**Failure behavior:** unsupported deterministic reference extraction throws before proposals can settle. The exact source remains recoverable and no partial world mutation occurs from failed study.

**Rebuild/recovery:** rerun study against the active SourceRevision. The extraction adapter is provider-neutral and replaceable by later batched/async workers.

**Benchmark coverage:** tests prove exact-source preservation, contextualization by reference/hash rather than rewrite, entity extraction, atomic claim extraction, relationship extraction, temporal proposal production, and exact source-revision provenance.

## Temporal State Graph foundation

**Input contract:** freshness-fenced `SET_CLAIM` and `CLOSE_SLOT` MutationProposals.

**Output contract:** settled current/historical projections plus SettlementReceipts. Timeline insertion is ordered by temporal validity, not settlement arrival order.

**Canonical authority:** Temporal State Graph is the owner of settled mutable world-state claims in this reference slice. Extraction workers remain proposers.

**Provenance behavior:** settled claims retain extraction provenance. The special pre-destruction state needed by the golden world is retained as explicitly `INFERRED` evidence, never promoted to source canon.

**Revision/freshness identity:** every settlement checks proposal source revisions against Source Registry active revisions. Stale proposals settle nothing and return `STALE` receipts.

**Invalidators:** Source Registry edit events invalidate graph claims tied to the replaced revision; affected slots are recomputed without deleting unrelated history.

**Failure behavior:** invalid mutation payloads produce failed/rejected receipts with no partial canonical mutation.

**Rebuild/recovery:** timelines are reconstructible from valid settled claims, closures, and source-revision provenance. Out-of-order relearning can restore an old-time claim without overriding later narrative events.

**Benchmark coverage:** tests prove supersession/history retention, contradiction without arbitrary winner selection, explicit unresolved slot state, bounded graph neighborhoods, slot closure after object destruction, stale proposal rejection, current projection correctness, and out-of-order incremental relearning.

## Minimal retrieval, Truth Gate, and Context Compiler slice

**Input contract:** query + temporal intent + optional graph anchors over settled claims.

**Output contract:** normalized Candidate Bus results from exact, semantic-interface, and graph-neighborhood channels; Truth Gate classifications; then a structured CompiledContextPacket.

**Canonical authority:** retrieval and compilation are temporary/derived. They cannot mutate source or world state.

**Provenance behavior:** candidate, truth, and packet facts retain claim provenance and exact source revision dependencies.

**Revision/freshness identity:** compiled packets declare the exact source revision dependencies of admitted facts. They are disposable and must be regenerated when those dependencies change.

**Invalidators:** any changed packet dependency, invalidated learned claim, or different query/intent.

**Failure behavior:** missing/invalid claims classify `UNRESOLVED`; stale/historical claims fail current-intent admission rather than being force-injected.

**Rebuild/recovery:** all three stages are deterministic over current graph state and can be rerun from canonical claims.

**Benchmark coverage:** Ember Tavern asserts exact-term, semantic-interface, and graph-neighborhood nomination; current-vs-historical Truth Gate behavior; stale possession exclusion; historical recovery; provenance retention; structured compact packet output; and no duplication of original source prose.

## End-to-end vertical slice (#14)

The executable path is:

`Lore source -> Source Registry -> Lore Study -> entities/claims -> Temporal State Graph -> minimal retrieval -> Truth Gate -> Context Compiler packet -> source edit -> dependency-cone invalidation -> incremental relearning`.

The source edit changes only `lore:sun-blade`: revision 1 remains recoverable, revision 2 becomes active, old revision-derived artifacts invalidate, unrelated Ember Tavern ownership knowledge keeps the same settled claim identity, later narrative destruction remains current, and the re-extracted Eris possession is restored only as historical state because its temporal position predates later events.
