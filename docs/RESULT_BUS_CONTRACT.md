# Area-52 Result Bus Contract

## Purpose

Result Bus is the normalized intake/routing boundary for cognitive work returning from workers, services and in-process subsystems.

Receiving a result means Area-52 received it. It does not mean Area-52 believes it.

## Input

A `CognitiveResult` preserves:

- result ID;
- task ID;
- optional turn ID;
- correlation and optional causation ID;
- source subsystem and worker;
- destination owner;
- result type;
- REQUIRED / OPPORTUNISTIC / DEFERRED class;
- PROPOSAL / OBSERVATION / DERIVED_DATA payload class;
- evidence and provenance;
- source revision set;
- world and scene revision;
- authority class;
- timing metadata;
- requested destination;
- payload.

## Output

A `ResultRoute` records:

- accepted/rejected intake;
- FRESH / STALE / INVALID state;
- requested/effective destination;
- post-seal late state;
- routing reason;
- deterministic sequence.

Destinations are FOREGROUND, NEXT_TURN, BACKGROUND, SETTLEMENT, CACHE and EVALUATION.

## Authority

Result Bus has no canonical mutation authority.

A result routed to SETTLEMENT is only delivered to that boundary. Result Bus never calls a canonical owner by implication and never promotes worker authority.

## Freshness

Freshness is revision-aware.

- inactive source revision -> STALE;
- older world/scene revision -> STALE;
- future world/scene revision -> INVALID;
- exact fences -> FRESH.

STALE may still be useful for evaluation/diagnostics but cannot masquerade as foreground cognition.

## Late results

Once a turn is sealed, a fresh FOREGROUND result is generically routed forward.

- REQUIRED / OPPORTUNISTIC -> NEXT_TURN;
- DEFERRED -> BACKGROUND.

Worker-specific late-result conditionals are unnecessary.

## Failure / recovery

Duplicate result IDs are idempotently contained.

Stale/invalid results remain inspectable. The bus itself is reconstructible from durable result envelopes and does not own truth.

## Benchmark

`tests/wave3.mjs` covers fresh/stale/invalid intake, routing destinations, correlation identity, proposal authority containment and post-seal routing.
