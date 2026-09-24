# Knowledge Provenance Drill-down — Phase 1 Wave 5

## Required trace

A knowledge-backed context item can be reconstructed by reference through:

```text
PromptPlan section
  -> Context Seal
  -> compiled semantic item
  -> KnowledgeGatherReceipt
  -> Truth classification
  -> Precision metadata
  -> retrieval candidate
  -> KnowledgeEvidence
  -> derived artifact
  -> exact source / experience revision
```

The Core stores identifiers and revision references rather than becoming a general-purpose provenance database.

## W3C-PROV compatibility

The reference chain maps naturally to the concepts Entity, Activity, Agent, `wasDerivedFrom`, `wasGeneratedBy`, and `used`. Wave 5 keeps this as a compatibility mapping only.

## Bounded reconstruction

`reconstructKnowledgePath()` bounds the projected derivation chain to 64 rows and reports truncation rather than expanding without limit. `KnowledgeTraceReadModel` exposes the same chain read-only for future UI.

Required questions supported by the read model include: source class, authority, temporal status, source revision, retrieval channels, Precision reasons, Truth classification, unresolved links, freshness, and health.
