# Cognitive Coprocessor Turn Swarm Contract

## Turn Event

Exactly one immutable Turn Event is created per user turn, with:

- turnId;
- eventId / eventType;
- causationId / correlationId;
- revision fences;
- deadline;
- cognitive layer;
- required capabilities;
- delivery attempt;
- dedupe key.

Redelivery returns the same logical event.

## Fan-out

Dynamic planning may select zero, one or many roles.

The plan contains capability requests, not worker identities.

Initial deterministic roles:

- Historian;
- Graph Walker;
- Green Room;
- Truth / Precision.

## Foreground classes

REQUIRED:
- may block until hard deadline;
- hard miss invokes deterministic fallback.

OPPORTUNISTIC:
- admitted if fresh before close/seal;
- never extends foreground solely for itself;
- late result routes NEXT_TURN.

DEFERRED:
- never blocks;
- routes BACKGROUND.

## GatherBundle

Structured lanes:

- loreEvidence;
- episodicEvidence;
- worldState;
- graphResults;
- greenRoom;
- truthClassifications;
- precisionResults;
- externalGrounding.

Also carries:

- provenanceIndex;
- freshnessIndex;
- unresolvedDisagreement;
- missingRequired;
- fallbacksUsed;
- lateResults;
- accepted/rejected/stale result IDs.

Gather never free-form concatenates worker prose and never settles canonical truth.

## Context Seal

Before seal, fresh eligible foreground results may contribute.

After seal, no result can change active packet bytes/hash. Late work routes forward/background.
