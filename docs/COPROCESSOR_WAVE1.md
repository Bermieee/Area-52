# Cognitive Coprocessor Wave 1

## Mission

Prove the native One-Key Swarm skeleton:

```
User Send
 -> one immutable TURN_EVENT
 -> Dynamic Fan-Out Plan
 -> capability-defined worker tasks
 -> independent worker completion
 -> validation / freshness / dedupe
 -> deterministic Gather Coordinator
 -> foreground quorum
 -> structured compiler bundle
 -> Context Seal
 -> Main-ready handoff
 -> late work routes forward
```

The defining rule is:

> One keypress may wake zero, one or many cognitive workers, but Main waits only for the bounded foreground quorum.

## Implemented

Wave 1 implements provider-neutral contracts and orchestration only. Workers remain deterministic fixtures.

Initial roles:

- Historian — REQUIRED;
- Graph Walker — REQUIRED;
- Green Room — OPPORTUNISTIC;
- Truth / Precision — REQUIRED.

Tasks request capabilities. They never encode a permanent SC-A/SC-B identity.

## Runtime boundary

Sidecar/Jev exposes task capability/layer/placement/deadline/batch metadata and Runtime-compatible capability descriptors.

Runtime still owns worker pools, capability registry execution, Work Ledger, Batch Engine, Resource Governor, yield/resume and scheduling.

The swarm accepts an injected execution router. That is an integration seam, not a scheduler.

## Nexus boundary

Worker results adapt to Nexus `CognitiveResult` / Result Bus semantics.

Gather preserves structured lanes, provenance, freshness and disagreement. It does not settle truth.

Context Seal is injected as a boundary. A sealed packet cannot be rewritten by late results.

## Golden world

Fixture turn:

> Eris returns to the ruined Ember Tavern looking for the Sun Blade while speaking to Mara.

Required truth:

- Ember Tavern — CURRENT destroyed;
- Sun Blade at Tavern — HISTORICAL evidence only;
- Sun Blade current location/fate — UNRESOLVED / unknown;
- credible conflicting evidence — destroyed in fire vs removed before fire.

Green Room is intentionally delayed beyond foreground seal.

## Current validation checkpoint

At implementation checkpoint `bedc234ded0b861842945937f2222c74819ab522`:

- full deterministic tests: 38/38 PASS;
- focused Wave 1 tests: 36/36 PASS;
- stress tests: 2/2 PASS;
- syntax PASS;
- coprocessor index import PASS;
- CI SUCCESS.

A final documentation/compatibility checkpoint is required before handoff.
