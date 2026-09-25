# Area-52 Generation Context Seal Contract

## Purpose

Context Seal is the publication boundary between mutable ongoing cognition and the immutable packet already given to Main.

## Input

Seal receives:

- turn ID;
- correlation ID;
- compiled packet;
- source revision dependencies;
- world revision;
- scene revision;
- admitted result IDs;
- rejected result IDs;
- stale result IDs;
- fallback state;
- deadline metadata;
- dependencies.

## Output

The packet is deep-frozen and a `ContextSealReceipt` records:

- seal ID;
- packet ID;
- stable SHA-256 content hash;
- source/world/scene revisions;
- admitted/rejected/stale result IDs;
- fallback state;
- deadline;
- sequence;
- dependencies;
- sealed state.

## Authority

Seal publishes temporary context only. It does not create memory or canonical world truth.

## Immutability

A turn may seal once.

Re-requesting the identical seal is idempotent. Different content for an already sealed turn is rejected.

A late result may route forward, but it cannot mutate packet bytes or packet hash for the sealed generation.

## Revision behavior

A source edit after seal may invalidate/rebuild future cognition.

It cannot retroactively change:

- old sealed packet;
- old packet hash;
- old source revision set.

Future turns compile against the new active source revision.

## Failure behavior

- precision unavailable -> deterministic existing ordering / PRECISION_FALLBACK;
- corrective retrieval failure -> preserve evidence / CORRECTIVE_FAILED;
- corrective exhausted without resolution -> preserve MIXED evidence / CORRECTIVE_EXHAUSTED;
- unsafe compact compression -> RICH_CONTEXT;
- stale result -> exclude from active foreground publication.

## Recovery

Seal records are independently verifiable by recalculating the stable packet hash.

## Benchmark

The Wave 3 Ember Tavern golden test injects a useful opportunistic precision result after seal and proves both packet content and hash remain unchanged. It then edits a source and proves the old seal remains historically stable while the next turn uses the new revision.
