# Worker 3 Brain Retrieval Completion — Design

**Date:** 2026-09-27  
**Branch:** `Development-Worker-3`  
**Cards:** #270 Production sparse retrieval and exact-identifier recall; #269 Multi-resolution and corrective retrieval in live selection

## Goal

Complete the selected-turn Brain retrieval path without taking ownership of Lore, Memory, graph, or dense-provider stores:

```text
selected turn
  -> bounded retrieval intents
  -> production sparse exact/keyword recall + existing owner channels
  -> Candidate Bus
  -> Truth / retrieval quality
  -> at most one corrective pass
  -> Gather
  -> Context Seal
```

## Boundaries

- Worker 3 owns Brain-side retrieval assembly and the production sparse/exact channel.
- Worker 2 owns Memory episode/reflection/summary producers. Brain consumes only the public Memory owner channel.
- Worker 4 owns structured-state/graph and Lore hierarchy producers. Brain consumes public graph/Lore interfaces and never mutates their stores.
- Dense embeddings remain Worker 1 work. This wave does not add, modify, or claim production dense execution.
- Retrieval rank never becomes truth, admission, settlement, or Context Seal authority.
- A sealed candidate trace is not host-delivery proof.

## Production sparse channel

Add a bounded Brain-owned sparse channel built on the existing revision-aware retrieval-index lifecycle contracts. It indexes current owner artifacts with:

- exact source/artifact IDs;
- Lore UID and authored metadata identifiers when supplied by the owner;
- exact names/aliases/keywords/triggers when present in owner metadata;
- exact phrases and lexical token/count representation;
- exact source revision, provenance, authority/truth hints, and dependency invalidators.

Qualified exact identifier/phrase/keyword matches outrank ordinary lexical overlap. Diagnostics must name the actual execution mode and never call token-count scoring BM25.

The index is bounded by configured artifact/candidate limits. When the owner cannot provide a safe current-artifact surface, the sparse owner channel reports UNAVAILABLE/PARTIAL and the existing owner query plus Core lexical fallback remains available.

## Owner revision and scope

Lore initialization may use only public owner APIs: `status({chatId})` for bounded current entry metadata and `sourceRevision(sourceId)` for exact current source content. Story scope is authoritative; only entries the owner marks eligible for the selected story may enter the sparse owner index for that turn.

`LoreSourceRevisionChanged` invalidates/tombstones only affected source representations. A current replacement revision is indexed only after exact owner revision content is available and matches the owner revision. Removed and stale revisions cannot nominate.

Perspective constraints remain downstream candidate constraints. Worker 3 does not invent private Character knowledge or mutate Memory scope.

## Retrieval intents and multi-resolution routing

Use existing Scene Query Planner intent decomposition when a current Scene signal is available; otherwise retain the existing bounded direct-query intent. Preserve entity, location, relationship, object-provenance, thread, threat, revision, and perspective metadata.

- exact/narrow intents can use the production sparse owner channel and exact-source owner channels;
- relationship intents may use the registered graph provider/Graph Walker;
- broad conceptual intents may use the existing Lore hierarchy/community owner interface;
- unavailable optional channels report UNAVAILABLE rather than simulated success.

Hierarchy/community summaries remain retrieval nominations and require downstream Truth/Gather/Seal acceptance.

## Truth quality and correction

The selected-turn path evaluates the first Candidate Bus result after Truth using existing HIGH/MIXED/LOW policy semantics:

- **HIGH:** proceed.
- **MIXED:** permit one bounded corrective pass chosen from existing supported actions, using the same candidate, latency, scene/world revision, source-revision, and perspective fences.
- **LOW:** admit no long-term memory.

Corrective retrieval is strictly one-pass. Provider failure preserves the first-pass evidence, records failure/degradation, and never manufactures certainty.

## Traceability

Receipts must preserve distinct stages:

1. retrieval nomination / Candidate Bus;
2. Truth classification and retrieval quality;
3. corrective decision/result;
4. Gather admission;
5. Context Seal.

Tests must be able to follow one exact sparse candidate ID/evidence lineage through Truth -> Gather -> Seal without inferring PromptPlan or host delivery.

## Acceptance

Focused deterministic coverage must include:

- exact name, source ID, UID, keyword/trigger, and phrase recall;
- wrong story scope rejection;
- owner revision edit invalidates only the affected record;
- removal/tombstone prevents current nomination;
- reload/owner hydration remains bounded;
- owner/index unavailable falls back truthfully;
- relationship-only query consumes graph candidates where provider exists;
- broad-concept query consumes Lore hierarchy candidates where owner exposes them;
- paraphrase-only behavior does not claim dense recovery in this wave;
- corrective attempts are bounded to one;
- LOW may seal with no long-term memory;
- one accepted exact sparse candidate traces through Truth, Gather, and Context Seal.
