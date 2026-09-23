# Cognitive Coprocessor Wave 1 — Test Evidence

## Accepted implementation checkpoint

Implementation/compatibility code checkpoint:

`e0604cad8e92fc92289f809ad1979ff621e920a6`

Validation on that code:

- full deterministic suite: **42/42 PASS**;
- focused Wave 1 suite: **40/40 PASS**;
- deterministic stress suite: **2/2 PASS**;
- JavaScript syntax validation: **PASS**;
- `src/coprocessor/index.js` import: **PASS**.

## Documentation + compatibility checkpoint

Documentation/compatibility head before this evidence record:

`18fd3198fc28b106fe1af4b3f8fce2b78e01d5dc`

GitHub Actions run:

`35839436204` — **SUCCESS**

The run again reported:

- 42/42 full suite PASS;
- 40/40 focused Wave 1 PASS;
- 2/2 stress PASS;
- syntax PASS;
- module import PASS.

## Stress evidence

The stress fixture plans **2,100 worker tasks across 525 turns** with:

- duplicate/redelivered Turn Events;
- duplicate result delivery;
- stale revision results;
- future/invalid revision results;
- worker omission/failure;
- deterministic fallback;
- late optional work.

It proves bounded Turn Event retention, deterministic gather closure, no cross-turn result leakage, duplicate containment, bounded fallback behavior, and post-close routing.

## Golden-world evidence

The Ember Tavern / Sun Blade fixture preserves:

- Ember Tavern CURRENT destroyed;
- Sun Blade historical Tavern location only;
- Sun Blade current location/fate UNRESOLVED / unknown;
- conflicting credible evidence remains explicit;
- Green Room remains INFERRED;
- foreground closes when REQUIRED quorum is satisfied;
- delayed OPPORTUNISTIC Green Room cannot change the sealed packet.

## Live compatibility references

Final compatibility inspection used:

- Runtime Fabric: `Development-Worker-Director@890f8576bcfcc4c056b959271027242dc6af7d7c`;
- Nexus Cognitive Core: `Development-Nexus@327c120bc8826e33c07766d94c88dd7d8b82d352`.

Runtime Wave 2 versioned capability/event contracts are mapped explicitly in Sidecar.

Nexus Result Bus and Context Seal remain the canonical routing/publication boundaries. Adaptive Context Runtime starts after Context Seal, so it does not reopen sealed cognition.

## Final-head rule

The final documentation-only commit containing this evidence must pass the same workflow before Wave 1 handoff is considered accepted.
