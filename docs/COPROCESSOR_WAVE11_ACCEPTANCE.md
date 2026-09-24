# Coprocessor / Jev Wave 11 Acceptance

Target lane claim: **NATIVE COPROCESSOR PATH + OPTIONAL JEV/SIDECAR CONTRACT READY FOR ASSEMBLY**.

Acceptance requires the exact pushed head to prove:

1. A clean native bootstrap has no external plugin, provider, network, database or orchestration dependency and completes a bounded native turn.
2. Native ambiguity remains unresolved without optional semantic capacity.
3. Explicitly configured local/remote optional slots are capability-described, while disabled/unavailable/overloaded/incompatible slots degrade explicitly.
4. Optional proposals cannot mutate canon or settle owner state; malformed, expired, stale and post-Seal results fail closed.
5. HOT work is foreground bounded; DEEP work yields and cannot consume foreground reserve.
6. The 13-case Wave 10 corpus is compared on identical evidence across deterministic-only, sidecar-proposal-only and Jev paths. False certainty/authority/stale acceptance remain disqualifying.
7. Latency acceptance uses elapsed wall-clock measurement, not fixture-declared latency. Reports include median/p95/worst, controlled timeout/fallback counts and token estimates/usage where available.
8. Live provider qualification remains opt-in and reports PASS or SKIPPED; CI requires no credentials.
9. Full branch regression, syntax, browser-source guard and ESM import pass on the exact final head.

#211, FT005/#180 and Live Brain Demo/#224 remain open. Wave 11 does not claim adapter replay acceptance or assembled/live acceptance.
## Measured implementation evidence

Implementation head `b0a026edb52aa9947fe63e62301084aedc54c826` passed Wave 11 Actions run `36056744438` and all Coprocessor Wave 1–10 workflows on the same head.

Node `v22.23.2`, Linux x64 controlled-local measurements:

- deterministic-only: median 0.132 ms, p95/worst 0.258 ms, 0 tokens;
- sidecar-proposal-only: median 2.128 ms, p95/worst 2.154 ms, 5,871 estimated fixture tokens;
- Jev: median 5.036 ms, p95/worst 9.200 ms, 5,073 observed controlled-adapter tokens;
- controlled timeout/fallback: median 3.657 ms, p95 26.547 ms, worst 33.893 ms, 5 timeouts and 5 bounded fallbacks across 20 runs, below the declared 75 ms Jev HOT budget.

The same 13-case evidence set produced 8/13 valid deterministic-only results, 10/13 sidecar-proposal-only results with 3 false-certainty cases, and 13/13 Jev results with 0 false certainty, 0 authority violations, and stale rejection preserved. Jev validly resolved 7 ambiguous cases versus 0 deterministic-only and 6 sidecar-proposal-only. The live provider smoke was `SKIPPED` because `AREA52_JEV_BASE_URL` and `AREA52_JEV_MODEL` were not supplied; no live-provider PASS, latency, usage, or cost is claimed.

Full branch regression on that implementation head: 451/451 PASS. Syntax sweep and Coprocessor ESM import PASS. This documentation-only evidence commit must itself be revalidated by exact-head CI before handoff.

