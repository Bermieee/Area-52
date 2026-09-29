# Final handoff: installed-architecture repair (branch `repair/installed-architecture`)

Verified code head: **`854aa87`** (later commits are documentation / assembly overlay only; the final sweep and probes ran on `91815e2`, whose code is identical). Node 22.22.2. **Not pushed from the session** (no repository access; commits are handed back as a git bundle) and **not merged**; do not merge without an explicit instruction. Evidence is MOCK-HARNESS (fake SillyTavern host, fake providers, fake or in-memory storage) unless a row says otherwise. **Nothing here is live acceptance.**

## Verification at the exact head
- **Full suite**, every `tests/*.mjs` run on its own (242 files, 2 at a time, 30 min cap per file): **2,040 / 2,040 pass, 0 failing files, 0 cancelled**. All 48 baseline failures at `98a4e43` pass. Status per file: `repeat-audit/round5/sweep-final-91815e2-status.tsv`.
- **Assembly verifier**: **PASS** (`ASSEMBLY_DRIFT_REVIEW.md`, closure addenda 1-4).
- **Repeat audit** (raw: `repeat-audit/round5/`, 24/24 probes exit 0): swipe / regenerate / continue inject 3/2/3, no errors; no failing turn in 60; abort keeps the Scene resource READY; quiet generation does not wedge. At 1,200 Lore entries: turn wall **0.76-0.93 s** (audit: 2.8-3.7 s); batched study **longest stall 254 ms** (same-method before this repair round: 804 ms); operator edit: Accept **0.75 s** synchronous (was 5.5 s), longest stall 837 ms, index rebuilt aside and published atomically; retained heap after GC **~182 MB, flat** over repeated edits.

## What is done
| Area | Result |
|---|---|
| D1, D9, D13 chat lifecycle; D2 retired text; D8 delivery; H3 retention | fixed (fake host) |
| D4, D5 abort scoring, Scene retention | fixed; cooldown recovery now also cancelled on `session.destroy()` |
| D6 identity isolation | story-scoped identities and graph evidence |
| D3 persistence | installed storage adapter, one Brain per story, Scene restore, atomic generations, checksums; **failure modes**: quota (last valid checkpoint kept, attempt's parts freed), unavailable / private mode (IndexedDB probed before use, localStorage fallback, UNAVAILABLE reported), corrupt manifest (backup manifest, quarantine, never EMPTY, recoverable data never collected), **multi-tab**: a stale tab is refused (STALE_WRITER) instead of overwriting a newer checkpoint (Web Locks / atomic IndexedDB compare-and-set / read-back), its checkpoint preserved as a conflict record and reported until reload |
| O8 checkpoint encodings | lossless table + string-table encodings with round-trip, determinism, reserved-marker, torn-part and v1 tests |
| D10 Lore study and stalls | batched Runtime study; retrieval index built aside with host turns, fenced (records built from moved revisions never served; truth hints from the owner's current resolution) and published atomically; turn path and re-accept costs reduced as above, each change pinned by an equivalence test |
| Lore channel evidence | fixed: kept candidates' owner evidence was evicted at scale (26/96 to 48/48); `includeNavigation:false` proven not to change retrieval, freshness, Truth or conflict evidence |
| D7 temporal / conflict rules | R1-R4 with owner revisions |
| D11 native-path Jev | NEXT_TURN advisory on ESTABLISHED conflicts through a Runtime obligation and the Lore owner's review; the next conflicting turn's prompt carries a sealed, labelled ADVISORY ONLY note in UNRESOLVED_EVIDENCE next to the alternatives (freshness re-checked at attachment, separate from canonical facts, alternatives stay unresolved, earlier seal untouched); advice only with a connected JEV resource, fallback never advice, disconnect stops requests |
| O2 / O9 | decided by the owner 2026-09-29 and implemented / documented |
| Assembly drift | all paths reviewed; verifier PASS |

## Remaining gaps (honest)
1. **Live acceptance is entirely open** (checklist below).
2. **Owner decisions still open**: O1 retirement policy without a revision oracle; O3 quiet/impersonate context; O6 batch-engine and diagnostic payload bounds; O8 further checkpoint growth work; D7 rule confirmations.
3. **Remaining performance work**: the operator re-accept rebuilds ontology and hierarchy inline (~0.75 s at 1,200 entries). This is remaining performance work, not an architectural necessity: the ontology and hierarchy are still rebuilt synchronously because this pass only built the fencing and atomic publication for the retrieval index; their readers (authoring, planners, summary builder) would need the same treatment (build aside, fence, publish atomically) before those rebuilds could yield. The one-shot `ingestLorebook` remains for `initialLorebook` and rehearsal only.
4. **Conflicts across tabs** are resolved by reload; preserved conflict checkpoints are recoverable through the adapter, with no merge UI.
5. **Jev scope**: only the TEMPORAL adapter and Lore ESTABLISHED conflicts (owner rule); POSSIBLE conflicts and Scene/Memory ambiguities are not routed.
6. Atmosphere tracker state restarts on reload; owner parts are stored once for all stories.

## Live acceptance checklist (not done; each needs an installed SillyTavern, a browser, or a provider)
1. Install the extension in real SillyTavern; confirm `index.js` boots through `createInstalledDevelopmentDeploymentSession`, the UI mounts, and no console errors appear on start.
2. Real browser storage: run 10+ turns, reload the page, confirm the Brain, Lore binding and Scene state restore; repeat in a private window, with storage cleared, with quota nearly full, and with two tabs open on the same chat (the stale tab must report a conflict and never overwrite the newer checkpoint).
3. Story isolation in the UI: open two chats with different lorebooks, switch between them, and confirm no entity, Lore fact or graph edge from one appears in the other.
4. Delete, edit, swipe, regenerate and continue messages in a real chat while the extension is on and after a reload with it off; confirm retired text is not delivered.
5. Chat-completion and text-completion backends: confirm exactly one context insertion per generation and no wedge after a provider error.
6. Lore study on a real lorebook of about 1,000 entries: the UI stays responsive, Run study can be aborted and resumed, edits re-study only the changed entries.
7. Diagnostics Center: routine export size, Lore status, Jev advisory reader and conflict membership display correctly (the operator UI was not changed; wave13 UI drift is open).
8. Jev: with an operator-configured Jev resource connected, confirm an advisory is requested only for an established conflict, reaches the next conflicting prompt only as the labelled ADVISORY note, a stale or fallback result is never shown as advice, and disconnecting the resource stops requests.
9. Providers: Sidecar, Vectoring and Jev failure, timeout and cooldown recovery against real endpoints (abort must not mark a resource unavailable).
10. Long session: 100+ turns on a real backend, watching memory use, checkpoint size and per-turn latency.
11. UI owners confirm the wave13/wave6 UI behaviour whose drift was approved as reviewed integration state (`ASSEMBLY_DRIFT_REVIEW.md`, closure addendum).

## Pointers
`CLOSURE_CHECKLIST.md`, `REPAIR_LEDGER.md` (every repair, command and result), `ASSEMBLY_DRIFT_REVIEW.md`, `REPEAT_AUDIT.md`, `RESUME_ROUND4.md`, `PR_BODY.md` (text for PR #324), `TRUTH_JEV_TRACE.md`. Probes: `audit-20260928/harness/` (new: `probe-heap-lore1200.mjs`, `probe-batched-stalls.mjs`).
