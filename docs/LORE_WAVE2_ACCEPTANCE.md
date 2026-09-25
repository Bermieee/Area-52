# Lore Wave 2 Acceptance

## Scope

Lore Wave 2 implements the production multi-resolution Lore representation backend required by #190 while preserving Wave 1.

Completion label after exact-head CI is green:

**LORE MULTI-RESOLUTION COMPILER READY / CONTEXT + UI INTEGRATION PENDING**

This is not FT004 PASS, #224 PASS, final #170 product completion, or live Context Compiler integration.

## Deterministic acceptance coverage

The Wave 2 focused suite verifies:

1. deterministic bounded source slicing;
2. full slice coverage;
3. strict future provider slice-ref accounting;
4. coexisting Lean/Balanced/Heavy/Custom representations;
5. exact source preservation;
6. semantic profile policy;
7. Ember Tavern identity/ownership/history/destruction/conflict retention;
8. structured quality receipts;
9. impossible custom-cap failure;
10. missing mandatory contribution rejection;
11. unsupported free-floating provider assertion rejection;
12. unknown ref / authority escalation / persistent-ID rejection;
13. character-texture retention;
14. large-source slicing and valid profile family;
15. deterministic same-revision reuse;
16. wording-only edit semantics;
17. load-bearing temporal ownership change;
18. policy revision invalidation;
19. representation history/forensics;
20. Context Compiler advertisement seam;
21. UI-ready read model;
22. removal freshness containment;
23. exact source drillback and authority negatives.

The Node test runner groups these as 20 Wave 2 test cases because several related rejection conditions are asserted together.

## Pre-documentation validation checkpoint

Implementation checkpoint:

\`Development-Lorebook-Editor@946131e884fe72f5379c36bfb901d7c018d19ce0\`

GitHub Actions Wave 2 run:

\`36046025525\`

Results:

- Wave 1 regression: 13/13 PASS;
- Wave 2 focused: 20/20 PASS;
- browser portability: 1/1 PASS;
- Wave 1 stress: PASS;
- Wave 2 stress: PASS;
- JavaScript syntax: PASS;
- ESM import: PASS.

A final exact-head workflow is required after the documentation commit; its ID belongs in the worker handoff because committing an Actions ID would itself create a newer head.

## Wave 1 stress regression

- sources: 40;
- source revisions: 1,045;
- targeted edits: 1,000;
- removals: 5;
- duplicate triggers coalesced: 1,000;
- resumed checkpoints: 14;
- current artifacts: 770;
- source loss: 0;
- unsupported authority promotion: 0;
- stale current artifacts: 0;
- duplicate current publication: 0;
- unrelated full rebuilds: 0;
- active checkpoint sessions after completion: 0;
- due obligations after completion: 0;
- removed current artifacts: 0.

## Wave 2 stress

- sources: 24;
- source revisions: 168;
- edit rounds: 6;
- targeted edits: 144;
- representation compile requests: 720;
- deterministic reuses: 24;
- wording-only equivalent edits recognized: 18;
- semantic edits detected: 96;
- policy rebuilds: 24;
- successful custom-cap publications: 24;
- sliced sources: 3;
- conflict-bearing sources: 4;
- representation artifacts retained in history: 696;
- current representations: 96;
- source loss: 0;
- authority promotions: 0;
- PASS outputs missing mandatory semantics: 0;
- stale current representations: 0;
- duplicate active representation IDs: 0;
- unrelated-source representation identity changes during targeted edits: 0.

## Ember Tavern result

The representation family preserves:

- Mara and Eris identity;
- Mara ownership of Ember Tavern;
- Eris/Sun Blade historical possession and location sequence;
- Tavern destruction;
- CURRENT/HISTORICAL/SEQUENCE distinctions;
- both Blade-fate alternatives;
- UNRESOLVED status rather than a fabricated winner;
- hard constraints and RP texture when supplied.

Balanced and Heavy add progressively richer preferred/optional texture without changing the grounded facts.

## Custom cap

A normal bounded custom cap produces a separate revisioned representation.

A tiny cap that cannot contain the mandatory semantic minimum returns \`CAP_IMPOSSIBLE\`, reports \`minimumSafeEstimate\`, and publishes no representation.

## Wording-only edit

A wording-only source edit:

- creates a new exact source revision;
- can preserve the same revision-independent contribution fingerprint;
- invalidates the old representation because exact provenance changed;
- generates a new representation ID under the new revision;
- can preserve identical derived content when meaning is unchanged;
- does not invalidate unrelated source representations.

## Load-bearing edit

\`Mara owns Ember Tavern\` -> \`Mara formerly owned Ember Tavern\` produces:

- Wave 1 temporal semantic diff;
- changed Wave 2 contribution fingerprint;
- source-local representation staleness;
- HISTORICAL representation content;
- unrelated-source representation reuse;
- retained old representation history and stale reason.

## Policy revision

A profile-policy change can stale a current representation without source text changing.

The new representation records the new policy revision and the same exact source revision.

## Browser/host qualification

The production modules pass the repository browser-like source audit and direct ESM import.

No production-facing Wave 2 module introduces Node-only runtime dependencies.

## Integration boundary

The backend is ready to advertise representations to Context Compiler and UI.

Context Compiler still owns final context selection.

Worker 3/UI still owns rendering.

#179/#224 still require deliberate cross-lane assembly and live SillyTavern acceptance.
