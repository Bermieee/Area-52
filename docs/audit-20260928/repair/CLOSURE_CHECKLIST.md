# Closure checklist: installed-architecture repair (branch `repair/installed-architecture`)

Scope: close the repair started in the audit of 2026-09-28 without expanding it. Guardrails kept throughout: no test weakened to pass (each changed expectation cites the later deliberate contract and, where possible, adds a stronger assertion); every performance change is output-preserving and pinned by an equivalence test; owner authority never inferred; Jev advisory only; nothing merged. Evidence is MOCK-HARNESS (fake SillyTavern host, fake providers, fake or in-memory storage) unless stated; **no row below is live acceptance**.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Baseline failures (48 at `98a4e43`) | CLOSED: all pass | full sweeps on `cadac98` and the final head (`FINAL_HANDOFF.md`) |
| 2 | Checkpoint growth (O8, lossless encodings) | CLOSED for the encodings: round-trip, determinism, reserved markers, torn parts, v1 compatibility; two lossy paths fixed | `repair-followup-brain-snapshot-parts` 8/8 (6da77e1) |
| 3 | Assembly drift | CLOSED: every unexpected path reviewed with provenance, diff and covering tests; verifier PASS | `ASSEMBLY_DRIFT_REVIEW.md` (closure addenda 1-4) |
| 4 | Owner decisions O2, O9 | DECIDED by the owner (2026-09-29) and implemented / documented | O2: scheduling-lane rule kept; O9: Wave 16/17 contracts amended, negative test |
| 5 | Heap spike (1,099 MB sample) | CLOSED: not a leak (raw heapUsed with uncollected garbage); retained heap flat | `repeat-audit/round4/probe-heap-lore1200.mjs.txt` |
| 6 | Event-loop stalls at 1,200 entries | IMPROVED: turn 3.3 s to 0.76-0.93 s; batched study longest stall 804 to 254 ms (index built aside, fenced, published atomically); operator re-accept 5.5 s to 0.75 s | `round5/stress-lore1200`, `round5/probe-batched-stalls` |
| 7 | Correctness defects found on the way | FIXED: Lore channel evicted its own kept evidence at scale; cooldown recovery survived `session.destroy()` | ledger, closure part 2 |
| 8 | Persistence failure modes (quota, unavailable/private, multi-tab, corrupt manifest) | FIXED + TESTED (fake backends): fail visibly, last valid checkpoint kept, recoverable data never deleted; a stale tab can no longer overwrite a newer checkpoint (refused, preserved, reported) | `repair-followup-storage-adapter` 20, `repair-followup-installed-persistence` 13 |
| 9 | Jev consumption (D11) | DONE through the installed wiring (fake HTTP provider): advice only with a connected JEV resource; next conflicting turn gets a sealed, labelled ADVISORY note in UNRESOLVED_EVIDENCE (owner-admitted, freshness re-checked, separate from canonical facts, earlier seal untouched); fallback never advice | `repair-followup-native-jev-advisory` 20 |
| 10 | Final full suite on the combined head | DONE: 242 files, 2,040/2,040 pass, 0 failing (code head 854aa87, run on 91815e2, docs-only difference) | `repeat-audit/round5/sweep-final-91815e2-status.tsv` |
| 11 | Repeat audit | DONE: 24/24 probes exit 0 (round 5); results in `FINAL_HANDOFF.md` | `repeat-audit/round5/` |
| 12 | Push / PR | NOT DONE from the session: no repository access; commits handed back as a git bundle; PR body text in `PR_BODY.md` | - |
| 13 | Merge | NOT DONE, by instruction | - |

## Residual limits (recorded, not in this repair's scope or needing a decision)
- Operator re-accept of an edited 1,200-entry Lorebook still refreshes ontology and hierarchy inline (~0.75 s): authoring, planners and the summary builder read them, so they are not deferred. The retrieval index is now built aside, fenced and published atomically.
- The synchronous one-shot `ingestLorebook` (accept + full study) remains for `initialLorebook` and rehearsal; not an operator path.
- A stale tab resolves its conflict by reloading; preserved conflict checkpoints are recoverable through the adapter (`loadWriteConflict`) but there is no UI to merge them.
- Open owner decisions carried over: O1, O3, O6, O8 (further checkpoint work), D7 confirmations.
- Every live-acceptance item in `FINAL_HANDOFF.md` remains UNVERIFIED-LIVE.
