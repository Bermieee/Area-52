# Repeat audit after the installed-architecture repair

Branch `repair/installed-architecture` (base `main @ 98a4e438`), Node 22.22.2, same sandbox class as the original audit.
Raw output: `repeat-audit/verification-after.txt` (harness scripts in `../harness/`, plus three story-bound variants `probe-bound-*.mjs`).

## Evidence labels
- **MOCK-HARNESS** = fake SillyTavern host (real installed session objects, SillyTavern's event order), mocked providers, synthetic data.
- **UNVERIFIED-LIVE** = needs installed SillyTavern, a live provider or a browser. **Nothing below is a live acceptance claim.** Every item in `AUDIT_REPORT.md` section 9 (live checklist) is still open.

## Findings
| # | Audit result | Now (MOCK-HARNESS unless stated) | Status |
|---|---|---|---|
| D8 | Delivery fails at turn 22 (packet +225 tok/turn) | `probe-turn-limit2` LEN=600: no failing turn in 60; `repair-wave2-long-session` 2 x 100 turns: CURRENT_SCENE flat, plan within budget | FIXED |
| D9 | One failed prepare wedges the chat until reload | no "already pending"; CHAT_CHANGED round trip injects again | FIXED |
| D1 | Swipe/regenerate/continue: 0 injected, `Source already exists` | injected 3/2/3, no errors | FIXED |
| D13 | Text-completion backends: no context, wedge | delivered once before the current user message; live text backend UNVERIFIED-LIVE | FIXED (mock) |
| D2 | Deleted/edited/swiped text still delivered | `probe-memory2` prints nothing (deleted token gone); edit and swipe deliver new text only; sources retired with history preserved | FIXED |
| D4 | One abort makes the Scene resource UNAVAILABLE, no recovery | resource stays READY after supersession; replacement FOREGROUND job QUEUED (was SKIPPED); COOLDOWN recovers by probe | FIXED. Residual: POST_RESPONSE Scene work is still SKIPPED/BLOCKED while the same turn's foreground call holds the single slot |
| D5 | 16/20 lines skip the Sidecar, 6 wrong OBSERVED locations | 4/20 skip it (clear evidence only), 0 wrong OBSERVED@1 locations; weak `at/near Name` is INFERRED 0.5 and left to semantic extraction | FIXED on synthetic lines; real prose UNVERIFIED-LIVE |
| D6 | No traversal (`NO_ENTITY_ANCHORS`/`NO_MATCHING_EDGES`, 7/10 edges stale) | story-bound: identities 0 -> 4, `Mara` and `entity:mara` anchors traverse 4-5 edges, 0 stale; e2e with a Scene-cast anchor: anchors `["entity:mara"]`, 8 nominations, 10 edges 0 stale. Unbound chat: 0 Lore edges (story read scope now enforced; the old probes are unbound, so they print 0) | FIXED for bound Lore |
| D7 | All authored lore CURRENT; conflicts delivered side by side | unchanged (`trace-turn-bound`: Truth HIGH, 0 unresolved) | **OPEN, owner decision O4** |
| D11 | Native Jev never runs | unchanged (`SKIP_JEV/JEV_NOT_REQUIRED`); consequence of D7; Jev is optional by JEV_WAVE11 | **OPEN, owner decision O5** |
| D10 | 1,200 entries: 154 s synchronous study, 3.1-3.9 s/turn, 20.7 MB export | `stress-lore1200` N=1200: ingest+study **12.0 s**; turn wall 2.5-3.0 s; 10-entry edit 10.9 s (was 17.4); export **20.7 MB (unchanged)**; heap after load 535 MB (same). Study is still one synchronous call | PARTIAL (O6) |
| D3 | Nothing persists across reload | with a host store: Brain + Memory + **Lore incl. story binding** restore (round trip test). No store is supplied by the repository, Scene state has no snapshot | PARTIAL (O7) |
| D12 | Atmosphere TypeError, 10 tests, demo crash | fixed; demo rc=0 | FIXED |
| D14 | DEEP consolidation cannot run on operator resources | unchanged | **OPEN, owner decision O2** |
| H1 | Foreground job QUEUED forever | not reproduced before or after; D4 fixes the SKIPPED mechanism | UNVERIFIED-LIVE (needs a fresh installed export) |
| H2 | Late-state telemetry for native turns | not examined | UNCHANGED |
| H3 | 256 x 120-200 KB turn records | 60 turns: 27 MB retained (was 375 MB @100); residual: full records for turns whose learning has not settled, about 0.7 MB each in a checkpoint snapshot | IMPROVED |

## New costs introduced by the repair (measured)
- `readIdentityResolution` payload at 1,200 Lore entries: 649 KB (was in the 5-row range, largest reader was 223 KB). It carries the Lore-owned identities with per-alias source refs. Not bounded yet; folds into O6.
- The Lore graph provider now needs a chat: an unbound chat gets no Lore graph edges (intended, matches `LORE_STORY_SCOPE_REQUIRED`).
- Registered Lore identities are global to the Native registry (labels only) and persist across chat switches.

## Verification totals (final gate)
1,912 tests, 1,879 pass, 33 fail; every failing name is in the baseline list (15 baseline failures fixed, 0 new). Assembly verifier PASS after the reviewed overlay. See `REPAIR_LEDGER.md` (FINAL GATE).

## Open decisions (need an owner)
O1 retirement policy without a revision oracle; O2 `DEEP_BACKGROUND` (scheduling class vs profile class); O3 quiet/impersonate excluded from context; O4 Lore temporal/conflict semantics; O5 native-path Jev; O6 Runtime Batch Engine for Lore study and diagnostic payload bounds; O7 durable host store and Scene persistence. Details and evidence in the ledger.
