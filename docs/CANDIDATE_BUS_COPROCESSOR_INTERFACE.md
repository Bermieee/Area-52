# CandidateBus Coprocessor Interface

CandidateBus is the future Sensory-Net-facing input seam. Wave 4 does not implement the Sensory Net, Scene Query Planner, Lore, Memory, RAPTOR, GraphRAG or a vector backend.

A normalized candidate may carry, where available:

- `candidateId` and evidence identity;
- Artifact Reference;
- source/world/scene revision identity;
- channel and multi-channel nominations;
- ranking signals;
- entity/relationship references;
- temporal hints;
- scene relevance;
- authority class and truth status;
- provenance/evidence references;
- bounded representation text for the ranking worker.

Fields are optional where the source channel cannot supply them. Storage/backend identity does not grant authority.

## Multi-channel dedupe

BM25, dense, RAPTOR, Tree or ontology nominations of the same underlying evidence collapse to one candidate identity while retaining all nominating channels and rank signals. Duplicate nominations do not multiply truth confidence.

## Missing channel

An unavailable retrieval channel may reduce recall. It must not corrupt truth or cause another channel to gain admission authority.
