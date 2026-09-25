# Cognitive Runtime Fabric — Wave 3 Acceptance

Starting checkpoint: `890f8576bcfcc4c056b959271027242dc6af7d7c`

Working branch: `Development-Worker-Director`

## Required gates

Wave 3 acceptance requires all of the following on the exact final branch head:

1. Wave 1 regression.
2. Wave 2 regression.
3. Wave 3 focused native-swarm suite.
4. Single-resource golden.
5. Two-resource/multi-resource contract-equivalence golden.
6. Provider failure/fallback golden.
7. Foreground quorum/deadline golden.
8. Late/stale containment golden.
9. Jev-as-capability golden.
10. Focused Wave 3 stress.
11. Existing reload/yield/resume regression.
12. Browser-like production-path validation.
13. JS syntax/module-load sweep.
14. Exact-head GitHub Actions GREEN.

## Safety assertions

The tests must prove:
- duplicate TURN_EVENT delivery is idempotent;
- logical job count is independent of physical resource count;
- one resource can service heterogeneous cognitive jobs;
- additional resources change throughput/placement, not semantic contracts;
- REQUIRED never waits forever;
- OPPORTUNISTIC/DEFERRED work cannot become a foreground slowest-worker barrier;
- provider timeout/unavailability/malformed output cannot become successful cognition;
- fallback/retry is bounded;
- stale/late work cannot mutate a sealed/current turn;
- cancellation and supersession do not create duplicate commits;
- worker/provider identity never grants authority;
- Runtime never performs Settlement or semantic truth decisions.

## Live qualification boundary

CI uses deterministic controlled adapters. The opt-in manual JSON HTTP smoke validates that the production adapter seam can call a configured external endpoint, but it does not satisfy FT005 by itself.

Final exact-head run IDs and numeric stress totals belong in the Worker 2 handoff after GitHub Actions completes.
