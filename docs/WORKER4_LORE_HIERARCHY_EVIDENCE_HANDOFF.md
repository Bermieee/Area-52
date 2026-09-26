# Worker 4 — Lore hierarchy evidence and scale closure handoff

Stacked branch: `Development-Lore-Hierarchy-Evidence`  
Stacked base: `Development-Lore-Completion@1d3f8b8a399fe3320e54894a054d44ab73906e23` / PR #254  
Review PR: #255  
Main is not a target of this wave and has not been modified.

## Purpose

PR #254 measured a 105-entry compact Lore service snapshot at 17,595,257 JSON characters. Hierarchy state was 11,041,717 characters and the navigation summary registry 10,803,154. The dominant cause was structural duplication: full `criticalEvidence` payloads were copied into leaf summaries and then repeatedly copied into every dependent ancestor.

This wave replaces that payload propagation with reference-backed hierarchical evidence while preserving source/history, deterministic summary identities, temporal semantics, exact drillback, selective invalidation, and reload compatibility.

## Reference-backed evidence contract

`LoreNavigationEvidenceRegistry` stores each exact navigation evidence record once under a stable ref derived from `evidenceId + sourceRevisionId`.

Summary nodes retain:

- `criticalEvidenceRefs[]`
- `criticalEvidenceCount`
- existing `sourceRevisionSet`
- existing child-summary dependencies
- existing summary content, quality receipt and provenance
- existing deterministic summary ID / dependency fingerprint
- existing current, historical, stale and replacement state

Summary nodes no longer retain an embedded `criticalEvidence` payload.

Evidence records remain authority-negative derived artifacts. They do not gain source, Truth, Settlement, Context Seal, PromptPlan, or host-delivery authority.

## Resolution and drillback

`LoreNavigationSummaryRegistry.resolveEvidenceRefs()` resolves complete reference sets for internal build/retrieval work.

`LoreHierarchyRetrievalSystem.drillEvidence(summaryOrId,{offset,limit})` provides bounded on-demand hydration for inspection. It reports:

- exact resolved evidence records
- missing evidence refs
- COMPLETE / DEGRADED / NOT_FOUND state
- summary ID/revision/scope/source-revision fence
- no authority promotion

Contextual retrieval resolves summary refs before creating summary retrieval records. A summary with missing referenced evidence is skipped with `SUMMARY_SKIPPED_MISSING_EVIDENCE`; no missing evidence is fabricated or promoted to CURRENT.

A final review fix also closes the rebuild path: `findReusable()` now requires COMPLETE evidence resolution. If a current saved evidence record is missing, the hierarchy rebuild reconstructs it from retained exact source/study state before reusing the same deterministic summary identity.

## Legacy snapshot migration

`LoreNavigationSummaryRegistry.restore()` accepts legacy snapshots containing inline `criticalEvidence`.

Migration:

1. registers each legacy evidence object once;
2. computes its stable reference from evidence identity;
3. writes `criticalEvidenceRefs` / count into the in-memory summary;
4. removes the embedded payload;
5. preserves summary IDs, revision numbers, history/current maps, reuse keys, stale reasons, replacement links and current/historical states.

New snapshots use registry contract version 2 and persist one evidence registry plus reference-backed summary nodes.

Historical evidence remains persisted and drillable. Evidence garbage collection is intentionally outside this wave because retained historical summaries require their evidence.

## Targeted invalidation

Source revision and hierarchy dependency rules remain unchanged.

The deterministic edit case verifies that one source edit:

- creates one source study obligation;
- leaves unrelated learned revisions unchanged;
- stales only scopes dependent on that source revision;
- preserves unrelated current summary IDs;
- rebuilds the affected cone;
- keeps replaced summaries HISTORICAL and evidence-drillable;
- survives compact snapshot/reload with zero study obligations due.

No authored Lore text or human Tree placement is silently changed by the hierarchy optimization.

## Semantic qualification

Focused hierarchy evidence tests cover:

- entry/leaf summaries;
- topic/tree summaries;
- cross-Tree community summaries;
- Lorebook/root summaries;
- corpus summaries;
- exact evidence drillback;
- broad summary retrieval nominations;
- historical temporal evidence;
- ambiguous/unresolved evidence;
- provenance/source revision retention through legacy migration/retrieval rebuild;
- missing-ref degradation;
- missing current-evidence reconstruction before reuse;
- source-edit invalidation and historical drillback after reload;
- stable summary identities;
- bounded Lore summary read surfaces without raw evidence.

## 105-entry measurement

Latest exact-head code run on GitHub Actions after the reuse repair:

- initial accept: 22.42 ms
- initial study + index: 2,807.85 ms
- one-entry accept: 317.14 ms
- one-entry restudy + index: 991.35 ms
- reload: 366.14 ms
- unrelated learned revisions retained after edit: 104
- restudied entries after edit: 1
- due study after reload: 0

Snapshot characters:

- total: 11,413,906
- runtime: 2,501,588
- multi-resolution: 989,978
- hierarchy: 4,859,631
- ontology: 298,771
- story authority: 137,376
- summary registry: 4,621,068
- summary nodes: 4,375,733
- shared evidence registry: 202,814
- builder: 18,108
- compact retrieval index: 146

Compared with PR #254's 17,595,257 total observation, this run is 6,181,351 characters smaller (~35.13%). Hierarchy state is ~55.99% smaller and summary-registry state ~57.22% smaller versus the #254 measurements.

The same reference-backed state converted back into a legacy inline-evidence equivalent would be 18,824,352 characters, demonstrating that the reduction is from removing repeated evidence payloads rather than silently deleting evidence.

Heap observation in this shared Node test process: 14,694,864 -> 131,768,056 bytes (delta 117,073,192). This is **not a retained-heap or browser-memory claim**: GC was not forced and the test runner shares process history.

## Larger synthetic measurement

240 entries:

- initial accept: 36.35 ms
- initial study + index: 6,082.76 ms
- reload: 288.03 ms
- evidence records: 480
- summary nodes: 308
- snapshot total: 19,726,486 characters
- hierarchy: 4,964,183
- summary registry: 4,428,622
- evidence registry: 461,181
- legacy inline-evidence equivalent: 24,282,250 characters
- observed heap delta in shared runner: 66,701,664 bytes

The 240-entry reference-backed snapshot is ~18.76% smaller than its same-state legacy inline equivalent.

## Performance tradeoff

Reference backing removes repeated persisted payload but introduces evidence-ref resolution during parent summary building and retrieval-index reconstruction.

PR #254's earlier observations were approximately:

- study/index 2.28 s
- one-entry restudy/index 0.65 s
- reload 0.30 s

This wave's GitHub runs vary materially by runner load. Latest observed 105-entry values were ~2.81 s / 0.99 s / 0.37 s; an earlier #255 run measured ~4.54 s / 1.15 s / 0.39 s. These are observations, not thresholds or controlled benchmark regressions. The storage gain is established; a live-browser spike fix is **not** established.

## Owner boundaries

Worker 4 owns this hierarchy evidence registry, migration, resolution, retrieval provenance, Lore summary read metadata and tests.

Worker 3 / PR #253 owns UI/Diagnostics rendering. The bounded `LoreMultiLevelSummarySurface` now exposes evidence refs/count/truncation and `rawEvidenceIncluded:false`; UI should consume refs rather than ask Lore to embed raw evidence in diagnostic surfaces.

Worker 1 owns Truth/Gather/Seal/PromptPlan/provider delivery and Trello #264. This wave does not modify those surfaces.

Worker 2 owns Scene / FT002.

## Card reconciliation

### #48 multi-resolution Lore understanding

Reference-backed entry/topic/community/book/corpus summary evidence closes the known ancestor-payload duplication while preserving broad/detail retrieval, temporal/ambiguity evidence and exact drillback. Large-book snapshot/reload behavior is now directly measured.

Keep #48 In Progress: controlled retrieval-quality benchmarks and installed-host/live behavior remain outside this wave.

### #120 Semantic Lore Compiler

The hierarchy now keeps exact source-revision evidence identity and selective invalidation across an edit without broad source restudy. Legacy/current summary states remain reconstructable and source canon/human Tree remain untouched.

Keep #120 In Progress: the full original semantic-diff/impact-planner acceptance remains broader than this hierarchy-storage wave.

### #188 / #179 FT004

Keep both open/In Progress. This change does not prove installed SillyTavern provider delivery or fix the live browser spike. FT004 still requires observed real host/provider evidence through Lore -> Truth -> Gather -> Seal -> PromptPlan -> request, including edit/removal/reload scenarios.

## CI status

The code head after the final review fix is `5df0cc5a01134798079522df758fd8cbad83dfdd`.

At that head, the Lore job reports 100 pass / 1 fail. The only Lore-job failure is the same pre-existing Wave-7 / Worker-3 assembly assertion already present on PR #254:
`assembled host exposes Wave 7 owner lifecycle while Worker 3 UI remains explicitly preview-only`.

The added rebuild rehydration regression passes. Final docs-only exact-head CI must still be read before review handoff is considered complete.
