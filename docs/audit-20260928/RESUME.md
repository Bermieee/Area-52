# Resume: installed architecture repair

Branch `repair/installed-architecture`, based on `main @ 98a4e438`. The plan is the "Area-52 installed architecture repair plan" (Waves 0–7 + final gate). Findings D1–D14 are in `AUDIT_REPORT.md`; progress and evidence per commit are in `repair/REPAIR_LEDGER.md`.

## State at hand-off
- Wave 0 done: D12 fixed; FT002 fixture fixed; 48 baseline failures classified (`repair/BASELINE_FAILURE_INVENTORY.md`); new D14 (DEEP consolidation resourceClass) needs an owner decision; assembly drift reconciliation deferred to the final gate.
- Wave 1 done (fake host): D1, D9, D13 fixed; quiet/impersonate exclusion is a DECISION awaiting confirmation.
- Wave 2 committed as WIP (c73fec0): long-session (100 turns) and turn-retention tests pass; the broad regression sweep was interrupted.

## Next steps
1. Finish the Wave 2 regression sweep, comparing against baseline counts in the ledger. Candidate files: tests matching `native|worker1|deployment|clapperboard|context|hot-cognition|wave4|wave10|adaptive|wave12|wave3|delivery|trust|prompt|integration-wave4|knowledge|main-owner|workers-1-4|demo-vis|generation`. Run the files in chunks; some take minutes.
2. Squash or reword the WIP commit once the sweep is clean; update the ledger.
3. Wave 3 (D2): route host edit/delete/swipe/regenerate to Scene NarrativeFeed, Core source retirement and Memory invalidation. Also the FT002 scenario 8 `SCENE_FANOUT_SELECTION_FENCE_MISMATCH` on `sourceRevisionSet`.
4. Waves 4–7 and the final gate as in the plan.

## Running the audit harness
From `docs/audit-20260928/harness/`: `node repro-swipe.mjs` and the other scripts (Node 22, no install). New regression tests live in `tests/repair-wave*.test.mjs`; the shared fake host is `tests/helpers/installed-host.mjs`.

Evidence labels: fake-host, live-browser and live-provider evidence stay separate. Nothing here is a live SillyTavern pass.
