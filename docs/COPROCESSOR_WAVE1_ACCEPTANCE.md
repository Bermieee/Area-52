# Cognitive Coprocessor Wave 1 — Acceptance

## Deterministic golden turn

Input:

> Eris returns to the ruined Ember Tavern looking for the Sun Blade while speaking to Mara.

Plan:

- Historian — REQUIRED — completes 32ms;
- Graph Walker — REQUIRED — completes 41ms;
- Truth / Precision — REQUIRED — completes 57ms;
- Green Room — OPPORTUNISTIC — completes 220ms.

Expected foreground closure: 57ms.

## Truth invariant

- Tavern CURRENT: destroyed.
- Blade historical location: Tavern.
- Blade current location/fate: unknown / UNRESOLVED.
- Evidence disagreement remains visible:
  - destroyed in fire;
  - removed before fire.

No deterministic merge chooses a winner.

## Permanent Wave 1 conditions

Tests prove:

1. one immutable Turn Event;
2. four-worker fan-out;
3. common start point / parallel dispatch semantics;
4. independent completion;
5. correlation preserved;
6. duplicate event/result harmless;
7. worker failure isolation;
8. REQUIRED quorum closure;
9. opportunistic late work non-blocking;
10. disagreement preserved;
11. stale results excluded;
12. future revision rejected;
13. structured compiler input;
14. Context Seal publication boundary;
15. post-Seal result routes forward;
16. sealed bytes/hash stable;
17. no worker canonical mutation path;
18. capability-driven identity;
19. zero-worker turn valid;
20. Jev represented as capabilities;
21. alternate provider can satisfy same task semantics;
22. malformed structured output becomes typed failure/retry;
23. retry is bounded;
24. deterministic fallback prevents indefinite wait.

## Stress

The stress harness plans 2,100 worker tasks across 525 turns and injects:

- duplicate/redelivered Turn Events;
- duplicate worker results;
- stale revisions;
- future/invalid revisions;
- missing/failed work;
- fallback;
- late optional work.

The Turn Event Hub is bounded during stress to prevent unbounded closed-history retention.

## Deferred benchmark metrics

CPU, RAM, provider token use and monetary cost remain null/unclaimed until real provider/runtime integration exists. Wave 1 does not fabricate them.
