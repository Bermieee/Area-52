# Cognitive Coprocessor — Wave 9 Acceptance

Working branch: `Development-Sidecar/Jev`

Actual starting SHA: `aee72220131037c3e499372a418ccb3c52078fa6`

Objective: prove Lore, Scene and Retrieval/Truth can use one generic Jev Decision Core through thin owner adapters without transferring semantic ownership into Jev.

## Acceptance gates

The exact final branch head must pass:

1. existing Jev Wave 8 regression and stress;
2. Lore adapter focused suite;
3. Scene adapter focused suite;
4. Retrieval/Truth adapter focused suite;
5. three-domain same-core golden;
6. Ember Tavern cross-domain golden;
7. deterministic-skip goldens in all three domains;
8. abstention and escalation;
9. stale/revision fencing;
10. provider unavailable/timeout/malformed safety;
11. replay/idempotency;
12. authority-negative suite;
13. symmetric adapter failure isolation;
14. Runtime `JEV_DECISION` / `SEMANTIC_JUDGMENT` compatibility;
15. UI diagnostic read model;
16. bounded telemetry;
17. mixed cross-domain stress;
18. browser/SillyTavern production-module safety;
19. JS/MJS syntax sweep;
20. Coprocessor ESM index import;
21. exact-head GitHub Actions GREEN.

## Required safety assertions

- Jev never becomes Lore, Scene or Retrieval/Truth owner.
- adapter/Jev confidence never grants authority.
- stale receipt never becomes an accepted current proposal.
- deterministic cases do not invoke a provider.
- ABSTAIN/UNRESOLVED do not become forced winners.
- provider failure does not create domain facts.
- one adapter failure does not poison registry/global state or other adapters.
- bounded requests do not copy full owner databases/raw prompt/provider dumps.
- Runtime sees generic `JEV_DECISION`, not domain-specific scheduler semantics.

## Acceptance evidence

Code/test evidence run `36046692412` at `44c4f429db31c5afa04704792f7299669fd1b55c` completed GREEN after the final test-strengthening commits:

- Wave 8 regression: 40/40 PASS;
- Wave 8 stress: 6/6 PASS;
- Lore adapter: 6/6 PASS;
- Scene adapter: 7/7 PASS;
- Retrieval/Truth adapter: 7/7 PASS;
- cross-domain / same-core / Ember Tavern / isolation / boundedness / sanitization: 12/12 PASS;
- authority/abstain/escalation negatives: 7/7 PASS;
- combined Wave 9 focused: 41/41 PASS;
- browser-like Wave 9: 2/2 PASS;
- full repository regression: 425/425 PASS;
- Coprocessor index ESM import: PASS.

Focused stress: 3,000 mixed owner decisions (1,000 Lore / 1,000 Scene / 1,000 Retrieval), 26 duplicate replays, 31 malformed adapter inputs, 33 stale revisions, 2,421 provider calls, 0 authority violations, 0 stale proposal acceptance, 0 cross-domain state leaks, 0 forced decisions where abstention was required, and 0 oversized proposals.

The final branch-head run must remain GREEN after documentation/evidence commits; its exact run ID is reported in the Worker 2 handoff.

## Integration boundary

A GREEN Wave 9 makes #211 Sidecar/Jev-lane complete for the required three-domain matrix. It does not claim #224 PASS, owner-domain live integration, live Settlement, or full #212 benchmark completion.