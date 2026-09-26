# Worker 4 — Scene-to-Lore Handoff

Branch: `Development-Scene-Lore-Handoff`  
Base: `Development-Scene-Scanner@64cec1c3bfe8e48e3b4cd2498039d78cdb89f2e5`

## Ownership boundary

This change is the narrow adapter between a settled Scene owner receipt and Lore owner retrieval.

- Worker 2 continues to own Scene detection, Scene state, Scene revisioning, transitions, corrections, lifecycle, and Scene owner receipts.
- Worker 1 continues to own retrieval policy outside the Lore-owner request, Candidate Bus/Truth, Gather, Context Seal, PromptPlan, and final delivery.
- Worker 4 owns only conversion of a settled Scene receipt into a bounded Lore retrieval need and conversion of the Lore owner packet into revision-fenced candidate references.

The adapter never settles Scene, Lore, Truth, Gather, Seal, or prompt inclusion.

## Input owner interface

The adapter consumes existing `DeploymentSceneOwnerReceipt@1` from Worker 2.

No Scene receipt schema change was required.

Generation identity remains orchestration-owned and is supplied alongside the settled Scene receipt:

```js
await brain.runSceneLoreHandoff({
  sceneReceipt,
  generationId
});
```

The adapter binds:

- `chatId`
- `turnId`
- `generationId`
- `sceneId`
- `sceneRevision`
- Scene source-revision fence
- Scene event/evidence refs

## Meaningful retrieval need

`SceneLoreRetrievalNeed@1` is created only when the settled Scene receipt contains a meaningful retrieval reason:

- `CAST_CHANGED`
- `PLACE_CHANGED`
- `TIME_CHANGED`
- `RELATIONSHIP_CHANGED`
- `UNRESOLVED_THREAD_CHANGED`
- `CORRECTION`
- `SCENE_TRANSITION`

Each need contains at most six bounded narrow queries. Query text is derived from Scene-owned structured fields/deltas only; raw narrative is not copied into the adapter receipt.

A `DeploymentSceneOwnerReceipt` with `status:'NO_WORK'` produces `SceneLoreRetrievalResult.status='NO_WORK'` and does not query Lore.

## Lore owner interface

The adapter reuses the existing Lore retrieval interface:

`LoreBrainRetrievalInterface@1.queryScoped({chatId,query,intent,intentId})`

It also uses `sourceRevision(sourceId)` when present to revalidate each returned source revision before exposing a candidate.

No PR #254/#255/#261 code was cherry-picked into the Scene branch.

## Result contract

The adapter returns `SceneLoreRetrievalResult@1`.

Each `SceneLoreCandidateReference@1` contains bounded metadata only:

- Scene need / query refs
- candidate ID
- source ID
- Lorebook ID
- UID
- exact Lore source revision ID
- representation/retrieval record refs
- evidence/provenance refs
- temporal status
- truth-status hint
- bounded temporal hints
- story scope/read Lorebook IDs
- readiness
- Lore index/ontology revision
- Scene ID/revision/source-revision fence

Authority remains negative:

- `retrievalAuthority:false`
- `truthAuthority:false`
- `gatherAuthority:false`
- `contextSealAuthority:false`
- `promptInjectionAuthority:false`
- `rawLoreIncluded:false`

A retrieval match is therefore only evidence for Worker 1 to consider.

## Temporal preservation

The adapter does not rewrite owner temporal semantics.

- `UNRESOLVED` stays `UNRESOLVED`.
- `HISTORICAL` stays `HISTORICAL`.
- `CURRENT` is preserved only when explicitly supplied.
- absent/ambiguous status remains `UNKNOWN`; it is never silently upgraded to CURRENT.

## Fences and late-result handling

The adapter checks freshness both before and after Lore retrieval.

It fails closed for:

- current Scene revision no longer matching the receipt -> `STALE`
- active chat changed -> `LATE / CHAT_SWITCHED`
- generation superseded when a current turn record exists -> `LATE / GENERATION_SUPERSEDED`
- turn sealed before or during retrieval -> `LATE / TURN_ALREADY_SEALED`

Candidates from a late/stale result are discarded.

Lore candidates are also post-query revalidated through the Lore owner source-revision interface. Edited or removed Lore is excluded with:

- `LORE_SOURCE_REVISION_STALE_AFTER_QUERY`
- `LORE_SOURCE_REMOVED_AFTER_QUERY`

## Unavailable/degraded Lore

If the Lore interface is absent, incompatible, throws, or returns the wrong packet contract, the result is `DEGRADED` with zero candidates.

No fallback fabricates Lore or widens authority.

## Demonstrated assembled example

Focused assembled path:

1. selected chat owns a studied Lorebook containing:
   - `North Gallery`
   - `Mara`
2. host Scene event:
   - `At North Gallery, Mara enters.`
3. Worker 2 returns `DeploymentSceneOwnerReceipt@1` with:
   - exact chat/turn
   - current Scene ID/revision
   - exact Scene source revision
   - `location` and `activeCast` changes
4. Worker 4 builds a need containing:
   - `PLACE_CHANGED`
   - `CAST_CHANGED`
5. existing scoped Lore retrieval is queried.
6. result exposes revision-fenced candidate refs for the matching Lore source.
7. no Truth/Gather/Seal/PromptPlan authority is granted.

## Focused verification

Code-head run #2 / `36279138610` at `c6174766391122014bf4cf53af56cb9414a87422`:

- Worker 4 Scene→Lore checks: **7/7 pass**
- preserved Scene owner receipt + Core integration: **13/13 pass**
- preserved scoped Lore retrieval: **14/14 pass**
- browser-facing imports: **PASS**
- changed-surface syntax: **PASS**

The final documentation/PR head must be rechecked separately before final review handoff.

## Remaining integration dependency

Worker 1 still owns whether/when these candidate references enter its retrieval/Truth/Gather/Seal path. This PR deliberately stops before Candidate Bus admission or prompt delivery.

Worker 2 does not need to change Scene owner policy or its receipt shape for this adapter.

## Merge rule

This branch targets `Development-Scene-Scanner`.

No merge into `Development-Scene-Scanner` or `main` is authorized by this handoff.
