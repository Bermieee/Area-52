# TURN_EVENT Coprocessor Contract — Phase 1 Wave 5

One user Send is represented as one immutable TURN_EVENT.

Identity preserved by the Sidecar adapter:
- turnId
- eventId
- eventVersion
- causationId
- correlationId
- sceneRevision
- worldRevision
- sourceRevisionSet
- characterStateRevision
- createdAt
- deadline
- dedupeKey

At-least-once redelivery with the same dedupe identity is idempotent. Duplicate delivery cannot create a second cognitive fact or second authority-bearing result.

Workers are independently eligible unless a real dependency is declared. The design does not recreate a fixed SC-A -> SC-B -> SC-C chain.

Scene/query signals, active threads, warm state and capability availability feed Dynamic Fan-Out. A trivial turn may legally nominate zero LLM workers.

The Sidecar produces capability/task nominations and Runtime-compatible obligations. Runtime Event Spine owns transport execution and scheduling.
