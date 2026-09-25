# Knowledge Evidence Contract — Phase 1 Wave 5

## Purpose

`KnowledgeEvidence` is the Core-facing envelope for evidence originating in future Lore, Memory, Temporal State, Scene, retrieval, and Precision systems. It transports authority, time, provenance, revision fences, candidate lineage, and contradiction/hypothesis identity. It does not create authority.

Contract version: `1.0.0`.

## Source classes

The Core accepts these semantically distinct source classes:

- `SOURCE_LORE`
- `OBSERVED_EXPERIENCE`
- `EPISODIC_MEMORY`
- `REFLECTION`
- `TEMPORAL_STATE`
- `SCENE_EPISODE`
- `DERIVED_REPRESENTATION`
- `RETRIEVAL_CANDIDATE`

Temporal status is one of `CURRENT`, `HISTORICAL`, `SUPERSEDED`, `CONTRADICTED`, `UNCERTAIN`, or `UNRESOLVED`.

## Authority

The envelope carries existing Core authority: `OPERATOR`, `SOURCE_CANON`, `OBSERVED`, `SETTLED`, `INFERRED`, or `UNRESOLVED`.

Authority origin is explicit: `SOURCE`, `OBSERVATION`, `SETTLEMENT`, `INFERENCE`, or `CARRIED`.

Rules:

- exact source lore may carry `SOURCE_CANON`;
- raw observed experience may carry `OBSERVED`;
- reflection is `INFERRED` or `UNRESOLVED`;
- derived representations cannot manufacture `SOURCE_CANON`, `OBSERVED`, `SETTLED`, or `OPERATOR`;
- carried authority must exactly match the source authority;
- retrieval rank, Tree placement, provider identity, and Precision score never upgrade authority;
- any incoming authority-grant/bypass flag is rejected.

## Freshness and revisions

Every envelope may carry `sourceRevisionRefs[]` and `dependencyRevisionRefs[]`. Active admission compares both sets against the currently accepted revision sets. A mismatch is `STALE`; it is never silently rebound to a newer revision.

## Candidate lineage and duplicate channels

Candidate lineage retains candidate refs, nomination channels, and evidence refs. Multiple channels may nominate the same evidence identity. Deduplication merges nomination metadata without multiplying fact count, confidence, or authority.

## Version behavior

- same major / compatible minor: accepted;
- unknown optional fields: preserved in `extensions` without semantic effect;
- incompatible major: typed rejection;
- missing authority: typed rejection;
- unknown temporal status: typed rejection;
- no silent coercion.

The Core normalizes external `DERIVED` to Core `INFERRED`, and external `UNKNOWN` to `UNRESOLVED`; neither gains stronger authority.
