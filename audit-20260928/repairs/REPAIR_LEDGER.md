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
| 2 | D8 packet growth / delivery failure at turn 22 | WIP (see git log) | repair-wave2-long-session 100 turns ×2 pass: CURRENT_SCENE flat ~634-639 tok, plan ≤3.8k/4096, USER_INPUT current, retirement receipt present; Lore still delivered | IN PROGRESS — broad regression pending |
| 2 | H3 turn retention | WIP | 60 turns: 27 MB retained (was 375 MB @100), compacted avg 110 KB, snapshot 12.6 MB (was 382 MB); residual: 4 full records ~5.2 MB each (candidate duplication in published) | IN PROGRESS |
| 2 | Generation lifecycle Diagnostics | WIP | nativeBrainIntegration.generationLifecycle; repair-wave1 test 8 | IN PROGRESS |

RESUME POINT: rerun broad Wave 2 regression (/tmp/w2files.txt list = tests matching native|worker1|deployment|clapperboard|context|hot-cognition|wave4|wave10|adaptive|wave12|wave3|delivery|trust|prompt|integration-wave4|knowledge|main-owner|workers-1-4|demo-vis|generation) in background chunks; then finalize Wave 2 commit, then Wave 3 (D2 + FT002 scenario-8 fence mismatch).
