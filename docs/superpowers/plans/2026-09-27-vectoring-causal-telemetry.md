# Vectoring Causal Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each installed Vectoring request explainable in the existing Diagnostics Center and single-JSON export, without assigning background indexing to a selected generation.

**Architecture:** Carry an opaque execution ID and bounded operation/selection metadata from Memory to the existing resource execution receipt, then back to Memory's owner outcome. The Diagnostics Center joins these owner-backed records with existing downstream receipts; missing links stay `NO_EVIDENCE`.

**Tech Stack:** Browser-compatible JavaScript modules, Node's built-in test runner, existing Area-52 Memory/Resource/Diagnostics contracts.

**Spec:** `docs/superpowers/specs/2026-09-27-vectoring-causal-telemetry-design.md`

## Global Constraints

- All presentation belongs to the existing Diagnostics Center and its single-JSON export; create no separate Vectoring UI.
- Never retain input text, artifact bodies, embedding arrays, credentials, raw provider responses, or hidden reasoning in telemetry.
- A provider success grants no Memory, Truth, Gather, Seal, or prompt authority.
- Background indexing has chat/work identity only and cannot be represented as selected-turn execution.
- Retain at most 64 resource execution receipts and 128 Memory vector outcome receipts.

## Review Focus

1. A resource operation without turn/generation identity must never appear in selected-turn execution history (Task 3 test).
2. A query from a prior generation must remain attached to that generation after chat switch or regeneration (Task 3 test).
3. A valid provider vector rejected by Memory for stale source/artifact revision must show success and owner rejection independently (Task 2 test).
4. A failed or budget-aborted request must show no accepted vector or nominated candidate (Task 2 test).
5. Qualification probes and sensitive request content must not enter cognitive trace or JSON export (Tasks 1 and 3 tests).

---

### Task 1: Physical embedding execution identity

**Files:** Modify `src/coprocessor/resource-connections.js`, `src/deployment/brain.js`; test `tests/vectoring-causal-telemetry.test.mjs`.

**Interfaces:** `executeEmbedding(resourceId,{input,signal,dimensions,inputType,encodingFormat,origin})`, where `origin` is a bounded `{operation,selection,workId,artifactId,artifactRevision}`. Return `executionId` on success. `readResource()` exposes up to 64 metadata-only `executionHistory` rows.

- [ ] Write a failing test: one `EMBED_QUERY` with exact selection and one `EMBED_ARTIFACT` with only chat/work identity produce distinct execution IDs, operation/purpose, statuses, latency, vector dimensions, and no input/vector/key in public read models. Failed execution has a failure code and no successful vector claim; qualification probe creates no cognitive history row.
- [ ] Run `node --test tests/vectoring-causal-telemetry.test.mjs` and verify the new assertions fail for missing identity/history.
- [ ] Implement origin validation and bounded history in `CoprocessorResourceConnections.executeEmbedding`; preserve existing execution result and qualification behavior. Forward Memory request metadata from the `DevelopmentDeploymentBrain` Vectoring executor without forwarding content into receipts.
- [ ] Run the focused test and `node --test tests/coprocessor-wave16-resource-jev.test.mjs tests/coprocessor-wave17-browser-fetch.test.mjs`; require all pass.
- [ ] Commit the producer change.

### Task 2: Memory owner outcome linkage

**Files:** Modify `src/memory-vector-index.js`, `src/deployment/brain.js`; test `tests/vectoring-causal-telemetry.test.mjs` and the existing Memory completion tests.

**Interfaces:** `primeQuery({query,selection,maxCandidates})` forwards exact selection; `runMaintenance({maxUnits})` forwards work/artifact revision. Both return/store bounded owner receipts with `executionId`. `hostBindings().readMemoryVectorReceipts()` returns at most 128 metadata-only receipts.

- [ ] Write failing tests: foreground query links physical execution to a `MemoryVectorQueryReceipt` with candidate count and owner destination; background indexing links execution to `MemoryVectorWorkReceipt`; stale revision rejection preserves provider success but marks owner rejection; unavailable/aborted execution has no accepted result; no raw query/artifact body/vector appears in receipts.
- [ ] Run focused tests and verify failure at the missing execution/outcome linkage.
- [ ] Propagate execution IDs and identity through Memory's existing query/index receipts, preserve current authority decisions, and expose the bounded read-only host binding. No new Memory write policy.
- [ ] Run focused tests and relevant Memory owner/stress checks; require all owned assertions pass.
- [ ] Commit the Memory owner change.

### Task 3: Existing Diagnostics Center and single-JSON export

**Files:** Modify `src/ui-core/wave13-operator-adapters.js`, `src/ui-core/demo-visibility.js`, `src/ui-core/wave13-operator-surfaces.js`, `src/ui-core/turn-log-diagnostics.js` as needed; test `tests/vectoring-causal-telemetry.test.mjs`, `tests/demo-visibility.test.mjs`, and `tests/turn-log-diagnostics.test.mjs`.

**Interfaces:** `Wave13DiagnosticsCenterAdapter.read()` adds `vectoringTrace:{selectedTurn,background}` using exact source receipts. The existing Diagnostics resource/causal and Memory sections render these rows. `exportUnifiedDiagnostics()` includes the same bounded trace under existing `resources`/`knowledge` sections.

- [ ] Write failing tests: a selected query appears only with exact chat/turn/generation; a background artifact execution never appears as selected-turn proof; a foreign generation remains separate; owner result and downstream `NO_EVIDENCE` remain independent; current JSON contains no raw query, body, vector, or key and retains bounded row counts.
- [ ] Run the tests and verify failures at the missing Diagnostics trace and the old false selected-turn attribution.
- [ ] Join read-only Resource and Memory receipts in Diagnostics, update selected-turn resource event creation to require exact identity for Vectoring, and render details only in existing Diagnostics Center surfaces. Do not infer Truth/Gather/Seal/host success from provider or Memory success.
- [ ] Run the focused tests plus browser-facing imports and the existing Diagnostics/UI gates; require all owned assertions pass.
- [ ] Commit the Diagnostics change, review the whole branch, and stop at a reviewable PR unless previously authorized to merge.

## Installed acceptance

After integration, an installed SillyTavern/OpenRouter run must show a distinct `EMBED_QUERY` or `EMBED_ARTIFACT` purpose for each actual call, its Memory owner outcome, and exact selected-turn filtering. A successful provider call with zero Gather admissions must still display Gather as `NO_EVIDENCE`, not as delivered context.
