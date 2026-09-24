# Area-52 Memory Wave 3 — Exact Evidence Assembly Bridge

**Branch:** `Development-Memory`  
**Primary integration target:** #178 FT003 Memory-owned preparation  
**Related:** #5 Temporal State, #175 Hierarchical Memory, #205 Historian, #9 Reflection, #79 Sleep Cycle.  
**Not claimed:** #178 FT003 itself or #224 Live Brain Demo.

## Owner contract references

Wave 3 was implemented against the live owner branches, read-only:

- Scene: `Development-Scene-Scanner@3aaf1c1e9e7e8703dc8c66c5542efb03cc9873cf`
- Core: `Development-Nexus@ba4619f56db8e4f94873256dc26589e1680b7d29`

Relevant Scene contracts are `SceneExperienceProposal v1.0.0`, `ArtifactReference v1.0.0` and `CognitiveEventEnvelope v1.0.0`. Relevant Core contracts are `MutationProposal`, `SettlementDecision`, `SettlementReceipt` and `KnowledgeEvidence v1.0.0`.

Memory does not copy Scene interpretation policy or Core Settlement policy. It validates identity/freshness consequences only.

## Outcome

Wave 3 closes the Memory-owned assembly seam between external owner identities and Memory exact evidence.

```text
owner artifact ref + external evidence ref
+ exact content + revision/fence proof
        |
        v
MemoryExternalEvidenceMapping v1.0.0
        |
        +--> exact local Memory evidence (OBSERVED only)
        |
        +--> Scene proposal resolution
        |      + confirmed Scene boundary required
        |      + every evidence/source ref mapped
        |      + matching Scene revision required
        |      + mentioned-only evidence rejected
        |
        +--> Core Settlement adapter
               + external Core evidence IDs remapped
               + original proposal/decision/receipt chain preserved
               + existing Wave 1 Settlement validator remains canonical gate
```

Mapping proves identity. It does **not** grant canon, Settlement, Candidate Bus admission, Truth, context injection, Context Seal or Runtime scheduling authority.

## Production additions

### `MemoryExternalEvidenceBridge`

`src/memory-evidence-bridge.js` provides:

- `admitMapping(input)`
- `resolveMapping(input)`
- `mappingHistory(input)`
- `mappingsForOwnerArtifact(ownerArtifactRef)`
- `registerSceneProposal(proposal, options)`
- `acceptSceneEvent(event, options)`
- `resolveSceneProposal(proposalOrId, options)`
- `invalidateMapping(input)`
- `mapCoreSettlementEnvelope(envelope, options)`
- `revisionRef()`
- `status()`
- `snapshot()/restore()`

Public producer/surface adapters expose the production path without private Map access:

- `admitExternalEvidenceMapping(input)`
- `invalidateExternalEvidenceMapping(input)`
- `acceptSceneOwnerEvent(event, options)`
- `acceptSceneExperience(proposal, options)`
- `applyCoreSettlement(envelope, {evidenceArtifactRefs})`
- `drillDown(nomination, {perspectiveConstraint})`
- `profileHierarchyQuery(request, options)`

## Exact mapping contract

A mapping records:

- origin owner;
- owner artifact ID/type/revision;
- external evidence ID;
- exact Memory evidence ID;
- source ID and source revision;
- Scene/world fences;
- exact-content hash;
- observation state;
- provenance refs;
- bounded raw owner input for audit;
- freshness/state and replacement history.

An identical replay is idempotent.

Memory fails closed for:

- conflicting reuse of the same owner identity/revision;
- older owner revision reuse;
- stale source revision;
- missing exact content;
- unsupported authority escalation;
- source proof mismatch;
- owner revision proof mismatch;
- content hash mismatch;
- wrong Scene fence;
- wrong world fence;
- late sealed-generation material;
- configured journal/history bounds.

The bridge never accepts an opaque owner ID as exact evidence solely because it exists.

## Scene resolution

A `SceneExperienceProposal` is retained immediately, but remains Historian-stale until its full exact-evidence dependency set resolves.

Resolution requires:

1. the proposal and its SceneEpisode reference agree on Scene revision;
2. a live `SCENE_BOUNDARY_CONFIRMED` exists for that Scene/revision;
3. every proposal evidence ref resolves through an exact mapping owned by the referenced SceneEpisode;
4. every proposal source revision is represented by a fresh mapped source revision;
5. mapped Scene/world fences match;
6. no required observation is `MENTIONED_ONLY`;
7. if a `SCENE_EPISODE_READY` event exists, its episode ref agrees with the proposal episode ref.

`SCENE_BOUNDARY_CANDIDATE` is retained as nonconfirming information only. Memory does not decide whether a boundary exists.

Once resolved, the same production path publishes a fresh Memory episode and may register the exact-evidence-backed `SCENE:<sceneId>` summary scope. An identical refresh is idempotent.

Source correction/removal stales the mapping, dependent episode, summary cone and Historian material while preserving unrelated identities and all old audit/history revisions. Replaying an old owner event cannot reactivate a stale source revision.

## Core Settlement adapter

`applyCoreSettlement()` first reconciles every external Core evidence ID to an explicit owner artifact descriptor and fresh Memory mapping.

It requires:

- WORLD_STATE proposal and decision owners;
- matching proposal IDs;
- matching proposal/decision evidence sets;
- matching proposal/decision source revision sets;
- every external evidence ID to have an explicit descriptor;
- every mapped source revision to appear in the Core proposal source/freshness revisions.

The adapter then rewrites **only evidence identity** to the local exact Memory evidence IDs and passes the original owner proposal/decision/receipt semantics to Wave 1 `TemporalStateGraph.applySettlement()`.

Therefore:

- mapped evidence alone cannot Settle;
- missing/mismatched decision or receipt cannot mutate canon;
- replay remains idempotent;
- CURRENT/HISTORICAL/as-of behavior remains Wave 1 behavior;
- unresolved competing hypotheses remain unresolved.

Typed rejection receipts expose the mismatch reason.

## Perspective-safe drillback

Character knowledge fences now apply to exact drillback as well as episode/summary retrieval. A nomination carrying `CHARACTER_KNOWLEDGE` cannot be used to drill into exact evidence whose `knownBy` set excludes that character. Callers may also provide an explicit perspective fence when drilling from a world nomination.

## Hierarchy query optimization

Wave 2's broad path repeatedly performed:

- current-summary freshness traversal;
- deep cloning of all current summaries;
- tokenization of every summary;
- tier filtering and ranking.

Wave 3 adds a revision-safe bounded query index:

- token -> fresh summary artifact IDs;
- entity -> fresh summary artifact IDs;
- level -> fresh summary artifact IDs;
- pre-tokenized artifact terms.

It also adds a bounded nomination-view cache. Cache entries record the exact summary scope refs they depend on. Scope/source invalidation evicts only affected cached views; unrelated cached views survive. The index itself is rebuilt from fresh current artifacts when dirty.

Both query index and bounded cache snapshot/reload. A stale indexed artifact fails `artifactIsFresh()` before nomination.

The previous Wave 2 selector remains internal only as a profiling baseline.

### Profiling method

Wave 3 stress uses the same 3,000-event / 1,000-episode / 111-scope hierarchy corpus for:

- direct exact Historian;
- legacy Wave 2 hierarchy selection;
- indexed hierarchy with result cache disabled;
- warm indexed hierarchy cache.

The profile performs 5 warmup iterations and 40 measured iterations, reporting p50/p95 and artifacts examined. It separately reports hierarchy build cost, correction/update cost, query-index bytes, cache bytes and retained summary bytes.

A speedup is claimed only for legacy-hierarchy -> optimized-hierarchy when repeated measurements support it. Exact Historian remains the latency baseline and may still be faster.

## Durability and bounds

| Resource | Bound |
|---|---:|
| external mappings | 8,192 |
| mapping revisions / owner identity | 32 |
| retained Scene proposals | 2,048 |
| retained Scene owner events | 4,096 |
| raw owner input / mapping or event | 32,768 chars |
| hierarchy query cache entries | 128 |
| hierarchy query indexed terms | 32,768 |
| profiling samples / run | 256 |
| Memory diagnostics | 128 |

Wave 1/2 evidence, mapping history, query indexes, cache views and pending summary work all survive Memory snapshot/reload.

The native path uses browser-safe JavaScript only and requires no external database, SQL, Redis, Dapr, vector server, remote model, mandatory plugin or background service.

## Memory ownership boundary

Memory owns exact evidence, mapping records, temporal history, episodes, Reflections, summary artifacts and Historian nominations.

Memory does not own:

- Scene interpretation/boundary decisions;
- Runtime scheduling/yield;
- Candidate Bus admission;
- Truth/Precision;
- owner Settlement policy;
- Gather/Context Seal;
- PromptPlan.

## Assembly calls

Minimal FT003 assembly preparation:

1. On owner evidence availability, call `admitExternalEvidenceMapping()`.
2. Route relevant Scene `CognitiveEventEnvelope` records to `acceptSceneOwnerEvent()`.
3. Route `SceneExperienceProposal` to `acceptSceneExperience()`.
4. Route Core owner Settlement envelope plus explicit evidence artifact descriptors to `applyCoreSettlement()`.
5. Query Memory via existing Historian adapters; drill to exact source when required.
6. Core then owns Candidate Bus -> Truth/Precision -> Gather/Seal -> PromptPlan.

This branch proves only the Memory side of steps 1–5.
