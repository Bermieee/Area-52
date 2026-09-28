# Area-52 repair ledger

Branch: repair/installed-architecture, base 98a4e438e995bdc62038076c5f97addaf2a3d0bd (origin/main unchanged at start, 0 new commits). Push unavailable from session (proxy 403); delivery = bundle + patches.
Environment: Node 22.22.2 (CI major), fake-host installed-session harness unless labelled otherwise.

| Wave | Finding | Commit | Evidence | Status |
|---|---|---|---|---|
| 0 | D12 atmosphere TypeError | 1cc3855 | tests/repair-wave0-atmosphere.test.mjs 3/3; deployment-brain.integration 13/13 (was 3/13); development-deployment-demo.mjs rc=0 (was crash) | FIXED (fake host) |
| 0 | FT002 stale fixture (3 of 4) | 559c47e | worker1-scene-ft002-assembly 3/4 (was 0/4); scenario 8 real fence mismatch carried to Wave 3 | FIXED (fixture) |
| 0 | Baseline classification | — | w0/BASELINE_FAILURE_INVENTORY.md; new D14 (DEEP consolidation resourceClass); w0/assembly-drift-provenance.md | DONE |
| 1 | D1 swipe/regenerate/continue | 0c4f181 | repair-wave1 test 1; harness/repro-swipe: injected 2/2/2, no errors (was 0/0/0 + NATIVE_PREPARE) | FIXED (fake host) |
| 1 | D9 wedge after failed prepare/completion/provider error | 0c4f181 | repair-wave1 tests 3,4,5 (incl. switch-away/back, stale cleanup cannot erase newer run); probe-turn-limit2: "already pending" gone (budget failure remains → Wave 2) | FIXED (fake host) |
| 1 | D13 text-completion backends | 0c4f181 | repair-wave1 test 6 (inserted once before current user msg, OBSERVED_MATCH receipt, learned); test 7 no duplicate on chat completion | FIXED (fake host); live text backend UNVERIFIED |
| 1 | Decision: host quiet/impersonate excluded (no doc defines them) | 0c4f181 | repair-wave1 test 2 | DECISION — confirm |
| 2 | D8 packet growth / delivery failure at turn 22 | c73fec0 + Wave 2 finalize | repair-wave2-long-session 100 turns ×2 pass: CURRENT_SCENE flat ~634-639 tok, plan ≤3.8k/4096, USER_INPUT current, retirement receipt present; Lore still delivered | FIXED (fake host); regression sweep clean, see Sweep log |
| 2 | H3 turn retention | WIP | 60 turns: 27 MB retained (was 375 MB @100), compacted avg 110 KB, snapshot 12.6 MB (was 382 MB); residual: 4 full records ~5.2 MB each (candidate duplication in published) | IN PROGRESS |
| 2 | Generation lifecycle Diagnostics | WIP | nativeBrainIntegration.generationLifecycle; repair-wave1 test 8 | IN PROGRESS |

| 2 | Installed path exposes Core retirement receipt on pending row (baseline #25 scene-clapperboard-handoff) | Wave 2 finalize commit | `pending.contextRetirement` now carries `meta.contextRetirement` (already-redacted receipt from Native Brain; no semantics change). scene-clapperboard-handoff 13/13 (was 12/13) | FIXED (fake host) |
| 2 | Baseline #31 worker1-context-trust-delivery (retirement proof) | — | Root cause traced: `context-retirement-policy.js` treats a policy with no source-revision oracle as "every revision stale" (fail closed). Test constructs a policy without an oracle. Production (`native-brain.js:164`) always supplies one. NOT changed: making the fence opt-in would weaken a freshness check to satisfy a test. | OPEN DECISION O1 |

## Sweep log (Node 22.22.2, mock harness, `node --test <file>` per file, 4 parallel)
- Full suite at commit 92b0b46 (+ uncommitted clapperboard fix): 223 files, 1889 tests, 1854 pass, 35 fail (baseline 48 fail / 1827 pass, 219 files). Every failing name is in `audit-20260928/results/base2_fails.tsv`; no new failing file, no new failing test name. 13 fewer failures = deployment-brain.integration x10 (Wave 0), worker1-scene-ft002-assembly x3 (Wave 0).
- After the clapperboard fix, re-ran the 66 files matching native|deployment|clapperboard|repair|worker1|scene-|wave12|context|delivery|generation|hot-cog: only the 7 baseline-failing files still fail (client-repair-wave2, scene-completion-wave4-gaps, worker1-brain-lifecycle-causal-wave, worker1-context-trust-delivery, worker1-scene-event-spine, worker1-scene-ft002-assembly, worker1-scene-prefetch-trigger). repair-wave2-long-session passes but takes ~425 s (2 x 100 turns): consider a smaller CI variant.

## Open decisions (not resolved by me)
- **O1** retirement policy with no revision oracle (above). Options: fix the test fixture to supply an oracle, or state in the contract that the fence is opt-in.
- **O2 (D14) `DEEP_BACKGROUND`**: docs evidence. `CAPABILITY_PROFILE_REGISTRY.md` lists `resourceClass` and `latencyClass` as profile fields but defines no value vocabulary; it says Runtime owns worker selection. `CONTINUOUS_CONSOLIDATION_WORKER.md` and `COGNITIVE_RUNTIME_FABRIC_WAVE2_ACCEPTANCE.md` describe DEEP as a Runtime scheduling lane (L3 Deep, borrow idle capacity via Resource Governor lease, yield/park/resume); the task also carries `resourceHints {borrowIdleCapacity, foregroundPreemptible}`. Nothing documents a profile being *typed* DEEP_BACKGROUND or the Connections UI setting it. Evidence leans scheduling class, but no document states it. Not changed. Owner must decide before D14 is fixed (likely: stop using `resourceClass` as a strict profile filter for DEEP, or add it to profile/Connections).
- **O3** host quiet/impersonate generations excluded from context (Wave 1 decision, unchanged).

