# Area-52 Architecture, Wiring and Stress Audit

**Packaged commit:** `main @ 98a4e438e995bdc62038076c5f97addaf2a3d0bd` (PR #323 merged)
**Audit date:** 2026-09-28
**Auditor:** Claude (Cowork session)
**Production code changed:** none

---

## 0. How to read this report

Evidence labels used throughout:

| Label | Meaning |
|---|---|
| **REPRODUCED** | Reproduced by a harness that drives the real installed objects (`createDevelopmentDeploymentSillyTavernSession` + `Area52NativeBrain`, the same pair `index.js` constructs), replaying SillyTavern's real event order. Re-run from a clean process before this report was written. |
| **CODE** | Established by reading production call paths; not executed end-to-end. |
| **MEASURED (LOCAL_DETERMINISTIC_NODE)** | Timings/memory from Node in a 2-vCPU Linux sandbox with mocked providers. Not browser latency, not live-provider latency. |
| **UNVERIFIED** | Could not be established here; needs installed SillyTavern, a live provider, or GitHub CI access. |

Nothing below is a live acceptance claim. Every finding in §4 has a runnable reproducer under `harness/`.

### Environment

- Package: ZIP SHA-256 `F9E2CFB4…FCB931` matched `Area52-Claude-Handoff-20260928-98a4e438.zip.sha256.txt`. All 1,118 manifest file hashes matched. A fresh clone of `Bermieee/Area-52` at `98a4e438` is byte-identical to the ZIP's `Area-52/`.
- Node **v22.22.2**, which is the major version every GitHub workflow pins. The operator's local v24.19.0 couldn't be installed in the sandbox (download blocked).
- SillyTavern event semantics were checked against the SillyTavern source (`public/script.js`, clone `06bde939`, 2026-09-14). The operator's installed SillyTavern version is unknown. If it's older, re-check the quiet/impersonate/swipe notes.
- GitHub API access wasn't available in this session, so the Actions conclusions at `98a4e438` are **UNVERIFIED**. I replayed the workflow steps locally instead (§3.1).

---

## 1. Executive summary

The native design is present and many owner-level contracts behave as documented in isolation. Seal immutability, late-result routing, stale-revision fencing and bounded receipts all pass their focused tests. **The installed assembly is where it breaks down.** It joins two brains, and their owners don't share identity, jobs or context. On the production path I reproduced:

1. **Context delivery stops permanently after roughly 21–33 turns per page load.** The prompt packet grows about 225 tokens per turn until `DELIVERY_BUDGET_UNSATISFIABLE`. That failure then wedges the chat ("generation already pending") until reload, and nothing surfaces outside Diagnostics (D8, D9).
2. **Swipe, regenerate and continue receive no Area-52 context and are never learned** (D1). **Text-completion backends** get no context at all and wedge from turn 1 (D13).
3. **Deleting, editing or swiping a message never invalidates Brain, Memory or Scene evidence.** Deleted text is delivered to the model on the next turn (D2).
4. **Nothing persists across a reload** in the installed build (D3).
5. **One cancelled or failed Scene call disables the Scene resource until an operator reconnects it** (D4).
6. **The deterministic Scene path pre-empts the Sidecar on most prose** and writes wrong OBSERVED locations (D5).
7. **Graph Walker can't traverse owner graphs:** no identity import, and anchors aren't normalized. NO_ENTITY_ANCHORS and NO_MATCHING_EDGES are the expected outcomes (D6).
8. **Lore reaches the model only if it was accepted with a chat ID**, and Truth labels all authored lore CURRENT. The golden-world contradictions (tavern intact vs. burnt, conflicting journals) are delivered side by side as current fact, and native Jev is never reachable (D7, D11).
9. **At 1,200 Lorebook entries:** a single synchronous 154 s study, about 3 s of Brain preparation per turn, and a 20 MB evidence export (D10, local measurement).

The "one remaining blocker" framing in older docs doesn't hold. The live loop runs, but these defects mean the documented cognition mostly can't take effect in a real session.

---

## 2. Architecture conformance matrix

| # | Documented responsibility / contract (doc) | Actual implementation / call site | Evidence | Deviation | Owner | Severity | Confidence |
|---|---|---|---|---|---|---|---|
| A1 | One Runtime Kernel owns scheduling; "Framework does not create a second scheduler, Result Bus, Seal" (FRAMEWORK_ARCHITECTURE) | Installed session builds `DevelopmentDeploymentBrain` (own `Area52CognitiveCore`, `resourceDirector` + `runtimeDirector` WorkerDirectors, `NativeHotDeepScheduler`) **and** `Area52NativeBrain` (own core, own `runtimeDirector`). 3 WorkerDirectors, 2 Result Buses, 2 Context Seals. `brain.js:425,556`; `native-brain.js:199` | CODE | Duplicate schedulers/buses. `resourceDirector.isTurnSealed` reads the deployment core seal, but live turns seal in the native core (`brain.js:431`). Scene results route through the deployment Result Bus. | Integration | High | High |
| A2 | Models propose; owners settle; Temporal State Graph updated via Settlement (BLUEPRINT §27, ADVANCED_MEMORY §2) | Live 7-turn narrative produced **0 settlements, 0 native Temporal claims** (`nativeBrain.core.graph.allClaims()`) | REPRODUCED (`trace-memory-recall.mjs`) | Narrative learning doesn't reach current state on the live path | Memory/Core | High | High |
| A3 | Truth Gate distinguishes CURRENT/HISTORICAL/SUPERSEDED/CONTRADICTED/UNRESOLVED; ambiguous evidence stays unresolved (PROJECT_PLAN Gate E, §6) | Bound golden lorebook: all 12 lore candidates `CURRENT, usable` (`external-current-usable-for-current`), including "Tavern is intact", "Tavern burns down" and both conflicting journals. Packet `unresolved: 0`, confidence HIGH on an explicitly conflicting query | REPRODUCED (`trace-turn-bound.mjs`, `probe-jev-native.mjs`) | Golden-world acceptance not met on the installed path | Core Truth / Lore | High | High |
| A4 | Graph retrieval via stable identity (WORKER4_STRUCTURED_WORLD_STATE_GRAPH) | Native identity registry is empty after Lore ingest. Owner edge endpoints become `LORE_OWNER_GRAPH::entity:x` (`entity-identity-registry.js:188`); anchors are passed raw (`graph-neighborhood-retriever.js:273`) | REPRODUCED (`probe-graph-identity.mjs`) | Graph channel yields no nominations in production | Core / Lore | High | High |
| A5 | Query decomposition derives ENTITY intents from the message (BLUEPRINT §13, Scene Query Planner #35) | Anchors = Scene `activeCast` PRESENT only (`scene-query-planner.js:31-39`, `native-brain.js:610-640`); host passes no `anchorEntityIds` | CODE + REPRODUCED | No query-text entity linking | Scene / Core | Medium | High |
| A6 | NarrativeFeedAdapter: edits append revisions, regenerate/swipe invalidate abandoned evidence, delete emits invalidation (SCENE BLUEPRINT Wave 2) | Installed host only logs MESSAGE_EDITED/DELETED/SWIPED rows and expires pending (`sillytavern-live.js:1486-1508`) | REPRODUCED (`probe-memory2.mjs`) | Host revision events never reach owners | Integration | High | High |
| A7 | Durable Work Ledger, restart reconstruction, "reload preserves world/seal/Lore trust" (BOARD_MAP #20, NATIVE_BRAIN handoff) | `index.js:83-86` reads `globalThis.Area52PersistNativeBrain` etc.; nothing sets them. Every checkpoint is `NOT_CONFIGURED` (`sillytavern-live.js:1228`). Every `WorkerDirector` has `persistence: null` | CODE | No durability in the installed build | Integration | High | High |
| A8 | Mandatory Batch Engine; "all large work through Runtime Fabric"; study yields (BOARD_MAP #18, #30) | UI Lore action → `brain.runLoreStudy` → `loreIntelligence.runStudy({maxUnitsPerObligation: Infinity})`: one synchronous call (`brain.js:632`, `wave13-operator-adapters.js:237`) | MEASURED | Study bypasses Runtime; blocks the main thread | Lore / Runtime | High | High |
| A9 | Semantic Scene extraction via Runtime/Sidecar; deterministic path for "clear host evidence" (#213) | `explicit` is true for any location regex hit, any atmosphere cue word, any prefetch intent, or "doorway" (`sillytavern-live.js:173-271,352`) | REPRODUCED (`probe-deterministic-skip.mjs`) | "Clear" isn't clear: 16/20 synthetic lines skip the Sidecar | Scene | High | High |
| A10 | Optional provider failure degrades safely; unavailable ≠ rejected ≠ no-work; failures recover (RESOURCE_CONNECTION_CONTRACT, blueprint §18) | Intentional supersession abort is scored as a provider failure → COOLDOWN → `UNAVAILABLE` with no re-probe (`resource-connections.js:593-611`, `provider-health.js:37`) | REPRODUCED | Internal cancellation disables the resource | Coprocessor | High | High |
| A11 | Jev: owner-gated bounded judgment for ambiguity (DEVELOPMENT_DEPLOYMENT_DEMO case 3, WAVE17) | Jev adapter is registered only on the deployment core (`brain.js:595`); the native core has none, and Truth never produces ambiguity → `SKIP_JEV/JEV_NOT_REQUIRED` | REPRODUCED | Native-path Jev can't run | Jev / Core | Medium | High |
| A12 | Context Seal immutability; late results route NEXT_TURN/BACKGROUND without changing the hash | Holds in the installed harness (late Scene result admitted NEXT_TURN, seal JSON unchanged) and in focused tests | REPRODUCED (existing test + harness) | None found | Core | — | High |
| A13 | Foreground stays bounded; Reflex work bounded (BLUEPRINT §26) | 1,200-entry lorebook: Brain preparation 2.9 s/turn (OWNER_LORE 831 ms, corrective 711 ms, ~1.3 s outside stage timers) | MEASURED | Foreground cost scales with corpus | Lore / Core | Medium | Medium |
| A14 | Large owner/status reads and exports remain bounded (START_HERE) | `exportEvidence()` = 1.9 MB @105 entries, **20.7 MB @1,200**; several selected-turn readers 120–220 KB; each turn record ~172 KB × `maxTurns=256` | MEASURED | Export scales with corpus | Diagnostics | Medium | High |
| A15 | Lore Tree first-class; story-scoped read authority (LORE_COMPILER) | Retrieval requires a per-chat BOUND scope (`lore-intelligence-service.js:650`); unbound → `LORE_STORY_SCOPE_REQUIRED`, 0 nominations | REPRODUCED | Conforms by design, but has operational consequences with no persistence (A7) and on chat switch | Lore | Medium | High |

---

## 3. Baseline, CI replay and assembly

### 3.1 Full suite (each `tests/*.mjs` file run separately, Node 22.22.2)

| Metric | Value |
|---|---|
| Test files | 219 |
| Tests | 1,875 |
| Pass | 1,827 |
| **Fail** | **48** (21 files) |
| Cancelled / skipped | 0 / 0 |
| Serial CPU wall (2 parallel) | ~1,448 s |

Compared against `ci/known-main-failures-9eef91c.txt` (18 names): 13 still fail, **5 now pass**, and **35 failures aren't on that list.** Grouped by root cause:

| Count | Root cause | Files | Assessment |
|---|---|---|---|
| 10 | `TypeError: Cannot use 'in' operator to search for 'tension' in Ash and rain` at `src/scene/atmosphere.js:25` via `DevelopmentDeploymentBrain.observeScene` (`brain.js:702`). A string atmosphere is passed where dimensions are expected. Introduced in `983256f` (2026-09-27). | `deployment-brain.integration.test.mjs` | **Baseline regression.** Also crashes the documented rehearsal `scripts/development-deployment-demo.mjs`. Not on the live `applyNativeScene` path. |
| 4 | `Memory consolidation interface must expose propose(input)` | `worker1-scene-ft002-assembly.mjs` | Pre-existing (disclosed in LIVE_SCENE_GRAPH_PROFILE_REPAIR) |
| 13 | UI text/structure assertions (Lore workspace, Connections, Settlement review, "Unknown workspace: memory") | `wave13-operator-ui.test.mjs` | Operator UI drift vs. tests; 4 are on the known list |
| 14 | Assorted equality assertions | coprocessor wave3/6/8/9/14/20, client-repair-wave2, wave2, wave6 | Mix of known and new; per-name list in `results/base2_fails.tsv` |
| 7 | Other single failures | scene-clapperboard-handoff, scene-completion-wave4-gaps (2), worker1 causal/context/event-spine/prefetch, worker3-lore-neural-ui, worker4-causal-telemetry | New relative to the known list |

**Workflows that run on push to `main`:** `development-deployment.yml`, `main-demo-ui.yml` and `main-owner-integration.yml` each include steps that fail locally (`deployment-brain.integration`, `development-deployment-demo.mjs`, `wave13-operator-ui`, `npm test`). `main` CI is therefore expected red at this commit. That's inferred from the local replay; the actual Actions result is UNVERIFIED.

`npm run check` (syntax) passes. It needs Unix `find`/`xargs`, so it can't run on Windows as written.

### 3.2 Assembly verification

`node scripts/verify-development-deployment.mjs` → **FAIL.** The reconciliation overlay is `scene-worker-runtime-trace-20260928.json`.

| Lane | Exact | Patched | Missing | **Unexpected drift** |
|---|---|---|---|---|
| core | 0 | 0 | 0 | 0 (BASE_ANCESTRY) |
| lore | 32 | 12 | 0 | 2 |
| scene | 41 | 19 | 0 | 1 |
| runtime | 29 | 11 | 0 | 0 |
| jev | 198 | 22 | 0 | 4 |
| memory | 26 | 3 | 0 | 3 |
| ui | 119 | 14 | 0 | 16 |

This is consistent with START_HERE's "existing assembly drift remains". It's recorded here as measured on this commit.

---

## 4. Prioritized findings

Reproducible defects come first. Each has a minimal reproducer. From `C:\Area-52\audit-20260928\harness\` run `node <file>.mjs`; the scripts import `../../src/`, need no install, and touch no files. Some stress scripts accept `N=`/`LEN=` environment variables.

### D8 — Context delivery fails after ~21–33 turns: packet grows linearly until `DELIVERY_BUDGET_UNSATISFIABLE` · REPRODUCED · Critical

- **Scenario:** fresh session, no Lore, ordinary turns (300-char user messages, 600-char replies).
- **Observed:** plan tokens run 1,067 (turn 3), 1,733 (6), 2,402 (9), 3,074 (12), 3,748 (15). The plan compacts once (turn 18: 3,172), keeps growing (turn 21: 3,686 / 4,096), and **turn 22 preparation throws `NATIVE_BRAIN_DELIVERY_FAILED:DELIVERY_BUDGET_UNSATISFIABLE`.** With 60-char replies the failure comes at turn 30–33. Growth is entirely `CURRENT_SCENE` (the protected recent-episode tail, about 225 tokens/turn). The protected floor exceeds the budget (`adaptive-context-budget.js:25`).
- **Reproducers:** `probe-budget-growth.mjs`, `probe-turn-limit2.mjs` (`LEN=600`).
- A bound Lorebook shares the same budget, so failure should come earlier with Lore attached. That's not separately measured.

### D9 — One failed preparation wedges the chat until page reload · REPRODUCED · Critical

- `prepareNativeGeneration` stores `nativeRuns.set(chatId, run)` (`sillytavern-live.js:833`) before `runTurn`. If `runTurn` rejects before its `generate` callback (D8 is one trigger), the entry is never removed.
- `#expireNativePending` (`:1545`) iterates `nativePending` only, so GENERATION_STOPPED, edits and CHAT_CHANGED can't clear it.
- Every later Send logs `A native Brain generation is already pending for this selected chat`. The model receives no Area-52 context and the operator sees nothing outside Diagnostics.
- **Reproducer:** `probe-turn-limit2.mjs`. After the failure, the next three turns inject 0 messages, and 0 again after switching chats and back.

### D1 — Swipe, regenerate and continue get no context and are never learned · REPRODUCED · High

- `registerNarrativeSource` → `core.registry.importSource` throws `Source already exists` (`source-registry.js:11`) whenever the latest user message was already registered (`sillytavern-live.js:288,806`). The source ID is message key plus digest.
- Consequence: no pending → no injection → `completeNativeGeneration` returns null. The regenerated reply is never admitted, and no POST_RESPONSE Scene observation runs.
- Quiet generations (other extensions' `generateQuietPrompt`) hit the same guard, which harmlessly prevents injection into quiet requests but logs an error each time.
- **Reproducer:** `repro-swipe.mjs`. All three generation types inject 0 messages and log NATIVE_PREPARE errors.

### D2 — Host delete, edit and swipe never invalidate evidence; deleted text is delivered next turn · REPRODUCED · High

- `#recordHostNarrativeEvent` (`sillytavern-live.js:1486-1508`) records a diagnostic row and expires pending only. It doesn't call the Scene NarrativeFeed (EDIT/DELETE/SWIPE_SELECTED), Core source retirement or Memory invalidation.
- **Reproducer:** `probe-memory2.mjs`. After `MESSAGE_DELETED` for an assistant message, the next turn's Area-52 system payload still contains its text as an episode excerpt (`"activity":"APPEND"`).

### D4 — One cancelled, failed or timed-out Scene call makes the resource UNAVAILABLE indefinitely · REPRODUCED · High

- `runSceneObservationWork` cancels the same chat's in-flight work for the same phase when a new turn arrives (`brain.js:739`). The fetch abort surfaces as `PROVIDER_ABORTED`.
- `#observeFailure` (`resource-connections.js:593-611`) counts it as a failure. The health window was cleared at connect, so the failure rate is 1.0, which is ≥ the 0.5 cooldown threshold (`provider-health.js:37`). The resource goes COOLDOWN → `row.state=UNAVAILABLE`, profile availability false.
- Nothing re-probes. Every later Scene job is `SKIPPED / SCENE_OBSERVATION_BLOCKED` until an operator connect or test. The same applies to a single timeout or single MALFORMED_OUTPUT (compare installed turn 428).
- Separately, even before the abort completes, the new turn's FOREGROUND job is `SKIPPED/BLOCKED`, because capability admission still sees the profile at `currentLoad 1/1`.
- **Reproducer:** `probe-abort-availability.mjs` (4.7 s mock provider, second Send while the first is in flight).

### D5 — The deterministic Scene path pre-empts the Sidecar on most prose and writes wrong OBSERVED locations · REPRODUCED · High

- `applyNativeScene` (`sillytavern-live.js:352`) uses the deterministic owner path whenever `extractDevelopmentDeploymentScene(...).explicit` is true, and then never schedules the Sidecar.
- The location regex (`:185`), `(at|inside|within|outside|near) (the)? Capitalized …`, captures people, times and objects. Any single atmosphere cue word also sets `explicit`.
- **Synthetic 20-line fixture** (author-written, not user data): 16/20 lines skip the Sidecar. 6 of the 7 locations recorded are wrong ("Eris and", "Kael", "Dawn", "Tomas and", "Anya", "The Map"), all OBSERVED at confidence 1. Only one line yields a PRESENT cast member.
- In `repro-scene-foreground.mjs` (fast provider), the Sidecar's admitted "Ember Tavern" was overwritten by a deterministic POST_RESPONSE "Eris and".
- **Reproducer:** `probe-deterministic-skip.mjs`.

### D6 — Graph Walker can't traverse owner graphs in the installed layout · REPRODUCED · High

- Lore is studied in the deployment brain's Lore owner. The Native Brain's `NativeEntityIdentityRegistry` has **0 entities** after ingest, so every Lore edge endpoint normalizes to `LORE_OWNER_GRAPH::entity:x` (`entity-identity-registry.js:188`).
- Anchors aren't normalized (`graph-neighborhood-retriever.js:273`), so neither `Mara` nor `entity:mara` matches, and the result is `NO_MATCHING_EDGES`.
- **Counterfactual** (in-memory, audit only): registering `entity:mara` in the native registry gives 3 traversed edges. The Scene-style raw anchor "Mara" still gives 0.
- 7 of 10 Lore edges were also rejected `OWNER_GRAPH_DEPENDENCY_REVISION_STALE` immediately after a fresh ingest. That's a lead; I didn't isolate which dependency references fail.
- **Reproducers:** `probe-graph-identity.mjs`, `probe-anchors-e2e.mjs`, `probe-graph-walk.mjs`.

### D7 — Lore flows only when story-bound; Truth treats all authored lore as CURRENT · REPRODUCED · High

- Lore accepted without `chatId` gives `loreSync EXCLUDED / LORE_STORY_SCOPE_REQUIRED` and zero Lore nominations. With `chatId` it gives 31 Lore + 6 sparse nominations and a RELEVANT_LORE section (11.4 KB rendered for six short entries; the payload is raw JSON with internal IDs).
- For "Where can Eris find the Sun Blade now?", "The Ember Tavern is intact.", "The Ember Tavern burns down…" and both mutually conflicting journals are all delivered CURRENT/SOURCE_CANON. There's no temporal ordering (entries carry `metadata.at`/`claimAt`) and no UNRESOLVED set.
- **Reproducers:** `trace-turn.mjs` (unbound), `trace-turn-bound.mjs` (bound). Output: `results/turn-trace-bound.json`.

### D11 — Native-path Jev can't run · REPRODUCED · Medium

- The Jev adapter is registered only on the deployment core (`brain.js:595`); the native core's `cognitiveChoice.jevAdapter` is null.
- Truth returns HIGH even for "the accounts are conflicting", so the choice controller records `SKIP_JEV / JEV_NOT_REQUIRED`, and `unavailable:false` hides the missing adapter.
- **Reproducer:** `probe-jev-native.mjs`.

### D10 — 1,200-entry Lorebook: synchronous 154 s study, O(N²) cloning · MEASURED · High

See §5 for the numbers. Root cause of the superlinear study, from a CPU profile at 400 entries (78% of time in `structuredClone`):

- **49% of study CPU:** `lore-study-runtime.js:151` runs `this.store.currentArtifacts(this.registry).filter(…).length`, which deep-clones every current artifact in the corpus (`lore-source-registry.js:296`) **once per obligation**, just to count unrelated artifacts.
- **About 11% more:** `getRevision` deepClone inside `refreshFreshness` / `currentArtifacts`.
- **Reproducers:** `stress-lore-split.mjs`, `stress-lore1200.mjs`; profile in `prof/`.

### D3 — Installed build never persists Brain, Lore, Memory, Scene or runtime work · CODE · High

- `index.js:83-86` supplies `globalThis.Area52PersistNativeBrain`, `Area52NativeBrainOwner`, `Area52OwnerBindings` and `Area52MemoryOwnerSnapshot`. None of these are assigned anywhere in the repository.
- Every checkpoint row is `NOT_CONFIGURED`. The only production `localStorage` use is UI presentation state. Resource credentials are `SESSION_MEMORY_ONLY` by contract.
- After a reload, the Brain, Lore study (including the 154 s for 1,200 entries), story binding, Memory and Scene all start empty. Imported or long stories are only observed from the next Send; there's no backfill of chat history.
- Not executed as a reload harness; the code path is unambiguous.

### D13 — Text-completion backends get no context and wedge from turn 1 · REPRODUCED · High (if the operator uses a text-completion API)

- The installed session hooks only `CHAT_COMPLETION_PROMPT_READY` (`sillytavern-live.js:764`).
- SillyTavern emits that event only for chat-completion prompts. Text-completion prompts emit `GENERATE_AFTER_COMBINE_PROMPTS` instead (`public/script.js:4028-4039`).
- On MESSAGE_RECEIVED, `completeNativeGeneration` throws `Native Brain response arrived without the exact prepared.rendered payload…`. The pending row and run are never cleared, so every later Send fails preparation.
- **Reproducer:** `repro-textcompletion.mjs`. Pending stays at 1 and runs at 1 across three turns.

### D12 — Documented deterministic rehearsal and 10 integration tests crash (baseline regression) · REPRODUCED · Medium

`node scripts/development-deployment-demo.mjs` hits the TypeError described in §3.1. It was introduced by `983256f` ("Reconcile Worker 2 into src/deployment/brain.js"), line `brain.js:702`: `dimensions: atmosphere?.value ?? atmosphere` passes a string to `AtmosphereTracker.update`.

### Hypotheses, not established

- **H1 — installed message 436 (FOREGROUND_USER / QUEUED, no physical attempt).** D4 and the single-slot director (capacity CPU = `resourceCount` = 1 hard-coded at `sillytavern-live.js:631`, foreground reserve 1) are plausible mechanisms. In the harness, though, D4 produces SKIPPED receipts, not QUEUED. A task can stay QUEUED with no pump if a competing lease on the one slot ends by abort, because failure paths other than retry and final failure don't call `resultSink` and so never re-pump. **I didn't reproduce QUEUED-forever.** A fresh installed export with `pipeline.sceneObservation.runtime` is still needed.
- **H2** — `resourceDirector.isTurnSealed` checks the deployment core, so completion envelopes for native turns report `late:false` / `ON_TIME`. The Scene owner has its own `turnSealed` guard, so I found no mis-admission, but late-state telemetry for Scene is probably wrong.
- **H3** — Retaining 256 native turn records at 120–200 KB each is a memory-growth risk (tens of MB per chat) in long sessions. D8/D9 currently stop sessions from getting that far.

### Missing telemetry that blocked conclusions

- Scene receipts don't record *why* a task is QUEUED at export time (partly addressed by PR #323's runtime snapshot).
- Resource health transitions (READY → UNAVAILABLE and the triggering code) aren't surfaced as an operator-visible event.
- `DELIVERY_BUDGET_UNSATISFIABLE` and the "already pending" wedge appear only in `errors[]`. No UI state tells the operator that Area-52 has stopped contributing context.
- About 1.3 s of per-turn preparation at 1,200 entries falls outside the stage timers (probably the sparse Lore hydrate before `RETRIEVAL_CHANNELS`).

---

## 5. Stress report

All figures are **LOCAL_DETERMINISTIC_NODE**: Node 22.22.2, 2 vCPU, 7 GB RAM, mocked providers, synthetic data, commit `98a4e438`.

### 5.1 Existing stress suites (from the baseline run)

| Suite | Result | Wall | Peak RSS | Entry point |
|---|---|---|---|---|
| lore-wave3-stress | pass | 399 s | 1,251 MB | `LoreStudyRuntime` direct |
| scene-wave3-stress | pass | 286 s | 1,586 MB | Scene modules direct |
| wave11-live-bindings-stress | pass | 291 s | 943 MB | UI.Core + fixtures |
| lore-wave7-stress | pass | 50 s | 643 MB | Lore direct |
| runtime-wave2-stress | pass | 35 s | 195 MB | Runtime direct |
| candidate-bus-wave8-stress | pass | 28 s | 471 MB | Core direct |
| memory-wave2/3-stress (3,000 events / 1,000 episodes, verified in the fixtures) | pass | 8 / 14 s | 194 / 174 MB | `MemoryTemporalProducer` direct |
| coprocessor-wave8/9-stress | **fail** (known) | 1.4 / 3.4 s | 91 / 110 MB | Coprocessor direct |

None of these drives the installed session. The long-story Memory workloads have no production-host equivalent, and D8 prevents one beyond about 22 turns per load.

### 5.2 Installed-path Lorebook stress (`stress-lore1200.mjs`, `stress-lore-split.mjs`)

| Measure | 105 entries | 400 entries | 1,200 entries |
|---|---|---|---|
| acceptLorebook | — | 140 ms | 542 ms |
| runLoreStudy (one synchronous call) | ~2.0 s total ingest | 18.9 s | **154.0 s** |
| Lore nominations, turn 1 | 638 | — | 3,056 |
| Sparse eligible / indexed | 105/105 | — | **1,200 / 512** (silent coverage cap) |
| Turn wall, host prepare → inject → complete (instant provider) | 413–591 ms | — | **3.1–3.9 s** |
| Brain preparation breakdown @1,200 | — | — | total 2,879 ms; OWNER_LORE 831; CORRECTIVE_RETRIEVAL 711; ~1.3 s unattributed |
| exportEvidence size / time | 1.9 MB / 161 ms | — | **20.7 MB / 2.8 s** |
| Largest UI reader | 223 KB | — | 219 KB (readLoreStatus 180 KB) |
| 10-entry source edit (re-accept + study) | 0.8 s | — | 17.4 s |
| Heap after load → after edit | 57 → 93 MB | — | 535 → **1,267 MB** |
| Peak process RSS | 339 MB | — | **1,546 MB** |

### 5.3 Turn-count, retention and queue behaviour

- Packet growth: about 225 tokens/turn; delivery failure at turn 22 (600-char replies) or turns 30–33 (60-char replies); then a permanent wedge (D8, D9).
- Recent-episode tail observed at 6, 12, 20 and 30 `ACTIVE_CONTINUITY` items; `CURRENT_SCENE` reached 15 KB at 30 items.
- Scene resource director: capacity 1, reserve 1. During generation, non-foreground Scene work gets 0 slots; POST_RESPONSE work is blocked while the foreground job holds the slot (`SKIPPED / SCENE_OBSERVATION_BLOCKED`).
- Recovery: a resource made UNAVAILABLE by one abort hadn't recovered 6 s later (the cooldown is 30 s, but nothing re-probes). A wedged chat didn't recover on CHAT_CHANGED.

**Not measured here:** browser long tasks, real provider latency, IndexedDB/SQLite persistence (none exists), and concurrent multi-provider pressure against live endpoints.

---

## 6. Production wiring matrix

| Producer → event/task | Dispatch | Execution | Validation | Destination | Owner decision | Persistence / invalidation | Downstream use | Status |
|---|---|---|---|---|---|---|---|---|
| ST `GENERATION_AFTER_COMMANDS` → `prepareNativeGeneration` | direct | in-process | selection guard | Native `runTurn` | — | none | seal → inject | **Works for `normal`; fails for swipe/regenerate/continue (D1); wedges after a failure (D9)** |
| User message → `registerNarrativeSource` | direct | deployment core registry | throws on duplicate | deployment core | — | never retired (D2) | Scene, Memory | Called; duplicate-hostile |
| Scene deterministic extractor | direct (`applyNativeScene`) | in-process | regex | Scene owner | auto-ingested, OBSERVED | none | Scene signal → planner | **Pre-empts semantic path (D5)** |
| Scene semantic `SCENE_OBSERVATION` | `resourceDirectorBridge.admit` | WorkerDirector (cap 1) → OpenAI-compatible | specialist normalizer | deployment Result Bus → Scene owner | explicit admission | cancel on supersede | next-turn Scene | **Works when the resource is healthy and the path isn't deterministic; disabled after one abort (D4)** |
| Scene signal → Native `observeScene` | direct | in-process | revision fence | Native core Hot Cognition | — | — | Query planner anchors | Works |
| Scene Fan-Out (`assembleSceneFanOutForNativeTurn`) | deployment brain | NativeSidecarSwarm | fences | Native Result Bus via `coreHandoff` | — | — | — | `ASSEMBLED`, `physicalExecutionCount 0` in traced turns: **registered, no physical work observed** |
| Lore accept/study (UI) | direct sync | in-process | owner | Lore owner | — | **none (D3)** | OWNER_LORE / sparse | Works when story-bound; synchronous 154 s at 1,200 (D10) |
| OWNER_LORE / OWNER_SPARSE_EXACT channels | Native retrieval | in-process | story scope | Candidate Bus | Truth | revision fence | RELEVANT_LORE | Works when bound; Truth labels everything CURRENT (D7) |
| Graph Walker (Lore/Memory/Scene providers) | Native retrieval | sync owner queries | stale fences | Candidate Bus | — | — | — | **Called; no traversal (D6)** |
| OWNER_MEMORY | Native retrieval | Historian | fences | Candidate Bus | Truth → HISTORICAL, not usable | — | — | **Called; result excluded for CURRENT intents** |
| DENSE_EMBEDDINGS / LATE_INTERACTION / HIERARCHY_RAPTOR / GRAPHRAG | registry | — | — | — | — | — | — | `UNAVAILABLE` (no vector resource); degrade cleanly |
| Precision | Native | deterministic | — | Gather | — | — | — | Executes (deterministic reference) |
| Jev (native) | cognitive choice | — | — | — | — | — | — | **No adapter; never invoked (D11)** |
| Jev (deployment) | deployment core / Scene ambiguity | resource director | owner adjudicator | Scene owner | — | — | — | Reachable only through Scene ambiguity |
| Context Seal → PromptPlan → `prepared.rendered` | Native | in-process | integrity receipt | `CHAT_COMPLETION_PROMPT_READY` `eventData.chat` splice | observed-host receipt | — | model request | **Works for chat-completion APIs only; text-completion APIs get no injection and wedge (D13)** |
| MESSAGE_RECEIVED → `completeTurn` → learning | Native | Native runtimeDirector | — | Memory mirror | Memory admission | none (D3); no invalidation (D2) | Hot tail (CURRENT_SCENE) | Works for `normal`; 0 settlements |
| POST_RESPONSE Scene | `applyNativeScene` | as above (DEFERRED) | — | BACKGROUND | Scene owner | — | next turn | Usually deterministic (D5) or BLOCKED (single slot) |
| Speculative warmer | deployment brain coordinator | pump | fences | — | — | — | — | Installed; **effect on native turns not traced (UNVERIFIED)** |
| Host EDIT/DELETE/SWIPE/CHAT_CHANGED | `#recordHostNarrativeEvent` | — | — | diagnostics row | — | — | — | **Recorded, never routed (D2)** |

---

## 7. Documentation found obsolete or conflicting

- README "Status 0.1-dev — blueprint phase" and PROJECT_PLAN "Current phase: Phase 0; Nexus integration may not proceed" vs. an installed extension (manifest `0.3.1-development-deployment`) running live injection on `main`.
- README and DEVELOPMENT_NEXUS_WORKING_GROUND: "Development-Nexus is the active workspace; main is the preserved baseline." The packaged active code is `main`.
- DEVELOPMENT_DEPLOYMENT_DEMO: "do not merge Development-Deployment into main." `main` contains `src/deployment/**` and the manifest loads it. Its rehearsal command crashes (D12).
- NATIVE_BRAIN_COMPLETION_WAVE_HANDOFF: says `main` injects a PromptPlan through `setExtensionPrompt`. Current `main` uses the `runTurn` generate callback plus `CHAT_COMPLETION_PROMPT_READY` whenever a native brain is attached (always, via `index.js`).
- WORKER1_BRAIN_CAUSAL_RECEIPT_CONTRACT: records "layered scatter" as proposal-only. Traced turns do show skipped/deferred jobs, so that note is partly outdated; not fully verified.
- `ci/known-main-failures-9eef91c.txt` is out of date (5 entries pass, 35 unlisted failures).
- Blueprint/Board Map durability (#20), batching (#18) and reload-preservation statements aren't met by the installed assembly (D3, D10).

---

## 8. Proposed repairs (not applied)

In rough order of leverage. Each should get a regression test through the installed session harness, not only owner-level tests.

1. **D9/D13:** clear `nativeRuns` in a `finally` / on `runTurn` rejection, and make `#expireNativePending` iterate `nativeRuns` as well. Either add a `GENERATE_AFTER_COMBINE_PROMPTS` text-prompt adapter, or fail fast before preparation when the active API isn't chat completion.
2. **D8:** make the recent-episode tail budget-aware (bounded protected floor, or tail compaction into episodes) so protected content can't exceed the profile budget. Surface budget failures to the operator.
3. **D1:** treat regenerate/swipe/continue as re-preparation of an existing source revision (idempotent `importSource`, or a separate generation identity), and emit SWIPE_SELECTED / REGENERATE into the NarrativeFeed.
4. **D2:** route MESSAGE_EDITED/DELETED/SWIPED/SWIPE_DELETED/CHAT_CHANGED into the Scene NarrativeFeed and Core/Memory source retirement.
5. **D4:** don't score intentional cancellation (`PROVIDER_ABORTED` from supersession or operator cancel) as a health failure; add a cooldown-expiry re-probe; don't cancel in-flight work only to skip its replacement.
6. **D5:** narrow `explicit` to genuinely unambiguous evidence (explicit travel verbs or scene breaks). Don't let atmosphere words or "at/near + Name" pre-empt semantic extraction, and don't record regex locations as OBSERVED at confidence 1.
7. **D6:** import owner entity identities (Lore entities and aliases) into the Native identity registry on study/attach, and normalize anchors through `normalizeRef` before traversal. Add query-text entity linking against that registry.
8. **D7/D11:** give Truth temporal ordering for authored lore (`at`/`claimAt`) and conflict sets; register the Jev adapter on the native core; report `unavailable:true` when no adapter exists.
9. **D10:** count unrelated artifacts without cloning (`lore-study-runtime.js:151`); run study through the Runtime Batch Engine in yielding slices; cap export sizes.
10. **D3:** wire `Area52PersistNativeBrain` and the owner snapshots to a host store (SillyTavern chat metadata or IndexedDB), including story-binding restore.
11. **D12:** normalize string atmosphere in `observeScene` (or fix the demo/test inputs), then refresh `ci/known-main-failures`.

---

## 9. Live acceptance checklist (installed SillyTavern + configured providers)

Deterministic evidence above doesn't substitute for any of these.

1. Record the installed commit and SillyTavern version. Confirm a chat-completion API is in use; on a text-completion API, confirm D13.
2. **Long-session gate:** run 40+ ordinary turns in one chat. Record the turn at which Area-52 messages stop appearing in Prompt Inspector, the `errors[]` entries, and whether Send continues without Area-52 (D8/D9).
3. **Swipe / regenerate / continue:** Prompt Inspector shows Area-52 content for each (D1).
4. **Delete / edit:** delete an assistant message containing a unique word; the next request must not contain it (D2).
5. **Reload:** reload the page mid-story. Confirm what survives: Lore READY state, story binding, Memory, Scene (D3).
6. **Scene resource resilience:** with GLM connected, Send again while a Scene extraction is in flight. Then read Connections state and `pipeline.sceneObservation.runtime` in a fresh Diagnostics export (D4, H1). This export is the missing evidence for message 436.
7. **Scene quality:** on a real story, compare the admitted Scene location and cast against the prose over 10 turns (D5), and record how many turns used `SEMANTIC_COGNITIVE_RESOURCE` vs `DETERMINISTIC_SCENE_OWNER`.
8. **Graph:** confirm `readGraphTraversal` reports anchors **and** a nonzero `traversedEdgeCount` on a turn with a known cast (D6).
9. **Lore:** accept a real Lorebook from the story, confirm `loreSync SYNCED`, then switch chats and back and re-check (D7).
10. **1,200-entry study in the browser:** time "Run study" and watch UI responsiveness and long tasks (D10). Then measure per-turn preparation and the Diagnostics export size.
11. **Optional providers:** Jev on an explicitly ambiguous turn (expect native SKIP_JEV today, D11); separate Vectoring; a forced provider failure (with vs. without recovery).
12. The existing `docs/AREA52_LIVE_TEST_CHECKLIST.md` items remain in force.

---

## Appendix — files in this audit package

- `harness/host.mjs`: fake SillyTavern host replaying the real event order; builds the same objects `index.js` does, without DOM mounting.
- `harness/repro-*.mjs`, `probe-*.mjs`, `trace-*.mjs`, `stress-*.mjs`: reproducers and measurements referenced above.
- `results/verification.txt`: clean-process re-run of every reproducer used for D1, D2, D4–D9 and D11.
- `results/base2_rows.json`, `results/base2_fails.tsv`: per-file baseline results and failing test names.
- `results/turn-trace-bound.json`: full native turn record for the story-bound golden-lore turn.
