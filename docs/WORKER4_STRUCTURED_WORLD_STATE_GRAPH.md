# Worker 4 — Structured World State and Graph Assembly

## Scope

This wave implements Trello #266 by assembling the existing Temporal State Graph, Scene owner graph, Lore owner graph and Memory Historian graph behind the existing native Graph Walker. It does **not** create a new canonical graph store and does not flatten owner authority.

The assembly invariant is:

```text
owner graph/state -> exact revision-fenced references -> Graph Walker -> Candidate Bus
                  -> Truth -> Gather -> Context Seal
```

Scene observation/inference, authored Lore retrieval, Memory episodes/reflections and graph proximity remain evidence or nominations according to their owner semantics. Only existing owner/Settlement boundaries can mutate canonical world state.

## Consumer contract

The new read-only contract is `StructuredWorldStateReferenceSet@1.0.0`.

Public readers:

- `Area52NativeBrain.worldGraphReferences(query, options)`
- `Area52CognitiveCore.worldGraphReferences(query, options)`
- `SensoryNetBackbone.graphReferenceSet(query, options)`

Inputs are bounded by the existing Graph Walker controls: intent, stable entity anchors, allowed edge meanings, depth, nodes, edges, candidates, latency, world revision, Scene revision and perspective.

The response carries only bounded references:

- provider / owner / source kind;
- stable normalized from/to entity IDs;
- owner edge meaning;
- temporal status and temporal applicability;
- authority class;
- exact source revision refs;
- stable identity revision refs;
- dependency revision refs;
- provenance/evidence/claim/event/relationship refs;
- artifact and representation refs/revisions;
- provider revision;
- bounded traversal path/distance;
- safe source/artifact drillback references;
- stale rejection reasons;
- bounded identity and Temporal State reference sets.

It deliberately omits owner source bodies. `rawSourceContentIncluded=false`.

Authority flags are always false for graph mutation, Truth, Settlement, Context Seal and identity settlement.

## Selected-turn receipt

The existing `GraphTraversalReceipt@1.0.0` remains the selected-turn receipt. It now includes bounded `referenceSummary[]` rows from the exact traversal that nominated Candidate Bus evidence. This is the UI/diagnostics seam; there is no second telemetry store.

Stale owner source, dependency, identity, world or Scene revisions remain rejected in `staleRejected[]` before Candidate Bus fusion. As a result they cannot reach Truth, Gather or Context Seal.

## Owner adapters

### Lore

Lore graph rows preserve authored source revision refs, provenance, identity refs and source drillback identifiers. A Lore graph edge is retrieval evidence; graph traversal does not inherit Settlement authority.

### Memory

Memory source freshness is validated against the Memory Temporal graph's **active source revision namespace**, rather than against Memory index/hierarchy revision tokens. Artifact/index revision remains carried separately as artifact/provider revision. This fixes the prior namespace mismatch that could reject fresh episode evidence as stale.

Worker 2 continues to own episode/reflection/summary production and Memory invalidation. No Worker 2 implementation was changed.

### Scene

Scene graph rows derive `sourceRevisionRefs` from the revisioned Scene Registry for the connected Scene nodes. Scene `evidenceRefs` remain evidence refs and are no longer mislabeled as source revisions. Scene graph authority stays descriptive/reference-only.

### Stable identity

All provider endpoints pass through `NativeEntityIdentityRegistry.normalizeRef`. Explicit canonical IDs and accepted source links/aliases resolve; unresolved owner-local refs stay owner-local. Graph proximity does not merge identities.

## Worker 2 / Worker 3 coordination

Worker 2 may consume `StructuredWorldStateReferenceSet` as a narrow reference-only input when Memory needs bounded world/Scene/Lore neighborhood context. It must not treat it as Memory mutation or settlement authority.

Worker 3 may consume `readGraphTraversal(selection).referenceSummary` or call the read-only reference API for diagnostics/corrective retrieval planning. This wave does not alter sparse retrieval scoring, corrective selection policy or Worker 3 UI ownership.

No shared Worker 2 or Worker 3 implementation files are edited by this wave.

## Deterministic acceptance

`tests/worker4-structured-world-state-graph.mjs` proves:

1. a multi-turn entity location change has South/current and North/historical state, including exact temporal bounds, without erasing history;
2. historical and current Scene cast membership remain distinct across a Scene transition;
3. same-time incompatible evidence remains unresolved;
4. Scene, Lore and Memory references identity-link behind one bounded traversal while retaining distinct owner semantics and exact drillback IDs;
5. targeted source invalidation rejects only the affected owner edge;
6. the public Native Brain read contract returns the same bounded non-authoritative reference model;
7. a fresh graph nomination enters Candidate Bus while stale-source and late-Scene-revision edges are rejected before Context Seal.

The fixture also asserts raw Lore and Memory bodies are absent from the reference set.

## Out of scope

- Memory episode/reflection/summary production policy (Worker 2).
- Sparse retrieval/ranking and corrective selection policy (Worker 3).
- New canonical identity merge/split policy.
- New Scene inference or Scene lifecycle behavior.
- Causal hypothesis settlement.
- UI redesign.
- Claiming FT002 LIVE PASS without installed SillyTavern evidence.
