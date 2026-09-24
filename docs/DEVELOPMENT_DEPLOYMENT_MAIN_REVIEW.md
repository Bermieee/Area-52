# Development Deployment — `main` Review Package

**Purpose:** review the already-assembled Area-52 Brain for eventual migration from `Development-Deployment` to `main`. This document does not authorize a merge.

## Candidate lineage

- Deployment branch created from Core: `Development-Nexus@ba4619f56db8e4f94873256dc26589e1680b7d29`.
- Assembly checkpoint before live-host packaging: `caacd3e417c343207567d5ea3e49f631ec6cc4f4`.
- Exact source checkpoints, copied-path digests and integration-only patches: `assembly/development-deployment.json` and `assembly/lanes/*.json`.
- Lore #190 repair origin: `ea7e2e3acd3e53224302c3e55b0540697936148a`.
- Jev #211 repair origin: `54fe8cff459c184a8a47f9e1c75bf7a7f963a58b`.
- Core rich-fallback dedupe reconciliation: `7089e792850cce26a29b98d827f923f7cb6cb1f4` (owner transfer still pending).

## Exact-head assembly evidence before this package

Actions run `36073091994` at `caacd3e417c343207567d5ea3e49f631ec6cc4f4`: **SUCCESS**.

Green jobs:
- deployment vertical slice + deterministic demo;
- Worker 4 #190/#211 repair repros;
- Lore, Scene, Runtime, Memory and Coprocessor accepted regressions;
- UI live binding / SillyTavern host regressions;
- browser-facing imports with `Buffer` absent;
- source-digest / integration-patch manifest verification;
- full syntax;
- full assembled regression.

The live-host packaging commit must obtain its own exact-head green run before Director approval.

## One-resource and degraded result already proven

The deployment integration suite and deterministic demo prove:
- simple Hot-only turn reaches Seal/PromptPlan with expensive cognition skipped;
- retrieval-heavy Lore + Graph semantics complete on one local execution resource;
- bounded Sun Blade ambiguity invokes Jev, which abstains and retains no owner authority;
- one-resource vs multi-resource changes placement/concurrency, not sealed semantic evidence;
- optional Jev unavailable degrades safely while Truth/Gather/Seal/PromptPlan remain usable;
- no mandatory external database, orchestration middleware or remote provider is required.

The live extension package reuses these exact assembled objects and captures the same receipts from real SillyTavern messages.

## `main` divergence that must be reconciled

At packaging start, `main` was `daad62cc62c27acd12f7d77bf1fec5bdfc06ca45`. The deployment candidate and `main` had diverged from merge base `f600c09011091ec8472104f22e89bb32152847c0`: Deployment was 188 commits ahead and 6 commits behind.

Those six `main`-only commits are the earlier Phase 1 Function Test 001 / SillyTavern packaging and live-acceptance sequence. They are valid history and must not be silently overwritten. The deployment review PR is therefore a **review surface**, not permission to force-update `main`.

Director merge/reconciliation must preserve the newer Area-52 assembly while deliberately resolving the root extension package (`manifest.json`, `index.js`, `style.css`), README/status wording, Phase 1 live-acceptance documentation and any browser-compatibility repairs already present on `main`.

## Owner-branch transfer gaps

Deployment must not become a hidden source of owner fixes. Still pending:
- Lore owner branch transfer of the effective-policy / source-local invalidation repair from #190.
- Jev owner branch transfer of the revision/seal replay freshness + bounded retention repair from #211.
- Core owner branch transfer/reconciliation of the rich-fallback semantic dedupe patch.
- Any deployment-only reconciliation explicitly listed in the lane manifests.

## Live gate

GitHub #224 remains **OPEN**. The branch has a real host adapter and now a loadable live-evidence capture surface, but a real SillyTavern session must still execute the runbook in `docs/DEVELOPMENT_DEPLOYMENT_LIVE_DEMO_EVIDENCE.md`.

Do not convert browser-shaped CI, the fixture host harness, or the deterministic demo into a live PASS.

## Migration checklist

Before merge approval:
- live evidence JSON captured from a real SillyTavern session;
- Prompt Inspector confirms the sealed Area-52 PromptPlan was present in Main's request;
- UI operator trace reviewed on the same chat/turn/generation;
- exact-head deployment Actions green after packaging;
- assembly digest verifier green;
- final `main...Development-Deployment` diff/mergeability reviewed;
- six `main`-only Phase 1 commits reconciled, not discarded;
- owner-transfer gaps recorded/assigned;
- #190, #211, FT005 and #224 remain open unless their independent acceptance criteria have actually been met.

## Rollback

No `main` mutation is performed by this package. Before merge, rollback is simply closing the review PR / leaving `main` untouched.

After an approved merge, record the pre-merge `main` SHA and the merge commit. Roll back by reverting the deployment merge commit (preferred, history-preserving) or restoring the pre-merge commit under explicit Director authorization. Do not reset owner branches.
