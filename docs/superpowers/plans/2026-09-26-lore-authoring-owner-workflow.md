# Lore Authoring Owner Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Finish the reusable Lore semantic diff/impact planner and typed proposal-review-commit backend for canonical Lore authoring.

**Architecture:** Extend the existing #254 Lore Semantic Compiler with a focused impact planner module, then add a generic reviewed-mutation service over LoreStudyRuntime/Source Registry. Integrate both through LoreAuthoringService while preserving the existing Wave 7 Tree/Merge lifecycle.

**Tech Stack:** JavaScript ES modules, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-26-lore-authoring-owner-workflow-design.md`

## Global Constraints

- Branch from `Development-Lore-Completion@1d3f8b8a399fe3320e54894a054d44ab73906e23`.
- Do not depend on PR #255 unless a concrete registry contract becomes necessary.
- Do not touch UI implementation files, Core delivery, Scene, main, or live-demo plumbing.
- Exact authored source and human Tree remain recoverable and authoritative.
- No model/Jev output can directly mutate canon.
- No external DB/SQL/orchestration/provider dependency.
- All canonical mutations require explicit operator approval plus commit-time revalidation.
- Existing Wave 7 Tree/Merge APIs remain compatible.

## Review Focus

- Wording-only edits must not cause broad semantic invalidation.
- A proposal approved against revision N must fail closed if source/target/scope changes before commit.
- MERGE/SPLIT/MOVE must preserve reconstructable source history and never delete inputs implicitly.
- Scoped proposals must not mutate Lore outside the exact chat scope.
- Restoration must append compensating revisions rather than rewriting historical revisions.

---

### Task 1: Complete semantic diff and dependency impact planner

**Files:**
- Create: `src/lore-semantic-impact-planner.js`
- Modify: `src/lore-semantic-authoring.js`
- Test: `tests/worker4-lore-authoring-owner.test.mjs`

**Produces:**
- `LoreSemanticImpactPlanner.plan({sourceId,fromRevisionId,toRevisionId})`
- complete typed semantic categories, direct/transitive dependency cone, preserved refs and bounded counts.

- [ ] Add failing tests for full semantic categories, wording-only edit, temporal/unresolved and minimal dependency cone.
- [ ] Verify RED because the planner API is absent.
- [ ] Implement planner using existing studied artifacts and explicit revision dependencies.
- [ ] Run focused tests GREEN.

### Task 2: Typed reviewed mutation service

**Files:**
- Create: `src/lore-reviewed-mutation.js`
- Modify: `src/lore-authoring-contracts.js`
- Test: `tests/worker4-lore-authoring-owner.test.mjs`

**Produces:**
- `LoreMutationOperation`
- `LoreReviewedMutationService.createProposal/approve/reject/commit/restore/read/list/audit`.

- [ ] Add failing CREATE/UPDATE/DELETE/MERGE/SPLIT/MOVE/TREE_ASSIGN tests.
- [ ] Add failing stale/duplicate/scope/collision/no-silent-mutation tests.
- [ ] Implement proposal fingerprint, exact fences, review state and commit-time revalidation.
- [ ] Commit through LoreStudyRuntime only after approval.
- [ ] Add append-only audit and compensating restoration.
- [ ] Run focused tests GREEN.

### Task 3: Integrate LoreAuthoringService and Worker 3 contract

**Files:**
- Modify: `src/lore-authoring-service.js`
- Test: `tests/worker4-lore-authoring-owner.test.mjs`

**Produces:**
- semantic impact and mutation read/action methods on service/operator contract.
- bounded Worker 3 contract metadata.

- [ ] Add failing operator-contract tests.
- [ ] Wire impact planner and reviewed mutation service.
- [ ] Preserve existing Wave 7 Tree/Merge actions.
- [ ] Verify bounded safe read/action shapes and snapshot/reload.

### Task 4: Qualification and card reconciliation

**Files:**
- Create: `docs/WORKER4_LORE_AUTHORING_OWNER_HANDOFF.md`
- Modify workflow only if the new Worker 4 test is not automatically included.

- [ ] Run focused Worker 4 authoring tests.
- [ ] Run Lore Wave 6/7 regression and syntax/module-load exact-head CI.
- [ ] Inspect full assembled CI and separate branch regressions from baseline failures.
- [ ] Coordinate Worker 3 read/action contract without editing UI files.
- [ ] Update #120, #195 and rebuild authoring card only for demonstrated criteria; keep #169/#192/#189 as consumers.
- [ ] Open stacked PR targeting `Development-Lore-Completion` and stop without merge.
