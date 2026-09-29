# Final handoff: installed-architecture repair (branch `repair/installed-architecture`)

Verified code head: **`8506fb7`** (later commits are documentation only; the final sweep and probes ran on `83cb9a8`, whose code is identical). Node 22.22.2. **Not pushed from the session** (no repository access; commits are handed back as a git bundle) and **not merged**; do not merge without an explicit instruction. Evidence is MOCK-HARNESS (fake SillyTavern host, fake providers, fake or in-memory storage) unless a row says otherwise. **Nothing here is live acceptance.**

## Verification at the exact head
- **Full suite**, every `tests/*.mjs` run on its own (242 files, 2 at a time, 30 min cap per file): **2,029 / 2,029 pass, 0 failing files, 0 cancelled**. All 48 baseline failures at `98a4e43` pass. Status per file: `repeat-audit/round4/sweep-final-83cb9a8-status.tsv`.
- **Assembly verifier**: **PASS**; every unexpected path reviewed with provenance, diff and covering tests (`ASSEMBLY_DRIFT_REVIEW.md`, closure addenda 1-3).
- **Repeat audit** (raw: `repeat-audit/round4/`, 24/24 probes exit 0, head recorded in each file): swipe / regenerate / continue inject 3/2/3, no errors; no failing turn in 60; abort keeps the Scene resource READY; quiet generation injects nothing and does not wedge; `trace-turn*` now run (output directory created). At 1,200 Lore entries: turn wall **0.81-1.38 s** (round 3: 2.8-3.7 s), channel nominations 48 (was 3,056), routine export 171 KB; batched study 1200/1200 READY, **longest stall 414 ms** (same-method before: 804 ms); operator re-accept of 10 edited entries **1.09 s** synchronous (was 5.5 s) then batched re-study (longest stall 410 ms); retained heap after GC **135-181 MB, flat** over repeated edits (the 1,099 MB sample was raw heap with uncollected garbage).

## What is done
| Area | Result |
|---|---|
| D1, D9, D13 chat lifecycle; D2 retired text; D8 delivery; H3 retention | fixed (fake host) |
| D4, D5 abort scoring, Scene retention | fixed; cooldown recovery now also cancelled on `session.destroy()` |
| D6 identity isolation | story-scoped identities and graph evidence |
| D3 persistence | installed storage adapter, one Brain per story, Scene restore, atomic generations, checksums; **failure modes**: quota (last valid checkpoint kept, attempt's parts freed), unavailable / private mode (IndexedDB probed before use, localStorage fallback, UNAVAILABLE reported), multi-tab (Web Locks, writer-unique keys, safe collection, concurrent writer detected), corrupt manifest (backup manifest, quarantine, never EMPTY, recoverable data never collected) |
| O8 checkpoint encodings | lossless table + string-table encodings with round-trip, determinism, reserved-marker, torn-part and v1 tests |
| D10 Lore study and stalls | batched Runtime study; turn path and re-accept costs reduced as above, each change pinned by an equivalence test |
| Lore channel evidence | fixed: kept candidates' owner evidence was evicted at scale (26/96 to 48/48); `includeNavigation:false` proven not to change retrieval, freshness, Truth or conflict evidence |
| D7 temporal / conflict rules | R1-R4 with owner revisions |
| D11 native-path Jev | NEXT_TURN advisory on ESTABLISHED conflicts through a Runtime obligation; consumption proven through the installed wiring with a fake HTTP provider (advice only with a connected JEV resource, PRESERVE_UNRESOLVED next turn, fallback never advice, disconnect stops requests) |
| O2 / O9 | decided by the owner 2026-09-29 and implemented / documented |
| Assembly drift | all paths reviewed; verifier PASS |

## Remaining gaps (honest)
1. **Live acceptance is entirely open** (checklist below).
2. **Owner decisions still open**: O1 retirement policy without a revision oracle; O3 quiet/impersonate context; O6 batch-engine and diagnostic payload bounds; O8 further checkpoint growth work (cross-turn references, Work Ledger compaction); D7 rule confirmations (property table, grammar, legacy rules).
3. **Policy questions raised in this round**: should a stale tab be blocked from overwriting a newer generation (today: last writer wins, detected and reported)? Should a Jev classification ever shape the narrator's context (today: reported only)?
4. **Residual synchronous chunks at 1,200 entries**: retrieval index build (~0.4 s; fix is build-aside-and-swap) and the inline rebuild on operator re-accept (~1.1 s, keeps retrieval fail-closed right after an edit). The one-shot synchronous `ingestLorebook` remains for `initialLorebook` and rehearsal only.
5. **Jev scope**: only the TEMPORAL adapter and Lore ESTABLISHED conflicts (owner rule); POSSIBLE conflicts and Scene/Memory ambiguities are not routed.
6. Atmosphere tracker state restarts on reload; owner parts are stored once for all stories.

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
11. UI owners confirm the wave13/wave6 UI behaviour whose drift was approved as reviewed integration state (`ASSEMBLY_DRIFT_REVIEW.md`, closure addendum).

## Pointers
`CLOSURE_CHECKLIST.md`, `REPAIR_LEDGER.md` (every repair, command and result), `ASSEMBLY_DRIFT_REVIEW.md`, `REPEAT_AUDIT.md`, `RESUME_ROUND4.md`, `PR_BODY.md` (text for PR #324), `TRUTH_JEV_TRACE.md`. Probes: `audit-20260928/harness/` (new: `probe-heap-lore1200.mjs`, `probe-batched-stalls.mjs`).
