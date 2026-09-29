# PR #324 body (text to paste; the session could not push or edit the PR)

**Installed-architecture repair: closure round complete (not for merge until the owner says so)**

Branch `repair/installed-architecture`. Verified code head `8506fb7` (later commits are documentation only). Node 22.22.2. All evidence is MOCK-HARNESS (fake SillyTavern host, fake providers, fake or in-memory storage); live acceptance is still open (checklist in `docs/audit-20260928/repair/FINAL_HANDOFF.md`).

## Verification at the exact head
- Full suite, every `tests/*.mjs` run on its own (242 files): **2,029 / 2,029 pass, 0 failing files**. Every one of the 48 baseline failures at `98a4e43` now passes.
- Assembly verifier `scripts/verify-development-deployment.mjs`: **PASS** (every unexpected path reviewed individually; `ASSEMBLY_DRIFT_REVIEW.md`).
- Repeat audit: 24/24 harness probes exit 0 (`repeat-audit/round4/`).

## What this round changed
- **O8 checkpoint encodings**: round-trip tests; fixed two lossy paths (`__proto__` keys dropped; torn string table restored `undefined`).
- **Assembly**: all 17 then-unexpected paths reviewed; a real defect found and fixed (cooldown recovery timers survived `session.destroy()` and could run an authenticated probe).
- **Owner decisions**: O2 kept (DEEP_BACKGROUND is a scheduling lane); O9 decided (discovered models are suggestions; an unlisted ID is MANUAL and must pass an authenticated execution probe; Wave 16/17 contracts amended).
- **Performance at 1,200 Lore entries** (all output-preserving, each pinned by an equivalence test): turn 3.3 s to ~0.9 s; batched study longest stall 804 ms to ~450 ms; operator re-accept of an edited Lorebook 5.5 s to 1.2 s. Heap spike explained (raw heap without GC, not a leak).
- **Correctness fix found by profiling**: the Lore owner channel published ~1,900 evidence rows per retrieval into a 512-entry map, evicting the kept candidates' own evidence (26/96 present before, 48/48 after). The channel now asks the owner for `includeNavigation:false`; an installed A/B test shows candidates, Truth assessment, corrective receipts, seal, choice controller, delivery and conflict sets are identical (unresolved conflict and stale source).
- **Persistence failure modes**: quota exceeded, storage unavailable / private mode (IndexedDB probed before use, localStorage fallback), multi-tab writers (Web Locks, writer-unique keys, safe collection, detection), corrupt manifest (backup manifest, quarantine, never EMPTY): all fail visibly, keep the last valid checkpoint and never delete recoverable data.
- **Jev (D11)**: consumption proven through the installed wiring with a fake HTTP provider: advice only while a JEV resource is connected, consumed next turn as PRESERVE_UNRESOLVED, fallback never advice, disconnect stops requests.

## Still open (not in this repair's scope or needing a decision)
Owner decisions O1, O3, O6, O8 (further checkpoint work), D7 confirmations; multi-tab stale-writer policy; whether a Jev classification should ever reach the narrator's context; residual synchronous chunks (index build ~0.4 s, inline rebuild on re-accept ~1.2 s at 1,200 entries); every live-acceptance item.

Details: `REPAIR_LEDGER.md`, `CLOSURE_CHECKLIST.md`, `FINAL_HANDOFF.md`, `ASSEMBLY_DRIFT_REVIEW.md`.
