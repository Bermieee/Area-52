# Lore Hierarchy Reference-Backed Evidence Design

## Context

PR #254 measured a 105-entry service snapshot at roughly 17.60M JSON characters after safely omitting reconstructable retrieval-cache records and completed navigation sessions. About 11.04M characters remained in hierarchy state; the navigation summary registry accounted for roughly 10.80M. Current and historical navigation summaries repeatedly embed full `criticalEvidence` payloads in every dependent ancestor.

This design keeps PR #254 intact and stacks on its exact head. It does not alter Brain/Core delivery, Scene, UI rendering, authoring mutation, or installed-host behavior.

## Goal

Replace ancestor-level embedded critical-evidence payloads with stable reference-backed evidence while preserving summary identity, current/historical state, temporal/ambiguity semantics, source provenance, exact drillback, dependency-scoped invalidation, reload compatibility, and source/human-tree authority boundaries.

## Architecture

Introduce a shared `LoreNavigationEvidenceRegistry` owned by the hierarchy subsystem. A canonical evidence record is stored once per stable `sourceRevisionId + evidenceId` identity. Navigation summaries store only bounded `criticalEvidenceRefs` plus counts/authority-negative metadata. Parent summary construction resolves child references through the registry when it needs critical evidence text and provenance.

Summary IDs remain based on the existing scope/structure/source/child/generator dependency fingerprint. Moving evidence payload out of summary nodes therefore does not change IDs for equivalent inputs.

## Evidence contract

Each registry record contains the existing exact evidence payload once:

- stable `evidenceRef`;
- original `evidenceId`;
- `sourceId` and exact `sourceRevisionId`;
- evidence kind;
- text;
- critical flag;
- temporal class and unresolved state;
- artifact/claim/relationship/entity references;
- provenance.

Each summary stores bounded reference metadata:

- `criticalEvidenceRefs: string[]`;
- `criticalEvidenceCount`;
- no embedded `criticalEvidence` payload;
- existing source revision set, child summary dependencies, quality receipt, provenance, content, state and authority-negative fields.

Reference count remains bounded by the existing source-reference ceiling and deduplicated by evidence identity.

## Drillback

`LoreNavigationSummaryRegistry.resolveEvidenceRefs(refs)` resolves references to exact evidence records and reports missing refs without fabrication.

`LoreHierarchyRetrievalSystem.drillEvidence(summaryOrId, options)` exposes bounded on-demand evidence hydration:

- resolved exact evidence records;
- missing evidence refs;
- `COMPLETE` or `DEGRADED` status;
- no authority promotion.

Retrieval index construction resolves summary evidence through the registry to derive claim/entity/relationship/temporal metadata. Missing evidence never becomes CURRENT or inferred evidence; the summary retrieval record is skipped/degraded with diagnostics when required reference resolution is incomplete.

## Legacy snapshot migration

`LoreNavigationSummaryRegistry.restore()` accepts both forms:

1. new snapshots with `evidenceRegistry` and `criticalEvidenceRefs`;
2. legacy snapshots whose summaries embed `criticalEvidence`.

For legacy rows, restore registers each embedded evidence object once, derives stable refs, stores the reference-backed summary internally, and removes embedded payload from the in-memory summary node. Existing summary IDs, revision numbers, history/current maps, reuse keys, stale reasons and current/historical states are retained.

New snapshots write one shared evidence registry plus reference-backed summary nodes.

## Invalidation and history

A source edit still changes the exact source revision and only stales scopes whose source revision sets or dependent child summaries change. Old evidence records remain available for historical summaries. Unrelated current summaries retain IDs and do not trigger source restudy.

Evidence registry garbage collection is intentionally out of scope: historical summaries are required to remain drillable, so records referenced by any retained historical/current summary remain persisted.

## Authority boundaries

- Authored Lore and human Tree remain unchanged.
- Evidence registry and navigation summaries are derived artifacts.
- Summary/evidence references do not grant source canon, Truth, Settlement, Gather, Context Seal, PromptPlan, or host-delivery authority.
- Temporal labels are preserved evidence semantics, not independent truth promotion.
- No external database, SQL service, orchestration system or remote provider is required.

## Tests and measurement

The wave will add deterministic tests for:

- stable summary IDs pre/post reference backing;
- no embedded evidence payload in current or historical summary nodes;
- exact evidence drillback at entry/topic/community/book/corpus levels;
- retrieval nomination semantics and temporal/unresolved metadata;
- one-source edit invalidating only the dependent cone;
- unrelated learned revisions and summaries retained;
- snapshot/reload preserving current/historical summaries and drillback;
- legacy embedded-evidence snapshot migration;
- missing evidence refs degrading/blocking rather than fabricating;
- 105-entry before/after component snapshot measurements, study/edit/reload timings and heap observations;
- a larger synthetic workload with retained counts and bounded behavior.

Measurements are observations, not performance thresholds, and do not establish a fix for live-browser spikes without installed-host evidence.

## Downstream coordination

Worker 3 consumes bounded Lore lifecycle/provenance metadata; this wave may add evidence-reference fields to that contract but does not redesign UI. Worker 1 owns Truth/Gather/Seal/PromptPlan/provider delivery and #264. Worker 2 owns Scene. FT004 remains open until real installed SillyTavern provider-boundary evidence exists.
