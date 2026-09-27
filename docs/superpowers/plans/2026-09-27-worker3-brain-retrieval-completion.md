# Worker 3 Brain Retrieval Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete production sparse/exact identifier recall and bounded multi-resolution/corrective retrieval in the selected-turn native Brain path.

**Architecture:** Add a Brain-owned production sparse index/channel built on the existing retrieval lifecycle contracts, hydrate it only from public owner APIs, and route its nominations through the existing Candidate Bus. Extend selected-turn retrieval to consume existing Scene intents and owner hierarchy/graph candidates, then evaluate Truth quality with a single bounded corrective pass while keeping Gather and Context Seal authoritative.

**Tech Stack:** JavaScript ESM, Node test runner, existing Area-52 Candidate Bus/retrieval lifecycle/Truth/publication contracts, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-27-worker3-brain-retrieval-completion-design.md`

## Global Constraints

- Work only on `Development-Worker-3`; do not merge `main`.
- Do not add or modify production dense-embedding execution.
- Do not claim paraphrase recovery that requires dense execution.
- Lore, Memory, graph, and hierarchy source stores remain owner-controlled.
- One foreground corrective attempt maximum.
- Retrieval rank is never Truth, Gather, Settlement, or Context Seal authority.
- Missing capabilities report unavailable/degraded and preserve truthful fallback.
- Tests must distinguish sealed-context proof from host-delivery proof.

## Review Focus

- A source revision changes while a prior sparse record is resident: old revision must not remain fresh.
- A selected chat cannot read a Lorebook: exact identifier lookup must not bypass story scope.
- A query has only relationship evidence: graph provider output may nominate but cannot become truth by proximity.
- A broad Lore summary is retrieved: summary retrieval alone must not grant Context Seal admission.
- A corrective provider is unavailable or returns MIXED again: the turn must stop after one corrective pass and preserve prior evidence.

---

### Task 1: Production sparse exact/keyword channel

**Files:**
- Create: `src/production-sparse-retrieval.js`
- Test: `tests/worker3-brain-retrieval-completion.mjs`
- Create: `.github/workflows/worker3-brain-retrieval-completion.yml`

**Interfaces:**
- Consumes: `RetrievalIndexLifecycleManager`, retrieval index contracts, Candidate Bus channel contracts.
- Produces: `ProductionSparseRetrievalChannel` with `hydrateLoreOwner(interface,{chatId})`, `acceptLoreRevisionChange(event,interface)`, `retrieve(intent,context)`, `diagnostics()`.

- [ ] **Step 1: Write failing sparse-channel tests**
  - exact source ID, UID, name/alias, keyword/trigger and phrase outrank lexical overlap;
  - lexical fallback is explicitly labeled and never called BM25;
  - wrong story scope does not index or nominate;
  - hydration is capped by `maxArtifacts`.

- [ ] **Step 2: Run focused CI and verify RED**
  - Run: `node --test tests/worker3-brain-retrieval-completion.mjs`
  - Expected: FAIL because `production-sparse-retrieval.js` or its exported class does not exist.

- [ ] **Step 3: Implement the production sparse channel**
  - `ProductionSparseRetrievalChannel` owns a dedicated revision-aware lifecycle manager and production sparse adapter.
  - Qualified scoring order: exact identifier > exact phrase > authored keyword/trigger > lexical token overlap.
  - Preserve source/artifact revisions, provenance, authority/truth hints and dependency invalidators.
  - Limit indexed artifacts and returned candidates.

- [ ] **Step 4: Verify GREEN**
  - Run focused test and syntax checks.
  - Expected: all Task 1 tests PASS; no dense-provider file changed.

- [ ] **Step 5: Commit**
  - Message: `feat: add production sparse owner retrieval`

### Task 2: Native Brain owner lifecycle and multi-resolution intent assembly

**Files:**
- Modify: `src/native-brain.js`
- Modify: `src/generation-publication.js`
- Test: `tests/worker3-brain-retrieval-completion.mjs`

**Interfaces:**
- Consumes: Task 1 `ProductionSparseRetrievalChannel`; existing `SceneQueryPlanner`; existing owner Lore and graph channels.
- Produces: selected-turn `retrievalIntents` and sparse lifecycle receipts visible in native Brain diagnostics/turn records.

- [ ] **Step 1: Add failing integration tests**
  - attaching Lore owner hydrates sparse index from `status({chatId})` + `sourceRevision(sourceId)`;
  - edit reindexes only the changed source after exact owner revision is available;
  - removal tombstones the source and prevents current nomination;
  - unavailable owner sparse hydration leaves existing owner/Core lexical fallback usable;
  - Scene direct/relationship/object/thread intents are passed to Sensory Net;
  - broad intent can consume existing Lore hierarchy owner nominations; relationship-only intent can consume registered graph candidates;
  - paraphrase-only case records dense capability as unavailable/fallback and does not claim dense execution.

- [ ] **Step 2: Verify RED**
  - Expected: tests fail because native Brain does not register/hydrate the production sparse channel or pass decomposed retrieval intents.

- [ ] **Step 3: Wire owner lifecycle**
  - Construct/register the production sparse channel in `Area52NativeBrain`.
  - Hydrate per selected chat before retrieval using public Lore interface only.
  - Forward `LoreSourceRevisionChanged` to sparse invalidation/update logic.
  - Store sparse receipt/diagnostics in selected-turn read models without granting authority.

- [ ] **Step 4: Wire bounded retrieval intents**
  - Build Scene Query Planner intents from the current Scene signal when available.
  - Fall back to one direct query intent when a planner input is unavailable.
  - Pass the intent list into `GenerationPublicationPipeline.publish()` and Sensory Net unchanged except canonical contract normalization.
  - Preserve perspective, candidate, latency, graph and revision fences.

- [ ] **Step 5: Verify GREEN**
  - Focused Worker 3 test plus existing native Brain identity/Sensory regression.
  - Expected: exact, graph and hierarchy cases pass; dense behavior remains explicitly unavailable/fallback.

- [ ] **Step 6: Commit**
  - Message: `feat: assemble native retrieval intents and sparse lifecycle`

### Task 3: Truth-quality corrective selection and trace through Gather/Seal

**Files:**
- Modify: `src/truth-publication-gate.js`
- Modify: `src/generation-publication.js`
- Test: `tests/worker3-brain-retrieval-completion.mjs`

**Interfaces:**
- Consumes: canonical Candidate Bus envelope plus Truth results and retrieval intent IDs.
- Produces: quality/corrective receipt with HIGH/MIXED/LOW, at most one correction, and candidate lineage into Gather/Context Seal.

- [ ] **Step 1: Add failing policy/trace tests**
  - HIGH proceeds without correction;
  - MIXED performs one supported corrective action and no second retry;
  - LOW admits no long-term memory;
  - unavailable corrective provider preserves first-pass evidence and records degraded/unavailable status;
  - one exact sparse candidate can be traced by candidate/evidence ID through Truth -> Gather -> Context Seal;
  - wrong-topic/top-K candidate is not admitted merely because it ranked highly.

- [ ] **Step 2: Verify RED**
  - Expected: current selected-turn policy lacks intent-coverage quality/corrective receipt fields required by the tests.

- [ ] **Step 3: Integrate existing adaptive quality semantics**
  - Evaluate candidate intent coverage after Truth using existing HIGH/MIXED/LOW policy helpers.
  - Select existing corrective action based on missing exact/entity/relationship/temporal evidence.
  - Execute at most one bounded corrective retrieval with the same revision/perspective/budget fences.
  - Merge only fresh corrected candidates back through Candidate Bus/Truth.
  - LOW publishes an explicit abstention and compiles without long-term-memory evidence.

- [ ] **Step 4: Preserve Gather/Seal boundaries**
  - Gather admits only Truth-usable candidate result IDs.
  - Context Seal records admitted/rejected/stale result IDs and candidate lineage.
  - Do not infer PromptPlan/provider delivery from sealing.

- [ ] **Step 5: Run verification**
  - `node --test tests/worker3-brain-retrieval-completion.mjs`
  - `node --test tests/worker1-sensory-hot-closure.mjs tests/native-brain-identity-retrieval.mjs tests/candidate-bus-wave8.mjs tests/cognitive-choice-wave9.mjs tests/wave6-integration.mjs`
  - `npm run check`
  - `npm test`
  - Expected: zero failures. Any pre-existing accepted baseline must be reported by exact test name rather than hidden.

- [ ] **Step 6: Commit**
  - Message: `feat: complete bounded corrective retrieval selection`

### Task 4: Review and PR

**Files:**
- No production behavior changes unless review finds an Important/Critical defect.

**Interfaces:**
- Consumes: complete branch diff and CI evidence.
- Produces: reviewable PR from `Development-Worker-3` to `main`.

- [ ] **Step 1: Review the branch against the spec and cards**
  - Verify no dense-provider implementation or source-owner takeover.
  - Verify changed production path is selected-turn Brain -> Candidate Bus -> Truth -> Gather -> Seal.

- [ ] **Step 2: Run final CI on exact head**
  - Focused Worker 3 workflow, syntax, focused regressions, and full `npm test`.

- [ ] **Step 3: Open PR**
  - Base: `main`
  - Head: `Development-Worker-3`
  - Do not merge.

- [ ] **Step 4: Report**
  - exact SHA;
  - PR URL/number;
  - changed production path;
  - focused and full CI results;
  - precise remaining Worker 1/2/4 dependencies;
  - any rulings/deferred minors.
