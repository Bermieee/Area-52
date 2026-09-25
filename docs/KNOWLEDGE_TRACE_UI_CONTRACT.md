# Knowledge Trace UI Contract — Phase 1 Wave 5

Worker 1 supplies data only. UI owns presentation.

`KnowledgeTraceReadModel` exposes `contextItemId`, `authority`, `temporalStatus`, `immediateArtifact`, `sourceRevisionRefs[]`, `derivationChain[]`, `retrievalChannels[]`, `precisionReasons[]`, `truthClassification`, `unresolvedLinks[]`, `freshness`, and `health`.

The read model is frozen/read-only and has no mutation authority.

It is intended to answer: why does Area-52 believe this; what kind of evidence is it; is it current or historical; which source revision supports it; what retrieval channels nominated it; why Precision retained it; and how Truth classified it.
