# Lore Hierarchy Reference-Backed Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deduplicate hierarchical Lore evidence by storing exact evidence once and carrying stable references through summary nodes while preserving semantics, history, drillback and selective invalidation.

**Architecture:** Add a hierarchy-owned evidence registry, migrate navigation summaries from embedded `criticalEvidence` arrays to `criticalEvidenceRefs`, resolve refs during build/retrieval/drillback, and migrate legacy snapshots on restore. Keep existing summary dependency fingerprints and authority boundaries.

**Tech Stack:** JavaScript ES modules, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-26-lore-hierarchy-reference-evidence-design.md`

## Global Constraints

- Stack on `Development-Lore-Completion@1d3f8b8a399fe3320e54894a054d44ab73906e23`.
- Preserve PR #254 review scope; target stacked PR to `Development-Lore-Completion`.
- Do not change Brain/Core delivery, Scene, UI implementation, or authoring utilities.
- Preserve authored Lore, human Tree, exact source revisions, summary IDs and history/current distinctions.
- Missing evidence references fail/degrade closed; never fabricate or promote authority.
- New snapshot format must restore legacy embedded-evidence snapshots deterministically.

## Review Focus

- Historical summary evidence remains drillable after a source edit and reload.
- Legacy snapshots with duplicated embedded evidence migrate without changing summary IDs/states.
- Missing referenced evidence cannot silently produce CURRENT retrieval metadata.
- A one-entry edit does not invalidate or rebuild unrelated summaries/source study.
- Large-book persistence decreases without shifting equivalent duplication into another snapshot component.

---

### Task 1: Define the reference-backed evidence contract

**Files:**
- Create: `src/lore-navigation-evidence-registry.js`
- Modify: `src/lore-navigation-contracts.js`
- Test: `tests/worker4-lore-hierarchy-evidence.test.mjs`
- Modify: `.github/workflows/main-owner-integration.yml`

**Interfaces:**
- Produces: `LoreNavigationEvidenceRegistry.register(row)`, `resolve(ref)`, `resolveMany(refs)`, `snapshot()`, `restore(snapshot)`.
- Produces: navigation summaries with `criticalEvidenceRefs` and `criticalEvidenceCount`, no embedded payload.

- [ ] Write failing tests for stable evidence refs, summary node shape, and missing-ref reporting.
- [ ] Run exact Lore test command and verify failure is caused by missing reference-backed contract.
- [ ] Implement evidence registry and summary contract changes.
- [ ] Run focused tests to GREEN.

### Task 2: Wire builder, retrieval and exact drillback

**Files:**
- Modify: `src/lore-navigation-summary-registry.js`
- Modify: `src/lore-navigation-summary-builder.js`
- Modify: `src/lore-contextual-retrieval.js`
- Modify: `src/lore-hierarchy-retrieval-system.js`
- Test: `tests/worker4-lore-hierarchy-evidence.test.mjs`

**Interfaces:**
- Consumes: Task 1 evidence registry and summary refs.
- Produces: `LoreHierarchyRetrievalSystem.drillEvidence(summaryOrId,{limit})`.
- Produces: retrieval records whose claim/entity/relationship/temporal metadata comes from resolved evidence refs.

- [ ] Add failing tests spanning entry/topic/community/book/corpus, temporal/unresolved semantics and missing refs.
- [ ] Verify RED on #254-compatible code.
- [ ] Resolve refs in bottom-up build, retrieval indexing and drillback; block/degrade missing refs.
- [ ] Run Wave 3 + Worker 4 hierarchy tests to GREEN.

### Task 3: Add deterministic legacy migration and selective invalidation coverage

**Files:**
- Modify: `src/lore-navigation-summary-registry.js`
- Modify: `src/lore-hierarchy-retrieval-system.js`
- Test: `tests/worker4-lore-hierarchy-evidence.test.mjs`

**Interfaces:**
- Consumes: old `LoreNavigationSummaryRegistrySnapshot` rows with embedded `criticalEvidence`.
- Produces: new reference-backed in-memory nodes with unchanged IDs/history/current state.

- [ ] Add failing legacy-snapshot migration and source-edit tests.
- [ ] Verify legacy migration test RED before migration implementation.
- [ ] Implement deterministic migration and preserve historical evidence records.
- [ ] Verify one edit affects only dependent summary cone and no unrelated source restudy.

### Task 4: Measure 105-entry and larger synthetic workloads

**Files:**
- Test: `tests/worker4-lore-hierarchy-evidence.test.mjs`
- Modify: `docs/WORKER4_LORE_HIERARCHY_EVIDENCE_HANDOFF.md`

**Interfaces:**
- Produces: `WORKER4_LORE_HIERARCHY_105_METRIC` and larger synthetic metric log lines.

- [ ] Record snapshot bytes/chars by runtime, multi-resolution, hierarchy, summary registry/evidence registry/builder/retrieval index.
- [ ] Record initial study/index, one-entry edit/restudy, reload, heap observations and retained counts.
- [ ] Run a larger synthetic workload and record the same bounded retention signals.
- [ ] Document tradeoffs and explicitly avoid claiming live-browser spike resolution.

### Task 5: Exact-head verification and stacked handoff

**Files:**
- Modify: PR body only unless a CI-specific Lore-owned fix is required.

**Interfaces:**
- Produces: stacked PR targeting `Development-Lore-Completion`.

- [ ] Run focused Lore, Wave 3, Wave 5 and Worker 4 suites.
- [ ] Inspect exact-head Main Owner Integration results and distinguish branch failures from repository baseline debt.
- [ ] Reconcile #48/#120 and keep #179/FT004 open.
- [ ] Report final SHA, CI, measurements, migration safety, owner boundaries and unresolved dependencies.
