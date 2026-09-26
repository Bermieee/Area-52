# Development Deployment Demo

**Status:** ASSEMBLY CANDIDATE — LIVE DEMO PENDING

This is the deterministic operator rehearsal for the integrated Area-52 Brain on `Development-Deployment`. It is intentionally not evidence that GitHub issue #224 is complete. A real SillyTavern/browser host session is still required.

## Pinned accepted checkpoints

| Lane | Accepted SHA |
|---|---|
| Core | `ba4619f56db8e4f94873256dc26589e1680b7d29` |
| Lore | `fa74d3e792d3d8aa4dc4879271bcfc42f43e7c2c` |
| Scene | `3aaf1c1e9e7e8703dc8c66c5542efb03cc9873cf` |
| Runtime | `d7128397f0d432c4d6e088d9d2c5e8f8ac0aed3a` |
| Jev / Coprocessor | `daa3d7218b2a1d90e68fcab01217559a512180c1` |
| Memory | `a6d7cac76d5bb9fae7c9b2d67c2b7a6342db96b2` |
| UI | `3bd0dc1bca7dcec19669a1eea9ba0d13fab88ff9` |

The exact source digests, accepted Actions runs, integration-only patches, browser/runtime requirements and known conflicts live under `assembly/lanes/*.json`.

## Run the deterministic rehearsal

```bash
node scripts/development-deployment-demo.mjs
```

The script exits non-zero if a required invariant fails and prints one JSON `DevelopmentDeploymentDemoEvidence` record otherwise.

## Test world and native Scene transition

The rehearsal loads the authored Ember Tavern lorebook with Mara, Eris, the Ember Tavern and the Sun Blade. Lore is ingested through the native Lore Study runtime and mirrored into Core using exact source/revision identities.

It then performs two native Scene observations:

1. Ember Tavern, Mara + Eris, Sun Blade present, thread = find the blade.
2. Ember Tavern Ruins, same active cast, Sun Blade uncertain, thread = determine the blade's fate.

The second observation must advance `sceneRevision` and expose a real `SceneDelta` whose changed fields include `location`. This is native Scene Intelligence evidence, not a fixture-generated CurrentScene.

## Four cognitive cases

### 1. Hot-sufficient / simple

Query: `Where are we?`

Expected:
- no Runtime scatter jobs;
- Hot path reaches Context Seal and PromptPlan;
- Jev is skipped;
- no external database, orchestration service or remote provider is required.

### 2. Retrieval-heavy

Query: `Tell me about Mara and the Ember Tavern history`

Expected:
- Lore and Graph jobs are admitted;
- one local execution resource services the jobs;
- native Lore retrieval produces Candidate Bus nominations;
- nominated evidence drills back to exact authored source;
- Truth/Gather/Context Seal/PromptPlan complete successfully.

### 3. Bounded ambiguity

Query: `What happened to the Sun Blade?`

Expected:
- Lore, Graph and Jev work are admitted;
- Jev produces a visible proposal/receipt and abstains rather than inventing certainty;
- Jev retains no mutation authority;
- owner policy/Settlement remains authoritative;
- conflicting Sun Blade fate remains `UNRESOLVED`;
- the sealed generation still reaches PromptPlan.

### 4. Controlled degraded path

The same ambiguous query is run with optional Jev unavailable.

Expected:
- no Jev task is scattered;
- cognition records Jev as unavailable;
- Truth/Gather/Seal/PromptPlan remain usable;
- no fabricated state is introduced.

## One resource versus additional resources

The integration test suite also executes the same retrieval-heavy semantics with one local resource and three local resources. The accepted invariant is that placement/concurrency may differ while the sealed current/historical/unresolved semantic evidence remains identical.

## Repair provenance

- Lore #190 source repair: `ea7e2e3acd3e53224302c3e55b0540697936148a`.
- Jev #211 source repair: `54fe8cff459c184a8a47f9e1c75bf7a7f963a58b`.
- Deployment transfers are recorded in `assembly/development-deployment.json`.
- The Jev lane additionally records deployment-only reconciliation for accepted evaluation assets and a bounded 2048-entry default replay cache. Explicit low-limit eviction remains covered by the #211 reproducer.

The owner branches still require their repair transfers independently; the deployment branch must not become a hidden dependency for those fixes.

## Live gate still required

This harness proves the integrated contracts in deterministic execution, but it does **not** satisfy #224 by itself. Final Phase 2 acceptance still requires a real SillyTavern turn with the actual browser host/UI mounted beside chat, operator inspection of the same live turn/generation, and confirmation that Main receives the sealed PromptPlan.

Until that happens, keep #190, #211, FT005 and #224 open and do not merge `Development-Deployment` into `main`.
