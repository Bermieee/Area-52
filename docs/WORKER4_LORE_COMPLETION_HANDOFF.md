# Worker 4 — Lore subsystem end-to-end completion handoff

Branch: `Development-Lore-Completion`  
Base at wave start: `main@ea66ddce461803d5279b4497f6604e3d75d6def6`  
Review PR: #254

## Scope and authority

This wave owns Lore source admission, study, multi-resolution representations, contextual retrieval, exact-chat read authority, Lore candidate/evidence production, bounded Lore provenance receipts, and the Lore operator read contract.

It does **not** take ownership of Native Brain/Core delivery, provider-role policy, Scene, Truth/Precision authority, Gather authority, Context Seal authority, PromptPlan allocation, installed-host delivery, or UI/Diagnostics rendering. Worker 1 owns Brain/Core delivery and provider-role work; Worker 2 owns Scene/FT002; Worker 3 owns UI/Diagnostics and consumes the bounded Lore read contract.

Jev/provider advice remains optional. Lore requires no external SQL/database, orchestration service, or remote model provider for the native deterministic path.

## Lifecycle contract

The subsystem keeps these states distinct:

1. **Discovered** — the host reports a Lorebook for an exact chat. Discovery does not grant study or read authority.
2. **Accepted for study** — the operator explicitly accepts the discovered Lorebook.
3. **Studied current** — a learned revision exactly matches the current authored source revision.
4. **Representation-ready** — required Lean/Balanced/Heavy representations pass quality checks.
5. **Retrieval-ready** — the current source revision has an active contextual retrieval record.
6. **Selected-chat authorized** — the exact chat accepted the Lorebook and includes it in its read scope.
7. **Eligible for nomination** — current + retrieval-ready + exact-chat authorized.
8. **Lore producer nominated** — the most recent scoped Lore query selected the source into a candidate receipt.
9. **Truth/Precision / Gather / Seal / PromptPlan / host delivery** — downstream states. Lore exposes these as `DOWNSTREAM_NOT_OBSERVED_BY_LORE`; it does not infer them from producer readiness.

An unbound/imported chat fails closed with `LORE_STORY_SCOPE_REQUIRED`. A globally learned Lorebook does not inherit another story's authority.

## Temporal semantics repair

Before this wave, contextual retrieval computed source-level temporal/truth hints, but `LoreOwnerRetrievalChannel` replaced every drilled Lore item with `CURRENT`. That erased `HISTORICAL` and `UNRESOLVED` hints at the Lore → Truth boundary.

The completion contract now carries:

- `truthStatusHint`
- bounded `temporalHints`
- exact `sourceId / lorebookId / uid / sourceRevisionId`
- `sourceRevisionRefs`
- bounded evidence/provenance references
- exact-chat authority scope and producer decision

through contextual drilldown, Lore candidate receipts, owner evidence, and OWNER_LORE nominations. These are hints/evidence metadata only; downstream Truth remains authoritative.

## Bounded operator read model

`LoreIntelligenceService.operatorReadModel({chatId,maxEntries,maxReceipts})` and `operatorInterface().read.loreReadModel(...)` expose `LoreOperatorReadModel@1`.

Bounds:

- default entries: 64; hard cap: 128
- default recent receipts: 32; hard cap: 64
- no authored Lore body in the read model
- tree path is bounded to 24 elements per entry
- temporal hints are bounded to 16 per entry

Each entry exposes identifiers, title/tree metadata, revision/hash identity, source state, lifecycle booleans/states, producer nomination decision/reason, study state, compile failure metadata, and operator state. It explicitly reports downstream Truth/Gather/Seal/PromptPlan/host delivery as unobserved instead of promoting readiness into delivery.

Worker 3 should consume this contract rather than reconstructing lifecycle state from raw status internals. Worker 3 remains responsible for presentation, selected-turn normalization, and UI truncation/display.

## Revision and dependency behavior

A changed authored UID creates a new source revision and invalidates only that source's learned/representation/retrieval dependents. Unchanged entries retain their learned revisions and remain current/retrieval-ready. A removed UID becomes `REMOVED` and cannot remain retrieval-ready or eligible.

Identical full snapshots produce no new study obligation and skip ontology/hierarchy/retrieval maintenance. A no-due study pass also skips that maintenance.

The 105-entry stress fixture additionally performs one-entry replacement, verifies 104 unrelated entries remain current while the edited entry is stale, restudies exactly one obligation, snapshots/reloads, and verifies zero study is due after reload. Timing and retained-count metrics are logged by `WORKER4_LORE_105_METRIC`; timing is recorded evidence, not a hard performance threshold.

## Deterministic Area-52 end-to-end evidence

The Worker 4 fixture path covers:

- real-shaped SillyTavern discovery receipt
- explicit acceptance
- exact source registry/revision identity
- native study and multi-resolution representation family
- retrieval index readiness
- exact-chat read scope
- Lore candidate nomination + bounded producer receipt
- OWNER_LORE evidence/nomination
- Native Brain Truth assessment
- Gather admission
- Context Seal source-revision fence
- explicit `RELEVANT_LORE` PromptPlan decision
- internal prompt-delivery receipt

This proves the internal deterministic Area-52 contract only. It is **not** evidence that an installed SillyTavern host actually sent the Lore text to a provider.

## Deterministic exclusion/degradation cases

Covered cases include:

- discovered but not accepted
- learned globally but unaccepted for the selected chat
- unbound/imported chat
- edited source revision stale until restudied
- removed source revision
- contradictory/ambiguous source retaining `UNRESOLVED`
- historical source retaining `HISTORICAL`
- owner interface unavailable (`NOT_ATTACHED`)
- owner query degraded/error (`DEGRADED`)
- identical snapshot/no-due maintenance skip
- 105-entry incremental edit and reload retention

## Owner-boundary map

| Boundary | Worker 4 provides | Downstream owner |
| --- | --- | --- |
| ST discovery → acceptance | exact-chat discovery + explicit acceptance receipts | Worker 3 may present controls |
| source → study | revision-exact source, study obligation, multi-resolution compilation | Lore |
| study → retrieval | current learned revision, representation readiness, retrieval index | Lore |
| retrieval → candidate bus | scoped packet, source fence, truth/temporal hints, bounded provenance | Lore |
| candidate → Truth/Precision | OWNER_LORE evidence + nomination, no authority promotion | Worker 1/Core |
| Truth → Gather | producer refs remain available; Lore does not decide admission | Worker 1/Core |
| Gather → Context Seal | Lore source revision IDs must remain traceable | Worker 1/Core |
| Seal → PromptPlan | explicit RELEVANT_LORE inclusion/defer/drop decision | Worker 1/Core |
| PromptPlan → installed host/provider | observed host-delivery evidence required | Worker 1 |
| operator UI | metadata-only bounded Lore read model | Worker 3 |

Known downstream overlap: Native Brain's normalized Gather UI projection historically reduced result rows to result ID / accepted / freshness / destination. Worker 3 should preserve or link the producer/source provenance needed for drilldown rather than making Lore mutate UI-owned projection code.

## Card reconciliation

### #188 Native Lore Intelligence epic

This wave strengthens the operational Lore path: exact source preservation, deterministic native study/retrieval, exact revision invalidation, authority separation, bounded provenance, temporal hint preservation, incremental/reload qualification, and downstream handoff. The epic should remain open until installed-host qualification and remaining product surfaces/Phase 2 criteria are complete.

### #179 / FT004

Deterministic fixture coverage now reaches PromptPlan with explicit source fences and PromptPlan Lore decisions. FT004 must remain **not live-passed** until the installed SillyTavern scenarios below produce observed host evidence.

### #120 Semantic Lore Compiler

Existing compiler behavior retains exact source/tree metadata and produces revision-backed semantic/retrieval artifacts with semantic diffs and selective invalidation. This wave exercises those contracts and one-entry dependency retention. It does not declare every #120 ontology/impact-planner criterion complete.

### #48 multi-resolution study/retrieval

Existing Lean/Balanced/Heavy representations, hierarchy summaries, community/navigation metadata, narrow/broad retrieval and exact drillback remain in use. This wave verifies they remain revision fenced and reloadable. Benchmark/advanced retrieval acceptance beyond the native deterministic path remains a separate criterion.

### #30 / #47 / #56

The wave exercises lifecycle obligations, revision provenance, removal/change invalidation and contextual retrieval. Broader backlog/UI/W3C-style provenance or retrieval benchmark criteria not directly demonstrated here remain open.

### #169 / #170 and Phase 2 authoring

Reviewed for compatibility. No wholesale old-branch merge was taken. Authoring reconciliation/summarization extras are intentionally not expanded in this completion wave; raw authored canon and human tree remain source-owned and unchanged unless an explicit authoring/Settlement flow later approves a write.

## Installed SillyTavern evidence still required

FT004 and the whole Lore subsystem must not be called live-passed until an installed host captures all of the following:

1. Select a real World Info/Lorebook in SillyTavern, record exact chat/lorebook/UID identity, discover it without auto-authority, explicitly accept it, study it, and generate a turn that targets a known entry.
2. Correlate one exact UID/source revision through Lore producer candidate ID, Truth/Precision classification, Gather admission, Context Seal source revision, PromptPlan `RELEVANT_LORE` decision, and **observed host/provider prompt evidence**.
3. Repeat with an edit to that real UID. Before restudy, the old revision must be excluded; after study, only the changed dependent cone should refresh and unrelated UIDs should retain their learned/retrieval identities.
4. Remove a real UID and verify it cannot reappear as CURRENT/retrieval-ready/nominated/admitted/sealed/delivered while historical revision inspection remains possible.
5. Open/import a different chat using the same global Lore store and verify authority does not inherit until that exact chat explicitly accepts/selects it.
6. Exercise real ambiguous/contradictory Lore and verify `UNRESOLVED` is preserved into Truth rather than promoted to CURRENT.
7. Reload SillyTavern with a large accepted book (105-entry fixture scale or larger), record study/reload/generation durations and retained identities, and verify ordinary turns do not trigger full-book restudy/reindex.
8. Verify Worker 3's installed UI consumer can display bounded lifecycle/provenance metadata without leaking raw authored Lore into diagnostics.
9. Run with Jev/provider advice disabled and no external DB/orchestration; native Lore study/retrieval must remain functional.

The decisive delivery evidence is the installed host/provider boundary, not a fixture PromptPlan, Gather count, or Context Seal alone.
