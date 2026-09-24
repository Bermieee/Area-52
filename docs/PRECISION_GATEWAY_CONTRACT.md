# Precision Gateway Contract — Phase 1 Wave 4

## Purpose

The Precision Gateway is the bounded quality-control stage between broad retrieval candidates and Truth/Gather. It ranks relevance; it does not settle canon.

Pipeline:

`CandidateBus -> deterministic filter -> optional late interaction -> optional semantic/cross-encoder judge -> bounded PrecisionResultSet -> Truth`

## Candidate caps

Production defaults are explicit and independently bounded:

- input: 256
- late interaction: 64
- semantic judge: 24
- final: 12

Callers may tighten the caps. No stage may expand its input beyond the prior stage or exceed the configured bound.

## PrecisionResultSet

Each selected result preserves:

- candidate reference;
- input/output rank;
- relevance score;
- optional semantic score;
- temporal and scene compatibility metadata;
- reason codes;
- evidence/source revision references;
- artifact reference;
- provenance and nominating channels;
- supplied authority class and truth status.

Provider/model identity is stage provenance only. It does not alter candidate authority, truth status or Settlement authority.

## Contradiction

A small score delta is never a truth decision. Explicit credible conflict sets are protected during bounded down-selection so Truth/Gather can preserve unresolved evidence.

## Freshness

Candidate references are revision-fenced before ranking. A candidate produced from an unavailable/older source revision is STALE for active use. The Gateway never silently substitutes the latest revision.
