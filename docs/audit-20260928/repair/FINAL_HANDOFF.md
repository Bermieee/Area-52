# Final handoff: installed-architecture repair (branch `repair/installed-architecture`)

Verified code head: `c749e0e` (later commits are documentation only). Node 22.22.2. Not merged to `main`; do not merge without an explicit instruction. Evidence is MOCK-HARNESS (fake SillyTavern host, fake providers, in-memory or fake storage) unless a row says otherwise. **Nothing here is live acceptance.**

## Verification at the exact head (sweep g7)
- 241 test files, each run on its own: **17 failing files, 32 failing tests**; every failing name is in the audit baseline list (`audit-20260928/results/base2_fails.tsv`, 48 failing tests at `98a4e43`); **no new failure**. 16 baseline failures are fixed.
- Assembly verifier `scripts/verify-development-deployment.mjs`: **FAIL by design** on exactly 8 withheld paths (`ASSEMBLY_DRIFT_REVIEW.md`).
- Stress and probes (raw in `repeat-audit/round3/`): swipe / regenerate / continue inject 3/2/3 with no errors; no failing turn in 60; `stress-lore1200` study 12.9 s, turn wall 2.8-3.7 s, routine export 170 KB (was 20.7 MB); `stress-lore1200-batched` 1200/1200 READY, longest stall 520 ms. One unexplained single sample: `heapMB` read 1099 after the 10-entry edit in `stress-lore1200` (earlier runs 527-668); not investigated.
- The remaining 32 failures are the baseline CONTRACT-DRIFT / UI-DRIFT / unclassified classes in `BASELINE_FAILURE_INVENTORY.md`, plus O1/O2. They are not regressions and not fixed.

## What is done (code, tests, ledger rows)
| Area | Result |
|---|---|
| D1, D9, D13 chat lifecycle (swipe, wedge, text completion) | fixed (fake host) |
| D2 deleted/edited text, D8 delivery at turn 22, H3 turn retention | fixed / improved |
| D4, D5 abort scoring, Scene POST_RESPONSE retention | fixed; deferred obligations run when capacity returns |
| D6, identity isolation | story-scoped identities and graph evidence; no foreign-story exposure |
| D3 persistence | installed storage adapter (IndexedDB, localStorage fallback), one Brain per story, Scene owner restore, atomic generations, checksums, interrupted-write recovery; checkpoints rewrite only the changed tail and store repeated large sub-trees once (newest turn part 2.62 MB to 1.30 MB), seal and packet unchanged |
| D10 Lore study | yielding, checkpointed Runtime batches; complete coverage; incremental edits |
| Read / export costs | routine export 20.7 MB to 170 KB via reference surfaces |
| D7 temporal / conflict rules | R1-R4 plus owner-revised event identity (alias evidence), continuity scope, compatibility table, POSSIBLE vs ESTABLISHED conflicts, inspector membership; generic tests on two unrelated stories |
| D11 native-path Jev | optional NEXT_TURN advisory on ESTABLISHED conflict sets through a Runtime obligation, the documented TEMPORAL adapter, fenced at request, admission and consumption; seal untouched |
| Assembly drift | 31 paths reviewed individually; 23 approved, 8 withheld |

## Remaining gaps (honest)
1. **Live acceptance is entirely open** (checklist below).
2. **Owner decisions still open**: O1 retirement policy without a revision oracle; O2 `DEEP_BACKGROUND` (scheduling class vs profile class, D14); O3 quiet/impersonate context; O5 partly (advisory built, live Jev unproven); O6 batch-engine and diagnostic payload bounds; O8 checkpoint growth (newest unsettled turn record about 1.3 MB and growing with history; cross-turn references, by-reference storage of a settling turn and Work Ledger compaction each need authorisation).
3. **D7 rule questions for the owner**: confirm the property table scope (state, fate, location, owner, possessor) and the verb/clause grammar; the legacy engine rules that hard-code `burned` / `destroyed-in-fire` should be retired once their fixtures are re-baselined; only claims with an applicability (state and event-shaped fate claims) take part today, owner/possessor/location claims from the old rules do not; conflict alternatives use the compatibility table only for listed pairs.
4. **Assembly**: 8 withheld paths (wave13 operator adapters/surfaces/floating navigation, wave13 CSS and test, wave6 front face and CSS, `resource-connections.js`) fail their own tests or are ungated; the verifier stays red until the UI/contract owners resolve them.
5. **Jev**: only the TEMPORAL adapter and Lore ESTABLISHED conflicts; POSSIBLE conflicts and Scene/Memory ambiguities are not routed; the choice controller reports the advice but nothing consumes the classification beyond the report; the deterministic local Jev fixture is deliberately not treated as advice.
6. **Persistence gaps**: multi-tab behaviour, quota errors and private-mode failures are untested; Atmosphere tracker state restarts; owner parts are stored once for all stories.
7. Known limitation: `removed-before-E` and `survived-E` are handled as compatible only through the listed fate table; other fate pairs assert no conflict.

## Live acceptance checklist (not done; each needs an installed SillyTavern, a browser, or a provider)
1. Install the extension in real SillyTavern; confirm `index.js` boots through `createInstalledDevelopmentDeploymentSession`, the UI mounts, and no console errors appear on start.
2. Real browser storage: run 10+ turns, reload the page, confirm the Brain, Lore binding and Scene state restore; repeat in a private window, with storage cleared, with quota nearly full, and with two tabs open on the same chat.
3. Story isolation in the UI: open two chats with different lorebooks, switch between them, and confirm no entity, Lore fact or graph edge from one appears in the other.
4. Delete, edit, swipe, regenerate and continue messages in a real chat while the extension is on and after a reload with it off; confirm retired text is not delivered.
5. Chat-completion and text-completion backends: confirm exactly one context insertion per generation and no wedge after a provider error.
6. Lore study on a real lorebook of about 1,000 entries: the UI stays responsive, Run study can be aborted and resumed, edits re-study only the changed entries.
7. Diagnostics Center: routine export size, Lore status, Jev advisory reader and conflict membership display correctly (the operator UI was not changed; wave13 UI drift is open).
8. Jev: with an operator-configured Jev resource connected, confirm an advisory is requested only for an established conflict, a stale or fallback result is never shown as advice, and disconnecting the resource stops requests.
9. Providers: Sidecar, Vectoring and Jev failure, timeout and cooldown recovery against real endpoints (abort must not mark a resource unavailable).
10. Long session: 100+ turns on a real backend, watching memory use, checkpoint size and per-turn latency.
11. Re-run the assembly verifier after the UI/contract owners resolve the 8 withheld paths.

## Pointers
`REPAIR_LEDGER.md` (every repair, command and result, D7 and D11 sections), `ASSEMBLY_DRIFT_REVIEW.md`, `TRUTH_JEV_TRACE.md` (original trace; the rules were then revised by the owner), `REPEAT_AUDIT.md`, `RESUME.md`. The duplicate root `audit-20260928/` copy was left untouched.
