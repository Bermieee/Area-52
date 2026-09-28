# Resume: installed architecture repair

Branch `repair/installed-architecture`, based on `main @ 98a4e438`. Findings D1-D14 are in `AUDIT_REPORT.md`; evidence per commit, sweeps and the final gate are in `repair/REPAIR_LEDGER.md`; the repeat audit is `repair/REPEAT_AUDIT.md`.

## State
Waves 0-7 and the final gate are done and pushed. Full suite: 1,912 tests, 1,879 pass, 33 fail, all 33 in the baseline list (15 baseline failures fixed, 0 new). Assembly verifier PASS via `assembly/reconciliations/repair-installed-architecture-20260928.json`. Nothing here is a live SillyTavern/provider pass; the live checklist in `AUDIT_REPORT.md` section 9 is untouched.

## Open owner decisions (not resolved, do not guess)
O1 retirement policy without a revision oracle. O2 `DEEP_BACKGROUND` class (D14). O3 quiet/impersonate context. O4 Lore temporal/conflict semantics (D7). O5 native-path Jev (D11). O6 Batch Engine for Lore study and diagnostic payload bounds (D10). O7 durable host store and Scene persistence (D3).

## Not merged
Do not merge to `main` without an explicit instruction.

## Running things
- Tests: Node 22, `node --test tests/<file>.mjs` per file (the full suite takes about 20 minutes on 4 vCPU; `repair-wave2-long-session` alone is about 7 minutes).
- Audit harness: `docs/audit-20260928/harness/*.mjs`, no install. The three `probe-bound-*.mjs` files are the story-bound variants.
- Fake host for new tests: `tests/helpers/installed-host.mjs`.
