# Adaptive Retrieval Control — Phase 1 Wave 7

Canonical implementation: `src/coprocessor/retrieval-control-policy.js`.

## Purpose

Adaptive retrieval evaluates whether retrieved evidence actually satisfies the turn's information need. It does not classify truth.

Output quality remains:
- HIGH;
- MIXED;
- LOW.

## Intent coverage

Production quality evaluation considers:
- required/satisfied/missing retrieval intents;
- stale evidence;
- contradictions and unresolved evidence;
- temporal mismatch;
- perspective mismatch;
- missing entities;
- provenance completeness;
- channel availability;
- precision confidence.

Legacy ratio-based callers remain supported for accepted Waves 1–6, but Wave 7 production paths prefer intent coverage.

## Decisions

HIGH:
- evidence facets are sufficiently covered;
- proceeds toward Truth/Precision.

MIXED:
- useful evidence exists but an important facet is missing/stale/conflicting/poorly covered;
- may create exactly one `CorrectiveRetrievalPlan`.

LOW:
- retrieval is insufficient enough that injecting long-term memory is worse than injecting nothing;
- produces `RetrievalAbstentionReceipt`.

## CorrectiveRetrievalPlan

A corrective plan carries:
- plan/turn/intent identity;
- reason, target intents and missing evidence;
- one supported corrective action;
- optional provider class/query delta/entity/temporal constraints;
- candidate/evidence-byte caps;
- revision fence and deadlines;
- `attempt: 1`;
- no truth authority.

Supported action families:
- QUERY_REFORMULATION;
- SPARSE_RETRY;
- DENSE_RETRY;
- GRAPH_EXPANSION;
- ENTITY_CONSTRAINED_SEARCH;
- TEMPORAL_NARROWING.

Foreground correction passes are permanently capped at one.

## Dispatch seams

`CorrectiveRetrievalDispatcher` is provider-neutral. A missing Graph/sparse/dense/temporal provider returns explicit UNAVAILABLE/DEGRADED status; it never invents substitute evidence.

Wave 7 does not implement Graph Walker core, vector/sparse indexes, Memory database, Lore index or Temporal State.

## First-pass preservation

Corrective evidence supplements valid first-pass evidence. Candidate Bus-compatible merge:
- retains valid first-pass nominations;
- adds corrected nominations;
- dedupes exact evidence identity;
- preserves channel/provenance disagreement;
- remains bounded.

It is not another unrestricted fusion authority.

## Abstention

`RetrievalAbstentionReceipt` records:
- reason/quality;
- requested and missing intents;
- attempted/unavailable channels;
- whether the one correction was used;
- revision fence;
- `authorityGranted:false`.

LOW, or MIXED still inadequate after correction, may safely emit NO_LONG_TERM_MEMORY.

## Precision corridor

`PrecisionRetrievalPipeline` now carries intent-aware quality, correction-plan and abstention receipts. Precision is invoked only after retrieval reaches HIGH.

Retrieval quality is not CURRENT/HISTORICAL/SUPERSEDED/CONTRADICTED/UNCERTAIN/UNRESOLVED classification. Truth Gate ownership is unchanged.
