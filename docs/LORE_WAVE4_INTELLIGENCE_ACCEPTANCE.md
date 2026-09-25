# Lore Wave 4 — Intelligence Subsystem Acceptance

## Scope

Owner branch: `Development-Lorebook-Editor`

Wave 4 completes the backend path that begins **after Worker 3 discovers and accepts the actual SillyTavern lorebook snapshot**. It does not replace Worker 3's UI or discovery code and it does not replace Worker 1's Brain.

Primary implementation:

- `src/lore-intelligence-service.js`
- `src/lore-study-runtime.js`
- `src/lore-source-registry.js`
- existing Wave 1–3 study, representation, hierarchy, summary and retrieval modules

## Architectural invariant

Exact authored Lore remains independently recoverable. Derived claims, relationships, concepts, summaries, navigation artifacts and retrieval representations are revision-keyed derived cognition. They never silently become source canon.

The Lore Tree remains source metadata and navigation context. Semantic compilation augments it; it does not replace the tree.

## Worker 3 source/action contract

Worker 3 owns current-lorebook discovery and the SillyTavern-facing UI. The backend accepts the discovered snapshot through:

```js
service.acceptLorebook({
  id,                 // required actual discovered lorebook id
  title,
  discovery,          // opaque discovery/origin receipt preserved for evidence
  metadata,
  entries: [{
    uid,               // required actual SillyTavern UID
    content,           // exact authored text
    metadata: {
      title,
      treePath,
      tags,
      scope,
      order,
      ...otherDiscoveryMetadata,
    },
  }],
  fullSnapshot: true,
});
```

Acceptance requires a Worker 3 discovery/origin receipt. No fallback lorebook id or generated UID is created at this handoff boundary; the legacy `operator-lore` fallback is explicitly rejected by this backend.

`operatorInterface()` exports the host shape Worker 3's Wave 13 adapter already understands:

- reads: `surface()`, `status()`, `loreStudy()`
- actions: `acceptLorebook()`, `submitLorebook()`, `ingestLorebook()`, `runLoreStudy()`, `startLoreStudy()`, `retryLoreStudy()`

Per-entry operator states are truthful:

- `ACCEPTED` — exact source revision exists and work is due
- `STUDYING` — active/checkpointed work or learned source awaiting required compiled/retrieval products
- `READY` — current learned revision, Lean/Balanced/Heavy representations and current retrieval record all exist
- `FAILED` — study execution/validation or representation compilation failed
- `REMOVED` — current source revision is an explicit removal tombstone

## Source and revision contract

Stable source id:

`lore:<lorebookId>:<uid>`

Revision id:

`<sourceId>@r<N>`

Each accepted revision preserves:

- exact authored content
- exact content hash
- normalized Lore Tree metadata
- passthrough discovery metadata
- replacement chain
- authored source provenance

A full snapshot omission creates a removal revision instead of silently deleting history. Historical exact content remains available through source revision history.

## Study lifecycle

Triggers include:

- new UID
- changed UID
- restored UID
- removed UID
- explicit dependency invalidation

Study obligations are revision keyed and superseded when a newer revision wins.

Execution is checkpointable. A thrown study-unit failure:

1. rolls the in-progress session back to the pre-unit checkpoint;
2. marks the obligation `FAILED`;
3. publishes no partial learned revision;
4. records failure code, message, unit and attempt;
5. can be explicitly retried;
6. resumes from the retained checkpoint.

Service snapshots persist source registry, derived store, obligations, sessions, representation registry, hierarchy/retrieval state and compile failures. `LoreIntelligenceService.fromSnapshot()` reconstructs resumable work.

## Semantic diff and invalidation

Every successfully learned source revision publishes a `LoreSemanticDiff` containing:

- semantic ids added
- semantic ids removed
- semantic ids preserved
- claim-slot changes
- temporal meaning changes
- authority/unresolved meaning changes
- artifact-type counts

Only products depending on the changed source revision are made stale. Unrelated source representations remain current.

Removal publishes a learned removal revision with zero active artifacts for that source.

## Multi-resolution representation contract

Each current learned source is compiled into revision-keyed:

- Lean
- Balanced
- Heavy

representations through the existing grounded contribution compiler.

Representations:

- retain source revision provenance;
- expose quality/retention receipts;
- preserve unresolved/conflicting contributions;
- never gain `SOURCE_CANON` authority;
- become stale on source revision change/removal.

## Worker 1 Brain retrieval contract

`brainInterface()` exposes:

- `query(request)`
- `status()`
- `sourceRevision(sourceId)`

`queryForBrain()` returns `LoreBrainRetrievalPacket`:

```text
query
intent / retrievalIntentId
indexRevision
desiredProfile
sourceRevisionFence[]
nominations[]
  nomination
  drillback[]
    sourceId
    sourceRevisionId
    exactAuthoredText
    representationRef
    selectedRepresentation
    availableRepresentations[]
conflicts[]
```

Broad intent defaults to Lean representation selection; narrow/detail intent defaults to Heavy.

Every packet is revision fenced and supports exact-source drillback. The subsystem does **not** claim candidate-bus admission, Truth Gate, settlement or Context Seal authority.

## Ambiguity and conflict

Uncertain/report/rumor language remains `UNRESOLVED` / uncertain in derived artifacts.

Summaries and representations retain unresolved contribution references. They do not rewrite those claims into source canon.

Cross-source conflict sets remain observable to the Brain/operator surface until an owning authority resolves them.

## Acceptance scenarios

`tests/lore-wave4.mjs` covers:

1. two unrelated SillyTavern-discovered lorebooks;
2. exact source and passthrough metadata preservation;
3. full study + Lean/Balanced/Heavy compilation;
4. broad and narrow Brain retrieval;
5. unresolved/ambiguous claim preservation;
6. source edit with semantic diff;
7. source-scoped representation invalidation while unrelated lore stays ready;
8. removed UID through full-snapshot reconciliation;
9. failed study execution with no partial publication;
10. explicit retry and successful relearn;
11. checkpoint persistence across service snapshot reconstruction;
12. rejection of invented/default lorebook ids and UIDs at the Worker 3 boundary.

## Card evidence

### #188 — Native Lore Intelligence and Authoring Cognition

Implemented native source-registry, semantic compilation, provenance, hierarchy/navigation summaries, multi-resolution representations, revision/invalidation lifecycle and Brain/operator handoffs. The subsystem remains derived-cognition only and preserves exact source.

### #4 — Lore Study Engine

Study passes remain checkpointed and revision keyed. Wave 4 adds the missing production orchestration, retry-safe failure handling, persistence reconstruction, representation publication and retrieval readiness gate.

### #30 — Study Eligibility and Backlog

New/changed/restored/removed revisions create obligations. Older due/checkpointed obligations are superseded. Failed work is visible and explicitly retryable. Full snapshots detect removed UIDs.

### #120 — Semantic Lore Compiler and Diff

Source edits generate semantic diffs and stale only products tied to the changed revision. Lore Tree metadata remains intact and exact source remains recoverable.

### #170 — Summarize and Condense

Lean/Balanced/Heavy outputs are grounded derived representations with retention receipts and source-revision drillback. They coexist with exact source.

### #190 — Multi-Resolution Representations

The representation compiler is now part of the ordinary accepted-source -> studied -> retrieval-ready orchestration path, not a detached utility.

## Not certified by this branch

This branch does not prove installed SillyTavern discovery/UI wiring on `main`; Worker 3 owns that integration surface. At the time of this handoff, current `main` still exposes a manual Lorebook ID + pasted text/JSON form and its parser can fall back to `operator-lore` / `entry-1`. That path does not satisfy this Wave 4 ordinary-source contract and will be rejected until Worker 3 supplies the actual discovered lorebook identity, UIDs, exact contents and discovery receipt. Current `main` also does not yet render the new per-entry `FAILED` / `operatorState` contract.

It does not prove external-provider semantic extraction quality. The current provider-neutral/deterministic compiler validates lifecycle and contracts, not measured external-model quality.

It does not grant the Lore subsystem final truth settlement or Context Seal authority.
